# Security and privacy review (phases 2 to 7)

What was checked on everything added in phases 2 to 7, and how each risk is
handled. Re-read this before adding a public address or anything that
talks to a client's system.

## Public addresses

| Address | Who can use it | Protection |
|---|---|---|
| `/act/:token` (one-tap Accept or Decline) | Whoever holds the link from an alert email | HMAC-signed for one person, one booking and one action; three days; opening changes nothing (only the button does); refused once answered or when the person leaves the team; strict page policy (no scripts, no framing, no referrer); 60 requests per visitor per 10 minutes |
| `/c/:business`, `/q/:business`, `/k/:business` (QR page and printed codes) | Anyone | Only what the business chose to publish; 120 requests per visitor per minute |
| `/status`, `/v1/status` | Anyone | Working or not, per part; no client names or numbers |
| `/v1/sessions` with `customer_token` | A business's own site | Token checked with that business's connection secret; at most 24 hours; ignored when wrong |

## Zaina talking to a client's system

- **Only public https**, port 443, checked when saved (the name must not
  point into a private network) and again at every connection with our
  own DNS lookup, so a name can't answer one address to the check and
  another to the request. No redirects followed.
- **Signed both ways**: HMAC-SHA256 over timestamp and body, a fresh
  request id each time; events to the client signed the same way.
- **Limits**: 6 seconds, 256 KB, JSON only.
- **What comes back is data**: kept to the contract's fields, strings cut
  to size, links https only. The instructions tell Zaina it's never
  instructions. Links in replies are allowed only when that system
  returned exactly that link in this turn.
- **The secret** is a business secret, encrypted at rest, shown once,
  replaced on demand (the old one stops at once), deleted on disconnect.
- **Writes off** until the business turns them on; the studio's switch
  overrides everything.

## Customers' details

- Zaina sends a client's system only details the customer typed, or that
  the client's own site vouched for (a signed-in customer).
- Order status needs the reference **and** the phone or email the
  customer typed (or a signed-in customer), and the contract tells the
  client to answer only when they match.
- Requests and callbacks keep only what the customer typed.
- Review notes and onboarding notes are studio-only (platform admins).
- Call logs to a client's system keep the action, result and time, never
  the content, and are deleted after 30 days.

## Roles

- Connecting a system, the setup interview, "We're full": managers and
  owners.
- Review queue, pilot report, onboarding tracker, health details, the
  studio's switch: platform admins only.
- Every business table keeps row-level security: a query runs as the
  restricted role, scoped to one business.

## Rules that are checked by tests

No other AI product named, no card numbers or PINs asked for, no internals
shown, only the business's own phone numbers and listed amounts:
`src/eval/checks.ts`, run on the real model with `npm run eval`.

## Known limits

- The health monitor runs inside the service, so it can't report the
  service being down: use an outside uptime monitor on `/v1/status`
  (DEPLOY.md, section 8).
- Rate limits count per visitor address; a determined attacker with many
  addresses is slowed by the per-business chat limits and the daily AI
  budget, not stopped.
