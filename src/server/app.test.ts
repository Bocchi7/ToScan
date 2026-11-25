import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnswerResponse, CreateAnalysisRequest, DocumentSnapshot } from '../contracts.ts';
import type { AnalysisService } from './analysis-service.ts';
import { buildApp } from './app.ts';

const analysisUrl = '/api/analyses/a1';
const documentUrl = `${analysisUrl}/documents/d1`;
const sessionId = 'test-session';
const createRequest: CreateAnalysisRequest = {
  urls: ['https://example.org/terms'],
  question: 'May the platform display my work?',
  consentToModel: true,
};
const snapshot: DocumentSnapshot = {
  id: 'd1',
  title: 'Terms',
  url: 'https://example.org/terms',
  paragraphs: [{ id: 'p1', section: null, text: 'The platform may display uploaded works.' }],
};
const answer: AnswerResponse = {
  analysisId: 'a1',
  findings: [{ section: 'platformRights', text: 'The platform may display your work.', citationIds: ['q1'] }],
  citations: [{ id: 'q1', documentId: 'd1', paragraphId: 'p1', quote: snapshot.paragraphs[0].text }],
  sources: [{ id: snapshot.id, title: snapshot.title, url: snapshot.url }],
  gaps: [],
};

test('the analysis routes delegate to an injected service', async (context) => {
  const followUpRequest = { question: 'Does this cover advertising?', consentToModel: true };
  const service: AnalysisService = {
    async create(body, session) {
      assert.deepEqual(body, createRequest);
      assert.equal(session, undefined);
      return { ok: true, value: { answer, sessionId } };
    },
    async followUp(analysisId, body, session) {
      assert.equal(analysisId, answer.analysisId);
      assert.deepEqual(body, followUpRequest);
      assert.equal(session, sessionId);
      return { ok: true, value: answer };
    },
    async getDocument(analysisId, documentId, session) {
      assert.equal(analysisId, answer.analysisId);
      assert.equal(documentId, snapshot.id);
      if (session !== sessionId) return { ok: false, code: 'NOT_FOUND' };
      return { ok: true, value: snapshot };
    },
    async delete(analysisId, session) {
      assert.equal(analysisId, answer.analysisId);
      assert.equal(session, sessionId);
      return { ok: true, value: undefined };
    },
  };

  const app = buildApp({ analysisService: service, secureCookies: true });
  context.after(() => app.close());

  const create = await app.inject({ method: 'POST', url: '/api/analyses', payload: createRequest });
  assert.equal(create.statusCode, 201);
  assert.deepEqual(create.json(), answer);
  assert.match(String(create.headers['set-cookie']), /toscan_session=test-session; Path=\/api; HttpOnly; Secure; SameSite=Lax/);
  const cookies = { toscan_session: sessionId };

  const followUp = await app.inject({ method: 'POST', url: `${analysisUrl}/messages`, payload: followUpRequest, cookies });
  assert.equal(followUp.statusCode, 200);
  assert.deepEqual(followUp.json(), answer);

  const missingSession = await app.inject(documentUrl);
  assert.equal(missingSession.statusCode, 404);
  assert.deepEqual(missingSession.json(), { error: { code: 'NOT_FOUND' } });

  const document = await app.inject({ url: documentUrl, cookies });
  assert.equal(document.statusCode, 200);
  assert.deepEqual(document.json(), snapshot);

  const deletion = await app.inject({ method: 'DELETE', url: analysisUrl, cookies });
  assert.equal(deletion.statusCode, 204);
  assert.equal(deletion.body, '');
});

test('the default app exposes health and marks analysis as unimplemented', async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const health = await app.inject('/api/health');
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok' });

  const analysis = await app.inject({ method: 'POST', url: '/api/analyses', payload: createRequest });
  assert.equal(analysis.statusCode, 501);
  assert.deepEqual(analysis.json(), { error: { code: 'NOT_IMPLEMENTED' } });
});
