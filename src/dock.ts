import { api, applyTheme, fmtTime, validAccent, type AppSettings, type CheckRow, type DockState, type GroupContact, type HostInfo, type Member, type RelayOutcome, type RelayReport, type Room, type SeatView } from "./api";
import { iconFor, tintFor } from "./brand";
import { resolveLang, setLang, t, type MsgKey } from "./i18n";

const dock = document.getElementById("dock") as HTMLDivElement;
const bar = document.getElementById("bar") as HTMLDivElement;
const collapsed = document.getElementById("collapsed") as HTMLDivElement;

let state: DockState = { phase: { phase: "idle" }, muted: false, expanded: false };
let seats: SeatView[] = [];
let settings: AppSettings | null = null;
let hoverSeat: string | null = null;
/** The last committed switch that pasted context into the seat now being called. */
let carried: { to: string; lines: number } | null = null;
// round-table
/** Picking seats on the idle pill for a group call, with each seat's preflight rows. */
let picking = false;
const picked: string[] = [];
/** Remote members (yobiru) ticked in the picker. */
const pickedRemote: string[] = [];
let preflight = new Map<string, CheckRow[]>();
/** 拉群 / 加人: tapping a seat adds it to the room instead of passing the floor. */
let adding = false;
let groups: GroupContact[] = [];
/** The relay note for the seat being dialled in a room, and what became of it. */
let relayInfo: { id: string; to: string; lines: number; mode: string; outcome?: RelayOutcome } | null = null;
/** Free discussion: the floor holder's countdown in seconds, and a holder that has not started. */
let countdown: number | null = null;
let nudged: { seat: string; turn: number } | null = null;
/** Until then, a tap on 自由讨论 in a room without consent to send is the agreeing second tap. */
let discussArmed = 0;
/** Why a remote member's request did not go out (shown for a few seconds). */
let remoteError: { member: string; why: string; until: number } | null = null;
const iconCache = new Map<string, string>();

const SVG = {
  collapse: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4v6M6.2 6.2a5.4 5.4 0 1 0 7.6 0"/></svg>`,
  mic: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/></svg>`,
  micOff: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M3 3l14 14"/></svg>`,
  // phone.down.fill proportions: a thick receiver band with rounded, drooping ear/mouth pads
  hangup: `<svg viewBox="3 5 18 14" fill="currentColor"><path d="M12 8.4c3.4 0 6.5 1.3 8.6 3.5.8.8.8 2.1 0 3l-1.3 1.3a2 2 0 0 1-2.5.3l-1.4-.9a1.9 1.9 0 0 1-.9-1.8l.1-1c-1.7-.5-3.5-.5-5.2 0l.1 1c.1.7-.3 1.4-.9 1.8l-1.4.9a2 2 0 0 1-2.5-.3l-1.3-1.3c-.8-.9-.8-2.2 0-3C5.5 9.7 8.6 8.4 12 8.4z"/></svg>`,
  eye: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4.75c-3.4 0-6.1 2.3-7.4 4.5a1.4 1.4 0 0 0 0 1.5c1.3 2.2 4 4.5 7.4 4.5s6.1-2.3 7.4-4.5a1.4 1.4 0 0 0 0-1.5C16.1 7.05 13.4 4.75 10 4.75z"/><circle cx="10" cy="10" r="2.6"/></svg>`,
  plus: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 4v12M4 10h12"/></svg>`,
  group: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="7" r="2.6"/><path d="M2.8 15.5a4.7 4.7 0 0 1 9.4 0"/><circle cx="13.8" cy="7.6" r="2.2"/><path d="M13.4 11.4a4.2 4.2 0 0 1 4.1 4.1"/></svg>`,
  next: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h10.5M10.5 5.5 15 10l-4.5 4.5"/></svg>`,
  panel: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 5.5h12M4 10h12M4 14.5h8"/></svg>`,
  addPerson: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="7" r="2.8"/><path d="M2.8 16a5.2 5.2 0 0 1 10.4 0M15.5 6.5v5M13 9h5"/></svg>`,
  // a member on another machine: a small network mark
  net: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2.2 2 3.2 4.3 3.2 7s-1 5-3.2 7c-2.2-2-3.2-4.3-3.2-7s1-5 3.2-7z"/></svg>`,
};

const remoteMembers = () => settings?.remote_members ?? [];
const remoteName = (id: string) => remoteMembers().find((m) => m.id === id)?.name ?? id;
/** A remote member's mark: its initial over a tint, with a network badge. */
const remoteMark = (id: string) => `<span class="rm-initial">${escapeHtml([...remoteName(id).trim()][0]?.toUpperCase() ?? "?")}</span><span class="rm-net">${SVG.net}</span>`;

// Collapsed glyphs: an SF-style waveform (bars breathe; in a call they talk), or mic.slash when muted.
const DOT_WAVE = `<svg class="dot-glyph" viewBox="0 0 20 20" aria-hidden="true">${[[3, 4.5], [6.5, 8.5], [10, 13], [13.5, 8.5], [17, 4.5]]
  .map(([x, h], i) => `<rect class="b b${i}" x="${x - 0.95}" y="${10 - h / 2}" width="1.9" height="${h}" rx="0.95"/>`).join("")}</svg>`;
const DOT_MUTED = `<svg class="dot-glyph dot-mic" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M3 3l14 14"/></svg>`;

async function seatIcon(s: SeatView): Promise<string> {
  const key = s.icon.kind === "custom" ? `custom:${s.id}:${s.icon.path}` : `builtin:${s.icon.key}`;
  if (iconCache.has(key)) return iconCache.get(key)!;
  let html: string;
  if (s.icon.kind === "custom") {
    const data = await api.invoke<string | null>("seat_icon_data", { seatId: s.id });
    html = data ? `<img src="${data}" alt="">` : await iconFor(s.id);
  } else {
    html = await iconFor(s.icon.key);
  }
  iconCache.set(key, html);
  return html;
}

const seatById = (id: string) => seats.find((s) => s.id === id);
const enabledSeats = () => seats.filter((s) => s.enabled);

function currentSeatId(): string | null {
  const p = state.phase;
  return p.phase === "idle" ? null : p.phase === "switching" ? p.from : p.seat;
}

// ───────── layout: the window is resized to exactly the glass shape ─────────
const H = 56;
const BTN = 44, PAD = 6;
let liveScale: number | null = null;
const currentScale = () => Math.min(1.6, Math.max(0.7, liveScale ?? settings?.dock_scale ?? 1));

const vertical = () => dock.dataset.orient === "vertical";

/** Length of the bar along its main axis, measured from the real flex content so text fits. */
function measureBar(s = currentScale()): number {
  const axis = vertical() ? "height" : "width";
  bar.style[axis] = "max-content";
  const pad = Math.round(PAD * s);
  const btn = Math.round(BTN * s);
  const len = Math.ceil(vertical() ? bar.scrollHeight : bar.scrollWidth) + pad * 2;
  bar.style[axis] = "";
  return Math.max(len, btn + pad * 2);
}

