// src/studio/brand.ts
//
// Bila Matata's own details, as the website, the payment page and its emails
// show them. One place, so they always agree.

export const STUDIO = {
  name: "Bila Matata",
  tagline: "AI, software, data and research studio",
  city: "Mombasa, Kenya",
  phone: "+254707255598",
  phoneDisplay: "+254 707 255 598",
  email: "hello@bilamatata.com",
  /** The studio's business id on the platform: the Zaina on its own website. */
  businessId: "bilamatata",
} as const;

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
