# Remote production backup and restore

Production data is one recovery unit: PostgreSQL metadata plus the Blobstore volume. Never restore only one side or combine archives from different manifests. SSDB is not part of production or this procedure.

## Backup

The backup script creates a short write outage by stopping Web, API, and Blobstore while PostgreSQL remains available for `pg_dump`. It writes a custom PostgreSQL archive, a compressed Blobstore archive, and a SHA-256 manifest.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/backup-remote-stack.ps1 `
  -EnvFile C:\secure\infinite-canvas.env `
  -ProjectName infinite-canvas-prod `
  -OutputRoot D:\backups\infinite-canvas
```

Copy the resulting timestamped directory off-host as one indivisible unit. Encrypt the destination, restrict access, define retention, and monitor the command exit code. The repository does not store backup archives or credentials.

## Restore

Restore destroys the named Compose project current PostgreSQL and Blobstore volumes. Use a new project name for rehearsals. The script verifies both SHA-256 hashes and the Compose ownership labels on the newly created Blobstore volume before writing it.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/restore-remote-stack.ps1 `
  -EnvFile C:\secure\infinite-canvas.env `
  -ProjectName infinite-canvas-restore-drill `
  -BackupDirectory D:\backups\infinite-canvas\infinite-canvas-prod-20260802T120000Z `
  -ConfirmDestructiveRestore
```

After every restore, verify application health, representative document reads, Blob content, metadata length, ETag, and SHA-256. Periodically run a restore rehearsal on isolated infrastructure and record recovery time.

## Scheduling

Use Windows Task Scheduler or the production scheduler to run `backup-remote-stack.ps1`. The script uses an exclusive per-project lock in the output root and rejects overlapping runs. Alert on nonzero exit codes, failed off-host replication, insufficient disk space, stale newest backup, and failed restore rehearsals.