let lastSize = { w: 0, h: 0 };
let pendingShrink: number | undefined;
let booting = true;
// macOS: the native window springs between shapes (Rust), and the pill just fills it (CSS 100vw/vh).
const nativeMorph = () => document.documentElement.dataset.morph === "1";
async function fit(form: "dot" | "pet" | "bar") {
  const s = currentScale();
  const hBar = Math.round(H * s);
  let w: number, h: number;
  if (form === "dot") { w = Math.round(36 * s); h = Math.round(36 * s); }
  else if (form === "pet") { w = Math.round(92 * s); h = Math.round(40 * s); }
  else if (vertical()) { w = hBar; h = measureBar(s); }
  else { w = measureBar(s); h = hBar; }
  if (nativeMorph()) { dock.style.removeProperty("width"); dock.style.removeProperty("height"); }
  else { dock.style.width = `${w}px`; dock.style.height = `${h}px`; }
  if (w === lastSize.w && h === lastSize.h) return;   // hover re-layouts must not spam resize_dock
  const grow = w > lastSize.w || h > lastSize.h;
  window.clearTimeout(pendingShrink);
  const minSide = Math.round(36 * 0.7);
  // direct manipulation (edge-resize) and the first layout snap; everything else springs
  const animate = !booting && liveScale === null && !settings?.reduce_motion;
  const resize = () => api.invoke("resize_dock", { width: Math.max(w, minSide), height: Math.max(h, minSide), animate });
  if (api.isTauri || grow || liveScale !== null) await resize();
  else pendingShrink = window.setTimeout(resize, settings?.reduce_motion ? 140 : 480);
  lastSize = { w, h };
}

// ───────── render ─────────
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function button(cls: string, svg: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", `btn ${cls}`, svg);
  b.type = "button";
  b.dataset.k = label;   // stable identity across 1 Hz re-renders, so the lens/hover state carries over
  b.setAttribute("aria-label", label);
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
}

async function seatButton(s: SeatView, small: boolean, active: boolean, onTap?: () => void): Promise<HTMLButtonElement> {
  const b = button(`seat${small ? " sm" : ""}${active ? " active" : ""}${s.enabled ? "" : " disabled"}`, "", s.name, () => {
    if (onTap) { onTap(); return; }
    // pending = on the Dock as a placeholder; there is nothing to dial yet
    if (!s.enabled || s.status === "pending") return;
    api.invoke("call_seat", { seatId: s.id });
  });
  b.dataset.seat = s.id;
  b.dataset.k = `seat:${s.id}`;
  b.dataset.status = s.status;
  if (settings?.show_names !== "never") b.title = `${s.name} · ${seatHint(s)}`;
  b.style.setProperty("--seat-tint", tintFor(seatBrand(s)));
  const mark = el("div", "mark", await seatIcon(s));
  b.append(mark, el("i", "badge"));
  b.addEventListener("mouseenter", () => { hoverSeat = s.id; renderStatusText(); });
  b.addEventListener("mouseleave", () => { hoverSeat = null; renderStatusText(); });
  return b;
}

let prevForm = ""; let prevIdle = true; let prevPhase = "";
let lastDotGlyph = "";
let statusEl: HTMLDivElement | null = null;
function renderStatusText() {
  if (!statusEl || state.phase.phase !== "idle") return;
  // The reference pill carries no text while idle; seat names are tooltips (see seatButton).
  // "always" keeps the hovered name inline, measured into the pill width so it never overlaps.
  const s = hoverSeat ? seatById(hoverSeat) : null;
  if (s && settings?.show_names === "always") {
    statusEl.innerHTML = `<div class="name">${escapeHtml(s.name)}</div><div class="sub">${seatHint(s)}</div>`;
    statusEl.classList.remove("idle");
  } else {
    statusEl.innerHTML = "";
    statusEl.classList.add("idle");
  }
  if (dock.dataset.form === "bar") void fit("bar");
}

