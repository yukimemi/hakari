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
- **Releases are PR-driven and tagging is automatic** — in repos that
  ship a release pipeline. Bump the version in the project's own
  manifest in a `chore/release-vX.Y.Z` PR; on merge to `main` the
  language layer's `auto-tag.yml` detects the bump, pushes the
  `vX.Y.Z` tag, and that tag is what fires `release.yml`. **Do not run
  `git tag` by hand** — the bot tag will collide and the manual push
  fails. The specifics belong to the layers shipping those two
  workflows, which are not the same layer: `kata:agents:rust:*` for
  which file holds the version and for `auto-tag.yml`,
  `kata:agents:rust-{cli,lib}:*` for what `release.yml` builds and
  publishes. A repo with no `auto-tag.yml` has no release pipeline at
  all: nothing tags, and the version field in its manifest may well
  be decoration.

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
…) instead.

The marker scopes are layered, one per applied layer:
`kata:agents:base:*` is this section, and each layer adds its own
(`kata:agents:rust:*`, `kata:agents:rust-cli:*`,
`kata:agents:pnpm:*`, `kata:agents:firebase:*`, …). Which ones apply
*here* is a grep away: `<!-- kata:` in this file.

### This project's own conventions

Everything a layer ships is generic by construction: it describes the
stack the template assumed, not what this repo grew into. **Bytes
outside every marker pair are yours and survive `kata apply`** — so
project-specific conventions belong in a section of their own, outside
the markers (conventionally at the end of the file; if a later layer
appends its block below yours, no matter — kata only ever rewrites
between its own markers). Same mechanism as the `.gitignore` /
`.gitattributes` blocks.

Write those conventions down there rather than leaving them in one
agent's head, in commit archaeology, or in a README the agent will not
read. What earns a line:

