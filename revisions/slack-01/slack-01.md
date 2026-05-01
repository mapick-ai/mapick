# Slack Revision 01

拆分文件：

- 后端升级：[slack-01-mapick-api-upgrade.md](/Users/evan/projects/mapick/revisions/slack-01-mapick-api-upgrade.md)
- Skill 端升级：[slack-01-mapickii-upgrade.md](/Users/evan/projects/mapick/revisions/slack-01-mapickii-upgrade.md)

## 原始问题汇总

要修的 5 个问题：

1. 推荐接口返回 Azure 垃圾数据（TC04）
   `/mapickii recommend` 返回的全是 Azure 相关 Skill（`azure-ai`、`azure-cost-optimization`、`azure-deploy`），安装量都是 15 万+，跟用户场景完全无关。
   这是后端 sync 数据问题。数据源里 Azure Skill 被刷量了，推荐算法按 popularity 排序就全是 Azure。
   需要在推荐算法里加去重逻辑：同一个 publisher 的 Skill 最多出 2 个，并降低纯 popularity 权重。

2. 安全评分后端 401（TC09/TC10）
   `security` 接口返回 401，Agent 只能做 fallback 的启发式分析。
   需要工程师查后端 auth 配置，可能是 API Key / Secret 没传对，或者 `security` 接口的鉴权逻辑和其他接口不一致。

3. 人格报告全是零还出完整报告（TC21/TC22）
   在 `SKILL.md` 里已经改过：数据不够时应该显示 `:lock: Your persona is brewing...` 卡片，不应该输出全是 0 的完整报告。
   需要确认工程侧是否还没有部署新的 `SKILL.md` 版本。

4. 人格报告和状态页的 Skill 数量不一致
   `status` 显示 6 个已安装，`report` 显示 0 个。
   说明 `report` 和 `status` 读取的数据源不同，一个读本地 scan，一个读后端。
   需要统一数据源。

5. `help` 暴露了 device fingerprint
   普通 `help` 输出里不应该出现设备指纹。
   这是内部标识符，应该移动到 debug 模式。

优先级：

1. 推荐数据质量
2. 401 修复
3. 部署新 `SKILL.md`
4. 数据源一致性
5. 指纹隐藏

---

TC07 和 TC08 测了隐私状态查看，但只测了“查看”，没有测“保护”。

已测：

- 查看 consent 状态（未设置）
- 查看脱敏引擎状态（已启用）
- 查看受信任 Skill 列表（空）

未测：

- `redact.py` 实际脱敏效果：含 API Key 的文本是否真的变成 `[REDACTED]`
- `consent-agree` 之后的行为变化：同意前后 `recommend/search` 是否有差异
- `consent-decline` 之后是否真的进入 local-only 模式
- `trust/untrust` 的实际豁免效果
- `delete-all` 执行后本地和后端是否真的都删干净

额外发现的问题：

- TC07 显示 consent 未设置，但 `search/recommend` 仍然可用
- 如果设计意图是“不同意就不能用推荐”，那这里就是 bug
- 要么改代码，要么改 `privacy status` 的展示文案，不能自相矛盾

需要补的隐私测试：

- `TC-P1`：`redact.py` 脱敏验证
  输入：含 OpenAI API Key + SSH 私钥 + 手机号的文本
  预期：全部替换为 `[REDACTED]`

- `TC-P2`：`consent-decline` 后 local-only
  操作：执行 `consent-decline`，再试 `/mapickii recommend`
  预期：拒绝，并提示“需要同意隐私条款”

- `TC-P3`：consent 未设置时接口行为
  操作：不设置 consent，直接调 `search/recommend`
  预期：按设计执行，但必须和 `privacy status` 文案一致

- `TC-P4`：`trust/untrust`
  操作：`trust github`，检查 `github` 是否免脱敏
  预期：trust 列表里出现 `github`

- `TC-P5`：`delete-all` 完整执行
  操作：执行 `delete-all --confirm`，检查 `CONFIG.md` 和后端数据
  预期：本地和后端全部清空

特别需要补跑 `TC-P3`：

- 如果 consent 没设置但推荐还能用，要么改代码
- 要么改 `privacy status` 的展示文案
- 不能让状态页和实际行为互相打架

---

Claude 的结论：

