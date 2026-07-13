# =============================================================================
# Aire Branch Bridge - Windows installer (no Docker required).
#
# Installs the on-prem bridge agent as an auto-starting, auto-restarting
# background Scheduled Task (runs as SYSTEM, survives logout + reboot). Run from
# the extracted installer folder in an ELEVATED PowerShell:
#
#   .\install.ps1 -Token "<pairing-token>" -CloudUrl "https://app.useairin.id"
#
# Options:
#   -Token       (required) the branch bridge pairing token from the dashboard
#   -CloudUrl    the Aire cloud URL (default https://app.useairin.id)
#   -Simulate    install in hardware-free demo mode (ffmpeg test source)
#   -MqttUrl     local MQTT broker for bay controllers (default mqtt://localhost:1883)
#   -InstallDir  install location (default %ProgramData%\AireBranchBridge)
# =============================================================================
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$CloudUrl = 'https://app.useairin.id',
  [switch]$Simulate,
  [string]$MqttUrl = 'mqtt://localhost:1883',
  [int]$HealthPort = 4010,
  [string]$InstallDir = (Join-Path $env:ProgramData 'AireBranchBridge')
)
$ErrorActionPreference = 'Stop'
$TaskName = 'AireBranchBridge'
$Source = Split-Path -Parent $MyInvocation.MyCommand.Path

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "This installer must be run as Administrator (right-click PowerShell -> Run as administrator)."
  }
}

function Resolve-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Node.js 18+ was not found. Install it first: winget install OpenJS.NodeJS.LTS  (then re-run this installer)."
  }
  $ver = (& node --version).TrimStart('v')
  if ([int]($ver.Split('.')[0]) -lt 18) { throw "Node.js 18+ required; found $ver." }
  return $cmd.Source
}

function Resolve-Ffmpeg {
  # Prefer a bundled static ffmpeg shipped in the installer, else PATH, else warn.
  $bundled = Join-Path $Source 'ffmpeg\ffmpeg.exe'
  if (Test-Path $bundled) { return $bundled }
  $onPath = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  Write-Warning "ffmpeg not found. Live/recorded CCTV will not work until it is installed (winget install Gyan.FFmpeg). IoT bay sensors work without it."
  return 'ffmpeg'
}

Write-Host "== Aire Branch Bridge installer ==" -ForegroundColor Cyan
Assert-Admin
$nodePath = Resolve-Node
$ffmpegPath = Resolve-Ffmpeg
Write-Host "Node:   $nodePath"
Write-Host "ffmpeg: $ffmpegPath"

# --- Copy the agent into the install dir ---
Write-Host "Installing to $InstallDir ..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
foreach ($item in @('dist', 'node_modules', 'package.json', 'package-lock.json', 'ffmpeg')) {
  $src = Join-Path $Source $item
  if (Test-Path $src) {
    Copy-Item $src -Destination $InstallDir -Recurse -Force
  }
}
Copy-Item (Join-Path $Source 'service-run.ps1') -Destination $InstallDir -Force

# If node_modules weren't shipped, install production deps in place.
if (-not (Test-Path (Join-Path $InstallDir 'node_modules'))) {
  Write-Host "Installing production dependencies (npm ci)..."
  Push-Location $InstallDir
  & npm ci --omit=dev --no-audit --no-fund
  Pop-Location
}

# --- Write config.json ---
$config = [ordered]@{
  cloudUrl   = $CloudUrl
  token      = $Token
  simulate   = [bool]$Simulate
  mqttUrl    = $MqttUrl
  ffmpegPath = $ffmpegPath
  healthPort = $HealthPort
  nodePath   = $nodePath
}
$config | ConvertTo-Json | Set-Content -Path (Join-Path $InstallDir 'config.json') -Encoding UTF8
Write-Host "Wrote config.json (cloud=$CloudUrl simulate=$([bool]$Simulate))."

# --- Register the auto-start / auto-restart Scheduled Task (runs as SYSTEM) ---
$runner = Join-Path $InstallDir 'service-run.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999 `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings `
  -Description 'Aire Branch Bridge agent (device discovery + CCTV relay + MQTT bridge)' | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "Installed and started." -ForegroundColor Green
Write-Host "  Health:  http://localhost:$HealthPort/health"
Write-Host "  Logs:    $InstallDir\logs\agent.log"
Write-Host "  Manage:  Task Scheduler -> '$TaskName'  (or .\uninstall.ps1)"
Write-Host "The branch should now show as Online in the Aire dashboard within ~15s."