/** The brand a seat wears (added seats get ids like "gemini-app-x1y2"). */
const seatBrand = (s: SeatView) => (s.icon.kind === "builtin" ? s.icon.key : s.id);
const seatHint = (s: SeatView) => t(!s.enabled ? "dock.disabled" : s.status === "pending" ? "dock.pending" : s.status === "needs_auth" ? "dock.needsAuth" : s.silent ? "dock.silent" : "dock.appCall");
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function render() {
  const p = state.phase;
  dock.dataset.phase = p.phase;
  dock.dataset.muted = String(state.muted);
  const cur = currentSeatId();
  const curSeat = cur ? seatById(cur) : null;
  dock.style.setProperty("--seat-tint", curSeat ? tintFor(seatBrand(curSeat)) : "");

  const form: "dot" | "pet" | "bar" = state.expanded ? "bar" : settings?.default_form === "pet" ? "pet" : "dot";
  dock.dataset.form = form;
  if ((form === "bar") !== (prevForm === "bar") || (p.phase === "idle") !== prevIdle) touchIdle();   // became idle+expanded → start the countdown
  // controls bloom from the centre when the pill opens or its layout changes phase, not on 1 Hz ticks
  const entering = form === "bar" && (prevForm !== "bar" || p.phase !== prevPhase);
  prevForm = form; prevIdle = p.phase === "idle"; prevPhase = p.phase;

  // collapsed content
  if (form === "pet") {
    const pet = curSeat ?? enabledSeats()[0];
    collapsed.innerHTML = "";
    const av = el("div", "pet-avatar", pet ? await seatIcon(pet) : "");
    const lines = el("div", "pet-lines", "<i></i><i></i>");
    collapsed.append(av, lines);
    lastDotGlyph = "";
    collapsed.title = p.phase === "in_call" ? `${pet?.name} · ${fmtTime(p.elapsed_secs)}` : t("dock.expand");
  } else {
    // only swap the glyph when it changes, so the breathing bars don't restart every tick
    const glyph = state.muted ? DOT_MUTED : DOT_WAVE;
    if (glyph !== lastDotGlyph) { collapsed.innerHTML = glyph; lastDotGlyph = glyph; }
    collapsed.title = p.phase === "in_call" ? t("dock.inCallExpand", { time: fmtTime(p.elapsed_secs) }) : t("dock.expand");
  }

  if (form !== "bar") { await fit(form); kickLens(); syncVad(); return; }
  collapsed.removeAttribute("title");

  // expanded bar
  const frag = document.createDocumentFragment();
  const micBtn = button(state.muted ? "amber" : "", state.muted ? SVG.micOff : SVG.mic, t(state.muted ? "dock.unmute" : "dock.mute"), () => api.invoke("toggle_mute"));
  micBtn.id = "mic";
  micBtn.dataset.k = "mic";

  if (state.room) {
    await renderRoom(frag, micBtn);
  } else if (p.phase === "idle") {
    frag.append(button("ghost", SVG.collapse, t("dock.collapse"), () => api.invoke("set_expanded", { expanded: false })));
    frag.append(micBtn);
    statusEl = el("div", "status idle");
    frag.append(statusEl);
    frag.append(el("div", "divider"));
    for (const s of seats.filter((s) => s.enabled || s.status === "pending")) frag.append(picking ? await pickButton(s) : await seatButton(s, false, false));
    if (picking) for (const rm of remoteMembers()) frag.append(remotePickButton(rm.id));
    const pickedN = picked.length + pickedRemote.length;
    if (picking && pickedN >= 2 && picked.length >= 1) {
      const call = el("button", "undo callgroup", escapeHtml(t("room.callN", { n: pickedN })));
      call.type = "button";
      call.dataset.k = "callgroup";
      call.addEventListener("click", () => void startPicked());
      frag.append(call);
    }
    if (!picking) for (const g of groups) frag.append(await groupButton(g));
    frag.append(button(`ghost group-toggle${picking ? " on" : ""}`, SVG.group, t(picking ? "room.pickCancel" : "room.pick"), () => void togglePicking()));
    if (!picking) frag.append(button("ghost add", SVG.plus, t("dock.addAgent"), () => api.invoke("open_settings")));
    frag.append(grip());
    renderStatusTextInto(statusEl);
    if (picking) statusEl.innerHTML = `<div class="name">${escapeHtml(t("room.picking"))}</div><div class="sub">${escapeHtml(t("room.pickedN", { n: picked.length + pickedRemote.length }))}</div>`;
  } else if (p.phase === "calling" || p.phase === "in_call") {
    const s = seatById(p.seat);
    const av = el("div", "avatar", s ? await seatIcon(s) : "");
    av.dataset.k = "avatar";
    av.title = t("dock.collapse");
    av.addEventListener("click", () => api.invoke("set_expanded", { expanded: false }));
    frag.append(av);
    const st = el("div", "status");
    const calling = carried?.to === p.seat ? `${t("dock.calling")} · ${t("dock.carried", { n: carried.lines })}` : t("dock.calling");
    st.innerHTML = `<div class="name">${escapeHtml(s?.name ?? p.seat)}</div><div class="sub">${p.phase === "calling" ? escapeHtml(calling) : `${escapeHtml(s?.service ?? "")} · ${fmtTime(p.elapsed_secs)}`}</div>`;
    frag.append(st);
    const wave = el("canvas", "wave") as HTMLCanvasElement;
    if (vertical()) { wave.width = 68; wave.height = 168; } else { wave.width = 168; wave.height = 68; }
    frag.append(wave);
    waveCanvas = wave;
    frag.append(micBtn);
    const others = enabledSeats().filter((x) => x.id !== p.seat);
    // 拉群: the other seats join this call as a room instead of taking it over
    if (others.length) frag.append(button(`ghost addgroup${adding ? " on" : ""}`, SVG.addPerson, t(adding ? "room.addDone" : "room.pull"), () => { adding = !adding; void render(); }));
    frag.append(button("red", SVG.hangup, t("dock.hangup"), () => api.invoke("hangup")));
    if (others.length) frag.append(el("div", "divider"));
    for (const o of others) frag.append(adding ? await addableButton(o) : await seatButton(o, true, false));
  } else if (p.phase === "switching") {
    const to = seatById(p.to), from = seatById(p.from);
    const av = el("div", "avatar", to ? await seatIcon(to) : "");
    frag.append(av);
    const st = el("div", "status");
    st.innerHTML = `<div class="name">${escapeHtml(t("dock.switchTo", { name: to?.name ?? p.to }))}</div><div class="sub">${escapeHtml(t("dock.hangingUp", { name: from?.name ?? p.from }))}${state.muted ? ` · ${escapeHtml(t("dock.muted"))}` : ""}</div>`;
    frag.append(st);
    const undo = el("button", "undo", escapeHtml(t("dock.undo", { n: p.undo_secs_left })));
    undo.type = "button";
    undo.dataset.k = "undo";
    undo.addEventListener("click", () => api.invoke("undo_switch"));
    frag.append(undo);
    // warm transfer: on by default, one click skips it for this switch (web seats have a composer)
    if (settings?.warm_transfer !== false && to?.silent) {
      const carry = el("button", `carry${p.carry ? " on" : ""}`, escapeHtml(t("dock.carry")));
      carry.type = "button";
      carry.dataset.k = "carry";
      carry.setAttribute("aria-pressed", String(p.carry));
      carry.title = t(p.carry ? "dock.carryOn" : "dock.carryOff", { name: to.name });
      carry.addEventListener("click", () => api.invoke("set_carry", { carry: !p.carry }));
      frag.append(carry);
    }
    frag.append(micBtn);
    frag.append(button("red", SVG.hangup, t("dock.hangupAll"), () => api.invoke("hangup")));
    frag.append(el("div", "divider"));
    for (const o of enabledSeats()) frag.append(await seatButton(o, true, o.id === p.to));
  } else if (p.phase === "needs_human") {
    const s = seatById(p.seat);
    frag.append(el("div", "avatar", s ? await seatIcon(s) : ""));
    const st = el("div", "status");
    // the state machine's own reason is a key; driver reasons arrive already in the user's language
    const reason = p.reason === "call_timeout" ? t("dock.callTimeout") : p.reason;
    st.innerHTML = `<div class="name">${escapeHtml(t("dock.needsYou"))}</div><div class="sub">${escapeHtml(reason)}</div>`;
    st.title = reason;
    frag.append(st);
    frag.append(button("", SVG.eye, t("dock.showPage"), () => api.invoke("show_seat", { seatId: p.seat, visible: true })));
    frag.append(button("red", SVG.hangup, t("dock.hangup"), () => api.invoke("hangup")));
  }

  bar.replaceChildren(frag);
  if (entering && !settings?.reduce_motion) {
    const kids = Array.from(bar.children) as HTMLElement[];
    const mid = (kids.length - 1) / 2;
    kids.forEach((k, i) => { k.style.setProperty("--d", String(Math.abs(i - mid))); k.classList.add("enter"); });
  }
  carryLensAcrossRender();
  await fit("bar");
  kickLens();
  if (p.phase === "in_call" || p.phase === "calling") startWave(); else stopWave();
  syncVad();
}

function renderStatusTextInto(e: HTMLDivElement) { statusEl = e; renderStatusText(); }

// ───────── round-table: one voice floor, the others briefed by a note when they take it ─────────
const troubleText = (tr: string) => tr === "dial_timeout" ? t("room.troubleDial") : tr === "remote_failed" ? t("room.troubleRemote") : tr === "remote_timeout" ? t("room.troubleRemoteTimeout") : tr;
const roomTitle = () => state.room?.name ?? t("room.adhoc", { n: state.room?.members.length ?? 0 });

/** What the Dock says about the note sent to the seat being dialled. */
function relayLine(seat: string): string | null {
  const r = relayInfo;
  if (!r || r.to !== seat) return null;
  const n = { n: r.lines };
  if (r.mode === "paste" || r.outcome === "pasted") return t("room.relayPasted", n);
  if (r.mode === "none") return t("room.relayNone");
  switch (r.outcome) {
    case "sent": return t("room.relayed", n);
    case "uncertain": return t("room.relayUncertain");
    case "not_sent": return t("room.relayNotSent");
    default: return t("room.relaying", n);
  }
}

