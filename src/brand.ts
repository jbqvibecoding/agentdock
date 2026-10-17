/**
 * Brand marks for the built-in seats. These are clean, single-weight approximations drawn to the
 * same optical size; drop the official SVGs from each vendor's brand page into `public/brand/<key>.svg`
 * and they take precedence automatically (see `iconFor`).
 */
export const BRAND: Record<string, { label: string; svg: string; tint: string }> = {
  dot: {
    label: "ChatGPT dot",
    tint: "#10a37f",
    svg: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="var(--mark-bg,#0d0d0d)"/>
      <g fill="none" stroke="var(--mark-fg,#fff)" stroke-width="3.2" stroke-linejoin="round">
        <path d="M24 11.5l10.8 6.2v12.6L24 36.5l-10.8-6.2V17.7z"/><path d="M24 18.2l5.4 3.1v6.4L24 30.8l-5.4-3.1v-6.4z"/>
        <path d="M24 11.5v6.7M34.8 17.7l-5.4 3.6M34.8 30.3l-5.4-3.6M24 36.5v-5.7M13.2 30.3l5.4-3.6M13.2 17.7l5.4 3.6"/>
      </g></svg>`,
  },
  "grok-bot": {
    label: "Grok Bot",
    tint: "#ffffff",
    svg: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="4" y="4" width="40" height="40" rx="12" fill="var(--mark-bg,#0d0d0d)"/>
      <path d="M15 16h18l-6 8h6L15 32l5.5-8H15z" fill="var(--mark-fg,#fff)"/></svg>`,
  },
  copilot: {
    label: "Copilot",
    tint: "#4fb0ff",
    svg: `<svg viewBox="0 0 48 48" aria-hidden="true"><defs>
      <linearGradient id="cp1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5ac8fa"/><stop offset="1" stop-color="#0a84ff"/></linearGradient>
      <linearGradient id="cp2" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#ff2d55"/><stop offset="1" stop-color="#bf5af2"/></linearGradient></defs>
      <path d="M16 12c8 0 16 4 16 12s-8 12-16 12" fill="none" stroke="url(#cp1)" stroke-width="6" stroke-linecap="round"/>
      <path d="M32 36c-8 0-16-4-16-12" fill="none" stroke="url(#cp2)" stroke-width="6" stroke-linecap="round"/></svg>`,
  },
  devin: {
    label: "Devin",
    tint: "#bf5af2",
    svg: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="14" fill="none" stroke="#bf5af2" stroke-width="6"/>
      <circle cx="24" cy="24" r="4" fill="#bf5af2"/></svg>`,
  },
  muse: {
    label: "Muse",
    tint: "#0668e1",
    svg: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 24c6-12 10-14 16 0s10 12 16 0" fill="none" stroke="#0668e1" stroke-width="5.5" stroke-linecap="round"/>
      <path d="M8 24c6 12 10 14 16 0s10-12 16 0" fill="none" stroke="#0668e1" stroke-width="5.5" stroke-linecap="round" opacity=".55"/></svg>`,
  },
};

export const GENERIC_MARK = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="3" opacity=".6"/><path d="M24 15v12M18 21l6 6 6-6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const officialCache = new Map<string, string | null>();

/** Returns inline SVG markup, preferring an official asset dropped into public/brand/. */
export async function iconFor(key: string): Promise<string> {
  if (!officialCache.has(key)) {
    try {
      const res = await fetch(`/brand/${key}.svg`, { cache: "force-cache" });
      const ct = res.headers.get("content-type") || "";
      officialCache.set(key, res.ok && ct.includes("svg") ? await res.text() : null);
    } catch { officialCache.set(key, null); }
  }
  return officialCache.get(key) || BRAND[key]?.svg || GENERIC_MARK;
}

export const tintFor = (key: string) => BRAND[key]?.tint ?? "#8e8e93";
