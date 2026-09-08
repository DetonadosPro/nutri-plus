$ErrorActionPreference = 'Stop'
# The existing SSH host verifies the server key and uses the user's configured key.
# Bind the remote socket exclusively to loopback. No public listener/firewall rule.
ssh -N -T -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 127.0.0.1:11435:127.0.0.1:11435 nutriplus-prod
if ($LASTEXITCODE -ne 0) { throw 'Túnel interrompido. Verifique a conexão e execute novamente.' }
