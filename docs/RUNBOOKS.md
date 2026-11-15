# Runbooks

What to do when something goes wrong, for the Bila Matata team. Each one:
how you'll notice, what to check, what to do. Start every incident by
writing a line in the client's support thread so they know you're on it,
and finish it by writing what happened and what changed.

Where to look first: `/app/` → Bila Matata → **Overview** (failed replies,
waiting chats, last activity per business), the service's logs on Railway,
and `GET /v1/health`.

## An alert email: "[Zaina] Not working properly" or "Down"

- **Read the line under the check's name.** *database: answered in … ms*
  means it answered but slowly (over 1.5 s on an open connection): usually
  the database provider being busy, or the service and the database in far
  apart regions. *no answer* means it's down: check the database provider's
  status page and the service's logs.
- *replies: n of m failed* is Zaina's AI model: see "Zaina's replies fail"
  below. *background: …* names the job that's stuck or failing.
- A "Back to normal" email follows on its own when it recovers. Right after a
  deploy, one slow check can happen; an alert needs two bad checks in a row.

## The chat doesn't appear on a client's website

- **Check:** Settings → Website widget for that business: is their site's
  exact address (with or without `www`) in the list? Is the script line on
  the page, with the right `data-business`? Is the business paused
  (Businesses)?
- **Their site's security policy** may block scripts from other sites: the
  browser console says so. Their developer adds our domain to
  `script-src` and `connect-src`.
- **Fix** the address or the line; changes apply within a minute.

## Zaina's replies fail ("Sorry, I couldn't answer that just now")

- **Notice:** Overview → failed replies in the last 24 hours, or the
  client tells you.
- **Check** the logs for model errors: a rate limit, an expired or wrong
  model key, or the model provider down. Check the business's daily
  budget (Overview → tokens today against its cap).
- **Fix:** a key or quota problem in Railway's variables, then redeploy.
  A provider outage: tell affected clients their customers are seeing
  the "send it again" message and their team gets the chats; nothing is
  lost. A budget cap reached: raise it for the business if the use is real.

## WhatsApp messages aren't delivered

- **Check** Settings → WhatsApp for the business: status, and the
  delivery errors on the chat in the Inbox. Expired tokens and numbers
  that are no longer registered show there.
- **Fix:** the owner reconnects WhatsApp in Settings. Customers who
  haven't written for 24 hours can only receive approved templates: the
  team replies by phone or starts with the follow-up template.

## A deposit was paid but the booking still says unpaid

- **Check** the payment in the business's **own** payment account
  (they look; never ask for their login). On Bookings, open the booking:
  the payment attempts and their status are listed.
- **Fix:** if their account shows it paid, the team marks it paid on the
  booking (Record a payment). Then find out why the confirmation didn't
  arrive: their payment settings under Settings → Bookings & payments, or
  the gateway's callback to us in the logs.

## Calendar busy times aren't showing up

- **Check** Settings → Calendars: last read and any error per calendar.
  Google: access revoked shows as disconnected. iCal: a channel changed
  its link, or the link returns an error.
- **Fix:** the owner reconnects Google, or pastes the new iCal link. Until
  then, use **We're full** on Bookings for the affected nights.

## Their own system isn't answering (connected clients)

- **Notice:** Settings → Your system shows a last problem; Zaina tells
  customers she can't check right now.
- **Check** the message: *refused Zaina's signature* means the secret was
  changed on one side only; *took too long* or *HTTP 5xx* is their system;
  *couldn't be found* or *not on the public internet* is the address.
- **Fix:** the developer updates the secret or fixes their endpoint; the
  manager presses **Test the connection**. To stop Zaina asking a broken
  system at once: untick the actions, or Disconnect. Their system is never
  changed by disconnecting.

## A client says Zaina said something wrong

1. Find the chat: Bila Matata → Review (show All), or the client's Inbox.
2. Mark it **Something to fix** with what went wrong.
3. Fix the cause: wrong or missing facts → Knowledge or the setup
   interview; a price → Prices or Rooms; a rule broken (named another AI,
   asked for a PIN, promised a discount) → add a scenario to
   `src/eval/checks.ts`, fix the instructions, and run `npm run eval` until
   it's clean.
4. Mark it fixed with what changed, and tell the client.

## A customer asks for their data to be deleted

The business's manager (or the studio, as a platform admin) deletes the
customer's chats and details by email or phone through
`POST /v1/staff/businesses/<id>/erase` (`{ "email": … }` or
`{ "phone": … }`). Confirm to the customer through the business. Bookings
the business must keep for its records are kept with the contact details
removed.

## A business hasn't paid

Monthly invoices go out by themselves; after the grace period an unpaid
business is paused and Zaina stops answering for it. Before that happens,
contact the owner. Once paid, the business resumes by itself; or resume it
from Businesses after agreeing a payment by hand.

## A client user can't sign in

They use **Forgot your password?** on the sign-in page (the email goes to
their address only). A manager can add or remove team members under Team.
Never set or send a password for them.

## A deploy went wrong

- Railway deploys `main`; migrations run on deploy and only ever add.
- **Roll back** by redeploying the previous deployment in Railway. A
  migration that already ran stays (it only added columns or tables), so
  the older code still works.
- If data was damaged: restore the database from its daily backup to a new
  database, compare, and copy back only what's needed. Tell affected
  clients what happened and what was restored.

## Rotating the secrets key

Set the new key as `PLATFORM_SECRETS_KEY` with a new `PLATFORM_SECRETS_KEY_ID`,
and keep the old one in `PLATFORM_SECRETS_OLD_KEYS` (`id:key`). New secrets
use the new key; old ones stay readable. Never remove an old key while rows
still use it.
