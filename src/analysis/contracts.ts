import type {
  AnswerResponse, CitationRef, DocumentSnapshot, ReadFailureCode, Section,
} from '../contracts.ts';

export interface Candidate {
  id: string;
  url: string;
  label: string;
}

export interface Material {
  document: DocumentSnapshot;
  candidates: Candidate[];
}

export type ReadResult =
  | { ok: true; material: Material }
  | { ok: false; url: string; code: ReadFailureCode };

export type RelatedResult =
  | { candidateId: string; result: ReadResult }
  | { candidateId: string; code: 'UNKNOWN_CANDIDATE' | 'BUDGET_EXHAUSTED' };

export interface AnalysisInput {
  question: string;
  history: Array<{ question: string; answer: AnswerResponse }>;
  knownMaterials: Material[];
  seedResults: ReadResult[];
}

export interface AnalysisTools {
  signal: AbortSignal;
  readRelated(candidateIds: string[]): Promise<RelatedResult[]>;
}

export interface DraftAnswer {
  findings: Array<{ section: Section; text: string; citations: CitationRef[] }>;
  gaps: Array<{ code: 'MISSING_CLAUSE' | 'AMBIGUOUS_CLAUSE' | 'CONFLICTING_SOURCES'; detail: string }>;
}

export type Analyze = (input: AnalysisInput, tools: AnalysisTools) => Promise<DraftAnswer>;
