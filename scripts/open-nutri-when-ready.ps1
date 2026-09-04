$url = "https://localhost:3000"

1..60 | ForEach-Object {
  & curl.exe --ssl-no-revoke --silent --fail --max-time 2 $url *> $null
  if ($LASTEXITCODE -eq 0) {
    Start-Process $url
    exit 0
  }

  Start-Sleep -Seconds 1
}

exit 1
