// src/cards/render.ts
//
// A business card, front and back, as an exact vector picture (SVG). Sizes
// are millimetres: the card is the standard 85 × 55 mm; with bleed, 3 mm more
// on every side so coloured edges survive the cutter. Everything that
// matters sits at least 6 mm inside the cut.
//
// Three designs, each built on the business's own colour and logo:
//
//   signature   a deep, colour-tinted front with a serif name and a fine
//               hairline; an ivory back with the code on a white tile
//   minimal     a crisp white front on a Swiss grid with small-caps labels;
//               a back in the business's colour
//   bold        a colour panel beside a white front; a white back with a large
//               framed code
//
// The back's code is the business's premium QR, which sends each scan
// wherever its Zaina works. Colours are kept readable: text on a colour is
// white or ink, whichever reads, and accents are adjusted until they do.

import { readableOn } from "../brand/assets.ts";
import type { CardDesign, CardDetails } from "../db/schema.ts";
import { initials } from "../frontdoor/page.ts";
import { qrSvg } from "../frontdoor/qr.ts";
import { fitLine, round, Typesetter, wrap, type Run } from "./type.ts";

export const CARD = { width: 85, height: 55, bleed: 3, safe: 6 } as const;

export type CardInput = {
  name: string;
  tagline: string | null;
  assistant: string;
  role: string;
  color: string;
  /** The logo as a data: URI (PNG, JPEG or WebP), or null. */
  logo: string | null;
  /** What the back's code carries (the card's scan address). */
  qrTarget: string;
  /** The same, as people read it under the code. */
  qrLabel: string;
  details: CardDetails;
};

export type CardSide = "front" | "back";

// ── Colour ───────────────────────────────────────────────────────────────
const INK = "#15191b";
const MUTED = "#5d6663";
const IVORY = "#f8f6f1";
const PAPER = "#fdfcfa";

const channels = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const toHex = (values: number[]) => `#${values.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
/** a, moved a share of the way towards b. */
export const mix = (a: string, b: string, share: number) => toHex(channels(a).map((value, index) => value + (channels(b)[index] - value) * share));
function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((value) => value / 255).map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};
/** The colour, moved towards white or black until it reads on a background at a ratio. */
export function readableAccent(color: string, background: string, ratio = 4.5): string {
  const towards = luminance(background) < 0.3 ? "#ffffff" : "#000000";
  let current = color;
  for (let step = 1; step <= 20 && contrast(current, background) < ratio; step += 1) current = mix(color, towards, step * 0.05);
  return current;
}

type Palette = { brand: string; deep: string; onBrand: string; accentOnDark: string; accentOnLight: string };
export function paletteFor(color: string): Palette {
  const brand = /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#0f766e";
  const deep = mix(brand, "#0a0d0c", 0.82);
  return { brand, deep, onBrand: readableOn(brand), accentOnDark: readableAccent(mix(brand, "#ffffff", 0.25), deep, 4.5), accentOnLight: readableAccent(brand, "#ffffff", 4.5) };
}

// ── Pieces ───────────────────────────────────────────────────────────────
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ICONS = {
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  email: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 7l9 6 9-6",
  website: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  address: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z",
} as const;
type ContactKey = keyof typeof ICONS;
const CONTACTS: ContactKey[] = ["phone", "email", "website", "address"];

const icon = (key: ContactKey, x: number, y: number, size: number, color: string) =>
  `<path d="${ICONS[key]}" transform="translate(${round(x)} ${round(y)}) scale(${round(size / 24, 5)})" fill="none" stroke="${color}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`;

