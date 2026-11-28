import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatModel, createModelFromEnv } from './model.ts';
import type { ChatModelOptions } from './model.ts';
import { AnalysisError } from './errors.ts';

const options = { baseUrl: 'https://model.example/v1/', apiKey: 'test-secret', model: 'deepseek-flash', timeoutMs: 1000, maxCompletionTokens: 100 };
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
    assert.equal(body.model, 'deepseek-flash');
    assert.equal(body.max_tokens, 100);
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

test('output cap is omitted by default and only sent for explicit positive limits', async context => {
  const requests: Array<Record<string, unknown>> = [];
  const fetcher: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return success();
  };
  context.mock.method(globalThis, 'fetch', fetcher);
  await createChatModel({ ...options, maxCompletionTokens: undefined }, fetcher).generate(input());
  for (const limit of [undefined, '', '   ', '8192']) {
    await createModelFromEnv({ DEEPSEEK_API_KEY: 'test-secret', TOSCAN_MODEL_MAX_COMPLETION_TOKENS: limit }).generate(input());
  }
  assert.equal(requests.length, 5);
  for (const body of requests.slice(0, 4)) {
    assert.ok(!('max_tokens' in body));
    assert.ok(!('max_completion_tokens' in body));
  }
  assert.equal(requests[4].max_tokens, 8192);
  for (const limit of ['0', '-1', '1.5', 'bad', 'Infinity']) {
    assert.throws(() => createModelFromEnv({ DEEPSEEK_API_KEY: 'test-secret', TOSCAN_MODEL_MAX_COMPLETION_TOKENS: limit }), { code: 'INVALID_CONFIG' });
  }
  assert.equal(requests.length, 5);
});

test('rejects unsuccessful, truncated, refused, empty and malformed responses', async () => {
  const responses: Array<[Response, string]> = [
    [new Response('provider secret', { status: 401 }), 'MODEL_REQUEST_FAILED'],
    [new Response('rate limit', { status: 429 }), 'MODEL_REQUEST_FAILED'],
    [new Response('unavailable', { status: 503 }), 'MODEL_REQUEST_FAILED'],
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
  let networkCalls = 0;
  await assert.rejects(createChatModel(options, async () => { networkCalls++; throw new Error('test-secret'); }).generate(input()), error => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes('test-secret'));
    return true;
  });
  assert.equal(networkCalls, 1);
});

test('invalid responses retain finish reason, exact content and token usage for diagnostics', async () => {
  for (const rawContent of ['  {"findings": [\n', '', null]) {
    const model = createChatModel(options, async () => Response.json({
      choices: [{ finish_reason: 'length', message: { content: rawContent } }],
      usage: { completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 80 } },
    }));
    await assert.rejects(model.generate(input()), error => {
      assert.ok(error instanceof AnalysisError);
      assert.equal(error.code, 'MODEL_RESPONSE_INVALID');
      assert.deepEqual(error.diagnostics, {
        finishReason: 'length', rawContent, maxCompletionTokens: 100,
        completionTokens: 100, reasoningTokens: 80,
      });
      return true;
    });
  }
  await assert.rejects(createChatModel(options, async () => Response.json({ choices: [] })).generate(input()), error => {
    assert.ok(error instanceof AnalysisError);
    assert.equal(error.diagnostics?.finishReason, null);
    assert.equal(error.diagnostics?.rawContent, null);
    return true;
  });
});

test('DeepSeek uses max_tokens and explicit thinking parameters, preserving final content only', async () => {
  for (const thinking of ['enabled', 'disabled'] as const) {
    const model = createChatModel({ ...options, provider: 'deepseek', thinking, reasoningEffort: 'high' }, async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_tokens, 100);
      assert.ok(!('max_completion_tokens' in body));
      assert.deepEqual(body.thinking, { type: thinking });
      assert.equal(body.reasoning_effort, thinking === 'enabled' ? 'high' : undefined);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: answer, reasoning_content: 'internal reasoning', tool_calls: [] } }] });
    });
    assert.equal(await model.generate(input()), answer);
  }
});

