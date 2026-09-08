param([string]$ImagePath)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$token = [IO.File]::ReadAllText((Resolve-Path '.codex-local/vision-token')).Trim()
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod 'http://127.0.0.1:11435/health' -Headers $headers | Format-List
if ($ImagePath) {
  $elapsed = [Diagnostics.Stopwatch]::StartNew()
  try {
    $result = Invoke-RestMethod 'http://127.0.0.1:11435/recognize' -Method Post -ContentType 'image/jpeg' -Headers $headers -InFile (Resolve-Path -LiteralPath $ImagePath) -TimeoutSec 100
    $result | ConvertTo-Json -Depth 5
  } catch {
    Write-Host 'Falha na analise:'
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    else { Write-Host $_.Exception.Message }
  } finally {
    $elapsed.Stop()
    Write-Host "Tempo: $([Math]::Round($elapsed.Elapsed.TotalSeconds, 1)) segundos"
  }
}
Remove-Variable token,headers