- **Any layer default that does not hold here.** A layer states its
  assumption flatly ("Hosting is the primary target", "these rules are
  a placeholder to replace"). When the project has diverged, say so and
  say why — the layer's text keeps asserting the opposite on every
  apply, and an agent that only reads the blocks will act on it.
- **Facts duplicated across files with no compiler in between** — an
  address or a path that appears in code *and* in a rules/config file
  that cannot import it, a timeout that has to stay inside another
  timeout. List every copy, so the next edit finds them all.
- **kata-shipped files this project deleted on purpose**, together with
  the `once_applied = true` line in `.kata/applied.toml` that keeps
  them deleted. Otherwise someone helpfully restores one.
- **Shapes the runtime forces but no tool checks** — an export form a
  platform requires, import specifiers that must (or must not) carry a
  file extension, a directory whose contents are reachable by URL.
- **Invariants that money or access rest on**, naming the file and line
  that actually enforces them.
- **Which language the code speaks versus what a user reads**, when the
  two differ.

A repo whose `AGENTS.md` is nothing but kata blocks is a repo where
every agent re-derives all of that from scratch — and gets the layer
defaults wrong the same way each time.
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

### Deploy target: pick one, then write the choice down

This layer ships both halves — `firebase.json` for Firebase
Hosting, `vercel.json` for Vercel — because which one a project
ends up on depends on something the template cannot see: whether
the app is static.

- **Static front end, Firebase for data.** Firebase Hosting is
  the target (`firebase deploy --only hosting` locally, or the
  `Deploy to Firebase Hosting` workflow from `main`), and Vercel
  runs in parallel as a same-stack mirror so PR previews work out
  of the box. Keep `vercel.json` and `firebase.json`'s
  rewrites/headers in sync — both should rewrite `**` →
  `/index.html` for SPA routing and emit
  `Cross-Origin-Opener-Policy: same-origin-allow-popups`
  (Firebase Auth popup needs this).
- **Any server-side code — an `api/` directory of Vercel
  Functions, Next.js route handlers, an LLM call whose key must
  not reach the browser — makes Vercel the only target that runs
  the whole app.** Hosting serves static files; it cannot execute
  a function, so a Hosting deploy publishes a UI whose every
  server route fails. That is a fork in the road, not a
  preference: once such a route exists the Hosting path is dead.

On the Vercel-only path, make the choice stick rather than leave
two half-live pipelines:

- Delete `.github/workflows/deploy.yml`; the
  `once_applied = true` entry it leaves in `.kata/applied.toml`
  is what stops the next `kata apply` re-creating it.
- Keep `firebase.json` / `.firebaserc` anyway — rules deploys
  still need them (`firebase deploy --only
  firestore:rules,storage`), Hosting config or not.
- Put the env in the Vercel project (`vercel env ls`). The
  GitHub secrets listed below feed the Hosting workflow only.
- Record it in the project's own section, below the last
  `kata:*:end`. This block goes on offering Hosting as an option
  on every apply; the project section is where the answer lives.

### Server routes on Vercel

Only relevant on the Vercel path. The first two fail in ways that
do not resemble their cause:

- **Match the export form to what the runtime does with it.** The
  Node runtime accepts three shapes, and one is a trap in a
  codebase built on Web `Response`: a bare
  `export default function handler(req, res)` is the *legacy Node
  handler*, whose return value is discarded — build a `Response`
  inside it and the client receives nothing. The Web-standard
  shapes are named method exports (`export const POST = …`,
  `export function GET(request)`) and a default export of an
  object carrying a `fetch` method
  (`export default { fetch(request) { … } }`). Prefer the method
  exports: one file, one route, one verb per export.
- **Under `"type": "module"`, relative specifiers in function code
  carry `.js`** — `./_lib/http.js`, `../../shared/foo.js`, even
  though the file on disk is `.ts`. That is the shape this stack
  produces: the pnpm layer's `package.json` is ESM, and standalone
  `api/*.ts` functions are transpiled per file rather than
  bundled, so Node's ESM loader resolves the specifier verbatim
  and refuses an extensionless one
  (production-only `ERR_MODULE_NOT_FOUND`). Browser code under
  `src/` stays extensionless because Vite bundles it, so one repo
  runs both conventions. Framework route handlers that go through
  a real bundler (Next.js) are exempt — check which side a route
  is on before copying either rule.
- A dev-time Vite plugin that mounts `api/` on the dev server is
  worth its ~100 lines: `pnpm dev` becomes the whole app and the
  Vercel CLI leaves the local loop. Note that it also masks both
  mistakes above, since Vite bundles and invokes the handler
  directly.
- **`vercel.json` is co-owned, and the SPA rewrite is the half
  that bites.** kata syncs `$schema`, `buildCommand`,
  `outputDirectory`, `framework`, `rewrites` and `headers`
  (`merge-json`, so only those keys). The shipped rewrite
  excludes the whole `/api` boundary —
  `/((?!api(?:/|$)).*)` — because a catch-all answers every
  function route with `index.html`: a green deploy whose whole
  API is gone. `regions`, `functions` (a
  `maxDuration` raised for slow LLM calls, say) and anything
  else the project adds are the project's, and survive applies.

### Rules

- `firestore.rules` and `storage.rules` ship a permissive
  signed-in-only baseline. Replace with the project's real
  schema before shipping. Verified-email is required at the
  baseline so Google sign-in's pre-verification flow is the
  default.
- Both files are `when = "once"`, so kata never writes them
  again. Once replaced they **are** the app's access control:
  read a diff against them as a security change, and never
  "restore the baseline" on the strength of the paragraph above
  still describing one.
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
- The Hosting deploy workflow rewrites `.env` from secrets at
  build time (Vite inlines envs at compile time, so the build
  container needs them, not the runtime).
- GitHub secrets required **on the Hosting path**:
  - `FIREBASE_SERVICE_ACCOUNT` — JSON for a service account
    with the `Firebase Hosting Admin` role.
  - `VITE_FIREBASE_*` — one secret per `.env.example` entry.
- On the Vercel-only path neither is needed: the same names go in
  the Vercel project's environment variables, and server-side
  keys stay **un-prefixed** so they never reach the bundle.
  `VITE_FIREBASE_*` are public by design — the rules are the
  protection, not the obscurity of those values.

The `projectId` note below points at `deploy.yml`; on the
Vercel-only path that file is gone and the project id lives in
`.firebaserc` plus whatever the app reads at runtime.

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

## hakari specifics

Everything above is kata-managed: `kata apply` rewrites the bytes
between the markers, so repo knowledge belongs **here**, below the last
`kata:*:end`, where it survives. Setup instructions live in `README.md`
(Japanese); this section is what an agent needs before editing.

### What this is

A diet-tracking SPA. Photograph a meal and it is logged with kcal/PFC;
photograph yourself and the silhouette is measured into a 3D body that
morphs toward the goal weight; a VRM trainer demonstrates the generated
workout. Vite + React 19 + TS + Tailwind under `src/`, Firebase
(Auth / Firestore / Storage) for identity and data, `api/` for every LLM
call across five providers — the provider keys never reach the browser.

### Deployment is Vercel, not Firebase Hosting

The "Firebase Hosting is the primary target" line in the pj-firebase
block above does **not** hold here. `api/*` are Vercel Functions and
Hosting cannot run them, so a Hosting deploy would serve a UI whose AI
features all fail. Production is <https://hakari-two.vercel.app>
(region `hnd1`), deployed by the Vercel GitHub integration: opening a PR
builds a preview URL, and merging it to `main` promotes to prod. Nothing
is deployed by pushing to `main` directly — that is not a route anyone
takes here (see the git workflow above).

- `.github/workflows/deploy.yml` was deleted on purpose;
  `[files.".github/workflows/deploy.yml"] once_applied = true` in
  `.kata/applied.toml` is what stops `kata apply` re-creating it. Do not
  re-add a Hosting deploy.
- `firebase.json` / `.firebaserc` stay only so
  `pnpm exec firebase deploy --only firestore:rules,storage` works.
- `firestore.rules` / `storage.rules` are no longer the permissive
  signed-in-only baseline the template describes — they are the real
  invite gate (below). Never "replace with the project's schema".

### Invariants that span files

Rules files cannot import TypeScript, so a few facts are duplicated by
hand. Grep before touching any of them.

| Fact | Copies that must agree |
| --- | --- |
| Owner address | `shared/access.ts` `OWNER_EMAIL`, `firestore.rules` `owner()`, `storage.rules` `owner()` |
| Invite list path `config/access` | `shared/access.ts` `ACCESS_DOC`, both rules files |
| Provider timeout inside function timeout | `PROVIDER_TIMEOUT_MS` (default 280 s, `api/_lib/providers.ts`) must stay under `vercel.json` → `functions."api/*.ts".maxDuration` (300 s) |

The daily AI cap is enforced by the **rules**, not by the server: routes
increment `users/{uid}/usage/{yyyy-MM-dd}.calls` with the *caller's own*
token, so a browser can reach the same document. What makes it a limit is
`match /usage/{date}` — `calls == 1` on create, `calls + 1` on update, no
delete — together with the `collection != 'usage'` guard in the generic
`match /{collection}/{document}` block. Firestore rules are OR-ed: drop
that guard and the generic write rule silently restores unlimited writes
to the counter, i.e. an uncapped spend. The day boundary is Asia/Tokyo
(`api/_lib/usage.ts`) because the functions run in UTC.

### `api/` conventions

- **Every route is a named method export.** A bare
  `export default function handler(req, res)` is the legacy Node handler
  and its return value is discarded, so a `Response` built inside it
  reaches nobody. (`export default { fetch(request) { … } }` is a
  supported Web-standard shape, just not the one used here.) Write
  `export const POST = route(async (request) => …)` (`GET` likewise).
- **Relative imports carry `.js`** — `./_lib/http.js`,
  `../../shared/access.js`. These files are not bundled; Node ESM
  resolves the specifier at runtime. Code under `src/` imports
  extensionless because Vite bundles it. Both forms type-check against
  the `.ts` source.
- **Routes are flat.** `vercel.json` matches `api/*.ts` and the dev shim
  refuses any name outside `/^[a-z0-9-]+$/i`, so no subdirectories —
  `api/_lib/` is unroutable, which is why shared server code lives there.
- **Every handler is wrapped in `route(...)`**, in this order: auth
  (`requireUser`, or `ownerOnly` in `api/clip.ts`), `consumeCall`,
  `readJson` with a zod schema, then the provider call. Throw
  `AuthError` / `UsageError` / `ProviderError` / `BadRequest` and let
  `route()` map the status; anything unrecognised becomes a generic 500
  so provider internals are not echoed back.
- Provider fan-out lives in exactly one place: `api/_lib/providers.ts`
  `complete()`. Feature code never hardcodes a model id — `api/models.ts`
  proxies each provider's live catalogue and the settings screen picks
  from it. Task → provider mapping is `shared/providers.ts`.
- Keep the `/// <reference types="node" />` at the top of
  `api/_lib/auth.ts`: Vercel type-checks functions with its own tsconfig
  and loses `process` without it.
- ID-token verification is `jose` against Google's JWKS, deliberately not
  `firebase-admin` — that would mean a service-account key in the Vercel
  env just to check a signature.

### `pnpm dev` is the whole app

`vite-plugin-api.ts` mounts the same `api/` handlers on Vite's dev
server, so `/api/*` works locally with no Vercel CLI and edits to `api/`
hot-reload. A route that works in dev but 404s or returns nothing in
production is almost always one of the two rules above (default export,
missing `.js`).

### Type-check layout

`pnpm build` runs `tsc -b`, which builds both projects:
`tsconfig.app.json` (`src` + `shared`, DOM lib) and `tsconfig.node.json`
(`vite.config.ts`, `vite-plugin-api.ts`, `api`, `shared`, node types).
`shared/` sits in both, so it must stay free of DOM-only *and* Node-only
APIs — no `window`, no `process`.

### What kata does not own here

Three files carry settings this project needs and no template can
guess. They were lost once — auto-apply PR #14 (merged 01:50Z,
2026-08-23) reverted all three, and for 25 minutes production served
`index.html` for every `/api/*` request:

