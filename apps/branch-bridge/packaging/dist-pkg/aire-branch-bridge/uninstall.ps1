# =============================================================================
# Aire Branch Bridge - Windows uninstaller. Run elevated.
#   .\uninstall.ps1              # stop + remove the service task (keeps files)
#   .\uninstall.ps1 -Purge       # also delete the install directory
# =============================================================================
[CmdletBinding()]
param(
  [switch]$Purge,
  [string]$InstallDir = (Join-Path $env:ProgramData 'AireBranchBridge')
)
$ErrorActionPreference = 'SilentlyContinue'
$TaskName = 'AireBranchBridge'

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$p = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "Run this uninstaller as Administrator."; exit 1
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task '$TaskName'." -ForegroundColor Green
} else {
  Write-Host "Task '$TaskName' was not installed."
}

# Best-effort: kill any running agent node process from this install.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like "*AireBranchBridge*dist\index.js*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

if ($Purge -and (Test-Path $InstallDir)) {
  Remove-Item $InstallDir -Recurse -Force
  Write-Host "Deleted $InstallDir." -ForegroundColor Green
}