现在直接上线，用户不会说“卧槽牛逼”，只会说“哦，又一个 Skill 推荐工具”。

核心原因：

- 推荐出来的是 Azure 垃圾，第一次体验就会劝退
- 人格报告全是 0，没有分享欲
- 安全评分后端 401，README 里的卖点没有真正跑通
- onboarding 汇总还没接上，缺少第一次使用时的震撼时刻

要达到“卧槽”效果，至少先修好这 4 个：

1. 推荐数据：去掉 Azure 刷量垃圾，加 publisher 去重
2. 部署新 `SKILL.md`：人格 brewing 卡片 + 推荐连接工作流 + 僵尸清理话术
3. 修 `security` 401
4. onboarding 汇总跑通

理想首次体验应当是：

- 扫出用户有多少僵尸 Skill 和 context 浪费
- 问清楚用户做什么工作
- 推出 3 个真正缺失且匹配场景的 Skill
- 安全评分能正常返回
- 支持一键安装闭环

这个流程跑通，社区反馈才会从“普通推荐工具”变成“卧槽，这东西真懂我”。

## 提炼结论

### 产品层

- 当前最大问题不是“没有功能”，而是“首屏体验没有击穿用户”
- Mapick 的核心价值必须在第一次交互里被用户直接感知到
- 目前推荐、人格、安全、onboarding 这 4 条链路里，至少有 3 条没有真正闭环

### 技术层

- 推荐排序过度依赖 popularity，缺乏去刷量、去同源堆叠和场景相关性约束
- 鉴权体系在 `security` 路由上可能存在配置漂移
- `status` / `report` 的数据读取链路不一致
- 隐私状态页与实际后端行为存在潜在冲突
- 交付侧存在“文档已改但部署未更新”的风险

### 发布层

- 当前不适合对外强推
- 最少需要完成 4 个阻塞项修复后再考虑社区曝光
- 隐私链路建议在发布前补齐最少 5 条验证用例

## 升级目标

### P0 目标

- 推荐结果从“刷量榜单”升级为“场景匹配推荐”
- 安全评分接口恢复可用
- 人格报告在低数据量时正确退化为 brewing 卡片
- onboarding 首次体验形成完整诊断闭环

### P1 目标

- 统一 `status` / `report` 数据源
- 隐私状态和实际行为完全一致
- 普通用户界面不再暴露 device fingerprint

## 升级计划

### Phase 1: P0 问题修复

1. 推荐质量修复
   - 在推荐层加入 publisher 去重限制
   - 同 publisher 最多保留 2 个 Skill
   - 降低 popularity 权重
   - 增加行为相关性、用户画像、工作流匹配的权重
   - 对明显刷量源增加惩罚或黑名单规则

2. `security` 401 修复
   - 检查 `security` 路由与其他接口的鉴权 guard 是否一致
   - 验证客户端传递的 `API_KEY` / `API_SECRET` 是否正确
   - 增加一条最小联调用例，确保后端鉴权和 Skill 端都能跑通

3. 部署新版 `SKILL.md`
   - 确认 `persona brewing` 卡片逻辑已经进线上使用版本
   - 确认推荐结果与工作流上下文连接的话术已经生效
   - 确认僵尸 Skill 清理的提示文案已更新

4. onboarding 闭环修复
   - 确认首次安装后的诊断汇总真正执行
   - 确认 workflow 问答入口能触发
   - 确认诊断结果、推荐结果和安全结果能在一次流程中连续出现

### Phase 2: P1 一致性与隐私修复

1. 统一数据源
   - 盘点 `status`、`report`、`assistant` 使用的数据来源
   - 决定以本地 scan、后端聚合或双向同步中的哪一个为单一真相源
   - 修复 Skill 数量不一致问题

2. 隐私链路补测与修复
   - 补跑 `TC-P1` 到 `TC-P5`
   - 明确 consent 未设置时的产品策略
   - 若策略是严格模式，则拦截 `search/recommend`
   - 若策略是宽松模式，则同步修改 `privacy status` 展示文案

3. 隐藏 device fingerprint
   - 从普通 `help` 输出移除
   - 仅保留在 debug 或内部命令中

### Phase 3: 上线准备

1. 回归验证
   - 推荐结果不再出现 Azure 堆叠污染
   - `security` 接口不再 401
   - 人格低数据时返回 brewing 卡片
   - `status` / `report` 数量一致
   - 隐私行为与状态页一致

