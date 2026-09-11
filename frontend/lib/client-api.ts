const API_URL =
  typeof window === 'undefined'
    ? 'http://localhost:3001/api'
    : `${window.location.origin}/api`;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export type ApiOptions = RequestInit & { timeoutMs?: number };

export async function api<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const { timeoutMs, signal: externalSignal, ...requestOptions } = options;
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  const controller = timeoutMs ? new AbortController() : null;
  const abortFromCaller = () => controller?.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = controller
    ? setTimeout(() => controller.abort(new DOMException('Tempo limite excedido.', 'TimeoutError')), timeoutMs)
    : null;
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...requestOptions,
      credentials: 'include',
      headers,
      signal: controller?.signal ?? externalSignal,
    });
    if (response.status === 204) return undefined as T;
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    } & T;
    if (!response.ok)
      throw new ApiError(
        body.error || 'Não foi possível concluir a ação.',
        response.status,
      );
    return body as T;
  } finally {
    if (timeout) clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}
