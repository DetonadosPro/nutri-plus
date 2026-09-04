import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cert = readFileSync(resolve(root, 'frontend/.certs/nutri-local.pem'));
const key = readFileSync(resolve(root, 'frontend/.certs/nutri-local-key.pem'));

const server = createServer({ cert, key }, (req, res) => {
  const isApi = req.url?.startsWith('/api');
  const targetPort = isApi ? 3001 : 3002;
  const proxy = httpRequest(
    {
      hostname: '127.0.0.1',
      port: targetPort,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${targetPort}`,
        'x-forwarded-host': req.headers.host ?? 'localhost:3000',
        'x-forwarded-proto': 'https',
      },
    },
    (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res);
    },
  );

  proxy.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'O serviço local ainda está iniciando.' }));
  });
  req.pipe(proxy);
});

server.listen(3000, '0.0.0.0', () => {
  console.log('Nutri+ HTTPS: https://localhost:3000');
  console.log('Nutri+ na rede: https://192.168.1.31:3000');
});