2. 体验验收
   - 新用户首次安装后 3 分钟内能看到明确诊断价值
   - 推荐结果至少有 2 到 3 个和用户场景高度相关
   - 安全评分可直接支撑用户决策
   - 分享型人格报告不再出现“全 0”尴尬页面

3. 发布判断
   - P0 未完成，不建议对外推广
   - P0 全部完成、P1 关键项完成后，再做社区发布

## 验收清单

### 必过项

- `TC04` 推荐结果不再被 Azure 刷量污染
- `TC09` / `TC10` 安全评分接口恢复正常
- `TC21` / `TC22` 低数据人格报告正确退化
- onboarding 汇总首次流程跑通
- `TC-P1` 到 `TC-P5` 补测完成

### 发布门槛

- 首次体验能够给用户“诊断我 + 理解我 + 推荐我 + 保护我”的完整感受
- 不再出现 README 卖点和真实行为不一致的情况
- 不再出现状态页、报告页、推荐页相互打架的情况

## 任务拆分

### Track A: 推荐质量

目标：

- 让推荐从“安装量榜单”变成“场景相关候选集”

建议改动点：

- 后端推荐排序
  - [recommend.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/recommend/recommend.service.ts)
  - [recommend.constants.ts](/Users/evan/projects/mapick/mapick-api/src/modules/recommend/recommend.constants.ts)
- Skill 数据读取与搜索
  - [skill.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/skill/skill.service.ts)
- 同步源清洗
  - [sync.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/sync/sync.service.ts)

具体任务：

- 增加 publisher 维度去重规则
- 单 publisher 推荐上限设为 2
- 降低纯 popularity 权重
- 引入用户安装历史、行为序列、profile 标签加权
- 为疑似刷量源加惩罚分或过滤规则
- 为 Azure 类污染数据补一条回归测试样本

完成标准：

- `recommend` Top 5 中不再被同一 publisher 堆满
- 与用户场景无关的 Azure 技能不再占据主输出
- 单测或 fixture 能覆盖“刷量污染”场景

### Track B: Security 401

目标：

- 恢复安全评分的真实后端链路，不再依赖 fallback

建议改动点：

- [security.controller.ts](/Users/evan/projects/mapick/mapick-api/src/modules/security/security.controller.ts)
- [security-skill.controller.ts](/Users/evan/projects/mapick/mapick-api/src/modules/security/security-skill.controller.ts)
- [security.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/security/security.service.ts)
- [api-key.guard.ts](/Users/evan/projects/mapick/mapick-api/src/common/auth/api-key.guard.ts)
- [device-fp.guard.ts](/Users/evan/projects/mapick/mapick-api/src/common/auth/device-fp.guard.ts)
- [fp-or-api-key.guard.ts](/Users/evan/projects/mapick/mapick-api/src/common/auth/fp-or-api-key.guard.ts)

具体任务：

- 核对 `security` 路由实际挂载的 guard
- 核对 Skill 端请求头、参数和签名逻辑
- 补一条最小联调脚本，覆盖一个正常 `security` 查询
- 明确 401 是客户端参数缺失还是后端 guard 配置漂移

完成标准：

- `TC09` / `TC10` 能稳定返回真实安全评分
- Agent 不再退回启发式 fallback

### Track C: Persona Brewing 与文案部署

目标：

- 数据不足时输出正确的“brewing”状态，而不是一张全 0 报告

建议改动点：

- Skill 端
  - [SKILL.md](/Users/evan/projects/mapick/mapickii/SKILL.md)
  - [scripts/shell.js](/Users/evan/projects/mapick/mapickii/scripts/shell.js)
- 后端人格报告
  - [report.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/report/report.service.ts)
  - [message-renderer.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/assistant/message-renderer.service.ts)

具体任务：

- 确认线上使用版本是否已包含 brewing 卡片逻辑
- 给人格报告增加最小数据门槛判定
- 低数据量时返回卡片态，不返回伪完整统计
- 校对推荐、workflow、僵尸清理相关话术是否是最新版本

完成标准：

- `TC21` / `TC22` 不再出现全 0 报告
- 用户看到的是“正在生成画像”的合理过渡态

### Track D: Onboarding 闭环

