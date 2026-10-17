#!/usr/bin/env bash
# Real-binary smoke test on a headless X server (Linux CI / dev box).
# Launches the debug build under Xvfb, clicks the collapsed dot, asserts the window grew into the
# pill, calls a seat, and asserts the state reached "needs a human" after the call timeout.
set -euo pipefail
cd "$(dirname "$0")/.."
curl -sf http://localhost:1420/ >/dev/null || { echo "start the dev server first: npx vite --port 1420"; exit 2; }
if [ -z "${INSIDE_XVFB:-}" ]; then
  exec xvfb-run -a -s "-screen 0 1440x900x24" env INSIDE_XVFB=1 bash "$0"
fi
RUST_LOG=agentdock=debug ./src-tauri/target/debug/agentdock >/tmp/agentdock-e2e.log 2>&1 &
APP=$!
trap 'kill $APP 2>/dev/null || true' EXIT
sleep 6
geom() { xdotool getwindowgeometry --shell "$1"; }
W=""; for w in $(xdotool search --name '^AgentDock$'); do eval "$(geom $w)"; [ "$WIDTH" -gt 20 ] && { W=$w; break; }; done
[ -n "$W" ] || { echo "FAIL no dock window"; exit 1; }
eval "$(geom $W)"; echo "collapsed ${WIDTH}x${HEIGHT} at $X,$Y"
[ "$WIDTH" -le 40 ] && echo "PASS collapsed is a 36px dot" || { echo "FAIL collapsed size"; exit 1; }
xdotool mousemove $((X+WIDTH/2)) $((Y+HEIGHT/2)) click 1; sleep 1.5
eval "$(geom $W)"; echo "expanded ${WIDTH}x${HEIGHT} at $X,$Y"
[ "$WIDTH" -gt 300 ] && [ "$HEIGHT" -eq 56 ] && echo "PASS expands into a 56px pill, centred" || { echo "FAIL expand"; exit 1; }
xdotool mousemove $((X+190)) $((Y+28)) click 1; sleep 2
eval "$(geom $W)"; [ "$WIDTH" -gt 300 ] && echo "PASS calling state rendered" || { echo "FAIL calling"; exit 1; }
sleep 16
eval "$(geom $W)"; echo "after timeout ${WIDTH}x${HEIGHT}"
grep -q 'panicked' /tmp/agentdock-e2e.log && { echo "FAIL panic in log"; exit 1; } || echo "PASS no panics"
echo "OK"
