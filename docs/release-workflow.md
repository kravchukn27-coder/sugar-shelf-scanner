# Release workflow

This runbook defines how a code change becomes a production release. It
complements the service-specific deploy and safety controls in
[operations.md](operations.md); it does not replace them.

## Branch model

```text
codex/* or feature/* → PR → staging → staging verification
                                      ↓
                                PR → main → Railway production
```

- `main` is production-only and deploys to Railway.
- `staging` is a release-candidate branch. Its isolated Railway environment is
  introduced separately; before then it must not be treated as a production
  substitute.
- A feature branch contains one bounded change. Do not mix unrelated fixes,
  experiments, migrations, or data imports into a release candidate.

## Feature-to-staging checklist

Before opening or merging a PR to `staging`:

- [ ] The branch was created from the current intended target.
- [ ] The PR scope is narrow and names all user-visible or operational effects.
- [ ] `npm test`, `npm run verify`, and `git diff --check` pass on the branch.
- [ ] New behaviour has focused automated tests.
- [ ] The PR says what remains unverified locally.
- [ ] The GitHub `Quality gate` is green for the exact merge candidate.

## Staging verification

When the staging environment exists, verify the deployed commit rather than an
earlier local build:

- [ ] Railway staging deployment succeeded and `/api/health` is healthy.
- [ ] The changed user path completes successfully.
- [ ] Camera changes follow the iPhone path in [camera.md](camera.md).
- [ ] Payment changes use test Stripe credentials only.
- [ ] Data and migration changes use staging Postgres/Redis only and preserve
  compatibility with the prior app version.
- [ ] Logs and telemetry contain no prohibited private content.
- [ ] Any new failure mode, alert, cost effect, or manual check is recorded in
  the release PR.

Freeze `staging` while a production candidate is being checked. A new feature
must wait or be released in the next candidate.

## Production release checklist

Before merging `staging` to `main`, the owner confirms:

- [ ] The target commit is the one verified on staging.
- [ ] GitHub `Quality gate` is green and up to date for that commit.
- [ ] Relevant staging smoke tests are documented as passed.
- [ ] `docs/operations.md` deploy gate is complete.
- [ ] A database migration is additive, backward-compatible, already tested in
  staging, and has an identified backup/recovery path.
- [ ] The previous healthy Railway deployment is known as the application
  rollback target.
- [ ] The owner explicitly approves the production merge.

After Railway deploys `main`:

- [ ] Confirm the new deployment is successful in Railway.
- [ ] Request production `/api/health` and verify the expected safe response.
- [ ] Run the affected production smoke path without using real customer data.
- [ ] Inspect the allowed error/incident signals for a regression.
- [ ] Record the release result and follow-up work in the PR or release notes.

## Rollback

For an application regression, return to the previous healthy Railway
deployment first. This is the fastest reversible action and keeps the database
schema intact. Do not roll back a database destructively during an incident.

If an emergency needs a temporary GitHub-protection exception, the owner must
approve it, record why it was necessary, and restore the rule after the
incident. An exception is not a normal release path.

## Authority boundaries

Agents may prepare code, checks, a PR, and release evidence when authorised.
Only an explicit current-task instruction authorises a merge, deployment,
Railway/GitHub configuration change, migration, secret change, payment
configuration change, or external communication.
