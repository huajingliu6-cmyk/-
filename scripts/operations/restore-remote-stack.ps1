param(
  [string]$ComposeFile='deploy/compose.remote.yml',
  [Parameter(Mandatory=$true)][string]$EnvFile,
  [Parameter(Mandatory=$true)][string]$ProjectName,
  [Parameter(Mandatory=$true)][string]$BackupDirectory,
  [Parameter(Mandatory=$true)][switch]$ConfirmDestructiveRestore
)

. $PSScriptRoot/remote-stack-common.ps1
if (-not $ConfirmDestructiveRestore) { throw 'Pass -ConfirmDestructiveRestore explicitly' }
Initialize-RemoteStack $ComposeFile $EnvFile $ProjectName

$backup=(Resolve-Path -LiteralPath $BackupDirectory).Path
$manifest=Get-Content -Raw (Join-Path $backup 'manifest.json') | ConvertFrom-Json
if ($manifest.formatVersion -ne 1) { throw 'Unsupported backup format' }
if ($manifest.database.file -ne 'postgres.dump' -or $manifest.blobstore.file -ne 'blobstore.tar.gz') { throw 'Unsupported archive names' }
$databaseArchive=Join-Path $backup $manifest.database.file
$blobstoreArchive=Join-Path $backup $manifest.blobstore.file
if (-not (Test-Path $databaseArchive) -or -not (Test-Path $blobstoreArchive)) { throw 'Backup archive is incomplete' }
if ((Get-FileHash $databaseArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.database.sha256) { throw 'PostgreSQL SHA-256 mismatch' }
if ((Get-FileHash $blobstoreArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.blobstore.sha256) { throw 'Blobstore SHA-256 mismatch' }

$helper=$null
try {
  Invoke-Compose down --volumes --remove-orphans
  Invoke-Compose create postgres blobstore-init blobstore api web
  $blobstore=Get-ServiceContainer 'blobstore'
  $volume=Get-VolumeName $blobstore '/var/lib/infinite-canvas-blobs'
  $volumeInfo=(& docker volume inspect $volume | ConvertFrom-Json)[0]
  $volumeProject=$volumeInfo.Labels.'com.docker.compose.project'
  $volumeRole=$volumeInfo.Labels.'com.docker.compose.volume'
  if ($volumeProject -ne $ProjectName -or $volumeRole -ne 'blobstore_data') { throw ('Refusing unverified volume: {0}' -f $volume) }

  $helper='ic-restore-'+[Guid]::NewGuid().ToString('N').Substring(0,12)
  & docker create --name $helper --mount ('type=volume,source={0},destination=/target' -f $volume) alpine:3.22 sh -ceu 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -xzf /tmp/blobstore.tar.gz -C /target; chown -R 65532:65532 /target; chmod 0750 /target' *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Restore helper creation failed' }
  & docker cp $blobstoreArchive ('{0}:/tmp/blobstore.tar.gz' -f $helper)
  if ($LASTEXITCODE -ne 0) { throw 'Blobstore archive copy failed' }
  & docker start --attach $helper
  if ($LASTEXITCODE -ne 0) { throw 'Blobstore restore failed' }
  & docker rm --force $helper *> $null
  $helper=$null

  Invoke-Compose up --detach postgres
  $postgres=Get-ServiceContainer 'postgres'
  Wait-Healthy $postgres
  & docker cp $databaseArchive ('{0}:/tmp/ic.dump' -f $postgres)
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL archive copy failed' }
  & docker exec $postgres sh -ceu 'PGPASSWORD=$POSTGRES_PASSWORD pg_restore -U $POSTGRES_USER -d $POSTGRES_DB --clean --if-exists --no-owner --no-privileges /tmp/ic.dump; rm -f /tmp/ic.dump'
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL restore failed' }

  Invoke-Compose up --detach
  foreach ($service in @('postgres','blobstore','api','web')) { Wait-Healthy (Get-ServiceContainer $service) }
} finally {
  if ($helper) { & docker rm --force $helper *> $null }
}

Write-Output ('Joint restore completed and healthy: {0}' -f $ProjectName)
