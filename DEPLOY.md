# Deploying bilamatata.com

One service on **Railway**, one database on **Supabase**. This is separate
from Tembea Bila Matata in every way: its own repository, service, database,
domain and Paystack account. Nothing here touches TBM.

Secrets (database passwords, Paystack keys, API keys) only ever go into
Railway's **Variables**. Don't paste them into chats, issues or commits.

## 1. The database (Supabase)

1. **New project** in Supabase:
   - **Name:** `bila-matata`.
   - **Database password:** generate one and keep it in your password manager.
   - **Region:** the closest to your Railway region.
   - **Plan:** a live service needs Pro (free projects pause after a week
     without use and have no backups). Free is fine for staging.
2. Click **Connect** and copy the **Session pooler** connection string:

   ```
   postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```

   Use the session pooler (port 5432). The service refuses the transaction
   pooler (port 6543).
3. **The database's SSL settings.** In the left sidebar click **Database**,
   then **Settings** (or open
   `https://supabase.com/dashboard/project/_/database/settings` and pick the
   project; on older dashboards it is **Project Settings → Database**,
   `https://supabase.com/dashboard/project/_/settings/database`). Scroll to
   **SSL Configuration**:
   - **SSL Certificate → Download certificate.** It saves a file such as
     `prod-ca-2021.crt`. Open it in a text editor (Notepad, TextEdit) and
     copy everything from `-----BEGIN CERTIFICATE-----` to
     `-----END CERTIFICATE-----`: that text goes into Railway below.
   - **Enforce SSL on incoming connections:** turn it on and confirm. The
     database restarts once, for a few seconds.

   Both are optional for a first staging deploy. Without the certificate the
   connection is still encrypted; the release log warns that the server's
   certificate isn't checked until `PLATFORM_DATABASE_CA` is set.
4. **Project Settings → Data API:** turn it off. The service doesn't use it.

The first release creates every table, the restricted `zaina_app` role, the
studio's own business (`bilamatata`), its price list and what its Zaina knows.

## 2. The service (Railway)

1. **New Project → Deploy from GitHub repo →** `jameskaminah3-commits/bila-matata`.
   Railway reads `railway.json`: build, release step, start command and
   health check (`/v1/health`).
2. **Settings → Networking → Generate Domain.** This `…up.railway.app`
   address is your **staging link**.
3. **Variables** (Raw Editor), with your own values in place of `<…>`:

   ```
   PLATFORM_DATABASE_URL=postgresql://postgres.<project-ref>:<database password>@<pooler host>:5432/postgres?sslmode=require
   ZAINA_APP_DB_PASSWORD=<letters and digits only, 32 or more>
   PLATFORM_APP_DATABASE_URL=postgresql://zaina_app.<project-ref>:${{ZAINA_APP_DB_PASSWORD}}@<pooler host>:5432/postgres?sslmode=require
   PLATFORM_DB_POOL_MAX=6
   SESSION_TOKEN_SECRET=<random, 48 characters or more>
   PLATFORM_SECRETS_KEY=<output of: openssl rand -base64 32>
   GEMINI_API_KEY=<your Google AI Studio key>
   PUBLIC_BASE_URL=https://<the Railway domain from step 2>
   PLATFORM_ADMIN_EMAIL=<your email>
   PLATFORM_ADMIN_PASSWORD=<a starting password: 10+ characters, letters and digits>
   ```

   Add **`PLATFORM_DATABASE_CA`** as its own variable (**+ New Variable**)
   and paste the certificate's whole text.

   - If the database password has symbols, percent-encode them (`@` → `%40`).
   - **Keep `PLATFORM_SECRETS_KEY` safe.** Clients' encrypted payment keys and
     WhatsApp tokens can't be read without it, even from a backup.
   - `PUBLIC_BASE_URL` is what makes the home page's own Zaina work on that
     address, and what invoice links and Paystack's return address use.
4. **Deploy.** The release log shows the migrations, `zaina_app can sign in`,
   the admin account and `studio knowledge: 5 document(s)`.
5. Open the staging link. You should see the home page with the chat bubble
   bottom-right. Sign in at `/app/` with `PLATFORM_ADMIN_EMAIL`, change the
   password, then delete the `PLATFORM_ADMIN_PASSWORD` variable.

If the release step fails, the log says what to check:

