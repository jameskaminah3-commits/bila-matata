// src/frontdoor/widget-version.ts
//
// The chat script's version (a hash of the built /zaina.js), set when the
// server starts. A business's own page asks for /zaina.js?v=<version>: kept by
// phones until it changes, then fetched again at once. Websites with the
// plain /zaina.js snippet get it fresh every few minutes, as before.

let version: string | null = null;

export function setWidgetVersion(value: string | null): void {
  version = value;
}

export function widgetVersion(): string | null {
  return version;
}
