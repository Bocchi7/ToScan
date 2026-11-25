# 首版分工与接口规格

依据开题文档的三人分工，以及已确定的独立网页、浏览器扩展和小范围内测方案。首版采用 TypeScript。网页和扩展由 Alice 维护，分析模块由 Bob 维护，Fastify 服务由 Carol 维护。Bob 的模块在服务进程内运行，跨模块接口通过共享类型约定。

## 分工边界

| 负责人 | 独立交付 | 依赖和验收方式 |
| --- | --- | --- |
| Alice | Chrome/Edge 扩展的当前页链接发现、勾选和跳转。网页的导入与手动输入、分析结果、原文定位、追问、清除对话及反馈表入口。 | 用模拟 HTTP 响应验证完整交互。扩展和网页通过 URL 约定对接。 |
| Bob | 问题理解、相关条款查找、候选链接选择、模型调用、条件与例外解释、引文选择，以及答案质量评估。 | 用固定协议材料和模拟 `readRelated` 验证分析。模型适配器支持注入测试替身。 |
| Carol | 浏览器会话、HTTP API、网页读取和渲染、正文及链接提取、材料编号、读取限制、答案结构与引文原文校验，以及内测部署。 | 用模拟分析模块验证 API、链接限制、来源定位、会话和错误处理。 |

Carol 维护共享接口类型和联调样例。Alice 和 Bob 各自维护本模块的模拟实现，三人用同一份协议样例联调。调整字段或行为时同步更新类型和样例，并请受影响的接口使用方确认。

## 扩展 → 网页

- 使用网页根路径的片段 `/#v=1&url=…&url=…`。扩展用 `URLSearchParams.append('url', value)` 编码，按勾选顺序传递完整 URL。接收端用 `getAll('url')` 读取，保留协议 URL 自带的查询参数和片段，以支持散列路由。导入和手动输入的链接在提交分析时由服务按同一配置校验。
- 网页读取片段后用 `history.replaceState` 清除跳转参数，将导入的链接填入可编辑表单。导入和手动输入用同一表单。未知版本或非法参数在页面上提示，并允许手动输入。点击提交时才把链接交给 API。
- 扩展仅传链接。扫描范围、链接排序和标签由 Alice 在扩展内维护。后台读取和正文抽取统一由 Carol 的服务实现。

## 网页 → 服务

所有接口同源。用户可直接发起分析，服务复用有效的浏览器会话。没有有效会话时，服务在分析成功后自动建立会话，并在响应中设置 `HttpOnly`、`SameSite=Lax` 的 Cookie，HTTPS 部署时启用 `Secure`。追问、回查和删除通过该 Cookie 校验记录归属。达到配置的会话闲置期限后清除整组会话数据。分析接口在一轮处理结束后返回 JSON，网页在此期间显示等待状态。

| 接口 | 请求 JSON | 成功响应 |
| --- | --- | --- |
| `POST /api/analyses` | `{ "urls": ["…"], "question": "…", "consentToModel": true }` | `201`，`AnswerResponse`。返回追问和回查需要的 `analysisId`，新建会话时同时设置 Cookie。 |
| `POST /api/analyses/:analysisId/messages` | `{ "question": "…", "additionalUrls": ["…"], "consentToModel": true }` | `200`，`AnswerResponse`。`additionalUrls` 可省略，服务加载此前材料与对话。 |
| `GET /api/analyses/:analysisId/documents/:documentId` |  | `200`，`DocumentSnapshot`。网页加载正文并定位引文的 `paragraphId`。 |
| `DELETE /api/analyses/:analysisId` |  | `204`，清除该对话及其材料快照。 |

初问的 URL 列表必填且非空，追问可追加链接。URL 必须是绝对的 HTTP(S) 地址，禁止包含用户名或密码。问题去掉首尾空白后须非空。网页校验必填项和格式，并展示模型发送说明。服务端再次校验，并按配置检查初问与追问的链接数量、单个 URL 的长度和问题长度。

后端按配置执行分析时限。同一对话的追问串行处理，处理中收到新的追问时返回 `ANALYSIS_BUSY`。超时或服务错误时保留此前已提交的对话，删除对话时中止其在途处理。

