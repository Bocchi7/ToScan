export type AnalysisErrorCode =
  | 'INVALID_CONFIG' | 'INPUT_TOO_LONG' | 'NO_MATERIALS'
  | 'MODEL_REQUEST_FAILED' | 'MODEL_TIMEOUT' | 'MODEL_RESPONSE_INVALID'
  | 'INVALID_DRAFT';

export interface ModelResponseDiagnostics {
  finishReason: string | null;
  rawContent: string | null;
  maxCompletionTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
}

/** Internal errors; the HTTP service owns their mapping to public error codes. */
export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode;
  readonly diagnostics?: ModelResponseDiagnostics;

  constructor(code: AnalysisErrorCode, message: string, diagnostics?: ModelResponseDiagnostics) {
    super(message);
    this.name = 'AnalysisError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}
