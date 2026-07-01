---
description: Set up, preview, or disable the ultracost HUD statusline — a live multi-line panel showing session cost, cumulative savings vs all-opus, the subagents running right now (model + tier + elapsed), and an animated pixel-art ultracost logo.
argument-hint: [setup|preview|disable]
allowed-tools: Bash, Read, AskUserQuestion
---
# ultracost hud

You are running the **hud** workflow. The HUD is a Claude Code statusline command that
renders a live ultracost panel (cost + savings + running subagents + animated logo). Goal:
do exactly what `$ARGUMENTS` asks — `preview` (default), `setup`, or `disable`.

1. Read `$ARGUMENTS`: if it is `setup` go to step 3, if it is `disable` go to step 4,
   otherwise (empty or `preview`) do step 2.
2. **preview** — render the HUD from a sample statusline payload so the user sees exactly
   what it looks like, and show it as evidence:
   ```bash
   echo '{"session_id":"preview","transcript_path":"/tmp/none.jsonl","model":{"id":"claude-opus-4-8","display_name":"Opus 4.8 (1M context)"},"effort":{"level":"xhigh"},"cost":{"total_cost_usd":0.21},"context_window":{"used_percentage":41,"context_window_size":1000000}}' \
     | env -u NO_COLOR FORCE_COLOR=3 node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" hud
   ```
   Walk the regions briefly (savings headline, today vs budget, session cost, model/effort/context,
   the running-subagents list, the animated logo) and stop. Do not change any settings on preview.
3. **setup** — first preview it as in step 2 so the user knows what they are enabling, then
   use **AskUserQuestion** to confirm: *Set ultracost as my statusline* or *Cancel*. Only if
   they confirm, install it:
   ```bash
   env -u NO_COLOR FORCE_COLOR=3 node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" hud --install
   ```
   Then relay the notice the CLI prints: ultracost set itself as the Claude Code statusline,
   the previous statusline was backed up, and it is restored on disable/uninstall. Mention they
   can re-run `/ultracost:hud preview` or `/ultracost:hud disable` any time.
4. **disable** — restore the previous statusline:
   ```bash
   env -u NO_COLOR FORCE_COLOR=3 node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" hud --uninstall
   ```
   Confirm what was restored (the backed-up statusline, or removed if there was none).

## How to present this

The CLI output is your **evidence** — its panels, tables, and bars (in color, since
`FORCE_COLOR` is set) are shown to the user in the command-output view; don't just
re-echo them, and don't strip them either. Lead with your reasoning and the recommended
action. When you offer choices, use the **AskUserQuestion** tool so the user gets a native
picker, then carry out what they choose. Keep prose tight.
