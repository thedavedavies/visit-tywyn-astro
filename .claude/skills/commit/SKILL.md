---
name: commit
description: Git commit, push and pipeline workflow for this repo, following its Conventional Commits convention. Use this skill whenever the user asks to commit changes, make a commit, save to git, or invokes "/commit", and equally whenever they ask to push, watch or check the pipeline or CI, sync with the remote, or deal with the remote being ahead. Also trigger for "commit this", "commit what we have", "save this work", "done, commit it", "push this", "is CI green", "is the pipeline green", or any request to create a git commit or push to GitHub. This skill handles the full workflow (staging, message drafting, committing, syncing past the data cron, pushing, watching the pipeline), so always use it instead of ad-hoc git commands.
---

# Git Commit

Single-developer repo. `main` is the working branch: routine work commits straight to
it, no PR ceremony. The remote is GitHub (`thedavedavies/visit-tywyn-astro`, driven
with `gh`), and Cloudflare Pages rebuilds the site on every push to `main`.

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

### 1. Understand what changed

Run in parallel:

- `git status` for staged, unstaged, and untracked files
- `git diff` and `git diff --staged` for the actual content
- `git log --oneline -10` to confirm message style against recent history

### 2. Stage by name

Stage files explicitly, never with `git add -A` or `git add .`. Broad staging risks
pulling in secrets, scratch files, or another session's leftovers.

**Never stage:**

- `.env`, `.env.*`, `credentials.json`, `*.pem`, `*.key`, anything secret-shaped
- `src/data/weather.json` and `src/data/tides.json`: the cron owns these. A local
  diff there means `npm run refresh:conditions` ran locally; leave it out (or
  discard it) unless changing the data pipeline itself is the task at hand

### 3. Draft the message

Choose the type (and scope, when the change lives in one subsystem) and write a
description that answers why over what. One rich subject line is the house style;
add a body when a measurement or trade-off earns it.

### 4. Commit

Use a HEREDOC to preserve formatting:

```bash
git commit -m "$(cat <<'EOF'
type(scope): description here
EOF
)"
```

### 5. Sync with the remote

Always fetch before pushing, and expect to be behind:

```bash
git fetch origin
git log --format='%s' main..origin/main | grep -vE '^chore\((data|deps)\)'
```

- **Empty output** (all incoming commits are the data cron or deps work): rebase
  with `git pull --rebase origin main` and continue. No need to ask, even when
  it's 80 commits.
- **Any other commit subject**: stop and show the user what's incoming before
  touching it. In a single-dev repo an unexplained commit means another session
  or something unexpected.
- A rebase conflict on `src/data/*.json` is resolved by keeping the remote
  snapshot (it is newer than anything local), then continuing the rebase.

### 6. Push

Plain `git push`. If it's rejected because the cron advanced `main` again in the
meantime, repeat step 5 and push again.

**Never force-push `main`.** The cron can commit at any moment; a force-push
erases its snapshots and rewrites the only branch there is.

### 7. Watch the pipeline

Two GitHub Actions run on push to `main`:

| Workflow      | What it gates                                           | Runs                                    |
| ------------- | ------------------------------------------------------- | --------------------------------------- |
| Test          | `astro check`, full build, link checker                 | every push                              |
| Accessibility | axe-core WCAG A/AA scan over representative built pages | skipped when only `src/data/**` changed |

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

Expect four check runs for a normal commit (`test`, `a11y`, `Cloudflare Pages`,
`Socket Security: Project Report`); `a11y` is absent from data-only pushes. Report
**every** conclusion, not just success: `failure`, `cancelled`, `timed_out`, and
`action_required` all need surfacing, and silence looks identical to "still
running". A `skipped` Accessibility run on a data-only push is fine.

### 8. If the pipeline is red

Fix the cause on `main` with a **new** commit (never amend a pushed commit), push,
and watch again. The failing job's log comes from
`gh run view <run-id> --log-failed`.

## Dependabot

There is no `dependabot.yml`; what appears is security alerts (the banner in push
output, the Security tab, or `gh api /repos/thedavedavies/visit-tywyn-astro/dependabot/alerts`)
and the occasional dependabot PR. Handling an alert is ordinary `chore(deps)` work:
bump within semver or upgrade the offending package, run the build, commit in the
style above. Merge a dependabot PR only after its Test check is green.

## What not to do

- Do not commit without the user asking.
- Do not use `git add -A`, `git add .`, or `-uall`.
- Do not force-push `main`, ever.
- Do not amend a commit that has been pushed.
- Do not hand-edit or hand-commit the weather/tides snapshots, and never write a
  `chore(data)` commit yourself.
- Do not treat "remote is ahead" as a conflict or a reason to ask, when the
  incoming commits are all `chore(data)` or `chore(deps)`.
- Do not use `--no-verify`, and do not create empty commits.
- Do not stop watching a running pipeline without reporting a terminal state.
