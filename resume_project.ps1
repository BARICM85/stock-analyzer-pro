$ErrorActionPreference = "Stop"

$projectRoot = "C:\Temp\stock-analyzer-pro"
$backendPath = Join-Path $projectRoot "backend"

Write-Host "Starting Stock Analyzer Pro..." -ForegroundColor Cyan

if (-not (Test-Path $projectRoot)) {
  Write-Host "Project not found: $projectRoot" -ForegroundColor Red
  exit 1
}

Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backendPath'; if (Test-Path '.\.venv\Scripts\Activate.ps1') { . .\.venv\Scripts\Activate.ps1 }; uvicorn app.main:app --reload --port 8000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$projectRoot'; npm run dev"

Write-Host "Backend: http://localhost:8000" -ForegroundColor Green
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Green
Write-Host "Docs: http://localhost:8000/docs" -ForegroundColor Green
