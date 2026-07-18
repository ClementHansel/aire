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
#   -Token        (required) the branch bridge pairing token from the dashboard
#   -CloudUrl     the Aire cloud URL (default https://app.useairin.id)
#   -Simulate     install in hardware-free demo mode (ffmpeg test source)
#   -Webcam       demo mode: relay THIS PC's built-in webcam as a camera. Makes
#                 ffmpeg mandatory. Pair with the "Use this PC's webcam" toggle in
#                 the dashboard (which registers a `webcam:` camera on this bridge).
#   -WebcamDevice pin the capture device name (else auto-detected). Windows dshow
#                 name, e.g. "Integrated Camera".
#   -MqttUrl      local MQTT broker for bay controllers (default mqtt://localhost:1883)
#   -InstallDir   install location (default %ProgramData%\AireBranchBridge)
# =============================================================================
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$CloudUrl = 'https://app.useairin.id',
  [switch]$Simulate,
  [switch]$Webcam,
  [string]$WebcamDevice = '',
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

# Pinned portable-runtime downloads used when the branch PC lacks them. These
# make the installer turnkey on a bare Windows PC (no manual Node/ffmpeg step).
$NODE_VERSION = 'v20.18.1'
$NODE_URL = "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-win-x64.zip"
$FFMPEG_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'

function Download-And-Extract($url, $dest) {
  $tmpZip = Join-Path $env:TEMP ("aire-dl-" + [Guid]::NewGuid().ToString('N') + '.zip')
  Write-Host "  downloading $url ..."
  $old = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
  try { Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing } finally { $ProgressPreference = $old }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Expand-Archive -Path $tmpZip -DestinationPath $dest -Force
  Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
}

function Resolve-Node {
  # 1) A node already on PATH (>=18) wins. 2) A previously bundled portable node.
  # 3) Otherwise download a portable Node into the install dir — no manual step.
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) {
    $ver = (& node --version).TrimStart('v')
    if ([int]($ver.Split('.')[0]) -ge 18) { return $cmd.Source }
    Write-Warning "Found Node $ver (<18); downloading a portable Node $NODE_VERSION instead."
  }
  $portable = Join-Path $InstallDir "node\node-$NODE_VERSION-win-x64\node.exe"
  if (Test-Path $portable) { return $portable }
  Write-Host "Node.js not found — fetching a portable runtime ($NODE_VERSION)..."
  Download-And-Extract $NODE_URL (Join-Path $InstallDir 'node')
  if (-not (Test-Path $portable)) { throw "Failed to provision a portable Node.js (download/extract). Install Node 18+ manually and re-run." }
  return $portable
}

function Resolve-Ffmpeg {
  # ffmpeg is REQUIRED for any live/recorded CCTV. Prefer a bundled/​PATH copy,
  # else auto-download a static build so CCTV works without a manual step.
  $bundled = Join-Path $Source 'ffmpeg\ffmpeg.exe'
  if (Test-Path $bundled) { return $bundled }
  $installed = Join-Path $InstallDir 'ffmpeg\ffmpeg.exe'
  if (Test-Path $installed) { return $installed }
  $onPath = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  Write-Host "ffmpeg not found — fetching a static build (needed for CCTV)..."
  try {
    $tmp = Join-Path $InstallDir 'ffmpeg-dl'
    Download-And-Extract $FFMPEG_URL $tmp
    $exe = Get-ChildItem -Path $tmp -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
    if (-not $exe) { throw "ffmpeg.exe not found in the downloaded archive." }
    New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'ffmpeg') | Out-Null
    # Copy ffmpeg + ffprobe (channel probing uses ffprobe) next to each other.
    Copy-Item $exe.FullName -Destination (Join-Path $InstallDir 'ffmpeg\ffmpeg.exe') -Force
    $probe = Get-ChildItem -Path $tmp -Recurse -Filter 'ffprobe.exe' | Select-Object -First 1
    if ($probe) { Copy-Item $probe.FullName -Destination (Join-Path $InstallDir 'ffmpeg\ffprobe.exe') -Force }
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    return (Join-Path $InstallDir 'ffmpeg\ffmpeg.exe')
  } catch {
    if ($Webcam) { throw "ffmpeg is required for -Webcam and auto-download failed: $($_.Exception.Message)" }
    Write-Warning "Could not auto-provision ffmpeg ($($_.Exception.Message)). CCTV will not work until ffmpeg is installed; IoT bay sensors still work."
    return 'ffmpeg'
  }
}

Write-Host "== Aire Branch Bridge installer ==" -ForegroundColor Cyan
Assert-Admin

# Create the install dir up front so Node/ffmpeg can be provisioned into it.
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$nodePath = Resolve-Node
$ffmpegPath = Resolve-Ffmpeg
Write-Host "Node:   $nodePath"
Write-Host "ffmpeg: $ffmpegPath"

# --- Copy the agent into the install dir ---
Write-Host "Installing to $InstallDir ..."
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
  cloudUrl     = $CloudUrl
  token        = $Token
  simulate     = [bool]$Simulate
  mqttUrl      = $MqttUrl
  ffmpegPath   = $ffmpegPath
  healthPort   = $HealthPort
  nodePath     = $nodePath
  webcamDevice = $WebcamDevice
}
$config | ConvertTo-Json | Set-Content -Path (Join-Path $InstallDir 'config.json') -Encoding UTF8
Write-Host "Wrote config.json (cloud=$CloudUrl simulate=$([bool]$Simulate) webcam=$([bool]$Webcam))."

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
