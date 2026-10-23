import { api, applyTheme, fmtTime, type AppSettings, type DockState, type HostInfo, type SeatView, type Speaker, type Utterance } from "./api";
import { resolveLang, setLang, t, translateDom, type MsgKey } from "./i18n";

const linesEl = document.getElementById("lines") as HTMLElement;
const nameEl = document.getElementById("room-name") as HTMLElement;
const subEl = document.getElementById("room-sub") as HTMLElement;
const form = document.getElementById("say") as HTMLFormElement;
const box = document.getElementById("say-text") as HTMLTextAreaElement;
const send = document.getElementById("say-send") as HTMLButtonElement;
const hint = document.getElementById("hint") as HTMLElement;
const modeEl = document.getElementById("mode") as HTMLElement;
const modeRun = document.getElementById("mode-run") as HTMLButtonElement;
const modeNote = document.getElementById("mode-note") as HTMLElement;

let ledger: Utterance[] = [];
let seats: SeatView[] = [];
let state: DockState | null = null;
let settings: AppSettings | null = null;
let hostLocale: string | undefined;
/** The first click on 自由讨论 in a room without consent to send shows what it sends; the second agrees. */
let asking = false;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const nameOf = (sp: Speaker) => sp.kind === "user" ? t("room.me")
  : sp.kind === "remote" ? settings?.remote_members?.find((m) => m.id === sp.id)?.name ?? sp.id
  : seats.find((s) => s.id === sp.id)?.name ?? sp.id;

function renderHead() {
  const room = state?.room;
  if (!room) {
    nameEl.textContent = t("room.window");
    subEl.textContent = t("room.closed");
    send.disabled = true;
    return;
  }
  send.disabled = false;
  nameEl.textContent = room.name ?? t("room.adhoc", { n: room.members.length });
  const p = state!.phase;
  const rf = room.remote;
  if (rf && rf.stage !== "pending") {
    subEl.textContent = t(`room.remote.${rf.stage}` as MsgKey, { name: nameOf({ kind: "remote", id: rf.member }) });
    return;
  }
  const floor = p.phase === "idle" ? null : p.phase === "switching" ? p.from : p.seat;
  const who = floor ? nameOf({ kind: "seat", id: floor }) : "";
  subEl.textContent = !floor ? t("room.noFloor") : p.phase === "in_call" ? t("room.speaking", { name: who, time: fmtTime(p.elapsed_secs) }) : t("room.calling", { name: who });
}

/** 主持 | 自由讨论, and pausing or resuming a discussion. */
function renderMode() {
  const room = state?.room;
  modeEl.hidden = !room;
  if (!room) { modeNote.hidden = true; asking = false; return; }
  const d = room.disc;
  for (const b of modeEl.querySelectorAll<HTMLButtonElement>(".seg button")) b.setAttribute("aria-checked", String((b.dataset.mode === "discussion") === !!d));
  modeRun.hidden = !d;
  if (d) modeRun.textContent = t(d.run.state === "running" ? "room.discussPause" : "room.discussResume");
  const note = asking && !d ? t("room.discussConsent")
    : d?.run.state === "paused" ? t(`room.paused.${d.run.why}` as MsgKey)
    : d ? t("room.discussLeft", { n: d.hops_left }) : "";
  modeNote.hidden = !note;
  modeNote.textContent = note;
  modeNote.classList.toggle("is-ask", asking && !d);
}

for (const b of modeEl.querySelectorAll<HTMLButtonElement>(".seg button")) {
  b.addEventListener("click", () => {
    const room = state?.room;
    if (!room) return;
    if (b.dataset.mode === "moderated") { asking = false; void api.invoke("set_room_mode", { mode: "moderated" }); return; }
    if (room.disc) return;
    if (room.relay || asking) { asking = false; void api.invoke("set_room_mode", { mode: "discussion", consent: true }); return; }
    asking = true;
    renderMode();
  });
}
modeRun.addEventListener("click", () => {
  const d = state?.room?.disc;
  if (d) void api.invoke(d.run.state === "running" ? "discussion_pause" : "discussion_resume");
});

