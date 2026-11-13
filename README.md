# Bila Matata

The home of **Bila Matata**, an AI, software development, data analysis and
research studio in Mombasa, and of **Zaina AI**, its 24/7 sales and booking
concierge for businesses.

One Node service serves everything on `bilamatata.co.ke`:

| Address | What it is |
|---|---|
| `/` | The studio's home page: Zaina AI, pricing, services, contact |
| `/terms` | Terms of service and privacy |
| `/pay` | Pay a studio invoice by M-Pesa or card (Paystack) |
| `/app/` | The dashboard: clients' teams, and the studio's own admins |
| `/api/zaina/*` | Zaina's public API (the chat widget and embeds use it) |
| `/zaina.js` | The chat widget: one script tag on any website |
| `/api/paystack/webhook` | Paystack's webhook for the studio's own account |

## Adding Zaina to a website

```html
<script src="https://bilamatata.co.ke/zaina.js" data-business="your-business-id" async></script>
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
