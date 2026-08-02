param(
  [Parameter(Mandatory=$true)][string]$ConfigFile
)

. $PSScriptRoot/backup-automation-common.ps1
$loaded=Read-BackupAutomationConfig $ConfigFile
$config=$loaded.Value
$statePath=Join-Path $config.stateDirectory 'backup-status.json'
$attemptUtc=(Get-Date).ToUniversalTime()
$previous=$null
if (Test-Path -LiteralPath $statePath) { $previous=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json }
$state=[ordered]@{
  projectName=[string]$config.projectName
  lastAttemptUtc=$attemptUtc.ToString('o')
  lastSuccessUtc=if ($previous) { $previous.lastSuccessUtc } else { $null }
  outcome='running'
  backupDirectory=if ($previous) { $previous.backupDirectory } else { $null }
  offHostDirectory=if ($previous) { $previous.offHostDirectory } else { $null }
  message=$null
}
Write-AtomicJson $state $statePath

try {
  foreach ($root in @($config.localOutputRoot,$config.offHostOutputRoot)) {
    $free=Get-FreeBytes $root
    if ($null -ne $free -and $free -lt [long]$config.minimumFreeBytes) {
      throw ('Insufficient free space at {0}: {1} bytes available, {2} required' -f $root,$free,$config.minimumFreeBytes)
    }
  }

  $before=@(Get-BackupDirectories $config.localOutputRoot $config.projectName | ForEach-Object { $_.Directory.FullName })
  & (Join-Path $PSScriptRoot 'backup-remote-stack.ps1') -ComposeFile $config.composeFile -EnvFile $config.envFile -ProjectName $config.projectName -OutputRoot $config.localOutputRoot
  if ($LASTEXITCODE -ne 0) { throw ('Backup script failed with exit code {0}' -f $LASTEXITCODE) }
  $created=@(Get-BackupDirectories $config.localOutputRoot $config.projectName | Where-Object { $_.Directory.FullName -notin $before })
  if ($created.Count -ne 1) { throw ('Expected one new backup directory, found {0}' -f $created.Count) }
  $backup=$created[0].Directory.FullName
  Test-BackupDirectory $backup | Out-Null
  $offHost=Copy-VerifiedBackup $backup $config.offHostOutputRoot

  Invoke-GfsRetention $config.localOutputRoot $config.projectName $config.retention.local
  Invoke-GfsRetention $config.offHostOutputRoot $config.projectName $config.retention.offHost

  $state.lastSuccessUtc=(Get-Date).ToUniversalTime().ToString('o')
  $state.outcome='success'
  $state.backupDirectory=$backup
  $state.offHostDirectory=$offHost
  $state.message='Joint backup, verified off-host copy, and retention completed'
  Write-AtomicJson $state $statePath
  Write-Output $state.message
} catch {
  $state.outcome='failure'
  $state.message=$_.Exception.Message
  Write-AtomicJson $state $statePath
  try { Send-BackupAlert $config 'error' 'Infinite Canvas backup failed' $state.message } catch { Write-Error ('Alert delivery failed: {0}' -f $_.Exception.Message) }
  throw
}
