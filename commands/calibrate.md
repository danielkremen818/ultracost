---
description: Tune the estimator from your real token usage (outlier-filtered prior) so future estimates match your reality, and report what changed.
allowed-tools: Bash, Read, AskUserQuestion
---
# ultracost calibrate

You are running the **calibrate** workflow. Goal: update the token prior and explain the
effect.

1. Apply the calibration:
   ```bash
   env -u NO_COLOR FORCE_COLOR=3 node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" calibrate
   ```
2. Report what was learned (samples, tokens/stage, per-model) and that `estimate`,
   `explain`, `simulate`, and the cost gate now use your real sizes. If there was too
   little data, say what is needed (run more ultracode workflows, then re-calibrate).

## How to present this

The CLI output is your **evidence** — its panels, tables, and bars (in color, since
`FORCE_COLOR` is set) are shown to the user in the command-output view; don't just
re-echo them, and don't strip them either. Lead with your reasoning and the recommended
action. When you offer choices, use the **AskUserQuestion** tool so the user gets a native
picker, then carry out what they choose. Keep prose tight.
