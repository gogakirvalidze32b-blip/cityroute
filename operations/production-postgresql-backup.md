# CityRoute Production PostgreSQL backup (logical dump)

This workflow produces a **PostgreSQL logical dump** (encrypted). It is **not** a full Supabase project backup.

| This artifact **is** | This artifact **is not** |
|---|---|
| `roles.sql` (globals, no role passwords) + `database.dump` (one `pg_dump` snapshot) | Auth provider settings, SMTP, redirects |
| age-encrypted archive of those SQL/dump files | Storage object bytes / CDN |
| Suitable for isolated restore **testing** of DB schema+data | Edge Functions, secrets, Dashboard, DNS |
| | PITR / physical backup / platform clone |

**Never restore onto Production or Preview from this workflow.**

---

## Two different restore goals (do not conflate)

### A) PostgreSQL dump restore (what this artifact supports)

Load `database.dump` (+ optional `roles.sql`) into an **isolated** Postgres-compatible target and prove schema/data integrity with **aggregate-only** checks.

### B) Full Supabase project restore (what this artifact does **not** provide)

Recreate a working Supabase project (Auth UI/config, Storage files, Edge Functions, API keys, Dashboard). **This dump alone cannot do that.** A full clone needs a new Supabase project plus separate platform steps outside this workflow.

If stock Postgres cannot finish `pg_restore` because of missing Supabase roles/extensions/`auth`/`storage` platform objects, that means **Gate B on stock PG failed**. Do **not** call the backup “fully restored on stock PostgreSQL.” You may still prove archive integrity (Gate A) and, separately, attempt load on a **brand-new disposable Supabase project** (never Production, never Preview).

---

## Consistency model

| File | How taken | Consistency |
|---|---|---|
| `database.dump` | Single `pg_dump --format=custom` (Postgres 17.6 client) | One DB snapshot (schema + data) while writers may continue |
| `roles.sql` | Separate `pg_dumpall --roles-only --no-role-passwords` immediately before | **Not** the same snapshot |
| `.tar.gz.age` | tar of dumps + manifest + SHA256SUMS, then `age` | Only ciphertext is uploaded to GitHub Actions |

**CI credentials:** mode-600 `PGPASSFILE` + `PGHOST`/`PGPORT`/`PGUSER`/`PGDATABASE`/`PGSSLMODE`. Full `DATABASE_URL` and password never appear on docker / `pg_dump` / `pg_dumpall` argv (no URI argument, no `$(cat …)` into the dump command). Containers use `--user $(id -u):$(id -g)` so the bind-mounted `.pgpass` owner matches the dump process euid (libpq ignores `.pgpass` when owner ≠ euid). Credential/helper files are deleted before tar and never enter the artifact.

---

## GitHub configuration (manual — do not change from the agent)

**Secrets:** `SUPABASE_DB_URL` (passwordless Production pooler URL), `SUPABASE_DB_PASSWORD`

URL must match:

- host `aws-1-eu-central-1.pooler.supabase.com`
- port `5432`
- user `postgres.tuylbbdhvfcobxynwtnt`
- path `/postgres`
- `sslmode=require`
- no password in the URL

**Variable:** `AGE_RECIPIENT` = public `age1…` from local `age-keygen -y` (never upload the private identity)

---

## How to verify dump restore without touching Production or Preview

Prerequisites: workflow already ran successfully; you have the `.age` artifact and the local age private identity.

### 0) Decrypt + SHA (required)

```bash
age --decrypt -i "$HOME/.config/age/cityroute-backup-identity.txt" \
  -o cityroute-production-backup.tar.gz \
  cityroute-production-backup-*.tar.gz.age
tar -xzf cityroute-production-backup.tar.gz
sha256sum --check SHA256SUMS.txt
```

Windows: use `age.exe` / `Get-FileHash` as in prior notes. Expected members: `roles.sql`, `database.dump`, `MANIFEST.txt`, `SHA256SUMS.txt`.

### Gate A — archive integrity (required; no DB server)

```bash
docker run --rm -v "$PWD:/work" postgres:17.6 \
  pg_restore --list /work/database.dump > cityroute-restore.list
test -s cityroute-restore.list
wc -l cityroute-restore.list
```

**Pass:** non-empty TOC. **This alone does not prove a successful database load.**

### Gate B1 — stock PostgreSQL load (honest limitation)

```bash
docker rm -f cityroute-backup-restore-test 2>/dev/null || true
docker run -d --name cityroute-backup-restore-test \
  -e POSTGRES_PASSWORD=restore-test-only \
  postgres:17.6
until docker exec cityroute-backup-restore-test pg_isready -U postgres; do sleep 1; done

docker cp roles.sql cityroute-backup-restore-test:/tmp/roles.sql
docker exec cityroute-backup-restore-test \
  psql -U postgres -d postgres -v ON_ERROR_STOP=0 -f /tmp/roles.sql \
  >/tmp/roles-restore.log 2>&1 || true

docker cp database.dump cityroute-backup-restore-test:/tmp/database.dump
docker exec cityroute-backup-restore-test \
  pg_restore --username=postgres --dbname=postgres --exit-on-error --no-owner --no-acl \
  /tmp/database.dump
```

**Expected limitation:** Supabase dumps commonly reference platform roles, `auth`/`storage`/`realtime` objects, and extensions that stock `postgres:17.6` does not ship in the same layout. If `pg_restore` exits non-zero for those reasons, **Gate B1 failed**. Record the error class (role/extension/schema); do **not** mark restore successful. Destroy the container:

```bash
docker rm -f cityroute-backup-restore-test
```

### Gate B2 — disposable Supabase project load (allowed target for “restorable”)

Use only if Gate B1 failed on platform objects and you still need a load proof before BOG migrations:

1. Create a **new** Supabase project used only for restore testing.
2. **Do not** use Production `tuylbbdhvfcobxynwtnt` or Preview `agtcdzxltvtcfxmpnwxr`.
3. Restore `database.dump` into that disposable DB with Supabase SQL/restore practices for custom dumps (or `pg_restore` via its pooler/session connection).
4. Run **aggregate-only** SQL (counts by status/provider). Never `SELECT` emails, payment IDs, or row payloads into shared logs.
5. Delete the disposable project when done.

**Pass for “dump is restorable for migration prep”:** Gate A pass **and** (Gate B1 full pass **or** Gate B2 full pass with aggregates).

**Not a pass:** decrypt/SHA only; Gate A only; Gate B1 failed and B2 not run; any inspect of personal/payment rows.

---

## Log hygiene (CI)

- Upload artifact = **only** `.age` ciphertext (`retention-days: 14`).
- Plaintext dumps/logs stay on the runner and are deleted at step end; `db_url` is removed before tar.
- Summaries: sizes + SHA-256 only.
- Failure logs: redacted (URLs, passwords, JWTs, emails); refuse to continue if dump logs look like COPY/INSERT payloads.

---

## Ready vs not ready

| State | Meaning |
|---|---|
| Workflow file reviewed | Process may be dispatchable after Secrets/vars |
| No successful run + decrypt + Gate A + (B1 or B2) | **Backup not ready** |
| Gates passed | Dump restorable for BOG prep; migrations still need separate approval |

## Relation to BOG migrations

Passing restore tests does **not** authorize Production SQL. Separate approval is required for `029 → (skip 0291) → 032 → 033 → 034 → 035`.
