import { afterEach, describe, expect, it, vi } from 'vitest';
import { configuredProvider,openAiResponsesProvider } from './providers';
import { writeFileSync,mkdirSync,rmSync } from 'node:fs';

describe('vision provider configuration', () => {
  afterEach(() => {vi.unstubAllEnvs();vi.restoreAllMocks()});
  it('defaults to local Ollama without API credentials', () => {
    vi.stubEnv('NUTRI_VISION_PROVIDER', '');
    vi.stubEnv('NUTRI_VISION_MODEL', '');
    expect(configuredProvider().name).toBe('ollama');
  });
  it('uses Luna fast defaults, store false, structured output and exposes usage',async()=>{
    mkdirSync('.codex-local',{recursive:true});writeFileSync('.codex-local/test-openai-key','x'.repeat(40));vi.stubEnv('NUTRI_VISION_API_KEY_FILE','.codex-local/test-openai-key');
    const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({status:'completed',output_text:'{"items":[]}',usage:{input_tokens:20,output_tokens:9,total_tokens:29,output_tokens_details:{reasoning_tokens:4}}}),{status:200,headers:{'Content-Type':'application/json'}}));
    const result=await openAiResponsesProvider('gpt-5.6-luna').recognize(Buffer.from('image'),{schema:{type:'object'},schemaName:'food_detection',systemPrompt:'system',userPrompt:'user',maxOutputTokens:900});
    const request=JSON.parse(String(fetchMock.mock.calls[0][1]?.body));expect(fetchMock).toHaveBeenCalledTimes(1);expect(request.reasoning).toEqual({effort:'none'});expect(request.input[1].content[1].detail).toBe('high');expect(request.prompt_cache_key).toBe('nutriplus-food_detection');expect(request.store).toBe(false);expect(request.max_output_tokens).toBe(900);expect(request.text.format.type).toBe('json_schema');expect(result.telemetry.reasoningTokens).toBe(4);fetchMock.mockRestore();rmSync('.codex-local/test-openai-key');
  });
  it('allows explicit quality overrides for OpenAI vision',async()=>{
    mkdirSync('.codex-local',{recursive:true});writeFileSync('.codex-local/test-openai-key','x'.repeat(40));vi.stubEnv('NUTRI_VISION_API_KEY_FILE','.codex-local/test-openai-key');vi.stubEnv('NUTRI_VISION_REASONING_EFFORT','low');vi.stubEnv('NUTRI_VISION_IMAGE_DETAIL','high');
    const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({status:'completed',output_text:'{"items":[]}'}),{status:200,headers:{'Content-Type':'application/json'}}));
    await openAiResponsesProvider('gpt-5.6-luna').recognize(Buffer.from('image'),{schema:{type:'object'},schemaName:'food_detection',systemPrompt:'system',userPrompt:'user',maxOutputTokens:900});
    const request=JSON.parse(String(fetchMock.mock.calls[0][1]?.body));expect(request.reasoning).toEqual({effort:'low'});expect(request.input[1].content[1].detail).toBe('high');fetchMock.mockRestore();rmSync('.codex-local/test-openai-key');
  });
  it('propagates provider timeout without retrying',async()=>{
    mkdirSync('.codex-local',{recursive:true});writeFileSync('.codex-local/test-openai-key','x'.repeat(40));vi.stubEnv('NUTRI_VISION_API_KEY_FILE','.codex-local/test-openai-key');
    const fetchMock=vi.spyOn(globalThis,'fetch').mockRejectedValue(new DOMException('timed out','TimeoutError'));
    await expect(openAiResponsesProvider('gpt-5.6-luna').recognize(Buffer.from('image'),{schema:{type:'object'},schemaName:'food_detection',systemPrompt:'system',userPrompt:'user',maxOutputTokens:900})).rejects.toMatchObject({name:'TimeoutError'});
    expect(fetchMock).toHaveBeenCalledTimes(1);rmSync('.codex-local/test-openai-key');
  });
  it('switches to the OpenAI Responses adapter using configuration only', () => {
    vi.stubEnv('NUTRI_VISION_PROVIDER', 'openai-responses');
    vi.stubEnv('NUTRI_VISION_MODEL', 'gpt-4o-mini');
    vi.stubEnv('NUTRI_VISION_API_BASE_URL', 'https://api.openai.com/v1');
    expect(configuredProvider().name).toBe('openai-responses');
  });
  it('switches to Gemini with its stable Flash-Lite default', () => {
    vi.stubEnv('NUTRI_VISION_PROVIDER', 'gemini');
    vi.stubEnv('NUTRI_VISION_MODEL', '');
    expect(configuredProvider().name).toBe('gemini');
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
