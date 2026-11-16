# Creates a PostgreSQL backup in .\backups and deletes backups older than -KeepDays.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File D:\path\to\BuildFlow\deploy\backup.ps1
# Suitable for Windows Task Scheduler (see DEPLOY.md).

param([int]$KeepDays = 30)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$dir = Join-Path (Get-Location) 'backups'
New-Item -ItemType Directory -Force $dir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$name = "buildflow-$stamp.dump"

# Dump inside the container, then copy the file out (avoids binary corruption in PowerShell pipes).
docker compose exec -T db pg_dump -U buildflow -d buildflow -Fc -f "/tmp/$name"
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit code $LASTEXITCODE)" }
docker compose cp "db:/tmp/$name" (Join-Path $dir $name)
if ($LASTEXITCODE -ne 0) { throw "copy failed (exit code $LASTEXITCODE)" }
docker compose exec -T db rm -f "/tmp/$name" | Out-Null

$file = Get-Item (Join-Path $dir $name)
if ($file.Length -lt 1024) { throw "Backup looks empty: $($file.FullName)" }
Write-Host ("Backup created: {0} ({1:N0} KB)" -f $file.FullName, ($file.Length / 1KB)) -ForegroundColor Green

Get-ChildItem $dir -Filter 'buildflow-*.dump' |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
    ForEach-Object { Remove-Item $_.FullName -Force; Write-Host "Deleted old backup $($_.Name)" }
