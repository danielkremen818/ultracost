# Testing guide

A step-by-step manual test for ultracost — from a zero-risk sandbox install through a live
Claude Code `ultracode` run. Every command is copy-pasteable.

Each step is tagged:

- **[safe]** — read-only or fully sandboxed; cannot affect your real `~/.claude`.
- **[touches ~/.claude]** — writes to or registers state in your real Claude Code config.
  Reversible; cleanup is in the last section.

All commands assume the repo is at `~/projects/ultracost`:

```bash
cd ~/projects/ultracost
```

> The plugin steps (Step 3, and the live run in Step 5) require the plugin package
> (`.claude-plugin/`, `skills/`, `commands/`, `hooks/`) to be present in the repo. The npm
> steps need only `bin/`, `src/`, and `templates/`.

<div align="center">

<img src="https://raw.githubusercontent.com/danielkremen818/ultracost/main/assets/diagram-testing.svg" alt="The manual test ladder: Step 1 sandbox install (safe) → Step 2 deterministic proof (safe) → Step 3 plugin, local (touches ~/.claude) → Step 4 npm link (touches ~/.claude) → Step 5 live ultracode run (touches ~/.claude)." width="560">

</div>

---

## Step 1 — Sandbox install **[safe]**

Install into a throwaway config dir via `CLAUDE_CONFIG_DIR`. Nothing under your real
`~/.claude` is read or written.

```bash
SANDBOX=$(mktemp -d)
CLAUDE_CONFIG_DIR="$SANDBOX" node bin/cli.js init
CLAUDE_CONFIG_DIR="$SANDBOX" node bin/cli.js status
CLAUDE_CONFIG_DIR="$SANDBOX" node bin/cli.js doctor
```

Inspect exactly what `init` wrote:

```bash
ls -R "$SANDBOX"
cat "$SANDBOX/ultracost/policy.json"
cat "$SANDBOX/CLAUDE.md"
cat "$SANDBOX/settings.json"
cat "$SANDBOX/ultracost/reinject.mjs"
```

Expect:

- `ultracost/policy.json` — the default quality-first policy.
- `CLAUDE.md` — a `<!-- ultracost:start -->` … `<!-- ultracost:end -->` routing block.
- `settings.json` — a `SessionStart` hook with matcher `startup|resume|clear|compact` and
  command `node "<SANDBOX>/ultracost/reinject.mjs"`.
- `ultracost/reinject.mjs` — the node re-inject hook (no bash/jq).

Throw the sandbox away:

```bash
rm -rf "$SANDBOX"
```

---

## Step 2 — Deterministic proof **[safe]**

Read-only checks. `audit` only reads your real workflow scripts; it never writes.

Audit your real history (the proof point — most stages inherit the session model):

```bash
node bin/cli.js audit ~/.claude/projects
```

Expect a stage/pin breakdown with a high `unpinned ratio`. If you have no workflow
scripts yet, it reports none found — generate one in Step 5, then re-run.

Confirm the guard is clean on a correctly-pinned script:

```bash
node bin/cli.js check examples/workflow.good.js
```

Expect: `1 file(s) scanned — every agent() stage pins a model.` and exit code `0`:

```bash
node bin/cli.js check examples/workflow.good.js; echo "exit: $?"
```

Optional — confirm the guard *catches* problems and that JSON output works. Make a
throwaway script with two unpinned stages in a temp dir (nothing under the repo or
`~/.claude` is touched):

```bash
BADDIR=$(mktemp -d)
cat > "$BADDIR/bad.js" <<'EOF'
agent("plan the work");
agent("apply the decided edit", { label: "apply" });
EOF
node bin/cli.js check "$BADDIR/bad.js"          # expect UC001 + UC002, exit 1
node bin/cli.js check "$BADDIR/bad.js" --json   # same findings, machine-readable
rm -rf "$BADDIR"
```

Expect `UC001` (no options object) on the first stage and `UC002` (options object,
no `model`) on the second, a non-zero exit, and a `findings` array in the JSON form.

