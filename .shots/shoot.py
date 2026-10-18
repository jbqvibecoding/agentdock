"""Render README screenshots from the browser mock (npx vite --port 1420 must be running).
Output: docs/screenshots/*.png at 2x. Real-machine shots (macOS Liquid Glass) are taken separately."""
import asyncio, json, base64, subprocess, time, urllib.request, websockets
PORT=9333
OUT="docs/screenshots"
chrome = subprocess.Popen(["google-chrome","--headless=new","--no-sandbox","--disable-gpu",f"--remote-debugging-port={PORT}","--window-size=1400,900","--hide-scrollbars","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(2.5)
ws_url = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read())[0]["webSocketDebuggerUrl"]
WALL={True:"url(/wall-dark.jpg) center/cover", False:"url(/wall-light.jpg) center/cover"}
async def main():
    async with websockets.connect(ws_url, max_size=50_000_000) as ws:
        mid=0
        async def send(method, **params):
            nonlocal mid; mid+=1
            await ws.send(json.dumps({"id":mid,"method":method,"params":params}))
            while True:
                m=json.loads(await ws.recv())
                if m.get("id")==mid: return m.get("result",{})
        async def ev(expr):
            r=await send("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
            return r.get("result",{}).get("value")
        async def inv(cmd, args=None):
            return await ev(f"window.__mockInvoke({json.dumps(cmd)}, {json.dumps(args or {})})")
        await send("Page.enable"); await send("Runtime.enable")
        async def shot(name, w, h, scale=2):
            await send("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=scale, mobile=False)
            await asyncio.sleep(0.45)
            r=await send("Page.captureScreenshot", format="png")
            open(f"{OUT}/{name}.png","wb").write(base64.b64decode(r["data"])); print("shot",name)
        async def goto(url, dark, place="start center", pad="40px 0"):
            await send("Emulation.setEmulatedMedia", features=[{"name":"prefers-color-scheme","value":"dark" if dark else "light"}])
            await send("Page.navigate", url=url); await asyncio.sleep(1.2)
            await ev(f"document.body.style.background={json.dumps(WALL[dark])}; document.body.style.backgroundAttachment='fixed'; document.body.style.padding={json.dumps(pad)}; document.body.style.placeItems={json.dumps(place)}; 1")
            await asyncio.sleep(0.6)
        async def hover(sel):
            box = await ev(f"(()=>{{const r=document.querySelector({json.dumps(sel)}).getBoundingClientRect();return [r.x+r.width/2, r.y+r.height/2]}})()")
            await send("Input.dispatchMouseEvent", type="mouseMoved", x=box[0], y=box[1]); await asyncio.sleep(0.35)
        async def unhover():
            await send("Input.dispatchMouseEvent", type="mouseMoved", x=2, y=2); await asyncio.sleep(0.2)

        for dark in (True, False):
            tag = "dark" if dark else "light"
            # hero (idle, centered)
            await goto("http://localhost:1420/", dark, place="center", pad="0")
            await shot(f"hero-{tag}", 1200, 320)
            # states
            await goto("http://localhost:1420/", dark)
            await shot(f"dock-idle-{tag}", 760, 140)
            await hover(".grip"); await shot(f"dock-grip-hover-{tag}", 760, 140); await unhover()
            await ev("agentdock.call('dot')"); await asyncio.sleep(0.4)
            await shot(f"dock-calling-{tag}", 760, 140)
            await asyncio.sleep(1.6); await ev("agentdock.mute()"); await asyncio.sleep(0.5)
            await shot(f"dock-incall-muted-{tag}", 760, 140)
            await ev("agentdock.mute()"); await asyncio.sleep(0.3)
            await shot(f"dock-incall-{tag}", 760, 140)
            await ev("agentdock.call('grok-bot')"); await asyncio.sleep(0.6)
            await shot(f"dock-switching-{tag}", 760, 140)
            await asyncio.sleep(3.5)
            await ev("agentdock.hangup()"); await asyncio.sleep(0.3)
            await inv("set_expanded", {"expanded": False}); await asyncio.sleep(0.9)
            await shot(f"dock-dot-{tag}", 760, 140)
            await inv("toggle_collapsed_form"); await asyncio.sleep(0.9)
            await shot(f"dock-pet-{tag}", 760, 140)
            await inv("toggle_collapsed_form"); await inv("set_expanded", {"expanded": True}); await asyncio.sleep(0.6)
            # vertical
            await inv("toggle_orientation"); await asyncio.sleep(0.9)
            await ev("document.body.style.placeItems='start center'; 1")
            await shot(f"dock-vertical-idle-{tag}", 240, 560)
            await ev("agentdock.call('dot')"); await asyncio.sleep(2.2)
            await shot(f"dock-vertical-incall-{tag}", 240, 620)
            await ev("agentdock.hangup()"); await inv("toggle_orientation"); await asyncio.sleep(0.5)
        for dark in (True, False):
            tag = "dark" if dark else "light"
            for page in ("seats","hotkeys","appearance","mic"):
                await goto(f"http://localhost:1420/settings.html?page={page}", dark)
                await ev("document.body.style.padding='0'; document.body.style.background='transparent'; document.documentElement.style.background="+json.dumps(WALL[dark])+"; 1")
                await asyncio.sleep(0.8)
                await shot(f"settings-{page}-{tag}", 980, 620)
        print(await ev("JSON.stringify({w:innerWidth, sw:document.documentElement.scrollWidth})"))
asyncio.run(main())
chrome.terminate()
