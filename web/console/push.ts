// web/console/push.ts
//
// Alerts on this phone or computer: the console's service worker receives
// the platform's web pushes (sw.ts) and shows them as notifications.

import { api } from "./api.ts";

export function alertsSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("sw.js", { scope: "./" });
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!alertsSupported()) return null;
  return (await registration()).pushManager.getSubscription();
}

function keyBytes(base64url: string): Uint8Array {
  const padded = `${base64url}${"=".repeat((4 - (base64url.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

/** This device's subscription for the platform's current key: one made with an older key can't receive alerts any more, so it's replaced. */
async function subscribe(worker: ServiceWorkerRegistration, publicKey: string): Promise<PushSubscription> {
  const wanted = keyBytes(publicKey);
  const existing = await worker.pushManager.getSubscription();
  const held = existing?.options.applicationServerKey ? new Uint8Array(existing.options.applicationServerKey) : null;
  if (existing && held && held.length === wanted.length && held.every((byte, index) => byte === wanted[index])) return existing;
  if (existing) await existing.unsubscribe();
  return worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
}

async function register(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  await api("POST", "/v1/console/push-subscriptions", { endpoint: json.endpoint, keys: json.keys });
}

export async function turnAlertsOn(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications weren't allowed.");
  await register(await subscribe(await registration(), publicKey));
}

/**
 * On opening the console: a device that has alerts on keeps them working,
 * quietly, if the platform's key changed or the browser renewed its
 * subscription. Never asks for permission.
 */
export async function keepAlertsWorking(publicKey: string | null): Promise<void> {
  if (!publicKey || !alertsSupported() || Notification.permission !== "granted") return;
  const worker = await registration();
  if (!(await worker.pushManager.getSubscription())) return;
  await register(await subscribe(worker, publicKey));
}

export async function turnAlertsOff(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await api("DELETE", "/v1/console/push-subscriptions", { endpoint: subscription.endpoint }).catch(() => {});
  await subscription.unsubscribe();
}
