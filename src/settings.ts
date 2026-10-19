import { ACCENTS, api, applyTheme, validAccent, type AppSettings, type DriverInfo, type HostInfo, type MemoryStatus, type Seat, type SeatView } from "./api";
import { iconFor } from "./brand";

type PageId = "seats" | "hotkeys" | "appearance" | "mic" | "memory" | "about";
const TITLES: Record<PageId, [string, string]> = {
  seats: ["Agent", "拖动排序，顺序对应 ⌥1–⌥9"],
  hotkeys: ["快捷键", "点击组合键重新录制，冲突会标红"],
  appearance: ["外观", "形态、颜色与布局"],
  mic: ["麦克风", "输入设备与闭麦方式"],
  memory: ["记忆", "用 EverOS 记住每次通话，关闭时不上传任何内容"],
  about: ["关于", "版本、隐私与驱动"],
};

let settings: AppSettings;
let seats: SeatView[] = [];
let drivers: DriverInfo[] = [];
let host: HostInfo = { os: "unknown", vibrancy: false, material: undefined, version: "" };
let page: PageId = "seats";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const pageEl = $("#page");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

let toastTimer: number | undefined;
function toast(msg: string) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("is-on");
  window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.classList.remove("is-on"), 1800);
}

async function saveSettings(patch: Partial<AppSettings>) {
  settings = { ...settings, ...patch };
  applySettingsLocally();
  await api.invoke("save_settings", { settings });
}
function applySettingsLocally() {
  applyTheme(settings.theme);
  document.documentElement.toggleAttribute("data-reduce-motion", settings.reduce_motion);
  document.documentElement.style.setProperty("--material", String(settings.material_strength ?? 0.5));
  const accent = validAccent(settings.accent);
  if (accent) document.documentElement.style.setProperty("--accent", accent); else document.documentElement.style.removeProperty("--accent");
}

/** 主题色: preset swatches plus a custom picker; the Dock repaints live as you choose. */
function accentPicker(): HTMLDivElement {
  const wrap = el("div", "swatches");
  const presets = new Set(ACCENTS.map(([c]) => c));
  const custom = el("label", "swatch custom") as HTMLLabelElement;
  custom.title = "自定义颜色";
  const input = el("input") as HTMLInputElement;
  input.type = "color";
  input.value = validAccent(settings.accent) ?? "#0a84ff";
  const paint = () => {
    const cur = validAccent(settings.accent);
    wrap.querySelectorAll<HTMLElement>(".swatch[data-c]").forEach((b) => b.classList.toggle("is-on", (b.dataset.c || null) === cur));
    const isCustom = !!cur && !presets.has(cur.toLowerCase());
    custom.classList.toggle("is-on", isCustom);
    if (isCustom) custom.style.setProperty("--c", cur!);
  };
  for (const [c, name] of ACCENTS) {
    const b = el("button", `swatch${c ? "" : " none"}`);
    b.type = "button";
    b.title = name;
    b.setAttribute("aria-label", `主题色：${name}`);
    b.dataset.c = c ?? "";
    if (c) b.style.setProperty("--c", c);
    b.addEventListener("click", () => { void saveSettings({ accent: c }); paint(); });
    wrap.append(b);
  }
  let pending: number | undefined;
  input.addEventListener("input", () => {
    settings = { ...settings, accent: input.value };
    paint();
    window.clearTimeout(pending);
    pending = window.setTimeout(() => void saveSettings({ accent: input.value }), 90);
  });
  custom.append(input);
  wrap.append(custom);
  paint();
  return wrap;
}

function toggle(checked: boolean, on: (v: boolean) => void): HTMLButtonElement {
  const b = el("button", "switch"); b.setAttribute("role", "switch"); b.setAttribute("aria-checked", String(checked));
  b.addEventListener("click", () => { const v = b.getAttribute("aria-checked") !== "true"; b.setAttribute("aria-checked", String(v)); on(v); });
  return b;
}
function seg<T extends string>(opts: [T, string][], value: T, on: (v: T) => void): HTMLDivElement {
  const s = el("div", "seg");
  for (const [v, label] of opts) {
    const b = el("button", v === value ? "is-on" : "", esc(label)); b.type = "button";
    b.addEventListener("click", () => { s.querySelectorAll("button").forEach((x) => x.classList.remove("is-on")); b.classList.add("is-on"); on(v); });
    s.append(b);
  }
  return s;
}
function row(name: string, sub: string, control: HTMLElement | HTMLElement[]): HTMLDivElement {
  const r = el("div", "row");
  r.append(el("div", "row__text", `<div class="row__name">${name}</div>${sub ? `<div class="row__sub">${sub}</div>` : ""}`));
  const a = el("div", "actions"); a.append(...(Array.isArray(control) ? control : [control])); r.append(a);
  return r;
}
function group(title: string, ...rows: HTMLElement[]): HTMLDivElement {
  const g = el("div", "group"); if (title) g.append(el("div", "group__title", esc(title))); g.append(...rows); return g;
}
async function avatarFor(s: SeatView, lg = false): Promise<HTMLDivElement> {
  const a = el("div", `avatar${lg ? " lg" : ""}`);
  if (s.icon.kind === "custom") {
    const data = await api.invoke<string | null>("seat_icon_data", { seatId: s.id });
    a.innerHTML = data ? `<img src="${data}" alt="">` : await iconFor(s.id);
  } else a.innerHTML = await iconFor(s.icon.key);
  return a;
}