| File | This project's part |
| --- | --- |
| `tsconfig.app.json` | `include: ["src", "shared"]` |
| `tsconfig.node.json` | `include: ["vite.config.ts", "vite-plugin-api.ts", "api", "shared"]` — without it the entire server half goes unchecked |
| `vercel.json` | `regions` and `functions."api/*.ts".maxDuration` (300 s; `PROVIDER_TIMEOUT_MS` lives inside it) |

Both template layers were fixed upstream afterwards — the tsconfigs are
`when = "once"` in `pj-react-web` and `vercel.json` is `merge-json` in
`pj-firebase`, scoped to `$schema` / `buildCommand` / `outputDirectory` /
`framework` / `rewrites` / `headers`. So kata leaves the rows above
alone now. Restore them, don't relitigate them, if a future apply ever
touches them again.

### Tests

`pnpm test` is `vitest run`; specs sit next to the module they cover
(`shared/calc.test.ts`, `src/avatar/bodyShape.test.ts`,
`src/data/sanitise.test.ts`, `src/lib/subview.test.tsx`, …). There is no
`test` block in `vite.config.ts`, so a spec that needs a DOM opts in with
a `// @vitest-environment jsdom` docblock on line 1. What is covered is
the arithmetic (`shared/calc.ts`), the body-shape/motion maths
(`src/avatar/`) and the sanitisers; LLM calls and Firestore are not
mocked, they are simply not unit-tested.

