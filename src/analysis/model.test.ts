import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatModel, createModelFromEnv } from './model.ts';

const options = { baseUrl: 'https://model.example/v1/', apiKey: 'test-secret', model: 'test-model', timeoutMs: 1000, maxCompletionTokens: 100 };
const input = () => ({ system: 'Return JSON.', user: '{"question":"test"}', signal: new AbortController().signal });
const answer = '{"findings":[],"gaps":[]}';
const success = () => Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: answer } }] });

test('adapter sends one configured JSON request and passes cancellation', async () => {
  let calls = 0;
  const model = createChatModel(options, async (url, init) => {
    calls++;
    assert.equal(url, 'https://model.example/v1/chat/completions');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-secret');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'test-model');
    assert.equal(body.max_completion_tokens, 100);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.deepEqual(body.messages.map((message: { role: string }) => message.role), ['system', 'user']);
    assert.equal(body.stream, false);
    assert.ok(!('tools' in body));
    assert.ok(init?.signal);
    return success();
  });
  assert.equal(await model.generate(input()), answer);
  assert.equal(calls, 1);
});

test('rejects unsuccessful, truncated, refused, empty and malformed responses', async () => {
  const responses: Array<[Response, string]> = [
    [new Response('provider secret', { status: 401 }), 'MODEL_REQUEST_FAILED'],
    [new Response('not JSON'), 'MODEL_RESPONSE_INVALID'],
    [Response.json({ choices: [] }), 'MODEL_RESPONSE_INVALID'],
    ...['length', 'tool_calls', 'content_filter'].map(reason => [Response.json({ choices: [{ finish_reason: reason, message: { content: answer } }] }), 'MODEL_RESPONSE_INVALID'] as [Response, string]),
    [Response.json({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }), 'MODEL_RESPONSE_INVALID'],
    [Response.json({ choices: [{ finish_reason: 'stop', message: { content: answer, refusal: 'refused' } }] }), 'MODEL_RESPONSE_INVALID'],
  ];
  for (const [response, code] of responses) {
    let calls = 0;
    await assert.rejects(createChatModel(options, async () => { calls++; return response; }).generate(input()), { code });
    assert.equal(calls, 1);
  }
  await assert.rejects(createChatModel(options, async () => { throw new Error('test-secret'); }).generate(input()), error => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes('test-secret'));
    return true;
  });
});

test('external cancellation interrupts the fetch and stays an AbortError', async () => {
  const controller = new AbortController();
  const model = createChatModel(options, async (_url, init) => {
    controller.abort();
    assert.ok(init?.signal?.aborted);
    throw init.signal.reason;
  });
  await assert.rejects(model.generate({ ...input(), signal: controller.signal }), { name: 'AbortError' });
});

test('request timeout also applies while waiting for a response', async () => {
  const model = createChatModel({ ...options, timeoutMs: 10 }, async (_url, init) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
  });
  // AbortSignal.timeout uses an unref'ed timer; keep the test process alive.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(model.generate(input()), { code: 'MODEL_TIMEOUT' });
  } finally {
    clearTimeout(keepAlive);
  }
});

test('invalid configuration fails before sending credentials', () => {
  for (const patch of [
    { baseUrl: 'not a URL' }, { baseUrl: 'file:///tmp/model' },
    { baseUrl: 'https://user:password@model.example/v1' },
    { baseUrl: 'https://model.example/v1?key=secret' },
    { apiKey: '' }, { model: '' }, { timeoutMs: 0 }, { maxCompletionTokens: -1 },
  ]) {
    assert.throws(() => createChatModel({ ...options, ...patch }), { code: 'INVALID_CONFIG' });
  }
  assert.throws(() => createModelFromEnv({}), { code: 'INVALID_CONFIG' });
  assert.throws(() => createModelFromEnv({ TOSCAN_MODEL_API_KEY: 'key', TOSCAN_MODEL_NAME: 'model', TOSCAN_MODEL_TIMEOUT_MS: 'bad' }), { code: 'INVALID_CONFIG' });
});
