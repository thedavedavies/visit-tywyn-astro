---
name: commit
description: Git commit, push and pipeline workflow for this repo, following its Conventional Commits convention. Use this skill whenever the user asks to commit changes, make a commit, save to git, or invokes "/commit", and equally whenever they ask to push, watch or check the pipeline or CI, sync with the remote, or deal with the remote being ahead. Also trigger for "commit this", "commit what we have", "save this work", "done, commit it", "push this", "is CI green", "is the pipeline green", or any request to create a git commit or push to GitHub. Also trigger for "open a PR", "raise a PR", "merge this", "start a branch", or "branch off main". This skill handles the full workflow (branching, staging, message drafting, committing, syncing past the data cron, pushing, opening the PR, watching the pipeline, merging), so always use it instead of ad-hoc git commands.
---

# Git Commit

Single-developer repo, but `main` is protected and never worked on directly: every
change starts as a feature branch off `main` and lands through a pull request. The
remote is GitHub (`thedavedavies/visit-tywyn-astro`, driven with `gh`), and
Cloudflare Pages rebuilds the site on every push to `main`.

**Nothing broken reaches `main`.** A GitHub ruleset blocks direct pushes to `main`
and holds a PR closed until `test`, `a11y` and `Socket Security: Project Report` are
green. A red pipeline is fixed on the feature branch, where it is still cheap and
affects nothing that is deployed. `main` stays deployable by construction, so there
is never a reason to edit it.

The one exception is the `refresh-conditions` cron. GitHub will not accept
`github-actions[bot]` as a bypass actor on a personal repo, so the cron checks out
with a write **deploy key** (`CRON_DEPLOY_KEY`) and the ruleset bypasses deploy
keys. Its pushes report `Bypassed rule violations for refs/heads/main`, which is
success, not a warning. Never revert that checkout step to the default token: the
push would start failing every 3 hours and the snapshots would quietly go stale.

**Expect `origin/main` to be ahead.** A scheduled workflow (`refresh-conditions.yml`)
commits weather and tides snapshots to `main` roughly every 3 hours, so being dozens
of commits behind after a few days is the repo's normal heartbeat, not a problem.
Since Dave is the only developer, everything on the remote is either that cron,
dependency/security work, or something another Claude session pushed. Anything that
doesn't match those is worth stopping over.

## Commit message format

```
type(scope): lowercase description
```

The scope is optional but common. Keep the subject under ~75 characters, lowercase,
no trailing period. Subjects here often carry a short comma-separated list of the
change's parts; a body paragraph is added when the motivation or a measured number
tells the story better than the subject can.

**Types and scopes observed in this repo's history:**

| Form        | When to use                                              |
| ----------- | -------------------------------------------------------- |
| feat        | New user-facing feature, page, or content capability     |
| fix         | Bug fix (scoped when it names a subsystem: `fix(icons)`) |
| perf        | Performance work (`perf(images)`, or bare `perf`)        |
| chore(deps) | Dependency bumps and security-advisory fixes             |
| chore(data) | RESERVED for the refresh cron. Never write this by hand  |
| refactor    | Restructuring with no behaviour change                   |

**Examples from this repo:**

```
fix(icons): add apple-touch-icon and brand svg favicon
fix(early-hints): don't hint the lightbox img's neighbouring gallery thumb
perf(images): hero Early Hints, measured sizes/widths, avif q55, 1200x630 og card
perf: fix bold-font CLS, slim favicon, stop shipping full-res image fallbacks
chore(deps): upgrade astro 6 to 7, clearing remaining security advisories
```

## Attribution

No `Co-Authored-By` trailer and no "Generated with Claude Code" footer, in commit
messages and PR descriptions alike. This is a user preference configured at the
environment level.

## Workflow

### 1. Take a feature branch off `main`

Never commit on `main`. Check where you are before the first commit:

```bash
git fetch origin && git switch -c <type>/<short-slug> origin/main
```

Name the branch after the change, mirroring the commit type: `fix/early-hints-preload`,
`chore/deps-astro-7-3`, `feat/aberdyfi-hub`. Branch from `origin/main` rather than
local `main`, so the cron's snapshots are already underneath you.

Uncommitted work already in progress on `main` moves across untouched when you
branch. Work already *committed* to local `main` needs the commits moved to a branch
and `main` reset back to `origin/main` before anything is pushed.

### 2. Understand what changed

Run in parallel:

- `git status` for staged, unstaged, and untracked files
- `git diff` and `git diff --staged` for the actual content
- `git log --oneline -10` to confirm message style against recent history

### 3. Stage by name

Stage files explicitly, never with `git add -A` or `git add .`. Broad staging risks
pulling in secrets, scratch files, or another session's leftovers.

**Never stage:**

- `.env`, `.env.*`, `credentials.json`, `*.pem`, `*.key`, anything secret-shaped
- `src/data/weather.json` and `src/data/tides.json`: the cron owns these. A local
  diff there means `npm run refresh:conditions` ran locally; leave it out (or
  discard it) unless changing the data pipeline itself is the task at hand

### 4. Draft the message

Choose the type (and scope, when the change lives in one subsystem) and write a
description that answers why over what. One rich subject line is the house style;
add a body when a measurement or trade-off earns it.

### 5. Commit

Use a HEREDOC to preserve formatting:

