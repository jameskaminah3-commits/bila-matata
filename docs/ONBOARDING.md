# Onboarding a client

The Bila Matata team's manual for setting Zaina up for a new business, from
the first call to going live. Follow it in order; the **onboarding tracker**
(`/app/` → Bila Matata → Onboarding) shows each client's progress and
checks most steps by itself, so it can't say "done" when it isn't.

Three rules for every client:

- **Fit the business, don't change it.** They keep their WhatsApp, their
  calendar, their checkout and their way of working. Zaina sits in front.
- **Their money goes to them.** Customers pay the business's own payment
  link (their M-Pesa paybill or till, or their own card account). Zaina
  never collects money.
- **API keys are ours to add, never theirs.** Payment keys (Paystack,
  M-Pesa Express), a WhatsApp token typed in by hand, the own-system
  connection and Team → Secrets show only to Bila Matata admins. Add them
  with the client on a call, from their own provider's dashboard: never
  ask for a password, key or token by WhatsApp or email. What they connect
  by signing in (Connect with Facebook, Google Calendar) and their M-Pesa
  number paid by hand stay theirs.
- **Each business its own dashboard.** Add a business with its owner's own
  email, never yours: admins already reach every business from Bila
  Matata → Businesses. A business set up under an admin's account is
  handed over with Businesses → Owner (the admins stop being its members).

## 1. The first call (30 minutes)

Find out which path they're on, and write down the week-0 baseline
(docs/PILOTS.md) while you're there.

| They have | Path | In the tracker |
|---|---|---|
| A notebook and a WhatsApp number, no website | **A. No website** | `notebook` |
| A website, but bookings happen by phone or WhatsApp | **B. Website** | `website` |
| A website or booking channels, and a calendar (Google, or channels with iCal links) | **C. Calendar** | `calendar` |
| Their own online shop or booking system | **D. Their own system** | `system` |

Also ask: what they sell and the prices; what customers ask most; the busy
times; who on the team should hear about leads; and, for the Full plan, how
customers pay a deposit today.

## 2. Add the business (10 minutes)

`/app/` → Bila Matata → Businesses → **Add a business**: its id (short,
lowercase, e.g. `palm-cove`), name, type, website address if any, plan, and
the owner's email. The owner gets an email to choose their own password.
Then open Onboarding and set the path.

## 3. Everything every path needs (one sitting with the owner, about an hour)

Do this together, on the owner's phone if that's what they'll use.

1. **Profile** (Settings → Business): the name customers know, the phone
   number customers should call, a few lines on what they do, the hours.
2. **Brand** (Settings → Brand): logo, colour and a welcome line. Choose
   Zaina's face or their logo for the chat. For their page: the lettering
   (Classic, Roman, Elegant or Modern, matched to the kind of place), menu
   colours (a plain light or dark page reads best; "over your photos" only
   with strong atmosphere photos), and "My logo already shows our name" when
   the logo spells it. A cover photo and section photos carry the rest.
3. **What's on** (dashboard → What's on, or by WhatsApp from a linked
   number: "Karaoke tonight from 8pm"): today's special, tonight's event,
   what's on every week. It shows above the menu on their page, and Zaina
   mentions it to guests. Show the team on day one: it's what keeps Zaina
   sounding like she works there.
3. **Setup interview** (Knowledge → Setup interview): choose the industry
   and answer the questions in their own words. This is what a website
   never says (deposits, cancellations, parking, children, what to bring).
   Five answers is the minimum; all of them is better.
4. **What they offer** (Setup, or Settings → What you offer): tick
   everything customers can ask Zaina for. A business can have several: a
   hotel with rooms, table reservations, spa appointments and airport
   transfers. Rooms, tables and appointments are booked through Zaina (Full
   plan); transfers, activities, orders and quoted jobs are arranged by the
   team: Zaina quotes the price list and passes the request on. Nothing is
   ticked for them: what's usual for their industry is only suggested.
