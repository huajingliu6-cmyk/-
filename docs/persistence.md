# Formal persistence (Batch A)

## Why JSON is no longer the production database

The previous `data/**/*.json` stores were a local/dev convenience. They cannot safely back a **stateless** Node.js / Next.js production fleet:

- No multi-instance consistency
- Relies on local disk / file locks
- Not suitable for Alibaba Cloud RDS targets
- Easy to lose data on ephemeral containers

**Production database:** PostgreSQL via `DATABASE_URL` (Prisma Migrate).  
**Production files:** Aliyun OSS via `AliyunOssStorageProvider`.  
**Local files:** `LocalDevelopmentStorageProvider` under `LOCAL_STORAGE_ROOT` (gitignored).

## Project root container decision

Audit confirmed `Project.rootFolderId === projectId`. **No `ProjectFolder` table** was created. Documents may store a logical `folderId` string equal to the project root id.

## Local PostgreSQL

Requires **Docker Desktop** (or compatible Docker Engine) on the developer machine.

```bash
docker compose up -d postgres postgres-test
# or
npm run db:up
```

If Docker is unavailable, `prisma migrate dev` / legacy import against a live DB cannot run locally; migration SQL is still checked into `prisma/migrations/`.

- Dev DB: `localhost:5432` / db `infinite_canvas` / user `ic_dev`
- Test DB: `localhost:5433` / db `infinite_canvas_test` / user `ic_test`

Copy variables from `.env.example` into `.env.local` (never commit secrets).

## Configure DATABASE_URL

```env
DATABASE_URL=postgresql://ic_dev:ic_dev_password@localhost:5432/infinite_canvas?schema=public
TEST_DATABASE_URL=postgresql://ic_test:ic_test_password@localhost:5433/infinite_canvas_test?schema=public
PERSISTENCE_DRIVER=file
FILE_STORAGE_DRIVER=local
LOCAL_STORAGE_ROOT=data/object-storage
```

`PERSISTENCE_DRIVER` default is **`file`** in Batch A so existing pages keep working. Production must set `postgres` (enforced in config).

## Prisma commands

| Script | Purpose |
|--------|---------|
| `npm run db:validate` | `prisma validate` |
| `npm run db:generate` | Generate Client (also runs before `build`) |
| `npm run db:migrate:dev` | Create/apply migrations on **dev** DB |
| `npm run db:migrate:deploy` | Apply migrations (CI/prod) |
| `npm run db:studio` | Prisma Studio |
| `npm run db:seed` | Dev voice catalog only (refuses production) |

**Build** runs `prisma generate` only — never migrates production DB.

## Legacy import

```bash
npm run db:legacy:dry-run    # default; no writes
npm run db:legacy:import     # --apply
npm run db:legacy:verify     # counts / sample IDs / balances
```

Rules:

- Never deletes `data/`
- Preserves user/project IDs and password hashes (scrypt) as-is
- Idempotent upserts / skip-existing
- Does not log passwords, API keys, or full private bodies

## Local storage

- Driver: `FILE_STORAGE_DRIVER=local`
- Root: `LOCAL_STORAGE_ROOT` (default `data/object-storage`)
- Forbidden in `NODE_ENV=production`

## Aliyun OSS

Server-only env vars (never `NEXT_PUBLIC_*`):

- `ALIYUN_OSS_REGION`, `ALIYUN_OSS_BUCKET`, optional `ALIYUN_OSS_ENDPOINT`
- `ALIYUN_OSS_ROLE_ARN` / STS token / AccessKey

Auth priority:

1. Default credential chain / ECS RAM role (when `ALIYUN_OSS_ALLOW_DEFAULT_CREDENTIAL_CHAIN=1` in production)
2. STS temporary credentials
3. Controlled AccessKey for locked-down deploys

Missing production OSS config must fail clearly — no silent fallback to local disk.

## Secrets that must never reach the browser

- `DATABASE_URL`
- OSS AccessKey / Secret / STS token
- Project password hashes
- User password hashes
- DashScope / payment keys

## Batch B0-B1 (projects cutover)

- `PERSISTENCE_DRIVER=postgres` switches **project list / create / get / patch** to PostgreSQL only.
- Does **not** read or write `data/projects` in postgres mode.
- Does **not** surface legacy file workflows on the project list in postgres mode.
- Auth remains file-based (`users.json`); a **clean-start identity bootstrap** upserts only the current session user into PostgreSQL (not a legacy import).
- Other domains (story body, script, assets, credits, workflow, video) remain on file storage until later batches.
- Tests must set `APP_DATA_DIR` (Vitest setup uses a temp dir) so repository `data/` is never mutated by the test suite.

## Rollback

1. Keep `PERSISTENCE_DRIVER=file` (default) — app continues on JSON for projects
2. PostgreSQL can be dropped/recreated in **dev/test only**
3. Do not delete `data/` — freeze-backup outside the repo if needed; treat as legacy archive

## Batch switch order

1. **B0-B1** — projects list/create/get/patch → postgres (this batch)
2. **B/C** — story workspace / script files, episodes, text correction  
3. **D** — character/scene/prop/audio assets  

Switch domain-by-domain. No permanent dual-write. No silent fallback to JSON on postgres errors.
