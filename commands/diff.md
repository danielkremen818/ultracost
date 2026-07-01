---
description: Diff the estimated cost of two workflow versions and judge whether the change is worth it; add --ci for a PR-comment table.
argument-hint: <old-script.js> <new-script.js>
allowed-tools: Bash, Read, AskUserQuestion
---
# ultracost diff

You are running the **diff** workflow. Goal: explain how an edit changed the cost and
whether that is justified.

1. Take two paths from `$ARGUMENTS` (old, then new).
2. Gather evidence:
   ```bash
   env -u NO_COLOR FORCE_COLOR=3 node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" diff <old> <new>
   ```
3. Interpret the delta (tiered cost + agent count): what drove it, and is it a reasonable
   trade for the capability gained? If this is for a pull request, re-run with `--ci` to
   emit the Infracost-style markdown table and hand that back.

## How to present this

The CLI output is your **evidence** — its panels, tables, and bars (in color, since
`FORCE_COLOR` is set) are shown to the user in the command-output view; don't just
re-echo them, and don't strip them either. Lead with your reasoning and the recommended
action. When you offer choices, use the **AskUserQuestion** tool so the user gets a native
picker, then carry out what they choose. Keep prose tight.