// ───────────── Agent（代码里仍叫 seat） ─────────────
// One line per seat: who it is, one short status, and at most one action that is actually needed
// right now. Everything occasional (test call, rename, icon, session, remove) lives in the ⋯ menu.
function statusLabel(s: SeatView): string {
  switch (s.status) {
    case "connected": return "已连接";
    case "needs_auth": return s.driver.kind === "app" ? "需要授权" : "需要登录";
    case "pending": return "语音未开放";
    case "unavailable": return "未安装";
    default: return "未连接";
  }
}
const seatWhere = (s: SeatView) => (s.driver.kind === "web" ? new URL(s.driver.url).host.replace(/^www\./, "") : "桌面 App");
const overlaps = (a: string, b: string) => a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());

async function connectSeat(s: SeatView) {
  try {
    await api.invoke("connect_account", { seatId: s.id });
    toast(s.driver.kind === "web" ? "登录窗已打开，登录后会自动收起" : "已打开 系统设置 › 辅助功能");
  } catch (e) { toast(String(e)); }
}
async function testSeat(s: SeatView) {
  toast("正在测试呼叫…");
  const ok = await api.invoke<boolean>("test_call", { seatId: s.id });
  toast(ok ? "接通并已挂断 ✓" : "没有检测到通话，驱动可能需要更新");
}
const saveSeat = (id: string, patch: Partial<Seat>) =>
  api.invoke("save_seats", { seats: seats.map((x) => (x.id === id ? { ...stripView(x), ...patch } : stripView(x))) });

function pickIcon(s: SeatView) {
  const file = el("input") as HTMLInputElement;
  file.type = "file"; file.accept = ".png,.svg,.webp,.gif,.apng,.jpg,.jpeg,image/*";
  file.addEventListener("change", async () => {
    const f = file.files?.[0]; if (!f) return;
    const buf = new Uint8Array(await f.arrayBuffer()); let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    try { await api.invoke("set_seat_icon", { seatId: s.id, fileName: f.name, dataBase64: btoa(bin) }); toast("图标已更换"); } catch (e) { toast(String(e)); }
  });
  file.click();
}

