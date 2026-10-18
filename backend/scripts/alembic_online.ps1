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
    * opens a READ-ONLY preflight connection first, reports the server version
      and the number of tables in `public`, and aborts before any DDL if the
      database is not empty;
    * redacts every postgres:// / postgresql:// URL from the output before
      printing it;
    * removes DATABASE_URL from the environment when it finishes, even on error.

    It never writes the URL to disk and never prints it.

    Note: clearing a .NET string in PowerShell is not guaranteed. The helper
    removes the environment variable, drops the references and zeroes the BSTR,
    which is the cleanup PowerShell can actually offer.

.PARAMETER ExpectHost
    Endpoint prefix that the URL host must start with. Defaults to the endpoint
    of the Neon branch ritmo-online-migration-validation.

.PARAMETER DryRun
    Only validate and print the target host (no credentials), then exit.

.PARAMETER AllowNonEmpty
    Skip the "database must be empty" rule. Use only when resuming a partially
    applied migration that was already inspected.

.PARAMETER AllowPooler
    Permit a "-pooler" host. Refused by default: the pooler runs in transaction
    mode, which breaks Alembic DDL and psycopg prepared statements. Use the
    direct endpoint from the Neon Connect dialog instead.

.EXAMPLE
    .\scripts\alembic_online.ps1
#>
[CmdletBinding()]
param(
    [string]$ExpectHost = 'ep-lucky-unit-b8tr5lts',
    [switch]$DryRun,
    [switch]$AllowNonEmpty,
    [switch]$AllowPooler
)

$ErrorActionPreference = 'Stop'

$script:Transcript = Join-Path $env:TEMP 'ritmo-alembic-online.log'

function Write-TranscriptLine {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return }
    # Only redacted text ever reaches this file.
    Add-Content -LiteralPath $script:Transcript -Value $Text -Encoding utf8
}

function Redact-ConnectionStrings {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return $Text }
    # Redact scheme://user:pass@host and any bare URL that carries credentials.
    $pattern = '(?i)(postgres(?:ql)?(?:\+psycopg)?://)[^\s''"`]+'
    return [regex]::Replace($Text, $pattern, '$1<redacted>')
}

function Invoke-Python {
    param(
        [string]$Label,
        [string[]]$Arguments,
        [string]$Stdin
    )

    Write-Host ""
    Write-Host "== $Label ==" -ForegroundColor Cyan

    # Alembic writes INFO lines to stderr. In Windows PowerShell 5.1 a native
    # command writing to stderr with $ErrorActionPreference = 'Stop' raises
    # NativeCommandError and aborts the step, and 2>&1 still emits a noisy
    # error block. Start-Process with file redirection avoids both problems
    # and gives a reliable exit code.
    $base = Join-Path $env:TEMP ("ritmo-alembic-" + [guid]::NewGuid().ToString('N'))
    $outFile = "$base.out"
    $errFile = "$base.err"
    $inFile = "$base.in"

    $hasStdin = $null -ne $Stdin
    if ($hasStdin) {
        Set-Content -LiteralPath $inFile -Value $Stdin -Encoding utf8
    }

    try {
        $params = @{
            FilePath               = $script:Python
            ArgumentList           = $Arguments
            NoNewWindow            = $true
            Wait                   = $true
            PassThru               = $true
            RedirectStandardOutput = $outFile
            RedirectStandardError  = $errFile
        }
        if ($hasStdin) {
            $params.RedirectStandardInput = $inFile
        }

        $proc = Start-Process @params
        $code = $proc.ExitCode

        $stdout = ''
        if (Test-Path -LiteralPath $outFile) {
            $stdout = Get-Content -LiteralPath $outFile -Raw -ErrorAction SilentlyContinue
        }
        $stderr = ''
        if (Test-Path -LiteralPath $errFile) {
            $stderr = Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue
        }
    }
    finally {
        Remove-Item -LiteralPath $outFile, $errFile, $inFile -ErrorAction SilentlyContinue
    }

    $combined = (@($stdout, $stderr) | Where-Object { $_ }) -join "`n"
    $safe = Redact-ConnectionStrings -Text $combined
    if ($safe.Trim()) {
        Write-Host $safe.TrimEnd()
        Write-TranscriptLine "[$Label]"
        Write-TranscriptLine $safe.TrimEnd()
    }

    return [pscustomobject]@{ Ok = ($code -eq 0); Output = $safe; Code = $code }
}

$backend = Split-Path -Parent $PSScriptRoot
$python = Join-Path $backend '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $python)) {
    throw "Python venv not found at $python"
}

