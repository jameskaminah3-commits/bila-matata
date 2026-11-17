// src/customers/store.ts
//
// One record per customer of a business (customers, migration 0033), and
// everything linked to it: their chats, requests and call-backs, bookings
// and orders.
//
// How a customer is known again, most certain first:
//
//   signed in       the business's own system vouched for them (its id)
//   WhatsApp        the number they write from, which WhatsApp proves
//   typed details   a phone (or, without one, an email) typed in a chat or
//                   given for a booking or order: good enough to file the
//                   record under, never proof of who is asking
//
// Records are keyed by phone (its last 9 digits, as erasure finds them).
// A phone is never added to a record found by email, so typing someone
// else's email can't join two people. Linking runs in the background
// (linkCustomers, every minute) for whatever has contact details and no
// customer yet, so every way a record is made is covered, old ones too.

import { everyBusiness } from "../businesses/registry.ts";
import { phoneKey } from "../conversations/retention.ts";
import type { Business, Customer, CustomerPreference } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";

type Client = { query: <T = any>(text: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }> };

export type Contact = { name?: string | null; phone?: string | null; email?: string | null; externalId?: string | null };

const clean = (value: string | null | undefined, max: number) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;

/** A phone as the team reads it: Kenyan numbers as +254…, others as typed. */
export function displayPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (/^0[17]\d{8}$/.test(digits)) return `+254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `+254${digits}`;
  if (/^254[17]\d{8}$/.test(digits)) return `+${digits}`;
  return raw.trim().startsWith("+") ? `+${digits}` : raw.trim().slice(0, 40);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The customer these details belong to, made if new; null with nothing to
 * know them by. `seen` is when this record of them is from.
 */
export async function customerFor(client: Client, businessId: string, contact: Contact, seen = new Date()): Promise<string | null> {
  const name = clean(contact.name, 120);
  const email = contact.email && EMAIL.test(contact.email.trim()) ? contact.email.trim().toLowerCase().slice(0, 200) : null;
  const key = contact.phone ? phoneKey(contact.phone) : null;
  const phone = key && contact.phone ? displayPhone(contact.phone) : null;
  const externalId = clean(contact.externalId, 120);
  const touch = async (id: string) => {
    await client.query(
      `update customers set name = coalesce(name, $3), email = coalesce(email, $4), external_id = coalesce(external_id, $5),
         first_seen_at = least(first_seen_at, $6), last_seen_at = greatest(last_seen_at, $6), updated_at = now()
       where business_id = $1 and id = $2`,
      [businessId, id, name, email, externalId, seen],
    );
    return id;
  };

  if (externalId) {
    const { rows: [known] } = await client.query<{ id: string }>("select id from customers where business_id = $1 and external_id = $2", [businessId, externalId]);
    if (known) return touch(known.id);
  }
  if (key) {
    const { rows: [row] } = await client.query<{ id: string }>(
      `insert into customers (business_id, name, phone, phone_key, email, external_id, first_seen_at, last_seen_at)
       values ($1, $2, $3, $4, $5, $6, $7, $7)
       on conflict (business_id, phone_key) where phone_key is not null do update set updated_at = now()
       returning id`,
      [businessId, name, phone, key, email, externalId, seen],
    );
    return touch(row.id);
  }
  if (externalId) {
    const { rows: [row] } = await client.query<{ id: string }>(
      `insert into customers (business_id, name, email, external_id, first_seen_at, last_seen_at) values ($1, $2, $3, $4, $5, $5)
       on conflict (business_id, external_id) where external_id is not null do update set updated_at = now() returning id`,
      [businessId, name, email, externalId, seen],
    );
    return touch(row.id);
  }
  if (email) {
    const { rows: [known] } = await client.query<{ id: string }>(
      "select id from customers where business_id = $1 and lower(email) = $2 order by last_seen_at desc limit 1", [businessId, email]);
    if (known) return touch(known.id);
    const { rows: [row] } = await client.query<{ id: string }>(
      "insert into customers (business_id, name, email, first_seen_at, last_seen_at) values ($1, $2, $3, $4, $4) returning id", [businessId, name, email, seen]);
    return row.id;
  }
  return null;
}

/** Links whatever has contact details and no customer yet; one business. */
async function linkBusiness(business: Business, batch = 300): Promise<number> {
  return inBusiness(async (_db, client) => {
    let linked = 0;
    const link = async (table: string, id: string | number, customerId: string | null, sessionId: string | null) => {
      if (!customerId) return;
      await client.query(`update ${table} set customer_id = $3 where business_id = $1 and id = $2`, [business.id, id, customerId]);
      // A website chat with no customer yet belongs to whoever left their details in it
      // (a WhatsApp or signed-in chat is only ever its proven customer's).
      if (sessionId) await client.query("update chat_sessions set customer_id = $3 where business_id = $1 and id = $2 and customer_id is null and channel = 'web' and verified_customer is null", [business.id, sessionId, customerId]);
      linked += 1;
    };
    const sessions = await client.query<{ id: string; channel: string; customer_address: string | null; customer_name: string | null; verified_customer: { id: string; name?: string; email?: string; phone?: string } | null; created_at: Date }>(
      `select id, channel, customer_address, customer_name, verified_customer, created_at from chat_sessions
       where business_id = $1 and customer_id is null and preview is not true
         and ((channel = 'whatsapp' and customer_address is not null) or verified_customer is not null)
       order by created_at limit $2`, [business.id, batch]);
    for (const row of sessions.rows) {
      const contact: Contact = row.verified_customer
        ? { externalId: row.verified_customer.id, name: row.verified_customer.name, email: row.verified_customer.email, phone: row.verified_customer.phone }
        : { phone: `+${row.customer_address}`, name: row.customer_name };
      await link("chat_sessions", row.id, await customerFor(client, business.id, contact, row.created_at), null);
    }
    const leads = await client.query<{ id: number; session_id: string | null; name: string; phone: string | null; email: string | null; created_at: Date }>(
      `select id, session_id, name, phone, email, created_at from leads
       where business_id = $1 and customer_id is null and (phone is not null or email is not null) order by created_at limit $2`, [business.id, batch]);
    for (const row of leads.rows) await link("leads", row.id, await customerFor(client, business.id, row, row.created_at), row.session_id);
    for (const table of ["bookings", "orders"]) {
      const rows = await client.query<{ id: string; session_id: string | null; customer_name: string; customer_phone: string | null; customer_email: string | null; created_at: Date }>(
        `select id, session_id, customer_name, customer_phone, customer_email, created_at from ${table}
         where business_id = $1 and customer_id is null and (customer_phone is not null or customer_email is not null)
           and customer_name <> 'Erased on request' order by created_at limit $2`, [business.id, batch]);
      for (const row of rows.rows) {
        await link(table, row.id, await customerFor(client, business.id, { name: row.customer_name, phone: row.customer_phone, email: row.customer_email }, row.created_at), row.session_id);
      }
    }
    // When each customer was last in touch: their latest chat.
    await client.query(
      `update customers c set last_seen_at = s.last_at
       from (select customer_id, max(last_activity_at) as last_at from chat_sessions where business_id = $1 and customer_id is not null group by customer_id) s
       where c.business_id = $1 and c.id = s.customer_id and s.last_at > c.last_seen_at`, [business.id]);
    return linked;
  }, business.id);
}

/** The background job: every business's new chats, requests, bookings and orders filed under their customer. */
export async function linkCustomers(): Promise<number> {
  let linked = 0;
  for (const business of await everyBusiness()) {
    try {
      linked += await linkBusiness(business);
    } catch (error) {
      console.error(`[customers] linking for ${business.id} failed:`, error);
    }
  }
  return linked;
}

// ── Reading ───────────────────────────────────────────────────────────

export type ChatFact = { id: string; channel: string; startedAt: Date; lastAt: Date; firstMessage: string | null; withTeam: boolean };
export type LeadFact = { id: number; kind: string; status: string; interest: string | null; createdAt: Date; callbackAt: Date | null };
export type BookingFact = { id: string; reference: string; status: string; what: string; checkIn: string; checkOut: string; startsAt: Date | null; totalMinor: number; paidMinor: number; currency: string; createdAt: Date };
export type OrderFact = { id: string; reference: string; status: string; items: string; totalMinor: number; paidMinor: number; currency: string; conflict: string | null; createdAt: Date; completedAt: Date | null };
export type Profile = { customer: Customer; chats: ChatFact[]; leads: LeadFact[]; bookings: BookingFact[]; orders: OrderFact[] };

const toCustomer = (row: Record<string, any>): Customer => ({
  id: row.id, businessId: row.business_id, name: row.name, phone: row.phone, phoneKey: row.phone_key, email: row.email, externalId: row.external_id,
  preferences: row.preferences ?? [], teamNote: row.team_note, followedUpAt: row.followed_up_at,
  outreachStoppedAt: row.outreach_stopped_at ?? null, offersAgreedAt: row.offers_agreed_at ?? null, offersSource: row.offers_source ?? null, offersAskedAt: row.offers_asked_at ?? null, unsubscribeToken: row.unsubscribe_token,
  firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

/** The customers' records and what's linked to each, newest first. */
export async function profilesFor(businessId: string, customerRows: Array<Record<string, any>>): Promise<Profile[]> {
  if (!customerRows.length) return [];
  const ids = customerRows.map((row) => row.id as string);
  return inBusiness(async (_db, client) => {
    const [chats, leads, bookings, orders] = await Promise.all([
      client.query(
        `select s.customer_id, s.id, s.channel, s.created_at, s.last_activity_at, s.managed_by,
                (select left(e.content, 160) from chat_events e where e.session_id = s.id and e.actor = 'USER' and e.content not like 'TEST:%' order by e.id limit 1) as first_message
         from chat_sessions s where s.business_id = $1 and s.customer_id = any($2::uuid[]) order by s.created_at desc limit 2000`, [businessId, ids]),
      client.query(`select customer_id, id, kind, status, interest, created_at, callback_at from leads where business_id = $1 and customer_id = any($2::uuid[]) order by created_at desc limit 2000`, [businessId, ids]),
      client.query(
        `select b.customer_id, b.id, b.reference, b.status, coalesce(o.name, 'Booking') as what, b.check_in::text, b.check_out::text, b.starts_at, b.total_minor, b.paid_minor, b.currency, b.created_at
         from bookings b left join offerings o on o.business_id = b.business_id and o.id = b.offering_id
         where b.business_id = $1 and b.customer_id = any($2::uuid[]) order by b.created_at desc limit 2000`, [businessId, ids]),
      client.query(`select customer_id, id, reference, status, lines, total_minor, paid_minor, currency, conflict, created_at, completed_at from orders where business_id = $1 and customer_id = any($2::uuid[]) order by created_at desc limit 2000`, [businessId, ids]),
    ]);
    const of = <T>(rows: Array<Record<string, any>>, id: string, map: (row: Record<string, any>) => T) => rows.filter((row) => row.customer_id === id).map(map);
    return customerRows.map((row) => ({
      customer: toCustomer(row),
      chats: of(chats.rows, row.id, (r) => ({ id: r.id, channel: r.channel, startedAt: r.created_at, lastAt: r.last_activity_at, firstMessage: r.first_message, withTeam: r.managed_by === "HUMAN" })),
      leads: of(leads.rows, row.id, (r) => ({ id: Number(r.id), kind: r.kind, status: r.status, interest: r.interest, createdAt: r.created_at, callbackAt: r.callback_at })),
      bookings: of(bookings.rows, row.id, (r) => ({ id: r.id, reference: r.reference, status: r.status, what: r.what, checkIn: r.check_in, checkOut: r.check_out, startsAt: r.starts_at, totalMinor: Number(r.total_minor), paidMinor: Number(r.paid_minor), currency: r.currency, createdAt: r.created_at })),
      orders: of(orders.rows, row.id, (r) => ({ id: r.id, reference: r.reference, status: r.status, items: (r.lines as Array<{ quantity: number; name: string }>).map((line) => `${line.quantity} × ${line.name}`).join(", "), totalMinor: Number(r.total_minor), paidMinor: Number(r.paid_minor), currency: r.currency, conflict: r.conflict, createdAt: r.created_at, completedAt: r.completed_at })),
    }));
  }, businessId);
}

/** A business's customers, most recently in touch first; optionally by name, phone or email. */
export async function listCustomerRows(businessId: string, search: string | null, limit = 200): Promise<Array<Record<string, any>>> {
  const q = (search ?? "").trim().toLowerCase().slice(0, 80);
  const digits = q.replace(/\D/g, "");
  return inBusiness(async (_db, client) => (await client.query(
    `select * from customers where business_id = $1
       and ($2 = '' or lower(coalesce(name, '')) like '%' || $2 || '%' or lower(coalesce(email, '')) like '%' || $2 || '%'
            or ($3 <> '' and length($3) >= 3 and coalesce(phone, '') like '%' || $3 || '%'))
     order by last_seen_at desc limit $4`, [businessId, q, digits.length >= 9 ? digits.slice(-9) : digits, limit])).rows, businessId);
}

export async function customerRow(businessId: string, id: string): Promise<Record<string, any> | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  return inBusiness(async (_db, client) => (await client.query("select * from customers where business_id = $1 and id = $2", [businessId, id])).rows[0], businessId);
}

/**
 * The customer behind a chat, only when the chat proves who they are: its
 * WhatsApp number, or a sign-in the business's system vouched for. Typed
 * details never count. Made if new (a first WhatsApp message).
 */
export async function verifiedCustomerOfChat(businessId: string, sessionId: string): Promise<{ row: Record<string, any>; how: "whatsapp" | "signed_in" } | null> {
  return inBusiness(async (_db, client) => {
    const { rows: [session] } = await client.query<{ channel: string; customer_address: string | null; customer_name: string | null; verified_customer: { id: string; name?: string; email?: string; phone?: string } | null; preview: boolean | null }>(
      "select channel, customer_address, customer_name, verified_customer, preview from chat_sessions where business_id = $1 and id = $2", [businessId, sessionId]);
    if (!session || session.preview) return null;
    let id: string | null = null;
    let how: "whatsapp" | "signed_in" = "whatsapp";
    if (session.channel === "whatsapp" && session.customer_address) {
      id = await customerFor(client, businessId, { phone: `+${session.customer_address}`, name: session.customer_name });
    } else if (session.verified_customer?.id) {
      how = "signed_in";
      id = await customerFor(client, businessId, { externalId: session.verified_customer.id, name: session.verified_customer.name, email: session.verified_customer.email, phone: session.verified_customer.phone });
    }
    if (!id) return null;
    await client.query("update chat_sessions set customer_id = coalesce(customer_id, $3) where business_id = $1 and id = $2", [businessId, sessionId, id]);
    const { rows: [row] } = await client.query("select * from customers where business_id = $1 and id = $2", [businessId, id]);
    return row ? { row, how } : null;
  }, businessId);
}

// ── Changing ──────────────────────────────────────────────────────────

export const MAX_PREFERENCES = 12;

/** Adds something the customer prefers (the oldest of Zaina's go first past the limit); false if it's already there. */
export async function addPreference(businessId: string, customerId: string, text: string, by: CustomerPreference["by"]): Promise<boolean> {
  const value = clean(text, 120);
  if (!value) return false;
  return inBusiness(async (_db, client) => {
    const { rows: [row] } = await client.query<{ preferences: CustomerPreference[] }>("select preferences from customers where business_id = $1 and id = $2 for update", [businessId, customerId]);
    if (!row) return false;
    const list = row.preferences ?? [];
    if (list.some((entry) => entry.text.toLowerCase() === value.toLowerCase())) return false;
    const next = [...list, { text: value, by, at: new Date().toISOString() }];
    while (next.length > MAX_PREFERENCES) {
      const oldest = next.findIndex((entry) => entry.by === "zaina");
      next.splice(oldest >= 0 ? oldest : 0, 1);
    }
    await client.query("update customers set preferences = $3, updated_at = now() where business_id = $1 and id = $2", [businessId, customerId, JSON.stringify(next)]);
    return true;
  }, businessId);
}

/** The team's changes: the name, their note, the preferences list (kept by text), or follow-ups done. */
export async function updateCustomer(businessId: string, id: string, patch: { name?: string | null; teamNote?: string | null; preferences?: string[]; followedUp?: boolean }): Promise<Record<string, any> | undefined> {
  return inBusiness(async (_db, client) => {
    const { rows: [current] } = await client.query<{ preferences: CustomerPreference[] }>("select preferences from customers where business_id = $1 and id = $2 for update", [businessId, id]);
    if (!current) return undefined;
    const sets: string[] = [];
    const values: unknown[] = [businessId, id];
    const set = (column: string, value: unknown) => { values.push(value); sets.push(`${column} = $${values.length}`); };
    if (patch.name !== undefined) set("name", clean(patch.name, 120));
    if (patch.teamNote !== undefined) set("team_note", clean(patch.teamNote, 1000));
    if (patch.preferences) {
      const kept = new Map((current.preferences ?? []).map((entry) => [entry.text.toLowerCase(), entry]));
      const texts = [...new Set(patch.preferences.map((text) => clean(text, 120)).filter((text): text is string => Boolean(text)))].slice(0, MAX_PREFERENCES);
      set("preferences", JSON.stringify(texts.map((text) => kept.get(text.toLowerCase()) ?? { text, by: "team", at: new Date().toISOString() })));
    }
    if (patch.followedUp) set("followed_up_at", new Date());
    if (sets.length) await client.query(`update customers set ${sets.join(", ")}, updated_at = now() where business_id = $1 and id = $2`, values);
    return (await client.query("select * from customers where business_id = $1 and id = $2", [businessId, id])).rows[0];
  }, businessId);
}

export async function deleteCustomerRow(businessId: string, id: string): Promise<void> {
  await inBusiness((_db, client) => client.query("delete from customers where business_id = $1 and id = $2", [businessId, id]), businessId);
}
