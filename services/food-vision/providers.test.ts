import { afterEach, describe, expect, it, vi } from 'vitest';
import { configuredProvider } from './providers';

describe('vision provider configuration', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('defaults to local Ollama without API credentials', () => {
    vi.stubEnv('NUTRI_VISION_PROVIDER', '');
    vi.stubEnv('NUTRI_VISION_MODEL', '');
    expect(configuredProvider().name).toBe('ollama');
  });
  it('switches to the OpenAI Responses adapter using configuration only', () => {
    vi.stubEnv('NUTRI_VISION_PROVIDER', 'openai-responses');
    vi.stubEnv('NUTRI_VISION_MODEL', 'gpt-4o-mini');
    vi.stubEnv('NUTRI_VISION_API_BASE_URL', 'https://api.openai.com/v1');
    expect(configuredProvider().name).toBe('openai-responses');
  });
  it('rejects unknown providers and insecure remote compatible APIs', () => {
    vi.stubEnv('NUTRI_VISION_PROVIDER', 'unknown');
    vi.stubEnv('NUTRI_VISION_MODEL', 'model');
    expect(() => configuredProvider()).toThrow('inválido');
    vi.stubEnv('NUTRI_VISION_PROVIDER', 'openai-compatible');
    vi.stubEnv('NUTRI_VISION_API_BASE_URL', 'http://example.com/v1');
    expect(() => configuredProvider()).toThrow('HTTPS');
  });
});
