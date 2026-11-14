// src/frontdoor/qr.ts
//
// QR codes as pictures that print sharp at any size (SVG), in two styles:
//
//   classic   black squares on white: the most widely readable.
//   premium   the business's own: soft rounded modules and rounded corner
//             "eyes" in its colour (darkened when it is too light to scan),
//             and its logo (or its initials) in the centre. The centre is
//             cleared for the logo and the code carries the highest error
//             correction (H, 30%), so what the logo covers is recovered.
//
// Every style keeps the four-module quiet margin scanners need, and dark on
// light: scanners read dark modules on a light ground.

import qrcode from "qrcode-generator";

export type QrOptions = {
  /** Quiet margin, in modules (4 is the standard). */
  margin?: number;
  style?: "classic" | "premium";
  /** The business's colour (premium). */
  color?: string;
  /** A logo to put in the centre, as a data: URI (premium). */
  logo?: string | null;
  /** Up to two letters for the centre when there is no logo (premium). */
  initials?: string | null;
};

const HEX = /^#[0-9a-f]{6}$/i;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast against white (1 to 21). */
export const contrastOnWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

/**
 * A colour dark enough to scan on white: the business's own when it is
 * (contrast at least 4.5, well clear of what phone cameras need), otherwise
 * the same hue darkened until it is.
 */
export function scannableInk(color: string | null | undefined): string {
  if (!color || !HEX.test(color)) return "#111827";
  let [r, g, b] = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
  let hex = color.toLowerCase();
  for (let step = 0; step < 40 && contrastOnWhite(hex) < 4.5; step += 1) {
    [r, g, b] = [r, g, b].map((channel) => Math.round(channel * 0.9));
    hex = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }
  return hex;
}

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Matrix = { count: number; dark: (row: number, column: number) => boolean };

function matrixFor(text: string, level: "L" | "M" | "Q" | "H"): Matrix {
  const code = qrcode(0, level);
  code.addData(text);
  code.make();
  return { count: code.getModuleCount(), dark: (row, column) => code.isDark(row, column) };
}

/** The QR code for a piece of text (an address), as an SVG document. */
export function qrSvg(text: string, options: QrOptions = {}): string {
  return options.style === "premium" ? premiumSvg(text, options) : classicSvg(text, options);
}

function classicSvg(text: string, options: QrOptions): string {
  const margin = options.margin ?? 4;
  // Error correction Q: a quarter of the code can be scuffed or covered (a counter sticker gets handled) and it still scans.
  const { count, dark } = matrixFor(text, "Q");
  const size = count + margin * 2;
  let path = "";
  for (let row = 0; row < count; row += 1) {
    let run = 0;
    for (let column = 0; column <= count; column += 1) {
      if (column < count && dark(row, column)) run += 1;
      else if (run) {
        path += `M${column - run + margin} ${row + margin}h${run}v1h-${run}z`;
        run = 0;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 8}" height="${size * 8}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${size}" height="${size}" fill="#ffffff"/><path d="${path}" fill="#111827"/></svg>`;
}

function premiumSvg(text: string, options: QrOptions): string {
  const margin = options.margin ?? 4;
  const ink = scannableInk(options.color);
  const logo = options.logo && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(options.logo) ? options.logo : null;
  const letters = !logo && options.initials ? options.initials.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() : "";
  // H (30%) when the centre is covered by the logo; otherwise Q, which keeps the code smaller and easier to read from afar.
  const { count, dark } = matrixFor(text, logo || letters ? "H" : "Q");
  const size = count + margin * 2;

  // The three corner eyes are drawn as shapes of their own.
  const inEye = (row: number, column: number) => (row < 7 && column < 7) || (row < 7 && column >= count - 7) || (row >= count - 7 && column < 7);
  // The centre is cleared for the logo: an odd number of modules, about a fifth of the code's width.
  let hole = Math.round(count * 0.22);
  if (hole % 2 === 0) hole += 1;
  const centre = logo || letters ? { from: (count - hole) / 2, to: (count + hole) / 2 } : null;
  const inHole = (row: number, column: number) => centre !== null && row >= centre.from - 0.5 && row < centre.to + 0.5 && column >= centre.from - 0.5 && column < centre.to + 0.5;

  // Modules: rounded squares, close enough to their neighbours that the code still reads as a code.
  let modules = "";
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (!dark(row, column) || inEye(row, column) || inHole(row, column)) continue;
      // A 0.92-module square with corners rounded to a third: soft, but still square enough to read at a glance.
      const x = column + margin + 0.04;
      const y = row + margin + 0.04;
      modules += `M${x + 0.3} ${y}h0.32a0.3 0.3 0 0 1 0.3 0.3v0.32a0.3 0.3 0 0 1-0.3 0.3h-0.32a0.3 0.3 0 0 1-0.3-0.3v-0.32a0.3 0.3 0 0 1 0.3-0.3z`;
    }
  }
  const eye = (row: number, column: number) => {
    const x = column + margin;
    const y = row + margin;
    // A 7-module ring one module thick, with rounded corners, around a 3-module rounded square.
    return `<path fill-rule="evenodd" fill="${ink}" d="M${x + 2} ${y}h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2zM${x + 2.2} ${y + 1}a1.2 1.2 0 0 0-1.2 1.2v2.6a1.2 1.2 0 0 0 1.2 1.2h2.6a1.2 1.2 0 0 0 1.2-1.2v-2.6a1.2 1.2 0 0 0-1.2-1.2z"/>`
      + `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9" fill="${ink}"/>`;
  };
  let middle = "";
  if (centre) {
    const pad = 0.6;
    const x = centre.from + margin - 0.5 + pad / 2;
    const width = hole + 1 - pad;
    middle = `<rect x="${x}" y="${x}" width="${width}" height="${width}" rx="${width * 0.24}" fill="#ffffff"/>`;
    const inner = width - 1.2;
    const innerX = x + 0.6;
    middle += logo
      ? `<clipPath id="qr-logo"><rect x="${innerX}" y="${innerX}" width="${inner}" height="${inner}" rx="${inner * 0.22}"/></clipPath><image href="${logo}" x="${innerX}" y="${innerX}" width="${inner}" height="${inner}" preserveAspectRatio="xMidYMid slice" clip-path="url(#qr-logo)"/>`
      : `<rect x="${innerX}" y="${innerX}" width="${inner}" height="${inner}" rx="${inner * 0.24}" fill="${ink}"/><text x="${x + width / 2}" y="${x + width / 2}" dy="0.35em" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-weight="700" font-size="${inner * (letters.length > 1 ? 0.42 : 0.55)}" fill="#ffffff">${escapeXml(letters)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 8}" height="${size * 8}" role="img" aria-label="QR code"><rect width="${size}" height="${size}" fill="#ffffff"/><path d="${modules}" fill="${ink}"/>${eye(0, 0)}${eye(0, count - 7)}${eye(count - 7, 0)}${middle}</svg>`;
}
