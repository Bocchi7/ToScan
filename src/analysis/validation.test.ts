import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadFixture } from './fixtures/index.ts';
import { parseDraftAnswer } from './validation.ts';

test('allows empty findings and all documented gap types', () => {
  const draft = { findings: [], gaps: ['MISSING_CLAUSE', 'AMBIGUOUS_CLAUSE', 'CONFLICTING_SOURCES'].map(code => ({ code, detail: '需要确认适用条件' })) };
  assert.deepEqual(parseDraftAnswer(JSON.stringify(draft)), draft);
  assert.deepEqual(parseDraftAnswer('{"findings":[],"gaps":[]}'), { findings: [], gaps: [] });
});

test('preserves exact quote whitespace; does not claim to verify source truth', () => {
  const draft = JSON.parse(loadFixture('complete').mockOutput);
  draft.findings[0].citations[0].quote = ' 保留\n原文 ';
  assert.equal(parseDraftAnswer(JSON.stringify(draft)).findings[0].citations[0].quote, ' 保留\n原文 ');
});

test('schema feedback identifies the invalid field and expected type', () => {
  assert.throws(() => parseDraftAnswer('{"findings":[],"gaps":"missing"}'), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /gaps.*array/);
    return true;
  });
});

test('rejects malformed JSON and invalid shapes, fields, enums and empty citations', () => {
  const valid = JSON.parse(loadFixture('complete').mockOutput);
  const invalid = [
    null, [], {}, { findings: [] }, { findings: {}, gaps: [] },
    { ...valid, extra: true },
    { ...valid, findings: [{ ...valid.findings[0], section: 'summary' }] },
    { ...valid, findings: [{ ...valid.findings[0], text: '  ' }] },
    { ...valid, findings: [{ ...valid.findings[0], citations: [] }] },
    { ...valid, findings: [{ ...valid.findings[0], citations: [{ documentId: 'd1', paragraphId: 'p1' }] }] },
    { ...valid, findings: [{ ...valid.findings[0], citations: [{ documentId: 'd1', paragraphId: 1, quote: 'text' }] }] },
    { ...valid, findings: [{ ...valid.findings[0], citations: [{ documentId: 'd1', paragraphId: 'p1', quote: ' ' }] }] },
    { ...valid, gaps: [{ code: 'CITATION_INVALID', detail: 'server-only code' }] },
    { ...valid, gaps: [{ code: 'MISSING_CLAUSE', detail: '' }] },
  ];
  for (const value of invalid) {
    assert.throws(() => parseDraftAnswer(JSON.stringify(value)), { code: 'INVALID_DRAFT' });
  }
  for (const raw of ['not JSON', '```json\n{}\n```', '{"findings":']) {
    assert.throws(() => parseDraftAnswer(raw), { code: 'INVALID_DRAFT' });
  }
});