目标：

- 用户第一次使用时，在一个流程里感知到诊断、推荐和安全价值

建议改动点：

- [assistant.controller.ts](/Users/evan/projects/mapick/mapick-api/src/modules/assistant/assistant.controller.ts)
- [skill-status.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/assistant/skill-status.service.ts)
- [intent.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/assistant/intent.service.ts)
- [sequence-analyzer.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/assistant/sequence-analyzer.service.ts)
- [message-renderer.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/assistant/message-renderer.service.ts)

具体任务：

- 确认首次安装后的状态页是否触发诊断汇总
- 确认 workflow 问答是否会跟在诊断后触发
- 确认推荐结果会带着工作流上下文一起出现
- 确认安全评分能插入推荐或安装决策链路

完成标准：

- 新用户第一次交互能看到“问题发现 -> 理解场景 -> 推荐 -> 安全决策”的连贯流程

### Track E: 数据源一致性

目标：

- `status`、`report`、`assistant` 对同一用户的 Skill 数量给出一致结果

建议改动点：

- [skill-status.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/assistant/skill-status.service.ts)
- [report.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/report/report.service.ts)
- [user.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/user/user.service.ts)
- [event.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/event/event.service.ts)

具体任务：

- 画出 `status` 与 `report` 各自的数据读取链路
- 决定以哪个源为主：本地 scan、后端记录或聚合快照
- 对数量口径做统一定义
- 补一条一致性回归测试

完成标准：

- 同一用户同一时间点，`status` / `report` 输出的已安装 Skill 数量一致

### Track F: 隐私链路

目标：

- 让隐私状态展示、实际行为和删除能力完全一致

建议改动点：

- Skill 端
  - [scripts/redact.py](/Users/evan/projects/mapick/mapickii/scripts/redact.py)
  - [scripts/redact.js](/Users/evan/projects/mapick/mapickii/scripts/redact.js)
  - [scripts/shell.js](/Users/evan/projects/mapick/mapickii/scripts/shell.js)
- 后端用户与事件相关模块
  - [user.controller.ts](/Users/evan/projects/mapick/mapick-api/src/modules/user/user.controller.ts)
  - [user.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/user/user.service.ts)
  - [event.service.ts](/Users/evan/projects/mapick/mapick-api/src/modules/event/event.service.ts)

具体任务：

- 补跑 `TC-P1` 到 `TC-P5`
- 明确 consent 未设置时的产品规则
- 若应禁用远程能力，则在 Skill 端和后端都加拦截
- 若允许使用，则把状态文案改成“未同意但仍可使用部分能力”
- 验证 `delete-all` 是否覆盖本地配置和后端数据

完成标准：

- 隐私状态页不再和实际能力冲突
- `delete-all` 有明确可验证的删除结果

### Track G: Device Fingerprint 隐藏

目标：

- 普通用户不再在 help 中看到内部标识

建议改动点：

- [scripts/shell.js](/Users/evan/projects/mapick/mapickii/scripts/shell.js)
- [SKILL.md](/Users/evan/projects/mapick/mapickii/SKILL.md)

具体任务：

- 从普通 `help` 输出中移除 device fingerprint
- 保留 `id` 或 debug-only 命令供内部排查使用
- 检查 README / 文档里是否也有对外暴露

完成标准：

- 普通用户路径下不再出现 device fingerprint

## 建议执行顺序

### Wave 1

- Track A: 推荐质量
- Track B: Security 401
- Track C: Persona Brewing 与文案部署
- Track D: Onboarding 闭环

理由：

- 这 4 项直接决定“第一次体验是否值得分享”
- 也是最明确的上线阻塞项

### Wave 2

- Track E: 数据源一致性
- Track F: 隐私链路
- Track G: Device Fingerprint 隐藏

理由：

- 这 3 项更偏一致性、可信度和上线后风险控制
- 不修也许能 demo，但不适合正式放量

## 周计划建议

### Week 1

- 修推荐污染和 `security` 401
- 确认新版 `SKILL.md` 已部署
- 跑通最小 onboarding 闭环

### Week 2

- 统一 `status` / `report` 数据源
- 完成隐私链路补测和修复
- 清理 help 中的内部信息暴露

### Week 3

- 做完整回归
- 录制首次体验路径
- 达标后再安排社区发布
