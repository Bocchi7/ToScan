import config from '../../config/default.json' with { type: 'json' };
import type { Analyze } from './contracts.ts';
import { AnalysisError } from './errors.ts';
import type { ModelClient } from './model.ts';
import { buildPrompt, buildRepairFeedback } from './prompt.ts';
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
    let repair: { previousOutput: string; feedback: string } | undefined;
    // One initial generation plus at most one format repair, never a tool loop.
    for (let attempt = 0; attempt < 2; attempt++) {
      tools.signal.throwIfAborted();
      if (prompt.system.length + prompt.user.length
        + (repair ? repair.previousOutput.length + repair.feedback.length : 0) > maxInputChars) {
        throw new AnalysisError('INPUT_TOO_LONG', '格式修复请求超过输入长度限制，未继续调用模型。');
      }
      let raw: string;
      try {
        raw = await model.generate({ ...prompt, signal: tools.signal, ...(repair ? { repair } : {}) });
      } catch (error) {
        tools.signal.throwIfAborted();
        if (error instanceof AnalysisError) throw error;
        throw new AnalysisError('MODEL_REQUEST_FAILED', '模型调用失败。');
      }
      tools.signal.throwIfAborted();
      if (typeof raw !== 'string' || raw.length > maxOutputChars) {
        throw new AnalysisError('MODEL_RESPONSE_INVALID', '模型输出无效或超过首版长度限制。');
      }
      try {
        return parseDraftAnswer(raw);
      } catch (error) {
        if (!(error instanceof AnalysisError) || error.code !== 'INVALID_DRAFT' || attempt === 1) throw error;
        repair = { previousOutput: raw, feedback: buildRepairFeedback(error.message) };
      }
    }
    throw new AnalysisError('INVALID_DRAFT', '格式修复未产生有效草稿。');
  };
}

export { AnalysisError } from './errors.ts';
export { createChatModel, createModelFromEnv } from './model.ts';
