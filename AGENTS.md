# Engineering and release rules

These rules apply to every coding agent and human contributor. Direct user
instructions take precedence when they explicitly authorise a narrower or
different action.

## Branches and working trees

- `main` is production-only. Do not develop, commit, or push directly to it.
- `staging` is the future release-candidate branch. Do not use it for feature
  development or deploy configuration changes.
- Start new work from the current target branch in a named branch:
  `codex/<task>` for Codex work or `feature/<task>` for manual work.
- Inspect `git status --short --branch` before editing. Preserve existing
  tracked and untracked work that is outside the assigned task.
- Never reset, clean, rebase, force-push, delete a branch/worktree, or overwrite
  another contributor's changes without the owner's explicit approval.

## Implementation and verification

- For non-trivial work, state a short plan, affected paths, acceptance criteria,
  and risk before editing.
- Keep a change narrow and test it with the production-supported Node version.
- Before requesting review, run:

  ```sh
  npm test
  npm run verify
  git diff --check
  ```

- Add or update focused tests whenever behaviour changes. For camera changes,
  complete the applicable manual iPhone checklist in `docs/camera.md`.
- Do not weaken tests, skip checks, or change a production guardrail merely to
  make a task pass without owner approval and a documented rationale.

## Pull requests and releases

- Feature work flows `feature/*` or `codex/*` → PR → `staging`.
- A production candidate flows `staging` → PR → `main` only after the exact
  commit has a green `Quality gate` and has passed the relevant staging
  smoke-test. The owner makes the final production release decision.
- A PR description must state: intended change, tests run, manual/staging
  verification, rollout risk, and rollback path.
- Do not push, create or merge a PR, change GitHub branch protection, deploy,
  apply a migration, change Railway variables, rotate credentials, or alter
  payment configuration unless the user explicitly authorises that action in
  the current task.
- Do not merge an unrelated change to make a release convenient. Keep the
  release candidate frozen while it is being verified.

## Production, data, and secrets

- Never put secrets in source, git history, browser variables, logs, tests, or
  review output. Server secrets must not use `NEXT_PUBLIC_`.
- Never point local development or staging at production PostgreSQL, Redis,
  Stripe live credentials, production webhooks, or production alert channels.
- Database migrations must be additive and backward-compatible. Verify on
  staging first; during an incident roll back application code before considering
  any database action.
- Preserve the privacy boundary: do not log or persist raw camera frames,
  base64, OCR text, Gemini prompts/outputs, product identity, GTINs, emails,
  payment data, tokens, IPs, or query values unless an existing, reviewed
  policy explicitly permits a minimum necessary aggregate.

## Reporting and escalation

- Report what changed, what was verified, what was not verified, and any
  remaining risk. Do not claim staging or production verification that did not
  occur.
- Stop and ask the owner before an action that would spend money, expose data,
  contact users, change production state, or requires a product decision.
- For a production regression, preserve evidence, identify the last healthy
  Railway deployment, and ask for/execute the approved application rollback.
  Do not perform destructive database rollback during an incident.

See `docs/release-workflow.md` for the operational release checklist and
`docs/operations.md` for service-specific production controls.
