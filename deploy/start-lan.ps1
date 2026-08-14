#Requires -Version 5.1
<#
.SYNOPSIS
  Start InfiniteCanvas LAN stack with the REQUIRED enterprise-spaces override.

.DESCRIPTION
  Never run compose.remote.yml alone for LAN — that builds the old infinite-canvas
  context. This script always loads compose.lan.override.yml and stamps BUILD_REVISION.
#>
$ErrorActionPreference = "Stop"
$deployDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$enterprise = Resolve-Path (Join-Path $deployDir "..\..\infinite-canvas-enterprise-spaces")
Set-Location $deployDir

if (-not (Test-Path ".\compose.remote.yml")) { throw "missing compose.remote.yml" }
if (-not (Test-Path ".\compose.lan.override.yml")) { throw "missing compose.lan.override.yml" }
if (-not (Test-Path ".\.env.lan")) { throw "missing .env.lan" }

$rev = "unknown"
try {
  Push-Location $enterprise.Path
  $rev = (git rev-parse --short HEAD 2>$null)
  if (-not $rev) { $rev = "unknown" }
} finally {
  Pop-Location
}
$env:BUILD_REVISION = $rev
$env:BUILD_SOURCE = "infinite-canvas-enterprise-spaces"

Write-Host "LAN start: build context=$($enterprise.Path)"
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
