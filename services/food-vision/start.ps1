$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$env:NUTRI_VISION_TOKEN_FILE = (Resolve-Path '.codex-local/vision-token').Path
$configPath = '.codex-local/vision-provider.json'
if (Test-Path -LiteralPath $configPath) {
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $env:NUTRI_VISION_PROVIDER = $config.provider
  $env:NUTRI_VISION_MODEL = $config.model
  if ($config.apiBaseUrl) { $env:NUTRI_VISION_API_BASE_URL = $config.apiBaseUrl }
  if ($config.apiKeyFile) { $env:NUTRI_VISION_API_KEY_FILE = $config.apiKeyFile }
} else {
  $env:NUTRI_VISION_PROVIDER = 'ollama'
  $env:NUTRI_VISION_MODEL = 'qwen3-vl:4b-instruct'
}
npx tsx services/food-vision/server.ts
