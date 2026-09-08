$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$env:NUTRI_VISION_TOKEN_FILE = (Resolve-Path '.codex-local/vision-token').Path
$env:NUTRI_VISION_MODEL = 'qwen3-vl:4b-instruct'
npx tsx services/food-vision/server.ts
