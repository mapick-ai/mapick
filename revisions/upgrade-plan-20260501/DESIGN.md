# Mapick Phase 1 — CLI 体验设计文档

**版本**: v1.0  
**日期**: 2026-05-01  
**范围**: install.sh 交互流程、安装验证、notify:plan 展示、slug 安装反馈  
**设计原则**: 纯文本 CLI 环境，输出通过 JSON 传递给 AI 渲染，install.sh 支持 `JSON_MODE=1` 机器可读输出

---

## 1. install.sh 安装脚本交互流程设计

### 1.1 设计目标

- 为人类用户提供清晰的安装进度和错误反馈
- 为机器消费者（`JSON_MODE=1`）提供结构化事件流
- 安装过程是原子操作，失败可回滚
- 每一步都有对应的 `json_event` 输出（当 JSON_MODE=1 时）

### 1.2 安装流程状态机

```
                    ┌─────────────┐
                    │  Platform   │
                    │   Check     │
                    └──────┬──────┘
                           │ OK
                    ┌──────▼──────┐
                    │   Version   │
                    │  Resolution │
                    └──────┬──────┘
                           │ resolved
                    ┌──────▼──────┐
                    │  OpenClaw   │
                    │  Detection  │
                    └──────┬──────┘
                           │ found
                    ┌──────▼──────┐
                    │   Node.js   │
                    │  Detection  │
                    └──────┬──────┘
                           │ valid
                    ┌──────▼──────┐
                    │   Preflight │
                    │ Classification │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  Fresh   │ │ Upgrade  │ │ Duplicate│
        │  Install │ │          │ │  Skip    │
        └────┬─────┘ └────┬─────┘ └──────────┘
             │            │
             ▼            ▼
        ┌──────────────────┐
        │   Download &     │
        │   Stage          │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │   Backup &       │
        │   Atomic Swap    │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │  Post-install    │
        │  Verification    │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │   Summary &      │
        │  Next Steps      │
        └──────────────────┘
```

### 1.3 人类可读输出规范（默认模式）

#### 1.3.1 Banner（安装开始时）

```
  ╔══════════════════════════════════════════╗
  ║                                          ║
  ║              M A P I C K                 ║
  ║       Mapick Intelligent Butler          ║
  ║                                          ║
  ╚══════════════════════════════════════════╝
```

- 仅非 JSON 模式输出
- Cyan 颜色，居中对齐

#### 1.3.2 状态标签系统

| 标签 | 颜色 | 用途 | 示例 |
|------|------|------|------|
| `[INFO]` | 蓝色 | 过程信息 | `[INFO]  Version: v0.0.15` |
| `[OK]` | 绿色 | 成功状态 | `[OK]    OpenClaw detected: /usr/local/bin/openclaw` |
| `[WARN]` | 黄色 | 警告/提示 | `[WARN]  Workspace Skill shadows managed Mapick` |
| `[ERROR]` | 红色 | 致命错误 | `[ERROR] Node.js 22.14+ required` |
| DIM（灰色） | 暗色 | 辅助细节 | `    Preserved: CONFIG.md` |

#### 1.3.3 进度分隔线

在关键操作切换时插入分隔线（dim 灰色）：

```
────────────────────────────────────────
```

#### 1.3.4 错误输出格式

```
[ERROR] <错误描述>

  <详细解释>
  <解决建议>
```

- 错误输出到 stderr (`>&2`)
- 错误后 `exit 1`
- 多行缩进 2 空格

#### 1.3.5 安装完成摘要

```
────────────────────────────────────────

[OK]    Done!

  Version: v0.0.15
  Backup:  ~/.openclaw/skills/.mapick.backup-20260501-120000

  Get started:
    /mapick                View status overview
    /mapick status         Detailed status
    /mapick clean          Clean up zombies
    /mapick bundle         Browse bundles
    /mapick daily          Daily report

  More info: https://github.com/mapick-ai/mapick
```

### 1.4 JSON 事件流规范（JSON_MODE=1）

#### 1.4.1 事件格式

每一行是一个独立的 JSON 对象，字段包括：