$script:Python = $python

$preflightScript = @'
import os
import sys

import psycopg

url = os.environ.get("DATABASE_URL", "")
if not url:
    print("PREFLIGHT_FAIL: DATABASE_URL missing")
    sys.exit(2)

try:
    conn = psycopg.connect(
        url,
        connect_timeout=20,
        options="-c default_transaction_read_only=on",
    )
except Exception as exc:
    print("PREFLIGHT_FAIL:", type(exc).__name__)
    sys.exit(3)

with conn:
    with conn.cursor() as cur:
        cur.execute("select version()")
        print("PG_VERSION:", cur.fetchone()[0].split(",")[0])
        cur.execute("select current_database(), current_user")
        database, role = cur.fetchone()
        print("DATABASE:", database)
        print("ROLE:", role)
        cur.execute(
            "select count(*) from information_schema.tables "
            "where table_schema = 'public'"
        )
        tables = cur.fetchone()[0]
        print("PUBLIC_TABLES:", tables)
        cur.execute("select to_regclass('public.users') is not null")
        has_users = cur.fetchone()[0]
        print("HAS_USERS_TABLE:", has_users)
        if has_users:
            cur.execute("select count(*) from public.users")
            print("USERS_ROWS:", cur.fetchone()[0])
        cur.execute("select to_regclass('public.alembic_version') is not null")
        print("HAS_ALEMBIC_VERSION:", cur.fetchone()[0])

print("PREFLIGHT_OK")
'@

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

    if ($uri.Host -like '*-pooler*' -and -not $AllowPooler) {
        throw ("Refusing to run: '$($uri.Host)' is the pooler endpoint. " +
            'The pooler uses transaction mode, which breaks Alembic DDL. ' +
            'Copy the direct endpoint (without -pooler) from the Neon Connect dialog.')
    }

    if ([string]::IsNullOrWhiteSpace($uri.UserInfo)) {
        throw 'Refusing to run: the URL has no credentials, so it is not a database connection string.'
    }

    Write-Host "Resolved host: $($uri.Host)"
    Write-Host "Database: $($uri.AbsolutePath.TrimStart('/'))"

    if ($DryRun) {
        Write-Host "Dry run: no connection opened, no migration executed."
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

    $pre = Invoke-Python -Label 'preflight (read-only)' -Arguments @('-') -Stdin $preflightScript

    if (-not $pre.Ok) {
        throw 'Preflight connection failed. Nothing was changed.'
    }

    if ($pre.Output -notmatch 'PREFLIGHT_OK') {
        throw 'Preflight did not finish cleanly. Nothing was changed.'
    }

    $tablesMatch = [regex]::Match($pre.Output, 'PUBLIC_TABLES:\s*(\d+)')
    if (-not $tablesMatch.Success) {
        throw 'Preflight did not report a table count. Nothing was changed.'
    }

    $tables = [int]$tablesMatch.Groups[1].Value
    if ($tables -gt 0 -and -not $AllowNonEmpty) {
        Write-Host ""
        Write-Host "Refusing to migrate: the target already has $tables table(s) in public." -ForegroundColor Yellow
        Write-Host "This run expects an empty validation branch. Nothing was changed." -ForegroundColor Yellow
        Write-Host "Inspect the branch, then rerun with -AllowNonEmpty only if that is expected." -ForegroundColor Yellow
        return
    }

    Write-Host ""
    Write-Host "Preflight passed: empty target, read-only connection." -ForegroundColor Green

    $upgrade = Invoke-Python -Label 'alembic upgrade head' -Arguments @('-m', 'alembic', 'upgrade', 'head')
    $current = $null
    $check = $null

    if ($upgrade.Ok) {
        $current = Invoke-Python -Label 'alembic current' -Arguments @('-m', 'alembic', 'current')
        $check = Invoke-Python -Label 'alembic check' -Arguments @('-m', 'alembic', 'check')
    }

    Write-Host ""
    if ($upgrade.Ok -and $current -and $current.Ok) {
        Write-Host 'SUCCESS: alembic upgrade head completed.' -ForegroundColor Green
        Write-Host 'Expected head: a1c4e9f7b2d5' -ForegroundColor Green
        if ($check -and -not $check.Ok) {
            Write-Host 'Note: alembic check reported drift; review the output above.' -ForegroundColor Yellow
        }
    }
    else {
        Write-Host 'FAILED: alembic did not finish cleanly. Review the redacted output above.' -ForegroundColor Red
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
