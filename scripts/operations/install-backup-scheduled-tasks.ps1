param(
  [Parameter(Mandatory=$true)][string]$ConfigFile,
  [string]$TaskNamePrefix='Lumina Story Production',
  [string]$DailyAt='02:00',
  [ValidateRange(5,1440)][int]$MonitorIntervalMinutes=30,
  [string]$UserId='SYSTEM'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$config=(Resolve-Path -LiteralPath $ConfigFile).Path
$backupScript=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'invoke-scheduled-remote-backup.ps1')).Path
$monitorScript=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'monitor-remote-backups.ps1')).Path
$powerShell=(Get-Command powershell.exe).Source
$quote=[char]34
$backupAction=New-ScheduledTaskAction -Execute $powerShell -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File {0}{1}{0} -ConfigFile {0}{2}{0}' -f $quote,$backupScript,$config)
$monitorAction=New-ScheduledTaskAction -Execute $powerShell -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File {0}{1}{0} -ConfigFile {0}{2}{0}' -f $quote,$monitorScript,$config)
$backupTrigger=New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($DailyAt,'HH:mm',[Globalization.CultureInfo]::InvariantCulture))
$monitorTrigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $MonitorIntervalMinutes)
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew
$principal=New-ScheduledTaskPrincipal -UserId $UserId -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName ($TaskNamePrefix+' Backup') -Action $backupAction -Trigger $backupTrigger -Settings $settings -Principal $principal -Description 'Creates and verifies a joint PostgreSQL/blobstore backup, replicates it off-host, and applies GFS retention.' -Force | Out-Null
Register-ScheduledTask -TaskName ($TaskNamePrefix+' Monitor') -Action $monitorAction -Trigger $monitorTrigger -Settings $settings -Principal $principal -Description 'Checks backup freshness, last result, destination availability, and free space.' -Force | Out-Null
Write-Output ('Installed scheduled tasks: {0} Backup; {0} Monitor' -f $TaskNamePrefix)
