# Registers the on-demand scheduled task "BuildFlow update" that runs deploy\update.ps1
# in the interactive session of the current user. Run once on the server, as Administrator.
#
# Why: docker build needs Windows Credential Manager, which an SSH session with key
# authentication cannot reach. The task runs in the logged-on desktop session instead.
# The task has no trigger; it runs only when started:
#   Start-ScheduledTask "BuildFlow update"
# Output goes to %USERPROFILE%\buildflow-update.log.
# Remove with: Unregister-ScheduledTask "BuildFlow update"

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$log = Join-Path $env:USERPROFILE 'buildflow-update.log'
$update = Join-Path $PSScriptRoot 'update.ps1'

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -WorkingDirectory $repo `
  -Argument "/c powershell -NoProfile -ExecutionPolicy Bypass -File `"$update`" > `"$log`" 2>&1"
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName 'BuildFlow update' -Action $action -Principal $principal `
  -Settings $settings -Force | Out-Null
Get-ScheduledTask 'BuildFlow update' | Format-Table TaskName, State -AutoSize
