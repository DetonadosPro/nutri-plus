import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type ServiceWorkerEvent = { waitUntil?: (promise: Promise<unknown>) => void; respondWith?: (promise: Promise<Response>) => void };

function serviceWorkerHarness() {
  const listeners = new Map<string, (event: any) => void>();
  const added: string[] = [];
  const deleted: string[] = [];
  const offline = new Response('offline', { status: 200 });
  const cache = {
    add: vi.fn(async (asset: string) => {
      added.push(asset);
    }),
    put: vi.fn(async () => undefined),
  };
  const cachesApi = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ['nutri-app-v4', 'nutri-static-old', 'nutri-static-build-a', 'other-app']),
    delete: vi.fn(async (key: string) => {
      deleted.push(key);
      return true;
    }),
    match: vi.fn(async (request: string | Request) =>
      (typeof request === 'string' ? request : new URL(request.url).pathname) === '/offline.html' ? offline : undefined,
    ),
  };
  const fetchMock = vi.fn(async () => {
    throw new TypeError('network down');
  });
  const self = {
    location: { href: 'https://nutriplusapp.store/sw.js?build=build-a', origin: 'https://nutriplusapp.store' },
    addEventListener: (type: string, handler: (event: any) => void) => listeners.set(type, handler),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self,
    caches: cachesApi,
    fetch: fetchMock,
    URL,
    Response,
  });
  return { listeners, added, deleted, cachesApi, fetchMock, offline };
}

describe('version-safe service worker', () => {
  it('never precaches the application HTML and removes previous Nutri+ generations', async () => {
    const harness = serviceWorkerHarness();
    let install: Promise<unknown> = Promise.resolve();
    harness.listeners.get('install')?.({ waitUntil: (promise: Promise<unknown>) => (install = promise) });
    await install;
    expect(harness.added).toContain('/offline.html');
    expect(harness.added).not.toContain('/');

    let activate: Promise<unknown> = Promise.resolve();
    harness.listeners.get('activate')?.({ waitUntil: (promise: Promise<unknown>) => (activate = promise) });
    await activate;
    expect(harness.deleted).toEqual(['nutri-app-v4', 'nutri-static-old']);
  });

  it('uses a standalone offline document when a navigation cannot reach the server', async () => {
    const harness = serviceWorkerHarness();
    let response: Promise<Response> | undefined;
    const event: ServiceWorkerEvent & { request: Record<string, unknown> } = {
      request: {
        method: 'GET',
        url: 'https://nutriplusapp.store/',
        mode: 'navigate',
        headers: new Headers(),
      },
      respondWith: (promise) => {
        response = promise;
      },
    };
    harness.listeners.get('fetch')?.(event);
    expect(await response).toBe(harness.offline);
    expect(harness.cachesApi.match).toHaveBeenCalledWith('/offline.html');
  });

  it('does not intercept API or React server-component requests', () => {
    const harness = serviceWorkerHarness();
    const respondWith = vi.fn();
    harness.listeners.get('fetch')?.({
      request: { method: 'GET', url: 'https://nutriplusapp.store/api/health', mode: 'cors', headers: new Headers() },
      respondWith,
    });
    harness.listeners.get('fetch')?.({
      request: { method: 'GET', url: 'https://nutriplusapp.store/?_rsc=1', mode: 'cors', headers: new Headers() },
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
  });
});