async function renderRoom(frag: DocumentFragment, micBtn: HTMLButtonElement) {
  const room = state.room!;
  const p = state.phase;
  const rf = room.remote ?? null;
  const remoteHolds = !!rf && rf.stage !== "pending";
  const floor = currentSeatId();
  const floorSeat = floor ? seatById(floor) : null;
  const av = el("div", `avatar room-av${remoteHolds ? " remote" : ""}`, remoteHolds ? remoteMark(rf!.member) : floorSeat ? await seatIcon(floorSeat) : SVG.group);
  av.dataset.k = "avatar";
  av.title = t("dock.collapse");
  av.addEventListener("click", () => api.invoke("set_expanded", { expanded: false }));
  frag.append(av);
  const name = floorSeat?.name ?? floor ?? "";
  const d = room.disc;
  let sub = p.phase === "idle" ? t("room.noFloor")
    : p.phase === "calling" ? [t("room.calling", { name }), relayLine(p.seat)].filter(Boolean).join(" · ")
    : p.phase === "in_call" ? [t("room.speaking", { name, time: fmtTime(p.elapsed_secs) }), nudged?.seat === p.seat && nudged.turn === room.turn ? t("room.nudge") : ""].filter(Boolean).join(" · ")
    : p.phase === "switching" ? (d?.pending ? `${t("room.autoPassTo", { name: seatById(p.to)?.name ?? p.to })} · ${t(`room.why.${d.pending}` as MsgKey)}` : t("room.passTo", { name: seatById(p.to)?.name ?? p.to }))
    : `${t("dock.needsYou")} · ${p.reason === "call_timeout" ? t("dock.callTimeout") : p.reason}`;
  if (rf) {
    const rname = remoteName(rf.member);
    sub = rf.stage === "pending"
      ? (rf.origin ? `${t("room.autoPassTo", { name: rname })} · ${t(`room.why.${rf.origin}` as MsgKey)}` : t("room.passTo", { name: rname }))
      : t(`room.remote.${rf.stage}` as MsgKey, { name: rname });
  }
  if (remoteError && remoteError.until > Date.now()) sub = `${t("room.remoteError", { name: remoteName(remoteError.member), why: t(`rm.why.${remoteError.why}` as MsgKey) })} · ${sub}`;
  if (d?.run.state === "paused") sub = `${t(`room.paused.${d.run.why}` as MsgKey)} · ${sub}`;
  const st = el("div", "status");
  st.innerHTML = `<div class="name">${escapeHtml(roomTitle())}</div><div class="sub">${escapeHtml(sub)}${state.muted ? ` · ${escapeHtml(t("dock.muted"))}` : ""}</div>`;
  st.title = sub;
  frag.append(st);
  if (p.phase === "in_call" || p.phase === "calling") {
    const wave = el("canvas", "wave") as HTMLCanvasElement;
    if (vertical()) { wave.width = 68; wave.height = 168; } else { wave.width = 168; wave.height = 68; }
    frag.append(wave);
    waveCanvas = wave;
  }
  if (p.phase === "in_call" && countdown !== null && d?.run.state === "running") {
    const more = el("button", "carry extend", escapeHtml(t("room.extend", { n: countdown })));
    more.type = "button";
    more.dataset.k = "extend";
    more.title = t("room.extendTip", { name });
    more.addEventListener("click", () => { countdown = null; void api.invoke("floor_extend"); void render(); });
    frag.append(more);
  }
  if (rf?.stage === "pending") {
    // a pass to a remote member: the same undo, and the same consent chip
    const undo = el("button", "undo", escapeHtml(t("dock.undo", { n: rf.undo_secs_left })));
    undo.type = "button";
    undo.dataset.k = "undo";
    undo.addEventListener("click", () => api.invoke("undo_switch"));
    frag.append(undo);
    const chip = el("button", `carry${rf.carry ? " on" : ""}`, escapeHtml(t("room.relayChip")));
    chip.type = "button";
    chip.dataset.k = "carry";
    chip.setAttribute("aria-pressed", String(rf.carry));
    chip.title = t("room.relayRemote", { name: remoteName(rf.member) }) + (room.relay ? "" : ` · ${t("room.relayConsent")}`);
    chip.addEventListener("click", () => api.invoke("set_carry", { carry: !rf.carry }));
    frag.append(chip);
  } else if (remoteHolds) {
    for (const [how, key] of [["cut_in", "room.cutIn"], ["skipped", "room.skip"]] as const) {
      const b = el("button", `carry remote-${how}`, escapeHtml(t(key)));
      b.type = "button";
      b.dataset.k = `remote-${how}`;
      b.title = t(`${key}Tip` as MsgKey, { name: remoteName(rf!.member) });
      b.addEventListener("click", () => api.invoke("remote_end", { how }));
      frag.append(b);
    }
  }
  if (p.phase !== "switching" && !rf) frag.append(modeChip(room));
  if (p.phase === "switching") {
    const undo = el("button", "undo", escapeHtml(t("dock.undo", { n: p.undo_secs_left })));
    undo.type = "button";
    undo.dataset.k = "undo";
    undo.addEventListener("click", () => api.invoke("undo_switch"));
    frag.append(undo);
    const to = seatById(p.to);
    if (to?.relay || to?.silent) {
      // sending what was said to another vendor needs consent: off until tapped in an ad-hoc room
      const chip = el("button", `carry${p.carry ? " on" : ""}`, escapeHtml(t(to.relay ? "room.relayChip" : "room.relayChipPaste")));
      chip.type = "button";
      chip.dataset.k = "carry";
      chip.setAttribute("aria-pressed", String(p.carry));
      chip.title = t(to.relay ? "room.relaySend" : "room.relayPaste", { name: to.name }) + (room.relay ? "" : ` · ${t("room.relayConsent")}`);
      chip.addEventListener("click", () => api.invoke("set_carry", { carry: !p.carry }));
      frag.append(chip);
    }
  }
  if (p.phase === "needs_human") frag.append(button("", SVG.eye, t("dock.showPage"), () => api.invoke("show_seat", { seatId: p.seat, visible: true })));
  frag.append(micBtn);
  frag.append(button("next", SVG.next, t("room.next"), () => api.invoke("floor_next")));
  frag.append(button("panel", SVG.panel, t("room.panel"), () => api.invoke("open_room_panel")));
  frag.append(button(`ghost addgroup${adding ? " on" : ""}`, SVG.addPerson, t(adding ? "room.addDone" : "room.add"), () => { adding = !adding; void render(); }));
  frag.append(button("red", SVG.hangup, t("room.end"), () => api.invoke("hangup")));
  frag.append(el("div", "divider"));
  for (const m of room.members) {
    if (m.who.kind === "remote") { frag.append(remoteButton(m, rf)); continue; }
    const s = seatById(m.who.id);
    if (!s) continue;
    const live = m.who.id === floor;
    const b = await seatButton(s, true, live || (p.phase === "switching" && m.who.id === p.to), () => {
      // a member with a badge needs a look at its page; any other tap passes the floor
      if (m.trouble) void api.invoke("show_seat", { seatId: s.id, visible: true });
      else void api.invoke("call_seat", { seatId: s.id });
    });
    b.classList.add("member");
    b.dataset.floor = live ? "live" : "seated";
    if (m.trouble) { b.dataset.trouble = "1"; b.title = `${s.name} · ${troubleText(m.trouble)}`; }
    frag.append(b);
  }
  if (adding) for (const s of enabledSeats().filter((x) => !room.members.some((m) => m.who.id === x.id))) frag.append(await addableButton(s));
}

const prettyKeys = (k: string) => document.documentElement.dataset.os === "macos"
  ? k.split("+").map((x) => ({ Alt: "⌥", Option: "⌥", Shift: "⇧", Control: "⌃", Ctrl: "⌃", Super: "⌘", Cmd: "⌘", Command: "⌘", CommandOrControl: "⌘" } as Record<string, string>)[x] ?? x).join("")
  : k;

/** 自由讨论 / 暂停讨论 / 继续讨论. Turning a discussion on sends what was said to the next member,
 *  so a room without that consent takes two taps: the first one says so, the second agrees. */
function modeChip(room: Room): HTMLButtonElement {
  const d = room.disc;
  const armed = !d && Date.now() < discussArmed;
  const label = !d ? (armed ? "room.discussConfirm" : "room.discuss") : d.run.state === "running" ? "room.discussPause" : "room.discussResume";
  const chip = el("button", `carry mode${d ? " on" : ""}${armed ? " armed" : ""}`, escapeHtml(t(label)));
  chip.type = "button";
  chip.dataset.k = "mode";
  chip.setAttribute("aria-pressed", String(!!d));
  chip.title = !d ? t(armed ? "room.discussConsent" : "room.discussTip", { keys: prettyKeys(settings?.hotkeys.discussion ?? "Alt+D") })
    : d.run.state === "running" ? t("room.discussLeft", { n: d.hops_left }) : t(`room.paused.${d.run.why}` as MsgKey);
  chip.addEventListener("click", () => {
    if (d) { void api.invoke(d.run.state === "running" ? "discussion_pause" : "discussion_resume"); return; }
    if (room.relay || armed) { discussArmed = 0; void api.invoke("set_room_mode", { mode: "discussion", consent: true }); return; }
    discussArmed = Date.now() + 5000;
    window.setTimeout(() => { if (discussArmed && Date.now() >= discussArmed) { discussArmed = 0; void render(); } }, 5100);
    void render();
  });
  return chip;
}