```bash
git commit -m "$(cat <<'EOF'
type(scope): description here
EOF
)"
```

### 6. Sync with the remote

Rebase the branch onto the latest `origin/main` before pushing, so the PR's checks
run against what `main` actually is:

```bash
git fetch origin
git log --format='%s' HEAD..origin/main | grep -vE '^chore\((data|deps)\)'
```

- **Empty output** (all incoming commits are the data cron or deps work): rebase
  with `git rebase origin/main` and continue. No need to ask, even when it's 80
  commits.
- **Any other commit subject**: stop and show the user what's incoming before
  touching it. In a single-dev repo an unexplained commit means another session
  or something unexpected.
- A rebase conflict on `src/data/*.json` is resolved by keeping the remote
  snapshot (it is newer than anything local), then continuing the rebase.

### 7. Push the branch and open a PR

```bash
git push -u origin HEAD
gh pr create --fill
```

Force-pushing a *feature branch* after a rebase or an amend is fine and expected
(`git push --force-with-lease`); nothing downstream depends on an unmerged branch.
That freedom is half the reason the work belongs on a branch.

**Never force-push `main`.** The cron can commit at any moment, and the ruleset
rejects the push anyway.

### 8. Watch the pipeline

Two GitHub Actions run on every pull request, and again on `main` after the merge:

| Workflow      | What it gates                                           | Runs                                    |
| ------------- | ------------------------------------------------------- | --------------------------------------- |
| Test          | `astro check`, full build, link checker                 | every push                              |
| Accessibility | axe-core WCAG A/AA scan over representative built pages | every PR; on `main`, skipped when only `src/data/**` changed |

Two more check runs appear alongside the Actions: **Cloudflare Pages** (completes
when the deploy finishes, and usually lands first since Pages builds independently
of Actions) and **Socket Security: Project Report** (a dependency-security app).
A green Pages check means the deploy is live; still verify at the edge by curling
a changed asset on the live site rather than trusting the check alone.

Poll the pushed commit's check runs until every one is terminal. Run this in the
background so the session stays responsive, and poll no faster than 20s:

```bash
SHA=$(git rev-parse HEAD)
while true; do
  runs=$(gh api "repos/thedavedavies/visit-tywyn-astro/commits/$SHA/check-runs" \
    --jq '[.check_runs[] | {name, status, conclusion}]')
  echo "$runs" | jq -e 'length > 0 and all(.status == "completed")' >/dev/null \
    && { echo "$runs" | jq .; break; }
  sleep 25
done
```

Expect five check runs on a PR: `test`, `a11y`, `Cloudflare Pages`, `Socket
Security: Project Report` and `Socket Security: Pull Request Alerts` (that last one
is PR-only). A push to `main` has four, and `a11y` is absent from data-only pushes.
Of these, **`test`, `a11y` and `Socket Security: Project Report` are required** and
block the merge; `Cloudflare Pages` deliberately is not, so a Pages hiccup cannot
wedge a good PR. Report
**every** conclusion, not just success: `failure`, `cancelled`, `timed_out`, and
`action_required` all need surfacing, and silence looks identical to "still
running". A `skipped` Accessibility run on a data-only push is fine.

### 9. If the pipeline is red

Fix it on the feature branch the PR is built from. Never on `main`. Push a follow-up
commit to the branch, or amend and `--force-with-lease`, then watch again. The
failing job's log comes from `gh run view <run-id> --log-failed`.

The branch absorbs as many attempts as it takes, and `main` never sees any of them.
If something red has somehow already landed on `main`, the fix is still a branch and
a PR: `main` is not a place to edit.

### 10. Merge into `main`

Only once every required check is green:

```bash
gh pr merge --squash --delete-branch
```

Squash keeps the one-rich-commit-per-change history this repo already has; use
`--merge` instead when a PR's individual commits are each worth keeping. The merge
is what deploys, since Cloudflare Pages rebuilds from `main`, so verify at the edge
afterwards by curling a changed asset on the live site.

## Dependabot

There is no `dependabot.yml`; what appears is security alerts (the banner in push
output, the Security tab, or `gh api /repos/thedavedavies/visit-tywyn-astro/dependabot/alerts`)
and the occasional dependabot PR. Handling an alert is ordinary `chore(deps)` work:
bump within semver or upgrade the offending package, run the build, and take it
through a branch and a PR in the style above. Merge a dependabot PR only after its required checks are green.

## What not to do

- Do not commit without the user asking.
- Do not commit or push to `main`. Work goes on a feature branch and lands via PR.
- Do not merge a PR while a required check is red, pending, or failed.
- Do not "fix forward" on `main` when CI is red; fix it on the branch.
- Do not bypass the ruleset, and do not add bypass actors to it. The cron's bypass
  is the only one.
- Do not use `git add -A`, `git add .`, or `-uall`.
- Do not force-push `main`, ever.
- Do not amend a commit that has been pushed.
- Do not hand-edit or hand-commit the weather/tides snapshots, and never write a
  `chore(data)` commit yourself.
- Do not treat "remote is ahead" as a conflict or a reason to ask, when the
  incoming commits are all `chore(data)` or `chore(deps)`.
- Do not use `--no-verify`, and do not create empty commits.
- Do not stop watching a running pipeline without reporting a terminal state.
