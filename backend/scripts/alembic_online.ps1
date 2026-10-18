<#
.SYNOPSIS
    Run Alembic online against the Neon validation branch without exposing the
    connection string.

.DESCRIPTION
    The PostgreSQL URL is a secret. This helper:

    * reads it with Read-Host -AsSecureString (no echo, no arguments);
    * keeps it only in this process' memory and in $env:DATABASE_URL for the
      duration of the child processes;
    * refuses any host other than the validation branch endpoint, so it cannot
      accidentally migrate the staging "main" branch or a production database;
    * redacts every postgres:// / postgresql:// URL from the output before
      printing it;
    * removes DATABASE_URL from the environment when it finishes, even on error.

    It never writes the URL to disk and never prints it.

.PARAMETER ExpectHost
    Endpoint prefix that the URL host must start with. Defaults to the endpoint
    of the Neon branch ritmo-online-migration-validation.

.PARAMETER DryRun
    Only print the target host (no credentials) and exit without running Alembic.

.EXAMPLE
    .\scripts\alembic_online.ps1
#>
[CmdletBinding()]
param(
    [string]$ExpectHost = 'ep-lucky-unit-b8tr5lts',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Redact-ConnectionStrings {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return $Text }
    # Redact scheme://user:pass@host and any bare URL that carries credentials.
    $pattern = '(?i)(postgres(?:ql)?(?:\+psycopg)?://)[^\s''"`]+'
    return [regex]::Replace($Text, $pattern, '$1<redacted>')
}

function Invoke-Step {
    param(
        [string]$Label,
        [string[]]$Arguments
    )

    Write-Host ""
    Write-Host "== $Label ==" -ForegroundColor Cyan

    $output = & $script:Python -m @Arguments 2>&1 | Out-String
    $code = $LASTEXITCODE

    $safe = Redact-ConnectionStrings -Text $output
    if ($safe.Trim()) { Write-Host $safe.TrimEnd() }

    if ($code -ne 0) {
        Write-Host "$Label failed with exit code $code" -ForegroundColor Red
        return $false
    }
    return $true
}

$backend = Split-Path -Parent $PSScriptRoot
$python = Join-Path $backend '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $python)) {
    throw "Python venv not found at $python"
}

$script:Python = $python

Write-Host "Target: Alembic online migration"
Write-Host "This will run against the PostgreSQL host starting with '$ExpectHost'."
Write-Host ""

$secure = Read-Host -Prompt 'Paste the DATABASE_URL for the validation branch (input is hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)

try {
    $url = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

try {
    if ([string]::IsNullOrWhiteSpace($url)) {
        throw 'No URL provided.'
    }

    $uri = $null
    if (-not [Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$uri)) {
        throw 'The value is not a valid absolute URL.'
    }

    if ($uri.Scheme -notin @('postgres', 'postgresql')) {
        throw "Unexpected scheme '$($uri.Scheme)'. Expected postgres or postgresql."
    }

    if (-not $uri.Host.StartsWith($ExpectHost, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to run: host does not match the validation branch endpoint ($ExpectHost)."
    }

    if ([string]::IsNullOrWhiteSpace($uri.UserInfo)) {
        throw 'Refusing to run: the URL has no credentials, so it is not a database connection string.'
    }

    Write-Host "Resolved host: $($uri.Host)"
    Write-Host "Database: $($uri.AbsolutePath.TrimStart('/'))"

    if ($DryRun) {
        Write-Host "Dry run: no migration executed."
        return
    }

    # Environment variables take precedence over backend/.env in
    # pydantic-settings, so this overrides the local SQLite default.
    $env:DATABASE_URL = $url
    $env:RITMO_DEBUG = 'false'
    $env:ALLOW_INSECURE_NO_ACCESS_TOKEN = 'false'
    $env:CORS_ORIGINS = 'https://example.invalid'
    if (-not $env:APP_ACCESS_TOKEN) {
        $env:APP_ACCESS_TOKEN = 'online-migration-validation'
    }

    $ok = Invoke-Step -Label 'alembic upgrade head' -Arguments @('alembic', 'upgrade', 'head')
    if ($ok) {
        $ok = Invoke-Step -Label 'alembic current' -Arguments @('alembic', 'current')
    }
    if ($ok) {
        # `alembic check` needs the revision table to be at head; it reports
        # model/schema drift and exits non-zero when differences exist.
        Invoke-Step -Label 'alembic check' -Arguments @('alembic', 'check') | Out-Null
    }

    Write-Host ""
    if ($ok) {
        Write-Host 'Done. Expected head: a1c4e9f7b2d5' -ForegroundColor Green
    }
    else {
        Write-Host 'Alembic did not finish cleanly. Review the redacted output above.' -ForegroundColor Red
    }
}
finally {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:RITMO_DEBUG -ErrorAction SilentlyContinue
    Remove-Item Env:ALLOW_INSECURE_NO_ACCESS_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:CORS_ORIGINS -ErrorAction SilentlyContinue
    $url = $null
    $secure = $null
}
