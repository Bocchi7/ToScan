# 分析样例

按场景保存数据。当前 `illustration-license/` 来自 `interface-spec.md` 的联调示例，是自定义的短协议，不是真实平台协议；`example.org` 地址不用于实际抓取。

| 文件 | 用途 |
| --- | --- |
| `materials.json` | 两份符合 `Material` 结构的协议原文，保留文档、段落及候选链接 ID。 |
| `input.json` | 完整材料场景的问题、历史、已有材料 ID 和本轮材料 ID。 |
| `input-missing.json` | 只提供 d1 的场景，d2 正文未提供；不模拟一次已经发生的读取失败。 |
| `expectations.json` | 必需引用、缺口预期和人工语义核对项，不要求逐字匹配答案。 |
| `mock-answer.json` | 材料齐全时的模拟模型输出。 |
| `mock-answer-missing.json` | 材料缺失时的模拟模型输出。 |

`index.ts` 将 `knownMaterialIds`、`seedMaterialIds` 解析为真正的 `AnalysisInput`。这两个字段仅属于样例格式，不是生产接口字段。`loadFixture()` 每次返回独立数据，测试修改不会影响下一次运行。

测试中的 mock 是“返回固定输出的模型函数”；JSON 文件本身是 fixture。自动测试检查数据与程序行为，不证明真实模型会生成正确判断。真实模型验收需对照 `expectations.json` 人工检查结论与引用。
