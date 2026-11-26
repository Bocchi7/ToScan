import config from '../../config/default.json' with { type: 'json' };
import type { Analyze } from './contracts.ts';
import { AnalysisError } from './errors.ts';
import type { ModelClient } from './model.ts';
import { buildPrompt } from './prompt.ts';
import { parseDraftAnswer } from './validation.ts';

export interface AnalyzeOptions {
  maxInputChars?: number;
  maxOutputChars?: number;
}

export function createAnalyze(model: ModelClient, options: AnalyzeOptions = {}): Analyze {
  const maxInputChars = options.maxInputChars ?? config.analysis.maxInputChars;
  const maxOutputChars = options.maxOutputChars ?? config.analysis.maxOutputChars;
  if (![maxInputChars, maxOutputChars].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new AnalysisError('INVALID_CONFIG', '分析长度限制必须是正整数。');
  }

  return async (input, tools) => {
    tools.signal.throwIfAborted();
    const prompt = buildPrompt(input, maxInputChars);
    let raw: string;
    try {
      raw = await model.generate({ ...prompt, signal: tools.signal });
    } catch (error) {
      tools.signal.throwIfAborted();
      if (error instanceof AnalysisError) throw error;
      throw new AnalysisError('MODEL_REQUEST_FAILED', '模型调用失败。');
    }
    tools.signal.throwIfAborted();
    if (typeof raw !== 'string' || raw.length > maxOutputChars) {
      throw new AnalysisError('MODEL_RESPONSE_INVALID', '模型输出无效或超过首版长度限制。');
    }
    return parseDraftAnswer(raw);
  };
}

export { AnalysisError } from './errors.ts';
export { createChatModel, createModelFromEnv } from './model.ts';
