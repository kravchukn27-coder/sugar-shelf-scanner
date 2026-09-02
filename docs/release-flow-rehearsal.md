# Release-flow rehearsal

This file is a harmless release candidate used to prove the protected delivery
path after staging was introduced.

Expected route:

```text
codex/release-flow-rehearsal → PR → staging → staging smoke check
                                         ↓
                                   PR → main → production health check
```

It changes no runtime behaviour, configuration, database schema, secrets, or
customer data. The release evidence belongs to the two pull requests that move
this commit through `staging` and then `main`.