/** The business's logo in a box (kept whole, centred), or its initials. */
function mark(input: CardInput, x: number, y: number, size: number, style: { tile: string | null; letters: string; lettersFill: string; face: "sans-800" | "serif-600"; ring?: string }, type: Typesetter): string {
  const radius = size * 0.24;
  if (input.logo) {
    const pad = style.tile ? size * 0.12 : 0;
    const tile = style.tile ? `<rect x="${round(x)}" y="${round(y)}" width="${round(size)}" height="${round(size)}" rx="${round(radius)}" fill="${style.tile}"/>` : "";
    return `${tile}<image href="${esc(input.logo)}" x="${round(x + pad)}" y="${round(y + pad)}" width="${round(size - pad * 2)}" height="${round(size - pad * 2)}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  const letters = initials(input.name);
  const line = fitLine(letters, style.face, size * (letters.length > 1 ? 0.4 : 0.5), size * 0.8);
  const ground = style.ring
    ? `<circle cx="${round(x + size / 2)}" cy="${round(y + size / 2)}" r="${round(size / 2 - 0.2)}" fill="none" stroke="${style.ring}" stroke-width="0.3"/>`
    : `<rect x="${round(x)}" y="${round(y)}" width="${round(size)}" height="${round(size)}" rx="${round(radius)}" fill="${style.letters}"/>`;
  return ground + type.text(line, x + size / 2, y + size / 2 + line.size * 0.36, style.lettersFill, { anchor: "middle" });
}

/** The premium QR code, set into the card at a size. */
function qr(input: CardInput, x: number, y: number, size: number): string {
  const svg = qrSvg(input.qrTarget, { style: "premium", color: input.color, logo: input.logo, initials: initials(input.name), margin: 2 });
  return svg.replace(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="([^"]+)"[^>]*>/, `<svg x="${round(x)}" y="${round(y)}" width="${round(size)}" height="${round(size)}" viewBox="$1">`);
}

/** The contact lines that have something in them, each with its icon. */
function contactLines(input: CardInput, type: Typesetter, at: { x: number; y: number; width: number; size: number; step: number; text: string; icons: string; opacity?: number }): string {
  let out = "";
  let y = at.y;
  for (const key of CONTACTS) {
    const value = input.details[key];
    if (!value) continue;
    const iconSize = at.size * 1.15;
    out += icon(key, at.x, y - iconSize * 0.82, iconSize, at.icons);
    out += type.text(fitLine(value, "sans-500", at.size, at.width - iconSize - 1.4, { min: at.size * 0.82 }), at.x + iconSize + 1.4, y, at.text, { opacity: at.opacity });
    y += at.step;
  }
  return out;
}
const contactCount = (input: CardInput) => CONTACTS.filter((key) => input.details[key]).length;

/** A stack of lines, from a first baseline, each line a step below the last. */
function lines(type: Typesetter, runs: Run[], x: number, y: number, step: number, fill: string, options: { opacity?: number; anchor?: "start" | "end" } = {}): { svg: string; next: number } {
  let svg = "";
  runs.forEach((line, index) => {
    svg += type.text(line, x, y + index * step, fill, options);
  });
  return { svg, next: y + runs.length * step };
}

/** A name on one line if it fits at a good size; otherwise on two, a little smaller. */
function nameLines(name: string, face: "serif-600" | "sans-800", sizes: { one: number; oneMin: number; two: number; twoMin: number }, width: number, letterSpacing = 0): Run[] {
  const one = fitLine(name, face, sizes.one, width, { min: sizes.oneMin, letterSpacing });
  if (one.text === name) return [one];
  return wrap(name, face, sizes.two, width, 2, { min: sizes.twoMin, letterSpacing });
}

// ── Designs ──────────────────────────────────────────────────────────────
type Drawn = { background: string; body: string };
type Design = Record<CardSide, (input: CardInput, palette: Palette, type: Typesetter, bleed: number) => Drawn>;

const S = CARD.safe;
const W = CARD.width;
const H = CARD.height;

const signature: Design = {
  front(input, palette, type) {
    const ivory = "#f5f2ea";
    let body = mark(input, S, S, 10.5, { tile: "#ffffff", letters: palette.brand, lettersFill: palette.accentOnDark, face: "serif-600", ring: palette.accentOnDark }, type);
    const name = nameLines(input.name, "serif-600", { one: 5.1, oneMin: 4.2, two: 4.4, twoMin: 3.4 }, W - S * 2);
    const last = input.tagline ? 28.8 : 31.2;
    const nameStep = name[0].size * 1.12;
    body += lines(type, name, S, last - (name.length - 1) * nameStep, nameStep, ivory).svg;
    if (input.tagline) body += lines(type, wrap(input.tagline, "sans-500", 1.95, W - S * 2, 1, { min: 1.7 }), S, last + 4.1, 2.6, ivory, { opacity: 0.66 }).svg;
    body += `<line x1="${S}" y1="35.4" x2="${W - S}" y2="35.4" stroke="${palette.accentOnDark}" stroke-opacity="0.5" stroke-width="0.18"/>`;
    const person = input.details.personName;
    const contactsX = person ? 44 : S;
    if (person) {
      body += type.text(fitLine(person, "sans-700", 2.75, contactsX - S - 3, { min: 2.2 }), S, 41.6, ivory);
      if (input.details.personTitle) body += type.text(fitLine(input.details.personTitle.toUpperCase(), "sans-700", 1.5, contactsX - S - 3, { min: 1.25, letterSpacing: 0.32 }), S, 45, palette.accentOnDark);
    }
    const count = contactCount(input);
    const step = count > 3 ? 2.75 : 3;
    body += contactLines(input, type, { x: contactsX, y: 41.4, width: W - S - contactsX, size: 1.9, step, text: ivory, icons: palette.accentOnDark, opacity: 0.88 });
    return { background: palette.deep, body };
  },
  back(input, palette, type) {
    const tile = 33;
    const tileY = (H - tile) / 2;
    let body = `<rect x="${S}" y="${round(tileY)}" width="${tile}" height="${tile}" rx="3.4" fill="#ffffff" stroke="#e6e1d6" stroke-width="0.2"/>`;
    body += qr(input, S + 1.2, tileY + 1.2, tile - 2.4);
    const x = S + tile + 5;
    const width = W - S - x;
    body += type.text(fitLine("SCAN TO CHAT", "sans-700", 1.55, width, { letterSpacing: 0.42 }), x, 17.4, palette.accentOnLight);
    const heading = lines(type, [fitLine("Talk to us,", "serif-600", 4.3, width, { min: 3.4 }), fitLine("any time.", "serif-600", 4.3, width, { min: 3.4 })], x, 23.4, 4.9, INK);
    body += heading.svg;
    body += lines(type, wrap(`${input.assistant}, our ${input.role}, answers day and night.`, "sans-500", 1.85, width, 3, { min: 1.6 }), x, heading.next + 0.9, 2.55, MUTED).svg;
    body += type.text(fitLine(input.qrLabel, "sans-600", 1.55, width, { min: 1.3 }), x, H - S - 0.6, INK, { opacity: 0.72 });
    return { background: IVORY, body };
  },
};

const minimal: Design = {
  front(input, palette, type) {
    let body = `<rect x="${S}" y="${S}" width="7" height="0.7" fill="${palette.brand}"/>`;
    const logoSize = 10;
    body += mark(input, W - S - logoSize, S, logoSize, { tile: null, letters: palette.brand, lettersFill: palette.onBrand, face: "sans-800" }, type);
    const name = nameLines(input.name, "sans-800", { one: 4.5, oneMin: 3.9, two: 3.9, twoMin: 3.0 }, W - S * 2 - logoSize - 4, -0.06);
    const placed = lines(type, name, S, 14.2, name[0].size * 1.16, INK);
    body += placed.svg;
    const lastName = 14.2 + (name.length - 1) * name[0].size * 1.16;
    if (input.tagline) body += lines(type, wrap(input.tagline, "sans-500", 1.9, W - S * 2 - logoSize - 4, 2, { min: 1.65 }), S, lastName + 4.1, 2.55, MUTED).svg;
    const person = input.details.personName;
    const column = person ? 44 : S;
    if (person) {
      body += type.text(fitLine(person, "sans-700", 2.6, column - S - 3, { min: 2.1 }), S, 41.4, INK);
      if (input.details.personTitle) body += type.text(fitLine(input.details.personTitle.toUpperCase(), "sans-600", 1.45, column - S - 3, { min: 1.2, letterSpacing: 0.3 }), S, 44.8, MUTED);
    }
    // Labels in small caps, values beside them: the Swiss way.
    const labels: Record<ContactKey, string> = { phone: "T", email: "E", website: "W", address: "A" };
    let y = 41.2;
    for (const key of CONTACTS) {
      const value = input.details[key];
      if (!value) continue;
      body += type.text(fitLine(labels[key], "sans-800", 1.5, 3), column, y, palette.accentOnLight);
      body += type.text(fitLine(value, "sans-500", 1.85, W - S - column - 3.4, { min: 1.55 }), column + 3.4, y, INK);
      y += contactCount(input) > 3 ? 2.75 : 3;
    }
    return { background: PAPER, body };
  },
  back(input, palette, type, bleed) {
    const on = palette.onBrand;
    // Fine rings, off the lower-left corner: a quiet echo of the code's corners.
    let body = [26, 36, 46].map((size, index) => `<rect x="${round(-size / 2 - bleed * 0)}" y="${round(H - size / 2)}" width="${size}" height="${size}" rx="${round(size * 0.28)}" fill="none" stroke="${on}" stroke-opacity="${0.16 - index * 0.04}" stroke-width="0.3"/>`).join("");
    const tile = 33;
    const tileX = W - S - tile;
    const tileY = (H - tile) / 2;
    body += `<rect x="${tileX}" y="${round(tileY)}" width="${tile}" height="${tile}" rx="3.4" fill="#ffffff"/>`;
    body += qr(input, tileX + 1.2, tileY + 1.2, tile - 2.4);
    const width = tileX - S - 5;
    body += type.text(fitLine(input.name.toUpperCase(), "sans-700", 1.55, width, { min: 1.1, letterSpacing: 0.42 }), S, 17.4, on, { opacity: 0.78 });
    const heading = lines(type, [fitLine("Scan to chat", "sans-800", 4.3, width, { min: 3.2, letterSpacing: -0.05 }), fitLine("with us", "sans-800", 4.3, width, { min: 3.2, letterSpacing: -0.05 })], S, 23.3, 4.85, on);
    body += heading.svg;
    body += lines(type, wrap(`${input.assistant}, our ${input.role}, answers day and night.`, "sans-500", 1.85, width, 3, { min: 1.6 }), S, heading.next + 0.9, 2.55, on, { opacity: 0.86 }).svg;
    body += type.text(fitLine(input.qrLabel, "sans-600", 1.55, width, { min: 1.3 }), S, H - S - 0.6, on, { opacity: 0.78 });
    return { background: palette.brand, body };
  },
};

const bold: Design = {
  front(input, palette, type, bleed) {
    const panel = 29;
    const on = palette.onBrand;
    let body = `<rect x="${-bleed}" y="${-bleed}" width="${panel + bleed}" height="${H + bleed * 2}" fill="${palette.brand}"/>`;
    body += [30, 42, 54].map((size, index) => `<circle cx="0" cy="${H}" r="${size / 2}" fill="none" stroke="${on}" stroke-opacity="${0.2 - index * 0.05}" stroke-width="0.3"/>`).join("");
    body += mark(input, (panel - 14) / 2, S + 1, 14, { tile: "#ffffff", letters: "#ffffff", lettersFill: palette.accentOnLight, face: "sans-800" }, type);
    const x = panel + 6;
    const width = W - S - x;
    const name = nameLines(input.name, "sans-800", { one: 4.1, oneMin: 3.6, two: 3.7, twoMin: 2.9 }, width, -0.05);
    const placed = lines(type, name, x, 12.6, name[0].size * 1.16, INK);
    body += placed.svg;
    let y = 12.6 + (name.length - 1) * name[0].size * 1.16;
    if (input.tagline) {
      const tagline = lines(type, wrap(input.tagline, "sans-500", 1.8, width, 2, { min: 1.55 }), x, y + 3.9, 2.45, MUTED);
      body += tagline.svg;
      y = tagline.next - 2.45;
    }
    if (input.details.personName) {
      body += type.text(fitLine(input.details.personName, "sans-700", 2.5, width, { min: 2 }), x, Math.max(y + 4.8, 28.4), INK);
      if (input.details.personTitle) body += type.text(fitLine(input.details.personTitle.toUpperCase(), "sans-700", 1.42, width, { min: 1.2, letterSpacing: 0.3 }), x, Math.max(y + 4.8, 28.4) + 3.3, palette.accentOnLight);
    }
    const count = contactCount(input);
    const step = count > 3 ? 2.7 : 2.95;
    body += contactLines(input, type, { x, y: H - S - (Math.max(count, 1) - 1) * step - 0.4, width, size: 1.8, step, text: INK, icons: palette.accentOnLight });
    return { background: "#ffffff", body };
  },
  back(input, palette, type, bleed) {
    const tile = 34;
    const tileY = (H - tile) / 2;
    let body = `<rect x="${W - 3.2}" y="${-bleed}" width="${3.2 + bleed}" height="${H + bleed * 2}" fill="${palette.brand}"/>`;
    body += `<rect x="${S}" y="${round(tileY)}" width="${tile}" height="${tile}" rx="3.6" fill="#ffffff" stroke="${palette.brand}" stroke-width="0.6"/>`;
    body += qr(input, S + 1.4, tileY + 1.4, tile - 2.8);
    const x = S + tile + 5;
    const width = W - 3.2 - 4 - x;
    body += type.text(fitLine(input.name.toUpperCase(), "sans-700", 1.55, width, { min: 1.1, letterSpacing: 0.42 }), x, 17.4, palette.accentOnLight);
    const heading = lines(type, [fitLine("Scan to chat", "sans-800", 4.1, width, { min: 3.0, letterSpacing: -0.05 }), fitLine("with us", "sans-800", 4.1, width, { min: 3.0, letterSpacing: -0.05 })], x, 23.2, 4.7, INK);
    body += heading.svg;
    body += lines(type, wrap(`${input.assistant}, our ${input.role}, answers day and night.`, "sans-500", 1.8, width, 3, { min: 1.55 }), x, heading.next + 0.9, 2.5, MUTED).svg;
    body += type.text(fitLine(input.qrLabel, "sans-600", 1.5, width, { min: 1.25 }), x, H - S - 0.6, INK, { opacity: 0.72 });
    return { background: "#ffffff", body };
  },
};

const DESIGNS: Record<CardDesign, Design> = { signature, minimal, bold };

/** A soft light from the top right, for the Signature front. */
const glow = (palette: Palette, bleed: number) =>
  `<defs><radialGradient id="card-glow" cx="${W * 0.86}" cy="${-6}" r="62" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${palette.brand}" stop-opacity="0.55"/><stop offset="1" stop-color="${palette.brand}" stop-opacity="0"/></radialGradient></defs>`
  + `<rect x="${-bleed}" y="${-bleed}" width="${W + bleed * 2}" height="${H + bleed * 2}" fill="url(#card-glow)"/>`
  + [22, 34, 46].map((size, index) => `<rect x="${round(W - size * 0.42)}" y="${round(H - size * 0.42)}" width="${size}" height="${size}" rx="${round(size * 0.28)}" fill="none" stroke="${palette.accentOnDark}" stroke-opacity="${0.16 - index * 0.04}" stroke-width="0.25"/>`).join("");

export type RenderedCard = { svg: string; boxes: Typesetter["boxes"] };

/** One side of a card, as an SVG document sized in millimetres. */
export function renderCard(input: CardInput, side: CardSide, options: { bleed?: boolean } = {}): RenderedCard {
  const bleed = options.bleed ? CARD.bleed : 0;
  const palette = paletteFor(input.color);
  const type = new Typesetter();
  const design = DESIGNS[input.details.design] ?? signature;
  const drawn = design[side](input, palette, type, bleed);
  const extra = input.details.design === "signature" && side === "front" ? glow(palette, bleed) : "";
  const width = W + bleed * 2;
  const height = H + bleed * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-bleed} ${-bleed} ${width} ${height}" width="${width}mm" height="${height}mm" role="img" aria-label="${esc(`${input.name}: business card, ${side}`)}">`
    + `<clipPath id="card-edge"><rect x="${-bleed}" y="${-bleed}" width="${width}" height="${height}"/></clipPath>`
    + type.definitions()
    + `<g clip-path="url(#card-edge)"><rect x="${-bleed}" y="${-bleed}" width="${width}" height="${height}" fill="${drawn.background}"/>${extra}${drawn.body}</g></svg>`;
  return { svg, boxes: type.boxes };
}
