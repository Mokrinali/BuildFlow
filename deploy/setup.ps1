# Creates the production .env for docker-compose with fresh random secrets.
# Works in Windows PowerShell 5.1 and PowerShell 7. Run from the repository root:
#   powershell -ExecutionPolicy Bypass -File deploy\setup.ps1
# Secrets are generated locally and never printed.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'

if (Test-Path $envFile) {
    Write-Host ".env already exists at $envFile - leaving it unchanged." -ForegroundColor Yellow
    Write-Host "Delete it first if you really want to regenerate all secrets (the database password inside must match the existing database)."
    exit 0
}

function New-RandomHex([int]$bytes) {
    $b = New-Object byte[] $bytes
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    return ($b | ForEach-Object { $_.ToString('x2') }) -join ''
}
function New-RandomBase64([int]$bytes) {
    $b = New-Object byte[] $bytes
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    return [Convert]::ToBase64String($b)
}

$url = Read-Host 'Public URL [https://siteflow.win]'
if ([string]::IsNullOrWhiteSpace($url)) { $url = 'https://siteflow.win' }
if ($url -notmatch '^https://') { throw 'The public URL must start with https://' }

Write-Host ''
Write-Host 'Paste the Cloudflare Tunnel token (input is hidden), then press Enter.'
$secure = Read-Host 'Tunnel token' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$token = $token.Trim()
if ($token.Length -lt 50) { throw 'The tunnel token looks too short. Copy the whole token from Cloudflare.' }

$lines = @(
    '# BuildFlow production settings. Never commit or share this file.',
    "POSTGRES_PASSWORD=$(New-RandomHex 24)",
    "BETTER_AUTH_SECRET=$(New-RandomBase64 32)",
    "BETTER_AUTH_URL=$url",
    "CLOUDFLARE_TUNNEL_TOKEN=$token"
)
# UTF-8 without BOM (a BOM would corrupt the first variable name for docker compose).
[IO.File]::WriteAllText($envFile, ($lines -join "`n") + "`n", (New-Object Text.UTF8Encoding($false)))

Write-Host ''
Write-Host "Created $envFile" -ForegroundColor Green
Write-Host "  BETTER_AUTH_URL = $url"
Write-Host '  POSTGRES_PASSWORD, BETTER_AUTH_SECRET: generated'
Write-Host '  CLOUDFLARE_TUNNEL_TOKEN: saved'
Write-Host ''
Write-Host 'Keep a copy of this file somewhere safe (password manager). Without it the database backups'
Write-Host 'still restore, but sessions are invalidated and the tunnel must be reconnected.'
