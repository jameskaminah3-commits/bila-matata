# Deploying bilamatata.co.ke

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
3. **Project Settings → Database → SSL Configuration:** download the
   certificate (its text goes into Railway below) and turn on **Enforce SSL**.
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

1. `/app/` → **Platform** → **Studio invoices** → **New invoice**. Fill in a
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

## 4. Email (receipts, invoice links, password links)

1. Create a [Resend](https://resend.com) account and verify
   `bilamatata.co.ke` (it gives you DNS records to add).
2. Set `RESEND_API_KEY` and `ALERT_FROM_EMAIL=Bila Matata <hello@bilamatata.co.ke>`.

Without email the site and payments still work; receipts and "Forgot your
password?" are off.

## 5. The domain

1. Railway → the service → **Settings → Networking → Custom Domain** →
   `bilamatata.co.ke` (and `www.bilamatata.co.ke` if you want it). Railway
   shows the DNS record to create.
2. At your registrar's DNS:
   - `www` → **CNAME** to the target Railway shows.
   - The bare domain (`bilamatata.co.ke`) can't take a plain CNAME. Use your
     DNS host's **ALIAS / ANAME / CNAME flattening** record to the same
     target. If your registrar has none, move the domain's DNS to Cloudflare
     (free), which flattens automatically; set the record to **DNS only**
     until Railway shows the certificate as issued.
3. When Railway shows the domain as active, change
   `PUBLIC_BASE_URL=https://bilamatata.co.ke` and redeploy.
4. Update Paystack's webhook URL to
   `https://bilamatata.co.ke/api/paystack/webhook`.

The studio's own chat is already allowed on `https://bilamatata.co.ke` and
`https://www.bilamatata.co.ke`.

## 6. Search engines

In Google Search Console, add `bilamatata.co.ke` and submit
`https://bilamatata.co.ke/sitemap.xml`. The home page, `/terms` and `/pay`
are indexable; invoices, the dashboard and the APIs are not.

## 7. Zaina for a client

1. `/app/` → **Platform** → **Add a business**: its id, name, website
   address(es) and first owner.
2. The owner signs in, loads their catalogue, prices and policies, and
   (Full plan) connects **their own** Paystack or M-Pesa account under
   Settings → Bookings & payments.
3. Their website gets one line:

   ```html
   <script src="https://bilamatata.co.ke/zaina.js" data-business="<their id>" async></script>
   ```

4. Their plan: **Platform → Billing → Add a plan** for each of the two
   plans (Starter Sales Concierge KES 6,700 a month; Full Booking & Quote
   Engine KES 11,000 a month). Monthly invoices then go out by themselves
   and are paid from the client's dashboard. Bill the set-up fee as a studio
   invoice (service: **Zaina AI set-up**).

## Optional, later

| What | Variables |
|---|---|
| Alerts on staff phones | `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` (`npx web-push generate-vapid-keys`) |
| WhatsApp | `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`; webhook `https://<domain>/v1/whatsapp/webhook` |
| Google Calendar for clients | `PLATFORM_GOOGLE_CLIENT_ID`, `PLATFORM_GOOGLE_CLIENT_SECRET` |
| Businesses signing up by themselves | `PLATFORM_SIGNUP=open` (needs email), `PLATFORM_TERMS_URL=https://bilamatata.co.ke/terms` |
| A staging site that embeds clients' chats | `EXTRA_ALLOWED_ORIGINS=https://staging.example.com` (staging only) |
