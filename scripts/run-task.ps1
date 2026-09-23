param(
    [Parameter(Mandatory=$true)]
    [string]$TaskFile
)

if (-not (Test-Path $TaskFile)) {
    Write-Error "Task file not found: $TaskFile"
    exit 1
}

$taskId = [System.IO.Path]::GetFileNameWithoutExtension($TaskFile)
$logFile = "logs\$taskId.json"

Write-Host "=== Running $taskId ===" -ForegroundColor Cyan
Write-Host "Task file: $TaskFile" -ForegroundColor Gray

$prompt = Get-Content $TaskFile -Raw
gemini --prompt $prompt --output-format json | Out-File -FilePath $logFile -Encoding utf8

Write-Host "=== $taskId complete ===" -ForegroundColor Green
Write-Host "Output: $logFile" -ForegroundColor Gray
Write-Host "Next: run tests, review diff, commit." -ForegroundColor Yellow