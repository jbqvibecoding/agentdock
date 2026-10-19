/**
 * Brand marks for the built-in seats. These are clean, single-weight approximations drawn to the
 * same optical size; drop the official SVGs from each vendor's brand page into `public/brand/<key>.svg`
 * and they take precedence automatically (see `iconFor`).
 */
export const BRAND: Record<string, { label: string; svg: string; tint: string; png?: string }> = {
  dot: {
    label: "ChatGPT dot",
    tint: "#10a37f",
    png: "/brand/dot.png",
    svg: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="2" y="2" width="44" height="44" rx="11" fill="#ffffff"/>
      <g fill="none" stroke="#1c1e24" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" transform="translate(24 24)">
        <path d="M0-5.5 4.8-2.8v5.6L0 5.5-4.8 2.8v-5.6Z"/>
        <path d="M-4.8-2.8v-6.4a6.2 6.2 0 0 1 11.6-3.1l3.6 6.2"/>
        <path d="M0-5.5l5.5-3.2a6.2 6.2 0 0 1 8.5 8.5l-3.6 6.2"/>
        <path d="M4.8-2.8l5.5 3.2a6.2 6.2 0 0 1-3.1 11.6h-7.2"/>
        <path d="M4.8 2.8v6.4a6.2 6.2 0 0 1-11.6 3.1l-3.6-6.2"/>
        <path d="M0 5.5l-5.5 3.2a6.2 6.2 0 0 1-8.5-8.5l3.6-6.2"/>
        <path d="M-4.8 2.8l-5.5-3.2a6.2 6.2 0 0 1 3.1-11.6h7.2"/>
      </g></svg>`,
  },
  "grok-bot": {
    label: "Grok Bot",
    tint: "#1d1d1f",
    png: "/brand/grok-bot.png",
    svg: `<svg viewBox="0 0 48 48" aria-hidden="true"><defs>
      <clipPath id="gb-clip"><rect x="2" y="2" width="44" height="44" rx="11"/></clipPath>
      <linearGradient id="gb-head" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d2d4d9"/></linearGradient></defs>
      <g clip-path="url(#gb-clip)">
        <rect x="2" y="2" width="44" height="44" rx="11" fill="#232428"/>
        <ellipse cx="22" cy="34" rx="23" ry="21" transform="rotate(-14 22 34)" fill="url(#gb-head)"/>
        <rect x="19" y="21" width="5.6" height="12.5" rx="2.8" transform="rotate(-32 21.8 27.2)" fill="#16171a"/>
        <rect x="29.5" y="16.5" width="5.2" height="12" rx="2.6" transform="rotate(-32 32.1 22.5)" fill="#16171a"/>
      </g></svg>`,
  },
  copilot: {
    label: "Copilot",
    tint: "#4fb0ff",
    svg: `<svg viewBox="0 0 48 48" aria-hidden="true"><defs>
      <linearGradient id="cp1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset=".5" stop-color="#3b82f6"/><stop offset="1" stop-color="#6366f1"/></linearGradient>
      <linearGradient id="cp2" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#f43f5e"/><stop offset=".5" stop-color="#ec4899"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs>
      <rect x="2" y="2" width="44" height="44" rx="11" fill="#ffffff"/>
      <path d="M16.5 14c7.2 0 14.5 3.6 14.5 10s-7.3 10-14.5 10" fill="none" stroke="url(#cp1)" stroke-width="5.6" stroke-linecap="round"/>
      <path d="M31.5 34c-7.2 0-14.5-3.6-14.5-10s7.3-10 14.5-10" fill="none" stroke="url(#cp2)" stroke-width="5.6" stroke-linecap="round" opacity=".88"/></svg>`,
  },
  devin: {
    label: "Devin",
    tint: "#5e5ce6",
    png: "/brand/devin.png",
    svg: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="2" y="2" width="44" height="44" rx="11" fill="#ffffff"/>
      <g fill="#0d0d0d">
        <polygon points="18,9 24,12.5 24,19.5 18,23 12,19.5 12,12.5"/>
        <polygon points="31,17 37,20.5 37,27.5 31,31 25,27.5 25,20.5"/>
        <polygon points="18,25 24,28.5 24,35.5 18,39 12,35.5 12,28.5"/>
      </g></svg>`,
  },
  muse: {
    label: "Muse",
    tint: "#0064e0",
    png: "/brand/muse.png",
    svg: `<svg viewBox="0 0 48 48" aria-hidden="true"><defs>
      <linearGradient id="ms-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0052d4"/><stop offset="1" stop-color="#0088ff"/></linearGradient></defs>
      <rect x="2" y="2" width="44" height="44" rx="11" fill="#ffffff"/>
      <path d="M11 23.5 16.5 14.5c.8-1.3 2.6-.6 2.3 1l-3 15.5c-.3 1.4 1.5 2 2.2.7l7.2-13.2c.8-1.4 2.7-.7 2.4.9l-2.4 12.2c-.3 1.4 1.5 2 2.2.7l5.2-9.5c.8-1.4 2.7-.7 2.4.9l-1.6 7.8c-.3 1.4 1.4 2 2.2.8l3.2-4.8" fill="none" stroke="url(#ms-g)" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  },
};

export const GENERIC_MARK = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="3" opacity=".6"/><path d="M24 15v12M18 21l6 6 6-6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const officialCache = new Map<string, string | null>();

/** Returns icon markup, preferring official PNG/SVG assets in public/brand/. */
export async function iconFor(key: string): Promise<string> {
  if (!officialCache.has(key)) {
    let resolved: string | null = null;
    try {
      const resSvg = await fetch(`/brand/${key}.svg`, { cache: "force-cache" });
      const ctSvg = resSvg.headers.get("content-type") || "";
      if (resSvg.ok && ctSvg.includes("svg")) {
        resolved = await resSvg.text();
      } else if (BRAND[key]?.png) {
        const resPng = await fetch(BRAND[key].png!, { method: "HEAD", cache: "force-cache" });
        const ctPng = resPng.headers.get("content-type") || "";
        if (resPng.ok && ctPng.includes("image")) {
          resolved = `<img src="${BRAND[key].png}" alt="" draggable="false">`;
        }
      }
    } catch { resolved = null; }
    officialCache.set(key, resolved);
  }
  return officialCache.get(key) || BRAND[key]?.svg || GENERIC_MARK;
}

export const tintFor = (key: string) => BRAND[key]?.tint ?? "#8e8e93";
