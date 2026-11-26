import type { DraftAnswer } from './contracts.ts';
import { AnalysisError } from './errors.ts';

function invalid(path: string): never {
  throw new AnalysisError('INVALID_DRAFT', `模型输出结构无效：${path}`);
}

function object(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) {
    invalid(path);
  }
  return record;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(path);
  // Preserve quotes exactly; normalization belongs neither here nor in the prompt.
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], path: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) invalid(path);
  return value as T;
}

/** Validates shape only. Carol verifies ownership and exact quotes against snapshots. */
export function parseDraftAnswer(raw: string): DraftAnswer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalid('JSON');
  }
  const root = object(parsed, ['findings', 'gaps'], 'root');
  const findings = array(root.findings, 'findings').map((value, index) => {
    const path = `findings[${index}]`;
    const finding = object(value, ['section', 'text', 'citations'], path);
    const citations = array(finding.citations, `${path}.citations`).map((value, citationIndex) => {
      const refPath = `${path}.citations[${citationIndex}]`;
      const ref = object(value, ['documentId', 'paragraphId', 'quote'], refPath);
      return {
        documentId: text(ref.documentId, `${refPath}.documentId`),
        paragraphId: text(ref.paragraphId, `${refPath}.paragraphId`),
        quote: text(ref.quote, `${refPath}.quote`),
      };
    });
    if (!citations.length) invalid(`${path}.citations`);
    return {
      section: oneOf(finding.section, ['conditions', 'platformRights', 'impact', 'choices'] as const, `${path}.section`),
      text: text(finding.text, `${path}.text`),
      citations,
    };
  });
  const gaps = array(root.gaps, 'gaps').map((value, index) => {
    const path = `gaps[${index}]`;
    const gap = object(value, ['code', 'detail'], path);
    return {
      code: oneOf(gap.code, ['MISSING_CLAUSE', 'AMBIGUOUS_CLAUSE', 'CONFLICTING_SOURCES'] as const, `${path}.code`),
      detail: text(gap.detail, `${path}.detail`),
    };
  });
  return { findings, gaps };
}