5. **Describe how they work** (same page): the owner writes it in their own
   words ("We offer three types of rooms. Standard rooms accommodate two
   guests. Breakfast is included. Airport transfers are available at an
   additional cost. Reservations require a 30% deposit."). Zaina drafts the
   settings from it. Each item shows the owner's words it came from; a
   price, number or rule they didn't write is left out, never guessed. The
   owner fills in what's missing (how many rooms, the price a night), unticks
   anything wrong and approves. Only then is it saved: room types, services,
   price list lines, the deposit, times, cancellation, and the rest as
   knowledge. Answer the "Still to tell Zaina" list before going live.
6. **What they sell, in full**: check and finish rooms and rates (Rooms),
   services, tables and the schedule (Services), and the price list
   (Prices). Every price Zaina quotes comes from here.
7. **Alerts** (Settings → Notifications): at least one email that gets
   every lead and booking; add team members under Team.
8. **Payments and rules** (Full plan, Settings → Bookings & payments): the owner
   connects **their own** M-Pesa or card account. Test with a small amount.
9. **Try it** (Setup → Try Zaina): the owner asks ten questions their
   customers really ask. Every answer that's wrong or missing gets fixed
   now, in Knowledge or the interview.

### Their rules, not the usual ones

Zaina is told each business's own rules on every message (the deposit to
confirm, any room or service with its own deposit, ways to pay,
cancellation, times) and that they win over what is usual for its kind of
business. Two hotels on the same setup can work differently: one takes
payment in full to confirm, another a 30% deposit. A rule the business
hasn't set is said to be not set, and Zaina says the team will confirm,
rather than describing what most places do. So set the deposit and
cancellation before going live.

## 4. The path

### A. No website

- **Catalogue** (menu): what they sell. The quickest way is **Snap your
  price list**: a photo of their board, menu or written list, read by Zaina
  into items they check before adding. Or **Add an item**: a photo from the
  phone's camera, a name and a price (the rest is optional). Photos are made
  the right size on the phone and kept in the database; Zaina sends a
  customer the photo's link when they want to see an item, and the chat
  shows it as a picture. What's out of stock is one tap; **How many are
  left** (optional) is counted down by each order and given back when an
  unpaid one lapses. Turn on **Orders and delivery** in Settings → What you
  offer, and on Full Zaina takes orders from it, end to end:
  - **Orders → Delivery & settings**: the areas they deliver to, each with
    its fee (0 for free), collection and where, the smallest order, whether
    customers may pay on delivery, whether the team accepts each order first,
    and how long unpaid items are kept (30 minutes unless they choose).
  - **Settings → Payments** (or Bookings & payments): their own M-Pesa till
    or paybill, and Paystack or M-Pesa prompts if the studio connects them.
    Customers pay straight into these; Zaina never takes payment.
  - In the chat: the items, how many, delivery area or collection, and the
    customer's name and phone. The server prices it from the catalogue, adds
    the area's fee, keeps the stock and sends the order's own payment link
    (/pay/o/…). Paying there confirms it; an M-Pesa code waits for the team
    to tick it off. Pay on delivery is confirmed straight away. A price range,
    no way to pay, or "we accept each order first" sends it to the team.
  - **Orders** (Needs you, In progress, Done, Cancelled): accept or decline,
    check codes, then Out for delivery or Ready to collect, and Delivered.
    The customer hears every step by themselves, in the chat (WhatsApp too)
    and by email if they gave one, and can ask Zaina "where's my order?".
- **Customers**: one record per customer, by phone (or email): every chat,
  request, booking and order, what they prefer, what's still open, and a
  **Follow up** list (asked and didn't buy, let something lapse, a past
  customer quiet for two months). The team follows up and marks it done;
  Zaina messages customers first only through **Outreach** (below), as the
  business has set it. Zaina recognises a returning
  customer only on WhatsApp (the number proves who they are) or when they're
  signed in on the business's own site, and keeps lasting preferences they
  tell her there (never health, faith or money matters). In the website
  chat, typing a number shows nobody anything. A manager can turn
  recognition off, and **Forget this customer** handles a deletion request.
- **Reports → Business performance**: show the owner their month. People
  who got in touch, paying customers, **verified** revenue (settled
  payments: by Paystack or M-Pesa, or recorded by their team) kept apart
  from **expected** amounts (pay on delivery, balances at the property),
  what customers ask about and buy, what didn't convert and why, what
  slipped away, repeated questions (teach Zaina the ones she couldn't
  answer), and an estimate of staff time saved. Owners and managers get it
  by email on the 1st of every month.
