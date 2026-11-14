// src/cards/type.ts
//
// Typesetting for business cards: text becomes outlines (vector shapes), so a
// card looks exactly the same on every phone, browser and printer, with no
// font to load. Two open-licence typefaces (SIL OFL), from npm:
//
//   Plus Jakarta Sans   a modern grotesque, for most of the card
//   Fraunces            a soft, high-contrast serif, for the Signature design
//
// Each glyph is drawn once (in the font's own units, as whole numbers) and
// placed with <use>, which keeps a card's file small. Measurements are in
// millimetres, with the fonts' kerning applied.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import opentype from "opentype.js";

const require = createRequire(import.meta.url);

export type Face = "sans-500" | "sans-600" | "sans-700" | "sans-800" | "serif-600";
const FILES: Record<Face, [string, string]> = {
  "sans-500": ["@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-500-normal.woff", "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-500-normal.woff"],
  "sans-600": ["@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-600-normal.woff", "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-600-normal.woff"],
  "sans-700": ["@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff", "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-700-normal.woff"],
  "sans-800": ["@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-800-normal.woff", "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-800-normal.woff"],
  "serif-600": ["@fontsource/fraunces/files/fraunces-latin-600-normal.woff", "@fontsource/fraunces/files/fraunces-latin-ext-600-normal.woff"],
};

const loaded = new Map<Face, opentype.Font[]>();
function fontsOf(face: Face): opentype.Font[] {
  let fonts = loaded.get(face);
  if (!fonts) {
    fonts = FILES[face].map((name) => {
      const bytes = readFileSync(require.resolve(name));
      return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    });
    loaded.set(face, fonts);
  }
  return fonts;
}

type Placed = { key: string; font: opentype.Font; glyph: opentype.Glyph; x: number };
export type Run = { face: Face; size: number; text: string; width: number; glyphs: Placed[] };

/** Lays a line of text out at a size (mm): the glyphs, each from whichever subset has it, and its width. */
export function run(text: string, face: Face, size: number, letterSpacing = 0): Run {
  const fonts = fontsOf(face);
  const glyphs: Placed[] = [];
  let x = 0;
  let previous: { font: opentype.Font; glyph: opentype.Glyph } | null = null;
  for (const char of Array.from(text)) {
    let index = 0;
    let font = fonts[0];
    for (const candidate of fonts) {
      const glyph = candidate.charToGlyph(char);
      if (glyph.index !== 0) {
        font = candidate;
        index = glyph.index;
        break;
      }
    }
    const glyph = font.glyphs.get(index);
    const scale = size / font.unitsPerEm;
    if (previous && previous.font === font) x += font.getKerningValue(previous.glyph, glyph) * scale;
    glyphs.push({ key: `${face}-${fonts.indexOf(font)}-${index}`, font, glyph, x });
    x += (glyph.advanceWidth ?? 0) * scale + letterSpacing;
    previous = { font, glyph };
  }
  const width = glyphs.length ? x - letterSpacing : 0;
  return { face, size, text, width, glyphs };
}

/** One line in a width: smaller (down to a minimum) until it fits, then shortened with an ellipsis. */
export function fitLine(text: string, face: Face, size: number, maxWidth: number, options: { min?: number; letterSpacing?: number } = {}): Run {
  const min = options.min ?? size * 0.8;
  const spacing = options.letterSpacing ?? 0;
  for (let current = size; current >= min - 1e-9; current -= 0.05) {
    const line = run(text, face, current, spacing * (current / size));
    if (line.width <= maxWidth) return line;
  }
  const chars = Array.from(text);
  for (let keep = chars.length - 1; keep > 0; keep -= 1) {
    const line = run(`${chars.slice(0, keep).join("").trimEnd()}…`, face, min, spacing * (min / size));
    if (line.width <= maxWidth) return line;
  }
  return run("…", face, min);
}

/** Up to a number of lines in a width, breaking between words; smaller if needed, then an ellipsis on the last line. */
export function wrap(text: string, face: Face, size: number, maxWidth: number, maxLines: number, options: { min?: number; letterSpacing?: number } = {}): Run[] {
  const min = options.min ?? size * 0.8;
  const words = text.split(/\s+/).filter(Boolean);
  const attempt = (current: number) => {
    const spacing = (options.letterSpacing ?? 0) * (current / size);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (!line || run(next, face, current, spacing).width <= maxWidth) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return { lines, spacing, fits: lines.length <= maxLines && lines.every((entry) => run(entry, face, current, spacing).width <= maxWidth) };
  };
  for (let current = size; current >= min - 1e-9; current -= 0.05) {
    const { lines, spacing, fits } = attempt(current);
    if (fits) return lines.map((entry) => run(entry, face, current, spacing));
  }
  const { lines } = attempt(min);
  const kept = lines.slice(0, maxLines);
  const last = kept.length - 1;
  const result = kept.map((entry, index) => (index === last && lines.length > maxLines
    ? fitLine(`${entry}…`, face, min, maxWidth, { min, letterSpacing: options.letterSpacing })
    : fitLine(entry, face, min, maxWidth, { min, letterSpacing: options.letterSpacing })));
  return result;
}

/**
 * Collects the glyphs a card uses, and writes text as <use> of them. One per
 * card: its <defs> go at the top of the card's SVG.
 */
export class Typesetter {
  private readonly defs = new Map<string, string>();
  /** Every line placed, with its box (for checking nothing leaves the safe area). */
  readonly boxes: Array<{ text: string; x: number; y: number; width: number; top: number; bottom: number }> = [];

  /** A line at (x, baseline y), in a colour; anchor "end" sets it to end at x. */
  text(line: Run, x: number, y: number, fill: string, options: { anchor?: "start" | "middle" | "end"; opacity?: number } = {}): string {
    const left = options.anchor === "end" ? x - line.width : options.anchor === "middle" ? x - line.width / 2 : x;
    const uses: string[] = [];
    for (const placed of line.glyphs) {
      if (!this.defs.has(placed.key)) {
        const d = placed.glyph.getPath(0, 0, placed.font.unitsPerEm).toPathData(0);
        this.defs.set(placed.key, d ? `<path id="${placed.key}" d="${d}"/>` : `<g id="${placed.key}"/>`);
      }
      if (placed.glyph.unicode === 32 || !placed.glyph.path || (placed.glyph.path as opentype.Path).commands?.length === 0) continue;
      const scale = line.size / placed.font.unitsPerEm;
      uses.push(`<use href="#${placed.key}" transform="translate(${round(left + placed.x)} ${round(y)}) scale(${round(scale, 6)})"/>`);
    }
    const font = line.glyphs[0]?.font;
    const ascent = font ? (font.ascender / font.unitsPerEm) * line.size : line.size;
    const descent = font ? (-font.descender / font.unitsPerEm) * line.size : line.size * 0.25;
    this.boxes.push({ text: line.text, x: left, y, width: line.width, top: y - ascent * 0.78, bottom: y + descent * 0.6 });
    const opacity = options.opacity !== undefined && options.opacity < 1 ? ` fill-opacity="${options.opacity}"` : "";
    return `<g fill="${fill}"${opacity}>${uses.join("")}</g>`;
  }

  definitions(): string {
    return `<defs>${[...this.defs.values()].join("")}</defs>`;
  }
}

export const round = (value: number, places = 3) => Number(value.toFixed(places));