/** Inline rename: the name turns into a field; Enter / blur saves, Esc cancels. */
function renameInline(r: HTMLElement, s: SeatView) {
  const nameEl = r.querySelector<HTMLElement>(".row__name"); if (!nameEl) return;
  const input = el("input", "inline-name") as HTMLInputElement;
  input.type = "text"; input.value = s.name;
  let done = false;
  const finish = async (save: boolean) => {
    if (done) return; done = true;
    const v = input.value.trim();
    if (save && v && v !== s.name) await saveSeat(s.id, { name: v }); else void renderSeats();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") void finish(true); if (e.key === "Escape") void finish(false); });
  input.addEventListener("blur", () => void finish(true));
  nameEl.replaceChildren(input);
  input.focus(); input.select();
}

// ── popover menu (macOS-style: glass card, accent highlight, two-step confirm for destructive items)
type MenuItem = { label: string; run: () => void; danger?: boolean; disabled?: boolean; confirm?: string };
let menuEl: HTMLDivElement | null = null;
function closeMenu() {
  menuEl?.remove(); menuEl = null;
  document.removeEventListener("pointerdown", onOutside, true);
  document.removeEventListener("keydown", onMenuKey, true);
}
function onOutside(e: Event) { if (menuEl && !menuEl.contains(e.target as Node)) closeMenu(); }
function onMenuKey(e: KeyboardEvent) { if (e.key === "Escape") closeMenu(); }
function openMenu(anchor: HTMLElement, items: (MenuItem | "-")[]) {
  closeMenu();
  const m = el("div", "menu"); m.setAttribute("role", "menu");
  for (const it of items) {
    if (it === "-") { m.append(el("div", "menu__sep")); continue; }
    const b = el("button", `menu__item${it.danger ? " danger" : ""}`, esc(it.label));
    b.type = "button"; b.disabled = !!it.disabled; b.setAttribute("role", "menuitem");
    b.addEventListener("click", () => {
      if (it.confirm && !b.classList.contains("is-armed")) { b.classList.add("is-armed"); b.textContent = it.confirm; return; }
      closeMenu(); it.run();
    });
    m.append(b);
  }
  document.body.append(m);
  const a = anchor.getBoundingClientRect(), mr = m.getBoundingClientRect();
  const below = a.bottom + 6 + mr.height < window.innerHeight - 8;
  m.style.left = `${Math.max(8, a.right - mr.width)}px`;
  m.style.top = `${below ? a.bottom + 6 : a.top - 6 - mr.height}px`;
  m.style.transformOrigin = below ? "top right" : "bottom right";
  menuEl = m;
  document.addEventListener("pointerdown", onOutside, true);
  document.addEventListener("keydown", onMenuKey, true);
}

function seatMenu(r: HTMLElement, s: SeatView): (MenuItem | "-")[] {
  const web = s.driver.kind === "web";
  const items: (MenuItem | "-")[] = [
    { label: "测试呼叫", run: () => void testSeat(s), disabled: !s.enabled || s.status === "pending" || s.status === "unavailable" },
  ];
  if (web) {
    if (s.status === "connected") items.push({ label: "重新登录", run: () => void connectSeat(s) });
    items.push({ label: "查看后台页面", run: () => void api.invoke("show_seat", { seatId: s.id, visible: true }).catch((e) => toast(String(e))) });
  }
  items.push("-", { label: "重命名", run: () => renameInline(r, s) }, { label: "更换图标…", run: () => pickIcon(s) });
  if (s.icon.kind === "custom") items.push({ label: "恢复官方图标", run: () => void api.invoke("reset_seat_icon", { seatId: s.id }) });
  items.push("-");
  if (web) items.push({ label: "退出登录", danger: true, confirm: "确认清除登录？", run: async () => { await api.invoke("disconnect_seat", { seatId: s.id }); toast("已清除登录"); } });
  items.push({ label: "移除 Agent", danger: true, confirm: "确认移除？", run: async () => { await api.invoke("save_seats", { seats: seats.filter((x) => x.id !== s.id).map(stripView) }); toast("已移除"); } });
  return items;
}

// 拖动排序用指针事件自己实现，不用 HTML5 拖放：Tauri 默认在原生层接管拖放（为了文件拖入），
// macOS 上 dragover / drop 根本到不了网页，所以真机里拖不动。这里按住任意一行（控件除外）上下拖，
// 被拖的行浮起跟手，其余行实时让位；松手后落到空位，再提交新顺序（后端同步 Dock 与 ⌥1–⌥9）。
let sorting = false;          // a re-render mid-drag would yank the row out from under the pointer
let deferredSeats = false;    // seats:changed arrived while sorting → re-render once it's over
function enableReorder(list: HTMLElement) {
  list.addEventListener("pointerdown", (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>(".row.seat");
    if (e.button !== 0 || !row || t.closest("button, input, select, label, a")) return;
    const rows = [...list.querySelectorAll<HTMLElement>(".row.seat")];
    const rects = rows.map((r) => r.getBoundingClientRect());
    const from = rows.indexOf(row), h = rects[from].height, startY = e.clientY;
    const minDy = rects[0].top - rects[from].top, maxDy = rects[rects.length - 1].bottom - rects[from].bottom;
    let to = from, dragging = false;
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (!dragging) {
        if (Math.abs(dy) < 4) return;
        dragging = true;
        sorting = true;
        closeMenu();
        try { row.setPointerCapture(e.pointerId); } catch { /* window listeners still track the pointer */ }
        list.classList.add("is-sorting");
        row.classList.add("is-lifted");
      }
      const d = Math.max(minDy, Math.min(maxDy, dy));
      row.style.transform = `translateY(${d}px)`;
      const mid = rects[from].top + h / 2 + d;
      to = rects.findIndex((r) => mid < r.bottom);
      if (to < 0) to = rects.length - 1;
      rows.forEach((r, i) => {
        if (i === from) return;
        const shift = from < to && i > from && i <= to ? -h : from > to && i >= to && i < from ? h : 0;
        r.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!dragging) return;
      // settle into the gap, then commit; the seats:changed re-render lands on the same layout
      const settle = to > from ? rects[to].bottom - rects[from].bottom : rects[to].top - rects[from].top;
      row.classList.remove("is-lifted");
      row.style.transform = `translateY(${settle}px)`;
      window.setTimeout(() => {
        sorting = false;
        if (to === from) {
          rows.forEach((r) => (r.style.transform = ""));
          list.classList.remove("is-sorting");
          if (deferredSeats) { deferredSeats = false; void renderSeats(); }
          return;
        }
        deferredSeats = false;
        const ids = rows.map((r) => r.dataset.id!);
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        void api.invoke("reorder_seats", { ids });
      }, 200);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
}

async function renderSeats() {
  closeMenu();
  const list = el("div", "group seats");
  for (const s of seats) {
    const r = el("div", `row seat${s.enabled ? "" : " is-off"}`); r.dataset.id = s.id;
    r.append(el("span", "handle", "⋮⋮"));
    r.append(await avatarFor(s));
    const svc = overlaps(s.name, s.service) ? "" : `<span class="row__svc">${esc(s.service)}</span>`;
    const acct = s.account ? `<span class="sep">·</span>${esc(s.account)}` : "";
    const tip = esc(`${s.service} · ${s.driver.kind === "web" ? s.driver.url : "桌面 App，通过辅助功能控制"}${s.driver_verified ? "" : " · 驱动尚未在真机校验"}`);
    r.append(el("div", "row__text", `<div class="row__name">${esc(s.name)}${svc}</div><div class="row__sub" title="${tip}"><span class="status" data-s="${s.status}">${statusLabel(s)}</span><span class="sep">·</span>${esc(seatWhere(s))}${acct}</div>`));

    const acts = el("div", "actions");
    // the one action worth showing: only when the seat is on and can't work yet
    const needsHand = s.enabled && s.status !== "connected" && s.status !== "unavailable";
    if (needsHand) {
      const b = el("button", "btn sm tint", s.driver.kind === "web" ? "登录" : "授权");
      b.addEventListener("click", () => void connectSeat(s));
      acts.append(b);
    }
    const more = el("button", "btn icon", `<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="4.5" cy="10" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="15.5" cy="10" r="1.6"/></svg>`);
    more.type = "button"; more.title = "更多"; more.setAttribute("aria-label", `${s.name} 更多操作`);
    more.addEventListener("click", (e) => { e.stopPropagation(); if (menuEl) closeMenu(); else openMenu(more, seatMenu(r, s)); });
    acts.append(more);
    acts.append(toggle(s.enabled, (v) => void saveSeat(s.id, { enabled: v })));
    r.append(acts);
    list.append(r);
  }
  enableReorder(list);

  // add a seat: one compact line at the end of the list
  const add = el("div", "row add");
  add.append(el("div", "avatar plus", `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 5v10M5 10h10"/></svg>`));
  const sel = el("select") as HTMLSelectElement;
  for (const d of drivers) sel.append(new Option(`${d.display_name} · ${d.kind === "web" ? "网页" : "App"}`, d.id));
  const name = el("input") as HTMLInputElement; name.type = "text"; name.placeholder = "名称（可选）";
  const addBtn = el("button", "btn sm tint", "添加");
  addBtn.addEventListener("click", async () => {
    const d = drivers.find((x) => x.id === sel.value)!;
    const id = `${d.id}-${Math.random().toString(36).slice(2, 6)}`;
    const seat: Seat = {
      id, name: name.value.trim() || d.display_name, service: d.display_name,
      driver: d.kind === "web" ? { kind: "web", url: urlForDriver(d.id), driver: d.id } : { kind: "app", bundle_id: bundleForDriver(d.id), driver: d.id },
      icon: { kind: "builtin", key: d.id.split("-")[0] === "chatgpt" ? "dot" : d.id.replace(/-voice$/, "") }, enabled: true, status: "unknown", account: null,
    };
    await api.invoke("save_seats", { seats: [...seats.map(stripView), seat] });
    toast("已添加，点「登录」或「授权」完成连接");
  });
  add.append(sel, name, addBtn);
  list.append(add);

  const help = el("details", "help");
  help.innerHTML = `<summary>登录与授权说明</summary><ul>
<li>登录在弹出的真实浏览器窗口里完成，支持 Google、Apple 与 Passkey。AgentDock 不接触密码，登录成功后窗口自动收起。</li>
<li>之后呼叫、闭麦、挂断都在后台完成；会话过期时会显示「需要登录」。</li>
<li>首次连接会请求一次麦克风权限，并自动做一次测试呼叫。</li>
<li>桌面 App（如 Grok Bot）需要在系统设置里授予辅助功能权限，呼叫时会短暂切换到该 App。</li>
</ul>`;
  pageEl.replaceChildren(list, help);
}
const stripView = (s: SeatView): Seat => ({ id: s.id, name: s.name, service: s.service, driver: s.driver, icon: s.icon, enabled: s.enabled, status: s.status, account: s.account });
const urlForDriver = (id: string) => ({ "chatgpt-dot": "https://chatgpt.com/", "copilot-voice": "https://copilot.microsoft.com/", "devin-voice": "https://app.devin.ai/", "muse-voice": "https://muse.ai/" } as Record<string, string>)[id] ?? "https://example.com/";
const bundleForDriver = (id: string) => ({ "grok-bot": "com.anysphere.sand" } as Record<string, string>)[id] ?? id;

// ───────────── 快捷键 ─────────────
function keyChip(value: string, conflict: boolean, onChange: (v: string) => void): HTMLDivElement {
  const k = el("div", `key${conflict ? " is-conflict" : ""}`);
  const render = (v: string) => { k.innerHTML = v.split("+").map((p) => `<kbd>${esc(pretty(p))}</kbd>`).join(""); };
  render(value);
  k.tabIndex = 0; k.title = "点击后按下新的组合键；Esc 取消";
  k.addEventListener("click", () => { k.classList.add("is-rec"); k.innerHTML = "<kbd>按下组合键…</kbd>"; k.focus(); });
  k.addEventListener("keydown", (e) => {
    if (!k.classList.contains("is-rec")) return;
    e.preventDefault();
    if (e.key === "Escape") { k.classList.remove("is-rec"); render(value); return; }
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    const mods = [e.metaKey && "Super", e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean) as string[];
    const key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    const combo = [...mods, key].join("+");
    k.classList.remove("is-rec"); value = combo; render(combo); onChange(combo);
  });
  k.addEventListener("blur", () => { if (k.classList.contains("is-rec")) { k.classList.remove("is-rec"); render(value); } });
  return k;
}
const pretty = (p: string) => ({ Alt: host.os === "macos" ? "⌥" : "Alt", Control: host.os === "macos" ? "⌃" : "Ctrl", Shift: "⇧", Super: host.os === "macos" ? "⌘" : "Win", Space: "空格", Escape: "Esc" } as Record<string, string>)[p] ?? p;

async function renderHotkeys() {
  const conflicts = await api.invoke<string[]>("hotkey_conflicts", { settings });
  const c = (k: string) => conflicts.includes(k.toLowerCase());
  const h = settings.hotkeys;
  const g = group("全局",
    row("展开 / 收起 Dock", "通话中也可用", keyChip(h.toggle, c(h.toggle), (v) => saveSettings({ hotkeys: { ...settings.hotkeys, toggle: v } }).then(renderHotkeys))),
    row("闭麦 / 开麦", "", keyChip(h.mute, c(h.mute), (v) => saveSettings({ hotkeys: { ...settings.hotkeys, mute: v } }).then(renderHotkeys))),
    row("挂断", "", keyChip(h.hangup, c(h.hangup), (v) => saveSettings({ hotkeys: { ...settings.hotkeys, hangup: v } }).then(renderHotkeys))),
    row("横向 / 竖向", "", keyChip(h.orientation, c(h.orientation), (v) => saveSettings({ hotkeys: { ...settings.hotkeys, orientation: v } }).then(renderHotkeys))),
    row("小圆点 / 宠物", "切换收起后的形象", keyChip(h.form, c(h.form), (v) => saveSettings({ hotkeys: { ...settings.hotkeys, form: v } }).then(renderHotkeys))),
  );
  const seatMod = el("select") as HTMLSelectElement;
  for (const m of ["Alt", "Control", "Super", "Control+Alt", "Super+Shift"]) seatMod.append(new Option(`${m.split("+").map(pretty).join("")} + 1…9`, m, false, m === h.seat_modifier));
  seatMod.addEventListener("change", () => saveSettings({ hotkeys: { ...settings.hotkeys, seat_modifier: seatMod.value } }).then(renderHotkeys));
  const order = seats.filter((s) => s.enabled).map((s, i) => `${pretty(h.seat_modifier)}${i + 1} ${esc(s.name)}`).join(" · ");
  const g2 = group("Agent", row("呼叫第 n 个 Agent", order || "还没有启用的 Agent", seatMod));
  const g3 = group("对讲机", row("按住说话", "按住「展开」键开麦，松开闭麦", toggle(h.push_to_talk, (v) => saveSettings({ hotkeys: { ...settings.hotkeys, push_to_talk: v } }))));
  const note = el("p", "note", conflicts.length ? `有 ${conflicts.length} 组快捷键冲突（标红），请调整。` : "被系统占用的组合会自动跳过。");
  pageEl.replaceChildren(g, g2, g3, note);
}

// ───────────── 外观 ─────────────
function renderAppearance() {
  const cards = el("div", "cards");
  const forms: [AppSettings["default_form"], string, string][] = [
    ["dot", "小圆点", '<i class="d"></i>'],
    ["capsule", "胶囊", '<i class="p"></i>'],
    ["expanded", "完整展开", '<i class="p" style="width:26px"></i><i class="c"></i><i class="c"></i>'],
    ["pet", "常驻宠物", '<i class="pet"></i><i class="p" style="width:18px;height:4px;opacity:.5"></i>'],
  ];
  for (const [v, label, pre] of forms) {
    const c = el("div", `card${settings.default_form === v ? " is-on" : ""}`, `<div class="card__pre">${pre}</div><span>${label}</span>`);
    c.addEventListener("click", () => { cards.querySelectorAll(".card").forEach((x) => x.classList.remove("is-on")); c.classList.add("is-on"); saveSettings({ default_form: v }); });
    cards.append(c);
  }
  const gForm = el("div", "group"); gForm.append(el("div", "group__title", "默认形态"), cards,
    el("p", "note", "不通话时 Dock 的样子。「常驻宠物」显示最近一位 agent 的头像。"));

  const matStrength = el("input") as HTMLInputElement; matStrength.type = "range"; matStrength.min = "0"; matStrength.max = "1"; matStrength.step = "0.05"; matStrength.value = String(settings.material_strength);
  matStrength.addEventListener("input", () => saveSettings({ material_strength: Number(matStrength.value) }));
  matStrength.addEventListener("change", () => saveSettings({ material_strength: Number(matStrength.value) }));
  const gTheme = group("颜色",
    row("主题", "", seg<AppSettings["theme"]>([["light", "浅色"], ["dark", "深色"], ["system", "跟随系统"]], settings.theme, (v) => saveSettings({ theme: v }))),
    row("主题色", "给 Dock 的玻璃与图标染色", accentPicker()),
    row("玻璃质感", host.material ? (host.material === "NSGlassEffectView" ? "Liquid Glass" : host.material === "NSVisualEffectView" ? "系统毛玻璃" : `Windows ${host.material}`) : "模糊回退", matStrength),
  );
  const snap = el("select") as HTMLSelectElement;
  for (const [v, l] of [["free", "自由"], ["top_center", "顶部居中"], ["bottom_center", "底部居中"], ["top_left", "左上"], ["top_right", "右上"], ["bottom_left", "左下"], ["bottom_right", "右下"]] as [AppSettings["snap"], string][]) snap.append(new Option(l, v, false, v === settings.snap));
  snap.addEventListener("change", () => { const v = snap.value as AppSettings["snap"]; saveSettings(v === "free" ? { snap: v } : { snap: v, dock_anchor: null }); });
  const curScale = Math.min(1.6, Math.max(0.7, settings.dock_scale ?? 1));
  const scaleLabel = el("span", "chip", `${Math.round(curScale * 100)}%`);
  const scaleRange = el("input") as HTMLInputElement; scaleRange.type = "range"; scaleRange.min = "0.7"; scaleRange.max = "1.6"; scaleRange.step = "0.05"; scaleRange.value = String(curScale);
  const scaleReset = el("button", "btn sm", "重置"); scaleReset.type = "button";
  const onScale = (v: number) => {
    const clamped = Math.round(Math.min(1.6, Math.max(0.7, v)) * 20) / 20;
    scaleRange.value = String(clamped);
    scaleLabel.textContent = `${Math.round(clamped * 100)}%`;
    saveSettings({ dock_scale: clamped });
  };
  scaleRange.addEventListener("input", () => onScale(Number(scaleRange.value)));
  scaleRange.addEventListener("change", () => onScale(Number(scaleRange.value)));
  scaleReset.addEventListener("click", () => onScale(1));
  const gLayout = group("布局",
    row("大小", "也可在 Dock 上滚轮或拖动边缘", [scaleLabel, scaleRange, scaleReset]),
    row("方向", `${settings.hotkeys.orientation.split("+").map(pretty).join("")} 或右键 Dock 切换`, seg<AppSettings["orientation"]>([["horizontal", "横向"], ["vertical", "竖向"]], settings.orientation ?? "horizontal", (v) => saveSettings({ orientation: v }))),
    row("位置", "直接拖动 Dock 即可，位置会被记住", snap),
    row("收起方式", "固定收起：点开后鼠标移开即收回", seg<AppSettings["collapse_mode"]>([["auto", "自动"], ["pinned_expanded", "固定展开"], ["pinned_collapsed", "固定收起"]], settings.collapse_mode ?? "auto", (v) => saveSettings({ collapse_mode: v }))),
    row("自动收起", "空闲多久后收起，通话中不收起", (() => { const sel = el("select") as HTMLSelectElement; for (const [v, l] of [[0, "从不"], [3, "3 秒"], [8, "8 秒"], [15, "15 秒"], [30, "30 秒"]] as [number, string][]) sel.append(new Option(l, String(v), false, v === settings.auto_collapse_secs)); sel.addEventListener("change", () => saveSettings({ auto_collapse_secs: Number(sel.value) })); return sel; })()),
    row("显示名字", "", seg<AppSettings["show_names"]>([["hover", "仅悬停"], ["always", "总是"], ["never", "从不"]], settings.show_names, (v) => saveSettings({ show_names: v }))),
    row("减弱动画", "形变改为淡入淡出", toggle(settings.reduce_motion, (v) => saveSettings({ reduce_motion: v }))),
  );
  pageEl.replaceChildren(gForm, gTheme, gLayout);
}

// ───────────── 麦克风 ─────────────
let levelRaf = 0;
async function renderMic() {
  cancelAnimationFrame(levelRaf);
  const dev = el("select") as HTMLSelectElement; dev.append(new Option("系统默认", ""));
  try {
    const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
    for (const d of list) dev.append(new Option(d.label || `输入设备 ${dev.options.length}`, d.deviceId, false, d.deviceId === settings.input_device));
  } catch { /* no devices on this host */ }
  dev.addEventListener("change", () => saveSettings({ input_device: dev.value || null }));
  const level = el("div", "level", "<i></i>");
  const g = group("输入",
    row("输入设备", "通话使用系统默认设备", dev),
    row("电平", "说话时会跳动，用来确认麦克风可用", level),
  );
  const g2 = group("通话",
    row("闭麦方式", "系统级会同时静音其他会议软件", seg<AppSettings["mute_mode"]>([["system", "系统级"], ["seat", "仅 Agent"]], settings.mute_mode, (v) => saveSettings({ mute_mode: v }))),
    row("通话时暂停音乐", "挂断后自动恢复", toggle(settings.pause_media_in_call, (v) => saveSettings({ pause_media_in_call: v }))),
    row("切换前确认", "关闭时直接切换，3 秒内可撤销", toggle(settings.confirm_switch, (v) => saveSettings({ confirm_switch: v }))),
  );
  pageEl.replaceChildren(g, g2);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: settings.input_device ? { deviceId: { exact: settings.input_device } } : true });
    const ctx = new AudioContext(); const an = ctx.createAnalyser(); an.fftSize = 256; ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.frequencyBinCount); const bar = level.firstElementChild as HTMLElement;
    const tick = () => { if (!level.isConnected) { stream.getTracks().forEach((t) => t.stop()); ctx.close(); return; } an.getByteTimeDomainData(buf); let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128)); bar.style.width = `${Math.min(100, (peak / 128) * 160)}%`; levelRaf = requestAnimationFrame(tick); };
    tick();
  } catch { (level.firstElementChild as HTMLElement).style.width = "0%"; level.title = "没有拿到麦克风权限或设备"; }
}

