# Mapick v0.0.16 Phase 2 — 个性化与智能化 PRD

**版本**：1.0  
**日期**：2026-05-01  
**状态**：Draft  
**作者**：Mapick Product Team  
**来源**：Phase 2 升级计划 (`revisions/upgrade-plan-20260501/README.md`) + V1.5 三大功能开发文档 (`revisions/slack-02/`)  
**前置**：Phase 1 完成（notify cron、install verification、slug resolution）

---

## 目录

1. [产品目标与范围](#1-产品目标与范围)
2. [需求 4：用户偏好 — Proactive Mode](#2-需求-4用户偏好--proactive-mode)
3. [需求 5：Token 透明化](#3-需求-5token-透明化)
4. [需求 6：推荐引擎增强](#4-需求-6推荐引擎增强)
5. [优先级排序](#5-优先级排序)
6. [API 依赖映射](#6-api-依赖映射)
7. [非功能需求](#7-非功能需求)
8. [风险与依赖](#8-风险与依赖)
9. [附录](#9-附录)

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

---

*文档状态：Draft → 待评审 → 评审通过后进入开发排期*
*Phase 2 预计总工时：4-5 天*
