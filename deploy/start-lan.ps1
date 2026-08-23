#Requires -Version 5.1
<#
.SYNOPSIS
  Start InfiniteCanvas LAN stack with compose.remote.yml + compose.lan.override.yml.

.DESCRIPTION
  Always pairs both compose files and stamps BUILD_REVISION from this repo.
  Builds only the web image (never api/blobstore) to avoid gcr.io pulls on LAN.
  Exposes a single nginx gateway on WEB_PORT; web stays internal.

.PARAMETER ForceRecreate
  Force-recreate web and gateway containers.

.PARAMETER NoCache
  Rebuild web image without Docker layer cache.

.PARAMETER SkipBuild
  Skip web image rebuild (restart containers only).

.PARAMETER RebuildApi
  Also rebuild api/blobstore (requires gcr.io access).

.PARAMETER Strict
  Match local working tree exactly: no-cache web build, force-recreate web+gateway,
  stamp BUILD_REVISION with -dirty when git has uncommitted changes, and try api rebuild.
#>
param(
  [switch]$ForceRecreate,
  [switch]$NoCache,
  [switch]$SkipBuild,
  [switch]$RebuildApi,
  [switch]$Strict
)

if ($Strict) {
  $NoCache = $true
  $ForceRecreate = $true
  $RebuildApi = $true
}

$ErrorActionPreference = "Stop"
$deployDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $deployDir "..")
Set-Location $deployDir

if (-not (Test-Path ".\compose.remote.yml")) { throw "missing compose.remote.yml" }
if (-not (Test-Path ".\compose.lan.override.yml")) { throw "missing compose.lan.override.yml" }
if (-not (Test-Path ".\.env.lan")) { throw "missing .env.lan" }

$rev = "unknown"
$dirty = $false
try {
  Push-Location $repoRoot.Path
  $rev = (git rev-parse --short HEAD 2>$null)
  if (-not $rev) { $rev = "unknown" }
  $status = git status --porcelain 2>$null
  if ($status) {
    $dirty = $true
    $rev = "$rev-dirty"
  }
} finally {
  Pop-Location
}
$env:BUILD_REVISION = $rev
$env:BUILD_SOURCE = "infinite-canvas"

$lanPort = "3080"
$envMatch = Select-String -Path ".\.env.lan" -Pattern '^\s*WEB_PORT\s*=\s*(\d+)\s*$' | Select-Object -First 1
if ($envMatch) { $lanPort = $envMatch.Matches[0].Groups[1].Value }
$env:WEB_PORT = $lanPort

$composeFiles = @(
  "--env-file", ".env.lan",
  "-f", "compose.remote.yml",
  "-f", "compose.lan.override.yml"
)

function Invoke-LanCompose {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
  )
  # docker compose writes progress to stderr; do not treat as terminating errors
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    docker compose @composeFiles @Args
    if ($LASTEXITCODE -ne 0) {
      throw "docker compose failed with exit code $LASTEXITCODE"
    }
  } finally {
    $ErrorActionPreference = $prevEap
  }
}

Write-Host "LAN start: build context=$($repoRoot.Path)"
Write-Host "LAN start: BUILD_REVISION=$rev BUILD_SOURCE=$env:BUILD_SOURCE WEB_PORT=$lanPort$(if ($dirty) { ' (dirty working tree)' } else { '' })"
Write-Host "LAN start: compose files=compose.remote.yml + compose.lan.override.yml"

try {
  Set-NetConnectionProfile -NetworkCategory Private -ErrorAction SilentlyContinue
} catch {
  Write-Warning "Could not set network profile to Private (run as Administrator if LAN peers cannot connect)."
}

$ruleName = "InfiniteCanvas-LAN-${lanPort}-TCP"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  try {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $lanPort -Profile Any -Enabled True | Out-Null
    Write-Host "LAN start: created firewall rule $ruleName"
  } catch {
    Write-Warning "Could not create firewall rule $ruleName (Administrator required)."
  }
} else {
  Write-Host "LAN start: firewall rule $ruleName present"
}

if ($RebuildApi) {
  Write-Host "LAN start: rebuilding api/blobstore (requires gcr.io)..."
  Invoke-LanCompose build api blobstore
  Invoke-LanCompose up --detach --force-recreate --no-deps api blobstore
} else {
  $apiHealth = docker inspect deploy-api-1 --format "{{.State.Health.Status}}" 2>$null
  if ($apiHealth -eq "healthy") {
    Write-Host "LAN start: backend already healthy (skip compose up)"
  } else {
    Write-Host "LAN start: starting postgres/api/blobstore (no rebuild)..."
    Invoke-LanCompose up --detach --no-build --wait postgres blobstore-init blobstore api | Out-Null
  }
}

if (-not $SkipBuild) {
  if ($NoCache) {
    Write-Host "LAN start: building web (no cache)..."
    Invoke-LanCompose build --no-cache web
  } else {
    Write-Host "LAN start: building web..."
    Invoke-LanCompose build web
  }
} else {
  Write-Host "LAN start: skipping web build"
}

if ($ForceRecreate) {
  Write-Host "LAN start: recreating web + gateway..."
  Invoke-LanCompose up --detach --force-recreate --no-deps web gateway | Out-Null
} else {
  Write-Host "LAN start: starting web + gateway..."
  Invoke-LanCompose up --detach --no-deps web gateway | Out-Null
}

Write-Host "LAN start: waiting for gateway health..."
$deadline = (Get-Date).AddSeconds(90)
do {
  Start-Sleep -Seconds 2
  $gw = docker inspect deploy-gateway-1 --format "{{.State.Health.Status}}" 2>$null
} while ($gw -ne "healthy" -and (Get-Date) -lt $deadline)
if ($gw -ne "healthy") {
  Write-Warning "gateway not healthy after 90s (status=$gw); health check may fail"
}

Write-Host ""
Write-Host "LAN start: running health check..."
& (Join-Path $deployDir "check-lan.ps1") -Port $lanPort
if ($LASTEXITCODE -ne 0) {
  throw "LAN health check failed; see messages above."
}

Write-Host ""
Write-Host "LAN start complete."
