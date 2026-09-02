# Rollback and migration runbook

Use this runbook when a release must be reversed or contains a database
change. It complements [release-workflow.md](release-workflow.md): the safe
default is to restore application behaviour first and preserve evidence.

## First response to a release regression

1. Declare the release paused. Do not merge unrelated work or retry the same
   deployment while the cause is unknown.
2. Record the affected commit, Railway deployment ID, first observed time,
   impact, and last known healthy deployment.
3. If customers are harmed, return the **application** to the previous healthy
   Railway deployment. This is the normal rollback; it does not change the
   database.
4. Confirm production `/api/health`, then exercise the affected safe smoke path
   without real customer input. Check the allowed alert and error signals.
5. Open a bounded fix branch. It must go through `staging` and the same quality
   gate before another production merge.

Never make an emergency direct push to `main`, disable branch protection, or
delete a live database to make a release appear healthy. The owner may approve
an exceptional protection change only for an active incident; record why and
restore the rule immediately after recovery.

## When an application rollback is not enough

- **Bad configuration or secret exposure:** disable the affected integration,
  rotate the exposed credential, redeploy the service, and document the scope.
  Do not copy production credentials to staging.
- **Bad data write:** stop the writer first. Preserve identifiers and timestamps
  needed to repair the data; prepare a reviewed, targeted forward repair rather
  than a broad delete.
- **Unavailable dependency:** use the application's designed safe failure or
  fallback. Do not silently weaken rate limits, privacy controls, or payment
  verification to recover traffic.

## Database migration policy

Every production migration is forward-only, additive, and independently
reviewable. A migration PR must state its compatibility window and recovery
plan.

1. Add new tables, nullable columns, indexes, or new values first. Do not
   rename, drop, narrow, or make a column required in the same release.
2. Deploy code that reads both old and new shapes (and writes both when
   necessary). Run any backfill separately, in bounded batches, with a restart
   plan.
3. Verify the migration and backfill in the isolated staging database using a
   fresh schema and approved non-production seed data.
4. Merge the application release only after staging proves both the new code and
   the prior application version remain compatible with the migrated schema.
5. Contract or remove the old shape only in a later release, after confirming
   no supported deployment or recovery path needs it.

There are no destructive down-migrations in an incident. Restore application
code first; repair or backfill data forward after the incident is understood.

## Release evidence

For every production release, add these facts to its PR or release note:

- exact commit and Railway deployment IDs;
- staging health result and relevant smoke checks;
- last known healthy production deployment;
- migration/backfill status, or an explicit statement that none ran;
- rollback decision, result, and follow-up task if an incident occurred.

This creates a reliable next action during pressure without storing customer
data, secrets, images, OCR, or request payloads in release notes.