/** A remote member in the room: a tap passes it the floor; its ring shows how its turn is going. */
function remoteButton(m: Member, rf: Room["remote"]): HTMLButtonElement {
  const id = m.who.id;
  const name = remoteName(id);
  const mine = rf?.member === id ? rf : null;
  const b = button(`seat sm member remote${mine && mine.stage !== "pending" ? " active" : ""}`, `<div class="mark">${remoteMark(id)}</div><i class="badge"></i>`, name, () => {
    if (!m.trouble) void api.invoke("pass_remote", { memberId: id });
  });
  b.dataset.remote = id;
  b.dataset.k = `remote:${id}`;
  b.dataset.floor = mine && mine.stage !== "pending" ? "live" : "seated";
  if (mine) b.dataset.stage = mine.stage;
  b.title = m.trouble ? `${name} · ${troubleText(m.trouble)}` : `${name} · ${t("room.remoteMember")}`;
  if (m.trouble) b.dataset.trouble = "1";
  return b;
}

/** A seat that joins the room (or turns a 1:1 call into one) when tapped. */
async function addableButton(s: SeatView): Promise<HTMLButtonElement> {
  const b = await seatButton(s, true, false, () => { void api.invoke("room_add", { seatId: s.id }); });
  b.classList.add("addable");
  b.title = t("room.addOne", { name: s.name });
  b.dataset.k = `add:${s.id}`;
  return b;
}

/** Idle pill in picking mode: a tap ticks a seat; a blocked one says why instead. */
async function pickButton(s: SeatView): Promise<HTMLButtonElement> {
  const rows = preflight.get(s.id) ?? [];
  const blocked = s.status === "pending" || !s.enabled || rows.some((r) => r.status === "blocked");
  const b = await seatButton(s, false, picked.includes(s.id), () => {
    if (blocked) return;
    const i = picked.indexOf(s.id);
    if (i >= 0) picked.splice(i, 1); else if (picked.length < 6) picked.push(s.id);
    void render();
  });
  b.classList.add("pick");
  if (picked.includes(s.id)) b.classList.add("picked");
  if (blocked) b.classList.add("blocked");
  const issues = rows.filter((r) => r.status !== "done").map((r) => t(`pre.${r.check}` as MsgKey));
  if (issues.length) { b.dataset.pre = blocked ? "blocked" : "todo"; b.title = `${s.name} · ${issues.join(" · ")}`; }
  return b;
}

/** A remote member in the picker (a room needs at least one seat for its voice). */
function remotePickButton(id: string): HTMLButtonElement {
  const rows = preflight.get(id) ?? [];
  const blocked = rows.some((r) => r.status === "blocked");
  const on = pickedRemote.includes(id);
  const b = button(`seat pick remote${on ? " active picked" : ""}${blocked ? " blocked" : ""}`, `<div class="mark">${remoteMark(id)}</div><i class="badge"></i>`, remoteName(id), () => {
    if (blocked) return;
    const i = pickedRemote.indexOf(id);
    if (i >= 0) pickedRemote.splice(i, 1); else if (picked.length + pickedRemote.length < 6) pickedRemote.push(id);
    void render();
  });
  b.dataset.remote = id;
  b.dataset.k = `pick-remote:${id}`;
  const issues = rows.filter((r) => r.status !== "done").map((r) => t(`pre.${r.check}` as MsgKey));
  b.title = [remoteName(id), t("room.remoteMember"), ...issues].join(" · ");
  if (issues.length) b.dataset.pre = blocked ? "blocked" : "todo";
  return b;
}

async function togglePicking() {
  picking = !picking;
  picked.length = 0;
  pickedRemote.length = 0;
  if (picking) {
    const ids = seats.filter((s) => s.enabled).map((s) => s.id);
    try {
      const rows = await api.invoke<CheckRow[]>("room_preflight", { seatIds: ids, remoteIds: remoteMembers().map((m) => m.id), relay: false });
      preflight = new Map();
      for (const r of rows ?? []) preflight.set(r.who.id, [...(preflight.get(r.who.id) ?? []), r]);
    } catch { preflight = new Map(); }
  }
  void render();
}

async function startPicked() {
  const seatIds = [...picked];
  const remoteIds = [...pickedRemote];
  picking = false;
  picked.length = 0;
  pickedRemote.length = 0;
  try { await api.invoke("start_room", { seatIds, remoteIds }); } catch (e) { uiLog("warn", `start_room: ${e}`); void render(); }
}

/** A saved group on the idle pill: its first members' marks stacked; a tap calls the group. */
async function groupButton(g: GroupContact): Promise<HTMLButtonElement> {
  const marks = await Promise.all(g.members.slice(0, 2).map(async (m) => {
    if (m.who.kind === "remote") return `<span class="gm remote">${remoteMark(m.who.id)}</span>`;
    const s = seatById(m.who.id);
    return `<span class="gm">${s ? await seatIcon(s) : SVG.group}</span>`;
  }));
  const b = button("seat group-contact", `<div class="mark stack">${marks.join("")}</div>`, g.name, () => { void api.invoke("start_room", { groupId: g.id }); });
  b.dataset.k = `group:${g.id}`;
  b.title = `${g.name} · ${t("room.adhoc", { n: g.members.length })}`;
  return b;
}

// ───────── waveform: real mic level when available, otherwise a gentle idle motion ─────────
let waveCanvas: HTMLCanvasElement | null = null;
let analyser: AnalyserNode | null = null;
let levels: AnalyserNode | null = null;
let audioCtx: AudioContext | null = null;
let raf = 0;
const bars = new Float32Array(16);

async function ensureAnalyser() {
  if (analyser || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new AudioContext();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = .7;
    src.connect(analyser);
    // the waveform's 64-sample window is ~1 ms of sound; the discussion's level check wants ~20 ms
    levels = audioCtx.createAnalyser();
    levels.fftSize = 1024;
    src.connect(levels);
  } catch { analyser = null; levels = null; }
}

// ───────── free discussion: the microphone level can only hold the floor, never move it ─────────
// Sent as edges (on/off), never audio. 200 ms of sound to turn on, 400 ms of quiet to turn off.
let vadTimer: number | undefined;
let vadOn = false;
let vadSince = 0;
function syncVad() {
  const want = !!state.room?.disc && (state.phase.phase === "in_call" || state.phase.phase === "switching");
  if (!want) {
    window.clearInterval(vadTimer);
    vadTimer = undefined;
    if (vadOn) { vadOn = false; void api.invoke("room_vad", { active: false }); }
    return;
  }
  if (vadTimer !== undefined) return;
  void ensureAnalyser();
  const buf = new Uint8Array(1024);
  vadSince = performance.now();
  vadTimer = window.setInterval(() => {
    if (!levels) return;
    levels.getByteTimeDomainData(buf);
    let sum = 0;
    for (const b of buf) { const v = (b - 128) / 128; sum += v * v; }
    const loud = Math.sqrt(sum / buf.length) > (vadOn ? 0.03 : 0.05);
    const now = performance.now();
    if (loud === vadOn) { vadSince = now; return; }
    if (now - vadSince < (vadOn ? 400 : 200)) return;
    vadOn = loud;
    vadSince = now;
    void api.invoke("room_vad", { active: vadOn });
  }, 100);
}

