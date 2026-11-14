# Zaina roadmap

What Zaina is, the rules every phase keeps, and the phases in order. Update
the status column as phases land.

## What Zaina is

A digital receptionist and customer representative who works inside each
client's business. She sits in front of the business's own digital face (a
floating chat box on its website or app, its WhatsApp number), and where a
business has no digital face she gives it one (its own QR code and link).
She is informed by what the business really does: its own system where it
has one, and what its team tells her where it doesn't.

## Rules every phase keeps

1. **Zaina never collects or holds money for a business.** When a payment is
   due she sends the business's own payment link or M-Pesa prompt. The money
   goes straight to the business's own account, paybill or till, and a
   booking is marked paid only when that gateway confirms it or the business
   marks it. The platform-subaccount path stays in the code but is off unless
   the studio turns it on for a specific business that needs it.
2. **She fits the business; she doesn't change how it runs.** The client
   keeps its WhatsApp, calendar, website, checkout and way of working.
3. **She never invents.** Prices, availability, stock and policies come from
   the business's own data. When she can't confirm something she says so and
   brings in the team.
4. **She is a team member with a persona and a face,** honest about being an
   AI when sincerely asked.
5. **No other AI product or company is named** in anything a client or
   customer reads.
6. **Premium and effective.** Every feature justifies its price; every screen
   works on a phone, a tablet and a desktop; nothing ships untested.
7. Studio invoices stay software-only. No invented reviews, numbers or
   guarantees. Local test data only.

## Phases

| # | Phase | What gets built | Done when | Status |
|---|---|---|---|---|
| 0 | Principles and alignment | Wording everywhere says Zaina sends the business's own payment link. Zaina's own instructions say she is the receptionist, never the cashier. Subaccount path off unless the studio enables it for a business. | Nothing we ship implies we hold anyone's money. | Done |
| 1 | Reach and brand | A QR front door per business (`/c/<business>`), printable poster, table cards and stickers, scan and chat counts. A branding profile the business controls (logo, cover, colour, welcome line, Zaina's face or its own logo), applied to the chat box, the QR page and the payment page. | A business with no website puts a QR on its counter and customers chat with a Zaina that looks like that business. | Done, except branded emails: emails are still plain text with the business's name (logo and colours need HTML emails) |
| 1b | Premium QR and business cards | Branded QR (colour, logo, rounded modules) that stays readable; printed codes that never change and send scans to the page, the website (chat open) or WhatsApp; premium business cards in three designs, printed at home or by the studio. | A business hands out a card and every scan reaches its Zaina. | Done |
| 2 | Knowledge that matches the business | Industry playbooks (stays, salon, restaurant, clinic, shop, services) in Zaina's instructions; a setup interview per industry, written up as knowledge; answer-once-and-learn on Unanswered questions; weekly website re-read. | A client with a notebook and a WhatsApp number is live in a day. | Done |
| 3 | Receptionist work without a calendar | Request-to-book with one-tap Confirm or Decline. "Mark dates full" on a phone. Out-of-catalogue requests logged and routed. Callback scheduling. | A guesthouse with no calendar takes bookings and the owner confirms in one tap. | Done: Accept/Decline links in the request email (signed per person, three days, opening changes nothing); "We're full" on Bookings; `pass_request_to_team` and `schedule_callback` land in Leads with reminders when a call is due |
| 4 | Integration: Zaina inside their system | A signed connector contract and a dashboard page to connect a client's system. Live catalogue and stock, calendar and order write-back, order status, logged-in customer identity, events out, hand-off into the store's own checkout. Read-only first. | Zaina quotes from the client's live system and a booking or order appears there. | Done: contract in docs/INTEGRATION.md (signed POST, six actions, events out, signed-in customer token); studio switch per business; Settings → Your system (address, secret shown once, choices, test, recent requests); writes off until allowed |
| 5 | Prove it | The owner's e-commerce build first, then the other pilot businesses. Weekly review of real chats. The real model tested on hard conversations. Outcomes measured honestly. TBM only with approval, read-only. | Pilots run for weeks with measured results and fixes made. | Planned |
| 6 | The team's playbook | An onboarding manual with four client paths, a per-client tracker and acceptance test in the studio dashboard, support runbooks. | A new team member can onboard a client by following it. | Planned |
| 7 | Premium hardening and launch | Performance budget, accessibility, security and privacy review, backups and monitoring, load test, status page, social-preview image, packaging for an integration tier. | The platform is fast and polished, and a failure alerts the studio before a client. | Planned |

## What already exists (before phase 0)

- Floating chat box (one script line) and WhatsApp channel.
- Starter and Full tiers, enforced; plans and invoices; support desk.
- Rooms, services, schedule, price list, bookings, deposits by the business's
  own Paystack account or M-Pesa paybill/till.
- Knowledge from typing, PDFs and a website read; Unanswered questions list.
- Google Calendar and iCal busy times in; confirmed bookings out to Google.
- Persona, face, notification emails by plan, team take-over, leads.