test('effort aliases pass through both configuration entry points and are omitted when thinking is disabled', async context => {
  const requests: Array<Record<string, unknown>> = [];
  const fetcher: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return success();
  };
  context.mock.method(globalThis, 'fetch', fetcher);
  for (const effort of ['minimal', 'medium', 'xhigh'] as const) {
    for (const thinking of ['enabled', 'disabled'] as const) {
      await createChatModel({ ...options, thinking, reasoningEffort: effort }, fetcher).generate(input());
      await createModelFromEnv({
        DEEPSEEK_API_KEY: 'test-secret',
        TOSCAN_MODEL_THINKING: thinking,
        TOSCAN_MODEL_REASONING_EFFORT: effort,
      }).generate(input());
      for (const body of requests.splice(0)) {
        assert.deepEqual(body.thinking, { type: thinking });
        assert.equal(body.reasoning_effort, thinking === 'enabled' ? effort : undefined);
      }
    }
  }
});

test('DeepSeek environment configuration uses its defaults and key fallback', async context => {
  const requests: Array<{ url: unknown; headers: Headers; body: Record<string, unknown> }> = [];
  context.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    requests.push({ url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
    return success();
  });
  await createModelFromEnv({ DEEPSEEK_API_KEY: 'fallback-key' }).generate(input());
  assert.equal(requests[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(requests[0].headers.get('authorization'), 'Bearer fallback-key');
  assert.equal(requests[0].body.model, 'deepseek-flash');
  assert.deepEqual(requests[0].body.thinking, { type: 'enabled' });
  assert.equal(requests[0].body.reasoning_effort, 'high');
  await createModelFromEnv({ TOSCAN_MODEL_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'fallback-key', TOSCAN_MODEL_API_KEY: 'preferred-key', TOSCAN_MODEL_THINKING: 'disabled' }).generate(input());
  assert.equal(requests[1].headers.get('authorization'), 'Bearer preferred-key');
  assert.equal(requests[1].body.reasoning_effort, undefined);
});

test('unsupported provider/model combinations fail at initialization with zero requests', context => {
  let calls = 0;
  const fetcher = async () => { calls++; return success(); };
  context.mock.method(globalThis, 'fetch', fetcher);
  for (const [provider, model] of [
    ['deepseek', 'unknown-model'],
    ['deepseek', 'deepseek-flash-typo'],
    ['deepseek', 'deepseek-v4-pro'],
    ['deepseek', 'gpt-4.1'],
    ['openai', 'deepseek-flash'],
    ['openai', 'gpt-4.1'],
    ['kimi', 'deepseek-flash'],
    ['glm', 'deepseek-flash'],
    ['', 'deepseek-flash'],
  ]) {
    const expected = { code: 'INVALID_CONFIG', message: /仅支持 deepseek \/ deepseek-flash/ };
    // Runtime callers can bypass TypeScript, so validate both entry points.
    assert.throws(() => createChatModel({ ...options, provider, model } as ChatModelOptions, fetcher), expected);
    assert.throws(() => createModelFromEnv({
      TOSCAN_MODEL_PROVIDER: provider,
      TOSCAN_MODEL_NAME: model,
      TOSCAN_MODEL_API_KEY: 'test-secret',
    }), expected);
  }
  assert.equal(calls, 0);
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
  assert.throws(() => createModelFromEnv({ TOSCAN_MODEL_API_KEY: 'key', TOSCAN_MODEL_NAME: 'deepseek-flash', TOSCAN_MODEL_TIMEOUT_MS: 'bad' }), { code: 'INVALID_CONFIG' });
  for (const env of [
    { TOSCAN_MODEL_PROVIDER: 'unknown' },
    { TOSCAN_MODEL_PROVIDER: 'deepseek', TOSCAN_MODEL_THINKING: 'maybe' },
    { TOSCAN_MODEL_PROVIDER: 'deepseek', TOSCAN_MODEL_REASONING_EFFORT: 'wrong' },
    { TOSCAN_MODEL_PROVIDER: 'openai', TOSCAN_MODEL_API_KEY: 'key', TOSCAN_MODEL_NAME: 'model', TOSCAN_MODEL_THINKING: 'enabled' },
  ]) assert.throws(() => createModelFromEnv(env), { code: 'INVALID_CONFIG' });
});