```json
{"event":"start","version":"v0.0.15","repo":"mapick-ai/mapick","dry_run":"0"}
{"event":"info","msg":"Version: v0.0.15"}
{"event":"ok","msg":"OpenClaw detected: /usr/local/bin/openclaw"}
{"event":"preflight","state":"older_version","current_version":"v0.0.14","target_version":"v0.0.15"}
{"event":"download","url":"https://github.com/mapick-ai/mapick/archive/v0.0.15.tar.gz"}
{"event":"stage","path":"/Users/evan/.openclaw/skills/.mapick.tmp-12345"}
{"event":"backup","from":"/Users/evan/.openclaw/skills/mapick","to":"/Users/evan/.openclaw/skills/.mapick.backup-20260501-120000"}
{"event":"swap","target":"/Users/evan/.openclaw/skills/mapick"}
{"event":"done","state":"older_version","version":"v0.0.15","target":"/Users/evan/.openclaw/skills/mapick","shadow_remaining":"0"}
```

#### 1.4.2 事件类型枚举

| event | 触发时机 | 必含字段 |
|-------|---------|---------|
| `start` | 脚本启动 | `version`, `repo`, `dry_run` |
| `info` | 过程信息 | `msg` |
| `ok` | 检查通过 | `msg` |
| `warn` | 非致命警告 | `msg` |
| `error` | 致命错误 | `msg` |
| `preflight` | 冲突检测完成 | `state`, `current_version`, `target_version` |
| `download` | 开始下载 | `url` |
| `stage` | 开始 staging | `path` |
| `backup` | 开始备份 | `from`, `to` |
| `swap` | 原子替换 | `target` |
| `rollback` | 回滚触发 | `from`, `to` |
| `done` | 安装完成/跳过 | `state`, 可选 `version`, `target`, `shadow_remaining` |

#### 1.4.3 Preflight state 枚举

| state | 含义 | 是否继续安装 |
|-------|------|------------|
| `not_installed` | 首次安装 | ✅ |
| `same_version` | 版本相同，跳过 | ❌ exit 0 |
| `older_version` | 需要升级 | ✅ |
| `newer_version` | 版本回退，拒绝 | ❌ exit 1（除非 force） |
| `unknown_source` | 未知来源，拒绝 | ❌ exit 1（除非 force） |

---

## 2. 安装后验证输出格式设计

### 2.1 设计目标

- 安装完成后自动执行 `init` 验证，确认 Skill 可被 OpenClaw 正确加载
- 检测 workspace 覆盖（shadow）问题
- 检测 gateway 状态
- 输出同时包含人类可读文本和 JSON 数据

### 2.2 验证步骤

```
安装完成 → 验证流程
               │
        ┌──────┼──────┐
        ▼      ▼      ▼
     文件    init    环境
   完整性  验证    检测
        │      │      │
        └──────┼──────┘
               ▼
        输出摘要 (文本 + JSON)
```

### 2.3 人类可读验证输出

#### 2.3.1 全部通过

```
────────────────────────────────────────

[OK]    Done!

  Version: v0.0.15
  Install: ~/.openclaw/skills/mapick
  Backup:  ~/.openclaw/skills/.mapick.backup-20260501-120000

  Verification:
    ✅ SKILL.md found
    ✅ scripts/shell.js executable
    ✅ Init scan complete — 7 skills detected
    ✅ Node.js v24.15.0

  Get started:
    /mapick                View status overview
    /mapick status         Detailed status
    /mapick clean          Clean up zombies
    /mapick bundle         Browse bundles
    /mapick daily          Daily report

  More info: https://github.com/mapick-ai/mapick
```

#### 2.3.2 Shadow 检测警告

```
────────────────────────────────────────

[OK]    Done!

  Version: v0.0.15
  Install: ~/.openclaw/skills/mapick

  ⚠️  Shadow still active

  You have a workspace copy at:
    ~/.openclaw/workspace/skills/mapick

  OpenClaw loads workspace before managed, so the upgrade you just
  installed is shadowed. To activate it:

    rm -rf ~/.openclaw/workspace/skills/mapick
    openclaw gateway restart
```

#### 2.3.3 Init 验证失败

```
────────────────────────────────────────

[OK]    Installed at ~/.openclaw/skills/mapick

[WARN]  Post-install verification incomplete:
  ✅ SKILL.md found
  ✅ scripts/shell.js executable
  ❌ Init scan failed: cannot determine OpenClaw version

  The Skill files are in place but Mapick may not load correctly.
  Try restarting the gateway:
    openclaw gateway restart

  If the problem persists, check logs at:
    ~/.mapick/logs/install.jsonl
```

### 2.4 JSON 验证输出格式

安装完成后追加验证事件：

