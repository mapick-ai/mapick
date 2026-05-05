# Mapick v0.0.17 Phase 2 & Phase 3 — 个性化与智能化 PRD

**版本**：1.2  
**日期**：2026-05-01  
**状态**：Draft  
**作者**：Mapick Product Team  
**来源**：Phase 2 升级计划 (`revisions/upgrade-plan-20260501/README.md`) + V1.5 三大功能开发文档 (`revisions/slack-02/`) + Phase 3 规划  
**前置**：Phase 1 完成（notify cron、install verification、slug resolution）

---

## 目录

### Phase 2
1. [产品目标与范围](#1-产品目标与范围)
2. [需求 4：用户偏好 — Proactive Mode](#2-需求4用户偏好--proactive-mode)
3. [需求 5：Token 透明化](#3-需求5token-透明化)
4. [需求 6：推荐引擎增强](#4-需求6推荐引擎增强)
5. [优先级排序](#5-优先级排序)
6. [API 依赖映射](#6-api-依赖映射)
7. [非功能需求](#7-非功能需求)
8. [风险与依赖](#8-风险与依赖)
9. [附录](#9-附录)

### Phase 3
10. [Phase 3 产品目标与范围](#10-phase-3-产品目标与范围)
11. [需求 7：Stats Dashboard 增强](#11-需求-7stats-dashboard-增强)
12. [需求 8：Perception 集成](#12-需求-8perception-集成)
13. [Phase 3 优先级排序](#13-phase-3-优先级排序)
14. [Phase 3 API 依赖映射](#14-phase-3-api-依赖映射)
15. [Phase 3 非功能需求](#15-phase-3-非功能需求)
16. [Phase 3 风险与依赖](#16-phase-3-风险与依赖)
17. [Phase 3 附录](#17-phase-3-附录)

---

## 1. 产品目标与范围

### 1.1 背景

Phase 1 修复了 3 个 P0 缺陷：通知 cron 注册生效、安装体验改造、slug 解析统一。Mapick 已经能够被用户可靠安装和使用，每日通知链路通畅。

**但有一个根本问题还没解决**：Mapick 仍然是一个「被动工具」——用户必须记得打开、记得提问、记得主动探索。这导致：

- **激活率断层**：用户安装后只有第一次会话使用，之后就忘了
- **推荐与用户无关**：推荐结果基于全局 trending，未考虑用户已安装的 skill、profile 标签、工作流上下文
- **成本盲区**：用户不知道哪个 skill 消耗最多 AI token，无法做出明智的「保留/清理」决策
- **无个性化**：所有用户的体验完全一致，没有适配机制

Phase 2 聚焦**个性化与智能化**，让 Mapick 从「工具」进化为「懂你的 AI Butler」。

### 1.2 产品目标

**一句话**：让 Mapick 理解用户的技能偏好、追踪 AI 消耗成本、基于上下文做精准推荐。

具体目标：

| 目标 | 当前状态 | 目标状态 |
|------|---------|---------|
| G4 用户偏好 | CONFIG.md 无 `proactive_mode` 字段 | 用户可配置 `proactive_mode` 三档，控制 Mapick 主动程度 |
| G5 Token 透明 | 无 token 追踪能力 | 用户可查看每日/周 token 消耗、按 skill 拆分、预估费用 |
| G6 推荐增强 | `radar` 用 `/recommendations/feed`（全局 trending），`recommend` 走 search intent | `radar` 和 `recommend --contextual` 调用 `/recommendations/contextual`（基于上下文的个性化推荐） |

### 1.3 范围（In/Out）

**In Scope（本次 Phase 2）**：

- **G4 用户偏好**：CONFIG.md 新增 `proactive_mode` 键，支持 `off` / `silent` / `helpful` 三档
  - `profile set proactive_mode=helpful` CLI 命令
  - SKILL.md 中 AI 根据 `proactive_mode` 调节推荐行为的规则
  - 各档位的行为差异定义
- **G5 Token 透明**：解析本地 OpenClaw session JSONL 日志，归因 token 到 skill
  - 本地持久化到 `~/.mapick/logs/token-usage.jsonl`
  - `stats token` 子命令（today / week）
  - 基于模型定价的费用估算（Sonnet / Haiku 等）
  - AI 渲染报告卡片（按 skill 拆分、今日 vs 日均对比）
- **G6 推荐增强**：启用 `/recommendations/contextual` 端点
  - `recommend --contextual` flag
  - `radar` 内部切换为 contextual feed
  - 将 `/recommendations/contextual` 加入 `ALLOWED_ENDPOINTS`
  - AI 渲染规则：推荐说明「为什么推荐这个给你」

**Out Scope（后续 Phase）**：

- 后端 `contextual` 推荐算法调优（算法本身由后端的 Phase 2 负责）
- 社交图谱 M5（Phase 3）
- 开发者 API M7（Phase 3）
- AI 模型路由 M8（Phase 3）
- 精确到 token 的模型定价表（Phase 2 用默认定价，后续可配置）
- 主动通知推送偏好（属于 Phase 2 后续扩展，本次仅做 `proactive_mode` 基础框架）

### 1.4 后端依赖总览

| 需求 | 后端依赖 | 是否新增 |
|------|---------|:-------:|
| G4 用户偏好 | 无（本地 CONFIG.md） | — |
| G5 Token 透明 | 无（本地 session JSONL 解析），可选后端 endpoint 后续追加 | 否（本期） |
| G6 推荐增强 | `GET /recommendations/contextual`（已存在，未使用） | 复用现有端点 |

---

## 2. 需求 4：用户偏好 — Proactive Mode

### 2.1 问题描述

当前 Mapick 对所有用户一视同仁：`radar` 每天可触发一次、recommend 随时可用、consent 后自动建议 cron 注册。但不同用户对「AI 主动性」的期望差异巨大：

- **极简用户**：只想手动 `/mapick search` 搜索 skill，不希望任何未经请求的推荐
- **探索用户**：在主动提问时愿意看到相关推荐（「我搜了 Rust，顺便提一下还有 cargo-audit」）
- **托管用户**：希望 Mapick 像真 butler 一样主动发现问题并告知（每日 radar + 上下文中推荐）

当前缺乏一个统一的「模式开关」来控制 Mapick 的主动性，导致反感主动推荐的用户体验差，愿意接受推荐的用户又得不到充分服务。

### 2.2 功能描述

#### F4.1：CONFIG.md 新增 `proactive_mode` 键

在 CONFIG.md 中新增一个「模式」键，控制 Mapick 的推荐主动性：

```yaml
# CONFIG.md 新增
proactive_mode: "helpful"   # 可选值: off | silent | helpful
```

**默认值**：`"helpful"`（新用户首次安装默认开启完整体验）

**值的语义**：

| 值 | 含义 | 典型用户画像 |
|:---|------|-------------|
| `off` | **完全手动模式**。Mapick 不主动推荐任何 skill。`radar` 静默，recommend 仅响应用户显式 `/mapick recommend` 命令。 | 经验丰富，不希望 AI 打扰 |
| `silent` | **应召推荐模式**。在用户主动触发推荐上下文时介入（如 `/mapick search` 后追加推荐），但不做后台主动雷达扫描。 | 愿意探索但要有控制感 |
| `helpful` | **主动管家模式**（默认）。Daily radar 主动扫描 gap，在用户工作流中实时提示匹配的 skill，consent 后主动建议 cron 注册。 | 新手/探索型用户 |

#### F4.2：`profile set` 命令扩展

现有 `profile` 子命令（`scripts/lib/misc.js`）需要扩展，支持设置 `proactive_mode`：

```bash
# CLI 命令
node scripts/shell.js profile set proactive_mode=helpful
node scripts/shell.js profile set proactive_mode=silent
node scripts/shell.js profile set proactive_mode=off
node scripts/shell.js profile get   # 返回当前 proactive_mode
```

**实现要点**：
- 扩展 `scripts/lib/misc.js` 的 `handleProfile()` 函数，识别 `proactive_mode` 键
- 写入 `readConfig` / `writeConfig` 的标准路径
- 设置成功时返回：
  ```json
  {
    "intent": "profile:set",
    "key": "proactive_mode",
    "value": "helpful",
    "effect": "Mapick 会主动为你扫描技能缺口，每日一次。关闭请手动或『设置主动模式为静音』"
  }
  ```

#### F4.3：SKILL.md 中 AI 行为的模式感知规则

SKILL.md 需要新增一个「Proactive Mode」指导小节，告知 AI 如何根据 `proactive_mode` 调节行为：

**模式感知规则**（写入 SKILL.md §14 或 §10）：

| 场景 | `off` | `silent` | `helpful` |
|------|-------|----------|-----------|
| 用户说"装点什么" | 仅响应，不追加推荐 | 响应 + 1 条相关推荐 | 响应 + 2 条相关推荐 + 套装建议 |
| 用户执行 `/mapick search` | 仅返回搜索结果 | 搜索结果 + "如需个性化推荐可以 `/mapick recommend`" | 搜索结果 + 自动追加 1-2 条 context-aware 推荐 |
| 用户执行 `/mapick status` | 仅显示状态 | 状态 + "有 1 个匹配你 profile 的新 skill" | 状态 + 完整 radar 结果（如当天未触发） |
| Daily radar 触发 | 静默，不执行 | 静默，不执行 | 执行，发现 gap 后主动渲染 |
| Consent 后 | 不提示 cron | 含蓄提示 | 主动询问是否配置 cron |
| 用户 idle 7 天+ | 不提示 | 不提示 | 下次会话主动建议 `/mapick radar` 检查更新 |

#### F4.4：自然语言模式切换（AI 翻译层）

用户不需要记住 CLI 命令。AI 应将自然语言映射到 `profile set` 命令：

| 用户自然语言 | AI 映射 | Shell 命令 |
|-------------|--------|-----------|
| "以后别推东西给我了" / "stop suggesting" | → `off` | `profile set proactive_mode=off` |
| "我问你的时候可以推荐一下" / "only recommend when I ask" | → `silent` | `profile set proactive_mode=silent` |
| "你主动帮我找" / "be a good butler" | → `helpful` | `profile set proactive_mode=helpful` |
| "你现在是什么模式？" / "what mode are you in?" | → `profile get` → 渲染当前模式 |

**AI 确认话术规范**：
- 切换时：不输出 `✅ proactive_mode set to helpful`，而是给出**体验描述**：
  - `off` → "🔇 已调整。我不会再主动推荐技能了。你随时说『推荐几个』我会响应。"
  - `silent` → "🔔 了解。你主动问我（搜索/推荐）时我会提供建议，但不会主动打扰你。"
  - `helpful` → "🔔 收到。我会主动扫描你的技能缺口，每天至少一次。如果有新发现会告诉你。"

### 2.3 用户故事

#### US-4.1：新用户默认享受主动服务

> **作为** 刚安装 Mapick 的新用户  
> **我希望** 默认得到主动推荐，让我不需要手动探索就能发现适合我的 skill  
> **以便** 我在使用 Mapick 的第一周就能体验到它的核心价值

**优先级**：P1  
**依赖**：F4.1、F4.3  
**预期效果**：新用户 7 日留存提升

#### US-4.2：高级用户关闭主动模式

> **作为** 已经熟悉 ClawHub 生态的资深用户  
> **我希望** 一句话关掉 Mapick 的主动推荐，只保留手动搜索  
> **以便** 我不被多余的信息打扰，Mapick 只在我需要时出现

**优先级**：P1  
**依赖**：F4.1、F4.2、F4.4

#### US-4.3：探索型用户保持适度推荐

> **作为** 愿意尝试新 skill 但不喜欢被打扰的探索用户  
> **我希望** 在我主动搜索或提问时看到相关推荐，但后台不要定时推送  
> **以便** 推荐始终与我的当前意图相关，而不是无上下文的推销

**优先级**：P1  
**依赖**：F4.1、F4.3

#### US-4.4：用户随时查看当前模式状态

> **作为** 忘记自己设置过什么的用户  
> **我希望** 能简单查看当前的主动模式状态  
> **以便** 我知道 Mapick 当前的行为边界

**优先级**：P2  
**依赖**：F4.2

### 2.4 验收标准

| # | 验收条件 | 测试方法 |
|:-:|---------|---------|
| AC4.1 | CONFIG.md 存在 `proactive_mode` 键，合法值为 `off` / `silent` / `helpful` | 查看 CONFIG.md 内容 |
| AC4.2 | `profile set proactive_mode=off` 执行成功后 CONFIG.md 值为 `off` | 单元测试：调用后读取 CONFIG.md |
| AC4.3 | `profile set proactive_mode=invalid` 返回错误，CONFIG.md 不变 | 单元测试：非法值被拒绝 |
| AC4.4 | 新安装用户 CONFIG.md 默认 `proactive_mode: "helpful"`（首次 init 时写入） | 模拟首次安装 |
| AC4.5 | `proactive_mode=off` 时，AI 不在 search/status 后追加推荐 | AI 响应检查：无「推荐」「试试」「你可能需要」类推荐文本 |
| AC4.6 | `proactive_mode=silent` 时，`/mapick search` 后 AI 提及有相关推荐但不主动推送内容 | AI 响应检查：含引导但不列具体 skill |
| AC4.7 | `proactive_mode=helpful` 时，`/mapick status` 后 AI 检查当天是否已跑 radar，未跑则主动触发 | 端到端测试 |
| AC4.8 | 自然语言「别推了」被正确映射为 `profile set proactive_mode=off` | AI 自然语言测试 |
| AC4.9 | 自然语言「帮我看一下有啥新的」被正确映射为 `profile set proactive_mode=helpful`（如果当前是 off） | AI 自然语言测试 |
| AC4.10 | `profile get` 返回当前 `proactive_mode` 值 | CLI 测试 |

### 2.5 涉及文件

| 文件 | 变更类型 | 变更说明 |
|------|:-------:|---------|
| `scripts/lib/misc.js` | 修改 | `handleProfile` 扩展 `proactive_mode` set/get |
| `scripts/lib/core.js` | 修改 | `handleInit` 首次安装时写入默认 `proactive_mode: "helpful"` |
| `SKILL.md` | 新增 | §14 Proactive Mode 行为规则 |
| `CONFIG.md`（模板） | 新增 key | `proactive_mode` 默认值 |

---

## 3. 需求 5：Token 透明化

### 3.1 问题描述

用户使用 Mapick 的最终价值是「省钱省心」——找到该装的 skill，清掉该删的 skill。但当前缺少一个关键信息：**每个 skill 到底消耗了多少 AI token？花了多少钱？**

从用户视角看：
- "我装了 15 个 skill，但不知道谁在烧钱"
- "那个 3 个月没用过的 skill，是不是一直在吃我 context 窗口？"
- "今天 AI 花了多少钱？比平时多还是少？"

Token 透明化不是给用户一份会计账单，而是让用户**看见钱花在哪儿了**，从而做出更明智的保留/清理决策。

**核心原则**：只呈现数据，不做限制。不设 budget cap，不禁用 skill。用户自己决定。

### 3.2 功能描述

#### F5.1：本地 Token 日志采集

在本地解析 OpenClaw 的 session JSONL 日志（`~/.openclaw/sessions/*.jsonl`），提取每条记录的 `usage` 字段（`input_tokens` / `output_tokens` / `cache_read_input_tokens` 等），按时间戳和 skill 归因后写入 `~/.mapick/logs/token-usage.jsonl`。

**归因逻辑**（优先级从高到低）：

1. **精确归因**：如果 JSONL 记录包含 `tool` 字段（表示触发了某个 skill 的 tool call），将本条 token 归因到该 tool 对应的 skill
2. **上下文归因**：如果没有 tool call，检查记录的 `message` 或 `content` 中是否包含 skill 名称或调用痕迹
3. **系统归因**：无法归因到具体 skill 的 token 标记为 `_system`
4. **缓存归因**：`cache_read_input_tokens` 单独统计，按 `cache_creation_input_tokens` 归因（如模型支持）

**日志格式**（`token-usage.jsonl`，每行一条）：

```json
{"ts":"2026-05-01T09:30:00Z","skill":"github-ops","input":12450,"output":3800,"cache":0,"model":"claude-sonnet-4-20250514"}
{"ts":"2026-05-01T09:32:00Z","skill":"_system","input":5200,"output":2100,"cache":0,"model":"claude-sonnet-4-20250514"}
{"ts":"2026-05-01T10:15:00Z","skill":"summarize","input":8900,"output":5600,"cache":4200,"model":"claude-sonnet-4-20250514"}
```

**采集时机**：
- 每次 `stats token` 命令触发时增量解析（对比 `last_token_parsed_ts`）
- 每天首次 `notify daily` 时自动触发一份摘要，追加到日志但不单独推送给用户
- 首次采集无日志时，返回空结果（不报错）

#### F5.2：`stats token` 子命令

新增 `stats token [today|week]` 子命令，返回当前周期的 token 消耗报告：

```bash
# 今日报告
node scripts/shell.js stats token today

# 本周报告
node scripts/shell.js stats token week
```

**返回 JSON 结构**：

```json
{
  "intent": "stats:token",
  "period": "today",
  "from": "2026-05-01T00:00:00Z",
  "to": "2026-05-01T23:59:59Z",
  "total": {
    "input": 125000,
    "output": 68000,
    "cache": 12000,
    "all": 205000,
    "cost_estimate": 0.85,
    "model_pricing_used": "claude-sonnet-default"
  },
  "by_skill": [
    {
      "skill": "github-ops",
      "input": 52000,
      "output": 31000,
      "cache": 0,
      "total": 83000,
      "cost_estimate": 0.38,
      "pct_of_total": 44.7,
      "calls": 12,
      "status": "active"
    },
    {
      "skill": "_system",
      "input": 21000,
      "output": 15000,
      "total": 36000,
      "cost_estimate": 0.18,
      "pct_of_total": 21.2,
      "calls": 25
    }
  ],
  "daily_average": {
    "total_tokens": 195000,
    "cost_estimate": 0.72
  },
  "today_vs_average": {
    "ratio": 1.18,
    "label": "normal"
  }
}
```

**`status` 字段说明**（按 skill 状态标记）：

| 值 | 含义 | 条件 |
|:---|------|------|
| `active` | 正常使用中 | 最近 7 天有调用 |
| `never_used` | 从未被直接调用但占据 context | 所有归因都是间接/系统归因 |
| `idle_30d` | 30 天未使用 | 最后调用 > 30 天 |
| `zombie` | 僵尸 skill | CONFIG.md 标记 or 后端 zombie 列表 |

#### F5.3：模型定价估算

使用内置的默认模型定价表，按 input / output / cache 分别计算费用：

| 模型 | input（$/1M tokens） | output（$/1M tokens） | cache write | cache read |
|------|---------------------|----------------------|-------------|------------|
| Claude Sonnet（默认） | $3.00 | $15.00 | $3.75 | $0.30 |
| Claude Haiku | $0.80 | $4.00 | $1.00 | $0.08 |
| Claude Opus | $15.00 | $75.00 | $18.75 | $1.50 |

**定价选择逻辑**：
1. 优先从 JSONL 记录中读取 `model` 字段，匹配定价表
2. 无法匹配时使用 Sonnet 默认定价（并在 report 中注记）
3. 后续 Phase 可扩展为从 `~/.mapick/model-pricing.json` 读取用户自定义定价

**估算精度声明**：AI 渲染报告时必须注明「费用为预估值，实际以 Claude 官方计费为准」。

#### F5.4：AI 渲染报告卡片

SKILL.md 中明确 AI 对 `stats token` 输出的渲染规则：

**渲染顺序**：
1. 总览行：今日 / 本周总 token 数 + 预估费用
2. 按 skill 拆分表格（按费用降序，top 5）
3. 费用占比条（ASCII bar）
4. 异常检测：今日 vs 日均对比，3x 以上标红
5. 一条洞察（如果适用）：如「`capability-evolver` 从未使用但占了你 15% 的 context 消耗」

**渲染示例**：

```
💰 Token 消耗 — 今日

总计：205K tokens · 预估 $0.85

按 Skill 拆分：
  github-ops       83K  · $0.38   ██████████████░░  活跃
  _system          36K  · $0.18   ██████░░░░░░░░░░  系统
  summarize        24K  · $0.12   ████░░░░░░░░░░░░  活跃
  docker-manage    18K  · $0.08   ███░░░░░░░░░░░░░  活跃
  csv-converter    12K  · $0.06   ██░░░░░░░░░░░░░░  闲置 14d

今日 vs 日均：205K / 195K（正常 ✅）

📌 本周使用趋势：平稳。周二有个小高峰（github push 密集）。
```

**禁止事项**：
- 不输出原始 JSON
- 不显示 "today you saved $X by cleaning zombies"（不做节省估算，只呈现事实）
- 不在 report 中主动建议删除 skill（成本和节省信息在 zombie/clean 场景下才提）

#### F5.5：notify daily 集成（可选增强）

每日通知 (`notify daily`) 中可选择性包含一个 token 摘要行：

```
📊 昨日 Token：195K · $0.72（正常，日均 $0.68 → $0.72，+6%）
```

此项为**可选增强**，优先级低于核心 `stats token` 命令。

### 3.3 用户故事

#### US-5.1：用户主动查看今日花费

> **作为** 关心 AI 使用成本的用户  
> **我希望** 输入 `/mapick stats token` 能看到今天的 token 消耗和预估费用  
> **以便** 我知道今天 AI 花了多少钱，哪个 skill 最烧钱

**优先级**：P1  
**依赖**：F5.1、F5.2、F5.4

#### US-5.2：用户按周回顾消耗趋势

> **作为** 关注月度 AI 预算的用户  
> **我希望** 查看本周 token 消耗趋势（每日对比）  
> **以便** 我判断是否有异常增长，及时调整使用习惯

**优先级**：P2  
**依赖**：F5.1、F5.2

#### US-5.3：用户发现僵尸 skill 的成本

> **作为** 装了 15 个 skill 但只用其中 10 个的用户  
> **我希望** 在 token 报告中看到哪些从未使用的 skill 仍在消耗 context 窗口  
> **以便** 我做出清理决策，省下不必要的开销

**优先级**：P1  
**依赖**：F5.1（归因逻辑）、F5.2（`status: never_used`）

#### US-5.4：用户收到异常消耗提醒

> **作为** 不想 AI 费用悄然飙升的用户  
> **我希望** 当今日消耗超过日均 3 倍时，Mapick 主动告知  
> **以便** 我及时排查是否有 skill 进入死循环或异常调用

**优先级**：P2  
**依赖**：F5.1、F5.4（异常检测渲染规则）

### 3.4 验收标准

| # | 验收条件 | 测试方法 |
|:-:|---------|---------|
| AC5.1 | `stats token today` 在有 session 日志的环境下返回非零 total_tokens | 在本地环境测试（确保有 session JSONL） |
| AC5.2 | `stats token today` 在无 session 日志的环境下返回 `total_tokens: 0` 不报错 | 清空 sessions 目录后测试 |
| AC5.3 | `by_skill` 中每个条目包含 `skill`、`input`、`output`、`total`、`cost_estimate` | JSON 结构检查 |
| AC5.4 | 费用估算使用 $3/1M input + $15/1M output 的默认 Sonnet 定价 | 手动验算：total_tokens × pricing |
| AC5.5 | `token-usage.jsonl` 文件增量写入（不重复解析同一 session） | 运行两次 `stats token`，日志行数不翻倍 |
| AC5.6 | `stats token week` 返回 7 天聚合数据 | 检查 `from`/`to` 间隔为 7 天 |
| AC5.7 | 无法归因到具体 skill 的 token 标记为 `_system` | 检查 `_system` 条目存在且合理 |
| AC5.8 | AI 渲染报告时不输出原始 JSON | AI 响应检查 |
| AC5.9 | 缓存 token（`cache_read_input_tokens`）被正确统计 | 在支持 cache 的模型下验证 |
| AC5.10 | 大规模 session 文件（>100MB）解析不超时（3s 内完成增量解析） | 性能测试 |

### 3.5 涉及文件

| 文件 | 变更类型 | 变更说明 |
|------|:-------:|---------|
| `scripts/lib/stats.js` | **新增** | `handleStatsToken()` 函数：JSONL 解析 + 归因 + 聚合 |
| `scripts/lib/core.js` | 修改 | 新增 `readSessionLogs()` helper，读取 `~/.openclaw/sessions/` |
| `scripts/shell.js` | 修改 | 调度路由新增 `stats token [today\|week]` |
| `SKILL.md` | 新增 | §15 Token Transparency 渲染规则 |
| `~/.mapick/logs/token-usage.jsonl` | **新建** | token 使用日志（首次运行时创建） |

---

## 4. 需求 6：推荐引擎增强

### 4.1 问题描述

当前的推荐系统存在两个核心问题：

**问题 1：推荐与用户无关**。`radar` 使用 `GET /recommendations/feed` 拉取全局 trending skill，再与本地已安装 skill 做交叉过滤。这导致推荐的「个性化」仅体现在「不重复推荐已安装的」——完全没有考虑用户的 profile 标签、工作流、skill 使用频率、搜索历史等。

**问题 2：上下文缺失**。`/mapick recommend` 使用的是 search intent 关键词匹配，而非基于用户当前上下文的推荐。用户问「帮我找一个做数据分析的 skill」时，推荐引擎并不知道用户已经装了 pandas-profiling 和 matplotlib-chart，可能重复推荐同类 skill。

**已有的解决方案**：`GET /recommendations/contextual` 端点已存在于后端但从未被客户端使用。该端点设计为接收用户的 profile 标签、已安装 skill 列表、搜索上下文，返回更精准的推荐。

### 4.2 功能描述

#### F6.1：将 `/recommendations/contextual` 加入 ALLOWED_ENDPOINTS

当前 `ALLOWED_ENDPOINTS`（`scripts/lib/http.js:59-77`）不含 `/recommendations/contextual`，需新增：

```javascript
// 在 ALLOWED_ENDPOINTS 数组中新增：
/^\/recommendations\/contextual$/,
```

**插入位置**：紧邻现有 `/recommendations/(feed|track)$/` 之后。

#### F6.2：`recommend --contextual` flag

现有 `recommend` 命令（`scripts/lib/recommend.js` 中的 `handleRecommend()`）扩展支持 `--contextual` 标记：

```bash
# 显式上下文推荐
node scripts/shell.js recommend --contextual

# 不指定时保持现有行为（intent-based search）
node scripts/shell.js recommend
```

**调用差异**：

| 模式 | 端点 | 载荷 |
|------|------|------|
| 现有（无 flag） | `GET /recommendations/feed` 或 `GET /skills/live-search` | `query` 参数 |
| `--contextual` | `GET /recommendations/contextual` | `?tags=rust,typescript&installed=github-ops,code-review&limit=5` |

**Contextual 请求参数**（从本地 CONFIG.md + scan 结果组装）：

| 参数 | 来源 | 说明 |
|------|------|------|
| `tags` | `CONFIG.md.user_profile_tags` | 用户已声明的技术栈标签 |
| `installed` | `handleScan()` 结果 | 已安装 skill 的 slug 列表（逗号分隔，最多 30 个） |
| `limit` | 固定值 `5` | 返回推荐数量 |
| `context` | 可选：最近 search/recommend 的 query | 当前会话上下文关键词 |

#### F6.3：`radar` 内部切换为 contextual feed

当前 `radar`（`scripts/lib/radar.js`）使用 `/recommendations/feed`。当用户 `proactive_mode=helpful` 时，radar 内部切换为 `GET /recommendations/contextual`。

**切换逻辑**（写入 `radar.js`）：

```javascript
// handleRadar() 中：
const config = readConfig();
const proactiveMode = config.proactive_mode || "helpful";

let endpoint, params;
if (proactiveMode === "helpful") {
  endpoint = "/recommendations/contextual";  // 个性化推荐
  params = buildContextualParams(config, scanResult);
} else {
  endpoint = "/recommendations/feed";         // 全局 trending（silent 模式也走这里）
  params = {};
}
```

**降级策略**：如果 `/recommendations/contextual` 请求失败（4xx/5xx），radar 回退到 `/recommendations/feed`，并在响应中标记 `recommendation_source: "feed_fallback"`。这样即使后端 contextual 端点有问题，radar 仍然可用。

#### F6.4：AI 渲染规则：上下文推荐说明

使用 contextual 推荐后，AI 的渲染方式需要改变——**不仅推荐 skill，还要解释「为什么推荐这个给你」**：

**渲染模板**（写入 SKILL.md §8）：

```
🎯 可能对你有用的技能（基于你的 profile：Rust + TypeScript）

1. cargo-audit ⭐ A
   安全审计你的 Rust 依赖 → 直接扫描 Cargo.toml
   💡 因为你用 Rust 开发，这个可以自动发现已知漏洞

2. eslint-ai ⭐ A
   用 AI 增强 ESLint 规则 → 自动生成项目级 .eslintrc
   💡 匹配你的 TypeScript 技术栈，替代手动配置 ESLint

3. git-copilot ⭐ B
   根据 commit diff 自动生成 PR 描述
   💡 和你常用的 github-ops 互补——一个管操作，一个管沟通
```

**渲染规则**：
1. 每个推荐包含「为什么推荐」的一句话理由（**必须**有，不能只列名字）
2. 理由来源：优先用后端返回的 `reason` 字段，无则从 tags/installed 推断
3. 如果后端返回空数组，AI 主动说明「目前没有基于你的 profile 找到新的匹配，可以试试手动搜索」

#### F6.5：后端 Contextual 接口协议

后端 `/recommendations/contextual` 的请求/响应协议（本次仅客户端改动，后端已实现）：

**请求**：
```
GET /api/v1/recommendations/contextual?tags=rust,typescript&installed=github-ops,code-review&limit=5
```

**响应**：
```json
{
  "recommendations": [
    {
      "skillId": "cargo-audit",
      "slug": "rustsec/cargo-audit/cargo-audit",
      "name": "cargo-audit",
      "grade": "A",
      "description": "Audit Rust dependencies for security vulnerabilities",
      "reason": "Matches your Rust tag and adds security auditing you don't have",
      "complementaryTo": ["github-ops"],
      "category": "security-qa",
      "installCount": 12500
    }
  ],
  "context": {
    "tags_matched": ["rust"],
    "gaps_identified": ["security-audit"],
    "total_available": 8
  }
}
```

### 4.3 用户故事

#### US-6.1：用户获得基于 profile 的个性化推荐

> **作为** 已填写 profile（Rust + TypeScript）的用户  
> **我希望** `/mapick recommend --contextual` 返回与我技术栈相关的推荐而非全站 trending  
> **以便** 我看到的每个推荐都与我的实际工作相关

**优先级**：P1  
**依赖**：F6.1、F6.2

#### US-6.2：用户每日获得主动 gap 分析

> **作为** `proactive_mode=helpful` 的用户  
> **我希望** 每日 radar 自动基于我的已安装 skill + profile 标签发现技能缺口  
> **以便** 我不需要手动搜索就能知道「你还没有 cargo-audit，这个可以补上你的 Rust 安全审计空白」

**优先级**：P1  
**依赖**：F6.3、G4（proactive_mode）

#### US-6.3：开发者理解「为什么会推荐这个」

> **作为** 收到推荐但心存疑虑的用户  
> **我希望** 每条推荐附带一句话解释为什么匹配我  
> **以便** 我判断这是精准推荐还是随机推送，提升对 Mapick 推荐的信任度

**优先级**：P1  
**依赖**：F6.4（AI 渲染规则）

#### US-6.4：Contextual 端点故障时自动降级

> **作为** 在 contextual 端点异常时仍然需要推荐服务的用户  
> **我希望** Mapick 自动回退到 feed 推荐，并告知我推荐来源发生了变化  
> **以便** 我不会因为后端故障而完全收不到推荐

**优先级**：P2  
**依赖**：F6.3（降级策略）

### 4.4 验收标准

| # | 验收条件 | 测试方法 |
|:-:|---------|---------|
| AC6.1 | `ALLOWED_ENDPOINTS` 包含 `/recommendations/contextual` | 代码检查 `http.js` |
| AC6.2 | `recommend --contextual` 向 `/recommendations/contextual` 发送 `tags` + `installed` 参数 | 网络抓包验证 |
| AC6.3 | 参数 `tags` 的值与 `CONFIG.md.user_profile_tags` 一致 | 检查请求 URL query string |
| AC6.4 | `radar` 在 `proactive_mode=helpful` 时调用 `/recommendations/contextual` 而非 `/recommendations/feed` | 网络抓包验证 |
| AC6.5 | `radar` 在 `proactive_mode=silent` 时仍然调用 `/recommendations/feed`（不切换） | 网络抓包验证 |
| AC6.6 | Contextual 端点返回 5xx 时，radar 降级使用 `/recommendations/feed` | 模拟后端故障 |
| AC6.7 | 降级时 radar 返回结果中包含 `recommendation_source: "feed_fallback"` | JSON 字段检查 |
| AC6.8 | AI 渲染推荐时每个条目包含「为什么推荐」的一句话理由 | AI 响应检查：每条推荐有 `💡` 行 |
| AC6.9 | Contextual 返回空数组时 AI 给出友好说明而非沉默 | AI 响应检查 |
| AC6.10 | 推荐不包含用户已安装的 skill（去重） | 对照 scan 结果验证 |

### 4.5 涉及文件

| 文件 | 变更类型 | 变更说明 |
|------|:-------:|---------|
| `scripts/lib/http.js` | 修改 | `ALLOWED_ENDPOINTS` 新增 `/recommendations/contextual` |
| `scripts/lib/recommend.js` | 修改 | `handleRecommend` 支持 `--contextual` flag，组装 contextual 请求 |
| `scripts/lib/radar.js` | 修改 | `handleRadar` 按 `proactive_mode` 切换端点 + 降级逻辑 |
| `scripts/lib/core.js` | 修改 | 新增 `buildContextualParams()` helper |
| `SKILL.md` §8 | 修改 | 更新推荐渲染规则：新增 contextual 理由说明 |

---

## 5. 优先级排序

### 5.1 排序总览

本次 Phase 2 所有需求均为 **P1**，按**用户价值密度**和**实施依赖**排序：

| 优先级 | 需求 | 工作量 | 用户价值 | 前置条件 |
|:------:|------|:------:|:-------:|---------|
| **P1-1** | G4 用户偏好 — Proactive Mode | 1 天 | ⭐⭐⭐⭐⭐ | 无（纯本地） |
| **P1-2** | G6 推荐引擎增强 — Contextual | 1.5 天 | ⭐⭐⭐⭐ | G4（需要 `proactive_mode` 判断） |
| **P1-3** | G5 Token 透明化 | 2 天 | ⭐⭐⭐ | 无（纯本地） |

### 5.2 排序理由

1. **G4 优先**：`proactive_mode` 是整个 Phase 2 的中枢开关。G6 的 radar 切换行为依赖它，后续 Phase 3 的感知系统也需要它。且改动量最小（1 天），可以快速交付验证。

2. **G6 次之**：推荐精准度是用户感知最强烈的价值点。「推的东西跟我有关」vs「推的是全站热门」——这是 NPS 分水岭。G6 依赖 G4 的 `proactive_mode` 判断，所以放在 G4 之后。

3. **G5 最后**：Token 透明化是「锦上添花」功能——用户即使没有它也能正常使用 Mapick。但它是 Phase 3 中「社交分享（炫 token 报告）」和「成本优化建议」的基础，需要提前建立数据基础设施。

### 5.3 实施建议

```
Day 1             Day 2             Day 3             Day 4
G4 ──────────────┤
                  G6 ────────────────────────────────┤
                                   G5 ───────────────────────────────┤
                                                      Integration Test ┤
```

**里程碑**：

| 里程碑 | 完成标准 | 预估日期 |
|--------|---------|---------|
| M1：Proactive Mode 可用 | `profile set proactive_mode=helpful` 生效，AI 行为变化可观测 | Day 1 结束 |
| M2：Contextual 推荐可用 | `recommend --contextual` 返回基于 profile 的推荐，radar 切换生效 | Day 3 开始 |
| M3：Token Report 可用 | `stats token today` 返回有意义的消耗数据 | Day 4 开始 |
| M4：Phase 2 集成测试完成 | 三个功能串联跑通、安全扫描通过 | Day 4 结束 |

---

## 6. API 依赖映射

### 6.1 依赖矩阵

| 需求 | 端点 | 方法 | 使用场景 | 是否新增客户端调用 | 状态 |
|------|------|:---:|---------|:-----------------:|------|
| G4 用户偏好 | — | — | 纯本地 CONFIG.md 读写 | — | — |
| G5 Token 透明 | — | — | 本地 session JSONL 解析 | — | — |
| G5 Token 透明（可选） | `/stats/user-token` | POST | 后续版本上报 token 到后端做跨设备同步 | 否（Phase 3） | 后端待开发 |
| G6 推荐增强 | `/recommendations/contextual` | GET | `recommend --contextual` + radar contextual 模式 | **是** | 后端已实现，客户端首次使用 |

### 6.2 ALLOWED_ENDPOINTS 变更

**新增** 1 条正则：

```diff
  const ALLOWED_ENDPOINTS = [
    /^\/assistant\/(status|workflow|daily-digest|weekly)\/[a-f0-9]{16}$/,
    /^\/recommendations\/(feed|track)$/,
+   /^\/recommendations\/contextual$/,
    /^\/skills\/live-search$/,
    /^\/skills\/check-updates$/,
    /^\/users\/[a-f0-9]{16}\/(zombies|profile-text)$/,
    /^\/users\/(trusted-skills|data|consent)$/,
    /^\/events\/track$/,
    /^\/bundle$/,
    /^\/bundle\/seed$/,
    /^\/bundle\/recommend\/list$/,
    /^\/bundle\/[\w-]+$/,
    /^\/bundle\/[\w-]+\/install$/,
    /^\/report\/persona$/,
    /^\/share\/upload$/,
    /^\/skill\/[\w-]+\/(security|report)$/,
    /^\/stats\/public$/,
    /^\/notify\/daily-check$/,
  ];
```

**总计后端端点依赖**：Phase 2 共需 1 个后端端点（`/recommendations/contextual`），已在后端实现但此前未被客户端启用。

### 6.3 后端 API 契约

#### `/recommendations/contextual`

| 属性 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/recommendations/contextual` |
| 认证 | Device FP（via `x-device-fp` header） |
| 查询参数 | `tags`（逗号分隔，string）、`installed`（逗号分隔，string）、`limit`（integer，默认 5）、`context`（可选，string） |
| 响应 | `{ recommendations: Recommendation[], context: { tags_matched: string[], gaps_identified: string[], total_available: number } }` |
| 错误处理 | 4xx：参数错误；5xx：降级到 `/recommendations/feed` |

---

## 7. 非功能需求

### 7.1 性能

| 需求 | 指标 | 目标 |
|------|------|------|
| G4 profile set | CONFIG.md 写入耗时 | ≤ 10ms（非阻塞 fs write） |
| G5 token 解析 | 增量解析 100MB session 文件耗时 | ≤ 3 秒 |
| G5 token 日志 | `token-usage.jsonl` 滚动策略 | 7 天自动归档，单文件 ≤ 10MB |
| G6 contextual 请求 | API 响应时间 | ≤ 2 秒（如超时降级到 feed） |

### 7.2 兼容性

| 需求 | 要求 |
|------|------|
| OS | macOS 14+, Linux (Ubuntu 22.04+, Debian 12+), WSL |
| Node | ≥ 22.14（对齐 Phase 1 baseline） |
| OpenClaw | 最新 stable 版本（session JSONL 格式兼容） |
| 向后兼容 | `proactive_mode` 未设置时默认 `helpful`，不影响老用户行为 |
| 向后兼容 | `recommend` 不加 `--contextual` 时长行为不变 |

### 7.3 可观测性

| 需求 | 要求 |
|------|------|
| G4 mode switch | 切换 proactive_mode 时触发 `POST /events/track`（type=`mode_switch`） |
| G5 token stats | 解析失败时输出结构化错误到 `token-usage.jsonl` 专用的 error log |
| G6 contextual | 降级时标记 `recommendation_source: "feed_fallback"` 到返回结果 |

### 7.4 安全性

| 需求 | 要求 |
|------|------|
| G4 profile set | `proactive_mode` 值白名单校验（仅 `off`/`silent`/`helpful`），拒绝其他值 |
| G5 token 日志 | 不记录任何对话内容、API key 或用户消息到 `token-usage.jsonl`（仅 token 计数 + skill 名） |
| G5 token 日志 | 文件权限 600（仅 owner 可读写），`~/.mapick/logs/` 目录权限 700 |
| G6 contextual 请求 | 不发送用户未经允许的数据到后端（仅 tags + installed skill slug + context query） |

### 7.5 向后兼容

| 需求 | 要求 |
|------|------|
| G4 | 老用户 CONFIG.md 无 `proactive_mode` 时默认 `helpful`，行为与 Phase 1 一致 |
| G5 | 无 session 日志时返回空报告，不报错 |
| G6 | 不加 `--contextual` 时保持 Phase 1 行为 |
| G6 | Contextual 端点不可用时降级到 feed，不阻断推荐 |

---

## 8. 风险与依赖

### 8.1 风险

| # | 风险 | 概率 | 影响 | 缓解措施 |
|:-:|------|:---:|:---:|---------|
| R1 | Contextual 端点后端返回格式与预期不一致 | 中 | 高 — 推荐不可用 | 实现健壮的响应解析 + 降级到 feed；先在测试环境 curl 验证 |
| R2 | Session JSONL 格式因 OpenClaw 升级而变化 | 低 | 中 — token 统计失败 | 解析前检查 JSONL 版本字段；无 version 时假设兼容；解析失败不阻塞其他功能 |
| R3 | 用户 session 日志量巨大（>500MB），增量解析时间长 | 低 | 低 — 体验下降 | 设置 3 秒超时；超时后提示用户「文件较大，首次解析需要时间，后续增量会快很多」 |
| R4 | `proactive_mode` 三档行为定义过于复杂导致 AI 不遵守 | 中 | 中 — 行为不一致 | SKILL.md 明确列举每档的 do/don't 规则，用表格固化行为边界 |
| R5 | ClawHub 安全扫描因新增 JSONL 文件读取逻辑标 Suspicious | 低 | 中 — 无法发布 | 文件读取限制到 `~/.openclaw/sessions/` 目录，使用白名单路径；发布前跑三档扫描 |
| R6 | Contextual 端点返回与用户无关的推荐（算法质量不足） | 中 | 高 — 推荐精准度体验差 | 依赖后端算法调优（属于后端 Phase 2 范畴）；客户端至少能正确传递 tags + installed 参数 |

### 8.2 依赖

| # | 依赖项 | 类型 | 说明 |
|:-:|------|:---:|------|
| D1 | `~/.openclaw/sessions/*.jsonl` 存在且格式兼容 | 环境 | G5 token 解析的数据源 |
| D2 | OpenClaw session 日志包含 `usage` 字段 | 环境 | G5 依赖此字段获取 token 计数 |
| D3 | `api.mapick.ai` 可达 | 网络 | G6 contextual 端点 |
| D4 | 后端 `/recommendations/contextual` 端点行为正确 | 外部 | G6 核心依赖 |
| D5 | Phase 1 G1（通知 cron 启用）已完成 | 前置 | G4 proactive_mode 的 helpful 模式下主动 radar 依赖 cron |
| D6 | Phase 1 G2（CONFIG.md 读写稳定）已完成 | 前置 | G4/G5/G6 均依赖 CONFIG.md |
| D7 | 无数据库新增依赖 | — | 全部纯本地或复用现有后端端点 |

---

## 9. 附录

### 9.1 术语表

| 术语 | 说明 |
|------|------|
| proactive_mode | 用户偏好键，控制 Mapick 的主动推荐程度，三档：`off` / `silent` / `helpful` |
| contextual recommendation | 基于用户 profile 标签 + 已安装 skill 列表 + 当前上下文生成的个性化推荐，区别于全站 trending |
| token 归因 | 将 AI 消息中的 token 消耗归属到具体 skill 的过程 |
| session JSONL | OpenClaw 在每个会话中生成的日志文件（`~/.openclaw/sessions/*.jsonl`），包含 `usage`、`tool` 等字段 |
| radar | 每日低频运行的 skill gap 检测器，最多输出 2 个个性化提醒 |
| feed fallback | 当 contextual 端点不可用时自动降级回 `/recommendations/feed`（全局 trending） |

### 9.2 与 Phase 1、Phase 3 的关系

```
Phase 1 (P0 — 已完成)          Phase 2 (P1 — 本次)           Phase 3 (P2 — 远期)
────────────────────────────────────────────────────────────────────────────────
✅ G1 通知 cron 启用      ───→  G4 proactive_mode           ───→  感知系统集成
✅ G2 安装体验改造              (helpful 模式依赖 cron)
✅ G3 slug 解析统一        
                                G5 Token 透明化             ───→  Cost optimization
                                (数据基础设施)                    AI model routing M8
                                
                                G6 Contextual 推荐增强       ───→  Social graph M5
                                (精准度提升)                      Developer API M7
```

### 9.3 参考资料

| 文档 | 路径 |
|------|------|
| Phase 1 PRD | `revisions/upgrade-plan-20260501/PRD.md`（本仓库上游） |
| Phase 2 升级计划 | `revisions/upgrade-plan-20260501/README.md` |
| V1.5 三大功能开发文档 | `revisions/slack-02/Mapick_V1.5_三大功能开发文档_KT.md` |
| Phase 1 架构方案 | `revisions/upgrade-plan-20260501/ARCHITECTURE.md` |
| Phase 1 CLI 设计 | `revisions/upgrade-plan-20260501/DESIGN.md` |
| 当前 ALLOWED_ENDPOINTS | `scripts/lib/http.js:59-77` |
| 当前 CONFIG.md | `CONFIG.md` |
| 当前 radar.js | `scripts/lib/radar.js` |

### 9.4 变更历史

| 日期 | 版本 | 变更 |
|------|:---:|------|
| 2026-05-01 | 1.0 | 初始版本，覆盖 Phase 2 三个 P1 需求：G4 用户偏好、G5 Token 透明化、G6 推荐引擎增强 |
| 2026-05-01 | 1.2 | 追加 Phase 3：G7 Stats Dashboard 增强、G8 Perception 集成 |

---

*文档状态：Draft → 待评审 → 评审通过后进入开发排期*
*Phase 2 预计总工时：4-5 天 | Phase 3 预计总工时：3-4 天*

---

---

# Phase 3 — 数据洞察与感知闭环

---

## 10. Phase 3 产品目标与范围

### 10.1 背景

Phase 2 完成了三个核心能力：用户偏好控制（G4）、Token 透明化（G5）、个性化推荐（G6）。Mapick 已经能够理解用户偏好、追踪 AI 成本、基于上下文做精准推荐。

**但数据通路仍未闭环**：

- **用户看不到自己的使用全貌**：Phase 2 的 `stats token` 只展示了 AI token 消耗，但用户不知道总共安装了多少 skill、推荐转化率如何、活跃天数等宏观指标
- **推荐系统的反馈回路缺失**：Mapick 推荐了 skill，但不知道用户是否点击、是否安装、推荐准确率如何。没有反馈，推荐算法无法自我优化
- **感知系统（Perception）虽然已有后端端点但从未被客户端使用**，导致推荐精准度的后验分析处于黑盒状态

Phase 3 聚焦**数据洞察与感知闭环**，让 Mapick 从一个「会推荐的工具」进化为一个「自我感知、持续优化的系统」。

### 10.2 产品目标

**一句话**：让用户看见自己的 Mapick 使用全貌，并让推荐系统拥有自我感知和反馈能力。

具体目标：

| 目标 | 当前状态 | 目标状态 |
|------|---------|---------|
| G7 Stats Dashboard 增强 | 仅有本地 `stats token`（token 消耗），无后端 stats 端点 | `stats --detail` 展示个人使用全貌（事件总量、推荐转化率、活跃天数、安装趋势、top skills）；Dashboard AI 渲染卡片升级 |
| G8 Perception 集成 | 后端 `/perception/accuracy-trend` 和 `/perception/summary` 已实现但从未被客户端调用 | Stats 中展示推荐准确率趋势；Daily digest 中展示感知摘要 |

### 10.3 范围（In/Out）

**In Scope（本次 Phase 3）**：

- **G7 Stats Dashboard 增强**：
  - 新后端端点 `GET /stats/user/:userId`，返回个人 stats 全貌
  - 客户端 `stats --detail` CLI flag，调用新端点
  - Dashboard AI 渲染升级：合并本地 token stats + 后端 user stats，输出完整报告
  - 推荐漏斗可视化（曝光 → 点击 → 安装 → 活跃使用）
- **G8 Perception 集成**：
  - 客户端接入 `GET /perception/accuracy-trend`，在 stats 中展示推荐准确率趋势
  - 客户端接入 `GET /perception/summary`，在每日 digest 中展示感知摘要
  - AI 渲染规则：感知数据的人类可读解释
  - 降级策略：perception 端点不可用时不影响核心 stats 功能

**Out Scope（后续 Phase）**：

- 社交图谱 M5（Phase 4）
- 开发者 API M7（Phase 4）
- AI 模型路由 M8（Phase 4）
- Cost optimization（Phase 4，依赖 Phase 3 数据基础）
- Perception 后端算法调优（算法本身由后端团队负责，客户端仅做数据接入和展示）
- 推荐系统的实时反馈闭环（本次仅展示后验数据，不做实时调参）

### 10.4 后端依赖总览

| 需求 | 后端依赖 | 是否新增 |
|------|---------|:-------:|
| G7 Stats Dashboard | `GET /stats/user/:userId` | **新增（需后端开发）** |
| G8 Perception 集成 | `GET /perception/accuracy-trend`（已存在） | 复用现有端点 |
| G8 Perception 集成 | `GET /perception/summary`（已存在） | 复用现有端点 |

### 10.5 与 Phase 2 的关系

```
Phase 2 产出                           Phase 3 增强
────────────────────────────────────────────────────────────
G5 stats token (本地)         ───→    G7 stats --detail (本地 + 后端融合)
G6 contextual 推荐             ───→    G8 推荐准确率展示（推荐反馈闭环）
G4 proactive_mode (helpful)   ───→    G8 daily digest 中的感知摘要
```

---

## 11. 需求 7：Stats Dashboard 增强

### 11.1 问题描述

Phase 2 引入的 `stats token` 命令只展示了 AI token 消耗视角——用户能看到每个 skill 烧了多少 token、预估花了多少钱。但这只是使用全景中的一个切片。

用户缺失的视角：

- **我到底在 Mapick 上有多活跃？** 活跃天数、总事件量
- **推荐对我有用吗？** 看了多少推荐？点了多少？装了多少？转化率是多少？
- **我最依赖哪些 skill？** Top skills 排名
- **我的 skill 增长趋势如何？** 每周装了多少新 skill？是在持续探索还是停滞了？

这些数据后端已在 `/events/track` 中收集，但从未聚合返回给用户。Stats dashboard 需要从「token 会计」升级为「使用全景仪表盘」。

### 11.2 功能描述

#### F7.1：新后端端点 `GET /stats/user/:userId`

后端新增一个聚合 endpoint，返回指定用户的个人统计数据。

**端点定义**：

| 属性 | 值 |
|------|-----|
| **路径** | `GET /api/v1/stats/user/:userId` |
| **方法** | `GET` |
| **认证** | Device FP（via `x-device-fp` header），userId 必须与 device FP 关联的用户一致 |
| **查询参数** | `period`（可选，`7d` / `30d` / `90d`，默认 `30d`）、`includeTrend`（可选，`true`/`false`，默认 `true`） |
| **成功响应** | `200 OK`，JSON body（见下方 schema） |
| **错误响应** | `401` 未认证；`403` userId 不匹配；`404` 用户不存在；`500` 服务端错误 |

**响应 Schema**：

```json
{
  "userId": "a1b2c3d4e5f6g7h8",
  "period": {
    "from": "2026-04-01T00:00:00Z",
    "to": "2026-05-01T00:00:00Z",
    "days": 30
  },
  "stats": {
    "eventsTotal": 1520,
    "eventsByType": {
      "search": 320,
      "recommend_view": 340,
      "recommend_click": 85,
      "recommend_install": 42,
      "install": 68,
      "uninstall": 12,
      "radar_trigger": 28,
      "consent_grant": 5,
      "mode_switch": 3
    },
    "recommendShown": 340,
    "recommendClicked": 85,
    "recommendInstalled": 42,
    "conversionRate": {
      "click_through": 0.25,
      "install_rate": 0.494,
      "overall": 0.124
    },
    "activeDays": 28,
    "activeDaysRatio": 0.933,
    "topSkills": [
      { "slug": "github-ops", "name": "GitHub Operations", "interactions": 245, "category": "dev-tools" },
      { "slug": "code-review", "name": "AI Code Review", "interactions": 189, "category": "security-qa" },
      { "slug": "summarize", "name": "Smart Summarizer", "interactions": 156, "category": "productivity" },
      { "slug": "docker-manage", "name": "Docker Manager", "interactions": 98, "category": "dev-tools" },
      { "slug": "csv-converter", "name": "CSV Converter", "interactions": 72, "category": "data-science" }
    ],
    "installTrend": [
      { "week": "2026-W13", "count": 3, "cumulative": 15 },
      { "week": "2026-W14", "count": 5, "cumulative": 20 },
      { "week": "2026-W15", "count": 2, "cumulative": 22 },
      { "week": "2026-W16", "count": 4, "cumulative": 26 }
    ],
    "categoryDistribution": {
      "dev-tools": 8,
      "security-qa": 5,
      "productivity": 4,
      "data-science": 3,
      "frontend": 2,
      "other": 4
    }
  },
  "generatedAt": "2026-05-01T12:00:00Z"
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `eventsTotal` | number | 统计周期内所有事件总量 |
| `eventsByType` | object | 按事件类型拆分（search / recommend_view / recommend_click / recommend_install / install / uninstall / radar_trigger / consent_grant / mode_switch） |
| `recommendShown` | number | 推荐曝光次数（同 `eventsByType.recommend_view`） |
| `recommendClicked` | number | 推荐点击次数（同 `eventsByType.recommend_click`） |
| `recommendInstalled` | number | 推荐带来的安装次数（同 `eventsByType.recommend_install`） |
| `conversionRate` | object | 推荐转化漏斗：`click_through` = clicked/shown、`install_rate` = installed/clicked、`overall` = installed/shown |
| `activeDays` | number | 统计周期内有至少 1 个事件的天数 |
| `activeDaysRatio` | number | activeDays / 周期总天数 |
| `topSkills` | array | 按 interaction 次数降序排列的 top 5 skills（包含 slug、name、interactions、category） |
| `installTrend` | array | 按周统计的新增安装趋势（包含 count 和 cumulative） |
| `categoryDistribution` | object | 当前已安装 skill 的类别分布 |

**与现有 events track 的关系**：

该端点聚合 `POST /events/track` 写入的事件数据，不新增事件采集逻辑。数据来源为后端已有的 events 表。

#### F7.2：`stats --detail` CLI flag

现有 `stats token` 命令扩展，新增 `--detail` flag 触发全景报告：

```bash
# 仅 token 报告（Phase 2 行为，不变）
node scripts/shell.js stats token today

# 全景报告（Phase 3 新增）
node scripts/shell.js stats --detail

# 指定周期
node scripts/shell.js stats --detail --period 7d
node scripts/shell.js stats --detail --period 90d
```

**命令行为**：

- `stats --detail` 触发两路数据获取：
  1. 本地 token 解析（复用 Phase 2 的 `handleStatsToken` 逻辑）
  2. 后端 `GET /stats/user/:userId` 请求
- 两路数据合并后返回统一的 JSON，供 AI 渲染
- 如果后端请求失败（网络/认证/500），仅返回本地 token 数据 + 后端数据缺失的友好提示

**合并后的返回 JSON 结构**：

```json
{
  "intent": "stats:detail",
  "period": "30d",
  "from": "2026-04-01T00:00:00Z",
  "to": "2026-05-01T00:00:00Z",
  "local": {
    // Phase 2 的 token 数据（total / by_skill / daily_average / today_vs_average）
    "tokenReport": { "..." }
  },
  "remote": {
    // F7.1 的后端 stats 数据
    "userStats": { "..." },
    "source": "api"
  },
  "remoteFallback": false
}
```

#### F7.3：Dashboard AI 渲染升级

SKILL.md 中新增 `stats --detail` 的渲染规则（§16），将本地 token 数据 + 后端 user stats 融合为一个完整仪表盘。

**渲染结构**（从上到下）：

```
┌─────────────────────────────────────────────┐
│  📊 Mapick 使用全景 — 过去 30 天              │
│                                             │
│  👤 活跃天数：28/30（93%）· 总事件：1,520      │
│                                             │
│  💰 Token 消耗（简要）                        │
│     总计 205K tokens · 预估 $0.85            │
│     top 3: github-ops / code-review / summarize│
│                                             │
│  🎯 推荐漏斗                                  │
│     曝光 340 → 点击 85(25%) → 安装 42(49%)    │
│     整体转化率：12.4%                          │
│     📈 高于全平台平均（9.8%）                  │
│                                             │
│  ⭐ Top Skills（按使用频次）                    │
│     1. github-ops        245 次 ██████████   │
│     2. code-review       189 次 ████████░░   │
│     3. summarize         156 次 ██████░░░░   │
│     4. docker-manage      98 次 ████░░░░░░   │
│     5. csv-converter      72 次 ███░░░░░░░   │
│                                             │
│  📈 安装趋势                                  │
│     W13 ███  3                              │
│     W14 █████ 5   ▲                         │
│     W15 ██ 2        ▼                       │
│     W16 ████ 4        ▲                     │
│     → 累计 26 个 skill                       │
│                                             │
│  🏷️ 类别分布                                 │
│     dev-tools 8 · security-qa 5 ·           │
│     productivity 4 · data-science 3 · ...    │
│                                             │
│  💡 洞察：你的推荐转化率(12.4%)高于平均。       │
│     安全类 skill 是你最常安装的类别（占 31%）。 │
└─────────────────────────────────────────────┘
```

**渲染规则**（写入 SKILL.md §16）：

1. **Token 部分保持简洁**：在 detail 模式下，token 数据降为简要摘要（总计 + top 3），详细信息仍由 `stats token` 命令提供。
2. **推荐漏斗必须有**：三个转化率数值 + 平台平均对比（如果后端返回）。
3. **Top skills 最多 5 个**，用 ASCII bar 表示相对占比。
4. **安装趋势用 ASCII 柱状图**，标注周环比涨跌（▲▼→）。
5. **至少一条洞察**：AI 根据数据自动生成（如转化率对比、类别偏好、增长趋势判断）。
6. **禁止事项**：不输出原始 JSON、不因后端缺失而报错（降级展示本地数据 + 提示）、不在 trend 为 0 时说「增长强劲」（数据驱动，不编造）。

#### F7.4：推荐漏斗可视化

推荐漏斗是 stats dashboard 中最关键的「推荐效果」指标。它回答了用户和管理员共同关心的核心问题：**推荐到底有没有用？**

**漏斗定义**：

```
推荐曝光 (recommendShown)
    │
    │ 点击率 (CTR) = clicked / shown
    ▼
推荐点击 (recommendClicked)
    │
    │ 安装率 (Install Rate) = installed / clicked
    ▼
推荐安装 (recommendInstalled)
    │
    │ 整体转化率 (Overall) = installed / shown
    ▼
持续使用（后续 Phase 4 扩展：安装后 7 天仍活跃）
```

**AI 渲染**：

漏斗以文本 + ASCII 箭头呈现，如：

```
🎯 推荐漏斗（30 天）
   曝光 340 ──→ 点击 85 (25%) ──→ 安装 42 (49%)
   整体转化率：12.4%（42/340）
```

**对比基准**：
- 后端 `/stats/user/:userId` 可选择性返回 `platformAverageConversionRate`（全平台平均转化率）
- 如果返回，AI 在渲染时与用户数据对比，输出「高于/低于平均」
- 如果不返回，只展示绝对值不对比

### 11.3 用户故事

#### US-7.1：用户查看个人使用全貌

> **作为** 安装了 Mapick 超过一周的用户  
> **我希望** 输入 `/mapick stats --detail` 能看到我的使用全景（活跃天数、总事件、推荐转化率、top skills、安装趋势）  
> **以便** 我了解自己对 Mapick 的使用深度，判断是否需要调整使用习惯

**优先级**：P1  
**依赖**：F7.1（后端端点）、F7.2（CLI flag）、F7.3（AI 渲染规则）  
**预期效果**：用户对 Mapick 价值的感知从「模糊感觉有用」变为「数据证实有用」

#### US-7.2：用户追踪自身 skill 增长趋势

> **作为** 持续探索新 skill 的用户  
> **我希望** 在 stats 中看到我每周安装 skill 的趋势图  
> **以便** 我判断自己的探索节奏——是否最近停滞了？是否某个时段装得太多需要消化？

**优先级**：P1  
**依赖**：F7.1（installTrend）、F7.3  
**预期效果**：用户对自身 growth 节奏有清晰认知

#### US-7.3：用户理解推荐对自己的价值

> **作为** 收到过多次推荐的用户  
> **我希望** 看到推荐转化漏斗（曝光 → 点击 → 安装），并与平台平均对比  
> **以便** 我判断 Mapick 的推荐对我是否精准，以及我是否需要调整 profile 标签来提高推荐质量

**优先级**：P1  
**依赖**：F7.1（conversionRate）、F7.4（漏斗可视化）  
**预期效果**：用户行为驱动 profile 优化（更多用户填写准确的 user_profile_tags）

#### US-7.4：后端不可用时仍能查看本地 stats

> **作为** 在网络不稳定环境下的用户  
> **我希望** `stats --detail` 在后端不可用时仍能展示本地 token 数据，并明确提示后端数据暂时不可用  
> **以便** 我不会因为网络问题而完全看不到任何 stats

**优先级**：P2  
**依赖**：F7.2（remoteFallback）  
**预期效果**：核心功能不受后端可用性影响

### 11.4 验收标准

| # | 验收条件 | 测试方法 |
|:-:|---------|---------|
| AC7.1 | `GET /stats/user/:userId` 在有效请求下返回 200，JSON body 符合 schema | curl / Postman 测试 |
| AC7.2 | `GET /stats/user/:userId` 在 userId 不匹配 device FP 时返回 403 | 用不同 device FP 请求 |
| AC7.3 | `GET /stats/user/:userId?period=7d` 返回 7 天范围内的数据 | 检查 `period.from`/`period.to` 间隔 |
| AC7.4 | `stats --detail` CLI 命令成功执行，返回合并后的本地 + 远程 JSON | CLI 测试，检查 JSON 包含 `local` 和 `remote` |
| AC7.5 | `stats --detail` 在后端不可用时（5xx/超时）`remoteFallback: true`，`remote.userStats` 为 null 或空对象 | 模拟后端故障 |
| AC7.6 | 推荐转化率 math 正确：`overall` = `recommendInstalled` / `recommendShown` | 手动验算 |
| AC7.7 | `topSkills` 数组按 `interactions` 降序排列，最多 5 个 | JSON 结构检查 |
| AC7.8 | `installTrend` 数组按 `week` 升序排列，包含 `count` 和 `cumulative` | JSON 结构检查 |
| AC7.9 | AI 渲染 `stats --detail` 时不输出原始 JSON | AI 响应检查 |
| AC7.10 | AI 渲染中包含推荐漏斗（三个转化率至少有数值呈现） | AI 响应检查：可见「曝光」「点击」「安装」及百分比 |
| AC7.11 | AI 渲染中包含至少一条数据洞察（如转化率对比、类别偏好、趋势判断） | AI 响应检查：可见 `💡` 开头的洞察行 |
| AC7.12 | 后端不可用时 AI 渲染仅展示本地 token 数据 + 「后端数据暂时不可用」提示 | AI 响应检查：无后端数据时不编造 |

### 11.5 涉及文件

| 文件 | 变更类型 | 变更说明 |
|------|:-------:|---------|
| `scripts/lib/stats.js` | 修改 | 新增 `handleStatsDetail()` 函数：组装本地 token + 请求后端 user stats |
| `scripts/lib/http.js` | 修改 | `ALLOWED_ENDPOINTS` 新增 `/stats/user/[a-f0-9]{16}` |
| `scripts/shell.js` | 修改 | 调度路由新增 `stats --detail` + `--period` 参数解析 |
| `scripts/lib/core.js` | 修改 | 新增 `fetchUserStats(userId, period)` helper |
| `SKILL.md` | 新增 | §16 Stats Dashboard 渲染规则（detail 模式） |
| **后端** | **新增** | `GET /stats/user/:userId` endpoint（需与后端团队协调实现） |

### 11.6 后端 API 契约补充

#### `GET /stats/user/:userId` — 详细规范

| 属性 | 值 |
|------|-----|
| **方法** | `GET` |
| **路径** | `/stats/user/:userId` |
| **认证** | Device FP（via `x-device-fp` header） |
| **查询参数** | `period`（`7d`/`30d`/`90d`，默认 `30d`）、`includeTrend`（`true`/`false`，默认 `true`） |
| **响应** | `{ userId, period, stats: { eventsTotal, eventsByType, recommendShown, recommendClicked, recommendInstalled, conversionRate, activeDays, activeDaysRatio, topSkills[], installTrend[], categoryDistribution }, generatedAt }` |
| **错误处理** | `401` 未认证 → AI 提示「需要重新认证」；`403` userId 不匹配 → AI 不重试；`404` 用户不存在 → AI 提示「暂无数据，使用一段时间后回来查看」；`500` → 降级到本地 token 数据 |
| **缓存策略** | 客户端缓存 5 分钟（同一周期内不重复请求）；ETag 支持可选 |
| **频率限制** | 每分钟最多 10 次请求（per device FP） |

---

## 12. 需求 8：Perception 集成

### 12.1 问题描述

Mapick 的推荐系统（G6 contextual）基于用户 profile 标签 + 已安装 skill 列表生成推荐。但这个推荐到底准不准？推荐了 100 个 skill，用户装了几个？哪些类别的推荐最精准？哪些类别总是被忽略？

后端已有 perception 系统（负责后验分析推荐准确率），但它从未被客户端使用。这导致：

- **用户看不到推荐效果**：只知道「Mapick 推了东西给我」，不知道推得准不准
- **推荐系统无法从用户行为中学习**：perception 数据对后端来说是优化算法的输入，但如果客户端不展示、用户不反馈，数据闭环就不完整
- **Daily digest 缺乏深度**：当前的每日通知只说「有新的推荐」或「token 消耗」，缺少对推荐质量的反思

Perception 集成将后端已有的后验分析数据呈现给用户，完成「推荐 → 行为追踪 → 准确率分析 → 用户可见」的闭环。

### 12.2 功能描述

#### F8.1：接入 `GET /perception/accuracy-trend`

客户端接入后端已有的 `GET /perception/accuracy-trend` 端点，获取推荐准确率的时间趋势。

**端点定义**（后端已实现，客户端首次接入）：

| 属性 | 值 |
|------|-----|
| **路径** | `GET /api/v1/perception/accuracy-trend` |
| **方法** | `GET` |
| **认证** | Device FP（via `x-device-fp` header） |
| **查询参数** | `period`（可选，`7d`/`30d`/`90d`，默认 `30d`） |
| **成功响应** | `200 OK`，见下方 schema |

**响应 Schema**（预期的后端返回格式）：

```json
{
  "period": {
    "from": "2026-04-01T00:00:00Z",
    "to": "2026-05-01T00:00:00Z",
    "days": 30
  },
  "trend": [
    { "date": "2026-04-25", "accuracy": 0.72, "total": 15, "correct": 11 },
    { "date": "2026-04-26", "accuracy": 0.68, "total": 12, "correct": 8 },
    { "date": "2026-04-27", "accuracy": 0.75, "total": 18, "correct": 14 },
    { "date": "2026-04-28", "accuracy": 0.80, "total": 10, "correct": 8 },
    { "date": "2026-04-29", "accuracy": 0.73, "total": 14, "correct": 10 },
    { "date": "2026-04-30", "accuracy": 0.78, "total": 16, "correct": 12 },
    { "date": "2026-05-01", "accuracy": 0.82, "total": 8, "correct": 7 }
  ],
  "overall": {
    "accuracy": 0.75,
    "totalPredictions": 93,
    "correctPredictions": 70
  },
  "byCategory": [
    { "category": "security-qa", "accuracy": 0.85, "total": 25, "correct": 21 },
    { "category": "dev-tools", "accuracy": 0.78, "total": 30, "correct": 23 },
    { "category": "productivity", "accuracy": 0.72, "total": 18, "correct": 13 },
    { "category": "data-science", "accuracy": 0.55, "total": 12, "correct": 7 },
    { "category": "frontend", "accuracy": 0.60, "total": 8, "correct": 5 }
  ]
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `trend[].date` | string | ISO 日期 |
| `trend[].accuracy` | number | 当日推荐准确率（correct / total），0-1 |
| `trend[].total` | number | 当日推荐总量（用户收到了多少推荐） |
| `trend[].correct` | number | 当日正确推荐数（用户点击或安装了推荐） |
| `overall.accuracy` | number | 周期内整体准确率 |
| `byCategory[].accuracy` | number | 按类别拆分的推荐准确率 |

**准确率定义**（需与后端对齐）：

> 准确率 = 用户点击或安装的推荐数 / 推荐曝光总数

「正确推荐」定义为用户在推荐曝光后 **24 小时内** 点击或安装了该推荐。这个定义需要在客户端和后端保持一致。

#### F8.2：接入 `GET /perception/summary`

客户端接入 `GET /perception/summary`，获取感知系统的整体摘要——用于每日 digest 和 stats dashboard。

**端点定义**（后端已实现，客户端首次接入）：

| 属性 | 值 |
|------|-----|
| **路径** | `GET /api/v1/perception/summary` |
| **方法** | `GET` |
| **认证** | Device FP（via `x-device-fp` header） |
| **查询参数** | 无 |
| **成功响应** | `200 OK`，见下方 schema |

**响应 Schema**（预期的后端返回格式）：

```json
{
  "overallAccuracy": 0.75,
  "totalPredictions": 450,
  "correctPredictions": 338,
  "trendDirection": "improving",
  "trendDelta": 0.08,
  "topCorrectCategories": [
    { "category": "security-qa", "accuracy": 0.85 },
    { "category": "dev-tools", "accuracy": 0.78 }
  ],
  "topMissedCategories": [
    { "category": "data-science", "accuracy": 0.55 },
    { "category": "frontend", "accuracy": 0.60 }
  ],
  "insights": [
    "推荐准确率在安全类 skill 中最高（85%），在数据科学类最低（55%）",
    "过去 7 天准确率从 72% 提升至 82%（+10%），呈上升趋势",
    "建议完善 data-science 和 frontend 的 profile 标签以获得更精准推荐"
  ],
  "generatedAt": "2026-05-01T12:00:00Z"
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `overallAccuracy` | number | 全周期整体准确率（0-1） |
| `totalPredictions` | number | 推荐预测总数 |
| `correctPredictions` | number | 正确预测数 |
| `trendDirection` | string | 趋势方向：`improving` / `declining` / `stable` |
| `trendDelta` | number | 最近一周准确率变化量（正数 = 改善，负数 = 下降） |
| `topCorrectCategories` | array | 准确率最高的类别 top 2 |
| `topMissedCategories` | array | 准确率最低的类别 top 2 |
| `insights` | array | 人类可读的洞察文本（后端生成） |

#### F8.3：Stats Dashboard 中的感知展示

在 `stats --detail` 的输出中集成 perception 数据。当 `stats --detail` 触发时，客户端额外发起 perception 请求。

**新增的第三个数据源**：

```
stats --detail
    ├── 本地 token 解析（Phase 2，已有）
    ├── GET /stats/user/:userId（F7.1，新增）
    └── GET /perception/accuracy-trend（F8.1，新增）
```

**渲染位置**：在推荐漏斗下方插入「推荐准确率」区块：

```
🎯 推荐漏斗（30 天）
   曝光 340 → 点击 85(25%) → 安装 42(49%)
   整体转化率：12.4%

📐 推荐准确率（后验分析）
   整体准确率：75%（70/93 条推荐命中）
   趋势：▁▂▃▄▅▆▇  ↗ 上升（+10%，近 7 天）
   
   按类别：
     security-qa  85% ████████████████░  ★ 最准
     dev-tools    78% ███████████████░░
     productivity 72% ██████████████░░░
     frontend     60% ████████████░░░░░
     data-science 55% ███████████░░░░░░  ▲ 需关注
   
   💡 洞察：安全类推荐最精准(85%)，你的安全工具探索意愿很强。
      数据科学类准确率偏低(55%)，建议完善相关 profile 标签。
```

**渲染规则**（写入 SKILL.md §16）：

1. 准确率区块在推荐漏斗之后、Top Skills 之前展示。
2. 趋势用 7 段 ASCII sparkline（`▁▂▃▄▅▆▇`）可视化最近 7 天的趋势。
3. 按类别拆分用 ASCII bar 展示，标注最高/最低。
4. 如果 perception 端点不可用（5xx/超时），跳过该区块——不阻塞 stats 渲染。
5. 后端返回的 `insights` 数组至少在渲染中引用 1 条。

#### F8.4：Daily Digest 中的感知摘要

`notify daily`（每日通知）中集成 `GET /perception/summary`，在每日 digest 消息末尾插入「Mapick 感知简报」。

**集成方式**：

```javascript
// notify daily 流程（scripts/lib/notify.js handleNotifyDaily()）中新增：
const perceptionSummary = await fetchPerceptionSummary(); // GET /perception/summary
// 如果请求成功，拼接到 daily digest JSON 中
```

**Digest JSON 扩展**（新增 `perception` 字段）：

```json
{
  "intent": "notify:daily",
  "radar": { "..." },
  "token_snapshot": { "..." },
  "perception": {
    "overallAccuracy": 0.75,
    "trendDirection": "improving",
    "insight": "推荐准确率 75%，近 7 天上升趋势（+10%）。安全类推荐最精准。"
  }
}
```

**AI 渲染示例**（在 daily digest 末尾追加）：

```
🧠 Mapick 感知简报
   推荐准确率：75%（↑ +10%，近 7 天）
   最精准类别：安全类(85%)、开发工具(78%)
   建议关注：数据科学类准确率偏低(55%)，可完善 profile 标签
```

**渲染规则**：

1. 感知简报放在 daily digest 的末尾，作为补充信息而非主要信息。
2. 如果 perception 端点不可用，**静默跳过**——不在 daily digest 中提示「感知数据不可用」。
3. 如果整体准确率低于 50%，AI 主动建议用户运行 `stats --detail` 查看详细分析。
4. 如果 `trendDirection === "declining"` 且 `trendDelta < -0.1`，AI 建议用户更新 profile 标签。

#### F8.5：ALLOWED_ENDPOINTS 变更

为接入 perception 端点，需在 `ALLOWED_ENDPOINTS`（`scripts/lib/http.js`）中新增两条正则：

```diff
  const ALLOWED_ENDPOINTS = [
    /^\/assistant\/(status|workflow|daily-digest|weekly)\/[a-f0-9]{16}$/,
    /^\/recommendations\/(feed|track)$/,
    /^\/recommendations\/contextual$/,
    /^\/skills\/live-search$/,
    /^\/skills\/check-updates$/,
    /^\/users\/[a-f0-9]{16}\/(zombies|profile-text)$/,
+   /^\/stats\/user\/[a-f0-9]{16}$/,
    /^\/users\/(trusted-skills|data|consent)$/,
    /^\/events\/track$/,
    /^\/bundle$/,
    /^\/bundle\/seed$/,
    /^\/bundle\/recommend\/list$/,
    /^\/bundle\/[\w-]+$/,
    /^\/bundle\/[\w-]+\/install$/,
    /^\/report\/persona$/,
    /^\/share\/upload$/,
    /^\/skill\/[\w-]+\/(security|report)$/,
    /^\/stats\/public$/,
+   /^\/perception\/accuracy-trend$/,
+   /^\/perception\/summary$/,
    /^\/notify\/daily-check$/,
  ];
```

**总计新增** 3 条正则：
- `/^\/stats\/user\/[a-f0-9]{16}$/` — F7.1
- `/^\/perception\/accuracy-trend$/` — F8.1
- `/^\/perception\/summary$/` — F8.2

### 12.3 用户故事

#### US-8.1：用户在 stats 中看到推荐准确率

> **作为** 在意推荐质量的用户  
> **我希望** 在 `/mapick stats --detail` 中看到推荐准确率趋势和按类别的拆分  
> **以便** 我判断 Mapick 的推荐是否越来越懂我，以及哪些领域需要完善 profile

**优先级**：P1  
**依赖**：F8.1、F8.3、F7（stats --detail 框架）  
**预期效果**：用户对推荐系统的信任度提升，驱动 profile 完善行为

#### US-8.2：用户在每日通知中看到感知简报

> **作为** 每天查看 Mapick 通知的用户  
> **我希望** 在 daily digest 中看到推荐准确率的简要汇报  
> **以便** 我不用主动查 stats 也能感知推荐系统的表现变化

**优先级**：P1  
**依赖**：F8.2、F8.4  
**预期效果**：增加 daily digest 的信息深度，从「推荐了什么」升级为「推荐得怎么样」

#### US-8.3：后端不可用时无感知降级

> **作为** 在网络波动环境下的用户  
> **我希望** perception 数据不可用时，stats 和 daily digest 仍能正常展示核心信息  
> **以便** 我不会因为一个辅助功能不可用而丢失核心体验

**优先级**：P2  
**依赖**：F8.3（跳过逻辑）、F8.4（静默跳过）  
**预期效果**：perception 是「锦上添花」而非「不可或缺」，降级不影响核心链路

#### US-8.4：准确率下降时获得 actionable 建议

> **作为** 发现推荐准确率下降的用户  
> **我希望** Mapick 不只告诉我「准确率下降了」，还要告诉我可以做什么（如更新 profile 标签、清理不再需要的 skill）  
> **以便** 我能采取行动改善推荐质量，而不是被动接受下降

**优先级**：P2  
**依赖**：F8.2（insights 字段）、F8.4（AI 建议逻辑）  
**预期效果**：数据展示 → 用户行动的正向循环

### 12.4 验收标准

| # | 验收条件 | 测试方法 |
|:-:|---------|---------|
| AC8.1 | `GET /perception/accuracy-trend` 在 `ALLOWED_ENDPOINTS` 中 | 代码检查 `http.js` |
| AC8.2 | `GET /perception/summary` 在 `ALLOWED_ENDPOINTS` 中 | 代码检查 `http.js` |
| AC8.3 | `stats --detail` 输出中包含 `perception` 数据块（accuracy trend） | JSON 检查：`remote.perception` 字段存在且非空 |
| AC8.4 | AI 渲染 stats --detail 时包含「推荐准确率」区块 | AI 响应检查：可见「准确率」「趋势」关键词 |
| AC8.5 | AI 渲染准确率时使用 sparkline（7 段）可视化趋势 | AI 响应检查：可见 `▁▂▃▄▅▆▇` 字符 |
| AC8.6 | AI 渲染准确率时按类别拆分（至少展示 top 3 / bottom 2） | AI 响应检查：可见类别名 + 百分比 |
| AC8.7 | Daily digest JSON 中包含 `perception` 字段 | notify daily 输出检查 |
| AC8.8 | Daily digest AI 渲染末尾有「感知简报」区块（如果 perception 成功） | AI 响应检查 |
| AC8.9 | Perception 请求失败时 daily digest 不展示感知区块（静默跳过） | 模拟后端故障，检查日常通知不含 perception 内容 |
| AC8.10 | Perception 请求失败时 stats --detail 仍正常展示（跳过感知区块） | 模拟后端故障，检查 stats 输出 |
| AC8.11 | 整体准确率 < 50% 时 daily digest 建议用户运行 `stats --detail` | AI 响应检查 |
| AC8.12 | `trendDirection === "declining"` 且 delta < -0.1 时建议完善 profile | AI 响应检查 |

### 12.5 涉及文件

| 文件 | 变更类型 | 变更说明 |
|------|:-------:|---------|
| `scripts/lib/http.js` | 修改 | `ALLOWED_ENDPOINTS` 新增 3 条：`/stats/user/`、`/perception/accuracy-trend`、`/perception/summary` |
| `scripts/lib/stats.js` | 修改 | `handleStatsDetail()` 新增 perception 数据获取 + 合并逻辑 |
| `scripts/lib/core.js` | 修改 | 新增 `fetchPerceptionTrend(period)` 和 `fetchPerceptionSummary()` helper |
| `scripts/lib/notify.js` | 修改 | `handleNotifyDaily()` 集成 perception summary 到 digest JSON |
| `SKILL.md` | 新增 | §17 Perception 集成渲染规则（accuracy trend + daily digest perception 简报） |
| **后端**（参考） | 已有 | `/perception/accuracy-trend` 和 `/perception/summary` 已实现，客户端首次接入 |

---

## 13. Phase 3 优先级排序

### 13.1 排序总览

| 优先级 | 需求 | 工作量 | 用户价值 | 前置条件 |
|:------:|------|:------:|:-------:|---------|
| **P3-1** | G7 Stats Dashboard — 后端端点 + CLI | 1.5 天 | ⭐⭐⭐⭐⭐ | 后端 `/stats/user/:userId` 需同步开发 |
| **P3-2** | G8 Perception 集成 — Stats 中的准确率 | 1 天 | ⭐⭐⭐⭐ | G7（stats --detail 框架）+ Perception 端点已有 |
| **P3-3** | G8 Perception 集成 — Daily Digest | 0.5 天 | ⭐⭐⭐ | G7（notify 链路）+ Perception 端点已有 |

### 13.2 排序理由

1. **G7 优先**：Stats dashboard 是整个 Phase 3 的数据展示框架。F8 的 perception 数据需要 stats dashboard 作为载体。且 G7 依赖后端新增端点（`GET /stats/user/:userId`），需要与后端团队协调排期，应尽早启动。

2. **G8 Stats 集成次之**：perception accuracy-trend 的展示依赖 G7 的 `stats --detail` 框架，但 perception 端点已经存在，客户端接入工作量小（约 1 天）。在 stats dashboard 中展示准确率能直接提升用户对推荐系统的信任。

3. **G8 Daily Digest 最后**：daily digest 中的感知简报是「锦上添花」——用户不主动查 stats 时，仍能在日常通知中感知推荐质量。工作量最小（0.5 天），可作为 Phase 3 的收尾。

### 13.3 实施建议

```
Day 1-2 (G7)          Day 2-3 (G8 Stats)     Day 3 (G8 Digest)    Day 4
────────────────────────────────────────────────────────────────────────
后端 /stats/user/:userId 开发（后端团队）
客户端 stats --detail 框架      ───────┤
                       Perception accuracy-trend 集成 ──┤
                                           Daily digest 集成 ──┤
                                                               Integration Test ┤
```

**里程碑**：

| 里程碑 | 完成标准 | 预估日期 |
|--------|---------|---------|
| M5：后端 Stats 端点可用 | `GET /stats/user/:userId` 返回有效数据 | Day 2 开始 |
| M6：Stats Dashboard 可用 | `stats --detail` 返回合并后的完整 JSON，AI 正确渲染 | Day 2 结束 |
| M7：Perception 集成可用 | `stats --detail` 中包含准确率区块，daily digest 中有感知简报 | Day 3 结束 |
| M8：Phase 3 集成测试完成 | 所有功能串联、降级策略验证、安全扫描通过 | Day 4 结束 |

### 13.4 与 Phase 2 的依赖关系

```
Phase 2 (已完成或并行)            Phase 3 (本次)
─────────────────────────────────────────────────
G5 stats token           ───→    G7 stats --detail（融合本地 + 后端）
G6 contextual 推荐        ───→    G8 推荐准确率展示
G4 proactive_mode         ───→    G8 daily digest 感知简报（仅 helpful 模式展示）
notify daily 链路          ───→    G8 daily digest 感知集成
```

---

## 14. Phase 3 API 依赖映射

### 14.1 依赖矩阵

| 需求 | 端点 | 方法 | 使用场景 | 是否新增客户端调用 | 状态 |
|------|------|:---:|---------|:-----------------:|------|
| G7 Stats Dashboard | `/stats/user/:userId` | GET | `stats --detail` 获取个人使用全貌 | **是** | **后端待开发** |
| G8 Perception | `/perception/accuracy-trend` | GET | `stats --detail` 中展示推荐准确率趋势 | **是** | 后端已实现，客户端首次接入 |
| G8 Perception | `/perception/summary` | GET | `notify daily` 中展示感知摘要 | **是** | 后端已实现，客户端首次接入 |

### 14.2 ALLOWED_ENDPOINTS 变更汇总

**Phase 2 新增**（1 条）：

| 正则 | 来源 |
|------|------|
| `/^\/recommendations\/contextual$/` | G6 推荐增强 |

**Phase 3 新增**（3 条）：

| 正则 | 来源 |
|------|------|
| `/^\/stats\/user\/[a-f0-9]{16}$/` | G7 Stats Dashboard |
| `/^\/perception\/accuracy-trend$/` | G8 Perception 集成 |
| `/^\/perception\/summary$/` | G8 Perception 集成 |

**Phase 2 + Phase 3 合计**：ALLOWED_ENDPOINTS 从 Phase 1 的 20 条增加至 24 条。

### 14.3 后端 API 契约汇总

#### `GET /stats/user/:userId`（新增）

| 属性 | 值 |
|------|-----|
| **方法** | `GET` |
| **路径** | `/stats/user/:userId` |
| **认证** | Device FP（via `x-device-fp` header） |
| **查询参数** | `period`（`7d`/`30d`/`90d`）、`includeTrend`（`true`/`false`） |
| **响应** | `{ userId, period, stats: { eventsTotal, eventsByType, recommendShown, recommendClicked, recommendInstalled, conversionRate, activeDays, activeDaysRatio, topSkills[], installTrend[], categoryDistribution }, generatedAt }` |
| **错误处理** | `401`/`403`/`404`/`500`；`5xx` 时客户端降级到本地 token 数据 |
| **频率限制** | 10 req/min per device FP |
| **缓存** | 客户端 5 分钟缓存；支持 ETag（可选） |

#### `GET /perception/accuracy-trend`（已有，客户端首次接入）

| 属性 | 值 |
|------|-----|
| **方法** | `GET` |
| **路径** | `/perception/accuracy-trend` |
| **认证** | Device FP（via `x-device-fp` header） |
| **查询参数** | `period`（`7d`/`30d`/`90d`） |
| **响应** | `{ period, trend[], overall: { accuracy, totalPredictions, correctPredictions }, byCategory[] }` |
| **错误处理** | `5xx` 时 stats --detail 跳过感知区块；`401`/`403` 同上 |
| **缓存** | 客户端 10 分钟缓存 |

#### `GET /perception/summary`（已有，客户端首次接入）

| 属性 | 值 |
|------|-----|
| **方法** | `GET` |
| **路径** | `/perception/summary` |
| **认证** | Device FP（via `x-device-fp` header） |
| **查询参数** | 无 |
| **响应** | `{ overallAccuracy, totalPredictions, correctPredictions, trendDirection, trendDelta, topCorrectCategories[], topMissedCategories[], insights[], generatedAt }` |
| **错误处理** | `5xx` 时 daily digest 静默跳过；`401`/`403` 同上 |
| **缓存** | 客户端 30 分钟缓存（daily summary 变化频率低） |

---

## 15. Phase 3 非功能需求

### 15.1 性能

| 需求 | 指标 | 目标 |
|------|------|------|
| G7 stats --detail | 多路数据获取总耗时（本地 token + 后端 stats + perception） | ≤ 3 秒（含网络请求） |
| G7 stats --detail | 后端 `/stats/user/:userId` API 响应时间 | ≤ 500ms（p95） |
| G8 perception | `/perception/accuracy-trend` API 响应时间 | ≤ 300ms（p95） |
| G8 perception | `/perception/summary` API 响应时间 | ≤ 200ms（p95） |
| G7 remote fallback | 后端请求超时时间 | 2 秒（单端点），超时后降级 |
| G7 data freshness | 后端 stats 数据更新延迟 | ≤ 5 分钟（event track → stats 聚合） |

### 15.2 兼容性

| 需求 | 要求 |
|------|------|
| 向后兼容 | `stats token today/week` 行为不变（不加 `--detail` 时保持 Phase 2 行为） |
| 向后兼容 | `notify daily` 在 perception 数据缺失时行为不变 |
| ALLOWED_ENDPOINTS | 新增 endpoint 遵循现有正则模式，不破坏已有匹配 |
| userId 格式 | 保持 16 位十六进制字符 `[a-f0-9]{16}` |

### 15.3 可观测性

| 需求 | 要求 |
|------|------|
| G7 stats fetch | 后端 stats 请求失败时记录结构化错误（status code + 错误信息），写入本地日志 |
| G8 perception fetch | perception 请求失败时静默记录（不影响用户体验），写入本地日志 |
| G7 stats detail | `stats --detail` 执行时触发 `POST /events/track`（type=`stats_detail_view`） |
| G8 perception | 每日 digest 中 perception 数据的展示/跳过比例上报 events |

### 15.4 安全性

| 需求 | 要求 |
|------|------|
| G7 user stats | `/stats/user/:userId` 必须校验 `x-device-fp` 与 userId 的绑定关系，返回 403 如果不匹配 |
| G7 user stats | 响应的 `topSkills` 仅包含 slug/name/interactions/category，不含 token 或用户私密数据 |
| G8 perception | perception 端点同样需要 device FP 认证 |
| ALLOWED_ENDPOINTS | 仅允许 GET 请求到 perception 和 stats 端点 |

### 15.5 降级策略

| 场景 | 降级行为 | 用户感知 |
|------|---------|---------|
| `GET /stats/user/:userId` 返回 5xx | 仅展示本地 token 数据 + 「后端数据暂时不可用，稍后自动重试」 | 可见降级提示 |
| `GET /stats/user/:userId` 超时（>2s） | 同上 | 同上 |
| `GET /perception/accuracy-trend` 返回 5xx | stats --detail 跳过「推荐准确率」区块 | 该区块不显示，其余正常 |
| `GET /perception/summary` 返回 5xx | daily digest 跳过「感知简报」区块 | 静默跳过，不提示 |
| 本地 token 解析失败 | stats --detail 仅展示后端数据 + 「本地 token 数据解析失败」提示 | 可见降级提示 |
| 所有数据源均失败 | 返回友好错误：「暂时无法获取统计数据，请检查网络后重试」 | 完整降级 |

---

## 16. Phase 3 风险与依赖

### 16.1 风险

| # | 风险 | 概率 | 影响 | 缓解措施 |
|:-:|------|:---:|:---:|---------|
| R7 | 后端 `/stats/user/:userId` 开发延期 | 中 | 高 — stats --detail 无后端数据 | Phase 2 的 `stats token` 独立可用；客户端实现 remote fallback，确保有后端数据前也能展示本地数据 |
| R8 | Perception 端点返回格式与预期不一致 | 中 | 中 — 准确率展示失败 | 客户端健壮解析（`try/catch` 包裹）；格式不匹配时跳过感知区块，不影响核心 stats |
| R9 | Events 表中数据不足（新用户没有足够事件） | 高 | 低 — 新用户 dashboard 空荡荡 | 后端返回空数据时 `eventsTotal: 0`；客户端展示「数据收集中，使用 7 天后来看完整报告」 |
| R10 | 后端 stats 聚合查询在大数据量下性能不足 | 低 | 高 — API 响应超时 | 后端需对 events 表建立时间+userId 索引；客户端设置 2s 超时，超时即降级 |
| R11 | Perception 端点与 G6 contextual 推荐的准确率定义不一致 | 中 | 中 — 数据展示误导 | 与后端团队明确「准确率」定义（24h 内点击/安装），写入 API 契约文档 |
| R12 | ClawHub 安全扫描对新增的 perception 数据展示逻辑标 Suspicious | 低 | 中 | 感知数据仅展示统计数字，不涉及文件读取或网络请求到非白名单域名；发布前跑三档扫描 |

### 16.2 依赖

| # | 依赖项 | 类型 | 说明 |
|:-:|------|:---:|------|
| D8 | 后端实现 `GET /stats/user/:userId` | 外部 | G7 核心依赖，需与后端团队协调排期 |
| D9 | 后端 events 表包含 recommend_view / recommend_click / recommend_install 事件 | 外部 | G7 推荐漏斗的数据源 |
| D10 | 后端 `/perception/accuracy-trend` 端点格式与预期一致 | 外部 | G8 stats 集成依赖 |
| D11 | 后端 `/perception/summary` 端点格式与预期一致 | 外部 | G8 daily digest 集成依赖 |
| D12 | Phase 2 G5 `stats token` 已实现 | 前置 | G7 `stats --detail` 复用本地 token 解析逻辑 |
| D13 | Phase 2 G1 notify daily 链路已稳定 | 前置 | G8 daily digest 感知集成依赖 notify 链路 |
| D14 | Phase 2 G4 `proactive_mode` CONFIG 读写已稳定 | 前置 | G8 daily digest 仅 helpful 模式展示完整感知简报 |
| D15 | `api.mapick.ai` 可达 | 网络 | G7/G8 所有后端端点 |
| D16 | 无数据库新增依赖 | — | 全部复用现有后端基础设施 |

---

## 17. Phase 3 附录

### 17.1 术语表（Phase 3 补充）

| 术语 | 说明 |
|------|------|
| Stats Dashboard | 用户使用全景仪表盘，融合本地 token 数据 + 后端 user stats + perception 数据 |
| 推荐漏斗 | 从推荐曝光到安装的转化路径：shown → clicked → installed |
| 推荐准确率 | 推荐被用户点击或安装的比例（后验分析），计算方式 = correctPredictions / totalPredictions |
| Perception | 感知系统，负责后验分析推荐效果，包括准确率趋势和类别拆分 |
| Daily Digest 感知简报 | 每日通知末尾的推荐准确率简要汇报 |
| Sparkline | ASCII 字符构成的迷你趋势图（`▁▂▃▄▅▆▇`），用于可视化 7 天准确率趋势 |
| Remote fallback | 后端请求失败时的降级策略，确保核心功能不受影响 |

### 17.2 与 Phase 4 的关系展望

```
Phase 3 (本次)                        Phase 4 (远期)
────────────────────────────────────────────────────────────
G7 Stats Dashboard              ───→  社交分享（分享 stats 卡片）
G8 Perception 集成               ───→  AI 模型路由 M8（基于准确率选择模型）
G7 推荐漏斗                      ───→  Cost optimization（基于转化率优化推荐策略）
G7/G8 数据基础设施               ───→  开发者 API M7（暴露 stats 和 perception）
```

### 17.3 Phase 2 + Phase 3 完整端点清单

| # | 端点 | Phase | 用途 |
|:-:|------|:-----:|------|
| 1 | `/assistant/(status\|workflow\|daily-digest\|weekly)/:id` | 1 | 助理交互 |
| 2 | `/recommendations/(feed\|track)` | 1 | 推荐获取 |
| 3 | `/recommendations/contextual` | 2 | 上下文推荐 |
| 4 | `/skills/live-search` | 1 | Skill 搜索 |
| 5 | `/skills/check-updates` | 1 | Skill 更新检查 |
| 6 | `/users/:id/(zombies\|profile-text)` | 1 | 用户数据 |
| 7 | `/stats/user/:id` | **3** | 个人 stats |
| 8 | `/stats/public` | 1 | 公开统计 |
| 9 | `/users/(trusted-skills\|data\|consent)` | 1 | 用户管理 |
| 10 | `/events/track` | 1 | 事件追踪 |
| 11 | `/bundle/*` | 1 | Bundle 管理 |
| 12 | `/report/persona` | 1 | Persona 报告 |
| 13 | `/share/upload` | 1 | 分享上传 |
| 14 | `/skill/:slug/(security\|report)` | 1 | Skill 详情 |
| 15 | `/notify/daily-check` | 1 | 每日通知 |
| 16 | `/perception/accuracy-trend` | **3** | 准确率趋势 |
| 17 | `/perception/summary` | **3** | 感知摘要 |

### 17.4 参考资料

| 文档 | 路径 |
|------|------|
| Phase 1 PRD | `revisions/upgrade-plan-20260501/PRD.md`（本仓库上游） |
| Phase 2 PRD | 本文档 §1-§9 |
| Phase 2 升级计划 | `revisions/upgrade-plan-20260501/README.md` |
| V1.5 三大功能开发文档 | `revisions/slack-02/Mapick_V1.5_三大功能开发文档_KT.md` |
| 当前 ALLOWED_ENDPOINTS | `scripts/lib/http.js:59-77` |
| 当前 stats.js（Phase 2） | `scripts/lib/stats.js` |
| 当前 notify.js（Phase 2） | `scripts/lib/notify.js` |

### 17.5 变更历史（Phase 3 追加）

| 日期 | 版本 | 变更 |
|------|:---:|------|
| 2026-05-01 | 1.0 | 初始版本，覆盖 Phase 2 三个 P1 需求 |
| 2026-05-01 | 1.2 | 追加 Phase 3：G7 Stats Dashboard 增强、G8 Perception 集成 |

---

*Phase 3 预计总工时：3-4 天*
*文档状态：Draft → 待后端端点评审 → 评审通过后与 Phase 2 并行或串行开发*
