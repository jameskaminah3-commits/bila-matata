// src/brand/zaina-face.ts
//
// Zaina's face: a lifelike illustrated portrait (an original drawing, not a
// photo of anyone: she is a digital team member and never passes for a
// person), so she is the same recognisable team member on the website, in the
// chat widget and in the dashboard. Soft light and shading, textured natural
// hair, gold hoops, a slate blazer over an ivory blouse, on the studio's
// emerald. A square picture; shown in a circle.
//
// One drawing, no outside files: it is a string, so the server, the widget and
// the dashboard all use it as it is.

export const ZAINA_FACE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="Zaina">
<defs>
  <radialGradient id="zf-bg" cx="0.5" cy="0.3" r="0.8"><stop offset="0" stop-color="#34d399"/><stop offset="0.42" stop-color="#059669"/><stop offset="1" stop-color="#064e3b"/></radialGradient>
  <radialGradient id="zf-bloom" cx="0.5" cy="0.36" r="0.42"><stop offset="0" stop-color="#ecfdf5" stop-opacity="0.38"/><stop offset="1" stop-color="#ecfdf5" stop-opacity="0"/></radialGradient>
  <radialGradient id="zf-hair" cx="0.46" cy="0.3" r="0.7"><stop offset="0" stop-color="#4a2c1c"/><stop offset="0.5" stop-color="#26150d"/><stop offset="1" stop-color="#120905"/></radialGradient>
  <radialGradient id="zf-skin" cx="0.44" cy="0.38" r="0.68"><stop offset="0" stop-color="#bd8158"/><stop offset="0.55" stop-color="#a26840"/><stop offset="1" stop-color="#7c4728"/></radialGradient>
  <linearGradient id="zf-neck" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6e3f22"/><stop offset="0.45" stop-color="#93593a"/><stop offset="1" stop-color="#9c6240"/></linearGradient>
  <linearGradient id="zf-blazer" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#334155"/><stop offset="1" stop-color="#0f172a"/></linearGradient>
  <linearGradient id="zf-lapel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#475569"/><stop offset="1" stop-color="#1e293b"/></linearGradient>
  <linearGradient id="zf-blouse" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf8"/><stop offset="1" stop-color="#e7e2d8"/></linearGradient>
  <linearGradient id="zf-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fef3c7"/><stop offset="0.45" stop-color="#e0b040"/><stop offset="1" stop-color="#9a6a10"/></linearGradient>
  <linearGradient id="zf-lip" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a4237"/><stop offset="1" stop-color="#6c2e27"/></linearGradient>
  <radialGradient id="zf-iris" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#7a4a2a"/><stop offset="1" stop-color="#2a150b"/></radialGradient>
  <linearGradient id="zf-rim" x1="0" y1="0" x2="1" y2="0"><stop offset="0.6" stop-color="#6ee7b7" stop-opacity="0"/><stop offset="1" stop-color="#6ee7b7" stop-opacity="0.22"/></linearGradient>
  <radialGradient id="zf-blush" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#d9775c" stop-opacity="0.32"/><stop offset="1" stop-color="#d9775c" stop-opacity="0"/></radialGradient>
  <filter id="zf-coil" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.24" numOctaves="3" seed="7"/><feDisplacementMap in="SourceGraphic" scale="9"/></filter>
  <filter id="zf-edge" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="2" seed="2"/><feDisplacementMap in="SourceGraphic" scale="4"/></filter>
  <filter id="zf-curl" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.42" numOctaves="3" seed="4" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.62  0 0 0 0 0.42  0 0 0 0 0.28  0 0 0 2.4 -1.25"/><feComposite in2="SourceGraphic" operator="in"/></filter>
  <linearGradient id="zf-jaw" x1="0" y1="0" x2="0" y2="1"><stop offset="0.62" stop-color="#3f1f0f" stop-opacity="0"/><stop offset="1" stop-color="#3f1f0f" stop-opacity="0.32"/></linearGradient>
  <radialGradient id="zf-sheen" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#c08a62" stop-opacity="0.35"/><stop offset="1" stop-color="#c08a62" stop-opacity="0"/></radialGradient>
  <filter id="zf-soft"><feGaussianBlur stdDeviation="2.2"/></filter>