```json
{
  "event": "verify",
  "skill_md": "ok",
  "shell_js": "ok",
  "shell_js_executable": "ok",
  "init_result": "ok",
  "init_status": "first_install",
  "skills_count": 7,
  "node_version": "v24.15.0",
  "shadow_detected": false,
  "gateway_recommended": false
}
```

验证字段说明：

| 字段 | 值 | 含义 |
|------|-----|------|
| `skill_md` | `ok` / `missing` | SKILL.md 存在性 |
| `shell_js` | `ok` / `missing` | shell.js 存在性 |
| `shell_js_executable` | `ok` / `not_executable` | 执行权限 |
| `init_result` | `ok` / `fail` / `skipped` | init 执行结果 |
| `init_status` | `first_install` / `rescanned` / `skip` | init 返回状态 |
| `skills_count` | number | 扫描到的 skill 数量 |
| `node_version` | string | 当前 Node.js 版本 |
| `shadow_detected` | boolean | 是否检测到 workspace shadow |
| `gateway_recommended` | boolean | 是否建议重启 gateway |

---

## 3. notify:plan 计划卡片格式设计

### 3.1 设计目标

- `notify:plan` 返回的是结构化 JSON，由 AI 渲染为人类可读的计划卡片
- 用户需要理解：这个 cron 做什么、不做什么、怎么停用
- 必须包含 delivery 验证说明（无 channel 则通知无法送达）

### 3.2 当前 JSON 结构

```json
{
  "intent": "notify_setup:plan",
  "target": "mapick-notify",
  "purpose": "Daily 9am check for version updates + zombie skills",
  "commands": [
    {
      "step": 1,
      "kind": "instruction",
      "instruction": "Run `openclaw cron list --json`...",
      "rationale": "Idempotent: removes any pre-existing mapick cron entries..."
    },
    {
      "step": 2,
      "kind": "command",
      "command": "openclaw cron add --name mapick-notify ...",
      "rationale": "Schedule the daily check"
    }
  ],
  "what_it_does": "Each day at 9am OpenClaw fires...",
  "what_it_doesnt": "No data leaves your machine on registration...",
  "stops": "Run `node scripts/shell.js notify:disable`...",
  "delivery": "IMPORTANT: cron delivery requires a configured channel...",
  "verification": {
    "command": "openclaw cron list --json",
    "success_condition": "Find the mapick-notify job...",
    "failure_message": "Cron was created, but delivery is not reachable yet...",
    "must_not_claim_success_until_delivery_valid": true
  }
}
```

### 3.3 AI 渲染模板（计划卡片）

#### 3.3.1 标准计划卡片

```
📋 每日通知计划

🎯 目的
每天早上 9:00 自动检查版本更新和僵尸 skill，
如有需要会提醒你。不主动收集数据。

⚙️ 安装步骤
1. 清理旧的 mapick 通知配置（幂等操作）
2. 注册新定时任务:
   openclaw cron add --name mapick-notify \
     --cron "0 9 * * *" \
     --session isolated \
     --message "Run /mapick notify"

📦 它做什么
每天 9:00，OpenClaw 触发 /mapick notify，
调用 api.mapick.ai/notify/daily-check 检查：
  • 当前版本是否最新
  • 是否有 30+ 天未使用的僵尸 skill

🔒 它不做什么
注册本身不发送任何数据。cron 仅调度未来的触发器。

🛑 如何停用
运行 /mapick notify disable 即可停止每日通知。
你仍然可以随时手动运行 /mapick notify。

📡 投递渠道
⚠️ 通知需要一个已配置的投递渠道（Telegram / Slack 等）。
如果你使用本地模式而没有渠道，cron 会执行但通知无法送达。
设置后运行 openclaw cron list --json 检查 deliveryPreviews。
```

#### 3.3.2 用户确认后，执行中的渲染

```
✅ 正在设置每日通知...

步骤 1/2: 清理旧配置... ✓
步骤 2/2: 注册定时任务... ✓

✅ 每日通知已设置

每天 9:00 你会收到版本更新或僵尸 skill 提醒。
如需调整：/mapick notify disable
```

#### 3.3.3 执行失败时的渲染

```
❌ 每日通知设置失败

错误信息: <error from cron add>

可能的原因：
  • OpenClaw CLI 版本过旧 — 升级到最新
  • 权限问题 — 检查 openclaw 配置
  • 已存在同名任务 — 先运行 openclaw cron rm 清理

稍后可以重试：/mapick notify
```

