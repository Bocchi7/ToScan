export type AnalysisErrorCode =
  | 'INVALID_CONFIG' | 'INPUT_TOO_LONG' | 'NO_MATERIALS'
  | 'MODEL_REQUEST_FAILED' | 'MODEL_TIMEOUT' | 'MODEL_RESPONSE_INVALID'
  | 'INVALID_DRAFT';

/** Internal errors; the HTTP service owns their mapping to public error codes. */
export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode;

  constructor(code: AnalysisErrorCode, message: string) {
    super(message);
    this.name = 'AnalysisError';
    this.code = code;
  }
}
