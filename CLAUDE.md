# Deploying NoJira (Qira)

Two independent deploy surfaces — a code push does **not** touch the database, and a migration does **not** touch the deployed site. Always confirm with the user before doing either (push to `main`, `supabase db push`, `supabase functions deploy`, setting secrets) — these are visible/production-ish actions, not local edits.

## 1. Frontend (GitHub Pages)

`.github/workflows/deploy-pages.yml` builds and deploys on every push to `main`. There is no separate staging — pushing `main` is the deploy.

```bash
npx tsc --noEmit -p tsconfig.json   # typecheck
npm run build                       # full build — must succeed before pushing
git add <specific files>            # NEVER `git add -A` — see "Git hygiene" below
git commit -m "..."
git push origin main
```

The build takes effect on `oopsie-star.github.io/NoJira/` a minute or two after push. `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are baked in at build time from GitHub Actions secrets (`gh secret list --repo oopsie-star/NoJira` to see what's set).

## 2. Database (Supabase migrations)

The Supabase CLI is already linked and logged in to project `ityvlpfupodfgdgecsun` (no login/link step needed — `npx supabase projects list` confirms). **Pushing to `main` does not run migrations.** New `supabase/migrations/*.sql` files only take effect after:

```bash
npx supabase db push --dry-run   # ALWAYS check what it intends to apply first
npx supabase db push             # applies it (interactive Y/n prompt)
```

`supabase/schema.sql` is a stale, manually-maintained reference dump — **not** wired into the CLI's migration flow. Don't trust it for "does column X exist"; trust `supabase/migrations/*.sql` + the live DB.

**Verify a migration actually landed** (no service_role key needed — this works with just the anon key already in `.env`):

```bash
SUPA_URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2)
SUPA_KEY=$(grep VITE_SUPABASE_ANON_KEY .env | cut -d= -f2)
curl -s "$SUPA_URL/rest/v1/<table>?select=<new_column>&limit=1" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY"
```
An empty `[]` means the column exists but RLS hid the rows (expected for anon) — that's success. A `column ... does not exist` error means the migration didn't land.

**If `git status` shows untracked `supabase/migrations/*.sql` files:** don't assume they're pending/unapplied. Check first:

```bash
npx supabase migration list --linked
```
Every entry with `local` == `remote` is already applied to the live DB — the file just never got `git add`ed after someone ran `db push` locally. That's a harmless git-history gap (safe and worth fixing with a plain commit — it doesn't re-run anything), not a migration you need to push. Only a version present in `local` but missing from `remote` is actually unapplied.

**Reading real data for debugging** (bypasses RLS entirely, no service_role key needed — the CLI's own authenticated connection does it):

```bash
npx supabase db query "select id, title from tasks where id = '...'" --linked
```
Use this instead of asking the user to paste data or guessing from the UI when diagnosing a bug tied to specific row content.

## 3. Edge Functions

```bash
npx supabase functions deploy <name>
```

**Gotcha:** Supabase enforces platform-level JWT verification on every function by default. A function like `internal-heartbeat` that authenticates with its own custom header (not a Supabase JWT) will 401 before its code ever runs unless deployed with `--no-verify-jwt`, or pinned in `supabase/config.toml`:
```toml
[functions.<name>]
verify_jwt = false
```
Prefer the `config.toml` pin over the flag — a plain `supabase functions deploy` (no flag) picks it up automatically and won't silently regress.

## 4. Secrets

`gh` CLI is already authenticated (`gh auth status`) with `workflow` scope. Set GitHub Actions secrets with:
```bash
gh secret set NAME --body "value" --repo oopsie-star/NoJira
```
Set Supabase Edge Function secrets with:
```bash
npx supabase secrets set --env-file <path-to-temp-env-file>
```
Generate values with `openssl rand -hex 32`; never echo secret values into chat, and delete any temp file holding one immediately after use.

## 5. Git hygiene in this repo

`git status` will show a long list of pre-existing untracked/uncommitted files (other in-progress work, `supabase/.temp/*` CLI cache, etc.) that predate whatever you're working on. **Never `git add -A` or `git add .`** — always `git add` the specific files your change touched, so unrelated pending work stays untouched and out of your commit.