| Message | What to check |
|---|---|
| `transaction pooler (port 6543)` | Use the session pooler address (port 5432) |
| `the user name ends with the project` | The user is `postgres.<project-ref>` or `zaina_app.<project-ref>` |
| `Tenant or user not found` | The user name and the pooler host's region |
| `password authentication failed` | The database password in `PLATFORM_DATABASE_URL` |
| `certificate wasn't accepted` | `PLATFORM_DATABASE_CA` is this project's certificate |

## 3. Paystack, in test mode first

Use **Bila Matata's own Paystack account**: the one registered for the
studio and what it sells (Zaina AI subscriptions, software, automation, data
analysis and research). Other businesses use their own accounts.

1. Paystack dashboard → switch to **Test Mode** → **Settings → API Keys &
   Webhooks**.
2. Copy the **Test Secret Key** into Railway as
   `PLATFORM_PAYSTACK_SECRET_KEY` (it starts `sk_test_`).
3. Set the **Test Webhook URL** to
   `https://<your domain>/api/paystack/webhook`. (No callback URL is needed;
   each payment carries its own.)
4. Optional: `STUDIO_NOTIFY_EMAIL=<where you want "invoice paid" notes>`.
5. Redeploy.

**Testing the sandbox flow:**

1. `/app/` → **Bila Matata** → **Studio invoices** → **New invoice**. Fill in a
   client, a service, what it's for and an amount; **Create invoice**; then
   **Copy link**.
2. Open the link (`/pay/BM-XXXXXXXX`), or go to `/pay` and type the
   reference. The page shows a **Test mode** notice.
3. Enter an email, **Pay**, and on Paystack's page use a
   [test card](https://paystack.com/docs/payments/test-payments/) (for
   example `4084 0840 8408 4081`, any future expiry, CVV `408`) or the test
   M-Pesa option.
4. You come back to the invoice marked **Paid**, and the dashboard shows it
   paid with Paystack's receipt number.
5. To check the webhook on its own: pay, then close Paystack's success page
   without returning. The invoice still turns paid within a minute.

**Going live:** once Paystack has approved the account, replace the key with
the **Live Secret Key** (`sk_live_…`), set the **Live Webhook URL** to the
same address, and redeploy. The test notice disappears.

## 4. Email: receiving and sending as hello@bilamatata.com

**Receiving** (free, Cloudflare): Cloudflare → bilamatata.com → **Email →
Email Routing** → *Enable*. Add the records it offers (it adds them for you),
then a custom address `hello@bilamatata.com` → your own inbox, and confirm the
email it sends you. Mail to hello@ now reaches you.

**Sending** (receipts, password links, alerts):

