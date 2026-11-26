# ToScan

设计见[整体架构](architecture.md)和[分工与接口规格](interface-spec.md)。

## 本地运行

使用 Node.js 24 或更新版本。

```sh
npm ci
npm run dev
```

终端会显示 Vite 网页地址。网页通过 Vite 代理访问 `/api`，可用 `/api/health` 检查接线。`npm test` 使用模拟服务和模拟模型验证接口及分析模块，`npm run build` 检查类型并构建网页。浏览器扩展可在 Chrome 或 Edge 的扩展管理页以「加载已解压的扩展程序」加载 `extension/`。

## 开发入口

| 负责人 | 入口 |
| --- | --- |
| Alice | `web/src/` 和 `extension/` 包含网页及扩展入口，`src/contracts.ts` 提供共享 HTTP 类型。 |
| Bob | `src/analysis/index.ts` 提供 `createAnalyze(model)`；`contracts.ts` 保留共享接口；`fixtures/` 保存独立样例。 |
| Carol | `src/server/analysis-service.ts` 提供 `AnalysisService`，通过 `buildApp` 注入。`config/default.json` 集中存放开发配置和各项限制。 |

当前启动入口使用占位服务，分析路由返回 `501 NOT_IMPLEMENTED`。配置中的分析、读取和会话上限供后续服务实现消费。

## Bob：首版分析模块

目前支持一次模型调用：整理 `AnalysisInput` → 构造提示词 → 调用模型 → 校验 JSON → 返回 `DraftAnswer`。
历史材料和本轮成功材料按文档 ID 合并，保留首次快照、段落编号和原文；读取失败单独提供给模型。历史回答只用于理解对话，不作为协议证据。

文件职责：

| 文件 | 职责 |
| --- | --- |
| `src/analysis/index.ts` | 注入模型，执行分析，检查输入和输出长度。 |
| `src/analysis/prompt.ts` | 材料整理和提示词，明确引用、条件、例外和缺口要求。 |
| `src/analysis/model.ts` | `ModelClient` 接口和单次 Chat Completions 请求，支持超时与取消。 |
| `src/analysis/validation.ts` | 严格校验输出结构、枚举值、非空字段和引用数组。 |
| `src/analysis/errors.ts` | 可供 Carol 映射的内部错误码。 |
| `src/analysis/fixtures/` | 可读的 JSON 样例、检查点和模拟输出，详见目录内说明。 |

### 无需模型凭据的样例

```sh
npm run analysis:fixture -- --mock complete
npm run analysis:fixture -- --mock missing
npm test
npm run build
```

`complete` 提供两份插画协议，`missing` 只提供服务条款。模拟模型直接返回固定答案，只能验证程序流程，不能验证真实模型的分析质量。

### 使用真实模型

复制 `.env.example` 为 `.env`，填写 `TOSCAN_MODEL_API_KEY` 和 `TOSCAN_MODEL_NAME`；按服务需要填写 `TOSCAN_MODEL_BASE_URL`（API 根地址，例如包含 `/v1`，不要填到 `/chat/completions`）。模型需支持 Chat Completions、`response_format: json_object` 和 `max_completion_tokens`。JSON 模式仅保证 JSON 格式，程序仍会检查 `DraftAnswer` 结构。适配格式参见 [Chat Completions 文档](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。

```sh
npm run analysis:fixture -- complete
npm run analysis:fixture -- missing
```

命令会加载 `.env`，将固定模拟协议发送给配置的模型，向标准输出打印草稿，向标准错误输出打印人工核对项。真实模型回答无需与模拟答案逐字相同；重点检查授权条件、缺口和引用原文。真实模型评测还应加入协议内嵌干扰指令等样例。运行会产生模型服务调用。

### Carol 接入方式

```ts
import { createAnalyze, createModelFromEnv } from './src/analysis/index.ts';
import type { AnalysisInput, AnalysisTools } from './src/analysis/contracts.ts';

// 服务启动时创建一次；宿主负责加载环境变量。
const analyze = createAnalyze(createModelFromEnv());

export async function analyzePreparedMaterials(input: AnalysisInput, tools: AnalysisTools) {
  return analyze(input, tools);
}
```

`createAnalyze()` 返回现有 `Analyze` 类型的函数。测试时可传入 `{ generate: async () => JSON.stringify(mockDraft) }`。注入的模型实现应遵守 `signal`；内置适配器将其传给 HTTP 请求。

Bob 只检查草稿结构，不核验引用是否真实存在，也不保证引用在语义上支持结论。文档归属、指定段落中的连续子串校验、无效判断移除及 `CITATION_INVALID` 标记仍由 Carol 最终执行。全部材料不可用时应由 Carol 直接组装缺口响应；Bob 的 `NO_MATERIALS` 是防御性错误。

内部错误不直接作为 HTTP 错误码返回：

| 错误 | 含义及接入建议 |
| --- | --- |
| `INVALID_CONFIG` | 配置无效，在启动或创建模块时修正。 |
| `INPUT_TOO_LONG` | 组装后的提示词与材料超过首版长度限制；缩小输入，不能静默删掉关键证据。 |
| `NO_MATERIALS` | 没有可用正文，由服务处理材料缺口。 |
| `MODEL_REQUEST_FAILED` | 网络或模型服务失败，可映射为 `ANALYSIS_FAILED`。 |
| `MODEL_TIMEOUT` | 模型请求超时，可映射为 `ANALYSIS_TIMEOUT`。 |
| `MODEL_RESPONSE_INVALID` / `INVALID_DRAFT` | 截断、拒答、无效或超长输出，可映射为 `ANALYSIS_FAILED`。 |

取消会原样传播 `tools.signal.reason`；Carol 根据取消原因区分超时、删除和其他中止。模型请求和输出错误不会自动重试，也不会被包装成正常的空答案。服务端接线尚未实现，HTTP 路由仍为占位服务。

### 首版限制与后续扩展

`config/default.json` 的 `analysis` 配置控制输入长度、输出长度、请求超时和输出 token 上限。长度按 JavaScript UTF-16 字符单元计算，输入长度包含系统提示词及 JSON 上下文，**不是模型 token 计数，不能保证所有模型都不超上下文**。可通过 `createAnalyze(model, { maxInputChars, maxOutputChars })` 覆盖长度限制；模型请求参数可用 `.env.example` 中的可选变量覆盖。

首版不会调用 `readRelated`，也没有独立语义复核、RAG、历史压缩、背景知识库或多模型自动适配。后续保持 `Analyze` 接口，依次增加工具循环、服务联调、语义复核和上下文管理。
