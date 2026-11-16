# Restores a backup created by backup.ps1. REPLACES all current data.
#   powershell -ExecutionPolicy Bypass -File deploy\restore.ps1 -File backups\buildflow-YYYYMMDD-HHmmss.dump

param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$path = Resolve-Path $File
Write-Host "This will REPLACE all BuildFlow data with: $path" -ForegroundColor Yellow
$answer = Read-Host 'Type RESTORE to continue'
if ($answer -ne 'RESTORE') { Write-Host 'Cancelled.'; exit 1 }

# Stop the app so nobody writes during the restore. The database keeps running.
docker compose stop cloudflared app
docker compose cp $path db:/tmp/restore.dump
docker compose exec -T db pg_restore -U buildflow -d buildflow --clean --if-exists --no-owner /tmp/restore.dump
$code = $LASTEXITCODE
docker compose exec -T db rm -f /tmp/restore.dump | Out-Null
docker compose start app cloudflared
if ($code -ne 0) { throw "pg_restore reported errors (exit code $code). Check the output above." }
Write-Host 'Restore finished and the app was restarted.' -ForegroundColor Green
