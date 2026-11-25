export interface CreateAnalysisRequest {
  urls: string[];
  question: string;
  consentToModel: true;
}

export interface FollowUpRequest {
  question: string;
  additionalUrls?: string[];
  consentToModel: true;
}

export interface ErrorResponse {
  error: {
    code:
      | 'INVALID_INPUT' | 'NOT_FOUND'
      | 'ANALYSIS_BUSY' | 'ANALYSIS_FAILED' | 'ANALYSIS_TIMEOUT';
  };
}

export type Section = 'conditions' | 'platformRights' | 'impact' | 'choices';

export interface Source {
  id: string;
  title: string;
  url: string;
}

export interface Paragraph {
  id: string;
  section: string | null;
  text: string;
}

export interface DocumentSnapshot extends Source {
  paragraphs: Paragraph[];
}

export interface CitationRef {
  documentId: string;
  paragraphId: string;
  quote: string;
}

export interface Citation extends CitationRef {
  id: string;
}

export interface Finding {
  section: Section;
  text: string;
  citationIds: string[];
}

export type ReadFailureCode =
  | 'BLOCKED_URL' | 'LOGIN_REQUIRED' | 'FETCH_FAILED' | 'TEXT_UNAVAILABLE';

export type Gap =
  | { code: ReadFailureCode; url: string }
  | { code: 'MISSING_CLAUSE' | 'AMBIGUOUS_CLAUSE' | 'CONFLICTING_SOURCES'; detail: string }
  | { code: 'BUDGET_EXHAUSTED' | 'CITATION_INVALID' };

export interface AnswerResponse {
  analysisId: string;
  findings: Finding[];
  citations: Citation[];
  sources: Source[];
  gaps: Gap[];
}