// ───────────── 记忆 ─────────────
async function renderMemory() {
  const mem = settings.memory ?? { enabled: false, user_id: "", inject_context: true, top_k: 5 };
  let status: MemoryStatus = {
    active: false, enabled: mem.enabled, key_present: false, base_url: "https://api.evermind.ai",
    user_id: mem.user_id, app_id: "agentdock", project_id: "default",
    reason: "未设置 EVEROS_API_KEY", inject_context: mem.inject_context, top_k: mem.top_k,
  };
  try { status = await api.invoke<MemoryStatus>("memory_status"); } catch { /* mock-less hosts */ }
  const chip = el("span", "chip", status.active ? "生效中" : "未生效");
  const g = group("EverOS",
    row("启用长期记忆", "呼叫前检索相关记忆，通话内容写入 EverOS", toggle(mem.enabled, (v) => { void saveSettings({ memory: { ...mem, enabled: v } }).then(() => { if (page === "memory") void renderMemory(); }); })),
    row("把记忆带给对方", "填入网页版 Agent 的输入框，不会自动发送", toggle(mem.inject_context, (v) => saveSettings({ memory: { ...settings.memory, inject_context: v } }))),
  );
  const g2 = group("当前状态",
    row("状态", esc(status.reason), chip),
    row("密钥", status.key_present ? "已检测到 EVEROS_API_KEY" : "未检测到 EVEROS_API_KEY", el("span", "chip", status.key_present ? "有" : "无")),
    row("服务", esc(status.base_url), el("span", "chip", esc(status.app_id))),
    row("用户", status.user_id ? esc(status.user_id) : "开启并检测到密钥后自动生成", el("span", "chip", "user_id")),
  );
  const note = el("p", "note", "密钥只从环境变量 EVEROS_API_KEY 读取，不写进设置文件；从访达启动的 App 需要用 launchctl setenv 配置。自建服务用 EVEROS_BASE_URL。记忆请求失败不影响通话。");
  pageEl.replaceChildren(g, g2, note);
}

