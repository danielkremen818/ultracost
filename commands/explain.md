---
description: Explain a workflow stage by stage — pinned model, effort, the tier the prompt reads like, est cost, and which guard checks fire — and flag any pin that disagrees with the work.
argument-hint: <path-to-workflow-script>
allowed-tools: Bash, Read, AskUserQuestion
---
# ultracost explain

You are running the **explain** workflow. Goal: the user understands why each stage is
priced and pinned the way it is.

1. Use `$ARGUMENTS` as the script path.
2. Gather evidence:
   ```bash
   env -u NO_COLOR FORCE_COLOR=3 node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" explain $ARGUMENTS
   ```
3. Walk the stages that matter: confirm each pin fits the work (reads-like tier vs pinned
   model), and call out any UC006/UC007/UC008 flag with the concrete reason. If a stage is
   mispinned, offer (via **AskUserQuestion**) to jump into the `/ultracost:check` fix flow.

## How to present this

The CLI output is your **evidence** — its panels, tables, and bars (in color, since
`FORCE_COLOR` is set) are shown to the user in the command-output view; don't just
re-echo them, and don't strip them either. Lead with your reasoning and the recommended
action. When you offer choices, use the **AskUserQuestion** tool so the user gets a native
picker, then carry out what they choose. Keep prose tight.
