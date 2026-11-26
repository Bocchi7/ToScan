import { createAnalyze, createModelFromEnv, AnalysisError } from './index.ts';
import { loadFixture } from './fixtures/index.ts';

const args = process.argv.slice(2);
const cases = args.filter(arg => arg !== '--mock');
if (cases.length > 1 || (cases[0] !== undefined && !['complete', 'missing'].includes(cases[0]))) {
  console.error('用法：npm run analysis:fixture -- [--mock] [complete|missing]');
  process.exitCode = 1;
} else {
  const fixture = loadFixture(cases[0] === 'missing' ? 'missing' : 'complete');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  try {
    const mock = args.includes('--mock');
    console.error(mock ? '模拟模型：仅验证程序流程，不代表真实模型分析质量。' : '真实模型：将发送固定模拟协议材料。');
    const model = mock ? { generate: async () => fixture.mockOutput } : createModelFromEnv();
    const draft = await createAnalyze(model)(fixture.input, {
      signal: controller.signal,
      readRelated: async () => { throw new Error('首版未启用补查工具'); },
    });
    console.log(JSON.stringify(draft, null, 2));
    console.error('人工核对项：\n' + fixture.expectations.reviewChecklist.map(item => `- ${item}`).join('\n'));
  } catch (error) {
    console.error(controller.signal.aborted ? '分析已取消。' : error instanceof AnalysisError ? `${error.code}: ${error.message}` : '样例运行失败。');
    process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener('SIGINT', cancel);
  }
}
