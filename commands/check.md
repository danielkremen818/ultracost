---
description: Guard a dynamic-workflow script and fix it: flag agent() stages that would inherit the session model or mismatch the task, propose the right per-stage pins, and offer to apply them.
argument-hint: [path-to-workflow-script-or-dir]
allowed-tools: Bash, Read, Edit, AskUserQuestion
---
# ultracost check

You are running the **check** workflow. Goal: leave the script with every `agent()`
stage correctly pinned. Work as an agent — the CLI gives you evidence, you decide and act.

1. Pick the target: if `$ARGUMENTS` is set use it; otherwise find the most recently
   modified `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/*/workflows/scripts/*.js`; if
   none, use the current directory.
2. Gather evidence:
   ```bash
   env -u NO_COLOR FORCE_COLOR=3 node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" check <target>
   ```
3. Reason per finding. For UC001/UC002 (no pin) and UC006 (wrong tier), open the script
   with Read and decide the correct tier from the stage's prompt and the policy — `opus`
   @ `xhigh` for work that DECIDES how to change code (design, refactor, debug, review,
   synthesis); `sonnet` for pre-planned mechanical/search/format work; never `haiku`;
   alwaysOpus roles stay on opus (UC008); cap effort per model (UC007). Build a concrete
   per-stage proposal (file:line → `{ model, effort }`).
4. If there is nothing to fix, say so and stop. Otherwise present the proposal, then use
   **AskUserQuestion** to offer: *Apply all* (the unambiguous `--fix` cases plus your
   hand-pins via Edit), *Only safe auto-fix* (run `env -u NO_COLOR FORCE_COLOR=3 node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" check <target> --fix`), *Show
   the edits first*, or *Cancel*.
5. Carry out the choice, then re-run the guard to confirm it is clean.

## How to present this

The CLI output is your **evidence** — its panels, tables, and bars (in color, since
`FORCE_COLOR` is set) are shown to the user in the command-output view; don't just
re-echo them, and don't strip them either. Lead with your reasoning and the recommended
action. When you offer choices, use the **AskUserQuestion** tool so the user gets a native
picker, then carry out what they choose. Keep prose tight.
