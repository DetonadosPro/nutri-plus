param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('ollama','openai-responses','openai-compatible','gemini')]
  [string]$Provider,
  [string]$Model,
  [string]$ApiBaseUrl,
  [string]$ApiKeyFile
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $Model) {
  $Model = if ($Provider -eq 'ollama') { 'qwen3-vl:4b-instruct' } elseif ($Provider -eq 'openai-responses') { 'gpt-5.6-luna' } elseif ($Provider -eq 'gemini') { 'gemini-3.5-flash-lite' } else { throw 'Informe -Model para uma API compatível.' }
}
if ($Provider -eq 'openai-responses' -and -not $ApiBaseUrl) { $ApiBaseUrl = 'https://api.openai.com/v1' }
if ($Provider -eq 'gemini' -and -not $ApiBaseUrl) { $ApiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta' }
if ($Provider -ne 'ollama') {
  if (-not $ApiKeyFile) { throw 'Informe -ApiKeyFile apontando para um arquivo que contenha somente a chave.' }
  $ApiKeyFile = (Resolve-Path -LiteralPath $ApiKeyFile).Path
  if (([IO.File]::ReadAllText($ApiKeyFile).Trim()).Length -lt 20) { throw 'O arquivo de chave está vazio ou inválido.' }
}
if ($Provider -eq 'openai-compatible' -and -not $ApiBaseUrl) { throw 'Informe -ApiBaseUrl para a API compatível.' }
New-Item -ItemType Directory -Force '.codex-local' | Out-Null
$config = [ordered]@{ provider=$Provider; model=$Model; apiBaseUrl=$ApiBaseUrl; apiKeyFile=$ApiKeyFile }
$config | ConvertTo-Json | Set-Content -LiteralPath '.codex-local/vision-provider.json' -Encoding utf8
Write-Host "Provedor configurado: $Provider / $Model"
Write-Host 'Reinicie services/food-vision/start.ps1 para aplicar.'
