param(
  [string]$ComposeFile='deploy/compose.remote.yml',
  [Parameter(Mandatory=$true)][string]$EnvFile,
  [Parameter(Mandatory=$true)][string]$ProjectName,
  [Parameter(Mandatory=$true)][string]$OutputRoot
)

. $PSScriptRoot/remote-stack-common.ps1
Initialize-RemoteStack $ComposeFile $EnvFile $ProjectName

$root=[System.IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Path $root -Force | Out-Null
$lockPath=Join-Path $root ('.{0}.backup.lock' -f $ProjectName)
try {
  $lock=[System.IO.File]::Open($lockPath,'OpenOrCreate','ReadWrite','None')
} catch {
  throw ('Another backup is already running for project {0}' -f $ProjectName)
}
try {
$backup=Join-Path $root ('{0}-{1}' -f $ProjectName,(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))
New-Item -ItemType Directory -Path $backup | Out-Null
$postgres=Get-ServiceContainer 'postgres'
$blobstore=Get-ServiceContainer 'blobstore'
$databaseArchive=Join-Path $backup 'postgres.dump'
$blobstoreArchive=Join-Path $backup 'blobstore.tar.gz'
$helper=$null

try {
  Invoke-Compose stop web api blobstore
  & docker exec $postgres sh -ceu 'rm -f /tmp/ic.dump; PGPASSWORD=$POSTGRES_PASSWORD pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc --no-owner --no-privileges -f /tmp/ic.dump'
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL dump failed' }
  & docker cp ('{0}:/tmp/ic.dump' -f $postgres) $databaseArchive
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL archive copy failed' }
  & docker exec $postgres rm -f /tmp/ic.dump

  $volume=Get-VolumeName $blobstore '/var/lib/infinite-canvas-blobs'
  $helper='ic-backup-'+[Guid]::NewGuid().ToString('N').Substring(0,12)
  & docker create --name $helper --mount ('type=volume,source={0},destination=/source,readonly' -f $volume) alpine:3.22 sh -ceu 'tar -czf /tmp/blobstore.tar.gz -C /source .' *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Backup helper creation failed' }
  & docker start --attach $helper
  if ($LASTEXITCODE -ne 0) { throw 'Blobstore archive failed' }
  & docker cp ('{0}:/tmp/blobstore.tar.gz' -f $helper) $blobstoreArchive
  if ($LASTEXITCODE -ne 0) { throw 'Blobstore archive copy failed' }
} finally {
  if ($helper) { & docker rm --force $helper *> $null }
  Invoke-Compose up --detach web api blobstore
}

$manifest=[ordered]@{
  formatVersion=1
  createdAtUtc=(Get-Date).ToUniversalTime().ToString('o')
  projectName=$ProjectName
  consistency='application-writes-stopped'
  database=[ordered]@{file='postgres.dump';sha256=(Get-FileHash $databaseArchive -Algorithm SHA256).Hash.ToLowerInvariant();sizeBytes=(Get-Item $databaseArchive).Length}
  blobstore=[ordered]@{file='blobstore.tar.gz';sha256=(Get-FileHash $blobstoreArchive -Algorithm SHA256).Hash.ToLowerInvariant();sizeBytes=(Get-Item $blobstoreArchive).Length}
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $backup 'manifest.json') -Encoding utf8
Write-Output ('Joint backup created: {0}' -f $backup)
} finally {
  $lock.Dispose()
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
