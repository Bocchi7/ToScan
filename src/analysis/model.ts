import defaults from '../../config/default.json' with { type: 'json' };
import { AnalysisError } from './errors.ts';

export interface ModelInput {
  system: string;
  user: string;
  signal: AbortSignal;
}

export interface ModelClient {
  generate(input: ModelInput): Promise<string>;
}

export interface ChatModelOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxCompletionTokens?: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** One non-streaming Chat Completions request; no tools or retries in v1. */
export function createChatModel(options: ChatModelOptions, fetcher: typeof fetch = fetch): ModelClient {
  const timeoutMs = options.timeoutMs ?? defaults.analysis.modelTimeoutMs;
  const maxCompletionTokens = options.maxCompletionTokens ?? defaults.analysis.maxCompletionTokens;
  let baseUrl: URL;
  try {
    baseUrl = new URL(options.baseUrl);
  } catch {
    throw new AnalysisError('INVALID_CONFIG', '模型服务地址必须是完整 HTTP(S) 地址。');
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash
    || !options.apiKey.trim() || !options.model.trim()
    || ![timeoutMs, maxCompletionTokens].every(value => Number.isSafeInteger(value) && value > 0)
    || timeoutMs > 2_147_483_647) {
    throw new AnalysisError('INVALID_CONFIG', '模型地址、凭据、名称或调用限制无效。');
  }
  const endpoint = `${baseUrl.href.replace(/\/+$/, '')}/chat/completions`;
  const apiKey = options.apiKey;
  const model = options.model;

  return {
    async generate(input) {
      input.signal.throwIfAborted();
      const signal = AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)]);
      try {
        const response = await fetcher(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: input.system },
              { role: 'user', content: input.user },
            ],
            response_format: { type: 'json_object' },
            max_completion_tokens: maxCompletionTokens,
            stream: false,
          }),
        });
        if (!response.ok) {
          // Do not expose provider response bodies, which may echo prompts or credentials.
          await response.body?.cancel();
          throw new AnalysisError('MODEL_REQUEST_FAILED', `模型服务请求失败（HTTP ${response.status}）。`);
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new AnalysisError('MODEL_RESPONSE_INVALID', '模型服务没有返回有效的 JSON 响应。');
        }
        signal.throwIfAborted();
        const choice = record(payload) && Array.isArray(payload.choices) ? payload.choices[0] : undefined;
        const message = record(choice) ? choice.message : undefined;
        if (!record(choice) || choice.finish_reason !== 'stop' || !record(message)
          || message.refusal || message.tool_calls || message.function_call
          || typeof message.content !== 'string' || !message.content.trim()) {
          throw new AnalysisError('MODEL_RESPONSE_INVALID', '模型未返回完整文本答案，可能被截断、拒答或请求了工具。');
        }
        return message.content;
      } catch (error) {
        input.signal.throwIfAborted();
        if (signal.aborted) throw new AnalysisError('MODEL_TIMEOUT', '模型调用超时。');
        if (error instanceof AnalysisError) throw error;
        throw new AnalysisError('MODEL_REQUEST_FAILED', '无法完成模型请求。');
      }
    },
  };
}

export function createModelFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClient {
  const numeric = (key: string): number | undefined => env[key] === undefined ? undefined : Number(env[key]);
  return createChatModel({
    baseUrl: env.TOSCAN_MODEL_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey: env.TOSCAN_MODEL_API_KEY ?? '',
    model: env.TOSCAN_MODEL_NAME ?? '',
    timeoutMs: numeric('TOSCAN_MODEL_TIMEOUT_MS'),
    maxCompletionTokens: numeric('TOSCAN_MODEL_MAX_COMPLETION_TOKENS'),
  });
}
