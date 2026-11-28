import { z } from 'zod';
import type { DraftAnswer } from './contracts.ts';
import { AnalysisError } from './errors.ts';

// Check whitespace without transforming the original quote.
const nonEmptyText = z.string().refine(value => value.trim().length > 0, '必须是非空字符串');

export const draftAnswerSchema = z.strictObject({
  findings: z.array(z.strictObject({
    section: z.enum(['conditions', 'platformRights', 'impact', 'choices']),
    text: nonEmptyText,
    citations: z.array(z.strictObject({
      documentId: nonEmptyText,
      paragraphId: nonEmptyText,
      quote: nonEmptyText,
    })).min(1, '每条判断至少需要一条引用'),
  })),
  gaps: z.array(z.strictObject({
    code: z.enum(['MISSING_CLAUSE', 'AMBIGUOUS_CLAUSE', 'CONFLICTING_SOURCES']),
    detail: nonEmptyText,
  })),
});

/** Shape only. Carol verifies ownership and exact quotes against snapshots. */
export function parseDraftAnswer(raw: string): DraftAnswer {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AnalysisError('INVALID_DRAFT', 'JSON 无法解析。请输出一个完整 JSON 对象，不要代码围栏或前后说明。');
  }
  const result = draftAnswerSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 6).map(issue =>
      `${issue.path.map(String).join('.') || 'root'}: ${issue.message}`.slice(0, 240),
    ).join('\n');
    throw new AnalysisError('INVALID_DRAFT', `模型输出结构无效：\n${issues}`);
  }
  return result.data;
}
