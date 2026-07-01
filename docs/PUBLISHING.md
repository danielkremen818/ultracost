# Publishing & recognition

How to ship ultracost and get it found, ordered by impact. Do the pre-publish checklist
first, then work down the distribution list.

> **External-site note.** Anthropic plugin/marketplace facts below were verified against
> the official docs (`code.claude.com/docs/en/plugins`,
> `code.claude.com/docs/en/plugin-marketplaces`) on **2026-06-14**. The third-party
> directory mechanics (awesome lists, auto-trackers) were also checked on **2026-06-14** —
> confirm their current submission rules on each site before relying on them, since they change.

---

## Pre-publish checklist

The GitHub handle is set to `danielkremen818` across the repo. If you fork or move it,
update the handle in every file that ships:

- [x] `package.json` — `repository.url`, `bugs.url`, `homepage`.
- [x] `README.md` — the plugin install commands (`/plugin marketplace add danielkremen818/ultracost` → `/plugin install ultracost@ultracost`), the npm install command (`npx ultracost init`), and the npm/CI badge URLs.
- [x] `CHANGELOG.md` — the `[Unreleased]`/release compare links.
- [x] `.claude-plugin/plugin.json` — `homepage` and `repository`; also confirm `author` and `version`.
- [ ] `LICENSE` and `NOTICE` — confirm the copyright holder.

Names that must stay consistent across the plugin package and the docs (so the live
plugin install keeps working):

- Marketplace name: **`ultracost`** and plugin name: **`ultracost`** → the plugin resolves
  as `ultracost@ultracost`.
- Command resolves to **`/ultracost:check`**.

Sanity-check before any submission:

```bash
claude plugin validate .            # marketplace.json schema + referenced plugin.json
claude plugin validate ./           # (same, repo root)
npm test                            # unit tests
node bin/cli.js check examples/workflow.good.js
```

### GitHub repo "About" (sidebar metadata)

When the remote is created, set these on the repo's **About** panel (the gear icon at
the top-right of the repo page) so the listing reads well and the auto-trackers index it.

**Description** (one line):

```text
Per-stage model routing for Claude Code ultracode dynamic workflows — keeps a fan-out from silently running every subagent on Opus.
```

**Topics:**

```text
claude-code, claude-code-plugin, ultracode, dynamic-workflows, subagents, model-routing, cost-optimization, anthropic, claude
```

**Website:** the npm package page once published (`https://www.npmjs.com/package/ultracost`).

---

## Distribution, ordered by impact

### 1. Official community marketplace (highest reach)

Anthropic runs a public community marketplace, `anthropics/claude-plugins-community`, that
users add with `/plugin marketplace add anthropics/claude-plugins-community` and install
from as `@claude-community`. Approved plugins also surface on `claude.com/plugins`.

Submit a **public GitHub link** (or a zip) through the in-app directory form. The short link
**`clau.de/plugin-directory-submission`** redirects to the canonical entry points:

- **Console:** `platform.claude.com/plugins/submit` — for individual authors not in a
  Team/Enterprise org.
- **claude.ai:** `claude.ai/admin-settings/directory/submissions/plugins/new` — requires a
  Team or Enterprise org with directory-management access (org Owners have it by default).

What to know:

- Submissions run `claude plugin validate` **plus an automated safety screening** — pass the
  validate locally first.
- On approval the plugin is **pinned to a commit SHA**, **synced nightly** (expect a delay
  before it appears), and also shown at `claude.com/plugins`. Future pushes **auto-mirror** —
  no re-submission needed.
- The separate **official** marketplace (`claude-plugins-official`) is curated by Anthropic
  at its discretion — there's no application; the submission form does not add to it.

### 2. Your own marketplace repo (live now)

ultracost ships its own `.claude-plugin/marketplace.json`, so the repo **is** a self-hosted
plugin marketplace — no extra hosting required. Users install straight from it inside Claude
Code:

```text
/plugin marketplace add danielkremen818/ultracost
/plugin install ultracost@ultracost
```

These are the commands the README leads with; keep them in sync across the README, this doc,
and launch posts.

### 3. awesome-claude-code (hesreallyhim, ~46k stars)

A large, high-traffic curated list. **Submit via the issue form only** —
`https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml`.
**Do not open a PR** (PRs are auto-closed and trigger a submission cooldown). Their bar, which
ultracost already meets:

- **Evidence-based claims** — lead with the audit finding (most real `ultracode` stages are
  unpinned; even Anthropic's bundled `deep-research` workflow pins zero stages) and a short
  demo (`ultracost audit ~/.claude/projects`).
- **OSS license** — MIT.
- **No telemetry, no network calls** — ultracost is a local static analyzer + file installer;
  it makes no outbound requests.

### 4. Third-party directories (passive + light intake)

These sites index public Claude Code plugin/marketplace repos. Intake differs per site:

- **`claudemarketplaces.com`** — **no submission form**; it auto-crawls GitHub daily for repos
  with a valid `.claude-plugin/marketplace.json`. Quality gate: **5+ GitHub stars**. Listed
  within ~24h of meeting the bar.
- **`buildwithclaude.com`** — open a PR at `buildwithclaude.com/contribute` (repo
  `davepoon/buildwithclaude`); it also indexes GitHub on its own.
- **ClaudePluginHub (`claudepluginhub.com`)** — submit the repo URL for fast indexing;
  otherwise auto-discovered via GitHub Code Search.

### 5. npm publish + GitHub release

CI is already wired: pushing a `vX.Y.Z` tag runs the tests, creates a GitHub Release with
generated notes, and publishes to npm when `NPM_TOKEN` is set (see
`.github/workflows/release.yml`).

<div align="center">

<img src="https://raw.githubusercontent.com/danielkremen818/ultracost/main/assets/diagram-release.svg" alt="Release pipeline: pushing a vX.Y.Z tag runs the CI tests, which then create a GitHub Release with generated notes and publish to npm when NPM_TOKEN is set." width="820">

</div>

```bash
# bump version in package.json (and plugin.json), update CHANGELOG.md, commit, then:
git tag v0.1.0
git push origin v0.1.0
```

This makes `npx ultracost ...` work for the CLI/CI audience and gives the plugin a citable
release.

### 6. Launch posts

Lead every post with the evidence line:

> Even Anthropic's bundled `deep-research` workflow runs every stage on your session model —
> in a scan of ~22 real `ultracode` scripts, almost none pinned a model. ultracost makes the
> per-stage routing explicit and verifiable.

Channels:

- **r/ClaudeAI** — problem + the `ultracost audit` screenshot + install.
- **Anthropic Discord** — relevant plugin/workflow channels.
- **#claudecode on X** — the evidence line + a short demo clip.
- **GitHub Discussions** — a longer write-up linking the audit output and `docs/ultracode.md`.

---

## Post-launch

- Watch the community catalog for your plugin to appear (nightly sync) and link it once live.
- Keep `version` bumped on every plugin change, or users won't get updates (Claude Code skips
  re-install when the resolved version is unchanged).
- Re-run `ultracost audit` periodically as Claude Code evolves — the headline stat is the best
  proof the problem still exists.
