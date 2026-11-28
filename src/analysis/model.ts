import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import defaults from '../../config/default.json' with { type: 'json' };
import { AnalysisError } from './errors.ts';

export interface ModelInput {
  system: string;
  user: string;
  signal: AbortSignal;
  repair?: { previousOutput: string; feedback: string };
}

export interface ModelClient {
  generate(input: ModelInput): Promise<string>;
}

const reasoningEfforts = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
type ReasoningEffort = typeof reasoningEfforts[number];

function isReasoningEffort(value: string): value is ReasoningEffort {
  return reasoningEfforts.some(effort => effort === value);
}

export interface ChatModelOptions {
  provider?: 'deepseek';
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxCompletionTokens?: number;
  thinking?: 'enabled' | 'disabled';
  reasoningEffort?: ReasoningEffort;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** SDK handles transport. Each generate() makes at most one HTTP request. */
export function createChatModel(options: ChatModelOptions, fetcher: typeof fetch = fetch): ModelClient {
  const timeoutMs = options.timeoutMs ?? defaults.analysis.modelTimeoutMs;
  const maxCompletionTokens = options.maxCompletionTokens;
  const provider = options.provider ?? 'deepseek';
  // SDK compatibility alone does not mean a model has been adapted.
  if (provider !== 'deepseek' || options.model !== 'deepseek-flash') {
    throw new AnalysisError('INVALID_CONFIG', '当前仅支持 deepseek / deepseek-flash，未发送模型请求。');
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(options.baseUrl);
  } catch {
    throw new AnalysisError('INVALID_CONFIG', '模型服务地址必须是完整 HTTP(S) 地址。');
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash
    || !options.apiKey.trim() || !options.model.trim()
    || (options.thinking !== undefined && !['enabled', 'disabled'].includes(options.thinking))
    || (options.reasoningEffort !== undefined && !isReasoningEffort(options.reasoningEffort))
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0
    || (maxCompletionTokens !== undefined && (!Number.isSafeInteger(maxCompletionTokens) || maxCompletionTokens <= 0))
    || timeoutMs > 2_147_483_647) {
    throw new AnalysisError('INVALID_CONFIG', '模型地址、凭据、名称或调用参数无效。');
  }
  const client = new OpenAI({
    baseURL: baseUrl.href.replace(/\/+$/, ''),
    apiKey: options.apiKey,
    timeout: timeoutMs,
    maxRetries: 0, // Format repair belongs to analyze(), not hidden SDK retries.
    fetch: fetcher,
    fetchOptions: { redirect: 'error' },
    logLevel: 'off',
  });
  const model = options.model;
  const thinking = options.thinking ?? 'enabled';
  const reasoningEffort = options.reasoningEffort ?? 'high';

  return {
    async generate(input) {
      input.signal.throwIfAborted();
      // Enforce the deadline through response-body parsing as well as connection setup.
      const signal = AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)]);
      const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ];
      if (input.repair) {
        messages.push(
          { role: 'assistant', content: input.repair.previousOutput },
          { role: 'user', content: input.repair.feedback },
        );
      }
      // DeepSeek extends the OpenAI wire format; SDK types need not know this field.
      const request: ChatCompletionCreateParamsNonStreaming & { thinking?: { type: 'enabled' | 'disabled' } } = {
        model,
        messages,
        response_format: { type: 'json_object' },
        stream: false,
        ...(maxCompletionTokens !== undefined ? { max_tokens: maxCompletionTokens } : {}),
        thinking: { type: thinking },
        ...(thinking === 'enabled' ? { reasoning_effort: reasoningEffort } : {}),
      };
      try {
        const payload: unknown = await client.chat.completions.create(request, { signal });
        signal.throwIfAborted();
        const choice = record(payload) && Array.isArray(payload.choices) ? payload.choices[0] : undefined;
        const message = record(choice) ? choice.message : undefined;
        if (!record(choice) || choice.finish_reason !== 'stop' || !record(message)
          || message.refusal || (Array.isArray(message.tool_calls) ? message.tool_calls.length > 0 : Boolean(message.tool_calls)) || message.function_call
          || typeof message.content !== 'string' || !message.content.trim()) {
          const usage = record(payload) && record(payload.usage) ? payload.usage : undefined;
          const details = usage && record(usage.completion_tokens_details) ? usage.completion_tokens_details : undefined;
          throw new AnalysisError('MODEL_RESPONSE_INVALID', '模型未返回完整文本答案，可能被截断、拒答或请求了工具。', {
            finishReason: record(choice) && typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
            rawContent: record(message) && typeof message.content === 'string' ? message.content : null,
            maxCompletionTokens: maxCompletionTokens ?? null,
            completionTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : null,
            reasoningTokens: typeof details?.reasoning_tokens === 'number' ? details.reasoning_tokens : null,
          });
        }
        return message.content;
      } catch (error) {
        input.signal.throwIfAborted();
        if (signal.aborted || error instanceof OpenAI.APIConnectionTimeoutError) {
          throw new AnalysisError('MODEL_TIMEOUT', '模型调用超时。');
        }
        if (error instanceof AnalysisError) throw error;
        if (error instanceof SyntaxError) {
          throw new AnalysisError('MODEL_RESPONSE_INVALID', '模型服务没有返回有效的 JSON 响应。');
        }
        // SDK errors can contain provider bodies; expose only a controlled message.
        const status = error instanceof OpenAI.APIError ? error.status : undefined;
        throw new AnalysisError('MODEL_REQUEST_FAILED', status
          ? `模型服务请求失败（HTTP ${status}）。` : '无法完成模型请求。');
      }
    },
  };
}

export function createModelFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClient {
  const provider = env.TOSCAN_MODEL_PROVIDER ?? 'deepseek';
  const thinking = env.TOSCAN_MODEL_THINKING;
  const effort = env.TOSCAN_MODEL_REASONING_EFFORT;
  if (provider !== 'deepseek') {
    throw new AnalysisError('INVALID_CONFIG', '当前仅支持 deepseek / deepseek-flash，未发送模型请求。');
  }
  if (thinking !== undefined && thinking !== 'enabled' && thinking !== 'disabled') {
    throw new AnalysisError('INVALID_CONFIG', 'TOSCAN_MODEL_THINKING 只支持 enabled 或 disabled。');
  }
  if (effort !== undefined && !isReasoningEffort(effort)) {
    throw new AnalysisError('INVALID_CONFIG', `TOSCAN_MODEL_REASONING_EFFORT 只支持 ${reasoningEfforts.join('、')}。`);
  }
  const numeric = (key: string): number | undefined => env[key] === undefined ? undefined : Number(env[key]);
  const outputLimit = env.TOSCAN_MODEL_MAX_COMPLETION_TOKENS?.trim();
  return createChatModel({
    provider,
    baseUrl: env.TOSCAN_MODEL_BASE_URL ?? 'https://api.deepseek.com',
    apiKey: env.TOSCAN_MODEL_API_KEY || env.DEEPSEEK_API_KEY || '',
    model: env.TOSCAN_MODEL_NAME ?? 'deepseek-flash',
    timeoutMs: numeric('TOSCAN_MODEL_TIMEOUT_MS'),
    maxCompletionTokens: outputLimit ? Number(outputLimit) : undefined,
    thinking,
    reasoningEffort: effort,
  });
}
