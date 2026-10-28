param(
    [string]$CliHome = (Join-Path (Split-Path $PSScriptRoot -Parent) "data\codex-cli-home")
)

$resolvedHome = [System.IO.Path]::GetFullPath($CliHome)
New-Item -ItemType Directory -Force -Path $resolvedHome | Out-Null

$env:HOME = $env:USERPROFILE
$env:CODEX_HOME = $resolvedHome

Write-Host "Isolated Codex CLI home: $resolvedHome"
Write-Host "The Codex desktop app uses its own profile and is not modified by this script."

if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
    Write-Error "Codex CLI was not found on PATH. Install it, open a new terminal, and try again."
    exit 127
}

& codex login
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

& codex login status
exit $LASTEXITCODE