```ts
export interface CreateAnalysisRequest {
  urls: string[];
  question: string;
  consentToModel: true;
}

export interface FollowUpRequest {
  question: string;
  additionalUrls?: string[];
  consentToModel: true;
}

export interface ErrorResponse {
  error: {
    code:
      | 'INVALID_INPUT' | 'NOT_FOUND'
      | 'ANALYSIS_BUSY' | 'ANALYSIS_FAILED' | 'ANALYSIS_TIMEOUT';
  };
}

export type Section = 'conditions' | 'platformRights' | 'impact' | 'choices';

export interface Source {
  id: string;
  title: string;
  url: string;
}

export interface Paragraph {
  id: string;
  section: string | null;
  text: string;
}

export interface DocumentSnapshot extends Source {
  paragraphs: Paragraph[];
}

export interface CitationRef {
  documentId: string;
  paragraphId: string;
  quote: string;
}

export interface Citation extends CitationRef {
  id: string;
}

export interface Finding {
  section: Section;
  text: string;
  citationIds: string[];
}

export type ReadFailureCode =
  | 'BLOCKED_URL' | 'LOGIN_REQUIRED' | 'FETCH_FAILED' | 'TEXT_UNAVAILABLE';

export type Gap =
  | { code: ReadFailureCode; url: string }
  | { code: 'MISSING_CLAUSE' | 'AMBIGUOUS_CLAUSE' | 'CONFLICTING_SOURCES'; detail: string }
  | { code: 'BUDGET_EXHAUSTED' | 'CITATION_INVALID' };

export interface AnswerResponse {
  analysisId: string;
  findings: Finding[];
  citations: Citation[];
  sources: Source[];
  gaps: Gap[];
}
```

- `findings` 为本轮答案，每条对应一个展示区域并引用至少一个 `citationId`。每条引文都可以找到对应的 `source` 和快照段落。`sources` 列出本轮引用所用的文档。来源 URL 为服务实际读取的最终地址，文档和段落 ID 在同一对话中稳定。原文定位使用服务保留的提取快照，外部来源链接用于打开原网页。
- 有材料缺失或部分判断无法给出时仍返回成功响应，`gaps` 带上原因，`findings` 可以为空。Alice 将 `gaps` 展示为待确认事项，可按 `code` 显示固定文案，涉及补充材料时同时展示地址或 `detail`。全部当前及历史材料均无法使用时由服务组装此响应。
- 请求失败统一返回 `{ "error": { "code": "…" } }`。`400 INVALID_INPUT` 表示字段无效、输入超出配置限制或模型发送确认无效，`404 NOT_FOUND` 表示资源不存在或当前浏览器无法访问该资源，`409 ANALYSIS_BUSY` 表示该对话仍在处理，`502 ANALYSIS_FAILED` 表示本轮模型调用或输出失败，`504 ANALYSIS_TIMEOUT` 表示本轮超时。网页保留问题草稿。对话无法访问时，提示用户可重新发起分析。

## 服务 → 分析模块

Carol 调用 Bob 导出的 `analyze(input, tools)`。服务先读取用户提交的种子链接，再传入读取结果、已保存的材料和先前对话。分析模块可继续读取自己筛出的关联链接，返回解释和候选引文。服务完成最终校验、组装响应和会话保存。

```ts
export interface Candidate {
  id: string;
  url: string;
  label: string;
}

export interface Material {
  document: DocumentSnapshot;
  candidates: Candidate[];
}

export type ReadResult =
  | { ok: true; material: Material }
  | { ok: false; url: string; code: ReadFailureCode };

export type RelatedResult =
  | { candidateId: string; result: ReadResult }
  | { candidateId: string; code: 'UNKNOWN_CANDIDATE' | 'BUDGET_EXHAUSTED' };

export interface AnalysisInput {
  question: string;
  history: Array<{ question: string; answer: AnswerResponse }>;
  knownMaterials: Material[];
  seedResults: ReadResult[];
}

export interface AnalysisTools {
  signal: AbortSignal;
  readRelated(candidateIds: string[]): Promise<RelatedResult[]>;
}

export interface DraftAnswer {
  findings: Array<{ section: Section; text: string; citations: CitationRef[] }>;
  gaps: Array<{ code: 'MISSING_CLAUSE' | 'AMBIGUOUS_CLAUSE' | 'CONFLICTING_SOURCES'; detail: string }>;
}

export type Analyze = (input: AnalysisInput, tools: AnalysisTools) => Promise<DraftAnswer>;
```

