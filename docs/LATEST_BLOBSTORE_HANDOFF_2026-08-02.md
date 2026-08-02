# Latest Blobstore Migration Handoff (2026-08-02)

This is the newest handoff entry for the Go/PostgreSQL/blobstore remote migration. When older handoff files conflict with this file, use this file and the current code.

## Current result

- The Next.js Web/API process does not store new production binary bytes on its local filesystem.
- Go remains the internal data API.
- PostgreSQL stores JSON documents, audit events, and Blob metadata.
- SSDB is optional and restricted to isolated development and test environments. Production does not deploy or require SSDB.
- A separate internal blobstore service stores new image, audio, and video bytes on its dedicated mounted volume.
- Historical PostgreSQL app_blobs.body bytea rows remain readable for compatibility.
- New remotefile writes store body as NULL and store a non-empty object_key.
- The remote production compose file forces BLOB_STORAGE_DRIVER=remotefile.
- Local compatibility defaults to BLOB_STORAGE_DRIVER=postgres.
- The Go API protocol-level integration test now passes against real PostgreSQL and the real blobstore with the in-process protocol SSDB.
- The full four-service local-development stack now passes with PostgreSQL, `infinite-canvas/ssdb:1.9.9-local`, Go API, and blobstore. This is local-development evidence only, not production approval.

## New components

- backend/cmd/blobstore/main.go
- backend/Blobstore.Dockerfile
- backend/internal/blobstore/store.go
- backend/internal/blobstore/fileserver/handler.go
- backend/internal/blobstore/remotefile/client.go
- backend/internal/blobstore/split/store.go
- backend/internal/requestcontext/request_context.go

## Storage behavior

PUT flow:

1. Go API creates a random immutable object key.
2. Binary bytes are written to blobstore using a temporary file and atomic rename.
3. PostgreSQL writes content type, length, SHA-256, and object_key.
4. If PostgreSQL metadata fails, the newly created object is deleted as compensation.
5. Replaced objects are deleted only after PostgreSQL confirms no remaining metadata reference.

GET flow:

1. PostgreSQL metadata is read first.
2. Historical rows with no object_key return the legacy bytea body.
3. New rows read bytes from blobstore.
4. Length and SHA-256 are verified before the API returns the Blob.

DELETE flow:

1. PostgreSQL metadata is removed under a per-storage-key advisory lock.
2. The object is deleted only when no metadata row still references it.
3. Missing Blob deletion remains idempotent.

## Transaction safety

- Blob overwrite, delete, and atomic transaction copy use the same PostgreSQL advisory lock derived from storage_key.
- Atomic document transactions preflight actual object existence through HEAD before PostgreSQL CAS.
- PostgreSQL still checks Blob metadata inside the document transaction.
- Transaction Blob copies preserve object_key references.
- Shared objects are not deleted while another metadata row references them.

## Security and observability

- The blobstore is attached only to the internal Docker network.
- A one-shot blobstore-init service grants the dedicated volume to UID/GID 65532; the long-running distroless blobstore remains nonroot.
- It requires BLOBSTORE_INTERNAL_TOKEN for object requests.
- Storage keys reject empty segments, dot segments, traversal, and backslashes.
- Object size is limited to 256 MiB.
- The service emits structured JSON logs to stdout.
- X-Request-Id is propagated from the Go API to blobstore logs.
- Logs do not include Token values, request bodies, API keys, cookies, or user content.
- VIDEO_PROVIDER=mock, ALLOW_PAID_GENERATION=false, and TEXT_LLM_PROVIDER=mock remain unchanged.

## Deployment contract

Go API production variables:

```env
BLOB_STORAGE_DRIVER=remotefile
BLOBSTORE_INTERNAL_URL=http://blobstore:8090
BLOBSTORE_INTERNAL_TOKEN=<secret>
```

Blobstore variables:

```env
BLOBSTORE_LISTEN_ADDRESS=0.0.0.0:8090
BLOBSTORE_DATA_ROOT=/var/lib/infinite-canvas-blobs
BLOBSTORE_INTERNAL_TOKEN=<same-secret>
```

Reference deployment: deploy/compose.remote.yml.

## Completed validation

The following passed on 2026-08-02:

- go test ./...
- go vet ./...
- API binary build
- blobstore binary build
- full backend gofmt check
- git diff --check for backend and deployment configuration
- remote file client tests
- file server tests
- split storage compatibility and failure-compensation tests
- request ID propagation assertion
- Blob storage driver configuration tests

No repository data directory, user port 3000, commit, or push was touched.

## Real Docker integration evidence

The following real-service checks passed on 2026-08-02 in the isolated Docker project ic-blob-integration:

- PostgreSQL 16 and the independent blobstore started healthy on the internal Docker network.
- The initial distroless nonroot write failed because a new Docker volume was root-owned; deploy/compose.remote.yml now uses a one-shot blobstore-init service to set UID/GID 65532 and mode 0750 before blobstore starts.
- The long-running blobstore process remained UID 65532 after the fix.
- Real PUT, HEAD, GET, and DELETE passed against PostgreSQL plus blobstore.
- A new app_blobs row had body IS NULL and a populated object_key.
- The binary existed in the blobstore volume and not in PostgreSQL bytea.
- Restarting both PostgreSQL and blobstore preserved the object; it remained readable after both services returned healthy.
- Cleanup removed both the PostgreSQL metadata row and the physical file.
- X-Request-Id value integration-restart-request appeared in blobstore PUT, GET, and DELETE JSON logs.
- Running the SQL migration twice against real PostgreSQL passed.
- A real document transaction whose metadata referenced a missing physical object returned 422 before CAS; neither document was written.
- Integration tests finished with zero integration documents, zero integration Blob rows, and no physical files remaining.
- The API Docker image and blobstore Docker image both built successfully.

The isolated Docker services and their test volumes were removed after validation.

## Go API and four-service local integration evidence

The following additional checks passed on 2026-08-02:

- `backend/internal/app/app_integration_test.go` passed with the `integration` build tag against isolated real PostgreSQL 16 and the real blobstore, while using the test process protocol SSDB.
- Go API `/health/ready` returned `200`.
- Blob `PUT`, `GET`, and `DELETE` completed through the Go API rather than only through the split storage layer.
- The inserted PostgreSQL `app_blobs` row had `body IS NULL` and a non-empty `object_key`.
- The request ID `integration-api-request` appeared in all three blobstore PUT, GET, and DELETE logs.
- A separate isolated four-service stack passed with PostgreSQL 16, the real local SSDB image `infinite-canvas/ssdb:1.9.9-local`, Go API, and blobstore.
- Four-service `/health/ready` returned `200` with all dependencies available.
- Four-service Blob PUT, GET, and DELETE passed; the GET payload matched and the metadata row was removed after DELETE.
- The request ID `integration-four-service-request` appeared four times in the Go API logs and three times in the blobstore logs.
- All integration-specific containers, networks, volumes, temporary images, and host-access Compose overrides were removed after validation.
- The installed `ic-ssdb-199-local` development container and its data volume remained running and were not modified.

These results complete the required local-development readiness checks. They do not approve the local SSDB image for production and do not validate the production backup/restore procedure.

## Local SSDB 1.9.9 installation

An isolated local-development SSDB image was built and started on 2026-08-02:

- Image tag: infinite-canvas/ssdb:1.9.9-local
- Official source: ideawu/ssdb tag 1.9.9
- Fixed source commit: 3e556e4bf4cee96d2577e3c3002f00c540e4ba10
- Fixed Debian base digest: sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818
- Installed local image ID: sha256:3b2f7d62df87e373ef2a64b9a5958e8ccb5c9d5e3a79e0a9f4109dcb6bc9ef6a
- Build definition: deploy/ssdb/Dockerfile
- Runtime configuration: deploy/ssdb/ssdb.conf
- Isolated deployment: deploy/compose.local-ssdb.yml

Validation passed for native SSDB SET, GET, and DELETE framing, restart persistence, and cleanup of the test key. The service runs as UID/GID 65532, publishes no host port, and is attached only to an internal Docker network. The installed local Compose project is ic-ssdb-199-local.

The official 1.9.9 Git tag still contains the source version marker 1.9.8, so startup logs display ssdb-server 1.9.8. The fixed commit above is the authoritative provenance for this local build.

This installation is approved only for isolated local development and testing. It must not contain real production data and must never be added to the production Compose stack.

## Remaining required work

The application migration and local integration validation are complete. Remaining production operations work is:

1. Run the production-equivalent Web, Go API, PostgreSQL, and blobstore readiness and request-ID checks.
2. Validate the operational backup and restore procedure for PostgreSQL plus the blobstore volume as one recovery unit.
3. Record recovery-point and recovery-time evidence, including behavior when PostgreSQL metadata and blobstore bytes are restored from mismatched points in time.

SSDB approval is not a production milestone because SSDB is not a production component. Do not report operational readiness complete until PostgreSQL and blobstore backup/restore evidence exists.

## Hard prohibitions

- Do not run git reset, git clean, git restore, blind git add, automatic commit, or push.
- Do not delete or rewrite the existing data directory.
- Do not run npm run db:legacy:import --apply.
- Do not change paid-generation defaults.
- Do not use port 3000 for automated smoke tests.
- Do not add SSDB to production deployment configuration.
- Do not expose PostgreSQL or blobstore directly to browsers or the public network.

## Next agent opening

```text
Read docs/LATEST_BLOBSTORE_HANDOFF_2026-08-02.md first. Independent blobstore behavior and the Go API integration tests are complete. SSDB is optional development/test cache only and must not appear in production deployment. Remaining work is production-equivalent readiness plus PostgreSQL and blobstore backup/restore validation as one recovery unit.
```