function startWave() {
  ensureAnalyser();
  cancelAnimationFrame(raf);
  const buf = new Uint8Array(32);
  const draw = (t: number) => {
    const c = waveCanvas; if (!c || !c.isConnected) return;
    const ctx = c.getContext("2d")!;
    const dpr = 2; const W = c.width / dpr, Hh = c.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, Hh);
    // bars run along the pill's main axis; in the vertical pill the canvas is taller than wide
    const vert = Hh > W;
    const L = vert ? Hh : W, T = vert ? W : Hh;
    const n = bars.length, gap = 2.6, bw = (L - gap * (n - 1)) / n;
    if (analyser && !state.muted) { analyser.getByteFrequencyData(buf); }
    for (let i = 0; i < n; i++) {
      let target: number;
      if (state.muted) target = .06;
      else if (analyser) target = Math.min(1, (buf[i + 2] / 255) * 1.6 + .06);
      else target = .18 + .14 * Math.sin(t / 420 + i * .9) + .08 * Math.sin(t / 190 + i * 1.7);
      bars[i] += (target - bars[i]) * .25;
      const len = Math.max(2.5, bars[i] * (T - 6));
      const along = i * (bw + gap), across = (T - len) / 2;
      ctx.fillStyle = getComputedStyle(dock).getPropertyValue("--sym").trim() || "#5c6b99";
      ctx.globalAlpha = state.muted ? .35 : .92;
      if (vert) roundRect(ctx, across, along, len, bw, bw / 2); else roundRect(ctx, along, across, bw, len, bw / 2);
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
}
function stopWave() { cancelAnimationFrame(raf); raf = 0; }

// ───────── wiring ─────────
collapsed.addEventListener("click", () => {
  if (Date.now() - lastDragEnd > 300) void api.invoke("set_expanded", { expanded: true });
});
collapsed.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") api.invoke("set_expanded", { expanded: true }); });
dock.addEventListener("mouseleave", () => { if (hoverSeat) { hoverSeat = null; renderStatusText(); } });
window.addEventListener("blur", () => { if (hoverSeat) { hoverSeat = null; renderStatusText(); } });
dock.addEventListener("contextmenu", (e) => { e.preventDefault(); api.invoke("dock_menu"); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && picking) { void togglePicking(); return; }
  if (e.key === "Escape" && state.expanded && state.phase.phase === "idle" && !state.room) api.invoke("set_expanded", { expanded: false });
});

// ───────── grip: the grabber at the pill's end — tap flips 横向/竖向, hold-and-drag moves the Dock ─────────
// The symbol shows what a tap turns the pill into: ⇅ "stand it up" on the horizontal bar, ⇄ "lay it flat" on the vertical one.
const GRIP_SVG = {
  toVertical: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4M4.5 6.5 7 4l2.5 2.5M13 4v12M10.5 13.5 13 16l2.5-2.5"/></svg>',
  toHorizontal: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h12M13.5 4.5 16 7l-2.5 2.5M16 13H4M6.5 10.5 4 13l2.5 2.5"/></svg>',
};
function grip(): HTMLDivElement {
  const g = el("div", "grip", vertical() ? GRIP_SVG.toHorizontal : GRIP_SVG.toVertical);
  g.dataset.k = "grip";
  g.title = t(vertical() ? "dock.gripVertical" : "dock.gripHorizontal");
  g.addEventListener("click", () => { if (Date.now() - lastDragEnd > 300) void api.invoke("toggle_orientation"); });
  return g;
}

// ───────── auto-collapse: an idle, un-hovered pill folds back into the dot/pet after N s ─────────
// A deadline rather than a bare timeout: the 1 Hz state ticks re-render the pill, and re-arming a
// timeout on every render would mean it never fires.
let idleTimer: number | undefined;
let idleDeadline = 0;
let hovering = false;
// Auto: fold after N s. Pinned-expanded: never by itself. Pinned-collapsed: hover is only a preview.
function idleDelayMs(): number {
  const mode = settings?.collapse_mode ?? "auto";
  if (mode === "pinned_expanded") return 0;
  if (mode === "pinned_collapsed") return 600;
  return (settings?.auto_collapse_secs ?? 0) * 1000;
}
function touchIdle() {
  idleDeadline = Date.now() + idleDelayMs();
  scheduleIdleCheck();
}
function scheduleIdleCheck() {
  window.clearTimeout(idleTimer);
  if (!idleDelayMs()) return;
  idleTimer = window.setTimeout(checkIdle, Math.max(50, idleDeadline - Date.now()));
}
async function checkIdle() {
  if (!state.expanded || state.phase.phase !== "idle") return;
  if (Date.now() < idleDeadline) { scheduleIdleCheck(); return; }
  // The webview's enter/leave tracking is lost when the window resizes under the pointer, so ask
  // the OS where the cursor really is instead of trusting `hovering`.
  const over = dragging || (api.isTauri ? await api.invoke<boolean>("cursor_over_dock") : hovering);
  if (over) { touchIdle(); return; }
  void api.invoke("set_expanded", { expanded: false });
}
function pointerEntered() {
  if (hovering) return;
  hovering = true;
  window.clearTimeout(idleTimer);
}
function pointerLeft() {
  if (!hovering) return;
  hovering = false;
  touchIdle();
}
dock.addEventListener("pointerenter", pointerEntered);
dock.addEventListener("pointerleave", pointerLeft);
// macOS: the webview gets no pointer events while the Dock isn't the key window (it never is, by
// design), so Rust polls the OS cursor against the window rect and reports enter/leave here, and
// streams the local position while inside (drives the liquid lens below).
void api.on<boolean>("dock:hover", (over) => {
  if (over) { pointerEntered(); return; }
  pointerLeft();
  ptr = null; kickLens();
});
void api.on<[number, number]>("dock:pointer", ([x, y]) => { ptr = { x, y }; kickLens(); });
dock.addEventListener("pointermove", (e) => { ptr = { x: e.clientX, y: e.clientY }; kickLens(); });
dock.addEventListener("pointerleave", () => { ptr = null; kickLens(); });

// ───────── liquid lens: one glass droplet that follows the pointer between controls ─────────
// Each edge of the droplet is its own spring. The edge facing the direction of travel is stiff and
// the trailing edge soft, so sliding between buttons stretches the lens into a capsule that pulls
// free and snaps back — the "sticky" Liquid Glass feel. While stretched it thins a little across
// (volume-preserving); a press squashes it and pools light under the pointer, release overshoots.
const lens = el("div", "lens");
lens.setAttribute("aria-hidden", "true");
dock.insertBefore(lens, bar);
type Spring = { x: number; v: number };
const spring = (x = 0): Spring => ({ x, v: 0 });
const edge = { l: spring(), r: spring(), t: spring(), b: spring() };
const vis = spring(), squeeze = spring(1);
let ptr: { x: number; y: number } | null = null;
let hot: HTMLElement | null = null;          // control under the pointer right now
let anchor: HTMLElement | null = null;       // where the lens is (stays put while it fades out)
let pressedEl: HTMLElement | null = null;
let lensRaf = 0, lensLast = 0;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function stepSpring(s: Spring, target: number, k: number, zeta: number, dt: number) {
  s.v += (-k * (s.x - target) - 2 * zeta * Math.sqrt(k) * s.v) * dt;
  s.x += s.v * dt;
}
const near = (s: Spring, target: number, eps: number) => Math.abs(s.x - target) < eps && Math.abs(s.v) < eps * 6;

function lensTargetAt(x: number, y: number): HTMLElement | null {
  if (dock.dataset.form !== "bar" || dragging || resizing) return null;
  const t = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>(".btn, .grip, .avatar, .undo, .carry");
  if (t && bar.contains(t)) return t;
  const d = dock.getBoundingClientRect();
  if (x < d.left || x > d.right || y < d.top || y > d.bottom) return null;
  const maxGap = 14 * currentScale();
  let best: HTMLElement | null = null, bestDist = maxGap;
  for (const c of bar.querySelectorAll<HTMLElement>(".btn, .grip, .avatar, .undo, .carry")) {
    const r = c.getBoundingClientRect();
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dist = Math.hypot(dx, dy);
    if (dist <= bestDist) { bestDist = dist; best = c; }
  }
  return best;
}

