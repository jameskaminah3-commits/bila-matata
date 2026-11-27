// src/studio/blog/articles.ts
//
// The studio's articles: practical answers to what business owners in Kenya
// search for, each ending with how we help. Written in a small markdown:
// "## " and "### " headings, "- " and "1. " lists, **bold** and [links](/path).
// No invented statistics, no other companies named.

export type Article = {
  slug: string;
  title: string;
  /** For search results and shared links: about 150 characters. */
  description: string;
  category: string;
  /** ISO date (YYYY-MM-DD). */
  published: string;
  updated?: string;
  keywords: string[];
  body: string;
};

export const ARTICLES: Article[] = [
  {
    slug: "reply-to-customers-after-hours",
    title: "How to stop losing customers who message after hours",
    description: "Customers message at night and book with whoever answers first. Four practical ways for a small business in Kenya to answer every enquiry, even when closed.",
    category: "Customer service",
    published: "2026-11-27",
    keywords: ["after-hours enquiries", "WhatsApp replies", "small business Kenya", "customer response time", "AI receptionist"],
    body: `
A customer sends a message at 10 pm: "How much is a room for two this weekend?" or "Do you deliver to Kilimani?". Nobody is at the desk, so the message waits until morning. By then the customer has asked three other businesses and paid the one that answered first.

For most small teams this isn't a staff problem. People go home, phones get busy, and nobody can be online at every hour. The fix is to make sure every enquiry gets a useful answer, whoever is or isn't awake.

## Why late replies cost more than they seem to

A late reply rarely feels like a lost sale, because the customer never says goodbye. They simply stop replying. But the pattern is easy to see when you look at it from their side:

- **They message several places at once.** Comparing prices and availability takes a minute on WhatsApp, so most people ask more than one business.
- **The first clear answer wins.** A complete reply, with a price and a next step, usually ends the search.
- **Repeat questions eat your day.** The same ten questions (price, location, hours, delivery, how to pay) take up time your team could spend serving the customers in front of them.

## Four ways to cover the hours you're closed

### 1. Write down your top 20 questions and answers

Before any tool, collect the questions customers really ask, with the answers your best staff member would give: prices, opening hours, location and directions, delivery areas and fees, how to book, how to pay. This one document makes every reply faster and more consistent, whoever sends it.

### 2. Use saved replies for the common ones

WhatsApp Business lets you save quick replies. Turn your top answers into short, friendly saved messages so the person on duty can answer in seconds instead of typing the same thing again.

### 3. Make your away message useful

"We're closed, we'll get back to you" sends customers elsewhere. A useful away message gives them something to act on: a link to your menu or price list, your opening hours, and how to book or order. If you have a page with your menu or services, link it there.

### 4. Let an AI receptionist answer from your own information

An AI receptionist can read the customer's question, answer it from your own prices and policies, recommend what suits them and take their details for your team, at any hour. The important words are **your own information**: a good one never invents a price, and says so plainly when it doesn't know.

## What a good after-hours answer includes

- **It answers the actual question**, not a generic greeting.
- **It quotes your real price**, straight from your price list.
- **It offers the next step**: a booking, an order, or a time your team will call back.
- **It takes the customer's name and number** if a person needs to follow up, so your team starts the morning with warm leads, not a pile of unread chats.

## What to avoid

- Bots that trap customers in menus of buttons with no way to reach a person.
- Anything that answers from general knowledge instead of your business, because wrong prices or promises go out in your name.
- Away messages that promise a reply time you can't keep.

## How Zaina does it

[Zaina](/#zaina) is the AI receptionist we set up for businesses across Kenya. She answers on your website, your WhatsApp and the QR code on your counter, only from your own information. She recommends what suits each customer, books or takes the order on the Full plan, and hands the conversation to your team whenever a person is needed. You can [ask her anything on our home page](/#faq), right now, and see how she answers.

When you're ready, [see the plans](/#pricing) or [book a free consultation](/start).
`,
  },
  {
    slug: "qr-code-menu-restaurants-kenya",
    title: "QR code menus for restaurants in Kenya: a practical guide",
    description: "PDF or live menu page? What to put on the table card, how to show your M-Pesa till, and how to keep prices right without reprinting anything.",
    category: "Restaurants & hotels",
    published: "2026-11-27",
    keywords: ["QR code menu Kenya", "digital menu restaurant", "QR menu", "restaurant table cards", "M-Pesa till on menu"],
    body: `
A QR code on the table is now the first thing many guests look at in a restaurant, bar or hotel. Done well, it's faster than a printed menu, always up to date and easier to sell from. Done badly, it's a blurry PDF guests have to pinch and zoom while they wait.

This guide covers what makes the difference.

## A PDF behind a QR code vs a live menu page

Many places start by putting their printed menu into a PDF and linking it from a code. It works, but it has real drawbacks:

- **It's slow.** A PDF has to download before anything shows, and it's sized for paper, not a phone.
- **It's hard to read.** Guests pinch, zoom and scroll sideways to find a price.
- **It goes out of date.** Every price change means a new file, and an old copy is often still online.
- **It can't sell.** A PDF can't put today's special or tonight's event where every guest looks first.

A live menu page opens in a moment on any phone, reads like a website, and changes the moment your team changes a price.

## What a good QR menu includes

- **Sections in the order you want**: starters, mains, drinks, the way your kitchen thinks.
- **Every dish with its price**, and a short description that makes it sound as good as it tastes.
- **Search**, so a guest who wants "chicken" or "mocktail" finds it in a second.
- **What's on today** at the top: the special, the happy hour, tonight's live band.
- **Photos** where they help, not on every line.
- **Your brand**: your logo, colours and lettering, so it feels like your place, not a template.
- **How to pay**: your M-Pesa till or Paybill with a copy button, so nobody reads a number wrong.

## Designing the table card

- **One clear instruction.** "Scan for the menu" beats a paragraph of text.
- **Big enough to scan from the seat.** A code about the size of a matchbox or larger scans comfortably from across a small table.
- **High contrast.** Dark code on a light background, with a clear margin around it.
- **Your till number on the card too**, for guests who'd rather pay at the table.
- **Steps for first-timers**: open the camera, point at the code, tap the link.

## Keeping it up to date

The biggest advantage of a live menu is that the printed code never changes while the menu behind it does. Mark a dish as finished tonight, raise the cocktails by 10%, add a new special: guests see it at once, and nothing is reprinted.

## Knowing it works

A good QR menu tells you how many guests scan and open it. That's useful on its own, and it shows which tables, cards or posters actually get used.

## Getting one for your place

Our [Menu plan](/#pricing) is a branded QR menu for restaurants, bars and hotels anywhere in Kenya. Send us a photo of your menu and we set it in your brand, with print-ready posters, table cards and stickers. Your team keeps it up to date in plain words ("the tilapia is finished tonight"), and you can add [Zaina](/#zaina) later on the same page and the same printed code, so guests can ask questions and book a table.

[Book a free consultation](/start) or [ask Zaina about the Menu plan](/#faq).
`,
  },
  {
    slug: "ai-receptionist-vs-chatbot",
    title: "AI receptionist vs chatbot vs auto-reply: what's the difference?",
    description: "Auto-replies, chatbots and AI receptionists all promise to answer customers. Here is what each really does, and six questions to ask before you choose one.",
    category: "AI for business",
    published: "2026-11-27",
    keywords: ["AI receptionist", "chatbot for business", "WhatsApp auto reply", "AI customer service Kenya", "virtual receptionist"],
    body: `
"Let a bot answer your customers" can mean three very different things. Knowing which one you're buying saves money and protects your reputation.

## Auto-reply: one fixed message

An auto-reply sends the same message to everyone, usually "Thanks, we'll get back to you" or your opening hours.

- **Good for:** setting expectations when you're closed.
- **Not good for:** answering anything. The customer still waits for a person, and many don't.

## Basic chatbot: menus and scripts

A basic chatbot follows a script: press 1 for prices, 2 for location. Some newer ones answer in free text, but from general knowledge rather than from your business.

- **Good for:** a handful of fixed questions with fixed answers.
- **Not good for:** real conversations. Customers who don't fit the script get stuck in a loop, and a bot that answers from general knowledge can give a price or a promise you never made.

## AI receptionist: a member of your team

An AI receptionist understands what the customer is asking in their own words, answers only from your information, and moves them toward a booking or an order, the way a good receptionist would.

- **It answers the real question**, even when it's phrased loosely or asks two things at once.
- **It uses only your information**: your price list, your policies, your up-to-date calendar.
- **It recommends**: of three rooms or two packages, it suggests the one that fits this customer and says why.
- **It completes the job**: checks what's free, quotes the exact total, makes the booking or takes the order, and sends your own payment link.
- **It knows when to hand over**: special requests, complaints and VIPs go to your team with the whole conversation.

## Six questions to ask before you choose any of them

1. **Does it answer only from my information?** If it can answer from the internet, it can be wrong in your name.
2. **What happens when it doesn't know?** The right answer is "it says so, and passes the customer to your team".
3. **Can my staff take over a chat at any time?** You should never be locked out of your own conversations.
4. **Does it know what's actually available?** Quoting a room or a slot that's already taken is worse than no answer.
5. **Who receives the money?** Customers should pay you directly, into your own M-Pesa or account.
6. **Does it speak the way my customers do?** In Kenya that usually means English and Swahili.

## Where Zaina fits

[Zaina](/#zaina) is an AI receptionist, set up by our team for your business. She works on your website, WhatsApp and your QR code page, answers only from your information, and never invents a price. On the Full plan she checks your calendar, quotes exact totals, books and sends your own payment link; on Starter she answers, recommends and hands every lead to your team.

The quickest way to judge her is to talk to her: [ask Zaina anything on our home page](/#faq). Then [compare the plans](/#pricing).
`,
  },
  {
    slug: "business-website-cost-kenya",
    title: "How much does a business website cost in Kenya?",
    description: "What actually drives the price of a website in Kenya, the ongoing costs to plan for, and how to get an accurate quote before you pay anything.",
    category: "Websites & apps",
    published: "2026-11-27",
    keywords: ["website cost Kenya", "business website price Kenya", "e-commerce website Kenya", "web design Kenya", "website with M-Pesa"],
    body: `
"How much is a website?" is one of the first questions every business owner asks, and the honest answer is: it depends on what the website has to do. A one-page showcase and an online shop with M-Pesa payments are different projects, priced differently.

Here's what drives the cost, so you can compare quotes properly.

## What drives the price

- **What it has to do.** Showing who you are is simpler than taking orders, bookings or payments.
- **How many pages and products.** Ten pages and 500 products are very different amounts of work.
- **Payments.** M-Pesa and card checkout, receipts and order emails add real work, and real value.
- **Bookings or accounts.** Calendars, customer logins and dashboards are software, not just pages.
- **Content.** Writing, product descriptions and good photos take time, whoever does them.
- **Design.** A template adjusted to your colours costs less than a design made for your brand.

## The main kinds of website

### A showcase website

Who you are, what you offer, where to find you, and a clear way to get in touch. Right for most service businesses, professional firms and property companies. See [EWAMA Properties](https://ewamaproperties.com) for an example we built.

### An online shop

Products, prices, stock, a cart and checkout with M-Pesa or card. Right when customers buy without talking to you first. [Happyfine Wholesalers](https://happyfinewholesalers.co.ke) is one we built, with bulk and single-unit pricing.

### A custom order or booking website

For businesses where every order is a little different: cakes, events, appointments. [Channah Cake House](https://channahcakes.co.ke) is one of ours.

### A platform

Several vendors, customer accounts, bookings and payments in one system. This is software, and it's priced as a project.

## Ongoing costs to plan for

- **Your domain name**, renewed every year.
- **Hosting**, paid monthly or yearly.
- **Updates and support**: new products, prices and pages, security updates.

Ask every quote to list these separately, so you compare like with like.

## How to get an accurate quote

Prepare a short brief before you ask:

1. What should the website do for your business? More enquiries, online sales, bookings?
2. Which pages and how many products?
3. Do you need M-Pesa or card payments?
4. Who writes the text and provides the photos?
5. Two or three websites you like, and why.
6. When do you need it live?

## What we charge

At Bila Matata, websites and apps start from KES 25,000, and every project starts with a free consultation and a fixed written quote: scope, price and delivery date, before you pay anything. See [the work we've built](/#work), then [book a free consultation](/start).

A website earns its cost when it brings in customers. Ours can come with [Zaina](/#zaina), who answers your visitors day and night and turns them into enquiries and bookings.
`,
  },
  {
    slug: "whatsapp-bookings-orders-mpesa",
    title: "Taking bookings and orders on WhatsApp without the chaos",
    description: "A simple booking flow for WhatsApp, clean M-Pesa payment confirmation, and what to do when the chats pile up: a guide for small businesses in Kenya.",
    category: "Customer service",
    published: "2026-11-27",
    keywords: ["WhatsApp bookings", "WhatsApp orders Kenya", "M-Pesa payment confirmation", "WhatsApp Business tips", "small business bookings"],
    body: `
For most businesses in Kenya, WhatsApp is the shop counter. Customers ask, book and order there, and pay by M-Pesa. It works well, until it gets busy: chats pile up, two people are promised the same slot, and someone has to match payment messages to orders by hand.

A little structure fixes most of it.

## Set up the basics once

- **A complete business profile**: hours, location, a short description and your website or menu link.
- **Your price list or catalogue** where customers can see it, so "how much is…" is answered before it's asked.
- **Saved replies** for the questions you get every day.
- **Labels** for chats: new, waiting for payment, confirmed, done.

## Use the same booking flow every time

1. **Ask what you need in one message**: the date, the time, how many people, and anything special.
2. **Check what's really free** before you offer it. Never promise a slot from memory.
3. **Quote the exact total**: the price, extras and any fee, in one clear line.
4. **Send your payment details**: your till or Paybill and account, with the amount.
5. **Confirm only when the payment arrives**, with a short summary the customer can screenshot.

The same five steps work for a table, a room, a hair appointment or a delivery order.

## Getting paid by M-Pesa, cleanly

- **Use your own till or Paybill**, so the money goes straight to you.
- **Ask for the amount and the account reference** you need, so payments are easy to match.
- **Check the payment in your own M-Pesa statement or app**, not only the customer's screenshot.
- **Never ask a customer for their M-Pesa PIN**, and tell your team never to.

## Three messages you can copy

Save these as quick replies and adjust the words to your business.

### Asking for the details

"Hello, and thanks for getting in touch! Please send the date, the time, how many people, and anything special you'd like, and I'll confirm what's free."

### Quoting and asking for payment

"Good news: we have that for you. The total is KSh [amount] for [what's included]. To confirm, please pay to Till [number] ([business name]) and send the M-Pesa message here. We'll confirm as soon as it arrives."

### Confirming

"Confirmed: [date] at [time] for [people]. We've received KSh [amount], reference [M-Pesa code]. See you then, and message us here if anything changes."

## When the chats pile up

- **One person owns each chat.** Two people replying to the same customer is how double bookings happen.
- **Answer the easy questions automatically**, so your team's time goes to the customers who are ready to book.
- **Keep a single list of bookings**, not one in each person's phone.

This is exactly where an AI receptionist helps. [Zaina](/#zaina) answers on your WhatsApp and website at any hour, from your own prices and calendar. On the Full plan she checks what's free, quotes the exact total, books or takes the order and sends your own payment link; your team sees every conversation and can take over at any time. Customers always pay you directly.

[Ask Zaina how it would work for your business](/#faq), or [see the plans](/#pricing).
`,
  },
];

export const articleBySlug = (slug: string) => ARTICLES.find((article) => article.slug === slug) ?? null;

/** "27 November 2026". */
export const longDate = (iso: string) => new Date(`${iso}T09:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const words = (article: Article) => article.body.replace(/[#*[\]()\-]/g, " ").split(/\s+/).filter(Boolean).length;
export const readMinutes = (article: Article) => Math.max(1, Math.round(words(article) / 200));
/** Newest first (the order written, for the same day). */
export const articlesByDate = () => [...ARTICLES].sort((a, b) => (b.updated ?? b.published).localeCompare(a.updated ?? a.published) || ARTICLES.indexOf(a) - ARTICLES.indexOf(b));
