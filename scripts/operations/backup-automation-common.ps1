Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-ConfigPath {
  param([string]$Value,[string]$ConfigDirectory)
  if (-not $Value) { return $null }
  if ([System.IO.Path]::IsPathRooted($Value)) { return [System.IO.Path]::GetFullPath($Value) }
  [System.IO.Path]::GetFullPath((Join-Path $ConfigDirectory $Value))
}

function Read-BackupAutomationConfig {
  param([Parameter(Mandatory=$true)][string]$ConfigFile)
  $resolved=(Resolve-Path -LiteralPath $ConfigFile).Path
  $directory=Split-Path -Parent $resolved
  $config=Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json
  foreach ($property in @('composeFile','envFile','projectName','localOutputRoot','offHostOutputRoot','stateDirectory','retention')) {
    if (-not $config.PSObject.Properties[$property]) { throw ('Missing configuration property: {0}' -f $property) }
  }
  $config.composeFile=Resolve-ConfigPath $config.composeFile $directory
  $config.envFile=Resolve-ConfigPath $config.envFile $directory
  $config.localOutputRoot=Resolve-ConfigPath $config.localOutputRoot $directory
  $config.offHostOutputRoot=Resolve-ConfigPath $config.offHostOutputRoot $directory
  $config.stateDirectory=Resolve-ConfigPath $config.stateDirectory $directory
  if ($config.PSObject.Properties['webhookUrlFile'] -and $config.webhookUrlFile) {
    $config.webhookUrlFile=Resolve-ConfigPath $config.webhookUrlFile $directory
  }
  [pscustomobject]@{Path=$resolved;Directory=$directory;Value=$config}
}

function Write-AtomicJson {
  param([Parameter(Mandatory=$true)]$Value,[Parameter(Mandatory=$true)][string]$Path)
  $directory=Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $temporary='{0}.{1}.tmp' -f $Path,[Guid]::NewGuid().ToString('N')
  $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding utf8
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Get-WebhookUrl {
  param($Config)
  if ($Config.PSObject.Properties['webhookUrlFile'] -and $Config.webhookUrlFile -and (Test-Path -LiteralPath $Config.webhookUrlFile)) {
    return (Get-Content -LiteralPath $Config.webhookUrlFile -Raw).Trim()
  }
  if ($Config.PSObject.Properties['webhookUrlEnvironmentVariable'] -and $Config.webhookUrlEnvironmentVariable) {
    return [Environment]::GetEnvironmentVariable([string]$Config.webhookUrlEnvironmentVariable)
  }
  $null
}

function Send-BackupAlert {
  param($Config,[string]$Level,[string]$Title,[string]$Message)
  $url=Get-WebhookUrl $Config
  if (-not $url) { return }
  $payload=[ordered]@{level=$Level;title=$Title;message=$Message;projectName=[string]$Config.projectName;host=$env:COMPUTERNAME;occurredAtUtc=(Get-Date).ToUniversalTime().ToString('o')}
  Invoke-RestMethod -Method Post -Uri $url -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Depth 4) -TimeoutSec 20 | Out-Null
}

function Get-BackupDirectories {
  param([string]$Root,[string]$ProjectName)
  if (-not (Test-Path -LiteralPath $Root)) { return @() }
  $pattern='^{0}-(?<stamp>\d{{8}}T\d{{6}}Z)$' -f [regex]::Escape($ProjectName)
  @(Get-ChildItem -LiteralPath $Root -Directory -ErrorAction Stop | ForEach-Object {
    if ($_.Name -match $pattern) {
      $timestamp=[datetime]::ParseExact($Matches.stamp,'yyyyMMddTHHmmssZ',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal).ToUniversalTime()
      [pscustomobject]@{Directory=$_;TimestampUtc=$timestamp}
    }
  } | Sort-Object TimestampUtc -Descending)
}

function Test-BackupDirectory {
  param([Parameter(Mandatory=$true)][string]$BackupDirectory)
  $manifestPath=Join-Path $BackupDirectory 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath)) { throw ('Manifest missing: {0}' -f $BackupDirectory) }
  $manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.formatVersion -ne 1) { throw ('Unsupported manifest format: {0}' -f $BackupDirectory) }
  foreach ($entryName in @('database','blobstore')) {
    $entry=$manifest.$entryName
    $archive=Join-Path $BackupDirectory ([string]$entry.file)
    if (-not (Test-Path -LiteralPath $archive)) { throw ('Archive missing: {0}' -f $archive) }
    $file=Get-Item -LiteralPath $archive
    if ($file.Length -ne [long]$entry.sizeBytes) { throw ('Archive size mismatch: {0}' -f $archive) }
    $hash=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne [string]$entry.sha256) { throw ('Archive SHA-256 mismatch: {0}' -f $archive) }
  }
  $manifest
}

function Copy-VerifiedBackup {
  param([string]$SourceDirectory,[string]$DestinationRoot)
  New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
  $name=Split-Path -Leaf $SourceDirectory
  $destination=Join-Path $DestinationRoot $name
  if (Test-Path -LiteralPath $destination) { Test-BackupDirectory $destination | Out-Null; return $destination }
  $partial=Join-Path $DestinationRoot ('.{0}.partial-{1}' -f $name,[Guid]::NewGuid().ToString('N'))
  try {
    Copy-Item -LiteralPath $SourceDirectory -Destination $partial -Recurse
    Test-BackupDirectory $partial | Out-Null
    Move-Item -LiteralPath $partial -Destination $destination
  } finally {
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Recurse -Force }
  }
  $destination
}

function Get-IsoWeekKey {
  param([datetime]$Timestamp)
  '{0:D4}-W{1:D2}' -f [Globalization.ISOWeek]::GetYear($Timestamp),[Globalization.ISOWeek]::GetWeekOfYear($Timestamp)
}

function Invoke-GfsRetention {
  param([string]$Root,[string]$ProjectName,$Policy)
  $backups=@(Get-BackupDirectories $Root $ProjectName)
  $keep=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($group in @(
    [pscustomobject]@{Count=[int]$Policy.dailyCopies;Key={ param($item) $item.TimestampUtc.ToString('yyyy-MM-dd') }},
    [pscustomobject]@{Count=[int]$Policy.weeklyCopies;Key={ param($item) Get-IsoWeekKey $item.TimestampUtc }},
    [pscustomobject]@{Count=[int]$Policy.monthlyCopies;Key={ param($item) $item.TimestampUtc.ToString('yyyy-MM') }}
  )) {
    if ($group.Count -le 0) { continue }
    $keys=[Collections.Generic.HashSet[string]]::new()
    foreach ($backup in $backups) {
      $key=& $group.Key $backup
      if ($keys.Contains($key)) { continue }
      [void]$keys.Add($key)
      [void]$keep.Add($backup.Directory.FullName)
      if ($keys.Count -ge $group.Count) { break }
    }
  }
  foreach ($backup in $backups) {
    if (-not $keep.Contains($backup.Directory.FullName)) { Remove-Item -LiteralPath $backup.Directory.FullName -Recurse -Force }
  }
}

function Get-FreeBytes {
  param([string]$Path)
  $current=[System.IO.Path]::GetFullPath($Path)
  while (-not (Test-Path -LiteralPath $current)) {
    $parent=Split-Path -Parent $current
    if (-not $parent -or $parent -eq $current) { throw ('Cannot determine existing parent for: {0}' -f $Path) }
    $current=$parent
  }
  $item=Get-Item -LiteralPath $current
  if ($item.PSDrive -and $null -ne $item.PSDrive.Free) { return [long]$item.PSDrive.Free }
  $null
}
