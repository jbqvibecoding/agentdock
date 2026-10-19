<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="96" alt="AgentDock" />

# AgentDock

**A voice speed-dial for your personal AI agents — one Liquid Glass pill floating on the desktop.**

Treat ChatGPT dot, Grok Bot, Copilot, Devin and Muse as contacts:<br/>
one click to call, one click to mute, one click to hang up or hand the call to the next agent. Not a chat window. Not a model router.

[![macOS 26 Liquid Glass](https://img.shields.io/badge/macOS%2026-Liquid%20Glass-0a84ff?logo=apple&logoColor=white)](#platforms) [![Windows Mica](https://img.shields.io/badge/Windows%2011-Mica%20(unverified)-6b7280?logo=windows&logoColor=white)](#platforms) [![Tauri 2](https://img.shields.io/badge/Tauri-2-24c8db?logo=tauri&logoColor=white)](https://tauri.app) [![Rust](https://img.shields.io/badge/Rust-core-dea584?logo=rust&logoColor=black)](src-tauri) [![Tests](https://img.shields.io/badge/tests-46%20unit%20%C2%B7%2031%20e2e-2ea043)](#testing) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[中文](README.md) · [Features](#features) · [Install](#install) · [Shortcuts](#shortcuts) · [Architecture](#architecture) · [Connecting seats](#connecting-seats) · [Memory](#long-term-memory-everos) · [Privacy](#privacy--limits) · [Roadmap](#roadmap)

<br/>

<img src="docs/screenshots/mac-hero-light.png" width="920" alt="AgentDock idle pill" />
<br/>

<p><sub>Captured on macOS 26 · native NSGlassEffectView. Left to right: collapse · system mute · seats (dot / Grok Bot / Copilot / Muse) · add seat · ⇅ orientation grip</sub></p>

</div>

---

## Why

Every AI vendor now ships its own "call me" mode — ChatGPT dot, xAI Grok Bot, Copilot Voice, Meta Muse, Devin. They live in five different apps and tabs, and nothing lets you **dial any of them in one click and switch mid-call** the way a phone contact list does.

AgentDock deliberately does one narrow thing:

- **Each agent is a seat, not a model.** You sign in to your own accounts; AgentDock only presses *call / mute / hang up* for you.
- **One pill**, Dynamic-Island-style states (dot / pet → pill → in-call), glass rendered by the OS.
- **Switch mid-call**: hang up the current agent, connect the next, undo within 3 s.
- **System-level mute** that works across every seat, independent of each site's own mute button.

## Features

<table>
<tr>
<td width="50%" valign="top">

**Calling & switching**

- Click a seat to call; click another seat during a call to switch (3 s undo)
- One-click mute / unmute (input-device level), one-click hang up
- After 15 s without a connection the pill enters *Needs you*, with one click to reveal that seat's page
- `⌥1…⌥9` to call / switch to seat n

**Forms**

- Dot / pet (seat avatar, GIF / APNG ok) / pill / in-call
- Auto-collapse after idle (3 / 8 / 15 / 30 s / never); hover the dot 0.3 s to expand
- Three collapse modes: auto · pinned expanded · pinned collapsed (hover = preview only)
- Never auto-collapses during a call

</td>
<td width="50%" valign="top">

**Position & orientation**

- Drag the pill's glass, the dot, or the end grip anywhere; the position is remembered
- Horizontal (Spotlight-like) / vertical (side-Dock-like), one click apart
- End grip shows ⇅ when horizontal, ⇄ when vertical: click to rotate, hold to move
- Rotation and expand/collapse morph around the same center — no jumps

**System integration**

- macOS 26 `NSGlassEffectView` (native Liquid Glass); `NSVisualEffectView` fallback on older releases
- Recordable global shortcuts with conflict detection; native context menu
- Light / dark / follow system, mirrored to the native glass layer
- Backward-compatible `settings.json`

</td>
</tr>
</table>

## Screenshots

### Real device · macOS 26

> Files named `mac-*`, macOS 26.6.2 · Apple Silicon, glass drawn by the system `NSGlassEffectView`. The cloud Mac has no HiDPI display, so these are 1x captures (pixel = pt), not upscaled.

<div align="center">

| Idle · light | Idle · dark |
|:--:|:--:|
| <img src="docs/screenshots/mac-idle-light.png" width="420" /> | <img src="docs/screenshots/mac-idle-dark.png" width="420" /> |
| **In call** | **Muted** |
| <img src="docs/screenshots/mac-incall-light.png" width="420" /> | <img src="docs/screenshots/mac-muted-light.png" width="420" /> |
| **Switching (3 s undo)** | **Grip hover ⇅** |
| <img src="docs/screenshots/mac-switching-light.png" width="420" /> | <img src="docs/screenshots/mac-grip-hover-light.png" width="420" /> |
| **Native context menu (shows current shortcuts)** | **Dot / pet / vertical** |
| <img src="docs/screenshots/mac-menu-light.png" width="420" /> | <img src="docs/screenshots/mac-dot-light.png" height="116" /> &nbsp; <img src="docs/screenshots/mac-pet-light.png" height="116" /> &nbsp; <img src="docs/screenshots/mac-vertical-idle-light.png" height="260" /> &nbsp; <img src="docs/screenshots/mac-vertical-incall-light.png" height="260" /> |

<br/>

| Settings › Seats | Settings › Appearance (Layout · collapse mode) |
|:--:|:--:|
| <img src="docs/screenshots/mac-settings-seats-light.png" width="460" /> | <img src="docs/screenshots/mac-settings-appearance-light.png" width="460" /> |
| **Settings › Shortcuts** | **Settings › Seats (dark)** |
| <img src="docs/screenshots/mac-settings-hotkeys-light.png" width="460" /> | <img src="docs/screenshots/mac-settings-seats-dark.png" width="460" /> |

</div>

### State overview (browser mock · 2x)

> Rendered at 2x from the browser mock (controllable states, easy side-by-side); on a real Mac the glass is drawn by the system material and looks more translucent.

<div align="center">

| In call | Muted |
|:--:|:--:|
| <img src="docs/screenshots/dock-incall-light.png" width="440" /> | <img src="docs/screenshots/dock-incall-muted-light.png" width="440" /> |
| **Switching (3 s undo)** | **Grip hover (⇅ = click to stand up)** |
| <img src="docs/screenshots/dock-switching-light.png" width="440" /> | <img src="docs/screenshots/dock-grip-hover-light.png" width="440" /> |
| **Collapsed: dot** | **Collapsed: pet** |
| <img src="docs/screenshots/dock-dot-light.png" width="440" /> | <img src="docs/screenshots/dock-pet-light.png" width="440" /> |

<br/>

| Vertical · idle | Vertical · in call | Dark |
|:--:|:--:|:--:|
| <img src="docs/screenshots/dock-vertical-idle-dark.png" height="420" /> | <img src="docs/screenshots/dock-vertical-incall-light.png" height="420" /> | <img src="docs/screenshots/dock-incall-dark.png" width="420" /><br/><br/><img src="docs/screenshots/dock-switching-dark.png" width="420" /><br/><br/><img src="docs/screenshots/dock-dot-dark.png" width="420" /> |

<br/>

**Settings** — one sheet of system glass; sidebar more transparent, content brighter

| Seats | Appearance › Layout |
|:--:|:--:|
| <img src="docs/screenshots/settings-seats-light.png" width="460" /> | <img src="docs/screenshots/settings-layout-light.png" width="460" /> |
| **Shortcuts** | **Seats (dark)** |
| <img src="docs/screenshots/settings-hotkeys-light.png" width="460" /> | <img src="docs/screenshots/settings-seats-dark.png" width="460" /> |

</div>

## Install

### macOS (primary platform)

```bash
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
brew install node

git clone https://github.com/we1jia/AgentDock.git && cd AgentDock
npm install
npm run tauri dev        # dev mode with HMR
npm run tauri build      # .app / .dmg → src-tauri/target/release/bundle/
```

On first launch an AgentDock icon appears in the menu bar and a small dot at the top center of the screen. `⌥Space` expands it; right-click the pill for the menu / settings.

| Requirement | Version |
|---|---|
| macOS | 26 Tahoe for native Liquid Glass; 13+ falls back to NSVisualEffectView |
| Rust | stable (1.80+) |
| Node | 20+ |

### Platforms

- **Windows** — code paths exist (Mica, UI Automation driver, `IAudioEndpointVolume` mute) but have **not been compiled or verified on a Windows machine yet**. PRs welcome.
- **Linux** — builds and runs (WebKitGTK, CSS glass fallback); used for development and CI: `bash tests/e2e_xvfb.sh`.

## Shortcuts

Global; all re-recordable under **Settings › Shortcuts**. The native context menu shows the current bindings.

| Shortcut | Action |
|---|---|
| `⌥ Space` | Expand / collapse (works during a call) |
| `⌥ M` | Mute / unmute (system level) |
| `⌥ Esc` | Hang up |
| `⌥ O` | Horizontal ↔ vertical |
| `⌥ P` | Collapsed form: dot ↔ pet |
| `⌥ 1…9` | Call / switch to seat n (order = drag order in Settings) |

Mouse:

| Gesture | Effect |
|---|---|
| Click a seat | Call; during a call = switch |
| Click the end grip ⇅ / ⇄ | Rotate |
| Drag the pill glass / dot / grip | Move; position remembered on release |
| Hover the dot for 0.3 s | Auto-expand |
| Right-click | Native menu: expand/collapse · orientation · dot/pet · settings · quit |

## Architecture

```
Tauri 2
├─ Dock window (transparent · borderless · never key)   src/dock.ts + dock.css
├─ Settings window (transparent)                        src/settings.ts + settings.css
│      │ invoke / events
└─ Rust core
   ├─ state.rs     Idle → Calling → InCall → Switching(3s undo) | NeedsHuman
   ├─ seats.rs     seat model + seats.json
   ├─ settings.rs  appearance / position / orientation / collapse policy / shortcuts / memory → settings.json
   ├─ hotkeys.rs   global shortcuts + conflict detection
   ├─ mic.rs       system-level mute
   ├─ everos.rs    EverOS HTTP client (add / search / flush)
   ├─ memory.rs    read/write memory on the call lifecycle (pure, unit-tested)
   ├─ drivers/     drivers-as-data (JSON) · web.rs hidden webview · app.rs Accessibility
   └─ lib.rs       commands · tray · native material · cursor hover poll · probe loop · memory scheduling
          │
          ├─ NSGlassEffectView / NSVisualEffectView / Mica   (system material)
          ├─ hidden WKWebView / WebView2                      (one data directory per seat)
          └─ input-device volume / IAudioEndpointVolume / pactl (mute)
```

**Principles**

- **The window is the glass shape.** The Dock window morphs with state and sizes itself to content; material, corner radius and shadow are drawn by the OS, the web layer only lays out symbols.
- **Drivers are data.** Each vendor's URL, login check, selectors and call / hang-up / mute steps live in [`src-tauri/drivers/*.json`](src-tauri/drivers); drop a higher-`version` copy in the user data directory to hot-update without rebuilding.
- **Invisible integration.** Web seats run in hidden, persistent webviews with isolated data directories; you log in once, everything after that is code-driven, no browser window ever pops up.
- **Hands off credentials.** The login window is the real site's login page and you complete it yourself (2FA / Passkey included); AgentDock never reads or stores passwords.

```
src-tauri/src
├── state.rs        pure state machine (incl. undoable switch)
├── seats.rs        seat model + persistence
├── settings.rs     appearance / position / orientation / collapse policy / shortcuts / mic / memory
├── hotkeys.rs      global shortcut binding + conflict detection
├── mic.rs          system-level mute (macOS / Windows / Linux)
├── everos.rs       EverOS v2 HTTP client (the key comes only from the environment)
├── memory.rs       search when a call starts; write on connect, captions, and hangup
├── drivers/        mod.rs registry · web.rs hidden webview · app.rs desktop app (Accessibility)
└── lib.rs          Tauri commands, tray, system material, hover poll, probe loop, memory scheduling
src-tauri/drivers/*.json   chatgpt-dot · grok-bot · copilot-voice · muse-voice · devin-voice
src/dock.ts + dock.css     the pill
src/settings.ts + .css     settings window (Seats / Shortcuts / Appearance / Microphone / Memory / About)
src/brand.ts               built-in brand marks; public/brand/<key>.svg overrides
tests/                     e2e_mock.py (browser E2E) · e2e_xvfb.sh (Linux real-binary smoke)
docs/ref/                  visual reference images + reproduction spec (SPEC.md)
```

## Connecting seats

| Seat | Mechanism | Status |
|---|---|---|
| ChatGPT dot | hidden webview · chatgpt.com | selectors to be pinned on a real device |
| Copilot Voice | hidden webview · copilot.microsoft.com | selectors to be pinned |
| Muse | hidden webview · muse.ai | selectors to be pinned |
| Devin | hidden webview · app.devin.ai | selectors to be pinned |
| Grok Bot | desktop app · macOS Accessibility | needs Accessibility permission; to be pinned |

**First connection (you do this once)**

1. Settings › Seats › **Sign in / Connect**: a real login window opens (the embedded browser, visible this one time). Sign in as usual; the window closes itself and the seat shows *Connected*.
2. macOS asks once to allow AgentDock to use the microphone — allow.
3. Click **Test call**: connect → 2 s → hang up. If it reports *no call detected*, pin the selectors as below.
4. Grok Bot: click **Grant Accessibility →** and tick AgentDock in System Settings.

**Pinning selectors (once per vendor)**

Selectors in the driver JSON are written from each site's public `aria-label`s and marked `"verified": false`. Use the same steps after a site redesign:

1. Settings › Seats › ⋯ › **Show background page** opens that seat's hidden page;
2. Right-click › Inspect Element, find stable attributes for call / mute / hang up;
3. Edit `src-tauri/drivers/<id>.json`, or drop a higher-`version` copy into
   `~/Library/Application Support/ai.we1jia.agentdock/drivers/` (no rebuild), then **Test call** again.

## Long-term memory (EverOS)

AgentDock does not run a model — each seat is an external voice product. Memory is therefore attached to the **call lifecycle**, not to a local generation step:

| When | EverOS | What happens |
|---|---|---|
| Call starts (including a committed switch) | `POST /api/v2/memory/search` | `hybrid`, `top_k` 5 by default, profile included. Matching episode narratives are pasted into a **web seat's** composer under the marker `[AgentDock memory]`. Nothing is auto-sent |
| Probe reports in-call | `POST /api/v2/memory/add` | One line: voice call started with this seat |
| About every 2s during the call | same | New caption bubbles that carry a role (`data-message-author-role` and similar). Text with no role is dropped |
| Hangup, remote hangup, or a committed switch | `add`, then `POST /flush` about 2s later | Duration, or a note that the call never connected. `no_extraction` means the buffer had nothing pending yet — not a failure |

One EverOS session per call (`ad-<seat>-<unix ms>`). The user is `user_id`; the seat speaks as `seat-<seat id>`. `app_id` defaults to `agentdock`, so this key's other apps stay in their own scope. Writes are asynchronous (Cloud returns `202 queued`); extraction runs inside EverOS.

Requests time out after 6s (connect 3s). A failed search, write, or injection is logged and **the call still goes through**. With no key, with the setting off, or with `EVEROS_ENABLED=0`, the client sends nothing.

The core is Rust, so this calls the HTTP API directly instead of the Python SDK `everos-cloud` (a thin wrapper over the same v2 routes — a desktop app should not grow a Python runtime for that).

**Turn it on**

1. Create a key in the [EverOS Console](https://everos.evermind.ai/api-keys).
2. Put it in the environment of **the process that launches AgentDock** (a `.app` opened from Finder does not see a terminal `export`):

```bash
export EVEROS_API_KEY="your key"          # required; never written to the repo or settings.json
# export EVEROS_BASE_URL="http://127.0.0.1:8000"   # self-hosted EverOS OSS, optional
# export EVEROS_USER_ID="user_001"         # optional; otherwise the first enable mints ad-<uuid> into settings.json
# export EVEROS_APP_ID="agentdock"         # optional
# export EVEROS_PROJECT_ID="default"       # optional
# export EVEROS_ENABLED=1                  # optional: enable without the settings toggle; =0 forces off
npm run tauri dev
```

For a Finder-launched app on macOS: `launchctl setenv EVEROS_API_KEY "your key"`, then open the app again. Self-hosted OSS does not check the token by default, but AgentDock still treats a missing `EVEROS_API_KEY` as "memory off", so set any non-empty value.

3. **Settings › Memory › Enable long-term memory**. A key alone, with the toggle off, uploads nothing.
4. Call a web seat from the Dock (the settings **Test call** button only checks selectors; it does not write memory). A few seconds later the call shows up in the [EverOS Console](https://everos.evermind.ai); the next call pastes what was extracted into the composer.

Composer and caption selectors can live in the driver JSON (a higher `version` in the user drivers directory hot-updates):

```json
"memory": {
  "composer": ["#prompt-textarea"],
  "transcript": ["[data-message-author-role]"]
}
```

Empty lists use the generic selectors. Desktop-app seats (Grok Bot) have no composer to fill; call start and end are still recorded.

## Testing

```bash
cd src-tauri && cargo test                             # 46 unit tests: state machine / agents / settings compat / placement / morph spring / hotkeys / drivers / EverOS
npm run build                                          # type-check + bundle
npx vite --port 1420 & python3 tests/e2e_mock.py       # 31 browser E2E checks: state→DOM, orientation, drag, grip, auto-collapse, collapse modes, settings (incl. memory toggle)
bash tests/e2e_xvfb.sh                                 # Linux real-binary smoke (Xvfb)
DOCS_RS=1 cargo check --target aarch64-apple-darwin    # cross-check the macOS objc2 code from Linux
python3 .shots/shoot.py                                # regenerate the mock screenshots in docs/screenshots
```

Verified on a real Mac (macOS 26.6.2 · Apple Silicon): native `NSGlassEffectView`, no artifacts on theme change, zero-drift drag, position persists across restarts, orientation toggle, grip, auto-collapse and the three collapse modes, ⌥O / ⌥P / ⌥Space, native context menu.

## Privacy & limits

- **No credentials.** Login happens on the real site page, by you; cookies stay inside each seat's isolated webview data directory.
- **No uploads by default.** No telemetry. Only after Memory is enabled *and* the process has `EVEROS_API_KEY` are call events and on-screen captions sent to EverOS (Cloud, or your own `EVEROS_BASE_URL`).
- **UI automation has limits.** None of the vendors expose a "call my agent" API, so everything goes through their UIs; redesigns require updating the driver JSON.
- **Still to verify on your device:** `getUserMedia` permission inside a hidden webview and WebRTC throttling while invisible. If a site blocks embedded login, the fallback is driving your local Chrome via CDP.
- **System mute** is skipped (UI state only) on machines without an audio input device.

## Roadmap

- [x] Three pill states · call / mute / hang up / switch / undo
- [x] Native macOS 26 Liquid Glass · light / dark / follow system
- [x] Drag anywhere · horizontal / vertical · ⇅/⇄ grip
- [x] Auto-collapse · three collapse modes · hover to expand
- [x] Recordable global shortcuts · native context menu
- [x] Settings: drag-sort seats · custom icons / GIF · shortcuts · appearance · microphone · EverOS memory
- [ ] Pin selectors on real devices and flip `verified: true`
- [ ] Windows build + Mica verification
- [ ] Incoming-activity hint during a call (pill breathes when another seat has something to say)
- [ ] Signed & notarized .dmg releases

## Credits

Visual language follows the Apple Human Interface Guidelines and macOS Tahoe system controls (reference images and reproduction spec in [`docs/ref`](docs/ref)). Built on [Tauri 2](https://tauri.app), [window-vibrancy](https://github.com/tauri-apps/window-vibrancy) and [objc2](https://github.com/madsmtm/objc2).

## License

[MIT](LICENSE) © 2026 we1jia
