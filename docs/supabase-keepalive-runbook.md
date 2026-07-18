# Supabase Keepalive Runbook

This heartbeat is a technical healthcheck for `dev`, `staging`, and `free` Supabase environments only. It must never count as user activity, create fake users or tasks, or emit product analytics.

## Required configuration

- Supabase Edge Function secrets:
  - `INTERNAL_HEARTBEAT_SECRET`
  - `INTERNAL_HEARTBEAT_ENVIRONMENT=dev|staging|free`
- GitHub Actions secrets:
  - `SUPABASE_FUNCTION_URL`
  - `INTERNAL_HEARTBEAT_SECRET`

## Scheduled ping

The workflow in `.github/workflows/supabase-keepalive.yml` sends:

```bash
curl -X POST "$SUPABASE_FUNCTION_URL/internal-heartbeat" \
  -H "x-internal-heartbeat-secret: $INTERNAL_HEARTBEAT_SECRET"
```

Schedule: Monday and Thursday at `09:00 UTC`.

## Supabase keepalive check

- `INTERNAL_HEARTBEAT_SECRET` is set.
- `INTERNAL_HEARTBEAT_ENVIRONMENT` is set to `dev`, `staging`, or `free`.
- The `internal-heartbeat` Edge Function returns `200`.
- `internal_heartbeat.last_ping_at` updates for `source = 'supabase_keepalive'`.
- The request does not create user-facing events.
- The request does not affect `DAU/MAU`.
- A normal anon/authenticated client cannot read `internal_heartbeat`.
- Tokens and secrets are not visible in network traces or logs.

## Manual verification

1. Trigger the workflow manually or run the curl command from a secure shell.
2. In Supabase SQL Editor, verify the row:

```sql
select source, environment, last_ping_at, updated_at, metadata
from public.internal_heartbeat
where source = 'supabase_keepalive';
```

3. Confirm nothing user-facing changed:

```sql
select count(*) from public.tasks;
select count(*) from public.task_activities;
select count(*) from public.profiles;
```

4. Confirm a normal client cannot read the table. Any direct query through the anon/authenticated API should fail with a permission error.

## Important limitation

- This heartbeat is allowed only for `dev`, `staging`, or `free` environments.
- Do not enable it for production.
- If the project is production-critical, prefer a paid Supabase plan instead of synthetic keepalive traffic.