</defs>
<rect width="200" height="200" fill="url(#zf-bg)"/>
<circle cx="100" cy="86" r="86" fill="url(#zf-bloom)"/>
<!-- hair, behind the head -->
<g filter="url(#zf-coil)">
  <path d="M100 14c30 0 56 18 62 46c5 22-2 44-12 60c-6 9-18 12-26 8l-48 0c-8 4-20 1-26-8c-10-16-17-38-12-60c6-28 32-46 62-46z" fill="url(#zf-hair)"/>
</g>
<path d="M100 14c30 0 56 18 62 46c5 22-2 44-12 60c-6 9-18 12-26 8l-48 0c-8 4-20 1-26-8c-10-16-17-38-12-60c6-28 32-46 62-46z" fill="#000" filter="url(#zf-curl)" opacity="0.4"/>
<ellipse cx="80" cy="38" rx="26" ry="16" fill="url(#zf-sheen)"/>
<!-- shoulders: a slate blazer over an ivory blouse -->
<path d="M18 200c3-26 24-40 56-46l26 10l26-10c32 6 53 20 56 46z" fill="url(#zf-blazer)"/>
<path d="M84 152l16 30l16-30c-5 4-11 6-16 6s-11-2-16-6z" fill="url(#zf-blouse)"/>
<path d="M84 152l16 34l-9 14h-22l2-30c3-8 7-14 13-18z" fill="url(#zf-lapel)"/>
<path d="M116 152l-16 34l9 14h22l-2-30c-3-8-7-14-13-18z" fill="url(#zf-lapel)"/>
<path d="M100 186l-9 14M100 186l9 14" stroke="#0b1120" stroke-width="1" opacity="0.5"/>
<!-- neck -->
<path d="M87 128v24c0 8 26 8 26 0v-24z" fill="url(#zf-neck)"/>
<path d="M88 156q12 10 24 0" fill="none" stroke="url(#zf-gold)" stroke-width="1.3"/>
<circle cx="100" cy="161.5" r="1.8" fill="url(#zf-gold)"/>
<!-- ears and gold hoops -->
<path d="M66 96c-6-1-8 4-7 10s4 11 9 10z" fill="#93593a"/><path d="M134 96c6-1 8 4 7 10s-4 11-9 10z" fill="#93593a"/>
<circle cx="64" cy="122" r="7.5" fill="none" stroke="url(#zf-gold)" stroke-width="2.6"/>
<circle cx="136" cy="122" r="7.5" fill="none" stroke="url(#zf-gold)" stroke-width="2.6"/>
<!-- face -->
<path d="M66 96c0-25 15-41 34-41s34 16 34 41c0 20-6 35-17 45c-6 6-11 8-17 8s-11-2-17-8c-11-10-17-25-17-45z" fill="url(#zf-skin)"/>
<path d="M66 96c0-25 15-41 34-41s34 16 34 41c0 20-6 35-17 45c-6 6-11 8-17 8s-11-2-17-8c-11-10-17-25-17-45z" fill="url(#zf-rim)"/>
<path d="M66 96c0-25 15-41 34-41s34 16 34 41c0 20-6 35-17 45c-6 6-11 8-17 8s-11-2-17-8c-11-10-17-25-17-45z" fill="url(#zf-jaw)"/>
<ellipse cx="81" cy="109" rx="7" ry="4" fill="#e6b48e" opacity="0.2" filter="url(#zf-soft)"/><ellipse cx="119" cy="109" rx="7" ry="4" fill="#e6b48e" opacity="0.16" filter="url(#zf-soft)"/>
<ellipse cx="100" cy="86" rx="16" ry="10" fill="#d9a07a" opacity="0.18" filter="url(#zf-soft)"/>
<circle cx="78" cy="116" r="10" fill="url(#zf-blush)"/><circle cx="122" cy="116" r="10" fill="url(#zf-blush)"/>
<!-- hairline, framing the forehead -->
<g filter="url(#zf-edge)"><path d="M63 98c-4-30 14-50 37-50s41 20 37 50c-5-18-17-30-37-31c-14 0-25 7-31 16c-3 5-5 10-6 15z" fill="url(#zf-hair)"/></g>
<path d="M63 98c-4-30 14-50 37-50s41 20 37 50c-5-18-17-30-37-31c-14 0-25 7-31 16c-3 5-5 10-6 15z" fill="#000" filter="url(#zf-curl)" opacity="0.35"/>
<!-- brows -->
<path d="M74 89c5-5 13-6 20-2c-7-1-14 0-20 4z" fill="#1c110b"/>
<path d="M126 89c-5-5-13-6-20-2c7-1 14 0 20 4z" fill="#1c110b"/>
<!-- eyes -->
<path d="M76 101c5-6 13-6 18 0c-5 4-13 4-18 0z" fill="#f6f1ea"/>
<path d="M106 101c5-6 13-6 18 0c-5 4-13 4-18 0z" fill="#f6f1ea"/>
<circle cx="85.2" cy="100.6" r="4.3" fill="url(#zf-iris)"/><circle cx="114.8" cy="100.6" r="4.3" fill="url(#zf-iris)"/>
<circle cx="85.2" cy="100.6" r="2" fill="#0b0604"/><circle cx="114.8" cy="100.6" r="2" fill="#0b0604"/>
<circle cx="86.7" cy="99" r="1.2" fill="#fff"/><circle cx="116.3" cy="99" r="1.2" fill="#fff"/>
<path d="M75 101.5c5-8 14-8 20-1M105 100.5c6-7 15-7 20 1" fill="none" stroke="#140b07" stroke-width="2.1" stroke-linecap="round"/>
<path d="M75.2 101.3l-1.9-1.3M124.8 101.3l1.9-1.3" stroke="#140b07" stroke-width="1.2" stroke-linecap="round"/>
<path d="M77.5 103.5q7.5 3.5 15 0M107.5 103.5q7.5 3.5 15 0" fill="none" stroke="#6e3f22" stroke-width="0.9" opacity="0.6"/>
<!-- nose -->
<path d="M98 104c-1 5-2 9-3.5 12" fill="none" stroke="#6e3f22" stroke-width="1.1" opacity="0.35" stroke-linecap="round"/>
<path d="M93.5 116.5c2 2.6 4.3 3.2 6.5 2.2c2.2 1 4.5 0.4 6.5-2.2" fill="none" stroke="#5c321b" stroke-width="1.5" stroke-linecap="round"/>
<ellipse cx="100" cy="112" rx="3.2" ry="2" fill="#d9a07a" opacity="0.28"/>
<!-- a warm smile -->
<path d="M89.5 125q10.5 3.4 21 0q-3.6 8-10.5 8t-10.5-8z" fill="#5a221c"/>
<path d="M91.6 125.8q8.4 2.5 16.8 0q-1.6 2.9-8.4 3.2q-6.8-0.3-8.4-3.2z" fill="#fbf7f1"/>
<path d="M88.6 124.8c3.4-2.4 7.6-2.9 11.4-1.4c3.8-1.5 8-1 11.4 1.4c-7.6 1-15.2 1-22.8 0z" fill="url(#zf-lip)"/>
<path d="M91.4 130.4q8.6 5.8 17.2 0q-2.8 4.4-8.6 4.6q-5.8-0.2-8.6-4.6z" fill="#8e463b"/>
<ellipse cx="101.6" cy="132.6" rx="3.6" ry="0.9" fill="#fff" opacity="0.24"/>
<path d="M87.2 123.6q1.3 1.2 1.9 2M112.8 123.6q-1.3 1.2-1.9 2" stroke="#6e3f22" stroke-width="0.9" opacity="0.5" stroke-linecap="round"/>
<!-- name pin -->
<rect x="122" y="172" width="28" height="11" rx="5.5" fill="#fff" opacity="0.96"/><circle cx="128.5" cy="177.5" r="2.4" fill="#059669"/><rect x="133" y="176" width="12" height="3" rx="1.5" fill="#059669" opacity="0.55"/>
</svg>`;

/** The same drawing as an address a page, widget or dashboard can use as an image. */
export const ZAINA_FACE_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(ZAINA_FACE_SVG)}`;
