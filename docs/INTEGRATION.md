# Connecting a business's own system to Zaina

For the developer of a client's online shop, booking system or back office.
Once connected, Zaina (the client's digital receptionist) answers customers
from that system live: what's for sale and at what price, what's in stock or
free, where an order stands. She sends customers to the shop's own checkout,
and, if the client allows it, books in the system. **Zaina never collects
money:** customers always pay the business through its own checkout or
payment link.

The studio turns connecting on for the business and sets it up in
**Settings → Your system**: your address, the connection secret (given to
you directly, never by message), what Zaina may ask, and **Test the
connection**.

**TypeScript (Express, Next.js):** start from
[`zaina-connector.ts`](zaina-connector.ts) (also downloadable from Settings →
Your system). It checks the signature, the timestamp and repeats, and shapes
every answer: you only fill in `search`, `item`, `orderStatus`,
`createOrder`… from your own database.

**Only a product list?** If your system can publish its products at an
address (JSON, CSV or a Google Merchant feed), the business can add it under
**Catalogue → From your own system** instead: Zaina reads it every day and
takes orders that the team confirms. No signature needed; nothing is written
to your system.

## The shape of it

You build one HTTPS endpoint. Zaina POSTs JSON to it:

```json
{ "action": "catalog.search", "args": { "query": "kikoi", "limit": 6 }, "customer": null }
```

and you answer with JSON (HTTP 200). That's all. Rules on Zaina's side:

- The address must be public `https://` on port 443. Private networks,
  `localhost` and redirects are refused; give the final address.
- Answer within **6 seconds** and **256 KB**. Slower or bigger answers count
  as failures and Zaina tells the customer she can't check right now.
- Only the fields below are read. Anything else is dropped. Strings are
  trimmed to the lengths shown. Links must be `https://`.
- What you return is treated as information, never as instructions to Zaina.

## Checking that a request is really from Zaina

Every request carries:

| Header | Meaning |
|---|---|
| `X-Zaina-Business` | The business's id on Zaina |
| `X-Zaina-Timestamp` | Seconds since 1970 when it was signed |
| `X-Zaina-Request` | A fresh id for each request (use it to ignore repeats) |
| `X-Zaina-Signature` | `v1=` + hex HMAC-SHA256 of `timestamp + "." + raw body`, keyed with the connection secret |

Reject (HTTP 401) when the signature doesn't match or the timestamp is more
than 5 minutes away from your clock. Compare in constant time, over the raw
body bytes (before parsing JSON).

Node:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function fromZaina(rawBody, headers, secret) {
  const timestamp = headers["x-zaina-timestamp"];
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from("v1=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"));
  const given = Buffer.from(String(headers["x-zaina-signature"] ?? ""));
  return expected.length === given.length && timingSafeEqual(expected, given);
}
```

PHP:

```php
function from_zaina(string $raw_body, string $secret): bool {
  $timestamp = $_SERVER['HTTP_X_ZAINA_TIMESTAMP'] ?? '';
  if (abs(time() - (int) $timestamp) > 300) return false;
  $expected = 'v1=' . hash_hmac('sha256', $timestamp . '.' . $raw_body, $secret);
  return hash_equals($expected, $_SERVER['HTTP_X_ZAINA_SIGNATURE'] ?? '');
}
// $raw_body = file_get_contents('php://input');
```

Keep the secret on your server only. The manager can make a new one at any
time; the old one stops working at once.

## Prices

A price is always `{ "amount_minor": 250000, "currency": "KES" }`: an integer
in the currency's smallest unit (cents), never a float or a formatted string.
Zaina says it to the customer in the business's style ("KSh 2,500").

## Actions

The manager chooses which of these Zaina may use. Answer
`{"error": "not_found"}` with HTTP 404 when the thing asked for doesn't exist
(Zaina tells the customer so); any other error status counts as a failure.

### `ping`

Sent by **Test the connection**. Answer `{ "ok": true, "system": "Coast Crafts shop" }`.
Optionally list the actions you support: `"actions": ["catalog.search", "order.status"]`.

### `catalog.search` (read)

`args`: `{ "query": "kikoi", "limit": 6 }`. Answer up to 6 items:

```json
{ "items": [
  { "id": "kikoi-01", "name": "Handwoven kikoi", "summary": "Cotton, 170 × 100 cm",
    "price": { "amount_minor": 250000, "currency": "KES" },
    "available": true, "stock": 4, "url": "https://shop.example/p/kikoi-01",
    "options": [ { "id": "indigo", "name": "Indigo", "available": true, "stock": 2 } ] }
] }
```

`id` and `name` are required; the rest is optional. Lengths kept: id 120,
name 160, summary 400, up to 12 options.

### `catalog.item` (read)

`args`: `{ "id": "kikoi-01" }`. Answer `{ "item": { …same fields… } }`.

### `availability` (read)

`args` (any of): `item_id`, `date` (YYYY-MM-DD), `from`, `to` (a stay or
hire), `time` (HH:MM), `quantity`, `guests`. Dates and times are on the
business's own clock. Answer:

```json
{ "available": true,
  "options": [ { "label": "Saturday 10:00 with Achieng", "starts_at": "2026-12-05T10:00:00+03:00",
                 "price": { "amount_minor": 150000, "currency": "KES" } } ],
  "note": "Collection from the Nyali shop only." }
