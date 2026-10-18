"""Browser-mock end-to-end test for the Dock UI (no Tauri needed).
Runs against the Vite dev server (http://localhost:1420) in headless Chrome via CDP and asserts the
state machine → DOM contract: idle → calling → in_call → muted → switching → undo → hangup → collapsed.
"""
import asyncio, json, subprocess, sys, time, urllib.request, websockets

PORT = 9444
URL = "http://localhost:1420/"

async def main() -> int:
    chrome = subprocess.Popen(["google-chrome", "--headless=new", "--no-sandbox", "--disable-gpu", f"--remote-debugging-port={PORT}", "--window-size=900,300", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
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
        # settings page smoke
        await send("Page.navigate", url=URL + "settings.html?page=hotkeys"); await asyncio.sleep(1.2)
        check("settings: hotkeys page renders 3 globals", await ev("document.querySelectorAll('.key').length") == 3)
        await ev("document.querySelector('[data-page=appearance]').click()"); await asyncio.sleep(0.4)
        check("settings: appearance has 4 form cards", await ev("document.querySelectorAll('.card').length") == 4)
        await ev("document.querySelectorAll('.card')[3].click()"); await asyncio.sleep(0.3)
        check("settings: picking a card saves default_form=pet", await ev("window.__mockSettings && window.__mockSettings.default_form") == "pet" and await ev("document.querySelectorAll('.card')[3].classList.contains('is-on')"))
        errors = await ev("window.__errors || 0")
        check("no uncaught errors", errors == 0)
    chrome.terminate()
    print(f"\n{len(failures)} failure(s)")
    return 1 if failures else 0

sys.exit(asyncio.run(main()))
