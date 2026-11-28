# 分析模块

[返回项目说明](../../README.md) · [共享接口](contracts.ts) · [样例说明](fixtures/README.md)

本文面向分析模块开发和服务端接入。下文命令均在 **ToScan 项目根目录**执行，`.env` 也放在项目根目录。

目前支持单次分析和最多一次格式修复：整理 `AnalysisInput` → 构造提示词 → 通过 OpenAI SDK 调用模型 → 用 Zod 校验 JSON → 返回 `DraftAnswer`。JSON 解析或结构校验失败时，追加原回答和具体错误，再请求一次完整答案；第二次仍无效就报错。
历史材料和本轮成功材料按文档 ID 合并，保留首次快照、段落编号和原文；读取失败单独提供给模型。历史回答只用于理解对话，不作为协议证据。

文件职责：

| 文件 | 职责 |
| --- | --- |
| [index.ts](index.ts) | 注入模型，执行分析，检查输入和输出长度。 |
| [prompt.ts](prompt.ts) | 材料整理和提示词，明确引用、条件、例外和缺口要求。 |
| [model.ts](model.ts) | `ModelClient` 接口，通过 OpenAI SDK 请求 OpenAI / DeepSeek，处理参数差异、超时与取消。 |
| [validation.ts](validation.ts) | Zod schema 严格校验结构、枚举值、非空字段和引用数组，提供格式修复反馈。 |
| [errors.ts](errors.ts) | 可供 Carol 映射的内部错误码。 |
| [fixtures/](fixtures/README.md) | 可读的 JSON 样例、检查点和模拟输出，详见目录内说明。 |

## 无需模型凭据的样例

```sh
npm run analysis:fixture -- --mock complete
npm run analysis:fixture -- --mock missing
npm test
npm run build
```

`complete` 提供两份插画协议，`missing` 只提供服务条款。模拟模型直接返回固定答案，只能验证程序流程，不能验证真实模型的分析质量。

## 使用真实模型

复制项目根目录的 [.env.example](../../.env.example) 为 `.env`。模板已配置 DeepSeek，填写密钥即可：

```dotenv
TOSCAN_MODEL_PROVIDER=deepseek
TOSCAN_MODEL_BASE_URL=https://api.deepseek.com
TOSCAN_MODEL_API_KEY=你的DeepSeek密钥
TOSCAN_MODEL_NAME=deepseek-flash
TOSCAN_MODEL_THINKING=enabled
TOSCAN_MODEL_REASONING_EFFORT=high
```

DeepSeek 模式也可以读取 `DEEPSEEK_API_KEY`，非空的 `TOSCAN_MODEL_API_KEY` 优先。服务地址应填 API 根地址，不要包含 `/chat/completions`。思考模式支持 `enabled` / `disabled`，思考强度支持 `minimal` / `low` / `medium` / `high` / `xhigh` / `max`，原样发送给服务端，其中 `minimal` 是 `low` 的兼容别名，`medium` 和 `xhigh` 都是 `high` 的兼容别名。关闭思考请设置 `thinking: disabled`，此时不发送强度参数；本模块不接受 effort 为 `none`。DeepSeek 模式默认地址、模型、思考开关和强度与上面的示例相同。

当前仅开放 `deepseek / deepseek-flash`，未配置 provider 时默认 `deepseek`。其他服务商或模型名（包括拼写错误）会在初始化时返回 `INVALID_CONFIG`，不发送请求。OpenAI、Kimi、GLM 和其他 DeepSeek 模型需完成适配并加入支持列表后才能使用；使用 OpenAI SDK 不代表自动支持所有兼容模型。

请求使用 Chat Completions 和 `response_format: json_object`。默认不发送输出 token 上限，使用服务商默认限制；需要限制时设置 `TOSCAN_MODEL_MAX_COMPLETION_TOKENS` 为正整数，请求将发送对应的 `max_tokens`。环境变量未设置或留空都表示不发送上限，非空非法值会在请求前报错。代码调用也可通过 `maxCompletionTokens` 显式设置。JSON 模式不保证字段符合 `DraftAnswer`，仍须本地 Zod 校验。参见 [DeepSeek 接口文档](https://api-docs.deepseek.com/api/create-chat-completion/)。

```sh
npm run analysis:fixture -- complete
npm run analysis:fixture -- missing
```

命令会加载 `.env`，将固定模拟协议发送给配置的模型，向标准输出打印草稿，向标准错误输出打印人工核对项。真实模型回答无需与模拟答案逐字相同；重点检查授权条件、缺口和引用原文。真实模型评测还应加入协议内嵌干扰指令等样例。运行会产生模型服务调用。

开启思考后可能需要更多输出 token 和时间。若返回截断错误或超时，请按实际模型调整输出上限和单次请求超时；格式修复不会自动放宽这些限制，也不会对截断答案重试。

## Carol 接入方式

```ts
// 在 src/server/ 下的服务文件中接入
import { createAnalyze, createModelFromEnv } from '../analysis/index.ts';
import type { AnalysisInput, AnalysisTools } from '../analysis/contracts.ts';

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
| `MODEL_RESPONSE_INVALID` | 响应截断、拒答、为空、无效或超长，不做格式修复，可映射为 `ANALYSIS_FAILED`。 |
| `INVALID_DRAFT` | JSON 或 Zod 结构校验失败；最多修复一次后仍失败才抛出，可映射为 `ANALYSIS_FAILED`。 |

取消会原样传播 `tools.signal.reason`；Carol 根据取消原因区分超时、删除和其他中止。SDK 的网络重试关闭（`maxRetries: 0`）；只有 JSON 解析或 Zod 校验失败触发一次格式修复，因此一轮分析最多调用模型两次。网络错误、超时、拒答、截断和超长输出不会触发格式重试。

修复请求保留原始问题和材料，追加原草稿及最多六项校验错误，不自动补字段或编造引用。追加内容也受输入长度上限约束；超限时在第二次调用前停止。两次请求共用 Carol 传入的取消信号，整轮时限仍由 Carol 管理，单次超时不会变成整轮超时。服务端接线尚未实现，HTTP 路由仍为占位服务。

## 首版限制与后续扩展

[config/default.json](../../config/default.json) 的 `analysis` 配置控制输入长度、输出长度和请求超时，不设置默认输出 token 上限。长度按 JavaScript UTF-16 字符单元计算，输入长度包含系统提示词及 JSON 上下文，**不是模型 token 计数，不能保证所有模型都不超上下文**。可通过 `createAnalyze(model, { maxInputChars, maxOutputChars })` 覆盖长度限制；模型请求参数可用 [.env.example](../../.env.example) 中的可选变量覆盖。

首版不会调用 `readRelated`，也没有独立语义复核、RAG、历史压缩、背景知识库或多模型自动适配。后续保持 `Analyze` 接口，依次增加工具循环、服务联调、语义复核和上下文管理。
