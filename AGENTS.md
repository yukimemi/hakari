<!-- kata:agents:base:begin -->
## Shared conventions

This file is the agent-agnostic source of truth (per the
[agents.md](https://agents.md) convention). The matching
`CLAUDE.md` and `GEMINI.md` files are thin shims that point back
here so each tool's auto-load behaviour still finds something.
**Edit AGENTS.md, not the shims.**

### Git workflow

- **No direct push to `main`.** Open a PR.
  - Exception: trivial typo / whitespace / docs wording fixes.
- Branch names: `feat/...`, `fix/...`, `chore/...`.
- **PR titles + bodies in English. Commit messages in English.**
- **Releases are PR-driven, tagging is automatic.** Bump
  `[workspace.package].version` (workspace) or `[package].version`
  (single crate) in a `chore/release-vX.Y.Z` PR. On merge to `main`,
  `.github/workflows/auto-tag.yml` (kata-managed) detects the bump,
  pushes the `vX.Y.Z` tag, and that tag fires `release.yml` for
  binary builds + crates.io publish. **Do not run `git tag` by
  hand** — the bot tag will collide and the manual push fails.

### PR review cycle

- Every PR runs reviews from **Claude Code**
  (`.github/workflows/claude-review.yml`, kata-managed) and
  **CodeRabbit**. Wait for both bots to post, address their
  comments (push fixes to the PR branch), and merge only after
  feedback is resolved. The claude-review workflow skips
  review-exempt PRs by itself (its job-level `if:` excludes
  `chore/release-*`, `kata-apply/auto`, `apm-bump/auto`, and
  Renovate / Dependabot authors) — a missing Claude review on
  those PRs is expected, not a failure.
- **Any PR that touches the Claude workflow files goes
  unreviewed.** `claude-code-action` requires the workflow file to
  already exist on the default branch **with identical content** —
  otherwise a PR could rewrite the workflow to exfiltrate the
  token. When the content differs it logs "Skipping action due to
  workflow validation" and exits 0 without reviewing: a green
  check with no review attached. This covers two cases, and the
  second is the one that keeps surprising people:
  - the PR that first adopts these templates (the workflow does
    not exist on the default branch yet), and
  - any later PR that **edits** `claude-review.yml` / `claude.yml`,
    e.g. hand-pulling an upstream template fix.

  Not fixable from this side — it is the mechanism that makes the
  token safe to hand to the action at all. Expected: merge on CI +
  owner approval; reviews resume on the next PR that leaves the
  workflows alone. The `kata-apply/auto` branch is already excluded
  by the job-level `if:`, so the daily template-refresh PRs do not
  add noise here.
- **A missing credential fails loudly instead.** If the repo has
  neither `CLAUDE_CODE_OAUTH_TOKEN` nor `ANTHROPIC_API_KEY` set,
  the guard step fails the job — set one and re-run (subscription
  path: `claude setup-token` → `gh secret set`; pay-as-you-go:
  store `ANTHROPIC_API_KEY` and swap the action input to
  `anthropic_api_key`). Distinguishing the two: **red** means no
  credential, **green with no review** means workflow validation.
- **The Claude full review fires once, at PR open** (plus
  `ready_for_review` / `reopened`) — fix pushes do **not** re-trigger
  it (`synchronize` is deliberately off the trigger list; a full
  re-review per push doubled up with the mention-driven re-check
  below and burned tokens for no extra signal). Verification of
  fixes rides the `@claude` thread replies. After a large rework
  that changes the PR's shape, request a fresh full pass
  explicitly: `@claude please re-review the full PR`. CodeRabbit
  still reviews pushes on its own cadence (its app config, not
  this workflow).
- **After opening a PR, immediately enter the review-monitoring
  loop — do not ask the user whether to start it.** Drive the
  cadence with `/loop` — fixed-interval mode (e.g.
  `/loop 60s …`) schedules ticks via `CronCreate`; dynamic mode
  (no interval, `/loop …`) self-paces via `ScheduleWakeup`. The
  agent actively pulls fresh state each tick with
  `gh pr view <N> --json state,reviews,comments,statusCheckRollup`
  and `gh api repos/<owner>/<repo>/pulls/<N>/comments` (the
  latter covers inline review comments, which `gh pr view`
  does not surface) and reacts to new bot feedback. Passive
  watchers (background `gh` polls, file watchers, hooks) cannot
  trigger active follow-up, so they are not a substitute —
  without an active wake-up the agent never re-reads the PR.
- **Default polling interval: 60s.** Claude Code review /
  CodeRabbit typically reply within ~1–5 minutes of a push or
  thread reply, so a 60s tick catches them on the next wake-up
  without burning cache: 60s sits well inside the 5-minute
  prompt-cache TTL, so the conversation context stays cached
  across ticks. Do **not** stretch the interval to 300s — that
  is the worst-of-both window (you pay the cache miss without
  amortizing it). If the PR is idle but a bot re-review is still
  expected (e.g. a CodeRabbit rate-limit refill window), step
  **up** to 1200–1800s instead.
- **Stop the loop entirely when only owner approval is missing.**
  Once review bots are quiet (or quiet-by-exception — version-bump
  skip, Renovate/Dependabot skip), CI is green, and there is no
  other expected follow-up, the *only* remaining action is human
  approval. GitHub already notifies the owner; the agent
  re-entering on every cron tick to find the same "still waiting
  on owner" state burns cache and adds no value. Stop scheduling
  further wake-ups (`CronDelete` in fixed-interval mode; simply
  omit the next `ScheduleWakeup` in dynamic mode) and report the
  wait state to the user. The owner restarts the loop after their
  next push if a fresh bot pass is wanted, or merges directly.
  (A CodeRabbit rate-limit window doesn't qualify on its own — a
  re-review is still expected once the quota refills, so step up
  to 1200–1800s instead and let it ride. Stopping is only correct
  when the owner has explicitly chosen to skip the bot pass per
  the rate-limit exception below.)
- **Reply to reviewers after pushing a fix — in each thread, not
  at the top level.** Every finding lives in its own inline review
  thread; answer *each* one as an in-thread reply, carrying an
  **@-mention** (`@claude` / `@coderabbitai`). Use the review-
  comment *replies* endpoint — `gh api repos/<owner>/<repo>/pulls/<N>/comments/<comment_id>/replies -f body=…`
  (or `-F in_reply_to=<comment_id> -f body=…` on the comments
  endpoint — `body` is required there too) — and
  get each comment's `<comment_id>` from
  `gh api repos/<owner>/<repo>/pulls/<N>/comments`. A single
  top-level `gh pr comment` does **not** count: it leaves every
  inline thread unresolved, the bot can't tie your response to the
  finding it raised, and the per-finding audit trail is lost.
  Reply in-thread even when you're **declining** a suggestion —
  say why; a silent skip reads as overlooked. Note `@claude` also
  triggers the interactive responder
  (`.github/workflows/claude.yml`, kata-managed) — it will
  re-check the fix and reply on the thread. Since fix pushes no
  longer re-trigger the full review, this mention-driven re-check
  is the **only** Claude-side verification of a fix — don't skip
  it for substantive fixes; do skip it for pure FYI notes that
  need no verification.
- A review thread is **settled** the moment the latest bot reply
  is ack-only ("Thank you" / "Understood" / a re-review summary
  with no new findings) or 30 minutes elapse with no actionable
  comment.
- **Merge gate**: review bots quiet AND owner explicit approval.
- Bot-authored PRs (Renovate / Dependabot) skip the bot-review
  gate; CI green + owner approval is enough.
- **Version-bump-only PRs** (a single `chore/release-vX.Y.Z`
  branch whose entire diff is `[workspace.package].version` /
  `[package].version` + the matching inter-crate refs +
  `Cargo.lock`) **also skip the bot-review gate.** There is
  nothing for the bots to find in a version bump, and the
  release pipeline downstream of merge (auto-tag → release.yml)
  is time-sensitive. CI green + owner approval is enough.
- **Treat CodeRabbit rate-limit notices as "quiet" for the
  merge gate.** If CodeRabbit only posts a "Review limit
  reached" quota-exhaustion message (no findings, no inline
  comments), it has produced no review content — there is
  nothing to address. Re-trigger with `@coderabbitai review`
  once the quota refills if you want a real pass; for small or
  time-sensitive PRs, merge on owner approval without waiting.

### Worktree workflow

> **Before your FIRST edit to any file, run `renri add` — NEVER edit the
> main checkout.** Read-only inspection (Read / Grep / Glob) stays on the
> main checkout; the instant you intend to *change* a file, you must
> already be in a worktree. The trap that keeps catching agents: diving
> into a fix the moment the diagnosis lands and editing in place. A
> concurrent agent shares the main checkout — your in-place edits will
> clobber theirs or be clobbered, and in a jj-colocated repo a stray
> working-copy commit entangles unrelated WIP into your branch. If you
> slip and edit in the main checkout, capture the diff first (jj already
> snapshotted it into the working-copy commit, so `jj diff > patch`; for
> git, `git stash` or save a patch — if you got as far as committing on a
> branch, just push it). Then reset the main checkout to pristine main
> (`jj new main@origin`, or `git switch -`), `renri add` a worktree, and
> re-apply the captured diff there.

Use [`renri`](https://github.com/yukimemi/renri) for any
commit-bound change. From the main checkout:

```sh
renri add <branch-name> --from main@origin            # create a worktree (jj-first), off latest upstream main
renri --vcs git add <branch-name> --from origin/main  # force a git worktree, off latest upstream main
renri remove <branch-name> -y --non-interactive  # cleanup after merge (agent-safe; see note)
renri prune                        # GC stale worktrees
```

Read-only inspection can stay on the main checkout.

**Always pass `--from <upstream main>`** (`main@origin` for jj,
`origin/main` for git). Without it, `renri add` forks off the *cwd
worktree's current HEAD* — in a long-lived main checkout that often
lags upstream, so the PR later shows up CONFLICTING against a `main`
that had already moved (e.g. a refactor merged upstream before the
branch was cut), forcing a manual re-port of the whole change.
`renri add` does fetch first, but fetching only updates `main@origin`
— it never moves the checkout's HEAD, so an explicit `--from` is what
guarantees a fresh base.

**Agents / non-interactive shells:** `renri remove` prints a details
panel and waits for a confirmation prompt — without `-y` it **hangs**,
and `--non-interactive` *alone* errors asking for `-y`. Always pass
`-y`, and add `--non-interactive` so a mistyped/omitted name fails
instead of opening a fuzzy picker (the same picker-fallback applies to
`remove` / `cd` / `exec` with no name). Use `-f`/`--force` to remove a
worktree that still has uncommitted changes or conflicts. To sweep
every merged-PR worktree in one shot: `renri remove --merged -y`.

### kata-managed sections

Several files in this repo are managed by `kata apply` from the
[`yukimemi/pj-presets`](https://github.com/yukimemi/pj-presets)
templates — the bytes between `<!-- kata:*:begin -->` and
`<!-- kata:*:end -->` markers, plus the overwrite-always files
listed in `.kata/applied.toml`. **Editing those bytes locally
won't survive the next `kata apply`** — push the change to the
upstream template repo (`yukimemi/pj-base` / `yukimemi/pj-rust` /
…) instead. The marker scopes are layered:

- `kata:agents:base:*` — language-agnostic conventions (this section).
- `kata:agents:rust:*` — added when `pj-rust` applies.
- `kata:agents:rust-cli:*` — added when `pj-rust-cli` applies.
<!-- kata:agents:base:end -->
<!-- kata:agents:pnpm:begin -->
## pnpm / TypeScript layer (kata: pj-pnpm)

This block is owned by `yukimemi/pj-pnpm` and re-applied on every
`kata apply`. Edits go upstream to the template, not to this file.

### Package manager

- **pnpm only.** `pnpm-lock.yaml` is the source of truth.
  `package-lock.json` / `yarn.lock` must not appear.
- `packageManager` in `package.json` pins the major.
- CI uses `pnpm install --frozen-lockfile`. Local dev does not —
  developers add deps with `pnpm add` / `pnpm add -D`.

### Scripts

- `pnpm dev` — start the dev server.
- `pnpm build` — `tsc -b && vite build` (or framework equivalent).
- `pnpm lint` — ESLint on the whole tree.
- `pnpm test` — Vitest run-once. `pnpm test:watch` for the loop.

### TypeScript

- Project-references layout: root `tsconfig.json` references
  `tsconfig.app.json` (browser/runtime code) and
  `tsconfig.node.json` (Vite config and any node-side scripts).
- `noEmit: true` everywhere — `tsc -b` is type-check-only; the
  bundler emits.

### .env / secrets

- Never commit `.env`. `.env.example` is the documented surface.
- Vite-exposed vars must be prefixed `VITE_` to be readable from
  browser code; anything without that prefix is server-only.
<!-- kata:agents:pnpm:end -->
<!-- kata:agents:react-web:begin -->
## Vite + React + Tailwind layer (kata: pj-react-web)

This block is owned by `yukimemi/pj-react-web` and re-applied on
every `kata apply`. Edits go upstream to the template, not to
this file.

### Stack

- **Vite** as the dev server / bundler.
- **React 19** with the `react-jsx` runtime (no `import React`).
- **TypeScript** project-references via the `pj-pnpm` root
  `tsconfig.json` → `tsconfig.app.json` (browser) +
  `tsconfig.node.json` (vite config / scripts).
- **Tailwind v3** + PostCSS + autoprefixer.
- **ESLint flat config** with `@eslint/js` recommended,
  `typescript-eslint` recommended, `eslint-plugin-react-hooks`,
  `eslint-plugin-react-refresh` (vite preset).
- **Vitest** for tests (`pnpm test` / `pnpm test:watch`).

### Dev server reachability

`vite.config.ts` is `when = "once"` (consumer territory — see
`template.toml` for why), so the starter we ship is just a
seed. The seed sets `server.host = true` and allows `.ts.net`,
`.local`, and `localhost` so Tailscale and LAN previews work
out of the box.

**Convention for every PJ on this layer**: keep the Tailscale
allowlist in `server.allowedHosts`. Even if you rewrite
`vite.config.ts` for plugins (VitePWA, Sentry, …), preserve at
minimum:

```ts
server: {
  host: true,
  allowedHosts: [".ts.net", ".local", "localhost"],
},
```

Without it the dev server rejects Tailscale / mDNS hosts with
"Blocked request" and remote previews silently break. There's
no automated guard for this since the file is consumer-owned —
treat it as a checklist item when touching `vite.config.ts`.

### Tailwind

- `tailwind.config.js` is `when = "once"` — per-project theme
  extensions (custom colours, fontFamily, keyframes) survive
  `kata apply`.
- The shared baseline only sets `content` so Tailwind picks up
  `index.html` and `src/**/*.{ts,tsx}`. Add fonts / colours /
  shadows to the project's own copy.

### `src/` skeleton

- `main.tsx`, `App.tsx`, `index.css`, `vite-env.d.ts` are all
  `when = "once"` placeholders — they boot a working "Hello"
  page after init and are otherwise free for the project to
  rewrite.

### Required deps

The framework layer doesn't ship a populated `package.json` (the
`pj-pnpm` layer ships an empty-deps scaffold instead). After
`kata init`, run:

```sh
pnpm add react react-dom
pnpm add -D vite @vitejs/plugin-react typescript \
  @types/react @types/react-dom @types/node \
  tailwindcss postcss autoprefixer \
  eslint typescript-eslint @eslint/js globals \
  eslint-plugin-react-hooks eslint-plugin-react-refresh \
  vitest
```

Pin majors to whatever the `kakeizu` reference project is using
when starting a new repo.
<!-- kata:agents:react-web:end -->
<!-- kata:agents:firebase:begin -->
## Firebase + Vercel layer (kata: pj-firebase)

This block is owned by `yukimemi/pj-firebase` and re-applied on
every `kata apply`. Edits go upstream to the template, not to
this file.

### Hosting

- **Firebase Hosting** is the primary target — `firebase deploy
  --only hosting` from local, or the `Deploy to Firebase
  Hosting` GitHub Actions workflow from `main`.
- **Vercel** runs in parallel as a same-stack mirror so PR
  previews work out of the box. Keep `vercel.json` and
  `firebase.json`'s rewrites/headers in sync — both should
  rewrite `**` → `/index.html` for SPA routing and emit
  `Cross-Origin-Opener-Policy: same-origin-allow-popups`
  (Firebase Auth popup needs this).

### Rules

- `firestore.rules` and `storage.rules` ship a permissive
  signed-in-only baseline. Replace with the project's real
  schema before shipping. Verified-email is required at the
  baseline so Google sign-in's pre-verification flow is the
  default.
- Push rules with `firebase deploy --only firestore:rules,storage`
  (or via a project-side `scripts/deploy-rules.ts` helper —
  kakeizu has one as a reference).

#### Cross-service rules IAM (one-time per project)

If `storage.rules` calls `firestore.get(...)` / `firestore.exists(...)`
to gate Storage on Firestore data, the Firebase Storage service
agent needs `roles/firebaserules.firestoreServiceAgent`. The
Firebase Console grants this automatically on first Publish of
such a rule, but the REST API / CLI deploy paths (this stack
uses CI + a local `scripts/deploy-rules.ts`) do **not** trigger
the prompt. Without it every cross-service call returns null and
rules silently 403, with no useful logs anywhere.

Grant once per project (after enabling Firebase Storage):

```sh
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:service-<PROJECT_NUMBER>@gcp-sa-firebasestorage.iam.gserviceaccount.com" \
  --role="roles/firebaserules.firestoreServiceAgent"
```

Then re-deploy the storage ruleset (IAM doesn't apply
retroactively to a live ruleset; you need a fresh release).
Allow ~1–2 min for IAM propagation before testing.

### Env wiring

- `.env.example` documents the `VITE_FIREBASE_*` surface. Copy
  to `.env`, fill in from the Firebase console.
- The deploy workflow rewrites `.env` from secrets at build time
  (Vite inlines envs at compile time, so the build container
  needs them, not the runtime).
- Required GitHub secrets:
  - `FIREBASE_SERVICE_ACCOUNT` — JSON for a service account
    with the `Firebase Hosting Admin` role.
  - `VITE_FIREBASE_*` — one secret per `.env.example` entry.

### projectId

`firebase.json` is Tera-rendered with `{{ project.name }}` for
the hosting `site` field, but the **Firebase project ID** is a
separate thing (often a different string with a random suffix).
Replace `REPLACE_ME_FIREBASE_PROJECT_ID` in
`.github/workflows/deploy.yml` with the actual project ID before
the first deploy.

### Authorized domains

Firebase Auth's authorized-domains list is what makes
`localhost`, `*.ts.net` (Tailscale), and `*.local` (mDNS)
work for sign-in popups. Update via the Identity Toolkit REST
API (`X-Goog-User-Project: <project-id>` header required) — the
UI doesn't expose Tailscale-style hosts cleanly. See the
`reference_firebase_authorized_domains_via_gcloud` memory for
the exact PATCH call.
<!-- kata:agents:firebase:end -->
