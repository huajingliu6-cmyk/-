Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Initialize-RemoteStack {
  param([string]$ComposeFile,[string]$EnvFile,[string]$ProjectName)
  if ($ProjectName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]+$') { throw 'Invalid project name' }
  if (-not (Test-Path -LiteralPath $ComposeFile)) { throw 'Compose file not found' }
  if (-not (Test-Path -LiteralPath $EnvFile)) { throw 'Environment file not found' }
  $script:ComposeFile=(Resolve-Path $ComposeFile).Path
  $script:EnvFile=(Resolve-Path $EnvFile).Path
  $script:ProjectName=$ProjectName
  $compose=Get-Command docker-compose -ErrorAction SilentlyContinue
  if ($compose) {
    $script:ComposeExe=$compose.Source
    $script:ComposePrefix=@()
    return
  }
  & docker compose version *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Docker Compose is required' }
  $script:ComposeExe=(Get-Command docker).Source
  $script:ComposePrefix=@('compose')
}

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
  & $script:ComposeExe @script:ComposePrefix --file $script:ComposeFile --env-file $script:EnvFile --project-name $script:ProjectName @Arguments
  if ($LASTEXITCODE -ne 0) { throw ('Docker Compose failed: {0}' -f $LASTEXITCODE) }
}

function Get-ServiceContainer {
  param([string]$Service)
  $output=& $script:ComposeExe @script:ComposePrefix --file $script:ComposeFile --env-file $script:EnvFile --project-name $script:ProjectName ps --all --quiet $Service
  $id=([string]$output).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $id) { throw ('Service container not found: {0}' -f $Service) }
  $id
}

function Get-VolumeName {
  param([string]$Container,[string]$Destination)
  $info=(& docker inspect $Container | ConvertFrom-Json)[0]
  $mount=$info.Mounts | Where-Object { $_.Type -eq 'volume' -and $_.Destination -eq $Destination } | Select-Object -First 1
  if (-not $mount) { throw ('Volume mount not found: {0}' -f $Destination) }
  [string]$mount.Name
}

function Wait-Healthy {
  param([string]$Container,[int]$TimeoutSeconds=180)
  $deadline=(Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $state=(& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $Container).Trim()
    if ($state -in @('healthy','running')) { return }
    if ($state -in @('unhealthy','exited','dead')) { throw ('Container state: {0}' -f $state) }
    Start-Sleep 2
  }
  throw ('Health wait timed out: {0}' -f $Container)
}
