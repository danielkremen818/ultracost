---
description: Audit pin coverage across your real workflow scripts, identify the worst offenders, and offer to check or fix a specific one.
argument-hint: [dir]
allowed-tools: Bash, Read, AskUserQuestion
---
# ultracost audit

You are running the **audit** workflow. Goal: a read on pin hygiene across history and a
next action.

1. Use `$ARGUMENTS` as the directory if given, else `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects`.
2. Gather evidence:
   ```bash
   env -u NO_COLOR FORCE_COLOR=3 node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" audit <dir>
   ```
3. Interpret the totals and unpinned ratio. If coverage is poor, offer (via
   **AskUserQuestion**) to run `/ultracost:check` on the worst script and fix it.

## How to present this

The CLI output is your **evidence** — its panels, tables, and bars (in color, since
`FORCE_COLOR` is set) are shown to the user in the command-output view; don't just
re-echo them, and don't strip them either. Lead with your reasoning and the recommended
action. When you offer choices, use the **AskUserQuestion** tool so the user gets a native
picker, then carry out what they choose. Keep prose tight.
