# ToScan

设计见[整体架构](architecture.md)和[分工与接口规格](interface-spec.md)。

## 本地运行

使用 Node.js 24 或更新版本。

```sh
npm ci
npm run dev
```

终端会显示 Vite 网页地址。网页通过 Vite 代理访问 `/api`，可用 `/api/health` 检查接线。`npm test` 以注入的模拟服务验证分析接口，`npm run build` 检查类型并构建网页。浏览器扩展可在 Chrome 或 Edge 的扩展管理页以「加载已解压的扩展程序」加载 `extension/`。

## 开发入口

| 负责人 | 入口 |
| --- | --- |
| Alice | `web/src/` 和 `extension/` 包含网页及扩展入口，`src/contracts.ts` 提供共享 HTTP 类型。 |
| Bob | `src/analysis/contracts.ts` 提供 `Analyze`、材料和补查工具类型。 |
| Carol | `src/server/analysis-service.ts` 提供 `AnalysisService`，通过 `buildApp` 注入。`config/default.json` 集中存放开发配置和各项限制。 |

当前启动入口使用占位服务，分析路由返回 `501 NOT_IMPLEMENTED`。配置中的分析、读取和会话上限供后续服务实现消费。
