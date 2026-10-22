"""Browser-mock end-to-end test for the Dock UI (no Tauri needed).
Runs against the Vite dev server (http://localhost:1420) in headless Chrome via CDP and asserts the
state machine → DOM contract: idle → calling → in_call → muted → switching → undo → hangup → collapsed.
"""
import asyncio, json, os, shutil, subprocess, sys, tempfile, time, urllib.request, websockets

PORT = 9444
URL = "http://localhost:1420/"
MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME = MAC_CHROME if os.path.exists(MAC_CHROME) else shutil.which("google-chrome") or shutil.which("chromium")

async def main() -> int:
    # Current Chrome refuses remote debugging on the default profile.
    profile = tempfile.mkdtemp(prefix="agentdock-chrome-")
    chrome = subprocess.Popen([CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", f"--user-data-dir={profile}", f"--remote-debugging-port={PORT}", "--window-size=900,300", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
        check("renders 4 visible seats + add", await ev("document.querySelectorAll('.bar .seat:not(.group-contact)').length") == 4 and await ev("!!document.querySelector('.bar .add')"))
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
        check("switching offers to bring the context along, on by default", await ev("document.querySelector('.bar .carry')?.getAttribute('aria-pressed')") == "true")
        await ev("document.querySelector('.bar .undo').click()"); await asyncio.sleep(0.3)
        check("undo returns to in_call on dot", await dock("phase") == "in_call" and "dot" in (await ev("document.querySelector('.bar .status .name').textContent")))
        await ev("document.querySelector('.seat[data-seat=copilot]').click()"); await asyncio.sleep(0.4)
        await ev("document.querySelector('.bar .carry').click()"); await asyncio.sleep(0.3)
        check("carry chip turns off for this switch", await ev("document.querySelector('.bar .carry').getAttribute('aria-pressed')") == "false")
        await asyncio.sleep(3.0)
        check("switch commits without a handoff", await dock("phase") in ("calling", "in_call") and await ev("(window.__mockHandoffs || []).length") == 0)
        await asyncio.sleep(1.4)
        await ev("document.querySelector('.seat[data-seat=dot]').click()"); await asyncio.sleep(3.3)
        check("next switch carries again: handoff sent, shown while dialling", await ev("(window.__mockHandoffs || []).length") == 1 and "带上" in (await ev("document.querySelector('.bar .status .sub').textContent")))
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
        # round-table: pick members on the idle pill, one voice floor, relays need consent
        st = lambda: ev("window.__mockInvoke('get_state')")
        check("saved groups show on the idle pill", await ev("document.querySelectorAll('.bar .group-contact').length") == 1)
        await ev("document.querySelector('.bar .group-toggle').click()"); await asyncio.sleep(0.4)
        check("群聊 picker: seats become pickable, an app seat shows its preflight", await ev("document.querySelectorAll('.bar .seat.pick').length") >= 3 and await ev("document.querySelector('.seat.pick[data-seat=\"grok-bot\"]')?.dataset.pre") == "todo")
        await ev("document.querySelector('.seat.pick[data-seat=dot]').click()"); await asyncio.sleep(0.2)
        await ev("document.querySelector('.seat.pick[data-seat=copilot]').click()"); await asyncio.sleep(0.3)
        check("two picked → a 呼叫 2 位 capsule", "2" in (await ev("document.querySelector('.bar .callgroup')?.textContent || ''")))
        await ev("document.querySelector('.bar .callgroup').click()"); await asyncio.sleep(0.4)
        room = (await st()).get("room") or {}
        check("calling the pick opens a room on the first member", await dock("phase") == "calling" and len(room.get("members", [])) == 2 and await ev("document.querySelector('.member[data-seat=dot]')?.dataset.floor") == "live")
        await asyncio.sleep(1.4)
        await ev("document.querySelector('.member[data-seat=copilot]').click()"); await asyncio.sleep(0.4)
        check("passing the floor in an ad-hoc room: relay chip off until you consent", await dock("phase") == "switching" and await ev("document.querySelector('.bar .carry')?.getAttribute('aria-pressed')") == "false" and "转述" in (await ev("document.querySelector('.bar .carry')?.textContent || ''")))
        await ev("document.querySelector('.bar .carry').click()"); await asyncio.sleep(0.3)
        check("tapping it is the consent for the room", (await st())["room"]["relay"] == True and await ev("document.querySelector('.bar .carry').getAttribute('aria-pressed')") == "true")
        await asyncio.sleep(3.0)
        relays = await ev("JSON.stringify(window.__mockRelays || [])")
        check("the pass sends one relay note to the next member and says so while dialling", '"to":"copilot"' in relays and "转述" in (await ev("document.querySelector('.bar .status .sub').textContent")))
        await asyncio.sleep(1.4)
        await ev("document.querySelector('.bar .next').click()"); await asyncio.sleep(3.4)
        check("下一位 passes round-robin and keeps the consent", await dock("phase") == "calling" and (await st())["phase"].get("seat") == "dot" and (await ev("(window.__mockRelays || []).length")) == 2)
        await ev("window.__mockInvoke('mock_member_trouble', {seatId: 'copilot', reason: 'captcha'})"); await asyncio.sleep(0.3)
        check("a member that needs a look gets a badge; the floor stays", await ev("document.querySelector('.member[data-seat=copilot]')?.dataset.trouble") == "1" and await dock("phase") == "calling")
        await ev("document.querySelector('.bar .btn.red').click()"); await asyncio.sleep(0.4)
        check("结束会议 → idle, no room", await dock("phase") == "idle" and not (await st()).get("room"))
        await ev("document.querySelector('.seat[data-seat=dot]').click()"); await asyncio.sleep(1.6)
        await ev("document.querySelector('.bar .addgroup').click()"); await asyncio.sleep(0.3)
        await ev("document.querySelector('.bar .addable[data-seat=copilot]').click()"); await asyncio.sleep(0.4)
        room = (await st()).get("room") or {}
        check("拉群 during a 1:1 call adds members without switching", len(room.get("members", [])) == 2 and room.get("relay") == False and await dock("phase") == "in_call")
        await ev("document.querySelector('.bar .btn.red').click()"); await asyncio.sleep(0.4)
        await ev("document.querySelector('.bar .group-contact').click()"); await asyncio.sleep(0.4)
        room = (await st()).get("room") or {}
        check("a saved group on the idle pill calls the whole group", room.get("name") == "产品评审" and len(room.get("members", [])) == 3 and room.get("relay") == True)
        await ev("document.querySelector('.bar .btn.red').click()"); await asyncio.sleep(0.4)
        await send("Page.navigate", url=URL + "room.html"); await asyncio.sleep(1.2)
        check("room panel: says when no group call is on", "没有进行中的群聊" in (await ev("document.body.innerText") or ""))
        await ev("window.__mockInvoke('start_room', {seatIds: ['dot', 'copilot']})"); await asyncio.sleep(0.2)
        await ev("const b = document.getElementById('say-text'); b.value = '预算三千'; b.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))"); await asyncio.sleep(0.4)
        check("room panel: Enter puts a typed line in the room", await ev("JSON.stringify(window.__mockRoomSays || [])") == '["预算三千"]' and "预算三千" in (await ev("document.getElementById('lines').innerText") or ""))
        await send("Page.navigate", url=URL + "settings.html?page=seats"); await asyncio.sleep(1.2)
        check("settings: the saved group is listed", "产品评审" in (await ev("document.querySelector('.groups')?.innerText || ''")))
        await ev("document.querySelector('.grp-new').click()"); await asyncio.sleep(0.4)
        await ev("const i = document.querySelector('.grp-name'); i.value = '晨会'; i.dispatchEvent(new Event('input'))")
        await ev("document.querySelector('.member-chips [data-seat=dot]').click()"); await asyncio.sleep(0.4)
        await ev("document.querySelector('.member-chips [data-seat=copilot]').click()"); await asyncio.sleep(0.4)
        check("settings: the editor keeps the typed name across re-renders and shows preflight", await ev("document.querySelector('.grp-name').value") == "晨会" and await ev("document.querySelectorAll('.grp-alias').length") == 2)
        await ev("document.querySelector('.grp-save').click()"); await asyncio.sleep(0.5)
        check("settings: saving a new group", await ev("(window.__mockGroups || []).map(g => g.name).join(',')") == "产品评审,晨会")
        await send("Page.navigate", url=URL); await asyncio.sleep(1.2)
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
