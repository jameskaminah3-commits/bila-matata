// src/studio/brand.ts
//
// Bila Matata's own details, as the website, the payment page and its emails
// show them. One place, so they always agree.

export const STUDIO = {
  name: "Bila Matata",
  tagline: "AI, software, data and research studio",
  /** The registered address, for terms and invoices. */
  city: "Mombasa, Kenya",
  /** Where the studio works: everywhere in Kenya, and with clients abroad, online. */
  reach: "Across Kenya and beyond",
  phone: "+254707255598",
  phoneDisplay: "+254 707 255 598",
  email: "hello@bilamatata.com",
  /** The studio's business id on the platform: the Zaina on its own website. */
  businessId: "bilamatata",
} as const;

/** What a visitor deciding on Zaina asks first: offered in the chat on bilamatata.com, and as one-tap questions on its home page. */
export const STUDIO_SUGGESTIONS = ["Which plan suits my business?", "How much is Zaina?", "What is the Menu plan?", "Do you work in my town?"];

/** A WhatsApp chat with the studio, with a first message already typed. */
export function whatsappLink(message: string): string {
  return `https://wa.me/${STUDIO.phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

/** "KES 6,700" or "USD 12.50": whole amounts without decimals. */
export function formatMoney(amountMinor: number, currency: string): string {
  const amount = amountMinor / 100;
  const whole = Number.isInteger(amount);
  return `${currency} ${amount.toLocaleString("en-KE", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}
