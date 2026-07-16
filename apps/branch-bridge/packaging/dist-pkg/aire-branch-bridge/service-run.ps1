# =============================================================================
# Aire Branch Bridge - service runner (invoked by the Scheduled Task).
# Reads config.json next to the install, exports the AIRE_* env vars, then runs
# the agent in the foreground. The Scheduled Task keeps it alive / restarts it.
# Not meant to be run by hand (use install.ps1). Logs to logs\agent.log.
# =============================================================================
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $Root 'config.json'
if (-not (Test-Path $configPath)) {
  Write-Error "config.json not found at $configPath - run install.ps1 first."
  exit 1
}

$cfg = Get-Content $configPath -Raw | ConvertFrom-Json

$env:AIRE_CLOUD_URL   = $cfg.cloudUrl
$env:AIRE_BRIDGE_TOKEN = $cfg.token
$env:AIRE_SIMULATE    = if ($cfg.simulate) { 'true' } else { 'false' }
if ($cfg.mqttUrl)   { $env:AIRE_MQTT_URL = $cfg.mqttUrl }
if ($cfg.ffmpegPath) { $env:FFMPEG_PATH = $cfg.ffmpegPath }
if ($cfg.healthPort) { $env:BRIDGE_HEALTH_PORT = "$($cfg.healthPort)" }
if ($cfg.webcamDevice) { $env:AIRE_WEBCAM_DEVICE = $cfg.webcamDevice }

# Prefer the node bundled/pinned at install time; fall back to PATH.
$node = if ($cfg.nodePath -and (Test-Path $cfg.nodePath)) { $cfg.nodePath } else { 'node' }

$logDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'agent.log'

Add-Content -Path $log -Encoding utf8 -Value "$(Get-Date -Format o) [service-run] starting agent (simulate=$($env:AIRE_SIMULATE))"

# Run in the foreground; the Scheduled Task's restart policy handles crashes.
# Merge all streams and append as UTF-8 so the log stays human-readable.
& $node (Join-Path $Root 'dist\index.js') 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
$code = $LASTEXITCODE
Add-Content -Path $log -Encoding utf8 -Value "$(Get-Date -Format o) [service-run] agent exited with code $code"
exit $code
