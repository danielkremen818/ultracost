---
description: Estimate a workflow before launch and help cut its cost: agent count, model mix, tiered vs all-opus, then surface the costly stages and offer concrete downgrades.
argument-hint: <path-to-workflow-script>
allowed-tools: Bash, Read, Edit, AskUserQuestion
---
# ultracost estimate

You are running the **estimate** workflow. Goal: a clear cost picture and, if it is
expensive, a cheaper plan.

1. Use `$ARGUMENTS` as the script path (printed when an ultracode run starts).
2. Gather evidence:
   ```bash
   env -u NO_COLOR FORCE_COLOR=3 node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" estimate $ARGUMENTS
   ```
3. Interpret it: which stages dominate the cost, and are any mechanical/search stages
   still on `opus` or at higher effort than the work needs? Read the script if you need
   the stage prompts.
4. If there is a real saving available, name the specific stages to move (e.g. "stage 2
   'list files' → sonnet"), then use **AskUserQuestion**: *Apply these downgrades* (edit
   the pins and re-estimate), *Keep as is*, or *Explain a stage*. If it is already lean,
   say so and stop.

## How to present this

The CLI output is your **evidence** — its panels, tables, and bars (in color, since
`FORCE_COLOR` is set) are shown to the user in the command-output view; don't just
re-echo them, and don't strip them either. Lead with your reasoning and the recommended
action. When you offer choices, use the **AskUserQuestion** tool so the user gets a native
picker, then carry out what they choose. Keep prose tight.
