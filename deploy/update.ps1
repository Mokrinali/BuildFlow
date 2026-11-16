# Pulls the latest code from GitHub and rebuilds/restarts the stack.
# A backup is taken first. Run from the repository root:
#   powershell -ExecutionPolicy Bypass -File deploy\update.ps1

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

& (Join-Path $PSScriptRoot 'backup.ps1')

git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'git pull failed' }

docker compose up -d --build
if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed' }

docker image prune -f | Out-Null
docker compose ps
