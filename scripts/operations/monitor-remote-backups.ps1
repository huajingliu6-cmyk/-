param(
  [Parameter(Mandatory=$true)][string]$ConfigFile
)

. $PSScriptRoot/backup-automation-common.ps1
$loaded=Read-BackupAutomationConfig $ConfigFile
$config=$loaded.Value
$statusPath=Join-Path $config.stateDirectory 'backup-status.json'
$monitorPath=Join-Path $config.stateDirectory 'monitor-status.json'
$problems=[Collections.Generic.List[string]]::new()

if (-not (Test-Path -LiteralPath $statusPath)) {
  $problems.Add('Backup status file does not exist')
} else {
  $status=Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
  if ($status.outcome -eq 'failure') { $problems.Add(('Last backup failed: {0}' -f $status.message)) }
  if (-not $status.lastSuccessUtc) {
    $problems.Add('No successful backup has been recorded')
  } else {
    $age=(Get-Date).ToUniversalTime()-[datetime]::Parse([string]$status.lastSuccessUtc).ToUniversalTime()
    if ($age.TotalHours -gt [double]$config.staleAfterHours) { $problems.Add(('Newest successful backup is {0:N1} hours old' -f $age.TotalHours)) }
  }
}

foreach ($root in @($config.localOutputRoot,$config.offHostOutputRoot)) {
  try {
    $free=Get-FreeBytes $root
    if ($null -ne $free -and $free -lt [long]$config.minimumFreeBytes) { $problems.Add(('Insufficient free space at {0}: {1} bytes available' -f $root,$free)) }
  } catch {
    $problems.Add($_.Exception.Message)
  }
}

$fingerprint=if ($problems.Count) { [string]::Join([Environment]::NewLine,[string[]]$problems) } else { 'healthy' }
$previous=$null
if (Test-Path -LiteralPath $monitorPath) { $previous=Get-Content -LiteralPath $monitorPath -Raw | ConvertFrom-Json }
$changed=(-not $previous -or $previous.fingerprint -ne $fingerprint)
$monitor=[ordered]@{checkedAtUtc=(Get-Date).ToUniversalTime().ToString('o');healthy=($problems.Count -eq 0);fingerprint=$fingerprint;problems=@($problems)}
Write-AtomicJson $monitor $monitorPath

if ($problems.Count) {
  $message=$problems -join '; '
  if ($changed) { Send-BackupAlert $config 'error' 'Lumina Story backup monitoring alert' $message }
  throw $message
}
if ($changed -and $previous -and -not $previous.healthy) { Send-BackupAlert $config 'info' 'Lumina Story backup monitoring recovered' 'Backup monitoring is healthy again' }
Write-Output 'Backup monitoring is healthy'