1. In [Resend](https://resend.com) → **Domains** → *Add domain* →
   `bilamatata.com`. Resend lists a few records (a DKIM `TXT` named like
   `resend._domainkey`, and an `MX` and `TXT` on a `send` subdomain). In
   Cloudflare → **DNS → Records**, add each exactly as shown, as **DNS only**
   (grey cloud). Back in Resend, press *Verify*.
2. Add `_dmarc` as a `TXT` record: `v=DMARC1; p=none; rua=mailto:hello@bilamatata.com`.
   After a few weeks of clean reports, change `p=none` to `p=quarantine`.
3. In Railway → Variables: `ALERT_FROM_EMAIL=Bila Matata <hello@bilamatata.com>`
   (keep `RESEND_API_KEY`), and `STUDIO_NOTIFY_EMAIL` to the inbox that should
   hear about payments and problems.

Without email the site and payments still work; receipts and "Forgot your
password?" are off, and so are the notification emails a business adds in
Settings (alerts with take-over links, conversation transcripts).

## 5. The domain: bilamatata.com on Cloudflare, in front of Railway

The service answers on **bilamatata.com**. Railway gets only that one custom
domain; Cloudflare sends `www.bilamatata.com` to it by itself. The service's
own Railway address (`…up.railway.app`) stays: QR codes, business cards and
chat snippets made before the move point at it. Its pages redirect to
bilamatata.com; the chat, its script and webhooks keep answering there, so
nothing already handed out breaks.

**A. Point the domain at Railway** (grey cloud first, so the certificate can be issued)

1. Railway → the service → **Settings → Networking → Custom Domain** → add
   `bilamatata.com`. Railway shows the records to create (a `CNAME` target,
   and sometimes a `TXT` to verify).
2. Cloudflare → bilamatata.com → **DNS → Records**:
   - Each record exactly as Railway shows it. For the bare domain use name
     `@`: Cloudflare accepts a `CNAME` there (it flattens it). **DNS only**
     (grey cloud) for now.
   - `www`: type `CNAME`, target `bilamatata.com`, **Proxied** (orange cloud).
3. Cloudflare → **Rules → Redirect Rules** → *Create rule* → use the template
   **Redirect from WWW to root** (or: when hostname equals
   `www.bilamatata.com`, dynamic redirect to
   `concat("https://bilamatata.com", http.request.uri.path)`, status 301,
   preserve query string). Deploy it.
4. Wait until Railway shows `bilamatata.com` as active with a certificate
   (usually minutes, sometimes up to an hour).

**B. Turn on Cloudflare's protection**

1. **SSL/TLS → Overview**: encryption mode **Full (strict)**. Never
   *Flexible* (it loops redirects).
2. Switch the `@` record to **Proxied** (orange cloud). The email records
   stay as they are (Email Routing's are locked; Resend's are grey).
3. **SSL/TLS → Edge Certificates**: *Always Use HTTPS* **on**, *Minimum TLS
   Version* **1.2**, *Automatic HTTPS Rewrites* **on**. Leave Cloudflare's
   HSTS off: the service already sends it.
4. **DNS → Settings**: **DNSSEC** → *Enable* (one click, the domain is
   registered at Cloudflare).
5. **Security → WAF**: turn on the free **Cloudflare managed ruleset**.
   Security level: *Medium*. Leave **Bot Fight Mode off**: it challenges
   payment and WhatsApp webhooks and the chat's own requests, and on the free
   plan it can't be told to skip them. The service has its own rate limits.
6. **Scrape Shield → Email Address Obfuscation**: **off**, and don't turn on
   Rocket Loader or automatic Web Analytics: they inject scripts the site's
   security policy blocks (an email address would show as "[email protected]").
7. If Railway ever shows a certificate warning (renewal), set the `@` record
   back to grey for a few minutes, then orange again.

**C. Tell the service its new address** (Railway → Variables, then redeploy)

```
PUBLIC_BASE_URL=https://bilamatata.com
REDIRECT_HOSTS=<the service's own address, e.g. bila-matata-production.up.railway.app>
CLIENT_IP_HEADER=cf-connecting-ip
PLATFORM_TERMS_URL=https://bilamatata.com/terms   (only if you set it before)
```

- `REDIRECT_HOSTS`: that address's pages move permanently to bilamatata.com
  (the chat API, the widget script and webhooks keep working on it).
- `CLIENT_IP_HEADER`: tells visitors apart behind Cloudflare. Requests that
  reach the Railway address directly could pass a made-up visitor address;
  that only affects the per-visitor limits (the per-business limits and the
  daily AI budget still hold). Once nothing uses the Railway address any more,
  remove it (Settings → Networking) and every request comes through Cloudflare.
- If you also own another domain (bilamatata.co.ke), add it to Cloudflare as
  its own site and make one Redirect Rule sending everything to
  `https://bilamatata.com` with the same path. Railway needn't know about it.

**D. Update the services that call back**

- **Paystack** (the studio's own account) → Settings → API Keys & Webhooks →
  webhook URL `https://bilamatata.com/api/paystack/webhook` (test and live).
  Clients' own Paystack webhooks keep working on the old address; their
  dashboards now show the new one, to change when convenient.
- **Google Cloud** (Calendar for clients) → OAuth client → *Authorized
  redirect URIs*: add `https://bilamatata.com/v1/calendar/google/callback`
  (keep the old one until it's unused), and add `bilamatata.com` to the
  consent screen's authorised domains.
- **WhatsApp** (your WhatsApp Business developer app) → webhook callback URL
  `https://bilamatata.com/v1/whatsapp/webhook`, same verify token.
- **M-Pesa**: nothing to change; each payment request carries its callback
  address from `PUBLIC_BASE_URL`.

**E. Check it**

- `https://bilamatata.com` loads with a padlock; `http://bilamatata.com` and
  `https://www.bilamatata.com/terms` end at `https://bilamatata.com/…`.
- The Railway address's home page redirects to `https://bilamatata.com/`.
- `https://bilamatata.com/status` says everything is working.
- The chat on the home page answers; a test invoice on `/pay` opens Paystack
  and comes back.
- Point your uptime monitor (section 8) at `https://bilamatata.com/v1/status`.

## 6. Search engines

In Google Search Console, add `bilamatata.com` (a *Domain* property,
verified with the `TXT` record it gives you, added in Cloudflare as DNS only)
and submit `https://bilamatata.com/sitemap.xml`. If the site was ever in
Search Console under its Railway address or another domain, use **Settings →
Change of address** there to tell Google it moved; the permanent redirects
carry its ranking across. The home
page, `/terms` and `/pay` are indexable; invoices, the dashboard and the APIs
are not.

## 7. Zaina for a client

1. `/app/` → **Bila Matata** → **Businesses** → **Add a business**: its id,
   name, what it sells, website address, plan and first owner.
2. The owner signs in, loads their catalogue, prices and policies, and
   (Full plan) connects **their own** Paystack or M-Pesa account under
   Settings → Bookings & payments.
3. Their website gets one line:

   ```html
   <script src="https://bilamatata.com/zaina.js" data-business="<their id>" async></script>
   ```

4. Their plan: the first time, open **Bila Matata → Plans & billing** and
   press **Add the two standard plans** (Starter Sales Concierge, KES 6,700 a
   month with a KES 10,000 set-up fee; Full Booking & Quote Engine, KES 11,000
   a month with a KES 20,000 set-up fee). Then, when you add a business,
   choose its plan and tick **Bill the one-off set-up fee**: the set-up
   invoice is created and emailed to the owner, monthly invoices go out by
   themselves, and the business gets exactly what its plan includes. Change
   a business's plan later with the **Plan** button in its row.

## 8. Knowing it works

- **The studio is emailed** when something stays wrong for two checks in a
  row (database, Zaina's replies failing, a background job stuck or
  failing), and again when it's back to normal. Set `STUDIO_NOTIFY_EMAIL`
  (and email, section 4). The checks run every minute
  (`HEALTH_CHECK_INTERVAL_MS`).
- **An outside uptime monitor** catches the one thing the service can't
  report itself: being down. Point any uptime monitor at
  `https://<domain>/v1/status` every minute; it answers 503 when Zaina is
  down. The public page is `https://<domain>/status`.
- **Backups:** use a database plan with daily backups and point-in-time
  recovery, and restore one into a scratch database once a month to prove
  it works (docs/RUNBOOKS.md, "A deploy went wrong").
- **Before a release:** `npm run build && npm run budget` (what phones
  download stays small), and on staging `npm run load -- --business <test
  business> --base https://<staging>` and `npm run eval` (docs/PILOTS.md).
  Measured locally with the test model: 100 customers at once, 400
  requests, none failed, slowest reply 1.25 s (the platform's own time;
  the AI model's time comes on top).

## Optional, later

| What | Variables |
|---|---|
| Alerts on staff phones | `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` (`npx web-push generate-vapid-keys`) |
| WhatsApp | `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`; webhook `https://<domain>/v1/whatsapp/webhook` |
| Google Calendar for clients | `PLATFORM_GOOGLE_CLIENT_ID`, `PLATFORM_GOOGLE_CLIENT_SECRET` |
| Businesses signing up by themselves | `PLATFORM_SIGNUP=open` (needs email), `PLATFORM_TERMS_URL=https://bilamatata.com/terms` |
| A stronger AI model for Zaina | `ZAINA_MODEL=<model id>`. The default is the fast, low-cost "lite" model. A larger model in the same family reasons better (smarter recommendations, fewer missed details) and costs more per conversation: try one on staging and compare real chats before changing it for everyone |
| A cheaper model near the daily budget | On by default: once a business has used 80% of its daily AI budget, Zaina answers with `gemini-3.5-flash-lite` for the rest of the day instead of stopping at the cap. Change the model with `ZAINA_SAVER_MODEL=<model id>` (or `off`), and the point with `ZAINA_SAVER_AT_PERCENT=<1-100>`. Cost reports price every turn at `MODEL_PRICE_*`, so they overstate days that switched |
| A staging site that embeds clients' chats | `EXTRA_ALLOWED_ORIGINS=https://staging.example.com` (staging only) |
