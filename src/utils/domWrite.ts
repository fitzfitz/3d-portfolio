/**
 * DOM writes for rAF loops that skip a write which would change nothing.
 * Rewriting a text node, even with the same string, makes Blink lay its line
 * out again, and every layout leaves garbage on Blink's heap (LogicalLineItems
 * and friends) until its collector runs: the HUD's per-frame telemetry grew
 * the tab ~2.6 MB/s at rest (memory-infra dump, 2026-10-23). Reading
 * textContent or an inline style needs no layout, so the checks are cheap.
 */
export function setText(el: HTMLElement | null | undefined, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

type StyleProp = "color" | "width" | "backgroundColor" | "display" | "opacity" | "transform";
/** The last value setStyle wrote per element and property: the browser normalises what it reads back ("100.0%" → "100%", hex → rgb), so that cannot be compared. */
const written = new WeakMap<HTMLElement, Partial<Record<StyleProp, string>>>();

/** For styles only the loop writes: a value set from elsewhere would not be seen. */
export function setStyle(el: HTMLElement | null | undefined, prop: StyleProp, value: string): void {
  if (!el) return;
  let last = written.get(el);
  if (!last) { last = {}; written.set(el, last); }
  if (last[prop] === value) return;
  last[prop] = value;
  el.style[prop] = value;
}