// ───────────── 关于 ─────────────
function renderAbout() {
  const g = group("AgentDock",
    row(`版本 ${esc(host.version)}`, `运行于 ${esc(host.os)} · 系统材质 ${host.material ? esc(host.material) : "不可用（使用模糊回退）"}`, el("span", "chip", "Tauri 2 · Rust")),
    row("隐私", "不录音、不保存密码。长期记忆默认关闭，开启并配置 EVEROS_API_KEY 后才会上传。", el("span", "chip", "本地")),
  );
  const d = el("div", "group"); d.append(el("div", "group__title", "驱动"));
  for (const dr of drivers) {
    const st = el("span", "status", dr.verified ? "已在真机校验" : "待真机校验"); st.dataset.s = dr.verified ? "connected" : "needs_auth";
    d.append(row(`${esc(dr.display_name)} <span class="chip">v${dr.version}</span> <span class="chip">${dr.kind === "web" ? "网页" : "App"}</span>`, dr.id, st));
  }
  d.append(el("p", "note", "驱动是 JSON 文件，放进 配置目录/drivers/ 即可热更新，版本号更高者生效。"));
  const q = el("button", "btn danger", "退出 AgentDock"); q.addEventListener("click", () => api.invoke("quit"));
  pageEl.replaceChildren(g, d, group("", row("退出", "Dock 与后台 Agent 一起关闭", q)));
}