/** After a re-render swaps the DOM, re-attach hover state to the control with the same identity. */
function carryLensAcrossRender() {
  const k = (hot ?? anchor)?.dataset.k;
  if (!k) return;
  const n = Array.from(bar.querySelectorAll<HTMLElement>("[data-k]")).find((e) => e.dataset.k === k) ?? null;
  if (hot && n) { n.classList.add("is-hot"); hot = n; }
  if (anchor) anchor = n;
}

function kickLens() {
  if (lensRaf) return;
  lensLast = performance.now();
  lensRaf = requestAnimationFrame(lensFrame);
}

function lensFrame(now: number) {
  lensRaf = 0;
  const elapsed = Math.min(1 / 30, Math.max(1 / 240, (now - lensLast) / 1000));
  lensLast = now;
  const target = ptr ? lensTargetAt(ptr.x, ptr.y) : null;
  if (target !== hot) {
    hot?.classList.remove("is-hot");
    target?.classList.add("is-hot");
    hot = target;
    const nextSeat = target?.dataset.seat ?? null;
    if (nextSeat !== hoverSeat) { hoverSeat = nextSeat; renderStatusText(); }
  }
  dock.classList.toggle("hot", !!ptr && dock.dataset.form !== "bar" && !dragging);
  if (anchor && !anchor.isConnected) anchor = null;
  if (target) anchor = target;

  const d = dock.getBoundingClientRect();
  let goal: { l: number; r: number; t: number; b: number } | null = null;
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    const capsule = anchor.matches(".undo, .carry");
    const side = Math.max(r.width, r.height);
    const w = capsule ? r.width + 6 : side, h = capsule ? r.height + 6 : side;
    const cx = r.left + r.width / 2 - d.left, cy = r.top + r.height / 2 - d.top;
    goal = { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 };
  }
  // filled buttons (hang up, muted mic) are already a disc: the lens slides in and dissolves into them
  const wantVis = target && !target.matches(".red, .amber") ? 1 : 0;
  const reduce = !!settings?.reduce_motion;
  const horiz = !vertical();
  if (goal && (vis.x < 0.03 || reduce)) {
    // appearing (or reduced motion): materialise in place instead of sliding in from a stale spot
    edge.l = spring(goal.l); edge.r = spring(goal.r); edge.t = spring(goal.t); edge.b = spring(goal.b);
  }
  const steps = Math.ceil(elapsed * 240), dt = elapsed / steps;
  for (let i = 0; i < steps; i++) {
    if (goal && !reduce) {
      // main axis = along the pill; cross axis = its thickness
      const lo = horiz ? edge.l : edge.t, hi = horiz ? edge.r : edge.b;
      const glo = horiz ? goal.l : goal.t, ghi = horiz ? goal.r : goal.b;
      const clo = horiz ? edge.t : edge.l, chi = horiz ? edge.b : edge.r;
      const gclo = horiz ? goal.t : goal.l, gchi = horiz ? goal.b : goal.r;
      const travel = (glo + ghi) / 2 - (lo.x + hi.x) / 2;
      const dir = Math.abs(travel) < 0.5 ? 0 : Math.sign(travel);
      const STIFF = 900, SOFT = 210, MID = 520;
      stepSpring(hi, ghi, dir > 0 ? STIFF : dir < 0 ? SOFT : MID, dir < 0 ? 0.95 : 0.78, dt);
      stepSpring(lo, glo, dir < 0 ? STIFF : dir > 0 ? SOFT : MID, dir > 0 ? 0.95 : 0.78, dt);
      stepSpring(clo, gclo, MID, 0.82, dt);
      stepSpring(chi, gchi, MID, 0.82, dt);
    }
    stepSpring(vis, wantVis, 420, 1, dt);
    stepSpring(squeeze, pressedEl ? 0.86 : 1, 760, pressedEl ? 0.9 : 0.38, dt);
  }
  if (!target && vis.x < 0.02) anchor = null;

  let x = edge.l.x, y = edge.t.x, w = edge.r.x - edge.l.x, h = edge.b.x - edge.t.x;
  if (goal) {
    const len = horiz ? w : h, base = horiz ? goal.r - goal.l : goal.b - goal.t;
    const thin = 1 - Math.min(0.24, Math.max(0, len / Math.max(1, base) - 1) * 0.3);
    if (horiz) { const nh = h * thin; y += (h - nh) / 2; h = nh; } else { const nw = w * thin; x += (w - nw) / 2; w = nw; }
  }
  const shown = clamp01(vis.x);
  lens.style.width = `${Math.max(0, w)}px`;
  lens.style.height = `${Math.max(0, h)}px`;
  lens.style.transform = `translate(${x}px, ${y}px) scale(${(0.7 + 0.3 * shown) * squeeze.x})`;
  lens.style.opacity = String(shown);
  if (ptr && w > 0 && h > 0) {
    lens.style.setProperty("--hx", `${clamp01((ptr.x - d.left - x) / w) * 100}%`);
    lens.style.setProperty("--hy", `${clamp01((ptr.y - d.top - y) / h) * 100}%`);
  }
  lens.style.setProperty("--glow", String(clamp01((1 - squeeze.x) / 0.12)));

  const settled = near(vis, wantVis, 0.004) && near(squeeze, pressedEl ? 0.86 : 1, 0.002)
    && (!goal || (near(edge.l, goal.l, 0.2) && near(edge.r, goal.r, 0.2) && near(edge.t, goal.t, 0.2) && near(edge.b, goal.b, 0.2)));
  if (!settled) lensRaf = requestAnimationFrame(lensFrame);
}

dock.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const t = lensTargetAt(e.clientX, e.clientY);
  ptr = { x: e.clientX, y: e.clientY };
  if (t) { pressedEl = t; t.classList.add("is-pressed"); }
  else if (dock.dataset.form !== "bar") dock.classList.add("pressing");
  kickLens();
});
const releasePress = () => {
  pressedEl?.classList.remove("is-pressed");
  pressedEl = null;
  dock.classList.remove("pressing");
  kickLens();
};
window.addEventListener("pointerup", releasePress);
window.addEventListener("pointercancel", releasePress);

