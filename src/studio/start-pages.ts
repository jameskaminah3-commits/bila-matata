// src/studio/start-pages.ts
//
// /start: the page behind every "Book" and "Get started" button. A plain
// form (it works without any script): who you are, what you want to start,
// and a few words about it. What's sent lands in the studio's dashboard.

import { formatMoney, STUDIO, whatsappLink } from "./brand.ts";
import { esc, siteParts, type SitePage } from "./pages.ts";
import type { ProjectRequest, RequestProblems } from "./requests.ts";
import { REQUEST_TOPICS, requestTopic, STUDIO_SERVICES } from "./services.ts";

const shell = (page: SitePage, options: { title: string; path: string; index: boolean; body: string; image?: string }) => `${siteParts.head({
  title: options.title,
  description: "Start a project with Bila Matata or get Zaina AI for your business: tell us what you need and we'll reply with a free written quote.",
  path: options.path,
  baseUrl: page.baseUrl,
  index: options.index,
  image: options.image,
})}
<body>
${siteParts.header("start")}
<main id="main" class="start">
  <div class="wrap">
${options.body}
  </div>
</main>
${siteParts.footer()}
<script src="/site/site.js" defer></script>
</body>
</html>`;

const field = (name: keyof ProjectRequest | "service", problems: RequestProblems) => {
  const key = name === "service" ? "topic" : name;
  const problem = problems[key as keyof ProjectRequest];
  return { invalid: problem ? ' aria-invalid="true"' : "", note: problem ? `<span class="field-error" role="alert">${esc(problem)}</span>` : "" };
};

/** A line under the heading for the topic chosen: a service's starting price. */
function topicNote(topicId: string): string {
  const service = STUDIO_SERVICES.find((entry) => entry.id === topicId);
  if (service) return `${service.title} starts from ${formatMoney(service.fromMinor, "KES")}. Your exact price comes in a free written quote, before you pay anything.`;
  if (topicId === "menu_plan") return "Send us your menu as it is today (a photo is fine). We'll set it in your brand and send you the QR code and table cards to print.";
  if (topicId === "zaina_starter" || topicId === "zaina_full") return "We'll ask a few questions about your business, show you Zaina on your own catalogue, and get you live.";
  return "Tell us what you need and we'll reply with a free written quote, before you pay anything.";
}

export function renderStart(page: SitePage, options: { request: ProjectRequest; problems: RequestProblems; tooMany?: boolean }): string {
  const { request, problems } = options;
  const f = (name: keyof ProjectRequest | "service") => field(name, problems);
  const anyProblem = Object.keys(problems).length > 0;
  return shell(page, {
    title: "Start a Project | Bila Matata",
    path: "/start",
    index: !anyProblem && !request.name,
    // A link to get Zaina shows Zaina when it's shared.
    image: request.topic.startsWith("zaina") ? "/site/og-zaina.png" : undefined,
    body: `    <div class="start-grid">
      <div>
        <h1>${request.topic.startsWith("zaina") ? "Get Zaina for your business" : "Book a free consultation"}</h1>
        <p class="lede">${esc(topicNote(request.topic))}</p>
        ${options.tooMany ? '<p class="notice error" role="alert">Too many requests from this connection. Please try again in an hour, or message us on WhatsApp.</p>' : ""}
        ${anyProblem ? '<p class="notice error" role="alert">Please check the marked fields below.</p>' : ""}
        <form class="panel" method="post" action="/start" novalidate>
          <div class="field">
            <label for="service">What would you like to start?</label>
            <select id="service" name="service" required${f("service").invalid}>
              <option value=""${request.topic ? "" : " selected"} disabled>Choose one</option>
              ${REQUEST_TOPICS.map((topic) => `<option value="${esc(topic.id)}"${topic.id === request.topic ? " selected" : ""}>${esc(topic.label)}</option>`).join("\n              ")}
            </select>
            ${f("service").note}
          </div>
          <div class="field-row">
            <div class="field">
              <label for="name">Your name</label>
              <input id="name" name="name" type="text" autocomplete="name" required maxlength="120" value="${esc(request.name)}"${f("name").invalid}>
              ${f("name").note}
            </div>
            <div class="field">
              <label for="business">Business <span class="optional">(optional)</span></label>
              <input id="business" name="business" type="text" autocomplete="organization" maxlength="120" value="${esc(request.business)}">
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="phone">WhatsApp or phone</label>
              <input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="30" placeholder="+254 7…" value="${esc(request.phone)}"${f("phone").invalid}>
              ${f("phone").note}
            </div>
            <div class="field">
              <label for="email">Email <span class="optional">(optional if you gave a number)</span></label>
              <input id="email" name="email" type="email" autocomplete="email" maxlength="200" value="${esc(request.email)}"${f("email").invalid}>
              ${f("email").note}
            </div>
          </div>
          <div class="field">
            <label for="details">What do you need?</label>
            <textarea id="details" name="details" rows="5" required maxlength="2000" placeholder="What your business does, what you want built or fixed, and by when."${f("details").invalid}>${esc(request.details)}</textarea>
            ${f("details").note}
          </div>
          <div class="hp" aria-hidden="true"><label for="website">Leave this empty</label><input id="website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
          <button class="btn btn-primary" type="submit">Send my request</button>
          <p class="secure">${siteParts.ICONS.lock}<span>We use your details only to reply to this request. See our <a href="/terms#privacy">privacy terms</a>.</span></p>
        </form>
      </div>
      <aside class="start-side" aria-label="What happens next">
        <h2>What happens next</h2>
        <ol class="next">
          <li><strong>We reply within one working day</strong>, on WhatsApp or by email, Monday to Saturday.</li>
          <li><strong>You get a written quote</strong>: scope, price and delivery date. It's free.</li>
          <li><strong>You decide.</strong> Project work starts with a 50% deposit, paid by M-Pesa or card.</li>
        </ol>
        <div class="start-alt">
          <p>Prefer to talk now?</p>
          <a class="btn btn-ghost" href="${esc(whatsappLink(`Hello Bila Matata, I'd like to start: ${requestTopic(request.topic)?.label ?? "a project"}.`))}" rel="noopener">${siteParts.ICONS.whatsapp}WhatsApp ${esc(STUDIO.phoneDisplay)}</a>
        </div>
      </aside>
    </div>`,
  });
}

export function renderStartThanks(page: SitePage, topicId: string): string {
  const topic = requestTopic(topicId);
  return shell(page, {
    title: "Request Received | Bila Matata",
    path: "/start/thanks",
    index: false,
    body: `    <div class="thanks">
      <span class="badge paid">Request received</span>
      <h1>Thank you. We've got your request.</h1>
      <p class="lede">${topic ? `You asked about ${esc(topic.label)}. ` : ""}Our team will reply within one working day (Monday to Saturday), on the number or email you gave.</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="/">Back to the home page</a>
        <a class="btn btn-ghost" href="${esc(whatsappLink("Hello Bila Matata, I've just sent a request on your website."))}" rel="noopener">${siteParts.ICONS.whatsapp}Message us on WhatsApp</a>
      </div>
    </div>`,
  });
}