- **Manage from WhatsApp** (Settings): for an owner who lives on WhatsApp.
  They tap **Link my WhatsApp number** and send the code shown (`LINK
  123456`) from their own phone to the business's number. From then on
  they can write to it like an assistant: "Change the price of chicken to
  450", "We're fully booked tomorrow", "Add a new service: kids' haircut,
  300", "We no longer deliver to Kilimani", "How many orders today?".
  Zaina prepares each change and shows what it affects; **only their YES
  applies it** (within 30 minutes, and only if nothing changed meanwhile).
  Agents can ask but not change. Every change is in the log on that page.
  Customers writing to the same number still reach the customer Zaina.
- **Outreach** (managers): what Zaina sends customers who aren't chatting.
  Go through it with the owner; every message, sent or skipped, is logged
  there with the reason.
  - **Reminders** before a booking or appointment (on from the start, 24
    hours before; 2 to 72).
  - **Follow-ups** (off until turned on): once, on WhatsApp only, to someone
    who asked about prices, items or free times and didn't book, order or
    leave a request, 2 to 20 hours after their last message, while their chat
    is still open and no one from the team has taken it over.
  - **Feedback** (off until turned on): after an order is delivered or a
    visit ends, "reply 1 to 5". A 3 or less becomes a request for the team.
  - **Offers** (off until turned on): only to customers who said yes. Zaina
    asks a WhatsApp customer once, after she's helped them, and keeps the
    answer; the team can record a yes given elsewhere, saying where. A
    manager writes the offer, previews who gets it and how, and approves by
    the exact number. At most one offer a week per customer, never by email.
  - How each goes: by WhatsApp while the customer's chat is open (within 24
    hours of their last message); after that only by a template the business
    created and Meta approved (Meta may charge for these; enter the names
    under *WhatsApp templates*); otherwise reminders and feedback go by
    email, with an unsubscribe link, and offers are skipped.
  - Between 08:00 and 20:00 in the business's time zone, at most one
    message a day per customer (reminders aside), each one once.
  - A customer who replies **STOP** (or ACHA) gets nothing more; **START**
    brings back reminders but not offers, which need a new yes.
- A salon or clinic: **Services** with durations and prices, and
  **Calendars** if they keep one, so Zaina books real free times.
- **QR code & link** (Settings): choose where the code sends people (their
  Zaina page is the usual choice). Download the poster and table cards.
