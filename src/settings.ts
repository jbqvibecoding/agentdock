import { api, applyTheme, type AppSettings, type DriverInfo, type HostInfo, type Seat, type SeatView } from "./api";
import { iconFor } from "./brand";

type PageId = "seats" | "hotkeys" | "appearance" | "mic" | "about";
const TITLES: Record<PageId, [string, string]> = {
  seats: ["席位", "拖动排序 · 顺序即 ⌥1…⌥9 · 登录只做一次，之后由 AgentDock 在后台代码控制"],
  hotkeys: ["快捷键", "点击一个按键组合开始录制；与系统或其他 App 冲突时会标红"],
  appearance: ["外观", "玻璃由系统渲染；这里只决定形态、深浅色与动效"],
  mic: ["麦克风", "闭麦默认走系统级，对所有席位一致、零延迟"],
  about: ["关于", "驱动即数据，可热更新"],
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

// ───────────── 席位 ─────────────
const STATUS_LABEL: Record<string, string> = { connected: "已连接", needs_auth: "待登录 / 授权", pending: "待接入", unavailable: "未安装", unknown: "未检测" };

async function renderSeats() {
  const list = el("div", "group");
  for (const s of seats) {
    const r = el("div", "row"); r.draggable = true; r.dataset.id = s.id;
    r.append(el("span", "handle", "⋮⋮"));
    r.append(await avatarFor(s));
    const where = s.driver.kind === "web" ? `${new URL(s.driver.url).host}（网页 · 无感）` : `桌面 App（辅助功能自动化 · 半无感）`;
    const acct = s.account ? ` · ${esc(s.account)}` : "";
    const chips = s.enabled ? "" : '<span class="chip">未启用</span>';
    const statusHtml = `<span class="status" data-s="${s.status}">${STATUS_LABEL[s.status] ?? s.status}</span>`;
    r.append(el("div", "row__text", `<div class="row__name">${esc(s.name)} <span class="chip">${esc(s.service)}</span>${chips}</div><div class="row__sub" title="${where}${acct}${s.driver_verified ? "" : " · 驱动选择器尚未在真机校验"}">${statusHtml} · ${where}${acct}</div>`));

    const acts = el("div", "actions");
    const needsLogin = s.status !== "connected";
    if (s.driver.kind === "web") {
      const b = el("button", `btn sm${needsLogin ? " primary" : ""}`, needsLogin ? (s.status === "pending" ? "连接账号" : "登录") : "重新登录");
      b.addEventListener("click", async () => { await api.invoke("connect_account", { seatId: s.id }); toast("登录窗已打开，登录完成后会自动收起"); });
      acts.append(b);
    } else {
      const b = el("button", `btn sm${needsLogin ? " primary" : ""}`, s.status === "unavailable" ? "未安装" : "授权辅助功能 →");
      b.disabled = s.status === "unavailable";
      b.addEventListener("click", async () => { try { await api.invoke("connect_account", { seatId: s.id }); toast("已打开系统设置 › 辅助功能"); } catch (e) { toast(String(e)); } });
      acts.append(b);
    }
    const test = el("button", "btn sm", "测试呼叫"); test.disabled = !s.enabled || s.status === "pending";
    test.addEventListener("click", async () => { test.disabled = true; test.textContent = "呼叫中…"; const ok = await api.invoke<boolean>("test_call", { seatId: s.id }); toast(ok ? "接通并已挂断 ✓" : "没检测到通话，驱动可能需要更新"); test.textContent = "测试呼叫"; test.disabled = false; });
    acts.append(test);
    const more = el("button", "btn sm", "⋯"); more.title = "更多";
    more.addEventListener("click", () => openSeatSheet(s));
    acts.append(more);
    acts.append(toggle(s.enabled, async (v) => { const next = seats.map((x) => ({ ...stripView(x), enabled: x.id === s.id ? v : x.enabled })); await api.invoke("save_seats", { seats: next }); }));
    r.append(acts);

    r.addEventListener("dragstart", (e) => { r.classList.add("is-dragging"); e.dataTransfer?.setData("text/plain", s.id); });
    r.addEventListener("dragend", () => r.classList.remove("is-dragging"));
    r.addEventListener("dragover", (e) => e.preventDefault());
    r.addEventListener("drop", async (e) => {
      e.preventDefault();
      const from = e.dataTransfer?.getData("text/plain"); if (!from || from === s.id) return;
      const ids = seats.map((x) => x.id); ids.splice(ids.indexOf(from), 1); ids.splice(ids.indexOf(s.id), 0, from);
      await api.invoke("reorder_seats", { ids });
    });
    list.append(r);
  }
  const add = el("div", "row stack");
  const sel = el("select") as HTMLSelectElement;
  for (const d of drivers) sel.append(new Option(`${d.display_name}（${d.kind === "web" ? "网页" : "App"}）`, d.id));
  const name = el("input") as HTMLInputElement; name.type = "text"; name.placeholder = "给这位 agent 起个名字"; name.style.width = "180px";
  const addBtn = el("button", "btn primary sm", "＋ 添加席位");
  addBtn.addEventListener("click", async () => {
    const d = drivers.find((x) => x.id === sel.value)!;
    const id = `${d.id}-${Math.random().toString(36).slice(2, 6)}`;
    const seat: Seat = {
      id, name: name.value.trim() || d.display_name, service: d.display_name,
      driver: d.kind === "web" ? { kind: "web", url: urlForDriver(d.id), driver: d.id } : { kind: "app", bundle_id: bundleForDriver(d.id), driver: d.id },
      icon: { kind: "builtin", key: d.id.split("-")[0] === "chatgpt" ? "dot" : d.id.replace(/-voice$/, "") }, enabled: true, status: "unknown", account: null,
    };
    await api.invoke("save_seats", { seats: [...seats.map(stripView), seat] });
    toast("已添加，下一步：连接账号 → 授权麦克风 → 自动测试呼叫");
  });
  add.append(el("div", "row__text", `<div class="row__name">添加席位</div><div class="row__sub">选服务 → 连接账号 → 授权麦克风 → 自动测试呼叫。任何有 live voice 的 AI 都能占一席。</div>`));
  const acts = el("div", "actions"); acts.append(sel, name, addBtn); add.append(acts);
  list.append(add);

  const how = group("登录 / 授权是怎么做的",
    el("ol", "steps", `<li><b>连接账号</b>会弹出一个真实的登录窗（内置浏览器这一次可见），你像平时一样登录，含 Google / Apple / Passkey 和两步验证。AgentDock 不接触密码。</li>
<li>检测到已登录后窗口自动收起；会话保存在该席位独立的加密数据目录，之后呼叫、闭麦、挂断全在后台进行，不再弹窗。</li>
<li>首次连接顺带两件授权：系统弹一次「允许 AgentDock 使用麦克风」，再自动做一次「测试呼叫」（接通 → 2 秒 → 挂断）校验驱动。</li>
<li>会话过期、被踢、遇到人机验证时席位亮红点，点「重新登录」或在 Dock 上点「查看页面」处理。</li>
<li>App 席位（Grok Bot）不走登录：检测到已安装后，点「授予辅助功能权限」跳到系统设置；呼叫时会把该 App 短暂拉到前台，是唯一不完全无感的席位。</li>`));
  pageEl.replaceChildren(list, how);
}
const stripView = (s: SeatView): Seat => ({ id: s.id, name: s.name, service: s.service, driver: s.driver, icon: s.icon, enabled: s.enabled, status: s.status, account: s.account });
const urlForDriver = (id: string) => ({ "chatgpt-dot": "https://chatgpt.com/", "copilot-voice": "https://copilot.microsoft.com/", "devin-voice": "https://app.devin.ai/", "muse-voice": "https://muse.ai/" } as Record<string, string>)[id] ?? "https://example.com/";
const bundleForDriver = (id: string) => ({ "grok-bot": "com.cursor.grokbot" } as Record<string, string>)[id] ?? id;

async function openSeatSheet(s: SeatView) {
  const sheet = el("div", "group");
  const head = el("div", "row");
  head.append(await avatarFor(s, true));
  const name = el("input") as HTMLInputElement; name.type = "text"; name.value = s.name; name.style.width = "200px";
  head.append(el("div", "row__text", `<div class="row__name">${esc(s.service)}</div><div class="row__sub">显示名称、图标、连接</div>`));
  const acts = el("div", "actions");
  const file = el("input") as HTMLInputElement; file.type = "file"; file.accept = ".png,.svg,.webp,.gif,.apng,.jpg,.jpeg,image/*"; file.classList.add("hidden");
  file.addEventListener("change", async () => {
    const f = file.files?.[0]; if (!f) return;
    const buf = new Uint8Array(await f.arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    try { await api.invoke("set_seat_icon", { seatId: s.id, fileName: f.name, dataBase64: btoa(bin) }); toast("图标已更换（GIF 会在通话时播放）"); } catch (e) { toast(String(e)); }
  });
  const pick = el("button", "btn sm", "更换图标…"); pick.addEventListener("click", () => file.click());
  const reset = el("button", "btn sm", "恢复官方图标"); reset.addEventListener("click", () => api.invoke("reset_seat_icon", { seatId: s.id }));
  const save = el("button", "btn sm primary", "保存名称"); save.addEventListener("click", async () => { await api.invoke("save_seats", { seats: seats.map((x) => ({ ...stripView(x), name: x.id === s.id ? name.value.trim() || x.name : x.name })) }); toast("已保存"); });
  acts.append(name, save, pick, reset, file); head.append(acts);
  sheet.append(head);
  if (s.driver.kind === "web") {
    const dis = el("button", "btn sm danger", "断开并清除登录"); dis.addEventListener("click", async () => { await api.invoke("disconnect_seat", { seatId: s.id }); toast("已清除该席位的会话数据"); });
    const show = el("button", "btn sm", "查看后台页面"); show.addEventListener("click", () => api.invoke("show_seat", { seatId: s.id, visible: true }).catch((e) => toast(String(e))));
    sheet.append(row("会话", "清除后需重新登录；查看页面用于处理验证码等需要人工的情况", [show, dis]));
  }
  const del = el("button", "btn sm danger", "移除席位"); del.addEventListener("click", async () => { await api.invoke("save_seats", { seats: seats.filter((x) => x.id !== s.id).map(stripView) }); toast("已移除"); });
  sheet.append(row("移除", "从 Dock 上拿掉这一席（不会删除对方账号里的任何东西）", del));
  pageEl.prepend(sheet);
  sheet.scrollIntoView({ behavior: "smooth", block: "start" });
}

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
    row("展开 / 收起 Dock", "通话中也可用，不会打断通话", keyChip(h.toggle, c(h.toggle), (v) => saveSettings({ hotkeys: { ...settings.hotkeys, toggle: v } }).then(renderHotkeys))),
    row("闭麦 / 开麦", "系统级，对所有席位一致", keyChip(h.mute, c(h.mute), (v) => saveSettings({ hotkeys: { ...settings.hotkeys, mute: v } }).then(renderHotkeys))),
    row("挂断", "", keyChip(h.hangup, c(h.hangup), (v) => saveSettings({ hotkeys: { ...settings.hotkeys, hangup: v } }).then(renderHotkeys))),
    row("横向 / 竖向", "整条胶囊在 Spotlight 式横条与侧边 Dock 式竖条之间切换", keyChip(h.orientation, c(h.orientation), (v) => saveSettings({ hotkeys: { ...settings.hotkeys, orientation: v } }).then(renderHotkeys))),
    row("小圆点 / 宠物", "切换收起时的形象；右键胶囊也有同样的菜单", keyChip(h.form, c(h.form), (v) => saveSettings({ hotkeys: { ...settings.hotkeys, form: v } }).then(renderHotkeys))),
  );
  const seatMod = el("select") as HTMLSelectElement;
  for (const m of ["Alt", "Control", "Super", "Control+Alt", "Super+Shift"]) seatMod.append(new Option(`${m.split("+").map(pretty).join("")} + 1…9`, m, false, m === h.seat_modifier));
  seatMod.addEventListener("change", () => saveSettings({ hotkeys: { ...settings.hotkeys, seat_modifier: seatMod.value } }).then(renderHotkeys));
  const order = seats.filter((s) => s.enabled).map((s, i) => `${pretty(h.seat_modifier)}${i + 1} ${esc(s.name)}`).join(" · ");
  const g2 = group("席位", row("呼叫 / 切换到第 n 席", order || "还没有启用的席位", seatMod));
  const g3 = group("对讲机", row("按住「展开」键说话", "按住开麦，松开闭麦；开启后该键不再用于展开 / 收起", toggle(h.push_to_talk, (v) => saveSettings({ hotkeys: { ...settings.hotkeys, push_to_talk: v } }))));
  const note = el("p", "note", conflicts.length ? `有 ${conflicts.length} 组快捷键相互冲突（标红），请调整。` : "快捷键在应用启动时注册；若某个组合被系统占用会在日志里提示并跳过。");
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
  const gForm = el("div", "group"); gForm.append(el("div", "group__title", "Dock 默认形态"), cards,
    el("p", "note", "不通话时 Dock 的样子。「常驻宠物」会显示最近一位 agent 的头像（可用 GIF），通话时动起来——和 ChatGPT 桌面端的宠物同类，但这里的宠物是你的 agent。"));

  const matStrength = el("input") as HTMLInputElement; matStrength.type = "range"; matStrength.min = "0"; matStrength.max = "1"; matStrength.step = "0.05"; matStrength.value = String(settings.material_strength);
  matStrength.addEventListener("change", () => saveSettings({ material_strength: Number(matStrength.value) }));
  const gTheme = group("外观",
    row("主题", "跟随系统时会随 macOS / Windows 的深浅色实时切换", seg<AppSettings["theme"]>([["light", "浅色"], ["dark", "深色"], ["system", "跟随系统"]], settings.theme, (v) => saveSettings({ theme: v }))),
    row("材质", host.material ? (host.material === "NSGlassEffectView" ? "macOS 26 Liquid Glass（NSGlassEffectView）" : host.material === "NSVisualEffectView" ? "macOS 系统玻璃（NSVisualEffectView · HUD）" : `Windows ${host.material}`) : "当前平台无系统材质，使用模糊回退", matStrength),
  );
  const snap = el("select") as HTMLSelectElement;
  for (const [v, l] of [["free", "自由（拖到哪就停在哪）"], ["top_center", "顶部居中"], ["bottom_center", "底部居中"], ["top_left", "左上"], ["top_right", "右上"], ["bottom_left", "左下"], ["bottom_right", "右下"]] as [AppSettings["snap"], string][]) snap.append(new Option(l, v, false, v === settings.snap));
  snap.addEventListener("change", () => { const v = snap.value as AppSettings["snap"]; saveSettings(v === "free" ? { snap: v } : { snap: v, dock_anchor: null }); });
  const gLayout = group("布局",
    row("方向", `横向像 Spotlight，竖向像侧边 Dock；快捷键 ${settings.hotkeys.orientation.split("+").map(pretty).join("")} 或右键胶囊可随时切换`, seg<AppSettings["orientation"]>([["horizontal", "横向"], ["vertical", "竖向"]], settings.orientation ?? "horizontal", (v) => saveSettings({ orientation: v }))),
    row("位置", "直接拖动 Dock 的玻璃部分或末端把手即可放到任意位置（自动记忆）；或选一个屏幕边缘吸附", snap),
    row("收起方式", "自动：空闲一段时间折回；固定展开：只有 ⌥Space / 电源钮才收起；固定收起：鼠标停上去只是预览，移开立即收回", seg<AppSettings["collapse_mode"]>([["auto", "自动"], ["pinned_expanded", "固定展开"], ["pinned_collapsed", "固定收起"]], settings.collapse_mode ?? "auto", (v) => saveSettings({ collapse_mode: v }))),
    row("自动收起", "空闲且鼠标不在上面时，展开的胶囊自动折回小圆点 / 宠物；鼠标停在圆点上 0.3 秒自动展开；通话中不收起", (() => { const sel = el("select") as HTMLSelectElement; for (const [v, l] of [[0, "从不"], [3, "3 秒"], [8, "8 秒"], [15, "15 秒"], [30, "30 秒"]] as [number, string][]) sel.append(new Option(l, String(v), false, v === settings.auto_collapse_secs)); sel.addEventListener("change", () => saveSettings({ auto_collapse_secs: Number(sel.value) })); return sel; })()),
    row("显示名字", "", seg<AppSettings["show_names"]>([["hover", "仅悬停"], ["always", "总是"], ["never", "从不"]], settings.show_names, (v) => saveSettings({ show_names: v }))),
    row("减弱动画", "跟随系统「减弱动态效果」时形变退化为淡入淡出", toggle(settings.reduce_motion, (v) => saveSettings({ reduce_motion: v }))),
  );
  const gIcons = group("席位图标", row("自定义图标", "在「席位 › ⋯」里给任一席位换 PNG / SVG / WebP / GIF / APNG，自动裁圆；动图空闲静止、通话播放。官方图标放在 public/brand/ 会自动优先使用。", el("span", "chip", "席位 › ⋯ › 更换图标")));
  pageEl.replaceChildren(gForm, gTheme, gLayout, gIcons);
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
    row("输入设备", "通话音频走系统默认设备；这里的选择用于电平表与未来的逐席位路由", dev),
    row("电平", "说话时应有跳动；用于校验麦克风权限已授予", level),
  );
  const g2 = group("闭麦方式",
    row("静音方式", "系统级：静音 OS 输入设备，所有席位一致、零延迟，但会同时静音其他会议软件；仅席位：只点对方页面上的 Mute。", seg<AppSettings["mute_mode"]>([["system", "系统级"], ["seat", "仅席位"]], settings.mute_mode, (v) => saveSettings({ mute_mode: v }))),
    row("通话时暂停音乐", "呼叫接通时暂停正在播放的媒体，挂断后恢复", toggle(settings.pause_media_in_call, (v) => saveSettings({ pause_media_in_call: v }))),
    row("切换前确认", "默认点谁就切谁，3 秒内可撤销；开启后先弹确认", toggle(settings.confirm_switch, (v) => saveSettings({ confirm_switch: v }))),
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

// ───────────── 关于 ─────────────
function renderAbout() {
  const g = group("AgentDock",
    row(`版本 ${esc(host.version)}`, `运行于 ${esc(host.os)} · 系统材质 ${host.material ? esc(host.material) : "不可用（使用模糊回退）"}`, el("span", "chip", "Tauri 2 · Rust")),
    row("隐私", "不录音、不读聊天内容、不保存密码；只触碰按钮、读通话状态和系统麦克风开关；席位数据目录加密。", el("span", "chip", "本地")),
  );
  const d = el("div", "group"); d.append(el("div", "group__title", "驱动"));
  for (const dr of drivers) {
    const st = el("span", "status", dr.verified ? "已在真机校验" : "待真机校验"); st.dataset.s = dr.verified ? "connected" : "needs_auth";
    d.append(row(`${esc(dr.display_name)} <span class="chip">v${dr.version}</span> <span class="chip">${dr.kind === "web" ? "网页" : "App"}</span>`, dr.id, st));
  }
  d.append(el("p", "note", "驱动是 JSON（URL、登录判定、按钮选择器、步骤脚本）。把更新的驱动放进 配置目录/drivers/ 即可热更新，版本号更高者生效。"));
  const q = el("button", "btn danger", "退出 AgentDock"); q.addEventListener("click", () => api.invoke("quit"));
  pageEl.replaceChildren(g, d, group("", row("退出", "Dock 与后台席位一起关闭", q)));
}

// ───────────── nav ─────────────
async function show(p: PageId) {
  page = p;
  document.querySelectorAll<HTMLButtonElement>(".nav__item").forEach((b) => b.classList.toggle("is-active", b.dataset.page === p));
  const [t, s] = TITLES[p]; $("#title").textContent = t;
  $("#subtitle").textContent = s.replace("⌥", pretty("Alt")).replace("⌥", pretty("Alt"));
  if (p === "seats") await renderSeats(); else if (p === "hotkeys") await renderHotkeys(); else if (p === "appearance") renderAppearance(); else if (p === "mic") await renderMic(); else renderAbout();
}
document.querySelectorAll<HTMLButtonElement>(".nav__item").forEach((b) => b.addEventListener("click", () => show(b.dataset.page as PageId)));

async function boot() {
  host = await api.invoke<HostInfo>("host_info");
  // The CSS keys off `[data-vibrancy="1"]`; toggleAttribute() would set an empty value and never match.
  if (host.vibrancy) document.documentElement.setAttribute("data-vibrancy", "1"); else document.documentElement.removeAttribute("data-vibrancy");
  document.documentElement.dataset.os = host.os;
  $("#ver").textContent = host.version;
  settings = await api.invoke<AppSettings>("get_settings"); applySettingsLocally();
  [seats, drivers] = await Promise.all([api.invoke<SeatView[]>("get_seats"), api.invoke<DriverInfo[]>("list_drivers")]);
  const initial = (new URLSearchParams(location.search).get("page") as PageId) || "seats";
  await show(TITLES[initial] ? initial : "seats");
  api.on<SeatView[]>("seats:changed", (s) => { seats = s; if (page === "seats" || page === "hotkeys") show(page); });
  api.on<AppSettings>("settings:changed", (s) => { settings = s; applySettingsLocally(); });
}
boot();
