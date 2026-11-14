// src/brand/zaina-face.ts
//
// Zaina's face: an illustrated portrait (an original drawing, not a photo of
// anyone), so she is the same recognisable team member on the website, in the
// chat widget and in the dashboard. A square picture; shown in a circle.
//
// One drawing, no outside files: it is a string, so the server, the widget and
// the dashboard all use it as it is.

export const ZAINA_FACE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="Zaina">
<defs>
  <linearGradient id="zf-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14b8a6"/><stop offset="1" stop-color="#0f766e"/></linearGradient>
  <linearGradient id="zf-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a86a45"/><stop offset="1" stop-color="#8f5836"/></linearGradient>
  <linearGradient id="zf-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fb7d62"/><stop offset="1" stop-color="#e5533d"/></linearGradient>
  <radialGradient id="zf-glow" cx="0.5" cy="0.35" r="0.6"><stop offset="0" stop-color="#fff" stop-opacity="0.28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>
<rect width="200" height="200" fill="url(#zf-bg)"/>
<rect width="200" height="200" fill="url(#zf-glow)"/>
<!-- shoulders and top -->
<path d="M18 200c2-34 30-52 82-52s80 18 82 52z" fill="url(#zf-top)"/>
<path d="M78 150c6 16 38 16 44 0l-6-8H84z" fill="#8f5836"/>
<path d="M82 148c4 12 32 12 36 0" fill="none" stroke="#f9cdb9" stroke-width="3" stroke-linecap="round" opacity="0.55"/>
<!-- neck -->
<path d="M86 118h28v28c0 6-28 6-28 0z" fill="#8a5233"/>
<path d="M86 134c8 7 20 7 28 0v-8c-8 6-20 6-28 0z" fill="#7a4529" opacity="0.55"/>
<!-- hair behind -->
<g fill="#1c130f">
  <circle cx="100" cy="72" r="46"/>
  <circle cx="66" cy="82" r="22"/><circle cx="134" cy="82" r="22"/>
  <circle cx="58" cy="64" r="18"/><circle cx="142" cy="64" r="18"/>
  <circle cx="76" cy="46" r="20"/><circle cx="124" cy="46" r="20"/>
  <circle cx="100" cy="38" r="22"/>
  <circle cx="52" cy="92" r="12"/><circle cx="148" cy="92" r="12"/>
</g>
<!-- ears and earrings -->
<ellipse cx="65" cy="100" rx="6" ry="9" fill="#96593a"/><ellipse cx="135" cy="100" rx="6" ry="9" fill="#96593a"/>
<circle cx="64" cy="116" r="7.500" fill="none" stroke="#f5b83d" stroke-width="3"/><circle cx="136" cy="116" r="7.500" fill="none" stroke="#f5b83d" stroke-width="3"/>
<!-- face -->
<ellipse cx="100" cy="100" rx="35" ry="41" fill="url(#zf-skin)"/>
<!-- hairline -->
<path d="M64 88c-2-30 20-44 36-44s38 14 36 44c-6-16-20-26-36-26s-30 10-36 26z" fill="#1c130f"/>
<!-- brows -->
<path d="M75 90q9-6 18-1" fill="none" stroke="#1c130f" stroke-width="3.200" stroke-linecap="round"/>
<path d="M107 89q9-5 18 1" fill="none" stroke="#1c130f" stroke-width="3.200" stroke-linecap="round"/>
<!-- eyes -->
<g>
  <path d="M77 100q8-7 16 0q-8 6-16 0z" fill="#fff"/><circle cx="85" cy="100" r="4.600" fill="#2a1710"/><circle cx="86.600" cy="98.400" r="1.500" fill="#fff"/>
  <path d="M107 100q8-7 16 0q-8 6-16 0z" fill="#fff"/><circle cx="115" cy="100" r="4.600" fill="#2a1710"/><circle cx="116.600" cy="98.400" r="1.500" fill="#fff"/>
  <path d="M76 99q9-9 18 0M106 99q9-9 18 0" fill="none" stroke="#1c130f" stroke-width="2.400" stroke-linecap="round"/>
</g>
<!-- cheeks and nose -->
<circle cx="76" cy="114" r="7" fill="#e9806a" opacity="0.26"/><circle cx="124" cy="114" r="7" fill="#e9806a" opacity="0.26"/>
<path d="M96 108q4 7 8 0" fill="none" stroke="#6b3d26" stroke-width="2.200" stroke-linecap="round" opacity="0.7"/>
<!-- smile -->
<path d="M85 120q15 4 30 0q-3 15-15 15t-15-15z" fill="#7d2b26"/>
<path d="M88 121q12 3 24 0q-2 6-12 6t-12-6z" fill="#fff"/>
<path d="M85 120q15 4 30 0" fill="none" stroke="#6a221e" stroke-width="2" stroke-linecap="round"/>
<!-- name pin -->
<rect x="119" y="158" width="26" height="12" rx="6" fill="#fff" opacity="0.95"/><circle cx="126" cy="164" r="2.500" fill="#0f766e"/><rect x="131" y="162" width="10" height="3" rx="1.500" fill="#0f766e" opacity="0.6"/>
</svg>`;

/** The same drawing as an address a page, widget or dashboard can use as an image. */
export const ZAINA_FACE_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(ZAINA_FACE_SVG)}`;
