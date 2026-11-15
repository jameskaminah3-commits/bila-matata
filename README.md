# Bila Matata

The home of **Bila Matata**, an AI, software development, data analysis and
research studio in Mombasa, and of **Zaina AI**, its 24/7 sales and booking
concierge for businesses.

One Node service serves everything on `bilamatata.com`:

| Address | What it is |
|---|---|
| `/` | The studio's home page: Zaina AI, pricing, services, contact |
| `/terms` | Terms of service and privacy |
| `/start` | Book a free consultation or ask for a Zaina plan: lands in the studio's dashboard |
| `/pay` | Pay a studio invoice by M-Pesa or card (Paystack) |
| `/app/` | The dashboard: clients' teams, and the studio's own admins |
| `/api/zaina/*` | Zaina's public API (the chat widget and embeds use it) |
| `/zaina.js` | The chat widget: one script tag on any website |
| `/api/paystack/webhook` | Paystack's webhook for the studio's own account |

## Adding Zaina to a website

```html
<script src="https://bilamatata.com/zaina.js" data-business="your-business-id" async></script>
```

The chat only opens on websites the business has allowed (Dashboard →
Settings → Website widget). `window.Zaina.open()` opens it from your own
button.

## Layout

```
src/
  app.ts               routes and background jobs
  studio/              the site: home, terms, /pay, the studio's invoices
  checkout/            a reusable Paystack checkout (see its README)
  gateway/ engine/     the chat API and the assistant
  connectors/          what a business sells: general, appointments, rooms
  booking/ payments/   bookings, and payments into each business's own account
  billing/             Zaina's plans, subscriptions and monthly invoices
  console/ staff/      the dashboard's API and sign-in
web/
  widget/              the chat widget (/zaina.js)
  console/             the dashboard (/app/)
migrations/            the database, as reviewed SQL
knowledge/bilamatata/  what the studio's own Zaina knows (imported at each release)
assets/                the share image
test/                  unit, database and end-to-end tests
```

## Running it locally

Needs Node 20 to 23 and PostgreSQL 14 or later.

```bash
npm install
cp .env.example .env        # fill in the required values
npm run build:web           # the widget and the dashboard
npm run dev                 # http://localhost:5070
```

Create yourself an admin, then sign in at `/app/`:

```bash
STAFF_PASSWORD='choose-one' npm run staff:create -- --email you@example.com --name "You" --platform-admin --business bilamatata --role owner
```

## Tests

```bash
npm run check               # types: service and dashboard
npm test                    # unit tests, no database
PLATFORM_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/zaina_platform_test npm run test:db
PLATFORM_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/zaina_platform_test npm run test:e2e
```

The database tests empty the database they are given, so they only accept a
local one. End-to-end tests run the real service against stand-ins for the
model, Paystack, M-Pesa, WhatsApp, Google and email: nothing leaves the
machine and no money moves.

## Plans: Starter and Full

A business is on one of two tiers, and Zaina and the dashboard obey it:

- **Starter**: Zaina answers from the business's own information, quotes its
  price list, takes leads and hands over to its team.
- **Full**: everything in Starter, plus live availability, exact totals,
  bookings, checkout and calendar sync.

The studio sets the tier when it adds a business (dashboard → Bila Matata →
Businesses), either with a plan (monthly invoices go out by themselves; the
plan's one-off set-up fee is billed as a studio invoice) or by hand. On
Starter, Zaina has no booking tools and the team can't add rooms, services
or bookings (`src/billing/tier-gate.ts`, `workingType` in `src/db/schema.ts`).

## Zaina on a team, and who hears about chats

- **Persona.** Zaina joins each business as a team member with a role (a
  default that fits its type, or one the business sets in Settings). Her
  voice and identity rules are in `src/engine/concierge.ts` and
  `src/engine/persona.ts`: she says "we", never calls herself a generic bot,
  never claims to be human, and answers honestly if sincerely asked. Her face
  is one original illustration (`src/brand/zaina-face.ts`) used by the site,
  the chat widget and the dashboard.
- **Notification emails.** Settings → Notifications lets a business add the
  addresses that are told about its chats: alerts with a take-over link,
  written-out conversations, or both. The number allowed follows the plan
  (Starter 2, Full 5; a plan's `notification_emails` overrides it). They are
  sent through the same email setup as everything else (Resend), so without
  `RESEND_API_KEY` nothing is sent (`src/notifications/`).

## A front door and a brand for every business

- **Front door.** Every live business has a page of its own at
  `/c/<business id>`: its name, logo and colours, and its Zaina filling the
  page (the same widget, `data-mode="page"`). A QR code opens it
  (`/c/<business id>/qr.svg`, and Settings → QR code & link, which also prints
  a poster, table cards and stickers and shows scans and chats by day). The
  service's own address is an allowed origin for every business for this
  page (`setFrontDoorOrigins`). `src/frontdoor/`.
- **Printed codes and business cards.** Printed codes carry a short address
  that never changes (`/q/<id>`, and `/k/<id>` on business cards). Each scan is
  counted, then sent wherever the business chooses (Settings → QR code & link):
  its page here, its website with the chat open (`#zaina`, only when the chat
  is allowed there), or its WhatsApp (only when connected to Zaina). The code
  is branded (its colour, darkened if too light to scan, and its logo in the
  centre with the highest error correction) or classic. Settings → Business
  cards (included with an active plan, `src/cards/`): the server draws each
  side as an exact vector picture, with text set as outlines in Plus Jakarta
  Sans and Fraunces (SIL OFL, from npm), so it looks the same everywhere;
  three designs; 3 mm bleed and a 6 mm safe area. The dashboard makes the
  files from those pictures (`web/console/card-export.ts`): an A4 PDF of ten
  with cut marks, a print-shop PDF with bleed and trim box at 600 dpi, PNGs,
  and a share picture. The studio can print them as a service (a support
  conversation).
- **Brand.** Settings → Brand: logo and cover (PNG, JPEG or WebP, checked by
  their bytes, kept in the database inside the business and served from
  `/brand/<business id>/<logo|cover>`), colour, welcome line, and whether the
  chat shows Zaina's face or the logo. Applied to the widget, the front door
  and the booking payment page. `src/brand/`.
- **Money.** Zaina never collects or holds money: customers pay the
  business's own account. Being paid through a subaccount of the platform's
  account is off unless the studio turns it on for a business (Plan →
  "Let this business be paid through our payment account").

See `docs/ROADMAP.md` for the phases, `docs/INTEGRATION.md` for connecting a client's own system (the contract their developer builds to), `docs/ONBOARDING.md` for setting up a new client, `docs/PILOTS.md` for running pilots and `docs/RUNBOOKS.md` for when something goes wrong.

## Support

A business's team asks for help from its dashboard (Help & support); the
studio answers from its own (Bila Matata → Support). Each side is emailed
about the other's message (`src/support/`).

## Payments: who is paid for what

- **Bila Matata's own sales** (Zaina plans and set-up, software, automation,
  data and research work) are paid into Bila Matata's Paystack account:
  `PLATFORM_PAYSTACK_SECRET_KEY`. Monthly plans are paid from the dashboard;
  everything else on `/pay`, by invoice.
- **A client's customers** pay the client: each business connects its own
  Paystack or M-Pesa account in its dashboard, and deposits go straight there.
- The checkout code is reusable for other businesses, each with its own
  Paystack account and keys: see [`src/checkout/README.md`](src/checkout/README.md).

## Deploying

See [`DEPLOY.md`](DEPLOY.md): Supabase for the database, Railway for the
service, the domain, Paystack and email.
