import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import type { FastifyReply } from 'fastify';
import type { CreateAnalysisRequest, FollowUpRequest } from '../contracts.ts';
import type { AnalysisService, ServiceResult } from './analysis-service.ts';

const sessionCookie = 'toscan_session';

const errorStatus = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  ANALYSIS_BUSY: 409,
  NOT_IMPLEMENTED: 501,
  ANALYSIS_FAILED: 502,
  ANALYSIS_TIMEOUT: 504,
} as const;

const unavailable = (): Promise<ServiceResult<never>> =>
  Promise.resolve({ ok: false, code: 'NOT_IMPLEMENTED' });

const placeholderService: AnalysisService = {
  create: unavailable,
  followUp: unavailable,
  getDocument: unavailable,
  delete: unavailable,
};

function sendResult<T>(reply: FastifyReply, result: ServiceResult<T>, status: number) {
  if (result.ok) return reply.code(status).send(result.value);
  return reply.code(errorStatus[result.code]).send({ error: { code: result.code } });
}

interface AppOptions {
  analysisService?: AnalysisService;
  secureCookies?: boolean;
}

interface AnalysisParams {
  analysisId: string;
}

interface DocumentParams extends AnalysisParams {
  documentId: string;
}

export function buildApp({ analysisService = placeholderService, secureCookies = false }: AppOptions = {}) {
  const app = Fastify();
  app.register(cookie);

  app.get('/api/health', async () => ({ status: 'ok' }));

  app.post<{ Body: CreateAnalysisRequest }>('/api/analyses', async (request, reply) => {
    const result = await analysisService.create(request.body, request.cookies[sessionCookie]);
    if (!result.ok) return sendResult(reply, result, 201);

    if (result.value.sessionId) {
      reply.setCookie(sessionCookie, result.value.sessionId, {
        path: '/api',
        httpOnly: true,
        sameSite: 'lax',
        secure: secureCookies,
      });
    }

    return reply.code(201).send(result.value.answer);
  });

  app.post<{ Params: AnalysisParams; Body: FollowUpRequest }>(
    '/api/analyses/:analysisId/messages',
    async (request, reply) => {
      const result = await analysisService.followUp(
        request.params.analysisId, request.body, request.cookies[sessionCookie],
      );
      return sendResult(reply, result, 200);
    },
  );

  app.get<{ Params: DocumentParams }>('/api/analyses/:analysisId/documents/:documentId', async (request, reply) => {
    const { analysisId, documentId } = request.params;
    const result = await analysisService.getDocument(analysisId, documentId, request.cookies[sessionCookie]);
    return sendResult(reply, result, 200);
  });

  app.delete<{ Params: AnalysisParams }>('/api/analyses/:analysisId', async (request, reply) => {
    const result = await analysisService.delete(request.params.analysisId, request.cookies[sessionCookie]);
    return sendResult(reply, result, 204);
  });

  return app;
}
