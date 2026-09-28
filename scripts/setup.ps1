[CmdletBinding()]
param(
    [switch]$Start,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Help) {
    Write-Host @"
Usage: powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1 [-Start]

Install project dependencies and build Folio OCR on Windows.
Requires Node.js 22+ with npm and internet access. Installs uv if missing;
uv automatically downloads Python 3.12 when needed.

  -Start  Start the app at http://127.0.0.1:8000 after setup
  -Help   Show this help
"@
    exit 0
}

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE. Fix the error above and run setup again."
    }
}

Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    $Node = Get-Command node.exe -ErrorAction SilentlyContinue
    $Npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $Node -or -not $Npm) {
        throw "Install Node.js 22+ from https://nodejs.org/ (or run: winget install --id OpenJS.NodeJS.LTS -e), reopen PowerShell, and retry."
    }
    & $Node.Source -e 'process.exit(parseInt(process.versions.node) >= 22 ? 0 : 1)'
    if ($LASTEXITCODE -ne 0) {
        throw "Node.js 22 or newer is required. Upgrade Node.js and retry."
    }

    $UvCommand = Get-Command uv.exe -ErrorAction SilentlyContinue
    $Uv = Join-Path $HOME ".local\bin\uv.exe"
    if ($UvCommand) {
        $Uv = $UvCommand.Source
    } elseif (-not (Test-Path $Uv)) {
        Write-Host "Installing uv from https://astral.sh/uv/install.ps1 ..."
        $PreviousInstallDir = $env:UV_INSTALL_DIR
        $PreviousModifyPath = $env:UV_NO_MODIFY_PATH
        $Installer = Join-Path ([System.IO.Path]::GetTempPath()) ("folio-uv-" + [guid]::NewGuid().ToString("N") + ".ps1")
        try {
            $env:UV_INSTALL_DIR = Split-Path -Parent $Uv
            $env:UV_NO_MODIFY_PATH = "1"
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -UseBasicParsing -Uri "https://astral.sh/uv/install.ps1" -OutFile $Installer
            Invoke-Checked "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $Installer)
        } finally {
            $env:UV_INSTALL_DIR = $PreviousInstallDir
            $env:UV_NO_MODIFY_PATH = $PreviousModifyPath
            Remove-Item $Installer -ErrorAction SilentlyContinue
        }
    }

    Write-Host "Installing Python dependencies from uv.lock ..."
    Invoke-Checked $Uv @("sync", "--locked", "--dev")
    Write-Host "Installing frontend dependencies from package-lock.json ..."
    Invoke-Checked $Npm.Source @("--prefix", "frontend", "ci", "--include=dev")
    Write-Host "Building the frontend ..."
    Invoke-Checked $Npm.Source @("--prefix", "frontend", "run", "build")

    Write-Host ""
    Write-Host "Setup complete. OCR models download when first needed."
    if ($Start) {
        Write-Host "Starting http://127.0.0.1:8000 - press Ctrl+C to stop."
        Invoke-Checked $Uv @("run", "--no-sync", "python", "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000")
    } else {
        Write-Host "From the project directory, start the app with:"
        Write-Host "  & `"$Uv`" run --no-sync python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"
    }
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    Pop-Location
}
