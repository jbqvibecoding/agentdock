# UI reference spec (from docs/ref/apple-ref-dock.png & apple-ref-settings.png — user-approved, "百分百还原")

Wallpaper: calm macOS-Tahoe blue → lavender waves. Everything LIGHT glass; dark theme is a tinted variant only.

## Dock pill (ref ~1040x72 in a 1568-wide frame → real 56px tall)
- Pill: near-white translucent glass, faint blue tint: bg rgba(255,255,255,.52); backdrop blur ~16px; hairline rim rgba(255,255,255,.9) 1px; very soft shadow 0 10px 30px rgba(40,60,120,.18); radius = height/2.
- Inside: round buttons 44px, white glass circles rgba(255,255,255,.78) with hairline rim; gap 14px; pill padding 12px.
- Power + mic icons: thin monochrome slate-blue (#5c6b99), stroke ~1.8.
- Hairline divider 1px rgba(80,100,160,.25), 22px tall, 10px margins.
- Agent circles: white circle, flat logo ~22px (OpenAI knot black; black rounded square + white bolt; blue→pink arc; purple ring).
- Plus: faint slate-blue, thinner circle.
- No labels, no text in idle state.

## Settings window (ref 980x620, radius ~22)
- Whole window = one light glass slab: bg rgba(255,255,255,.55) + blur; hairline rim; soft shadow. Sidebar column (260px) slightly MORE transparent than content; content pane rgba(255,255,255,.35) lighter band with radius 22 inset.
- Traffic lights top-left (16,16).
- Sidebar items: 48px tall, radius 12, padding 0 16, icon 22px monochrome dark (#1d1d1f), label 15px; selected = white pill rgba(255,255,255,.75) + hairline.
- Title 32px/700 #1d1d1f; subtitle 15px #6e6e73.
- Cards: rgba(255,255,255,.62), radius 16, hairline rim; rows padding 18px 22px; separators rgba(0,0,0,.06); label 16px/500, sub 13px #6e6e73.
- Controls: toggle 52x30 green #34c759; segmented: grey track rgba(0,0,0,.06) radius 12, selected white pill; buttons: white pill radius 12, 1px rgba(0,0,0,.08), 15px.
- Fonts: SF Pro; Chinese PingFang.