function renderLines() {
  if (!ledger.length) {
    linesEl.innerHTML = `<p class="empty">${esc(t(state?.room ? "room.empty" : "room.closed"))}</p>`;
    return;
  }
  const atBottom = linesEl.scrollHeight - linesEl.scrollTop - linesEl.clientHeight < 40;
  linesEl.innerHTML = ledger.map((u) => {
    const text = u.unheard ? t("room.unheard") : u.text;
    const cls = `line${u.unheard ? " is-unheard" : ""}${u.typed ? " is-typed" : ""}`;
    // a remote member's answer was read aloud: ▶ reads it again
    const play = u.speaker.kind === "remote" && !u.unheard ? `<button type="button" class="line__play" data-seq="${u.seq}" title="${esc(t("room.play"))}" aria-label="${esc(t("room.play"))}">▶</button>` : "";
    return `<div class="${cls}" data-who="${u.speaker.kind}"><div class="line__who">${esc(nameOf(u.speaker))}${play}</div><div class="line__text">${esc(text)}</div></div>`;
  }).join("");
  if (atBottom) linesEl.scrollTop = linesEl.scrollHeight;
}

/** New or grown lines replace older versions by seq; an empty batch means the room closed. */
function upsert(us: Utterance[]) {
  if (!us.length) { ledger = []; return; }
  for (const u of us) {
    const i = ledger.findIndex((x) => x.seq === u.seq);
    if (i >= 0) ledger[i] = u; else ledger.push(u);
  }
  ledger.sort((a, b) => a.seq - b.seq);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = box.value.trim();
  if (!text) return;
  try {
    await api.invoke("room_say", { text });
    box.value = "";
    hint.classList.remove("is-error");
    hint.textContent = t("room.hint");
  } catch (err) {
    hint.classList.add("is-error");
    hint.textContent = String(err).includes("no room") ? t("room.closed") : String(err);
  }
});
linesEl.addEventListener("click", async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".line__play");
  if (!b) return;
  try {
    await api.invoke("room_play", { seq: Number(b.dataset.seq) });
  } catch (err) {
    hint.classList.add("is-error");
    hint.textContent = String(err).includes("busy") ? t("room.playBusy") : String(err);
  }
});

// Enter sends, Shift+Enter breaks the line (and macOS Dictation types straight into the box)
box.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
});

function applyLanguage(s: AppSettings) {
  setLang(resolveLang(s.language, hostLocale));
  translateDom();
  document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((x) => x.setAttribute("placeholder", t(x.dataset.i18nPlaceholder as never)));
}

async function boot() {
  const host = await api.invoke<HostInfo>("host_info");
  hostLocale = host.locale;
  settings = await api.invoke<AppSettings>("get_settings");
  applyTheme(settings.theme);
  applyLanguage(settings);
  seats = await api.invoke<SeatView[]>("get_seats");
  state = await api.invoke<DockState>("get_state");
  ledger = (await api.invoke<Utterance[]>("room_ledger")) ?? [];
  renderHead();
  renderMode();
  renderLines();
  void api.on<Utterance[]>("room:lines", (us) => { upsert(us); renderLines(); });
  void api.on<DockState>("dock:state", (s) => {
    const had = !!state?.room;
    state = s;
    renderHead();
    renderMode();
    // the empty transcript says whether a group call is on
    if (had !== !!s.room) { if (!s.room) ledger = []; renderLines(); }
  });
  void api.on<SeatView[]>("seats:changed", (s) => { seats = s; renderLines(); });
  void api.on<AppSettings>("settings:changed", (s) => { settings = s; applyTheme(s.theme); applyLanguage(s); renderHead(); renderMode(); renderLines(); });
}
void boot();
