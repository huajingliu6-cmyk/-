#Requires -Version 5.1
<#
.SYNOPSIS
  Health-check the InfiniteCanvas LAN stack (gateway, CSRF, gzip, port isolation).
#>
param(
  [string]$Port,
  [string]$LanIp
)

$ErrorActionPreference = "Stop"
$deployDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $deployDir

if (-not $Port) {
  $envFile = Join-Path $deployDir ".env.lan"
  if (Test-Path $envFile) {
    $match = Select-String -Path $envFile -Pattern '^\s*WEB_PORT\s*=\s*(\d+)\s*$' | Select-Object -First 1
    if ($match) { $Port = $match.Matches[0].Groups[1].Value }
  }
  if (-not $Port) { $Port = "3080" }
}

if (-not $LanIp) {
  $LanIp = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -notlike '127.*' -and
      $_.PrefixOrigin -ne 'WellKnown' -and
      $_.InterfaceAlias -notlike 'vEthernet*'
    } |
    Select-Object -First 1 -ExpandProperty IPAddress
}

$failures = @()

function Add-Failure([string]$Message) {
  $script:failures += $Message
  Write-Host "FAIL: $Message" -ForegroundColor Red
}

function Add-Pass([string]$Message) {
  Write-Host "OK:   $Message" -ForegroundColor Green
}

function Test-LoginCsrf([string]$BaseUrl, [string]$Label) {
  $loginJson = Join-Path $env:TEMP "ic-lan-login.json"
  Set-Content -Path $loginJson -Value '{"username":"lan-health","password":"lan-health"}' -NoNewline -Encoding ascii
  try {
    $login = curl.exe -sS -m 8 -X POST "$BaseUrl/api/auth/login" `
      -H "Content-Type: application/json" `
      -H "Origin: $BaseUrl" `
      --data-binary "@$loginJson" `
      -w "`nHTTP:%{http_code}`n"
    if ($login -match 'CSRF_REJECTED') {
      Add-Failure "$Label login blocked by CSRF"
    } elseif ($login -match 'HTTP:401') {
      Add-Pass "$Label login CSRF accepted"
    } else {
      Add-Failure "$Label unexpected login response: $login"
    }
  } catch {
    Add-Failure "$Label login probe failed: $($_.Exception.Message)"
  } finally {
    Remove-Item -Force $loginJson -ErrorAction SilentlyContinue
  }
}

$gateway = docker ps --filter "name=deploy-gateway-1" --format "{{.Status}}" 2>$null
if (-not $gateway) {
  Add-Failure "deploy-gateway-1 is not running"
} elseif ($gateway -notmatch "healthy") {
  Add-Failure "deploy-gateway-1 status: $gateway"
} else {
  Add-Pass "gateway healthy"
}

$web = docker ps --filter "name=deploy-web-1" --format "{{.Status}}" 2>$null
if (-not $web) {
  Add-Failure "deploy-web-1 is not running"
} elseif ($web -notmatch "healthy") {
  Add-Failure "deploy-web-1 status: $web"
} else {
  Add-Pass "web healthy"
}

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$webPublish = (docker port deploy-web-1 3000/tcp 2>&1) | Out-String
$gatewayPublish = (docker port deploy-gateway-1 8088/tcp 2>&1) | Out-String
$ErrorActionPreference = $prevEap

if ($webPublish -and $webPublish -notmatch "no public port") {
  Add-Failure "web publishes host port 3000 ($webPublish); only gateway should be public"
} else {
  Add-Pass "web is internal-only"
}

if ($gatewayPublish -notmatch ":$Port") {
  Add-Failure "gateway is not listening on port $Port (got: $gatewayPublish)"
} else {
  Add-Pass "gateway listens on $gatewayPublish"
}

$base = "http://127.0.0.1:$Port"
try {
  $rev = Invoke-RestMethod -Uri "$base/build-revision" -TimeoutSec 8
  Add-Pass "build-revision $($rev.revision)"
} catch {
  Add-Failure "build-revision probe failed: $($_.Exception.Message)"
}

$homeProbe = curl.exe -sS -m 8 -I "$base/" -H "Accept-Encoding: gzip" 2>&1 | Out-String
if ($homeProbe -match "content-encoding:\s*gzip") {
  Add-Pass "gzip enabled on HTML"
} else {
  Add-Failure "gzip missing on HTML response"
}

Test-LoginCsrf -BaseUrl $base -Label "loopback"
if ($LanIp) {
  Test-LoginCsrf -BaseUrl "http://${LanIp}:$Port" -Label "LAN $LanIp"
}

$projectsProbe = curl.exe -sS -m 8 -I "$base/api/projects?page=1&pageSize=50" 2>&1 | Out-String
if ($projectsProbe -match "HTTP/1\.1 301|HTTP/1\.1 308") {
  if ($projectsProbe -match ":8088") {
    Add-Failure "projects API redirects to internal port 8088"
  } else {
    Add-Failure "projects API returns redirect ($projectsProbe)"
  }
} elseif ($projectsProbe -match "HTTP/1\.1 (200|401)") {
  Add-Pass "projects API reachable without bad redirect"
} else {
  Add-Failure "projects API probe unexpected: $projectsProbe"
}

if ($failures.Count -gt 0) {
  Write-Host ""
  Write-Host "LAN health check failed ($($failures.Count) issue(s))." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "LAN health check passed." -ForegroundColor Green
if ($LanIp) {
  Write-Host "Share with peers: http://${LanIp}:$Port/"
}
exit 0
