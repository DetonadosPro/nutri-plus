import { readFileSync } from 'node:fs';

type JsonSchema = Record<string, unknown>;
type ProviderOptions = {
  schema: JsonSchema;
  schemaName: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
};

export type ProviderTelemetry = { model:string;reasoningEffort:string;latencyMs:number;inputTokens:number|null;outputTokens:number|null;reasoningTokens:number|null;totalTokens:number|null };
export type ProviderResult = { content:string;telemetry:ProviderTelemetry };

export type VisionProvider = {
  name: string;
  ready(): Promise<boolean>;
  recognize(image: Buffer, options: ProviderOptions): Promise<ProviderResult>;
};

async function responseError(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string | { message?: string } };
  const message = typeof body.error === 'string' ? body.error : body.error?.message;
  return (message || `HTTP ${response.status}`).slice(0, 500).replace(/[\r\n]/g, ' ');
}

export function ollamaProvider(model: string): VisionProvider {
  const baseUrl = 'http://127.0.0.1:11434';
  return {
    name: 'ollama',
    async ready() {
      const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2_000) });
      if (!response.ok) return false;
      const data = await response.json() as { models?: { name?: string }[] };
      return Boolean(data.models?.some(item => item.name === model));
    },
    async recognize(image, options) {
      const started=Date.now();
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST', signal: AbortSignal.timeout(90_000), headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, think: false, keep_alive: 0, format: options.schema,
          options: { temperature: 0, num_ctx: 4096, num_predict: options.maxOutputTokens },
          messages: [{ role: 'system', content: options.systemPrompt },
            { role: 'user', content: options.userPrompt, images: [image.toString('base64')] }] }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as { message?: { content?: string }; done_reason?: string;prompt_eval_count?:number;eval_count?:number };
      if (data.done_reason === 'length') throw new Error('output_truncated');
      if (typeof data.message?.content !== 'string') throw new Error('invalid_output');
      return {content:data.message.content,telemetry:{model,reasoningEffort:'none',latencyMs:Date.now()-started,inputTokens:data.prompt_eval_count??null,outputTokens:data.eval_count??null,reasoningTokens:null,totalTokens:(data.prompt_eval_count??0)+(data.eval_count??0)||null}};
    },
  };
}

function apiKey() {
  const path = process.env.NUTRI_VISION_API_KEY_FILE;
  if (!path) throw new Error('Configure NUTRI_VISION_API_KEY_FILE');
  const value = readFileSync(path, 'utf8').trim();
  if (value.length < 20) throw new Error('API key file is empty');
  return value;
}

function safeApiBase(value: string) {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) throw new Error('Vision API URL must use HTTPS');
  return url.href.replace(/\/$/, '');
}