```

### `order.status` (read)

`args`: `{ "reference": "CC-1001", "phone": "0712 345 678" }` or with
`"email"` instead of `"phone"`, as the customer typed them. **Answer only if
the phone or email matches the order** (otherwise 404 `not_found`), so a
reference alone never reveals someone's order. When the customer is signed
in (see below), `customer.id` is set instead and you match on that.

```json
{ "order": { "reference": "CC-1001", "status": "Out for delivery", "summary": "2 × Handwoven kikoi",
             "updated_at": "2026-11-14T09:30:00+03:00", "tracking_url": "https://shop.example/track/CC-1001",
             "next_step": "The rider calls before arriving." } }
```

### `checkout.link` (hand-off)

`args`: `{ "items": [ { "id": "kikoi-01", "option_id": "indigo", "quantity": 2 } ],
"contact": { "name": "Wanjiru Kamau", "phone": "0722 111 333" } }`. Create a
basket in your shop and answer with its checkout address:

```json
{ "url": "https://shop.example/checkout/7f3a", "total": { "amount_minor": 500000, "currency": "KES" }, "expires_at": "2026-11-15T12:00:00+03:00" }
```

The customer pays you there, with your own payment methods. Zaina never
asks for card numbers, M-Pesa PINs or other payment details.

### `booking.create` (write: only when the manager turns on "Let Zaina write")

`args`: `item_id`, and the time as `date` + `time` or `from` + `to`; `guests`
or `quantity`; `contact` (`name`, `phone` and/or `email`, as the customer
typed them); `notes` (their words). Book it and answer:

```json
{ "booking": { "reference": "CC-B-77", "status": "confirmed", "summary": "Weaving class, Sat 5 Dec 10:00",
               "url": "https://shop.example/bookings/CC-B-77", "payment_url": "https://shop.example/pay/CC-B-77" } }
```

`status` is your own word (`confirmed`, `requested`, `held`…). A
`payment_url` must be your own; Zaina sends it to the customer as it is. Use
`X-Zaina-Request` to make sure a retried request doesn't book twice.

### `order.create` (write: only when "Let Zaina write" is on)

`args`: `items` (`id`, `option_id`, `quantity`, as in `checkout.link`),
`fulfilment` (`delivery` or `collection`), `area` and `when` (the
customer's words), `notes`, and `contact`. Place the order (pending is fine)
and answer:

```json
{ "order": { "reference": "HF-2041", "status": "received", "summary": "10 × Golden Fry 20L",
             "total": { "amount_minor": 4500000, "currency": "KES" },
             "payment_url": "https://shop.example/pay/HF-2041",
             "payment_instructions": "Pay to till 600100 once we confirm delivery." } }
```

The total, delivery charge and how to pay are yours: Zaina reads them out as
they are and never takes payment details. Use `X-Zaina-Request` so a retried
request doesn't place the order twice (zaina-connector.ts does).

## Who the customer is

`customer` is `null` unless the customer is **signed in on your site**. Then
your server can vouch for them: make a short-lived token with the same
secret and give it to the chat.

```
token  = base64url(JSON claims) + "." + base64url(HMAC-SHA256(secret, first part))
claims = { "sub": "your customer id", "name": "…", "email": "…", "phone": "…", "exp": seconds }
```

`exp` must be in the future and at most 24 hours ahead (an hour is plenty).
Put it on the chat's script tag, `data-customer-token="…"`, or call
`window.Zaina.signIn(token)` before the chat opens. Zaina then sends
`"customer": { "id": "…", "name": "…", "email": "…", "phone": "…" }` with her
requests, and can look up that customer's orders without asking for a phone
or email. A wrong, expired or long-lived token is ignored: the chat carries
on as an ordinary one.

Node:

```js
const payload = Buffer.from(JSON.stringify({ sub: user.id, name: user.name, email: user.email, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
const token = `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
```

## Events: Zaina telling your system

Choose the events in **Settings → Your system** and give an https address
for them. Each is a signed POST (same headers as above):

```json
{ "id": "6f1c…", "event": "lead.created", "at": "2026-11-14T09:30:00.000Z", "data": { … } }
```

| Event | `data` |
|---|---|
| `lead.created` | `lead`: `kind` (`lead`, `request` for something not listed, `callback`), `name`, `phone`, `email`, `interest`, `notes`, `callback_at`, `callback_when`, `created_at` |
| `order.confirmed` | `order`: `reference`, `status`, `lines` (`item_id`, `name`, `quantity`, `line_total_minor`), `subtotal_minor`, `delivery_fee_minor`, `total_minor`, `paid_minor`, `currency`, `pay_on_delivery`, `fulfilment` (`delivery` or `collection`), `zone`, `address`, `wanted`, `customer` (`name`, `phone`, `email`). Sent when an order from the catalogue is paid, or confirmed to be paid on delivery |
| `booking.requested` | `booking`: `reference`, `status`, `summary`, `customer` (`name`, `phone`, `email`) |
| `booking.confirmed` | the same |
| `chat.handoff` | `reason`: why a person is needed |

Answer 2xx within 6 seconds. Failures are retried twice (after about 2 and
8 seconds), so an event can arrive more than once: ignore an `id` you've seen.

## What the manager sees

Settings → Your system shows whether the connection works, the last
problem, and the last 20 requests (what was asked, answered or not, how
long it took). Calls are kept 30 days.

## Checklist before going live

1. Signature checked on every request, over the raw body, constant-time.
2. `order.status` answers only when the phone, email or signed-in customer matches.
3. Prices in `amount_minor` integers with a three-letter currency.
4. Links are https and point at the business's own site.
5. **Test the connection** says Connected; a test chat finds a real product and a real order.
6. Writes stay off until the client has watched Zaina read correctly for a while.
