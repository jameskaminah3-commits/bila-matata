import { readFileSync, writeFileSync } from "node:fs";
import { renderCard, type CardInput } from "../src/cards/render.ts";
const S = process.argv[2];
const logo = "data:image/png;base64," + readFileSync(`${S}/logo.png`).toString("base64");
const base = (over: Partial<CardInput> = {}): CardInput => ({
  name: "Amani Hair Studio", tagline: "Hair and beauty in Nyali, open every day", assistant: "Zaina", role: "front desk host", color: "#7c3aed", logo: null,
  qrTarget: "https://bilamatata.co.ke/k/amani-hair", qrLabel: "bilamatata.co.ke/k/amani-hair",
  details: { design: "signature", personName: "Amani Wanjiku", personTitle: "Founder & lead stylist", phone: "+254 700 000 123", email: "hello@amanihair.co.ke", website: "amanihair.co.ke", address: "Links Road, Nyali, Mombasa" }, ...over,
});
const out: Record<string, string> = {};
for (const design of ["signature", "minimal", "bold"] as const) {
  for (const [label, input] of [["a", base({ details: { ...base().details, design } })], ["b", base({ name: "Baobab Ridge Lodge & Spa Retreat", tagline: "Boutique stays above Diani Beach", color: "#0f766e", logo, qrTarget: "https://bilamatata.co.ke/k/baobab-ridge", qrLabel: "bilamatata.co.ke/k/baobab-ridge", details: { design, personName: null, personTitle: null, phone: "+254 711 222 333", email: "reservations@baobabridgelodge.example.com", website: null, address: null } })]] as const) {
    for (const side of ["front", "back"] as const) out[`${design}-${label}-${side}`] = renderCard(input, side).svg;
  }
}
writeFileSync(`${S}/cards.json`, JSON.stringify(out));