// ───────────── nav ─────────────
async function show(p: PageId) {
  page = p;
  document.querySelectorAll<HTMLButtonElement>(".nav__item").forEach((b) => b.classList.toggle("is-active", b.dataset.page === p));
  const [t, s] = TITLES[p]; $("#title").textContent = t;
  $("#subtitle").textContent = s.replace("⌥", pretty("Alt")).replace("⌥", pretty("Alt"));
  if (p === "seats") await renderSeats(); else if (p === "hotkeys") await renderHotkeys(); else if (p === "appearance") renderAppearance(); else if (p === "mic") await renderMic(); else if (p === "memory") await renderMemory(); else renderAbout();
}
document.querySelectorAll<HTMLButtonElement>(".nav__item").forEach((b) => b.addEventListener("click", () => show(b.dataset.page as PageId)));

async function boot() {
  host = await api.invoke<HostInfo>("host_info");
  // The CSS keys off `[data-vibrancy="1"]`; toggleAttribute() would set an empty value and never match.
  if (host.vibrancy) document.documentElement.setAttribute("data-vibrancy", "1"); else document.documentElement.removeAttribute("data-vibrancy");
  document.documentElement.dataset.os = host.os;
  // keep the slab concentric with the real window corner (26pt on macOS 26 with the unified toolbar)
  const setRadius = (r: number) => { if (r > 0) document.documentElement.style.setProperty("--win-r", `${r}px`); };
  setRadius(host.window_radius ?? 0);
  void api.on<number>("settings:radius", setRadius);
  $("#ver").textContent = host.version;
  settings = await api.invoke<AppSettings>("get_settings"); applySettingsLocally();
  [seats, drivers] = await Promise.all([api.invoke<SeatView[]>("get_seats"), api.invoke<DriverInfo[]>("list_drivers")]);
  const initial = (new URLSearchParams(location.search).get("page") as PageId) || "seats";
  await show(TITLES[initial] ? initial : "seats");
  api.on<SeatView[]>("seats:changed", (s) => {
    seats = s;
    if (sorting) { deferredSeats = true; return; }
    if (page === "seats" || page === "hotkeys") show(page);
  });
  api.on<AppSettings>("settings:changed", (s) => { settings = s; applySettingsLocally(); });
}
boot();