export function openAiResponsesProvider(model: string): VisionProvider {
  const baseUrl = safeApiBase(process.env.NUTRI_VISION_API_BASE_URL || 'https://api.openai.com/v1');
  return {
    name: 'openai-responses',
    async ready() { return Boolean(apiKey() && model); },
    async recognize(image, options) {
      const started=Date.now();
      const reasoning = model === 'gpt-5.6-luna' ? { effort: 'low' } : undefined;
      const response = await fetch(`${baseUrl}/responses`, {
        method: 'POST', signal: AbortSignal.timeout(90_000),
        headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, store: false, max_output_tokens: options.maxOutputTokens, reasoning,
          input: [{ role: 'developer', content: [{ type: 'input_text', text: options.systemPrompt }] },
            { role: 'user', content: [{ type: 'input_text', text: options.userPrompt },
              { type: 'input_image', image_url: `data:image/jpeg;base64,${image.toString('base64')}`, detail: 'high' }] }],
          text: { verbosity:'low',format: { type: 'json_schema', name: options.schemaName, strict: true, schema: options.schema } } }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as { status?:string;incomplete_details?:{reason?:string};output_text?: string; output?: { content?: { type?: string; text?: string }[] }[];usage?:{input_tokens?:number;output_tokens?:number;total_tokens?:number;output_tokens_details?:{reasoning_tokens?:number}} };
      if(data.status==='incomplete')throw new Error(data.incomplete_details?.reason||'output_truncated');
      const text = data.output_text || data.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
      if (typeof text !== 'string') throw new Error('invalid_output');
      return {content:text,telemetry:{model,reasoningEffort:reasoning?.effort||'none',latencyMs:Date.now()-started,inputTokens:data.usage?.input_tokens??null,outputTokens:data.usage?.output_tokens??null,reasoningTokens:data.usage?.output_tokens_details?.reasoning_tokens??null,totalTokens:data.usage?.total_tokens??null}};
    },
  };
}

export function openAiCompatibleProvider(model: string): VisionProvider {
  const baseUrl = safeApiBase(process.env.NUTRI_VISION_API_BASE_URL || '');
  return {
    name: 'openai-compatible',
    async ready() { return Boolean(apiKey() && model); },
    async recognize(image, options) {
      const started=Date.now();
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST', signal: AbortSignal.timeout(90_000),
        headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0, max_tokens: options.maxOutputTokens,
          response_format: { type: 'json_schema', json_schema: { name: options.schemaName, strict: true, schema: options.schema } },
          messages: [{ role: 'system', content: options.systemPrompt }, { role: 'user', content: [
            { type: 'text', text: options.userPrompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } },
          ] }] }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as { choices?: { message?: { content?: string } }[];usage?:{prompt_tokens?:number;completion_tokens?:number;total_tokens?:number} };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error('invalid_output');
      return {content:text,telemetry:{model,reasoningEffort:'none',latencyMs:Date.now()-started,inputTokens:data.usage?.prompt_tokens??null,outputTokens:data.usage?.completion_tokens??null,reasoningTokens:null,totalTokens:data.usage?.total_tokens??null}};
    },
  };
}

export function geminiProvider(model: string): VisionProvider {
  const baseUrl = safeApiBase(process.env.NUTRI_VISION_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta');
  return {
    name: 'gemini',
    async ready() { return Boolean(apiKey() && model); },
    async recognize(image, options) {
      const started=Date.now();
      const response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(90_000),
        headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: options.systemPrompt }] },
          contents: [{ role: 'user', parts: [
            { text: options.userPrompt },
            { inlineData: { mimeType: 'image/jpeg', data: image.toString('base64') } },
          ] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: options.maxOutputTokens,
            responseMimeType: 'application/json',
            responseJsonSchema: options.schema,
          },
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as {
        candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
        usageMetadata?:{promptTokenCount?:number;candidatesTokenCount?:number;thoughtsTokenCount?:number;totalTokenCount?:number};
      };
      const candidate = data.candidates?.[0];
      if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('output_truncated');
      const text = candidate?.content?.parts?.map(part => part.text || '').join('').trim();
      if (!text) throw new Error('invalid_output');
      return {content:text,telemetry:{model,reasoningEffort:'provider-default',latencyMs:Date.now()-started,inputTokens:data.usageMetadata?.promptTokenCount??null,outputTokens:data.usageMetadata?.candidatesTokenCount??null,reasoningTokens:data.usageMetadata?.thoughtsTokenCount??null,totalTokens:data.usageMetadata?.totalTokenCount??null}};
    },
  };
}

export function configuredProvider() {
  const provider = process.env.NUTRI_VISION_PROVIDER || 'ollama';
  const defaultModel = provider === 'ollama' ? 'qwen3-vl:4b-instruct' : provider === 'gemini' ? 'gemini-3.5-flash-lite' : '';
  const model = process.env.NUTRI_VISION_MODEL || defaultModel;
  if (!model) throw new Error('Configure NUTRI_VISION_MODEL');
  if (provider === 'ollama') return ollamaProvider(model);
  if (provider === 'openai-responses') return openAiResponsesProvider(model);
  if (provider === 'openai-compatible') return openAiCompatibleProvider(model);
  if (provider === 'gemini') return geminiProvider(model);
  throw new Error('NUTRI_VISION_PROVIDER inválido');
}