- **Their page shows what they offer.** Once the price list has visible
  items, or there are active rooms, services or tables, their page
  (`/c/<id>`) opens on a catalogue to browse quietly, next to an *Ask
  Zaina* tab: section pills, a *Jump to* list once there are more than four
  sections, a search box, and cards with price, photo (uploaded ones only;
  otherwise the item's initials) and an *Out of stock* badge. Sizes of one
  thing in a section ("Absolut Vodka (750ml Bottle)", "Absolut Vodka
  (Shot)") show as one card with a price for each. The tab is named for
  their industry: *Browse Menu* (restaurant, bar, club), *Rooms & Rates*
  (stays), *Services & Prices* (salon, clinic, services), *Browse
  Catalogue* (anyone else). Tapping a card opens its full description and
  photo; inside are *Ask Zaina about this* and, only where they take orders
  online (or for rooms and services, *Book via Zaina*), *Order via Zaina*.
  Nobody is pushed into the chat: a guest can read the menu and tell their
  waiter. A small *Need a recommendation?* pill can be closed. With nothing
  to show, the page stays the chat alone. Hide an item on the price list to
  take it off the page.
- **Pasting a long list** (Catalogue → *Paste your price list*): one item a
  line, `Name: price`, a line without a price starts a section, and
  `| description` after the price adds what it includes ("Beef samosa: 575
  | 4 pieces, spiced beef"). Give each size its own line with the size in
  brackets. 150 items in 20 sections go in at once.
- **Numbered table cards** (Settings → QR code & link): for a restaurant,
  bar or guesthouse, print one card per table or room ("Table" 1–10, or
  "Room", "Station", …): their colour band with logo, name and welcome
  line, the spot in large letters, "Scan to view our menu" (or what their
  page offers), three steps, and the code in a frame, two to an A4 page
  with a cut line. Each card's code carries its spot
  (`/q/<id>?spot=Table+5`), so Zaina knows where the customer is: an order
  is brought to them there, with no address and no delivery fee, even if
  the business only delivers otherwise; requests and call-backs show the
  spot to the team (Orders and Requests). A code that goes to their website
  passes the spot to the chat there; one that goes to WhatsApp starts the
  message with "I'm at Table 5."
- Every page and printed card says *Powered by Bila Matata*
  (bilamatata.com).
- **Business cards** (Settings): included with their plan. Download the
  print PDF, or the studio prints them as a separate service.
- **Rooms on request** where there's no calendar: the owner accepts or
  declines each request in one tap from the email. Show them **We're full**
  on Bookings for nights that fill up elsewhere.
- WhatsApp (Settings → WhatsApp) if they want Zaina on their number.
- Tracker: *Customers can reach Zaina* ticks itself once the code is
  scanned.

### B. Website

- **Website widget** (Settings → Website widget): *Allow this website*
  (it adds the www and plain address), copy the one line, and follow the
  steps for their builder (WordPress, Wix, Shopify, Squarespace, Webflow,
  Google Tag Manager):
  `<script src="https://bilamatata.com/zaina.js" data-business="<id>" async></script>`
  Then *Check my website*: it says whether the line is on the page and the
  site is allowed. Once a visitor opens a page, the card shows where the
  chat last opened, and any website it was refused on, with *Allow it*.
  An owner reading their website under Knowledge allows it for the chat too.
  Their own "Order" buttons can open the chat with a message:
  `window.Zaina.ask("I'd like to order Masala chips")`. A table's code that
  sends people to the website adds `?zaina_spot=Table+5`, which the chat
  passes on.
- **Knowledge → Read your website**, with *keep in step weekly* on, so
  a change to their site reaches Zaina by itself. A site built with
  JavaScript is read from what it still publishes (its search-engine data,
  sitemap, WordPress pages, WooCommerce or Shopify products); if nothing
  can be read, teach Zaina in Settings → What you offer, or with a
  document or price list.
- Bookings on request (as in A), or time slots for a salon or restaurant.
- **Products on their site or in their shop?** Catalogue → *From your own
  system*: the address of their products' data (WooCommerce
  `/wp-json/wc/store/v1/products`, Shopify `/products.json`, a CSV or Google
  Merchant feed, or any JSON list with a name and price). It's read every
  day, with prices and stock; what the team typed stays. Orders then work
  as in A.

### C. Calendar

As B, plus **Calendars** (Settings): connect Google Calendar, or paste each
booking channel's iCal link, so Zaina never offers what's taken. Confirmed
bookings go back to their Google Calendar.

### D. Their own system

- The studio turns on **Let this business connect its own system**
  (Businesses → Plan).
- Their developer builds to docs/INTEGRATION.md. A TypeScript site (like
  Happyfine's) starts from **zaina-connector.ts** (Settings → Your system,
  or docs/): it fills in search, stock, order status, checkout and placing
  orders from its own database. A Bila Matata admin then enters the address
  in Settings → **Your system**, makes the secret and gives it to the
  developer directly, chooses what Zaina may ask, and presses **Test the
  connection**.
- Read-only first. **Let Zaina write** (place orders and bookings in their
  system) only after a week of correct reads. With orders in their system,
  Zaina says the total and how to pay exactly as their system answers.
- Just want their products read, not a live connection? Use the feed in B.
- The widget on their site, with the signed-in customer token if customers
  log in (order status without asking for a phone number).

## 5. Acceptance test (before going live)

1. The tracker shows every automatic step done.
2. `npm run eval` against a test copy of the business is clean
   (docs/PILOTS.md).
3. The owner's ten real questions are answered right, in their words.
4. A test booking or lead reaches the alert email; a test payment link
   opens **their** checkout.
5. Tick *Acceptance test passed* in the tracker, with a note of what you
   checked.

## 6. Go live, then the first four weeks

- Setup → **Go live** (it's ready once the basics are in). The tracker's
  last step ticks itself.
- Weekly: read the chats (Bila Matata → Review), fix what's wrong, send the
  owner their week (docs/PILOTS.md).
- Anything that breaks: docs/RUNBOOKS.md.
