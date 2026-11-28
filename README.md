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
| Bob | [分析模块说明](src/analysis/README.md)：模型配置、独立运行和后端接入。共享类型见 [analysis/contracts.ts](src/analysis/contracts.ts)。 |
| Carol | `src/server/analysis-service.ts` 提供 `AnalysisService`，通过 `buildApp` 注入。`config/default.json` 集中存放开发配置和各项限制。 |

当前启动入口使用占位服务，分析路由返回 `501 NOT_IMPLEMENTED`。配置中 `limits` 的分析、读取和会话上限供后续服务实现消费。

分析模块已支持根据现有材料生成 `DraftAnswer`，并在格式校验失败时最多修复一次。后端通过 `createAnalyze(model)` 接入；原文核验、会话保存和 HTTP 响应由服务层负责。具体用法见[分析模块说明](src/analysis/README.md)。
