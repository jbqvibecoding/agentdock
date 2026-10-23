# AgentDock × yobiru: agents on other machines in a group call

AgentDock's round-table can include agents that run on **other machines** (a Codex session on a dev
box, a Grok routine on a server), reached with [yobiru](https://github.com/jbqvibecoding/yobiru)
over Tailscale. When the floor reaches such a member, AgentDock sends it one tracked request with
the meeting note; its text answer is read aloud on the Mac (`/usr/bin/say`). Nothing listens on
the network on the AgentDock side: it runs the Mac owner's own `yobiru` command.

## On the Mac (where AgentDock runs)

1. Install Tailscale and the yobiru plugin, then let your agent run `yobiru onboard` and follow it
   (config, a durable receiver so receipts and answers come back).
2. AgentDock › Settings › Agent › **远程成员 / Remote members**: AgentDock finds the `scripts/yobiru`
   launcher and Python by itself (or enter their paths), shows yobiru's own doctor and next step,
   and lists **agents online** in your tailnet: one tap adds one. **Test** sends a real request and
   tells you whether it was delivered, woken and answered.
3. Add the member to a saved group (or pick it on the Dock), and turn on **Relay (sends)** if it
   should hear what the others said.

## On the other machine (where the agent runs)

1. Tailscale and yobiru, set up as usual (`yobiru onboard`), with a receiver running.
2. Give the agent the **agentdock-room** skill in this folder (`skills/agentdock-room/SKILL.md`):
   copy the folder into the agent's skills (for Claude Code, `~/.claude/skills/agentdock-room/`).
   - Codex bridge: allow replies for that installation (`allow_replies`), and add one line to the
     dispatcher's instructions: *"A request whose text is JSON with `"type": "agentdock.room"` is an
     AgentDock round-table turn: follow the agentdock-room skill and answer it directly."*
   - A Grok routine woken by a webhook: put the skill's "Answer once" steps in the routine's prompt.
3. Let AgentDock wake it right away (the receiver decides wake levels; by default a sender only
   gets `batch`). The Settings card shows the exact command, for example:

       yobiru wake-config --agent codex --peer-max macbook=now --rate 6 --apply

   then restart that machine's yobiru receiver.

## What is sent, and limits

- One request per turn, `--as agentdock`, `--wake now` while AgentDock's own budget allows
  (6 an hour per agent by default, yobiru's own rate; the rest ask for `batch`), timeout 150 s.
- The note is JSON (≤ 8 KiB): the room's members, and, only with the room's consent to relay, what
  the others said since that member's last turn. It travels over Tailscale to your own machine.
- Answers are cut to 300 characters, stripped of markdown and read aloud; `[pass]` is silence.
  A late answer only goes into the room's record (▶ replays it in the room panel).
- A request that may have been delivered is never resent (yobiru's rule); one that failed gives the
  member a badge on the Dock, and free talk moves on.
