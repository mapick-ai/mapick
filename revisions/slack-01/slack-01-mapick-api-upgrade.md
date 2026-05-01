# Slack Revision 01 - mapick-api Upgrade

## 范围

本文件只覆盖后端工程 [mapick-api](/Users/evan/projects/mapick/mapick-api) 的升级项。

对应模块：

- `recommend`
- `security`
- `assistant`
- `report`
- `skill`
- `sync`
- `user`
- `event`

## P0 升级项

### 1. 推荐质量修复

目标：

- 解决 Azure 刷量污染
- 让推荐结果从 popularity 排行榜变成场景匹配结果

主要改动点：

- [recommend.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/recommend/recommend.service.ts)
- [recommend.constants.ts](/Users/evan/projects/mapick/mapick-api/src/modules/recommend/recommend.constants.ts)
- [recommend.controller.ts](/Users/evan/projects/mapick/mapick-api/src/modules/recommend/recommend.controller.ts)
- [skill.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/skill/skill.service.ts)
- [sync.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/sync/sync.service.ts)

任务：

- 在推荐候选集中加入 publisher 去重
- 单一 publisher 最多保留 2 个 Skill
- 下调 popularity 权重
- 加大行为序列、已装技能缺口、用户画像标签的权重
- 对疑似刷量来源增加惩罚或过滤
- 为 Azure 类污染构建回归测试样本

验收：

- `TC04` 不再返回同源 Azure 堆叠结果
- Top 5 推荐结果具备明显场景相关性

### 2. Security 401 修复

目标：

- 恢复真实安全评分链路

主要改动点：

- [security.controller.ts](/Users/evan/projects/mapick/mapick-api/src/modules/security/security.controller.ts)
- [security-skill.controller.ts](/Users/evan/projects/mapick/mapick-api/src/modules/security/security-skill.controller.ts)
- [security.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/security/security.service.ts)
- [api-key.guard.ts](/Users/evan/projects/mapick/mapick-api/src/common/auth/api-key.guard.ts)
- [device-fp.guard.ts](/Users/evan/projects/mapick/mapick-api/src/common/auth/device-fp.guard.ts)
- [fp-or-api-key.guard.ts](/Users/evan/projects/mapick/mapick-api/src/common/auth/fp-or-api-key.guard.ts)

任务：

- 检查 `security` 路由的 guard 与其他接口是否一致
- 核对 API Key / Secret 读取与校验逻辑
- 增加最小联调验证脚本或测试
- 明确 401 是客户端参数缺失还是后端鉴权漂移

验收：

- `TC09` / `TC10` 返回真实安全评分
- 不再回退到纯启发式 fallback

### 3. Persona Brewing 支撑

目标：

- 后端在低数据量时支持“brewing”态，而不是返回全 0 报告数据

主要改动点：

- [report.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/report/report.service.ts)
- [report.controller.ts](/Users/evan/projects/mapick/mapick-api/src/modules/report/report.controller.ts)
- [message-renderer.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/assistant/message-renderer.service.ts)

任务：

- 明确人格报告的最小数据门槛
- 数据不足时返回可识别的 brewing 状态
- 避免生成可分享但内容全 0 的报告载荷

验收：

- `TC21` / `TC22` 不再出现全 0 完整报告

### 4. Onboarding 闭环

目标：

- 让首次使用流程能连续输出诊断、理解、推荐和安全信息

主要改动点：

- [assistant.controller.ts](/Users/evan/projects/mapick/mapick-api/src/modules/assistant/assistant.controller.ts)
- [skill-status.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/assistant/skill-status.service.ts)
- [intent.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/assistant/intent.service.ts)
- [sequence-analyzer.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/assistant/sequence-analyzer.service.ts)
- [message-renderer.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/assistant/message-renderer.service.ts)

任务：

- 验证首次安装后的诊断汇总是否真正触发
- 验证 workflow 问答是否接在状态诊断后
- 验证推荐结果是否带工作流上下文
- 验证安全评分是否进入安装决策链路

验收：

- 首次使用形成“发现问题 -> 理解场景 -> 推荐 -> 安全决策”闭环

## P1 升级项

### 5. 数据源一致性

目标：

- `status`、`report`、`assistant` 对同一用户输出一致的 Skill 数量

主要改动点：

- [skill-status.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/assistant/skill-status.service.ts)
- [report.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/report/report.service.ts)
- [user.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/user/user.service.ts)
- [event.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/event/event.service.ts)

任务：

- 盘点 `status`、`report`、`assistant` 的数据读取链路
- 统一单一真相源和数量口径
- 增加一致性回归测试

验收：

- 相同用户在同一时点，相关页面的 Skill 数量一致

### 6. 隐私链路后端对齐

目标：

- 后端行为与隐私状态页一致

主要改动点：

- [user.controller.ts](/Users/evan/projects/mapick/mapick-api/src/modules/user/user.controller.ts)
- [user.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/user/user.service.ts)
- [event.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/event/event.service.ts)

任务：

- 明确 consent 未设置时的接口行为
- 若严格模式，拦截 `recommend/search` 相关后端能力
- 若宽松模式，保证接口响应与前端文案一致
- 校验 `delete-all` 是否清理后端用户数据

验收：

- 隐私状态与接口行为不再冲突

## 测试建议

- 推荐污染回归测试
- `security` 鉴权回归测试
- 人格低数据量回归测试
- `status` / `report` 一致性测试
- consent 与删除行为测试

## 执行顺序

1. 推荐质量
2. Security 401
3. Persona Brewing 支撑
4. Onboarding 闭环
5. 数据源一致性
6. 隐私链路后端对齐