#### 3.3.4 投递渠道缺失时的渲染

```
⚠️ 定时任务已创建，但通知无法送达

当前没有配置投递渠道（Telegram / Slack 等）。
cron 会执行，但结果无法发给你。

要启用通知：
  1. 在 OpenClaw 中配置一个投递渠道
  2. 运行 openclaw cron list --json 确认 deliveryPreviews

如果想先停用：/mapick notify disable
```

### 3.4 渲染规则

1. **语言**：必须翻译为用户对话语言（本模板为英文参考）
2. **emoji 使用**：仅在标题行使用一个 emoji，正文不用
3. **命令显示**：长命令可拆分为多行，使用 `\` 续行
4. **不要输出 JSON**：用户只看到渲染后的卡片
5. **don't claim success until delivery valid**：必须检查 `verification.success_condition`

---

## 4. Slug 安装成功/失败提示格式设计

### 4.1 设计背景

用户通过 `/mapick recommend`、`/mapick search` 或 `/mapick bundle install` 获得的 skill 安装命令，
最终执行的是 `clawhub install <slug>` 或 `openclaw skills install <slug>`。
AI 需要将这些命令的执行结果以友好的方式呈现给用户。

### 4.2 安装 JSON 结构

#### 4.2.1 Bundle 安装返回

```json
{
  "intent": "bundle:install",
  "bundleId": "fullstack-dev",
  "installCommands": [
    { "skillId": "github-ops", "command": "clawhub install github-ops" },
    { "skillId": "docker-compose", "command": "clawhub install docker-compose" }
  ],
  "installed": false
}
```

### 4.3 单 Skill 安装 — 人类可读输出

#### 4.3.1 成功

```
✅ <skillName> 已安装

  • Skill: <slug>
  • 路径: ~/.openclaw/skills/<slug>
  • 安全评分: <Grade A/B/C>

运行 /mapick 查看最新状态
```

#### 4.3.2 已经安装

```
ℹ️ <skillName> 已安装

  该 skill 已经存在于你的环境中。
  如需更新：/mapick
```

#### 4.3.3 失败 — 网络错误

```
❌ <skillName> 安装失败

  网络连接超时，无法获取 skill。
  
  检查你的网络连接后重试：
    clawhub install <slug>
  
  或者稍后再试。
```

#### 4.3.4 失败 — CLI 不存在

```
❌ <skillName> 安装失败

  OpenClaw CLI 未安装或不在 PATH 中。
  
  请先安装 OpenClaw: https://openclaw.io
  安装完成后重试。
```

#### 4.3.5 失败 — 权限错误

```
❌ <skillName> 安装失败

  目录权限不足: <directory>
  
  建议：
  • 检查 ~/.openclaw/skills/ 目录权限
  • 不要使用 sudo（可能导致权限混乱）
  
  如需帮助：/mapick
```

#### 4.3.6 失败 — 未知错误

```
❌ <skillName> 安装失败

  <stderr 前 200 字符>
  
  重试：clawhub install <slug>
  或运行 /mapick 寻求帮助
```

### 4.4 Bundle 安装 — 汇总输出

```
📦 Bundle: <bundleName>

  ✅ <skill1>    已安装
  ✅ <skill2>    已安装
  ⚠️ <skill3>   失败 — 网络连接超时
  ❌ <skill4>   失败 — CLI not found

安装完成: 2/4 成功

重试失败的 skill：
  clawhub install <skill3>
  clawhub install <skill4>

