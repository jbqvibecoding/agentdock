import asyncio, json, base64, subprocess, sys, time, urllib.request, websockets
PORT=9333
chrome = subprocess.Popen(["google-chrome","--headless=new","--no-sandbox","--disable-gpu",f"--remote-debugging-port={PORT}","--window-size=1200,800","--hide-scrollbars","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(2.5)
ws_url = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read())[0]["webSocketDebuggerUrl"]
WALL_DARK="radial-gradient(60% 50% at 30% 20%, #ff7a59 0%, transparent 60%), radial-gradient(50% 50% at 80% 90%, #3dd6f5 0%, transparent 60%), linear-gradient(135deg,#1b2a4a 0%,#4b2a6b 50%,#0f3b4f 100%)"
WALL_LIGHT="radial-gradient(60% 50% at 30% 20%, #ffb199 0%, transparent 60%), radial-gradient(50% 50% at 80% 90%, #9ad7ff 0%, transparent 60%), linear-gradient(135deg,#f3e7d3 0%,#dfe9f5 50%,#f7dce2 100%)"
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
        await send("Page.enable"); await send("Runtime.enable")
        async def shot(name, w, h, scale=2):
            await send("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=scale, mobile=False)
            await asyncio.sleep(0.4)
            r=await send("Page.captureScreenshot", format="png")
            open(f".shots/{name}.png","wb").write(base64.b64decode(r["data"])); print("shot",name)
        async def goto(url, dark):
            await send("Emulation.setEmulatedMedia", features=[{"name":"prefers-color-scheme","value":"dark" if dark else "light"}])
            await send("Page.navigate", url=url); await asyncio.sleep(1.2)
            await ev(f"document.body.style.background={json.dumps(WALL_DARK if dark else WALL_LIGHT)}; document.body.style.backgroundAttachment='fixed'; 1")
        # Dock: dark
        for dark in (True, False):
            tag = "dark" if dark else "light"
            await goto("http://localhost:1420/", dark)
            await ev("document.body.style.padding='40px 0'; document.body.style.placeItems='start center'; 1")
            await asyncio.sleep(0.8)
            await shot(f"dock-idle-{tag}", 760, 140)
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
            await ev("document.querySelector('.btn.ghost').click()"); await asyncio.sleep(0.9)
            await shot(f"dock-dot-{tag}", 760, 140)
        # Settings
        for dark in (True, False):
            tag = "dark" if dark else "light"
            for page in ("seats","hotkeys","appearance","mic","about"):
                await goto(f"http://localhost:1420/settings.html?page={page}", dark)
                await ev("document.body.style.background='transparent'; document.documentElement.style.background="+json.dumps(WALL_DARK if dark else WALL_LIGHT)+"; 1")
                await asyncio.sleep(0.8)
                await shot(f"settings-{page}-{tag}", 820, 560)
        print(await ev("JSON.stringify({w:innerWidth, sw:document.documentElement.scrollWidth})"))
asyncio.run(main())
chrome.terminate()