### Avatar

- Keyframes in `src/avatar/procedural.ts` are written in **VRM 0.x
  space** (front `−Z`, character's left `−X`). `src/avatar/mannequin.ts`
  is built in the same space and takes the same `VRMUtils.rotateVRM0`
  half-turn to face the camera. A VRM 1.0 model faces `+Z`, so it can
  come out mirrored.
- `AvatarStage` writes only `rotation.x` per frame. Writing all three
  axes overwrites that half-turn and the trainer turns its back.
- Body shape scales bone X/Z only, with an inverse scale on children, so
  height and limb length never change.
- The VRM (Alicia Solid, ~7.9 MB) is **not committed** — shipping someone
  else's model in a public repo is redistribution. `pnpm run avatar`
  fetches it; without it the capsule mannequin is the fallback, so the
  app still runs.

### Veo clips (`api/clip.ts`)

Owner-only, on a separate key (`VEO_API_KEY`, falling back to
`GEMINI_API_KEY`) and a separate counter (`DAILY_CLIP_LIMIT`, default 10)
so a runaway text loop cannot spend video money. The API is fussy where
its docs are wrong: `durationSeconds` must be a **number**, and
`numberOfVideos` / `generateAudio` are rejected by this model. Audio is
always generated and its safety filter is what actually fails requests —
keep prompts short and plain. Google's video URLs expire after two days,
so adopting a clip copies it into Storage `clips/` and records the choice
in `config/clips`; that bucket needs a CORS config or `<video>` hangs at
`readyState 0`.

### Language

Comments, commit messages, PR titles and bodies: English. Anything a user
reads — UI copy, the error strings in `readJson` / `route`, `README.md` —
Japanese.

### Secrets

Provider keys are server-side only; never give one a `VITE_` prefix, that
inlines it into the bundle. A value already exported in the shell wins
over `.env`, which is how this repo's owner runs it. `VITE_FIREBASE_*`
are public by design — `firestore.rules` / `storage.rules` are the
protection, not the secrecy of those values.