// ───────── drag: grab the glass itself (any non-button area, or the dot) and put the Dock anywhere ─────────
// The window follows the OS cursor (one IPC per frame; Rust reads the real cursor position) instead
// of the OS move loop, which behaves differently per window manager. A 4px threshold keeps plain
// clicks on the dot working; on release the new centre is persisted as the anchor (snap → "free").
const uiLog = (level: "debug" | "warn" | "error", msg: string) => { if (api.isTauri) void api.invoke("ui_log", { level, msg }); };
window.addEventListener("error", (e) => uiLog("error", `${e.message} @${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => uiLog("error", `unhandled: ${String((e as PromiseRejectionEvent).reason)}`));
let grab: { x: number; y: number } | null = null;   // pointer-down point, in window px
let dragging = false;
let resizeGrab: { sx: number; sy: number; startScale: number; signX: number; signY: number } | null = null;
let resizing = false;
let lastDragEnd = 0;                                // lets the grip tell a tap from the end of a drag
let dragRaf = 0;
function followCursor() {
  dragRaf = 0;
  if (grab && dragging) void api.invoke("drag_dock", { offsetX: grab.x, offsetY: grab.y });
}
function detectResizeEdge(e: PointerEvent): "ew" | "ns" | null {
  const r = dock.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return null;
  const nearRight = r.right - e.clientX <= 7;
  const nearBottom = r.bottom - e.clientY <= 7;
  if (nearRight) return "ew";
  if (nearBottom) return "ns";
  return null;
}
dock.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || (e.target as HTMLElement).closest("button, canvas")) return;
  const edge = !(e.target as HTMLElement).closest(".grip") ? detectResizeEdge(e) : null;
  if (edge || e.altKey || e.metaKey) {
    const r = dock.getBoundingClientRect();
    const signX = e.clientX >= r.left + r.width / 2 ? 1 : -1;
    const signY = e.clientY >= r.top + r.height / 2 ? 1 : -1;
    resizeGrab = { sx: e.screenX, sy: e.screenY, startScale: currentScale(), signX, signY };
    return;
  }
  grab = { x: e.clientX, y: e.clientY };
});
window.addEventListener("pointermove", (e) => {
  if (!grab && !resizeGrab) {
    const edge = detectResizeEdge(e);
    if (edge) dock.dataset.resizeEdge = edge; else delete dock.dataset.resizeEdge;
    return;
  }
  if (resizeGrab) {
    const dx = (e.screenX - resizeGrab.sx) * resizeGrab.signX;
    const dy = (e.screenY - resizeGrab.sy) * resizeGrab.signY;
    if (!resizing) {
      if (Math.hypot(dx, dy) < 3) return;
      resizing = true;
      dock.setPointerCapture(e.pointerId);
      dock.classList.add("resizing");
    }
    const delta = (dx + dy) / 220;
    const next = Math.round(Math.min(1.6, Math.max(0.7, resizeGrab.startScale + delta)) * 40) / 40;
    if (next !== liveScale) {
      liveScale = next;
      document.documentElement.style.setProperty("--scale", String(next));
      const form = (dock.dataset.form as "dot" | "pet" | "bar") || "bar";
      void fit(form);
    }
    return;
  }
  if (!grab) return;
  if (!dragging) {
    if (Math.hypot(e.clientX - grab.x, e.clientY - grab.y) < 4) return;
    dragging = true;
    dock.setPointerCapture(e.pointerId);
    dock.classList.add("dragging");
  }
  if (!dragRaf) dragRaf = requestAnimationFrame(followCursor);
});
const endDrag = () => {
  grab = null;
  if (resizeGrab) {
    const finalScale = liveScale;
    resizeGrab = null;
    if (resizing) {
      resizing = false;
      lastDragEnd = Date.now();
      dock.classList.remove("resizing");
      if (finalScale !== null && settings) {
        settings = { ...settings, dock_scale: finalScale };
        liveScale = null;
        void api.invoke("save_settings", { settings });
      } else {
        liveScale = null;
      }
      touchIdle();
    }
    return;
  }
  if (!dragging) return;
  dragging = false;
  lastDragEnd = Date.now();
  dock.classList.remove("dragging");
  cancelAnimationFrame(dragRaf);
  dragRaf = 0;
  void api.invoke("remember_dock_position");
  touchIdle();
};
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);

// Wheel / trackpad pinch over the pill: proportional zoom in [0.70, 1.60].
let wheelSaveTimer: number | undefined;
dock.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (!settings) return;
  const dir = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0;
  if (!dir) return;
  const step = e.ctrlKey ? 0.03 : 0.05;
  const next = Math.round(Math.min(1.6, Math.max(0.7, currentScale() + dir * step)) * 20) / 20;
  if (next === currentScale()) return;
  settings = { ...settings, dock_scale: next };
  document.documentElement.style.setProperty("--scale", String(next));
  const form = (dock.dataset.form as "dot" | "pet" | "bar") || "bar";
  void fit(form);
  window.clearTimeout(wheelSaveTimer);
  wheelSaveTimer = window.setTimeout(() => { if (settings) void api.invoke("save_settings", { settings }); }, 220);
}, { passive: false });

/** The OS's preferred language, for "follow the system". */
let hostLocale: string | undefined;

function applySettings(s: AppSettings) {
  settings = s;
  setLang(resolveLang(s.language, hostLocale));
  collapsed.setAttribute("aria-label", t("dock.expand"));
  dock.dataset.orient = s.orientation ?? "horizontal";
  touchIdle();
  applyTheme(s.theme);
  document.documentElement.toggleAttribute("data-reduce-motion", s.reduce_motion);
  document.documentElement.style.setProperty("--material", String(s.material_strength));
  const accent = validAccent(s.accent);
  document.documentElement.style.setProperty("--tint", accent ?? "transparent");
  if (accent) document.documentElement.dataset.accent = "on"; else delete document.documentElement.dataset.accent;
  document.documentElement.style.setProperty("--scale", String(Math.min(1.6, Math.max(0.7, s.dock_scale ?? 1))));
}

async function boot() {
  const host = await api.invoke<HostInfo>("host_info");
  hostLocale = host.locale;
  // The CSS keys off `[data-vibrancy="1"]`; toggleAttribute() would set an empty value and never match.
  if (host.vibrancy) document.documentElement.setAttribute("data-vibrancy", "1"); else document.documentElement.removeAttribute("data-vibrancy");
  document.documentElement.dataset.os = host.os;
  if (api.isTauri && host.os === "macos") document.documentElement.dataset.morph = "1";
  // glyph colours follow the glass's backdrop-adaptive appearance (see data-glass in dock.css)
  const setGlass = (scheme: string | null) => { if (scheme) document.documentElement.dataset.glass = scheme; };
  setGlass(await api.invoke<string | null>("glass_scheme"));
  void api.on<string>("dock:glass", setGlass);
  applySettings(await api.invoke<AppSettings>("get_settings"));
  seats = await api.invoke<SeatView[]>("get_seats");
  state = await api.invoke<DockState>("get_state");
  groups = (await api.invoke<GroupContact[]>("get_groups")) ?? [];
  lastSize = { w: 0, h: 0 };
  await render();
  booting = false;
  api.on<DockState>("dock:state", (s) => {
    state = s;
    if (s.phase.phase !== "calling") { carried = null; relayInfo = null; }
    if (!s.room && s.phase.phase === "idle") adding = false;
    if (s.room) picking = false;
    if (s.phase.phase !== "in_call") countdown = null;
    if (nudged && (s.room?.turn !== nudged.turn || s.phase.phase !== "in_call")) nudged = null;
    if (!s.room) discussArmed = 0;
    render();
  });
  api.on<number | null>("room:countdown", (n) => { countdown = n; render(); });
  api.on<{ member: string; why: string }>("room:remote_error", (e) => { remoteError = { ...e, until: Date.now() + 6000 }; render(); window.setTimeout(() => render(), 6100); });
  api.on<string>("room:nudge", (seat) => { nudged = { seat, turn: state.room?.turn ?? 0 }; render(); });
  api.on<GroupContact[]>("groups:changed", (g) => { groups = g; render(); });
  api.on<{ id: string; to: string; lines: number; mode: string }>("room:relay", (r) => { relayInfo = r; render(); });
  api.on<RelayReport>("room:relay_outcome", (r) => { if (relayInfo?.id === r.id) { relayInfo.outcome = r.outcome; render(); } });
  api.on<{ to: string; lines: number }>("dock:handoff", (h) => { carried = h; render(); });
  api.on<SeatView[]>("seats:changed", (s) => { seats = s; iconCache.clear(); render(); });
  api.on<AppSettings>("settings:changed", (s) => { applySettings(s); render(); });
  // Demo mode in a plain browser: expose a tiny console API.
  if (!api.isTauri) (window as any).agentdock = { call: (id: string) => api.invoke("call_seat", { seatId: id }), hangup: () => api.invoke("hangup"), mute: () => api.invoke("toggle_mute") };
}
boot();
