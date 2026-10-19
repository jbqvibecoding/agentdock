"""Browser-mock end-to-end test for the Dock UI (no Tauri needed).
Runs against the Vite dev server (http://localhost:1420) in headless Chrome via CDP and asserts the
state machine → DOM contract: idle → calling → in_call → muted → switching → undo → hangup → collapsed.
"""
import asyncio, json, subprocess, sys, tempfile, time, urllib.request, websockets

PORT = 9444
URL = "http://localhost:1420/"

async def main() -> int:
    # Current Chrome refuses remote debugging on the default profile.
    profile = tempfile.mkdtemp(prefix="agentdock-chrome-")
    chrome = subprocess.Popen(["google-chrome", "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", f"--user-data-dir={profile}", f"--remote-debugging-port={PORT}", "--window-size=900,300", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=0.3).close()
            break
        except Exception:
            time.sleep(0.15)
    else:
        chrome.terminate()
        print("chrome did not open a devtools port")
        return 1
    ws_url = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read())[0]["webSocketDebuggerUrl"]
    failures = []
    def check(name, cond):
        print(("PASS " if cond else "FAIL ") + name)
        if not cond: failures.append(name)
    async with websockets.connect(ws_url, max_size=50_000_000) as ws:
        mid = 0
        async def send(method, **params):
            nonlocal mid; mid += 1
            await ws.send(json.dumps({"id": mid, "method": method, "params": params}))
            while True:
                m = json.loads(await ws.recv())
                if m.get("id") == mid: return m.get("result", {})
        async def ev(expr):
            r = await send("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
            return r.get("result", {}).get("value")
        await send("Page.enable"); await send("Runtime.enable")
        await send("Page.navigate", url=URL); await asyncio.sleep(1.5)
        dock = lambda attr: ev(f"document.getElementById('dock').dataset.{attr}")
        check("boots expanded & idle in mock", await dock("form") == "bar" and await dock("phase") == "idle")
        check("renders 4 visible seats + add", await ev("document.querySelectorAll('.bar .seat').length") == 4 and await ev("!!document.querySelector('.bar .add')"))
        check("Muse seat is disabled/pending", await ev("document.querySelector('.seat[data-seat=muse]').classList.contains('disabled')"))
        await ev("document.querySelector('.seat[data-seat=dot]').click()"); await asyncio.sleep(0.3)
        check("click seat → calling", await dock("phase") == "calling")
        check("calling shows hangup + waveform", await ev("!!document.querySelector('.bar .btn.red') && !!document.querySelector('.bar canvas.wave')"))
        await asyncio.sleep(1.5)
        check("→ in_call with timer", await dock("phase") == "in_call" and "00:0" in (await ev("document.querySelector('.bar .status .sub').textContent")))
        await ev("document.getElementById('mic').click()"); await asyncio.sleep(0.3)
        check("mute turns amber", await dock("muted") == "true" and await ev("document.getElementById('mic').classList.contains('amber')"))
        await ev("document.querySelector('.seat[data-seat=copilot]').click()"); await asyncio.sleep(0.4)
        check("tap other seat → switching with undo", await dock("phase") == "switching" and "撤销" in (await ev("document.querySelector('.bar .undo')?.textContent || ''")))
        check("mute persists across switch", await dock("muted") == "true")
        await ev("document.querySelector('.bar .undo').click()"); await asyncio.sleep(0.3)
        check("undo returns to in_call on dot", await dock("phase") == "in_call" and "dot" in (await ev("document.querySelector('.bar .status .name').textContent")))
        await ev("document.querySelector('.bar .btn.red').click()"); await asyncio.sleep(0.3)
        check("hangup → idle", await dock("phase") == "idle")
        await ev("document.querySelector('.bar .btn.ghost').click()"); await asyncio.sleep(0.6)
        check("collapse → dot form, 36px", await dock("form") == "dot" and await ev("getComputedStyle(document.getElementById('dock')).width") == "36px")
        await ev("document.getElementById('collapsed').click()"); await asyncio.sleep(0.6)
        check("expand again", await dock("form") == "bar")
        await ev("window.__mockInvoke('save_settings', {settings: {...window.__mockSettings, orientation: 'vertical'}})"); await asyncio.sleep(0.8)
        check("vertical orientation → column pill, taller than wide", await dock("orient") == "vertical" and await ev("getComputedStyle(document.querySelector('.bar')).flexDirection") == "column" and await ev("(r=>r.height>r.width)(document.getElementById('dock').getBoundingClientRect())"))
        await ev("window.__mockInvoke('save_settings', {settings: {...window.__mockSettings, orientation: 'horizontal'}})"); await asyncio.sleep(0.8)
        # drag: press on the pill's left padding (not a button), move, release → window moved + anchored
        r = await ev("JSON.stringify(document.getElementById('dock').getBoundingClientRect())"); r = json.loads(r)
        x0, y0 = r["x"] + 5, r["y"] + r["height"] / 2
        await send("Input.dispatchMouseEvent", type="mousePressed", x=x0, y=y0, button="left", clickCount=1)
        for i in range(1, 6): await send("Input.dispatchMouseEvent", type="mouseMoved", x=x0 + i * 12, y=y0 + i * 7, button="left"); await asyncio.sleep(0.03)
        await send("Input.dispatchMouseEvent", type="mouseReleased", x=x0 + 60, y=y0 + 35, button="left", clickCount=1); await asyncio.sleep(0.3)
        check("drag pill → window follows cursor with grab offset, then anchors (snap=free)", await ev("window.__mockDrags > 0") and await ev(f"window.__mockGrab && Math.abs(window.__mockGrab.x-({x0}))<1 && Math.abs(window.__mockGrab.y-({y0}))<1") and await ev("window.__mockAnchored === true") and await ev("window.__mockSettings.snap") == "free")
        await ev("window.__mockInvoke('toggle_orientation')"); await asyncio.sleep(0.8)
        check("toggle_orientation hotkey/menu → vertical", await dock("orient") == "vertical")
        await ev("window.__mockInvoke('toggle_orientation')"); await asyncio.sleep(0.8)
        await ev("window.__mockInvoke('toggle_collapsed_form')"); await asyncio.sleep(0.3)
        check("toggle_collapsed_form → pet", await ev("window.__mockSettings.default_form") == "pet")
        await ev("window.__mockInvoke('toggle_collapsed_form')"); await asyncio.sleep(0.3)
        await ev("document.getElementById('dock').dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true}))"); await asyncio.sleep(0.2)
        check("right-click pill opens native menu (dock_menu)", await ev("window.__mockMenuOpened") == 1)
        check("grip handle at the pill's end shows ⇅ arrows", await ev("!!document.querySelector('.bar .grip svg')"))
        await ev("document.querySelector('.bar .grip').click()"); await asyncio.sleep(0.8)
        check("tap grip → vertical", await dock("orient") == "vertical")
        await ev("document.querySelector('.bar .grip').click()"); await asyncio.sleep(0.8)
        await ev("window.__mockInvoke('save_settings', {settings: {...window.__mockSettings, auto_collapse_secs: 1}})"); await asyncio.sleep(1.7)
        check("auto-collapse after 1 s idle → dot", await dock("form") == "dot")
        await ev("window.__mockInvoke('save_settings', {settings: {...window.__mockSettings, auto_collapse_secs: 1, collapse_mode: 'pinned_expanded'}})"); await ev("document.getElementById('collapsed').click()"); await asyncio.sleep(1.8)
        check("pinned_expanded never auto-collapses", await dock("form") == "bar")
        await ev("window.__mockInvoke('save_settings', {settings: {...window.__mockSettings, auto_collapse_secs: 0}})"); await ev("document.getElementById('collapsed').click()"); await asyncio.sleep(0.6)
        check("back to horizontal row", await dock("orient") == "horizontal" and await ev("(r=>r.width>r.height)(document.getElementById('dock').getBoundingClientRect())"))
        # settings page smoke
        await send("Page.navigate", url=URL + "settings.html?page=hotkeys"); await asyncio.sleep(1.2)
        check("settings: hotkeys page renders 5 globals", await ev("document.querySelectorAll('.key').length") == 5)
        await ev("document.querySelector('[data-page=appearance]').click()"); await asyncio.sleep(0.4)
        check("settings: appearance has 4 form cards", await ev("document.querySelectorAll('.card').length") == 4)
        await ev("document.querySelectorAll('.card')[3].click()"); await asyncio.sleep(0.3)
        check("settings: picking a card saves default_form=pet", await ev("window.__mockSettings && window.__mockSettings.default_form") == "pet" and await ev("document.querySelectorAll('.card')[3].classList.contains('is-on')"))
        await ev("document.querySelector('[data-page=memory]').click()"); await asyncio.sleep(0.4)
        check("settings: memory page explains the key and starts off", await ev("document.getElementById('title').textContent") == "记忆" and "EVEROS_API_KEY" in (await ev("document.getElementById('page').innerText") or "") and await ev("document.querySelector('#page [role=switch]').getAttribute('aria-checked')") == "false")
        await ev("document.querySelector('#page [role=switch]').click()"); await asyncio.sleep(0.3)
        check("settings: enabling memory saves the opt-in", await ev("window.__mockSettings.memory && window.__mockSettings.memory.enabled") == True)
        await ev("document.querySelector('[data-page=about]').click()"); await asyncio.sleep(0.4)
        check("settings: about privacy mentions EverOS", "EVEROS_API_KEY" in (await ev("document.getElementById('page').innerText") or "") and "长期记忆" in (await ev("document.getElementById('page').innerText") or ""))
        await ev("document.querySelector('[data-page=memory]').click()"); await asyncio.sleep(0.4)
        check("settings: memory opt-in survives leaving the page", await ev("document.querySelector('#page [role=switch]').getAttribute('aria-checked')") == "true" and await ev("window.__mockSettings.memory.enabled") == True)
        errors = await ev("window.__errors || 0")
        check("no uncaught errors", errors == 0)
    chrome.terminate()
    print(f"\n{len(failures)} failure(s)")
    return 1 if failures else 0

sys.exit(asyncio.run(main()))
