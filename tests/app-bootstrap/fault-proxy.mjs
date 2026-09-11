import http from 'node:http';

const port = Number(process.env.BOOT_FAULT_PORT || 3200);
const frontend = process.env.BOOT_FRONTEND_URL || 'http://127.0.0.1:3002';
const backend = process.env.BOOT_BACKEND_URL || 'http://127.0.0.1:3001';
const fault = process.env.BOOT_FAULT || 'script';
const delayMs = Number(process.env.BOOT_DELAY_MS || 0);

const server = http.createServer(async (request, response) => {
  try {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const incoming = new URL(request.url || '/', `http://127.0.0.1:${port}`);
    if (incoming.pathname === '/__missing-boot.js') {
      response.writeHead(404, { 'content-type': 'application/javascript' });
      response.end('');
      return;
    }
    const upstream = incoming.pathname.startsWith('/api/') ? backend : frontend;
    const target = new URL(incoming.pathname + incoming.search, upstream);
    const fetched = await fetch(target, { headers: { accept: request.headers.accept || '*/*' } });
    const headers = Object.fromEntries(fetched.headers.entries());
    delete headers['content-length'];
    delete headers['content-encoding'];
    delete headers['transfer-encoding'];
    if (fault === 'script' && incoming.pathname === '/' && /text\/html/.test(headers['content-type'] || '')) {
      const html = await fetched.text();
      const modified = html.replace(/(<script[^>]+src=")[^"]+\.js([^"]*")/g, '$1/__missing-boot.js$2');
      response.writeHead(fetched.status, headers);
      response.end(modified);
      return;
    }
    response.writeHead(fetched.status, headers);
    response.end(Buffer.from(await fetched.arrayBuffer()));
  } catch {
    response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('fault proxy unavailable');
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Boot fault proxy: http://127.0.0.1:${port}; fault=${fault}; delay=${delayMs}ms`));
