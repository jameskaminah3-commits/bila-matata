// src/frontdoor/stats.ts
//
// How many people came through a business's page on this service, and how
// many of them started a chat, by day and by how they arrived (its printed
// QR code, or the link). Counts only: nothing about who.

import { inBusiness } from "../db/tenant.ts";

/** qr: a printed code (poster, table card, sticker); card: a business card; link: the address shared some other way. */
export type DoorSource = "qr" | "link" | "card";
export const doorSource = (value: unknown): DoorSource => (value === "qr" || value === "card" ? value : "link");

/** Link previews and crawlers open the page too; they aren't visitors. */
const NOT_A_PERSON = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|curl|wget|headless|monitor|uptime/i;
export const looksLikePerson = (userAgent: string | undefined): boolean => Boolean(userAgent) && !NOT_A_PERSON.test(userAgent!);

async function count(businessId: string, source: DoorSource, column: "visits" | "chats"): Promise<void> {
  await inBusiness((_db, client) => client.query(
    `insert into front_door_days (business_id, day, source, ${column}) values ($1, (now() at time zone 'Africa/Nairobi')::date, $2, 1)
     on conflict (business_id, day, source) do update set ${column} = front_door_days.${column} + 1`,
    [businessId, source],
  ), businessId);
}

/** Never throws: a count that fails must not stop the page or the chat. */
export async function recordDoorVisit(businessId: string, source: DoorSource): Promise<void> {
  await count(businessId, source, "visits").catch((error) => console.error("[front-door] counting a visit failed:", error));
}

export async function recordDoorChat(businessId: string, source: DoorSource): Promise<void> {
  await count(businessId, source, "chats").catch((error) => console.error("[front-door] counting a chat failed:", error));
}

type Counts = { visits: number; chats: number };
export type DoorStats = { days: number; qr: Counts; link: Counts; card: Counts };

export async function doorStats(businessId: string, days = 30): Promise<DoorStats> {
  const rows = await inBusiness(async (_db, client) => (await client.query<{ source: DoorSource; visits: string; chats: string }>(
    `select source, coalesce(sum(visits), 0) as visits, coalesce(sum(chats), 0) as chats from front_door_days
     where business_id = $1 and day > (now() at time zone 'Africa/Nairobi')::date - $2::int group by source`,
    [businessId, days],
  )).rows, businessId);
  const of = (source: DoorSource) => {
    const row = rows.find((entry) => entry.source === source);
    return { visits: Number(row?.visits ?? 0), chats: Number(row?.chats ?? 0) };
  };
  return { days, qr: of("qr"), link: of("link"), card: of("card") };
}
