#Requires -Version 5.1
<#
.SYNOPSIS
  Start InfiniteCanvas LAN stack with compose.remote.yml + compose.lan.override.yml.

.DESCRIPTION
  Always pairs both compose files and stamps BUILD_REVISION from this repo.
  Build context is the infinite-canvas parent of deploy/ (not a sibling worktree).
#>
$ErrorActionPreference = "Stop"
$deployDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $deployDir "..")
Set-Location $deployDir

if (-not (Test-Path ".\compose.remote.yml")) { throw "missing compose.remote.yml" }
if (-not (Test-Path ".\compose.lan.override.yml")) { throw "missing compose.lan.override.yml" }
if (-not (Test-Path ".\.env.lan")) { throw "missing .env.lan" }

$rev = "unknown"
try {
  Push-Location $repoRoot.Path
  $rev = (git rev-parse --short HEAD 2>$null)
  if (-not $rev) { $rev = "unknown" }
} finally {
  Pop-Location
}
$env:BUILD_REVISION = $rev
$env:BUILD_SOURCE = "infinite-canvas"

Write-Host "LAN start: build context=$($repoRoot.Path)"
Write-Host "LAN start: BUILD_REVISION=$rev BUILD_SOURCE=$env:BUILD_SOURCE"
Write-Host "LAN start: compose files=compose.remote.yml + compose.lan.override.yml"

$force = $args -contains "-ForceRecreate"
$noCache = $args -contains "-NoCache"

if ($noCache) {
  docker compose --env-file .env.lan -f compose.remote.yml -f compose.lan.override.yml build --no-cache web
}
if ($force) {
  docker compose --env-file .env.lan -f compose.remote.yml -f compose.lan.override.yml up -d --force-recreate web
} else {
  docker compose --env-file .env.lan -f compose.remote.yml -f compose.lan.override.yml up -d --build web
}

Write-Host "LAN start done. Probe: http://127.0.0.1:3080/build-revision"
