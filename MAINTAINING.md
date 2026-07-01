# Maintaining ultracost

Maintainer-only runbook: how to cut a release, the one-time npm Trusted
Publishing setup, and how to lock down the repository with branch/tag rulesets.

> **Audience:** the maintainer (**@danielkremen818**). Contributors don't need
> any of this — see [CONTRIBUTING.md](CONTRIBUTING.md).

## 1. Release process

Releases are tag-driven. Pushing a `vX.Y.Z` tag triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml), which runs the
tests, creates a GitHub Release, and publishes to npm via OIDC Trusted
Publishing (no token).

1. Bump the version in **both** manifests (they must match):
   - `package.json` → `"version"`
   - `.claude-plugin/plugin.json` → `"version"`
2. Update `CHANGELOG.md`: move `## [Unreleased]` entries under a new
   `## [X.Y.Z] - YYYY-MM-DD` heading, add a fresh empty `## [Unreleased]`, and
   add/refresh the compare links at the bottom.
3. Verify locally:
   ```bash
   npm test
   node bin/cli.js check examples/workflow.good.js
   claude plugin validate .
   ```
4. Commit, then tag and push the tag:
   ```bash
   git commit -am "chore: release vX.Y.Z"
   git tag vX.Y.Z
   git push origin main
   git push origin vX.Y.Z   # this triggers release.yml
   ```
5. Watch the run: `gh run watch` (or the Actions tab). On success you'll have a
   GitHub Release and a published npm version with provenance.

> Bump `version` on **every** plugin change. Claude Code skips re-install when
> the resolved version is unchanged, so users won't get updates otherwise.

## 2. npm Trusted Publishing (OIDC) — one-time setup

`release.yml` publishes with `npm publish --provenance --access public` and **no
`NODE_AUTH_TOKEN`**. Authentication is via GitHub Actions OIDC, so there is no
long-lived `NPM_TOKEN` secret to leak or rotate. This must be configured once on
npmjs.com before the first release:

1. The `ultracost` package must already exist on npm (publish `0.x` once
   manually if it doesn't, or do the initial publish with a granular token, then
   switch to Trusted Publishing).
2. On npmjs.com: **Package → Settings → Trusted Publishers → Add a publisher**
   (GitHub Actions). Set:
   - **Organization / user:** `danielkremen818`
   - **Repository:** `ultracost`
   - **Workflow filename:** `release.yml`
   - (optional) **Environment:** leave blank unless you add one to the job.
3. Enable **2FA** on the npm account (Trusted Publishing requires the account to
   have 2FA, and it's a baseline best practice regardless).
4. Confirm the workflow job has `permissions: id-token: write` (it does) — that
   token is what npm verifies.

After this, every tag push publishes with no secret in the repo.

## 3. Branch & tag protection (GitHub Rulesets)

These commands reflect 2026 GitHub best practice: **repository Rulesets**
(not the legacy "branch protection" UI) for layered, named, auditable rules.

> **Prerequisite — the remote must exist first.** Every `gh` command below
> targets `danielkremen818/ultracost`, so create and push the repo before
> running any of them:
>
> ```bash
> gh repo create danielkremen818/ultracost --source=. --public --remote=origin --push
> ```

### 3a. `main` branch ruleset (Option A — strict solo)

Requires a PR (0 approvals — you're solo, but PRs give you CI + a diff before
merge), the three CI checks must pass and be up to date, conversations must be
resolved, and force-push + deletion are blocked. **No bypass actors** — the rule
applies to everyone, including the owner.

```bash
gh api --method POST repos/danielkremen818/ultracost/rulesets --input - <<'JSON'
{
  "name": "main protection",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": { "include": ["refs/heads/main"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "test (24)" },
          { "context": "test (26)" }
        ]
      }
    }
  ]
}
JSON
```

> The status-check contexts `test (24)` / `test (26)` are the matrix job names
> from `ci.yml`. They only become selectable after CI has run at least once on
> the repo.

### 3b. `v*` tag ruleset (restrict release tags to the owner)

Releases are tag-driven, so tags are privileged. This ruleset restricts who can
create or delete `v*` tags to the repository **Admin** role (the owner) by
listing it as the sole bypass actor while the `creation`/`deletion` rules block
everyone else.

```bash
gh api --method POST repos/danielkremen818/ultracost/rulesets --input - <<'JSON'
{
  "name": "version tags",
  "target": "tag",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "conditions": {
    "ref_name": { "include": ["refs/tags/v*"], "exclude": [] }
  },
  "rules": [
    { "type": "creation" },
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ]
}
JSON
```

> `actor_id: 5` + `actor_type: RepositoryRole` is the built-in **Admin** role.
> On a personal repo the owner always holds Admin, so this effectively means
> "only me." Adjust the id if GitHub changes the role mapping
> (`gh api repos/danielkremen818/ultracost/rulesets/rule-suites` to inspect).

## 4. Repository settings hardening

Run these once after the remote exists (each is idempotent):

```bash
# Dependabot alerts (prerequisite) + automated security updates
gh api --method PUT repos/danielkremen818/ultracost/vulnerability-alerts
gh api --method PUT repos/danielkremen818/ultracost/automated-security-fixes

# Secret scanning + push protection
gh api --method PATCH repos/danielkremen818/ultracost --input - <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
JSON

# GitHub Actions: require approval to run workflows for ALL outside collaborators
gh api --method PUT repos/danielkremen818/ultracost/actions/permissions/fork-pr-contributor-approval --input - <<'JSON'
{ "approval_policy": "all_external_contributors" }
JSON
```

> If a `gh api` endpoint name has drifted, the equivalent toggles live under
> **Settings → Code security** (Dependabot, secret scanning, push protection)
> and **Settings → Actions → General → Fork pull request workflows from outside
> collaborators** in the web UI. Verify against the current GitHub REST docs
> before relying on the exact path.

