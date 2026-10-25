$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $python)) {
    Write-Error "Project Python environment not found at '$python'. Install dependencies first with: python -m pip install -r requirements.txt"
}

Set-Location -LiteralPath $projectRoot
Write-Host 'Starting Office Hours Prep at http://127.0.0.1:8000'
Write-Host 'Press Ctrl+C to stop the server.'
& $python -m uvicorn app.main:app --reload
exit $LASTEXITCODE
