$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $projectRoot
# Install the official Ollama Windows application; review the installer normally.
winget install --id Ollama.Ollama --exact --source winget
if ($LASTEXITCODE -ne 0) { throw 'Instale o Ollama em https://ollama.com/download/windows e execute este passo novamente.' }
$ollamaExe = Join-Path $env:LOCALAPPDATA 'Programs/Ollama/ollama.exe'
& $ollamaExe pull qwen3-vl:4b-instruct
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível baixar o modelo. Abra o Ollama e tente novamente.' }
New-Item -ItemType Directory -Force '.codex-local' | Out-Null
$tokenPath = Join-Path $projectRoot '.codex-local/vision-token'
if (-not (Test-Path -LiteralPath $tokenPath)) {
  $bytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  [IO.File]::WriteAllText($tokenPath, [Convert]::ToBase64String($bytes))
  $rng.Dispose()
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  icacls $tokenPath /inheritance:r /grant:r "${identity}:(F)" 'SYSTEM:(F)' | Out-Null
}
Write-Host 'Modelo instalado. Token salvo em arquivo privado; não compartilhe seu conteúdo.'