或运行 /mapick 查看更多
```

### 4.5 单 Skill 安装 — JSON 输出格式

安装脚本或 CLI 执行后，生成以下结构的 JSON 供 AI 渲染：

```json
{
  "intent": "slug:install_result",
  "skillId": "<slug>",
  "status": "success" | "already_installed" | "failed",
  "installPath": "~/.openclaw/skills/<slug>",
  "safetyGrade": "A" | "B" | "C" | null,
  "error": null | {
    "code": "network_timeout" | "cli_missing" | "permission_denied" | "unknown",
    "message": "<user-friendly error>",
    "rawStderr": "<raw output, truncated to 200 chars>"
  },
  "nextSteps": ["<suggested action 1>", "<suggested action 2>"]
}
```

### 4.6 Bundle 安装 — JSON 输出格式

```json
{
  "intent": "bundle:install_result",
  "bundleId": "<bundleId>",
  "bundleName": "<displayName>",
  "results": [
    {
      "skillId": "<slug>",
      "skillName": "<displayName>",
      "status": "success" | "already_installed" | "failed",
      "error": null | { "code": "...", "message": "..." }
    }
  ],
  "summary": {
    "total": 4,
    "success": 2,
    "alreadyInstalled": 1,
    "failed": 1
  },
  "allTracked": true,
  "nextSteps": ["<suggested action>"]
}
```

---

## 5. 设计规范

### 5.1 Emoji 使用规范

| 场景 | Emoji | 位置 | 用途 |
|------|-------|------|------|
| 成功 | ✅ | 行首 | 操作成功、验证通过 |
| 失败 | ❌ | 行首 | 操作失败、验证未通过 |
| 警告 | ⚠️ | 行首 | 需要用户注意 |
| 信息 | ℹ️ | 行首 | 状态信息 |
| 卡片标题 | 📋 | 标题行 | notify:plan 标题 |
| 概览 | 📊 | 标题行 | summary 卡片 |
| 安全 A | 🟢 | 内联 | 安全评分 A 级 |
| 安全 B | 🟡 | 内联 | 安全评分 B 级 |
| 安全 C | 🔴 | 内联 | 安全评分 C 级 |
| 隐私 | 🔒 | 标题行 | 隐私相关 |
| 通知 | 🔔 | 标题行 | 通知/提醒 |
| 僵尸 | 💤 | 列表项 | 僵尸 skill |
| 从未使用 | ⚠️ | 列表项 | 从未使用的 skill |
| 已安装 | ✅ | 列表项 | 已安装成功 |
| 推荐 | 🎯 | 标题行 | 推荐技能 |

#### 使用规则

1. **标题行**：最多一个 emoji，放在行首
2. **列表项**：最多一个 emoji，作为项目符号
3. **正文**：不使用 emoji（推荐渲染中安全徽章除外）
4. **JSON 模式**：不输出 emoji（纯文本/机器可读）
5. **一致性**：相同含义使用相同 emoji，不要混用 ✅ 和 🎉 表示成功

### 5.2 终端颜色代码规范

install.sh 使用的 ANSI 颜色代码：

| 元素 | 颜色代码 | 效果 |
|------|---------|------|
| `[INFO]` | `\033[0;34m` (BLUE) | 蓝色标签 |
| `[OK]` | `\033[0;32m` (GREEN) | 绿色标签 |
| `[WARN]` | `\033[1;33m` (YELLOW) | 黄色标签 |
| `[ERROR]` | `\033[0;31m` (RED) | 红色标签 |
| Banner | `\033[0;36m` (CYAN) | 青色横幅 |
| 分隔线 | `\033[2m` (DIM) | 暗色分割线 |
| 路径/目录 | `\033[1;33m` (YELLOW+BOLD) | 高亮路径 |
| 标签文字 | `\033[0;32m` (GREEN) | 成功标签文字 |
| 提示标签 | `\033[0;34m` (BLUE) | 提示文字标签 |
| 结束 | `\033[0m` (NC) | 重置颜色 |

#### 颜色使用规则

1. **状态标签**必须使用固定颜色（INFO=蓝, OK=绿, WARN=黄, ERROR=红）
2. **路径/文件**使用黄色高亮
3. **分隔线**使用 dim 灰色
4. **Banner** 使用 cyan
5. **JSON_MODE=1 时**，所有 ANSI 颜色代码必须关闭
6. **AI 渲染时**不使用 ANSI 颜色代码（Markdown 替代）

### 5.3 JSON Schema 汇总

#### 5.3.1 install.sh JSON 事件 Schema

```typescript
// 基础事件
interface BaseEvent {
  event: string;  // start | info | ok | warn | error | preflight | download | stage | backup | swap | rollback | done | verify
}

// 所有值均为 string（bash json_event 的限制）
interface StartEvent extends BaseEvent {
  event: "start";
  version: string;
  repo: string;
  dry_run: "0" | "1";
}

interface PreflightEvent extends BaseEvent {
  event: "preflight";
  state: "not_installed" | "same_version" | "older_version" | "newer_version" | "unknown_source";
  current_version: string;
  target_version: string;
}

interface DoneEvent extends BaseEvent {
  event: "done";
  state: string;  // 与 preflight.state 相同
  version?: string;
  target?: string;
  shadow_remaining?: "0" | "1";
}

interface VerifyEvent extends BaseEvent {
  event: "verify";
  skill_md: "ok" | "missing";
  shell_js: "ok" | "missing";
  shell_js_executable: "ok" | "not_executable";
  init_result: "ok" | "fail" | "skipped";
  init_status?: "first_install" | "rescanned" | "skip";
  skills_count?: number;
  node_version: string;
  shadow_detected: boolean;
  gateway_recommended: boolean;
}

// 通用 msg 事件
interface MsgEvent extends BaseEvent {
  event: "info" | "ok" | "warn" | "error";
  msg: string;
}

// 路径事件
interface PathEvent extends BaseEvent {
  event: "download" | "stage" | "swap";
  url?: string;
  path?: string;
  target?: string;
}

// 备份事件
interface BackupEvent extends BaseEvent {
  event: "backup" | "rollback";
  from?: string;
  to?: string;
}
```

#### 5.3.2 notify:plan JSON Schema

```typescript
interface NotifyPlan {
  intent: "notify_setup:plan";
  target: "mapick-notify";
  purpose: string;
  commands: Array<{
    step: number;
    kind: "instruction" | "command";
    instruction?: string;     // kind=instruction 时
    command?: string;          // kind=command 时
    rationale: string;
    optional?: boolean;
  }>;
  what_it_does: string;
  what_it_doesnt: string;
  stops: string;
  delivery: string;
  after_success_track: string;
  after_failure_rollback: string | null;
  verification: {
    command: string;
    success_condition: string;
    failure_message: string;
    must_not_claim_success_until_delivery_valid: boolean;
  };
}

interface NotifyDisablePlan {
  intent: "notify_disable:plan";
  target: "mapick-notify";
  commands: Array<{
    step: number;
    kind: "instruction";
    instruction: string;
    rationale: string;
  }>;
  what_it_does: string;
  what_it_doesnt: string;
  stops: string;
  after_success_track: string;
  after_failure_rollback: null;
}
```

#### 5.3.3 notify (daily check) JSON Schema

```typescript
interface NotifyResult {
  intent: "notify";
  alerts: NotifyAlert[];
  checkedAt: string;
}

interface NotifyAlert {
  type: "version" | "zombies";
  // version 类型
  current?: string;
  latest?: string;
  upgradeCmd?: string;
  // zombies 类型
  count?: number;
  top?: Array<{
    id: string;
    name: string;
    daysIdle: number;
    // ...其他 zombie 字段
  }>;
}
```

#### 5.3.4 slug install result JSON Schema

```typescript
interface SlugInstallError {
  code: "network_timeout" | "cli_missing" | "permission_denied" | "unknown";
  message: string;
  rawStderr?: string;
}

interface SlugInstallResult {
  intent: "slug:install_result";
  skillId: string;
  status: "success" | "already_installed" | "failed";
  installPath?: string;
  safetyGrade?: "A" | "B" | "C" | null;
  error?: SlugInstallError | null;
  nextSteps?: string[];
}

interface BundleInstallResult {
  intent: "bundle:install_result";
  bundleId: string;
  bundleName: string;
  results: Array<{
    skillId: string;
    skillName: string;
    status: "success" | "already_installed" | "failed";
    error?: SlugInstallError | null;
  }>;
  summary: {
    total: number;
    success: number;
    alreadyInstalled: number;
    failed: number;
  };
  allTracked: boolean;
  nextSteps?: string[];
}
```

### 5.4 AI 渲染规范

#### 5.4.1 基本原则

1. **Never dump raw JSON** — 用户只看到渲染后的文本
2. **Translate to user's language** — 所有模板必须翻译
3. **No JSON echo** — 不要在渲染中包含 JSON 片段
4. **No cron announcements** — notify 不 announce "cron ran"
5. **Silence when empty** — notify alerts 为空时，什么都不输出

#### 5.4.2 Markdown 使用规范

| 元素 | Markdown 语法 | 用途 |
|------|-------------|------|
| 标题 | `**粗体**` | 段落标题 |
| 命令 | `` `code` `` | 行内命令 |
| 代码块 | `` ```bash ... ``` `` | 多行命令 |
| 引用 | `> 引用` | 重要提示 |
| 列表 | `- 项目` | 列表项 |
| 路径 | `` `路径` `` | 文件路径 |

#### 5.4.3 禁止的渲染形式

1. **禁止** 向用户展示原始 JSON
2. **禁止** 向用户展示 ANSI 颜色代码
3. **禁止** 输出 "your daily check found:" 类前缀
4. **禁止** 在 notify 输出中包含时间戳或 run-id
5. **禁止** 在 alert 为空时输出 "all clear" 或 "nothing to report"

---

## 6. 文件变更对照表

| 文件 | 变更内容 | 关联模块 |
|------|---------|---------|
| `install.sh` | 增加 post-install verify 步骤；统一 JSON 事件格式 | §1, §2 |
| `scripts/lib/updates.js` | `handleNotifyPlan` 输出已包含 delivery + verification 字段 | §3 |
| `scripts/lib/misc.js` | bundle install 结果封装为 JSON schema | §4 |
| `scripts/lib/recommend.js` | 单 skill 安装结果封装为 JSON schema | §4 |
| `SKILL.md` | 新增 §notify:plan 渲染规则、§slug install 渲染规则 | §3, §4 |
| `reference/rendering.md` | 新增 notify:plan 渲染模板、slug install 渲染模板 | §3, §4 |
| `scripts/lib/skills.js` | `registerNotifyCron` 启用（移除 scan-safe 禁用） | 升级计划 §1.1 |

---

## 附录 A：完整安装流程输出示例

### A.1 人类可读模式 — 首次安装

```
  ╔══════════════════════════════════════════╗
  ║                                          ║
  ║              M A P I C K                 ║
  ║       Mapick Intelligent Butler          ║
  ║                                          ║
  ╚══════════════════════════════════════════╝

[INFO]  Fetching latest version...
[OK]    Version: v0.0.15
[OK]    OpenClaw detected: /usr/local/bin/openclaw
[OK]    Node.js detected: v24.15.0
[INFO]  Fresh install (target dir does not exist).

────────────────────────────────────────

[INFO]  Downloading Mapick Skill (v0.0.15)...
[OK]    Download complete
[INFO]  Staging install to /Users/evan/.openclaw/skills/.mapick.tmp-12345
[OK]    Staged
[INFO]  Atomic swap → /Users/evan/.openclaw/skills/mapick
[OK]    Installed at /Users/evan/.openclaw/skills/mapick

────────────────────────────────────────

[OK]    Done!

  Version: v0.0.15
  Install: ~/.openclaw/skills/mapick

  Verification:
    ✅ SKILL.md found
    ✅ scripts/shell.js executable
    ✅ Init scan complete — 7 skills detected
    ✅ Node.js v24.15.0

  Get started:
    /mapick                View status overview
    /mapick status         Detailed status
    /mapick clean          Clean up zombies
    /mapick bundle         Browse bundles
    /mapick daily          Daily report

  More info: https://github.com/mapick-ai/mapick
```

### A.2 JSON 模式 — 升级安装

```
{"event":"start","version":"latest","repo":"mapick-ai/mapick","dry_run":"0"}
{"event":"info","msg":"Fetching latest version..."}
{"event":"info","msg":"Version: v0.0.15"}
{"event":"ok","msg":"OpenClaw detected: /usr/local/bin/openclaw"}
{"event":"ok","msg":"Node.js detected: v24.15.0"}
{"event":"preflight","state":"older_version","current_version":"v0.0.14","target_version":"v0.0.15"}
{"event":"info","msg":"Upgrade v0.0.14 → v0.0.15"}
{"event":"download","url":"https://github.com/mapick-ai/mapick/archive/v0.0.15.tar.gz"}
{"event":"ok","msg":"Download complete"}
{"event":"stage","path":"/Users/evan/.openclaw/skills/.mapick.tmp-12345"}
{"event":"ok","msg":"Staged"}
{"event":"backup","from":"/Users/evan/.openclaw/skills/mapick","to":"/Users/evan/.openclaw/skills/.mapick.backup-20260501-120000"}
{"event":"swap","target":"/Users/evan/.openclaw/skills/mapick"}
{"event":"ok","msg":"Installed at /Users/evan/.openclaw/skills/mapick"}
{"event":"verify","skill_md":"ok","shell_js":"ok","shell_js_executable":"ok","init_result":"ok","init_status":"rescanned","skills_count":7,"node_version":"v24.15.0","shadow_detected":false,"gateway_recommended":false}
{"event":"done","state":"older_version","version":"v0.0.15","target":"/Users/evan/.openclaw/skills/mapick","shadow_remaining":"0"}
```
