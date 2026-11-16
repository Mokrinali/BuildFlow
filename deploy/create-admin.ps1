# Creates the organization and its first administrator inside the running stack.
# Run from the repository root after `docker compose up -d`:
#   powershell -ExecutionPolicy Bypass -File deploy\create-admin.ps1
# The password is read hidden and passed to the container through an environment variable,
# so it does not appear in the command line or shell history.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$org = Read-Host 'Organization name'
$name = Read-Host 'Admin full name'
$email = Read-Host 'Admin email (login)'
$p1 = Read-Host 'Password (min 10 characters)' -AsSecureString
$p2 = Read-Host 'Repeat password' -AsSecureString

function ConvertTo-Plain($s) {
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($b) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
$pw = ConvertTo-Plain $p1
if ($pw -ne (ConvertTo-Plain $p2)) { throw 'Passwords do not match.' }
if ($pw.Length -lt 10) { throw 'Password must be at least 10 characters.' }

$env:ADMIN_ORG_NAME = $org
$env:ADMIN_NAME = $name
$env:ADMIN_EMAIL = $email
$env:ADMIN_PASSWORD = $pw
try {
    docker compose run --rm --no-deps `
        -e ADMIN_ORG_NAME -e ADMIN_NAME -e ADMIN_EMAIL -e ADMIN_PASSWORD `
        migrate node node_modules/tsx/dist/cli.mjs scripts/create-admin.ts
    if ($LASTEXITCODE -ne 0) { throw "create-admin failed (exit code $LASTEXITCODE)" }
}
finally {
    Remove-Item Env:ADMIN_PASSWORD, Env:ADMIN_EMAIL, Env:ADMIN_NAME, Env:ADMIN_ORG_NAME -ErrorAction SilentlyContinue
}
