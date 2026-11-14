// src/frontdoor/qr.ts
//
// A QR code as a picture that prints sharp at any size (SVG): one path of
// squares on a white ground, with the quiet margin scanners need.

import qrcode from "qrcode-generator";

export type QrOptions = { /** Quiet margin, in modules (4 is the standard). */ margin?: number; dark?: string; light?: string };

/** The QR code for a piece of text (an address), as an SVG document. */
export function qrSvg(text: string, options: QrOptions = {}): string {
  const margin = options.margin ?? 4;
  // Error correction Q: a quarter of the code can be scuffed or covered (a counter sticker gets handled) and it still scans.
  const code = qrcode(0, "Q");
  code.addData(text);
  code.make();
  const count = code.getModuleCount();
  const size = count + margin * 2;
  let path = "";
  for (let row = 0; row < count; row += 1) {
    let run = 0;
    for (let column = 0; column <= count; column += 1) {
      const dark = column < count && code.isDark(row, column);
      if (dark) run += 1;
      else if (run) {
        path += `M${column - run + margin} ${row + margin}h${run}v1h-${run}z`;
        run = 0;
      }
    }
  }
  const dark = /^#[0-9a-f]{6}$/i.test(options.dark ?? "") ? options.dark : "#111827";
  const light = /^#[0-9a-f]{6}$/i.test(options.light ?? "") ? options.light : "#ffffff";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 8}" height="${size * 8}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${size}" height="${size}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
