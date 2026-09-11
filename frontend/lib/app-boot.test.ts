import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootGuardScript, isChunkLoadError, recoveryUrl } from './app-boot';
import { api } from './client-api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('critical bootstrap recovery', () => {
  it('recognizes browser variants of lazy chunk failures', () => {
    expect(isChunkLoadError(new Error('ChunkLoadError: Loading chunk 42 failed'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Falha comum de formulário'))).toBe(false);
  });

  it('adds a bounded build recovery marker without losing the current route', () => {
    expect(recoveryUrl('https://nutriplusapp.store/?verify=abc', '1234567890abcdef')).toBe(
      'https://nutriplusapp.store/?verify=abc&app-recovery=1234567890abcdef',
    );
  });

  it('installs an early watchdog and a single-build recovery guard before React', () => {
    const script = bootGuardScript('build-a', 2_000);
    expect(script).toContain("mark('html-loaded')");
    expect(script).toContain("mark('boot-timeout',reason)");
    expect(script).toContain("'nutri:boot-recovery:'");
    expect(script).toContain("sessionStorage.getItem(key)==='1'");
    expect(script).toContain('data-nutri-first-ui');
    expect(script).not.toContain('location.reload()');
  });

  it('ends a stuck session request at its explicit timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options?: RequestInit) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
        }),
      ),
    );
    await expect(api('/auth/me', { timeoutMs: 20 })).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