- Carol 对所有文档请求、重定向和浏览器子请求执行公开地址校验。种子链接与关联链接共用读取器，先尝试 HTML，正文抽取失败时用隔离 Chromium。读取超时、响应大小和渲染尝试限制由配置控制。同一对话内复用文档首次成功取得的快照。
- `readRelated` 接受服务已分配给当前对话的候选 ID，按传入顺序返回结果。每轮可传多个 ID，Bob 可用已返回的材料选择后续候选。Carol 按服务端配置执行每次提交的补查轮次和新 URL 读取额度，包含种子链接、关联链接及失败读取，缓存命中不占读取额度。候选 ID 无法解析时返回 `UNKNOWN_CANDIDATE`，耗尽轮次或 URL 额度时返回 `BUDGET_EXHAUSTED`。
- Bob 负责判断引文是否支持结论，包括例外和适用条件。Carol 逐条核验文档归属、段落 ID 和引句。`quote` 必须是所指 `Paragraph.text` 的非空连续子串，以双方收到的同一快照为准。若一项判断无引用或存在无效引用，服务移除该判断及其未被使用的引用，并记录 `CITATION_INVALID`。服务合并实际读取失败、额度不足和 Bob 返回的待确认事项。读取结果、经校验的答案和本轮提问随成功响应一起保存，调用失败时撤销本轮暂存，保留之前的材料与对话。

## 联调样例与交付检查

固定样例使用 `example.org` 的模拟材料。本地测试用假读取器返回这些文档。

| 文档 | 段落及原文 | 关联候选 |
| --- | --- | --- |
| `d1` `/terms` | `p1` 上传作品即授予平台在服务内展示作品的许可。推广用途适用《内容授权规则》。 | `c1` → `/content-policy` |
| `d2` `/content-policy` | `p1` 平台将作品用于付费广告，须另行取得创作者授权。 | 无 |

Alice 可用以下响应验证引用跳转，Carol 使用相同快照提供 `GET`，Bob 使用种子 `d1` 和候选 `c1` 验证查证路径。段落 ID 在其文档内唯一。

```json
{
  "analysisId": "a1",
  "findings": [
    { "section": "platformRights", "text": "上传后平台可在服务内展示插画。将插画用于付费广告需要另行授权。", "citationIds": ["q1", "q2"] }
  ],
  "citations": [
    { "id": "q1", "documentId": "d1", "paragraphId": "p1", "quote": "上传作品即授予平台在服务内展示作品的许可。" },
    { "id": "q2", "documentId": "d2", "paragraphId": "p1", "quote": "平台将作品用于付费广告，须另行取得创作者授权。" }
  ],
  "sources": [
    { "id": "d1", "title": "服务条款", "url": "https://example.org/terms" },
    { "id": "d2", "title": "内容授权规则", "url": "https://example.org/content-policy" }
  ],
  "gaps": []
}
```

1. **Alice** 在新浏览器中验证可以直接手动提交或从扩展导入后提交，并打开引用段落。用缺材料、接口超时和对话不可访问的模拟响应验证相应界面。
2. **Bob** 用问题「上传原创插画后，平台能把它用于付费广告吗？」验证主动补查 `c1`。模拟 `c1` 无法读取，答案应保留材料支持的展示许可，并把广告用途列为待确认。补充一组隐私条款样例验证共享、留存和删除。
3. **Carol** 用模拟分析模块验证首次提交可自动建立会话，当前浏览器可追问、回查和删除，缺少有效会话或属于其他会话时返回 `404`。用不同的测试配置验证输入和补查限额、分析超时及会话过期，确认追问超时后此前对话仍可使用。构造同时含有效和无效引句的答案，确认有效判断仍可回查。
4. **三人联调** 从扩展导入服务条款，完成首次分析、打开原文和追问。阻断关联文档后复测同一流程，确认后端、分析与网页对缺失材料的处理一致。
