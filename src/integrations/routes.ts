// src/integrations/routes.ts
//
// Connecting a business's own system (docs/INTEGRATION.md).
//
//   GET   /v1/platform/businesses/:businessId/integration   platform admin  whether it's on, and how it's going
//   PATCH /v1/platform/businesses/:businessId/integration   platform admin  { enabled }  the studio's switch
//
//   GET    /v1/staff/businesses/:businessId/integration          manager   settings, whether a secret is set, recent calls
//   PUT    /v1/staff/businesses/:businessId/integration          manager   { endpoint, label?, actions[], allow_writes?, events_url?, events[] }
//   POST   /v1/staff/businesses/:businessId/integration/secret   manager   a new secret, shown once (the old one stops working)
//   POST   /v1/staff/businesses/:businessId/integration/test     manager   asks the system "ping" and says what came back
//   DELETE /v1/staff/businesses/:businessId/integration          manager   disconnects (address, choices and secret go)
//
// Nothing works until the studio has switched it on for the business.

import dns from "node:dns";
import type { Express, NextFunction, Request, Response } from "express";
import { anyBusinessById } from "../businesses/registry.ts";
import type { PlatformConfig } from "../config.ts";
import { privateAddress, PublicFetchError, publicUrl } from "../net/public-fetch.ts";
import { requireBusinessRole, requirePlatformAdmin, requireStaff, staffOf } from "../staff/auth.ts";
import { ACTIONS, EVENTS, IntegrationError, isAction, isEvent, isWriteAction } from "./client.ts";
import { ask, disconnectIntegration, getIntegration, hasSecret, newSecret, NotAllowed, recentCalls, saveIntegration, setStudioEnabled, type Integration } from "./store.ts";

async function view(businessId: string, integration: Integration) {
  return {
    available: integration.studioEnabled,
    connected: Boolean(integration.studioEnabled && integration.endpoint),
    endpoint: integration.endpoint,
    label: integration.label,
    actions: integration.actions,
    allow_writes: integration.allowWrites,
    events_url: integration.eventsUrl,
    events: integration.events,
    has_secret: await hasSecret(businessId),
    last_ok_at: integration.lastOkAt,
    last_error: integration.lastError,
    last_error_at: integration.lastErrorAt,
    calls: integration.studioEnabled ? await recentCalls(businessId, 20) : [],
    choices: { actions: ACTIONS, events: EVENTS },
  };
}

/** A public https address, checked now (the name must not point into a private network) and again at every call. */
async function address(value: unknown): Promise<string | null> {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 500) throw new PublicFetchError("That address is too long.");
  if (!/^https:\/\//i.test(value.trim())) throw new PublicFetchError("Use an address that starts with https://.");
  const url = publicUrl(value);
  const found = await dns.promises.lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true }).catch(() => []);
  if (!found.length) throw new PublicFetchError("That address couldn't be found.");
  if (found.some((entry) => privateAddress(entry.address))) throw new PublicFetchError("That address isn't on the public internet.");
  return url.toString();
}

export function registerIntegrationRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId/integration";

  app.get("/v1/platform/businesses/:businessId/integration", staff, requirePlatformAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = await anyBusinessById(String(req.params.businessId));
      if (!business) return res.status(404).json({ error: "not_found" });
      const integration = await getIntegration(business.id);
      res.json({ enabled: integration.studioEnabled, connected: Boolean(integration.studioEnabled && integration.endpoint), last_ok_at: integration.lastOkAt, last_error: integration.lastError });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/v1/platform/businesses/:businessId/integration", staff, requirePlatformAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = await anyBusinessById(String(req.params.businessId));
      if (!business) return res.status(404).json({ error: "not_found" });
      if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "enabled_required" });
      const integration = await setStudioEnabled(business.id, req.body.enabled, staffOf(req).user.id);
      res.json({ integration: await view(business.id, integration) });
    } catch (error) {
      next(error);
    }
  });

  app.get(base, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business } = staffOf(req);
      res.json({ integration: await view(business!.id, await getIntegration(business!.id)) });
    } catch (error) {
      next(error);
    }
  });

  /** The studio's switch must be on; otherwise a 403 that says who to ask. */
  async function available(req: Request, res: Response) {
    const { business } = staffOf(req);
    const integration = await getIntegration(business!.id);
    if (!integration.studioEnabled) {
      res.status(403).json({ error: "integration_not_enabled", message: "Connecting your own system is set up with the Bila Matata studio. Ask us under Help & support." });
      return null;
    }
    return integration;
  }

  app.put(base, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, user } = staffOf(req);
      if (!(await available(req, res))) return;
      const body = req.body ?? {};
      let endpoint: string | null;
      let eventsUrl: string | null;
      try {
        endpoint = await address(body.endpoint);
        eventsUrl = await address(body.events_url);
      } catch (error) {
        return res.status(400).json({ error: "invalid_address", message: (error as Error).message });
      }
      if (!endpoint) return res.status(400).json({ error: "endpoint_required", message: "Give your system's https address." });
      const actions = Array.isArray(body.actions) ? [...new Set(body.actions.filter(isAction))] as string[] : [];
      if (Array.isArray(body.actions) && actions.length !== new Set(body.actions).size) return res.status(400).json({ error: "unknown_action", message: `Actions are: ${ACTIONS.join(", ")}.` });
      const events = Array.isArray(body.events) ? [...new Set(body.events.filter(isEvent))] as string[] : [];
      if (Array.isArray(body.events) && events.length !== new Set(body.events).size) return res.status(400).json({ error: "unknown_event", message: `Events are: ${EVENTS.join(", ")}.` });
      if (events.length && !eventsUrl) return res.status(400).json({ error: "events_url_required", message: "Give the address events should go to." });
      const allowWrites = body.allow_writes === true;
      if (actions.some(isWriteAction) && !allowWrites) return res.status(400).json({ error: "writes_not_allowed", message: "Booking in your system needs \"Let Zaina write\" switched on." });
      const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 60) : null;
      const integration = await saveIntegration(business!.id, { endpoint, label, actions, allowWrites, eventsUrl, events }, user.id);
      res.json({ integration: await view(business!.id, integration) });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/secret`, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, user } = staffOf(req);
      if (!(await available(req, res))) return;
      res.setHeader("Cache-Control", "no-store");
      res.status(201).json({ secret: await newSecret(business!.id, user.id), shown_once: true });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/test`, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business } = staffOf(req);
      if (!(await available(req, res))) return;
      const started = Date.now();
      try {
        const answer = await ask(business!.id, "ping", {});
        const offered = Array.isArray(answer?.actions) ? answer.actions.filter(isAction) : null;
        res.json({ ok: answer?.ok === true, ms: Date.now() - started, system: typeof answer?.system === "string" ? answer.system.slice(0, 80) : null, actions: offered });
      } catch (error) {
        const message = error instanceof NotAllowed ? `Not ready: ${error.message}` : error instanceof IntegrationError ? error.message : "Something went wrong.";
        res.json({ ok: false, ms: Date.now() - started, error: message });
      }
    } catch (error) {
      next(error);
    }
  });

  app.delete(base, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, user } = staffOf(req);
      await disconnectIntegration(business!.id, user.id);
      res.json({ integration: await view(business!.id, await getIntegration(business!.id)) });
    } catch (error) {
      next(error);
    }
  });
}