---

## Step 3 — Plugin (local, pre-publish) **[touches ~/.claude]**

Two ways to load the plugin from your working copy. Option A registers a marketplace
(persistent until removed); Option B loads it for one session only.

### Option A — local marketplace install

Register the working copy as a local marketplace and install from it (the dev/test path —
not a user-facing install):

```bash
claude plugin marketplace add ~/projects/ultracost
claude plugin install ultracost@ultracost
```

### Option B — session-scoped load (most contained)

```bash
claude --plugin-dir ~/projects/ultracost
```

### Verify the plugin loaded

Inside the session:

```text
/help
/ultracost:check ~/projects/ultracost/examples/workflow.good.js
```

Expect:

- `/help` lists the `ultracost` plugin and the `/ultracost:check` command.
- `/ultracost:check` on `workflow.good.js` reports a clean scan.
- The routing-policy **skill** is available — ask Claude to author a small workflow and
  confirm it pins `model:` per stage (it should, because the skill is loaded).

If you edited the plugin and want to reload without restarting:

```text
/reload-plugins
```

---

## Step 4 — npm (local link) **[touches ~/.claude]**

Link the package so the `ultracost` binary is on your PATH:

```bash
npm link
ultracost --version
ultracost audit ~/.claude/projects   # read-only [safe]
```

`ultracost init` writes to your real `~/.claude`. To keep it contained, run it sandboxed:

```bash
CLAUDE_CONFIG_DIR=$(mktemp -d) ultracost init   # [safe]
```

Or, to test the real install path (reversible via `ultracost uninstall`):

```bash
ultracost init        # [touches ~/.claude]
ultracost status
ultracost doctor
```

Unlink when done:

```bash
npm unlink -g ultracost
```

---

## Step 5 — Live Claude Code CLI run **[touches ~/.claude]**

End-to-end test against a real `ultracode` session. This is the one that proves ultracost
changes Claude's behavior.

1. Make sure routing is active — either the plugin is installed (Step 3) **or** the npm
   CLI is installed (`ultracost init`, Step 4).
2. Start Claude Code and turn on ultracode:

```bash
claude
```

```text
/effort ultracode
```

3. Give it a small workflow prompt, for example:

```text
Refactor the error handling across these three files and review the result.
Use a dynamic workflow with a planning stage, a parallel apply stage, and a review stage.
```

4. When the run starts, Claude prints the path of the workflow script it authored, under
   `~/.claude/projects/<project>/workflows/scripts/`. Check the newest one with the guard:

```bash
ultracost check "$(ls -t ~/.claude/projects/*/workflows/scripts/*.js | head -1)"
```

   **Eyeball the result:** with ultracost active, the mechanical/apply stages should be
   pinned to `sonnet` and the planning/review stages to `opus` — the guard reports a clean
   scan. As a before/after, run the same command in a session *without* ultracost and you
   should see `UC001`/`UC002` findings.

5. **Confirm the policy injection.** The `SessionStart` hook injects the routing policy as
   context at the start of every session (and again after compaction). It is delivered as
   `additionalContext`, so it shapes Claude's behavior without appearing as a chat message.
   To confirm it is wired and firing, run the hook directly and check it returns the policy:

```text
printf '{"source":"startup"}' | node "<SANDBOX>/ultracost/reinject.mjs"
```

   You should get a JSON object whose `additionalContext` states the routing policy. The
   plugin attaches the same hook on every `SessionStart` source (`startup|resume|clear|compact`).

---

## Cleanup

Undo everything the steps above can install.

```bash
# npm CLI install (Step 4)
ultracost uninstall          # removes the CLAUDE.md block, hook, settings entry, policy dir
npm unlink -g ultracost

# plugin install (Step 3, Option A)
claude plugin uninstall ultracost@ultracost
claude plugin marketplace remove ultracost
```

`--plugin-dir` (Step 3, Option B) leaves nothing behind — it ends with the session.
Sandbox dirs from Steps 1 and 4 are gone once you `rm -rf` them.
