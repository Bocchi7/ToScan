import type {
  AnswerResponse, CreateAnalysisRequest, DocumentSnapshot, ErrorResponse, FollowUpRequest,
} from '../contracts.ts';

type ServiceErrorCode = ErrorResponse['error']['code'] | 'NOT_IMPLEMENTED';

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; code: ServiceErrorCode };

export interface CreatedAnalysis {
  answer: AnswerResponse;
  sessionId?: string;
}

export interface AnalysisService {
  create(body: CreateAnalysisRequest, sessionId?: string): Promise<ServiceResult<CreatedAnalysis>>;
  followUp(analysisId: string, body: FollowUpRequest, sessionId?: string): Promise<ServiceResult<AnswerResponse>>;
  getDocument(analysisId: string, documentId: string, sessionId?: string): Promise<ServiceResult<DocumentSnapshot>>;
  delete(analysisId: string, sessionId?: string): Promise<ServiceResult<void>>;
}
