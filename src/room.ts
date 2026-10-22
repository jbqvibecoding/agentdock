import { api, applyTheme, fmtTime, type AppSettings, type DockState, type HostInfo, type SeatView, type Speaker, type Utterance } from "./api";
import { resolveLang, setLang, t, translateDom } from "./i18n";

const linesEl = document.getElementById("lines") as HTMLElement;
const nameEl = document.getElementById("room-name") as HTMLElement;
const subEl = document.getElementById("room-sub") as HTMLElement;
const form = document.getElementById("say") as HTMLFormElement;
const box = document.getElementById("say-text") as HTMLTextAreaElement;
const send = document.getElementById("say-send") as HTMLButtonElement;
const hint = document.getElementById("hint") as HTMLElement;

let ledger: Utterance[] = [];
let seats: SeatView[] = [];
let state: DockState | null = null;
let hostLocale: string | undefined;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const nameOf = (sp: Speaker) => sp.kind === "user" ? t("room.me") : seats.find((s) => s.id === sp.id)?.name ?? sp.id;

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
  const floor = p.phase === "idle" ? null : p.phase === "switching" ? p.from : p.seat;
  const who = floor ? nameOf({ kind: "seat", id: floor }) : "";
  subEl.textContent = !floor ? t("room.noFloor") : p.phase === "in_call" ? t("room.speaking", { name: who, time: fmtTime(p.elapsed_secs) }) : t("room.calling", { name: who });
}

function renderLines() {
  if (!ledger.length) {
    linesEl.innerHTML = `<p class="empty">${esc(t(state?.room ? "room.empty" : "room.closed"))}</p>`;
    return;
  }
  const atBottom = linesEl.scrollHeight - linesEl.scrollTop - linesEl.clientHeight < 40;
  linesEl.innerHTML = ledger.map((u) => {
    const text = u.unheard ? t("room.unheard") : u.text;
    const cls = `line${u.unheard ? " is-unheard" : ""}${u.typed ? " is-typed" : ""}`;
    return `<div class="${cls}" data-who="${u.speaker.kind}"><div class="line__who">${esc(nameOf(u.speaker))}</div><div class="line__text">${esc(text)}</div></div>`;
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
  const settings = await api.invoke<AppSettings>("get_settings");
  applyTheme(settings.theme);
  applyLanguage(settings);
  seats = await api.invoke<SeatView[]>("get_seats");
  state = await api.invoke<DockState>("get_state");
  ledger = (await api.invoke<Utterance[]>("room_ledger")) ?? [];
  renderHead();
  renderLines();
  void api.on<Utterance[]>("room:lines", (us) => { upsert(us); renderLines(); });
  void api.on<DockState>("dock:state", (s) => { state = s; renderHead(); if (!s.room && ledger.length) { ledger = []; renderLines(); } });
  void api.on<SeatView[]>("seats:changed", (s) => { seats = s; renderLines(); });
  void api.on<AppSettings>("settings:changed", (s) => { applyTheme(s.theme); applyLanguage(s); renderHead(); renderLines(); });
}
void boot();
