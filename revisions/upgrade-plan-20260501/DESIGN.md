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

---

# Phase 2 — 个性化与智能化 CLI 体验设计文档

**版本**: v2.0  
**日期**: 2026-05-01  
**范围**: `profile set/get`（proactive_mode）、`stats token`（token 透明化）、`recommend --contextual`（上下文推荐）  
**设计原则**: 纯文本 CLI 环境，输出通过 JSON 传递给 AI 渲染；所有 JSON 结构遵循 Phase 1 已建立的 `intent` 模式

---

## 1. Proactive Mode 偏好设置

### 1.1 设计目标

为用户提供一个简单、可发现的"主动性开关"。通过 `profile set proactive_mode=` 命令或自然语言指令，用户可以在三个档位之间切换：

- **`off`**：完全手动，不主动推荐
- **`silent`**：应召推荐，仅在主动提问时提供建议
- **`helpful`**：主动管家（默认），每日 radar + 实时推荐

### 1.2 用户发现路径

```
新用户首次安装
    │
    ▼
init 自动写入 proactive_mode: "helpful"（默认）
    │
    ├─ 用户通过 AI 对话自然切换（"别推了"/"主动帮我找"）
    │
    └─ 用户主动使用 profile 命令：
         /mapick profile get        → 查看当前模式
         /mapick profile set ...    → 切换模式
```

#### 1.2.1 自然语言发现

用户无需记住 CLI 命令。SKILL.md 中定义映射规则，AI 自动将自然语言翻译为 `profile set` 命令：

| 用户自然语言 | 映射模式 | Shell 命令 |
|-------------|:--------:|-----------|
| "以后别推东西给我了" / "stop suggesting" | `off` | `profile set proactive_mode=off` |
| "我问你的时候再推荐" / "only when I ask" | `silent` | `profile set proactive_mode=silent` |
| "你主动帮我找" / "be a good butler" | `helpful` | `profile set proactive_mode=helpful` |
| "你现在什么模式？" / "what mode?" | `profile get` | `profile get` → 渲染当前模式 |

#### 1.2.2 命令发现

用户在 `/mapick help` 或 `/mapick status` 中看到 profile 相关入口：

```
  Settings:
    /mapick profile get                View current mode
    /mapick profile set proactive_mode=helpful  Change mode
```

### 1.3 `profile set` — JSON 输出格式

#### 1.3.1 成功切换

```json
{
  "intent": "profile:set",
  "key": "proactive_mode",
  "value": "helpful",
  "previous_value": "off",
  "effect": "Mapick 会主动为你扫描技能缺口，每日一次。关闭请手动或『设置主动模式为静音』",
  "effect_en": "Mapick will proactively scan for skill gaps once daily. Switch to silent or off to stop proactive recommendations."
}
```

#### 1.3.2 无效值拒绝

```json
{
  "intent": "profile:set:error",
  "key": "proactive_mode",
  "attempted_value": "super",
  "error": "Invalid proactive_mode. Must be one of: off, silent, helpful",
  "valid_values": ["off", "silent", "helpful"]
}
```

#### 1.3.3 无变化

```json
{
  "intent": "profile:set",
  "key": "proactive_mode",
  "value": "helpful",
  "previous_value": "helpful",
  "unchanged": true,
  "effect": "已经是 helpful 模式，无需调整。"
}
```

### 1.4 `profile get` — JSON 输出格式

```json
{
  "intent": "profile:get",
  "proactive_mode": "helpful",
  "profile": {
    "user_profile_tags": ["rust", "typescript"],
    "network_consent": "always",
    "last_notify_at": "2026-04-30T09:00:00Z"
  },
  "defaults_applied": {
    "proactive_mode": false
  }
}
```

**字段说明**：

| 字段 | 类型 | 含义 |
|------|:----:|------|
| `intent` | string | 固定为 `profile:get` |
| `proactive_mode` | string | 当前模式值（`off` / `silent` / `helpful`） |
| `profile.user_profile_tags` | string[] | 用户声明的技术栈标签 |
| `profile.network_consent` | string | 网络同意状态 |
| `profile.last_notify_at` | string? | 最后一次通知时间（ISO 8601） |
| `defaults_applied.proactive_mode` | boolean | 是否使用了默认值（用户从未设置过） |

### 1.5 AI 渲染规范

#### 1.5.1 `profile set` 确认渲染

切换模式时，AI 不输出技术命令回显，而是给出**体验描述**：

**切换到 `off`**：

```
🔇 已调整。我不会再主动推荐技能了。
你随时说「推荐几个」我会响应。
```

**切换到 `silent`**：

```
🔔 了解。你主动问我（搜索/推荐）时我会提供建议，
但不会主动打扰你。
```

**切换到 `helpful`**：

```
🔔 收到。我会主动扫描你的技能缺口，每天至少一次。
如果有新发现会告诉你。
```

**值未变**：

```
ℹ️ 已经是 helpful 模式，没有变化。

各模式说明：
  off     — 完全手动，不主动推荐
  silent  — 仅在你主动搜索/提问时提供建议
  helpful — 每日 radar + 实时推荐（当前）
```

#### 1.5.2 `profile set` 错误渲染

```
❌ 无效的模式值: super

合法值:
  off     — 完全手动，不主动推荐
  silent  — 仅在你主动搜索/提问时提供建议
  helpful — 每日 radar + 实时推荐（默认）
```

#### 1.5.3 `profile get` 渲染

```
📋 当前配置

  主动模式:   helpful（默认开启主动管家）
  技术栈标签: rust, typescript
  网络同意:   always（始终授权）
  最后通知:   2026-04-30 09:00

提示:
  想调整推荐频率？说「别推了」或「主动帮我找」即可切换。
```

### 1.6 Proactive Mode 行为矩阵

此矩阵写入 SKILL.md §14，作为 AI 渲染和行为的硬性约束：

| 场景 | `off` | `silent` | `helpful` |
|------|-------|----------|-----------|
| 用户说"装点什么" | 仅响应，不追加推荐 | 响应 + 1 条相关推荐 | 响应 + 2 条相关推荐 + 套装建议 |
| 用户执行 `/mapick search` | 仅返回搜索结果 | 搜索结果 + "如需个性化推荐可以 `/mapick recommend`" | 搜索结果 + 自动追加 1-2 条 context-aware 推荐 |
| 用户执行 `/mapick status` | 仅显示状态 | 状态 + "有 1 个匹配你 profile 的新 skill" | 状态 + 完整 radar 结果（如当天未触发） |
| Daily radar 触发 | 静默，不执行 | 静默，不执行 | 执行，发现 gap 后主动渲染 |
| Consent 后 | 不提示 cron | 含蓄提示 | 主动询问是否配置 cron |
| 用户 idle 7 天+ | 不提示 | 不提示 | 下次会话主动建议 `/mapick radar` 检查更新 |
| `/mapick recommend` | 正常响应 | 正常响应 | 正常响应（调用 contextual） |
| `/mapick recommend --contextual` | 正常响应 | 正常响应 | 正常响应 |

#### 约束规则

1. **off 模式绝对不主动**：AI 不得在 search / status / 任何非显式推荐场景中出现"推荐"、"试试"、"你可能需要"等推荐性措辞
2. **silent 模式限流**：AI 仅在用户主动触发推荐上下文时，追加 **最多 1 条** 推荐，且必须附带引导语句（"如需更多个性化推荐可以 `/mapick recommend`"）
3. **helpful 模式不刷屏**：每次用户请求最多输出 **2 条** 推荐，避免信息过载
4. **显式推荐命令不受模式限制**：用户主动说 `/mapick recommend` 或 `/mapick search` 时，所有模式都正常响应

### 1.7 JSON Schema

```typescript
interface ProfileSetSuccess {
  intent: "profile:set";
  key: "proactive_mode";
  value: "off" | "silent" | "helpful";
  previous_value: "off" | "silent" | "helpful" | null;
  unchanged?: boolean;
  effect: string;
  effect_en?: string;
}

interface ProfileSetError {
  intent: "profile:set:error";
  key: "proactive_mode";
  attempted_value: string;
  error: string;
  valid_values: ["off", "silent", "helpful"];
}

interface ProfileGet {
  intent: "profile:get";
  proactive_mode: "off" | "silent" | "helpful";
  profile: {
    user_profile_tags?: string[];
    network_consent?: string;
    last_notify_at?: string;
  };
  defaults_applied: {
    proactive_mode: boolean;
  };
}
```

---

## 2. Token 透明化

### 2.1 设计目标

让用户清晰看到每个 skill 的 AI token 消耗，理解"钱花在哪儿了"，从而做出更明智的保留/清理决策。

**核心原则**：只呈现数据，不做限制。不设 budget cap，不禁用 skill。

### 2.2 用户流程

```
用户输入 /mapick stats token
    │
    ▼
shell.js 路由到 handleStats("token", "today")
    │
    ▼
增量解析 ~/.openclaw/sessions/*.jsonl
    │
    ├─ 有 session 日志 → 归因 + 聚合 → 返回 JSON
    │
    └─ 无 session 日志 → 返回空报告（不报错）
    │
    ▼
AI 渲染为人类可读报告卡片
```

#### 2.2.1 增量解析机制

```
首次运行 stats token today
    │
    ├─ 扫描 ~/.openclaw/sessions/*.jsonl
    ├─ 提取 usage 字段 → 归因到 skill
    ├─ 写入 ~/.mapick/logs/token-usage.jsonl
    └─ 记录 last_token_parsed_ts
    │
后续运行 stats token today
    │
    ├─ 读取 last_token_parsed_ts
    ├─ 仅解析该时间戳之后的新增日志
    └─ 增量追加到 token-usage.jsonl
```

### 2.3 Token 归因逻辑

归因优先级（从高到低）：

```
1. 精确归因
   条件：JSONL 记录包含 tool_call.skill 字段
   → 将本条 token 归因到该 skill
   │
2. 上下文归因
   条件：JSONL 记录的 message 或 content 中包含 skill 名称
   → 归因到该 skill（标记为 inferred）
   │
3. 系统归因
   条件：无法归因到具体 skill
   → 标记为 _system
   │
4. 缓存归因
   条件：记录包含 cache_read_input_tokens
   → 按 cache_creation_input_tokens 归因（如模型支持）
```

### 2.4 `stats token today` — JSON 输出格式

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
    "currency": "USD",
    "model_pricing_used": "claude-sonnet-4-20250514"
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
      "status": "active",
      "last_seen": "2026-05-01T14:20:00Z"
    },
    {
      "skill": "_system",
      "input": 21000,
      "output": 15000,
      "cache": 0,
      "total": 36000,
      "cost_estimate": 0.18,
      "pct_of_total": 21.2,
      "calls": 25
    },
    {
      "skill": "summarize",
      "input": 8900,
      "output": 5600,
      "cache": 4200,
      "total": 18700,
      "cost_estimate": 0.12,
      "pct_of_total": 11.0,
      "calls": 3,
      "status": "active",
      "last_seen": "2026-05-01T10:15:00Z"
    }
  ],
  "daily_average": {
    "total_tokens": 195000,
    "cost_estimate": 0.72,
    "days_tracked": 5
  },
  "today_vs_average": {
    "ratio": 1.18,
    "label": "normal"
  },
  "source": {
    "sessions_scanned": 3,
    "records_parsed": 47,
    "last_parsed_ts": "2026-05-01T16:30:00Z"
  }
}
```

### 2.5 `stats token week` — JSON 输出格式

```json
{
  "intent": "stats:token",
  "period": "week",
  "from": "2026-04-27T00:00:00Z",
  "to": "2026-05-01T23:59:59Z",
  "total": {
    "input": 875000,
    "output": 476000,
    "cache": 84000,
    "all": 1435000,
    "cost_estimate": 5.92,
    "currency": "USD",
    "model_pricing_used": "claude-sonnet-4-20250514"
  },
  "by_day": [
    {
      "date": "2026-04-27",
      "total": 210000,
      "cost_estimate": 0.86,
      "calls": 28
    },
    {
      "date": "2026-04-28",
      "total": 195000,
      "cost_estimate": 0.78,
      "calls": 22
    },
    {
      "date": "2026-04-29",
      "total": 320000,
      "cost_estimate": 1.32,
      "calls": 35,
      "is_peak": true
    },
    {
      "date": "2026-04-30",
      "total": 185000,
      "cost_estimate": 0.74,
      "calls": 19
    },
    {
      "date": "2026-05-01",
      "total": 205000,
      "cost_estimate": 0.85,
      "calls": 24
    }
  ],
  "by_skill": [
    {
      "skill": "github-ops",
      "total": 364000,
      "cost_estimate": 1.68,
      "pct_of_total": 31.2,
      "calls": 48,
      "status": "active"
    },
    {
      "skill": "capability-evolver",
      "total": 143500,
      "cost_estimate": 0.66,
      "pct_of_total": 12.3,
      "calls": 8,
      "status": "never_used"
    }
  ],
  "trend": {
    "direction": "stable",
    "day_over_day_change_pct": 5.2,
    "peak_day": "2026-04-29",
    "peak_tokens": 320000
  },
  "source": {
    "sessions_scanned": 12,
    "records_parsed": 203
  }
}
```

### 2.6 Skill status 枚举

| 值 | 含义 | 触发条件 |
|:---|------|---------|
| `active` | 正常使用中 | 最近 7 天有精确归因调用 |
| `never_used` | 从未被直接调用但占据 context | 所有归因都是上下文归因或系统归因 |
| `idle_14d` | 14 天未使用 | 最后精确归因 > 14 天 |
| `idle_30d` | 30 天未使用 | 最后精确归因 > 30 天 |
| `zombie` | 僵尸 skill | CONFIG.md 标记或后端 zombie 列表 |

### 2.7 模型定价估算表

内置默认定价（硬编码，不依赖后端）：

| 模型 | input（$/M tokens） | output（$/M tokens） | cache write | cache read |
|------|-------------------:|--------------------:|------------:|-----------:|
| Claude Sonnet 4 | $3.00 | $15.00 | $3.75 | $0.30 |
| Claude Haiku | $0.80 | $4.00 | $1.00 | $0.08 |
| Claude Opus | $15.00 | $75.00 | $18.75 | $1.50 |

**选择逻辑**：
1. 优先从 JSONL 记录的 `model` 字段匹配定价表
2. 无法匹配时使用 Sonnet 4 默认定价，并在 `model_pricing_used` 中标注
3. 后续 Phase 可支持用户自定义定价表（`~/.mapick/model-pricing.json`）

**估算精度声明**：AI 渲染时必须包含 "费用为预估值，实际以 Claude 官方计费为准" 的免责声明。

### 2.8 AI 渲染规范

#### 2.8.1 今日报告渲染

```
💰 Token 消耗 — 今日（2026-05-01）

总计：205K tokens · 预估 $0.85

按 Skill 拆分（按费用降序）：
  github-ops        83K  · $0.38   ████████████░░░░  44.7%  活跃
  _system           36K  · $0.18   █████░░░░░░░░░░░  21.2%  系统
  summarize         19K  · $0.12   ███░░░░░░░░░░░░░  11.0%  活跃
  docker-manage     18K  · $0.08   ██░░░░░░░░░░░░░░  10.4%  活跃
  csv-converter     12K  · $0.06   █░░░░░░░░░░░░░░░   7.1%  闲置 14d

今日 vs 日均：205K / 195K（正常 ✅）

📌 洞察: capability-evolver 从未被直接调用但占了你 15% 的 context 消耗。
   考虑移除或清理。

费用为预估值，实际以 Claude 官方计费为准。
```

#### 2.8.2 本周报告渲染

```
📊 Token 消耗 — 本周（04-27 ~ 05-01）

总计：1.44M tokens · 预估 $5.92

每日趋势：
  Mon 04-27  ████████████░░░░  210K  · $0.86
  Tue 04-28  ██████████░░░░░░  195K  · $0.78
  Wed 04-29  ████████████████░░  320K  · $1.32  ← 峰值
  Thu 04-30  ██████████░░░░░░  185K  · $0.74
  Fri 05-01  ████████████░░░░  205K  · $0.85

趋势：平稳（日均 195K，今日 +6%）

费用占比 Top 5：
  github-ops         364K  · $1.68   ██████████████░░  31.2%
  _system            287K  · $1.32   ████████████░░░░  24.6%
  capability-evolver 144K  · $0.66   ██████░░░░░░░░░░  12.3%  ⚠️ 从未使用
  summarize           98K  · $0.45   ████░░░░░░░░░░░░   8.4%
  docker-manage       72K  · $0.33   ███░░░░░░░░░░░░░   6.5%

📌 洞察: capability-evolver 本周 8 次调用全是间接归因，
   从未被直接触发。它占了你 12% 的 token 消耗，
   可能是因为它一直在 context 中但没人用到。

费用为预估值，实际以 Claude 官方计费为准。
```

#### 2.8.3 异常消耗渲染

当日消耗超过日均 3 倍时：

```
⚠️ 今日 token 消耗异常偏高

总计：780K tokens · 预估 $3.58
日均：195K → 今日是日均的 4.0 倍 🔴

可能的原因：
  • 某个 skill 进入循环调用
  • 处理了特别大的文件/数据
  • 新的 skill 刚安装，初始化消耗较大

检查 top 消耗 skill：
  suspicious-skill   420K  · $1.93   ████████████████  53.8%
  github-ops         180K  · $0.83   ███████░░░░░░░░░  23.1%

建议: 运行 /mapick clean 检查是否有僵尸 skill 在消耗资源。

费用为预估值，实际以 Claude 官方计费为准。
```

#### 2.8.4 无数据渲染

```
ℹ️ 暂无 token 消耗数据

Mapick 正在追踪你的 AI 使用量。首次数据将在你
与 OpenClaw 进行下一次对话后出现。

当前状态: 已扫描 0 个 session 文件
日志路径: ~/.mapick/logs/token-usage.jsonl
```

#### 2.8.5 渲染禁止事项

1. **禁止** 向用户展示原始 JSON
2. **禁止** 输出 "today you saved $X by cleaning zombies"（不做节省估算）
3. **禁止** 在 report 中主动建议删除 skill（仅在洞察中提到事实）
4. **禁止** 输出 token 归因的技术细节（如归因优先级、JSONL 格式）
5. **禁止** 超过 top 5 skill（保持报告简洁）
6. **必须** 包含 "费用为预估值" 免责声明

### 2.9 JSON Schema

```typescript
interface StatsTokenToday {
  intent: "stats:token";
  period: "today" | "week";
  from: string;  // ISO 8601
  to: string;    // ISO 8601
  total: {
    input: number;
    output: number;
    cache: number;
    all: number;
    cost_estimate: number;
    currency: "USD";
    model_pricing_used: string;
  };
  by_skill: Array<{
    skill: string;           // "_system" 表示无法归因
    input: number;
    output: number;
    cache: number;
    total: number;
    cost_estimate: number;
    pct_of_total: number;    // 0-100
    calls: number;
    status?: "active" | "never_used" | "idle_14d" | "idle_30d" | "zombie";
    last_seen?: string;      // ISO 8601
  }>;
  daily_average?: {
    total_tokens: number;
    cost_estimate: number;
    days_tracked: number;
  };
  today_vs_average?: {
    ratio: number;           // today / average
    label: "normal" | "elevated" | "high" | "critical";
  };
  by_day?: Array<{           // period="week" 时存在
    date: string;            // YYYY-MM-DD
    total: number;
    cost_estimate: number;
    calls: number;
    is_peak?: boolean;
  }>;
  trend?: {                  // period="week" 时存在
    direction: "stable" | "increasing" | "decreasing";
    day_over_day_change_pct: number;
    peak_day: string;
    peak_tokens: number;
  };
  source: {
    sessions_scanned: number;
    records_parsed: number;
    last_parsed_ts?: string;
  };
}
```

---

## 3. 上下文推荐（Contextual Recommendations）

### 3.1 设计目标

让用户获得**与自身相关的推荐**，而非全站 trending。通过 profile 标签 + 已安装 skill 列表，后端返回精准匹配用户技术栈和工作流的 skill。

### 3.2 与默认推荐的区别

| 维度 | 默认推荐（`/mapick recommend`） | 上下文推荐（`/mapick recommend --contextual`） |
|------|------|------|
| 端点 | `GET /recommendations/feed` | `GET /recommendations/contextual` |
| 输入 | 无（或关键词搜索） | `tags` + `installed` + `context` |
| 输出 | 全局 trending skill | 个性化匹配 skill |
| 渲染 | 列表 + 安全评分 | 列表 + 推荐理由（💡 "为什么推荐"） |
| 适合场景 | "随便看看有什么好的" | "帮我找一个适合我的 X" |

### 3.3 用户流程

```
默认推荐路径:
  用户: /mapick recommend
    → AI 调用 handleRecommend()
    → GET /recommendations/feed
    → AI 渲染: 全局热门 skill 列表

上下文推荐路径:
  用户: /mapick recommend --contextual
    → AI 调用 handleRecommend("--contextual")
    → 读取 CONFIG.md.user_profile_tags
    → 扫描已安装 skill 列表
    → GET /recommendations/contextual?tags=...&installed=...
    → AI 渲染: 个性化推荐 + 推荐理由

Radar 自动切换:
  proactive_mode=helpful → radar 自动使用 contextual 端点
  proactive_mode=silent  → radar 使用 feed 端点（全局 trending）
  proactive_mode=off     → radar 静默不执行
```

### 3.4 `recommend --contextual` — JSON 输出格式

#### 3.4.1 请求参数组装

```javascript
// 从本地数据组装请求参数
const params = {
  tags: config.user_profile_tags?.join(",") || "",         // "rust,typescript"
  installed: installedSkills.map(s => s.slug).join(","),   // "github-ops,code-review"
  limit: 5,
  context: undefined  // 可选：最近搜索的 query
};
```

#### 3.4.2 成功响应

```json
{
  "intent": "recommend",
  "mode": "contextual",
  "recommendations": [
    {
      "skillId": "cargo-audit",
      "slug": "rustsec/cargo-audit/cargo-audit",
      "name": "cargo-audit",
      "grade": "A",
      "description": "Audit Rust dependencies for security vulnerabilities",
      "reason": "Matches your Rust tag and adds security auditing you don't have",
      "reason_zh": "匹配你的 Rust 标签，补全安全审计能力",
      "complementaryTo": ["github-ops"],
      "category": "security-qa",
      "installCount": 12500,
      "installCommand": "openclaw skills install cargo-audit"
    },
    {
      "skillId": "eslint-ai",
      "slug": "eslint-ai",
      "name": "eslint-ai",
      "grade": "A",
      "description": "AI-enhanced ESLint rules — auto-generate project-level .eslintrc",
      "reason": "Matches your TypeScript stack, replaces manual ESLint config",
      "reason_zh": "匹配你的 TypeScript 技术栈，替代手动配置 ESLint",
      "complementaryTo": [],
      "category": "dev-tools",
      "installCount": 8900,
      "installCommand": "openclaw skills install eslint-ai"
    }
  ],
  "context": {
    "tags_matched": ["rust"],
    "gaps_identified": ["security-audit"],
    "total_available": 8
  },
  "fallback": false
}
```

#### 3.4.3 降级（feed fallback）

```json
{
  "intent": "recommend",
  "mode": "contextual",
  "recommendations": [
    // ... feed 数据 ...
  ],
  "fallback": true,
  "fallback_reason": "contextual endpoint returned 500, falling back to feed",
  "fallback_reason_zh": "个性化推荐服务暂时不可用，显示热门技能",
  "context": null
}
```

#### 3.4.4 空结果

```json
{
  "intent": "recommend",
  "mode": "contextual",
  "recommendations": [],
  "context": {
    "tags_matched": ["rust"],
    "gaps_identified": [],
    "total_available": 0
  },
  "fallback": false,
  "message": "目前没有基于你的 profile 找到新的匹配。试试手动搜索？",
  "message_en": "No new matches found for your profile. Try a manual search?"
}
```

### 3.5 AI 渲染规范

#### 3.5.1 上下文推荐渲染

```
🎯 可能对你有用的技能

基于你的 profile: rust, typescript
发现 1 个技能缺口: security-audit

1. cargo-audit ⭐ A
   安全审计你的 Rust 依赖 → 直接扫描 Cargo.toml
   💡 因为你用 Rust 开发，这个可以自动发现已知漏洞
   安装: openclaw skills install cargo-audit

2. eslint-ai ⭐ A
   用 AI 增强 ESLint 规则 → 自动生成项目级 .eslintrc
   💡 匹配你的 TypeScript 技术栈，替代手动配置 ESLint
   安装: openclaw skills install eslint-ai

提示: 回复 skill 名称可安装，或说「看看更多」查看更多。
```

#### 3.5.2 Radar 渲染（contextual 模式）

```
📡 每日雷达 — 2026-05-01

根据你的技术栈（rust, typescript），发现 2 个新 skill：

1. cargo-audit ⭐ A
   💡 你的 Rust 工作流缺少安全审计——这个可以补上

2. git-copilot ⭐ B
   💡 和你常用的 github-ops 互补——一个管操作，一个管沟通

回复 skill 名称安装，或说「忽略」跳过。
```

#### 3.5.3 降级渲染

```
🎯 热门技能（个性化服务暂时不可用，显示热门推荐）

1. slack-summarizer ⭐ A
   Slack 对话自动摘要 → 支持频道/DM
   安装: openclaw skills install slack-summarizer

2. ...
```

#### 3.5.4 空结果渲染

```
🎯 暂无个性化推荐

目前基于你的 profile（rust, typescript）没有找到新的匹配 skill。

这可能是因为：
  • 你已经安装了大部分相关的 skill
  • ClawHub 上还没有匹配你 profile 的新 skill

试试手动搜索: /mapick search <关键词>
或者: /mapick recommend 查看全站热门
```

#### 3.5.5 渲染规则

1. **每个推荐必须包含推荐理由**（`💡` 行），来源是后端返回的 `reason`/`reason_zh` 字段
2. **推荐理由不可省略**——如果后端未返回 reason，AI 应从 tags/installed 推断一句话理由
3. **推荐理由不可编造**——推理必须基于真实上下文（用户的 tags 和已安装 skill）
4. **降级时必须告知用户**——显示"个性化服务暂时不可用"而非静默降级
5. **空结果必须友好说明**——不能沉默，也不能展示空列表

### 3.6 Radar 端点切换逻辑

写入 `radar.js` 的核心判断逻辑：

```javascript
async function handleRadar(_args, ctx) {
  const config = readConfig();
  const proactiveMode = config.proactive_mode || "helpful";

  // proactive_mode=off 或 silent: 不执行 radar
  if (proactiveMode === "off" || proactiveMode === "silent") {
    return { skip: true, reason: `proactive_mode is ${proactiveMode}` };
  }

  // proactive_mode=helpful: 使用 contextual 端点
  const scanResult = handleScan();
  const tags = config.user_profile_tags?.join(",") || "";
  const installed = scanResult.skills.map(s => s.slug).join(",");

  let endpoint, params, fallbackToFeed = false;

  try {
    const response = await apiCall("GET",
      `/recommendations/contextual?tags=${tags}&installed=${installed}&limit=5`,
      null,
      "radar"
    );
    // contextual 成功
    return { ...response, recommendation_source: "contextual" };
  } catch (err) {
    // 降级到 feed
    fallbackToFeed = true;
  }

  // fallback
  const feedResponse = await apiCall("GET", "/recommendations/feed", null, "radar");
  return { ...feedResponse, recommendation_source: "feed_fallback", fallback_reason: err.message };
}
```

### 3.7 JSON Schema

```typescript
interface ContextualRecommendation {
  intent: "recommend";
  mode: "contextual" | "feed";
  recommendations: Array<{
    skillId: string;
    slug: string;
    name: string;
    grade: "A" | "B" | "C";
    description: string;
    reason?: string;        // 英文推荐理由
    reason_zh?: string;     // 中文推荐理由
    complementaryTo?: string[];
    category?: string;
    installCount?: number;
    installCommand: string;
  }>;
  context: {
    tags_matched: string[];
    gaps_identified: string[];
    total_available: number;
  } | null;
  fallback: boolean;
  fallback_reason?: string;
  fallback_reason_zh?: string;
  recommendation_source?: "contextual" | "feed_fallback";
  message?: string;         // 空结果时的友好说明
  message_en?: string;
}
```

---

## 4. 设计规范（Phase 2 补充）

### 4.1 Emoji 使用规范（Phase 2 新增）

| 场景 | Emoji | 位置 | 用途 |
|------|-------|------|------|
| Token 报告 | 💰 | 标题行 | 今日/本周 token 消耗 |
| Token 趋势 | 📊 | 标题行 | 周度趋势报告 |
| Token 洞察 | 📌 | 行首 | 洞察提示（如 never_used skill）|
| 上下文推荐 | 🎯 | 标题行 | 个性化推荐 |
| 推荐理由 | 💡 | 行首 | "为什么推荐"理由 |
| 每日雷达 | 📡 | 标题行 | Daily radar 报告 |
| 主动模式 | 🔇 | 行首 | proactive_mode=off 确认 |
| 主动模式 | 🔔 | 行首 | proactive_mode=silent/helpful 确认 |
| 异常消耗 | ⚠️ | 行首 | 消耗超过日均 3x |
| 降级提示 | 📡 | 标题行 | contextual 降级到 feed |

### 4.2 新增 CLI 子命令一览

| 命令 | 路由函数 | 返回值 intent | 说明 |
|------|---------|--------------|------|
| `profile set proactive_mode=off` | `handleProfile("set", ...)` | `profile:set` | 切换模式 |
| `profile set proactive_mode=silent` | `handleProfile("set", ...)` | `profile:set` | 切换模式 |
| `profile set proactive_mode=helpful` | `handleProfile("set", ...)` | `profile:set` | 切换模式 |
| `profile get` | `handleProfile("get")` | `profile:get` | 查看当前模式 |
| `stats token today` | `handleStats("token", "today")` | `stats:token` | 今日 token 报告 |
| `stats token week` | `handleStats("token", "week")` | `stats:token` | 本周 token 报告 |
| `recommend --contextual` | `handleRecommend("--contextual")` | `recommend` | 上下文推荐 |

### 4.3 Phase 2 与 Phase 1 的兼容

| 维度 | 兼容性 | 说明 |
|------|--------|------|
| `proactive_mode` 缺失 | ✅ | 老用户 CONFIG.md 无此字段时默认 `helpful`，行为与 Phase 1 一致 |
| 无 session 日志 | ✅ | `stats token` 返回空报告，不报错 |
| 无 `--contextual` flag | ✅ | `recommend` 默认行为不变（仍走 feed/intent search） |
| contextual 端点不可用 | ✅ | 自动降级到 feed，不阻断推荐 |
| `profile set` 非法值 | ✅ | 白名单校验，拒绝并返回错误 |
| Token 日志文件权限 | ✅ | `600`（仅 owner 读写） |
| Token 日志滚动 | ✅ | 7 天自动归档，单文件 ≤ 10MB |

### 4.4 新增 ALLOWED_ENDPOINTS

```diff
  const ALLOWED_ENDPOINTS = [
    // ... existing Phase 1 entries ...
+   /^\/recommendations\/contextual$/,
  ];
```

---

## 5. 文件变更对照表（Phase 2）

| 文件 | 变更类型 | 变更内容 | 关联模块 |
|------|:-------:|---------|---------|
| `scripts/lib/misc.js` | 修改 | `handleProfile` 扩展 `proactive_mode` set/get | §1 |
| `scripts/lib/stats.js` | **新增** | `handleStatsToken()`：JSONL 解析 + 归因 + 聚合 | §2 |
| `scripts/lib/recommend.js` | 修改 | `handleRecommend` 支持 `--contextual` flag | §3 |
| `scripts/lib/radar.js` | 修改 | `handleRadar` 按 `proactive_mode` 切换端点 + 降级 | §3 |
| `scripts/lib/core.js` | 修改 | `handleInit` 写入默认 `proactive_mode`；新增 `buildContextualParams()` helper | §1, §3 |
| `scripts/lib/http.js` | 修改 | `ALLOWED_ENDPOINTS` 新增 `/recommendations/contextual` | §3 |
| `scripts/shell.js` | 修改 | 调度路由新增 `stats token [today\|week]` | §2 |
| `SKILL.md` | 新增 | §14 Proactive Mode 行为规则；§15 Token Transparency 渲染规则 | §1, §2 |
| `SKILL.md` | 修改 | §8 更新推荐渲染规则：新增 contextual 理由说明 | §3 |
| `CONFIG.md`（模板） | 新增 key | `proactive_mode` 默认值 | §1 |
| `~/.mapick/logs/token-usage.jsonl` | **新建** | token 使用日志（增量写入） | §2 |

---

## 附录 B：Phase 2 端到端输出示例

### B.1 Profile 切换 — 自然语言触发

```
用户: 以后别推东西给我了

→ AI 解析为: profile set proactive_mode=off
→ Shell 输出:
{"intent":"profile:set","key":"proactive_mode","value":"off","previous_value":"helpful","effect":"已关闭主动推荐。我不会再主动扫描技能缺口了。你随时说「推荐几个」我会响应。"}

→ AI 渲染:
🔇 已调整。我不会再主动推荐技能了。
你随时说「推荐几个」我会响应。
```

### B.2 Token 报告 — 今日

```
用户: /mapick stats token today

→ Shell 输出: (stats:token JSON, 见 §2.4)

→ AI 渲染:
💰 Token 消耗 — 今日（2026-05-01）

总计：205K tokens · 预估 $0.85

按 Skill 拆分（按费用降序）：
  github-ops        83K  · $0.38   ████████████░░░░  44.7%  活跃
  _system           36K  · $0.18   █████░░░░░░░░░░░  21.2%  系统
  summarize         19K  · $0.12   ███░░░░░░░░░░░░░  11.0%  活跃
  docker-manage     18K  · $0.08   ██░░░░░░░░░░░░░░  10.4%  活跃
  csv-converter     12K  · $0.06   █░░░░░░░░░░░░░░░   7.1%  闲置 14d

今日 vs 日均：205K / 195K（正常 ✅）

费用为预估值，实际以 Claude 官方计费为准。
```

### B.3 Contextual 推荐 — Radar 触发

```
用户: /mapick radar
（proactive_mode=helpful）

→ Shell 调用:
  1. handleScan() → 已安装 [github-ops, code-review, docker-manage]
  2. GET /recommendations/contextual?tags=rust,typescript&installed=github-ops,code-review,docker-manage&limit=5

→ Shell 输出: (recommend JSON, 见 §3.4)

→ AI 渲染:
🎯 可能对你有用的技能

基于你的 profile: rust, typescript
发现 1 个技能缺口: security-audit

1. cargo-audit ⭐ A
   安全审计你的 Rust 依赖 → 直接扫描 Cargo.toml
   💡 因为你用 Rust 开发，这个可以自动发现已知漏洞
   安装: openclaw skills install cargo-audit

2. eslint-ai ⭐ A
   用 AI 增强 ESLint 规则 → 自动生成项目级 .eslintrc
   💡 匹配你的 TypeScript 技术栈，替代手动配置 ESLint
   安装: openclaw skills install eslint-ai

提示: 回复 skill 名称可安装，或说「看看更多」查看更多。
```

### B.4 Contextual 降级 — Feed Fallback

```
用户: /mapick radar
（proactive_mode=helpful，但 contextual 端点 500）

→ Shell 输出:
{"intent":"recommend","mode":"contextual","fallback":true,"fallback_reason_zh":"个性化推荐服务暂时不可用，显示热门推荐","recommendations":[...]}

→ AI 渲染:
🎯 热门技能（个性化服务暂时不可用，显示热门推荐）

1. slack-summarizer ⭐ A
   Slack 对话自动摘要 → 支持频道/DM
   安装: openclaw skills install slack-summarizer

2. ...
```

---

*Phase 2 设计文档编写完毕，可进入代码实现阶段。*

---

# Phase 3 — 数据洞察与感知闭环 CLI 体验设计文档

**版本**: v3.0  
**日期**: 2026-05-01  
**范围**: `stats --detail` CLI 输出格式、Dashboard 3 列网格布局、个人统计卡片设计、Perception 准确率趋势渲染  
**设计原则**: 纯文本 CLI 环境，输出通过 JSON 传递给 AI 渲染；Dashboard 由 AI 将合并 JSON 渲染为视觉仪表盘

---

## 1. Dashboard 增强布局 — 3 列网格

### 1.1 设计目标

将 Phase 2 的单一 `stats token` 视图升级为三列信息架构：**全局概览** | **个人统计** | **感知洞察**。每个区块承载不同维度的数据，AI 水平并排渲染为视觉仪表盘。

三列方案解决的核心问题：
- Phase 2 `stats token` 仅展示 AI 成本，缺失使用行为和推荐效果两个关键视角
- 单列纵向滚动导致信息密度低，用户需要多次翻页才能看到完整画像
- Perception 数据（推荐准确率）与个人 stats 数据需要同时可见才有对比意义

### 1.2 三列网格定义

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          📊 Mapick 使用全景 — 过去 30 天                        │
├─────────────────────────┬──────────────────────────┬──────────────────────────┤
│   Column 1: 全局概览     │  Column 2: 个人统计       │  Column 3: 感知洞察       │
│   (Global Overview)     │  (Personal Stats)        │  (Perception Insights)   │
├─────────────────────────┼──────────────────────────┼──────────────────────────┤
│                         │                          │                          │
│  💰 Token 消耗          │  🎯 推荐漏斗              │  📐 推荐准确率            │
│  ─────────────────────  │  ─────────────────────    │  ─────────────────────    │
│  总计: 205K tokens      │  曝光 340                 │  整体: 75%               │
│  预估: $0.85            │    → 点击 85 (25%)       │  趋势: ↗ +10%            │
│                         │      → 安装 42 (49%)     │                          │
│  top 3:                 │  整体转化: 12.4%          │  by category:            │
│    github-ops   83K     │                          │    security-qa 85% ★     │
│    _system      36K     │  ⭐ Top Skills            │    dev-tools     78%     │
│    summarize    19K     │  ─────────────────────    │    productivity  72%     │
│                         │    github-ops   245次     │    frontend      60%     │
│  📈 安装趋势            │    code-review  189次     │    data-science  55% ▲   │
│  ─────────────────────  │    summarize    156次     │                          │
│  W13 ███  3             │    docker-mgmt   98次    │  💡 洞察                  │
│  W14 █████ 5 ▲          │    csv-convert   72次    │  ─────────────────────    │
│  W15 ██ 2    ▼          │                          │  安全类最精准(85%)       │
│  W16 ████ 4  ▲          │  🏷️ 类别分布             │  数据科学类偏低(55%)    │
│  累计: 26 skills        │  ─────────────────────    │  建议完善 profile 标签    │
│                         │  dev-tools      8        │                          │
│  👤 活跃度              │  security-qa    5        │                          │
│  ─────────────────────  │  productivity   4        │                          │
│  活跃天数: 28/30 (93%) │  data-science   3        │                          │
│  总事件: 1,520          │  frontend       2        │                          │
│                         │  other          4        │                          │
│                         │                          │                          │
└─────────────────────────┴──────────────────────────┴──────────────────────────┘
```

### 1.3 列内容分配规则

| 列 | 数据源 | 内容 | 渲染要求 |
|:---|------|------|---------|
| **列 1：全局概览** | 本地 token 解析（Phase 2 `stats token` 逻辑）+ 后端 `installTrend` | Token 消耗摘要（总计 + top 3）、安装趋势 ASCII 图、活跃度概要 | 简洁摘要，详细信息由 `stats token` 独立命令提供 |
| **列 2：个人统计** | 后端 `GET /stats/user/:userId` | 推荐漏斗、Top Skills 排名、类别分布 | 数据驱动，漏斗用 ASCII 箭头链，skills 用 bar 排序 |
| **列 3：感知洞察** | 后端 `GET /perception/accuracy-trend` + `GET /perception/summary` | 准确率趋势 sparkline、按类别准确率拆分、后端 insight 文本 | 趋势可视化 + 人类可读洞察 |

### 1.4 响应式降级（当数据源不可用时）

| 场景 | 渲染策略 |
|------|---------|
| 后端 stats 不可用 | 列 1 + 列 3 仍显示，列 2 替换为 "后端数据暂时不可用，稍后自动重试" |
| Perception 不可用 | 列 1 + 列 2 仍显示，列 3 留空（不显示错误提示） |
| 本地 token 解析失败 | 列 2 + 列 3 仍显示，列 1 替换为 "本地 token 数据解析失败" |
| 所有数据源均失败 | 显示单一错误卡片: "暂时无法获取统计数据，请检查网络后重试" |

### 1.5 AI 渲染顺序（从上到下）

```
1. 总标题行: 📊 Mapick 使用全景 — 过去 {period}
2. 三列网格内容
3. 洞察区（如果 insight 数据存在）
4. 脚注免责声明（token 费用为预估值）
```

**渲染规则**：
1. 列之间用 `│` 竖线分隔
2. 每列宽度均衡，最大列宽 ≤ 30 字符
3. `--detail` 不渲染原始 JSON（与 Phase 2 一致）
4. 如果用户指定 `--period 7d`，标题行中 "过去 30 天" → "过去 7 天"

---

## 2. 个人统计卡片设计

### 2.1 设计目标

个人统计卡片是 Dashboard 的核心模块，承载用户最关心的 4 类指标：
- **推荐转化**：推荐漏斗三个转化率
- **事件总量**：总事件数 + 按类型拆分
- **活跃天数**：天数 + 比例
- **安装趋势**：周安装趋势图 + 累计

### 2.2 推荐漏斗卡片

#### 2.2.1 漏斗 ASCII 渲染

```
🎯 推荐漏斗（30 天）
   曝光 340 ──→ 点击 85 (25%) ──→ 安装 42 (49%)
   整体转化率：12.4%（42/340）
```

**渲染规则**：
- 使用 `──→` 箭头连接各阶段
- 百分号括在括号中：`(25%)`
- 整体转化率单独一行，加粗显示
- 如果后端返回 `platformAverageConversionRate`，追加对比：
  ```
  📈 高于全平台平均（9.8%）
  ```
  或
  ```
  📉 低于全平台平均（9.8%）
  ```

#### 2.2.2 转化率颜色语义

| 转化率范围 | 标签 | 渲染效果 |
|:---------:|------|---------|
| > 15% | 优秀 | `📈 高于全平台平均` |
| 10%-15% | 正常 | `✅ 接近全平台平均` |
| < 10% | 需关注 | `📉 低于全平台平均` |

### 2.3 事件总量卡片

```
👤 活跃度
   活跃天数: 28/30（93%）
   总事件:   1,520
     搜索         320 次
     推荐曝光      340 次
     推荐点击       85 次
     推荐安装       42 次
     安装          68 次
```

**渲染规则**：
- 事件按用户可理解的语义分组（搜索、推荐、安装）
- 不渲染内部事件类型（如 `consent_grant`、`mode_switch`），除非 > 0 且用户主动查询
- `activeDaysRatio` 用百分号展示，如 93%
- 活跃比例 < 30% 时标注 `⚠️ 活跃度较低`

### 2.4 Top Skills 排名卡片

```
⭐ Top Skills（按使用频次）
   1. github-ops        245 次 ██████████
   2. code-review       189 次 ████████░░
   3. summarize         156 次 ██████░░░░
   4. docker-manage      98 次 ████░░░░░░
   5. csv-converter      72 次 ███░░░░░░░
```

**渲染规则**：
- 最多 5 个（后端 `topSkills` 数组长度）
- ASCII bar 宽度 10 格，按最大 `interactions` 线性缩放
- compact 模式（`--detail --compact`）：仅显示 skill name + 次数，省略 bar

### 2.5 安装趋势卡片

```
📈 安装趋势
   W13 ███  3
   W14 █████ 5  ▲
   W15 ██ 2     ▼
   W16 ████ 4   ▲
   → 累计 26 个 skill
```

**渲染规则**：
- 每周一行，格式：`{week} {bar} {count} {arrow}`
- Bar 宽度 10 格，按所有周中最大 `count` 线性缩放
- 箭头规则：
  - 本周 > 上周 → `▲`
  - 本周 < 上周 → `▼`
  - 本周 == 上周 → `→`
  - 第一周无上一周对比 → 不显示箭头
- 累计显示在最末行

### 2.6 类别分布卡片

```
🏷️ 类别分布
   dev-tools 8 · security-qa 5 · productivity 4
   data-science 3 · frontend 2 · other 4
```

**渲染规则**：
- 类别名使用 `category` 字段原始值（英文）
- 按安装数降序排列
- 紧凑渲染：所有类别在一行或两行内展示完
- 类别 ≤ 3 个时：单行显示
- 类别 > 3 个时：两行显示，每个类别用 `·` 分隔

---

## 3. `stats --detail` CLI 输出格式

### 3.1 命令签名

```bash
# 默认 30 天报告
node scripts/shell.js stats --detail

# 指定周期
node scripts/shell.js stats --detail --period 7d
node scripts/shell.js stats --detail --period 90d

# 紧凑模式（省略 ASCII bar）
node scripts/shell.js stats --detail --compact
```

### 3.2 参数说明

| 参数 | 必须 | 默认值 | 说明 |
|------|:---:|------|------|
| `--detail` | 是 | — | 触发全景报告模式 |
| `--period` | 否 | `30d` | 统计周期，`7d` / `30d` / `90d` |
| `--compact` | 否 | `false` | 紧凑模式，省略 ASCII bar 和装饰 |

### 3.3 数据获取流程

```
stats --detail
    │
    ├── (1) 本地 token 解析 (复用 Phase 2 handleStatsToken)
    │       └── 读取 ~/.openclaw/agents/main/sessions/*.jsonl
    │           聚合 → local.tokenReport
    │
    ├── (2) GET /stats/user/:userId  (Phase 3 新增)
    │       └── 请求后端 user stats 端点
    │           响应 → remote.userStats
    │
    └── (3) GET /perception/accuracy-trend (Phase 3 新增)
            └── 请求后端 perception 准确率趋势
                响应 → remote.perception

合并 → 统一 JSON → stdout
```

### 3.4 合并后的 JSON Schema

```json
{
  "intent": "stats:detail",
  "period": "30d",
  "from": "2026-04-01T00:00:00Z",
  "to": "2026-05-01T00:00:00Z",
  "local": {
    "tokenReport": {
      "total": {
        "input": 875000,
        "output": 476000,
        "cache": 84000,
        "all": 1435000,
        "cost_estimate": 5.92,
        "currency": "USD",
        "model_pricing_used": "claude-sonnet-4-20250514"
      },
      "by_skill": [
        {
          "skill": "github-ops",
          "input": 52000,
          "output": 31000,
          "total": 83000,
          "cost_estimate": 0.38,
          "pct_of_total": 44.7,
          "calls": 12,
          "status": "active",
          "last_seen": "2026-05-01T14:20:00Z"
        }
      ],
      "source": {
        "sessions_scanned": 12,
        "records_parsed": 203
      }
    },
    "parsedAt": "2026-05-01T12:00:00Z"
  },
  "remote": {
    "userStats": {
      "userId": "a1b2c3d4e5f6g7h8",
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
          { "slug": "summarize", "name": "Smart Summarizer", "interactions": 156, "category": "productivity" }
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
      }
    },
    "perception": {
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
    },
    "source": "api",
    "fetchedAt": "2026-05-01T12:00:01Z"
  },
  "remoteFallback": false,
  "generatedAt": "2026-05-01T12:00:01Z"
}
```

### 3.5 降级 JSON 输出

当后端 `GET /stats/user/:userId` 不可用时：

```json
{
  "intent": "stats:detail",
  "period": "30d",
  "from": "2026-04-01T00:00:00Z",
  "to": "2026-05-01T00:00:00Z",
  "local": { "tokenReport": { "..." } },
  "remote": null,
  "remoteFallback": true,
  "remoteFallbackReason": "GET /stats/user/:userId returned 503 — backend unavailable",
  "generatedAt": "2026-05-01T12:00:01Z"
}
```

当 `GET /perception/accuracy-trend` 不可用时（`remote.userStats` 仍有效）：

```json
{
  "intent": "stats:detail",
  "period": "30d",
  "local": { "tokenReport": { "..." } },
  "remote": {
    "userStats": { "..." },
    "perception": null,
    "source": "api_partial"
  },
  "remoteFallback": false,
  "perceptionFallback": true,
  "perceptionFallbackReason": "GET /perception/accuracy-trend timed out after 2s",
  "generatedAt": "2026-05-01T12:00:01Z"
}
```

### 3.6 `stats --detail` JSON TypeScript Schema

```typescript
// 复用 Phase 2 schema
interface TokenBySkill {
  skill: string;
  input: number;
  output: number;
  cache: number;
  total: number;
  cost_estimate: number;
  pct_of_total: number;
  calls: number;
  status?: "active" | "never_used" | "idle_14d" | "idle_30d" | "zombie";
  last_seen?: string;
}

interface StatsDetail {
  intent: "stats:detail";
  period: "7d" | "30d" | "90d";
  from: string;
  to: string;
  local: {
    tokenReport: {
      total: {
        input: number;
        output: number;
        cache: number;
        all: number;
        cost_estimate: number;
        currency: "USD";
        model_pricing_used: string;
      };
      by_skill: TokenBySkill[];
      daily_average?: { total_tokens: number; cost_estimate: number; days_tracked: number; };
      today_vs_average?: { ratio: number; label: string; };
      source: { sessions_scanned: number; records_parsed: number; last_parsed_ts?: string; };
    };
    parsedAt: string;
  };
  remote: {
    userStats: {
      userId: string;
      stats: {
        eventsTotal: number;
        eventsByType: Record<string, number>;
        recommendShown: number;
        recommendClicked: number;
        recommendInstalled: number;
        conversionRate: { click_through: number; install_rate: number; overall: number; };
        activeDays: number;
        activeDaysRatio: number;
        topSkills: Array<{ slug: string; name: string; interactions: number; category: string; }>;
        installTrend: Array<{ week: string; count: number; cumulative: number; }>;
        categoryDistribution: Record<string, number>;
      };
    } | null;
    perception: {
      trend: Array<{ date: string; accuracy: number; total: number; correct: number; }>;
      overall: { accuracy: number; totalPredictions: number; correctPredictions: number; };
      byCategory: Array<{ category: string; accuracy: number; total: number; correct: number; }>;
    } | null;
    source: "api" | "api_partial";
    fetchedAt: string;
  } | null;
  remoteFallback: boolean;
  remoteFallbackReason?: string;
  perceptionFallback?: boolean;
  perceptionFallbackReason?: string;
  generatedAt: string;
}
```

---

## 4. Perception 准确率趋势 AI 渲染模板

### 4.1 设计目标

Perception 准确率在 Dashboard 中以**列 3** 的形式呈现。设计重点：
- **7 段 sparkline** 可视化最近 7 天的准确率走势
- **类别拆分** 帮助用户理解推荐在哪些领域精准/不精准
- **人类可读洞察** 让技术指标转化为 actionable 建议

### 4.2 Sparkline 生成规则

#### 4.2.1 映射表

从 `perception.trend[].accuracy` 值 (0-1) 映射到 sparkline 字符：

| accuracy 范围 | Sparkline 字符 | 语义 |
|:------------:|:-------------:|------|
| 0.00 – 0.45 | `▁` | 最低 |
| 0.45 – 0.50 | `▂` | 很低 |
| 0.50 – 0.60 | `▃` | 较低 |
| 0.60 – 0.65 | `▄` | 中等偏低 |
| 0.65 – 0.72 | `▅` | 中等 |
| 0.72 – 0.78 | `▆` | 较高 |
| 0.78 – 0.88 | `▇` | 高 |
| 0.88 – 1.00 | `█` | 最高 |

#### 4.2.2 趋势方向算法

取最近 7 天 `accuracy` 值，计算线性回归斜率：
- 斜率 > 0.01 → `improving` → 渲染 `↗ 上升`
- 斜率 < -0.01 → `declining` → 渲染 `↘ 下降`
- 否则 → `stable` → 渲染 `→ 平稳`

#### 4.2.3 Delta 计算

`trendDelta` = 最近 1 天 accuracy - 7 天前 accuracy

### 4.3 准确率趋势渲染模板

#### 4.3.1 标准渲染（全部数据可用）

```
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

#### 4.3.2 Sparkline 渲染规则

1. 取最近 7 天 `trend[].accuracy` 值
2. 按映射表将每个值转为字符
3. 拼接为 7 字符序列
4. 不足 7 天时用 `·` 补齐空位

```
数据: [0.72, 0.68, 0.75, 0.80, 0.73, 0.78, 0.82]
     ↓ 映射
渲染:  ▁▂▃▄▅▆▇

数据: [0.72, 0.68, 0.75, 0.80]  (仅 4 天)
     ↓ 映射
渲染:  ▆▅▆▇···
```

#### 4.3.3 类别准确率排序规则

- 按 `accuracy` 降序排列
- 最前标 `★ 最准`
- 最后标 `▲ 需关注`
- 中间不标
- 最多展示 5 个类别

#### 4.3.4 ASCII bar 规则

- 10 格宽度
- 0% = 0 格，100% = 10 格
- 最高类别显示 `░` 作为剩余空间（未填满部分）
- 其余类别不显示 `░`

### 4.4 每日 Digest 感知简报渲染

#### 4.4.1 Digest 中 perception 数据的位置

感知简报在 daily digest 末尾展示，作为补充信息：

```
📋 每日通知 — 2026-05-01

   🔔 版本更新: v0.0.15 → v0.0.17
   ...

   🧠 Mapick 感知简报
      推荐准确率：75%（↑ +10%，近 7 天）
      最精准类别：安全类(85%)、开发工具(78%)
      建议关注：数据科学类准确率偏低(55%)，可完善 profile 标签
```

#### 4.4.2 感知简报渲染规则

| 条件 | 渲染行为 |
|------|---------|
| perception 请求成功 | 展示感知简报区块 |
| perception 请求失败（5xx/超时） | **静默跳过**，不展示任何内容 |
| `overallAccuracy >= 0.7` | 不标颜色 |
| `overallAccuracy >= 0.5 && < 0.7` | `⚠️ 准确率偏低，建议运行 stats --detail 查看详情` |
| `overallAccuracy < 0.5` | `⚠️ 准确率低于 50%，建议运行 stats --detail 分析原因` |
| `trendDirection === "declining"` | 追加 `📉 近 7 天呈下降趋势，建议更新 profile 标签` |
| `trendDirection === "improving"` | 追加 `趋势向好` |

#### 4.4.3 静默策略

- 感知简报在 `perception` 请求失败时**完全不展示**（包括不展示 "数据不可用" 提示）
- 理由：daily digest 的主体是通知（版本更新、僵尸 skill），perception 是辅助信息，不能因辅助信息不可用而干扰主体
- `proactive_mode !== "helpful"` 时不展示感知简报

### 4.5 准确率趋势 JSON 到渲染的映射（AI 参考）

写入 SKILL.md §17 供 AI 在渲染时参考：

```javascript
// 伪代码：accuracy → sparkline 字符映射
function accuracyToSpark(v) {
  if (v < 0.45) return "\u2581"; // ▁
  if (v < 0.50) return "\u2582"; // ▂
  if (v < 0.60) return "\u2583"; // ▃
  if (v < 0.65) return "\u2584"; // ▄
  if (v < 0.72) return "\u2585"; // ▅
  if (v < 0.78) return "\u2586"; // ▆
  if (v < 0.88) return "\u2587"; // ▇
  return "\u2588";               // █
}

// 趋势方向计算
function computeTrendDirection(recent7) {
  // 取最近 7 天的 accuracy 值做简单线性斜率
  const n = recent7.length;
  if (n < 2) return { icon: "→", label: "数据不足" };
  const first = recent7[0].accuracy;
  const last = recent7[n - 1].accuracy;
  const slope = (last - first) / n;
  if (slope > 0.01) return { icon: "↗", label: "上升" };
  if (slope < -0.01) return { icon: "↘", label: "下降" };
  return { icon: "→", label: "平稳" };
}
```

---

## 5. Phase 3 设计规范

### 5.1 Emoji 使用规范（Phase 3 新增）

| 场景 | Emoji | 位置 | 用途 |
|------|-------|------|------|
| Dashboard 总标题 | 📊 | 标题行 | 使用全景仪表盘 |
| 全局概览列 | 💰 | 列标题 | Token 消耗摘要 |
| 个人统计列 | 🎯 | 列标题 | 推荐漏斗 + Top Skills |
| 感知洞察列 | 📐 | 列标题 | 准确率趋势 |
| 安装趋势 | 📈 | 区块标题 | 周安装趋势 |
| 活跃度 | 👤 | 区块标题 | 活跃天数 |
| 类别分布 | 🏷️ | 区块标题 | 技能类别 |
| 洞察行 | 💡 | 行首 | AI 生成的洞察 |
| 感知简报 | 🧠 | 区块标题 | Daily digest 感知简报 |
| 趋势上升 | ↗ | 内联 | 趋势方向 |
| 趋势下降 | ↘ | 内联 | 趋势方向 |
| 趋势平稳 | → | 内联 | 趋势方向 |
| 转化率高于平均 | 📈 | 内联 | 正面对比 |
| 转化率低于平均 | 📉 | 内联 | 负面对比 |
| 活跃度低 | ⚠️ | 行首 | 活跃比例 < 30% |

### 5.2 新增 CLI 子命令一览

| 命令 | 路由函数 | 返回值 intent | 说明 |
|------|---------|--------------|------|
| `stats --detail` | `handleStatsDetail("30d")` | `stats:detail` | 全景报告（30 天默认） |
| `stats --detail --period 7d` | `handleStatsDetail("7d")` | `stats:detail` | 全景报告（7 天） |
| `stats --detail --period 90d` | `handleStatsDetail("90d")` | `stats:detail` | 全景报告（90 天） |
| `stats --detail --compact` | `handleStatsDetail("30d", true)` | `stats:detail` | 紧凑模式全景报告 |

### 5.3 Phase 3 与 Phase 2 的兼容

| 维度 | 兼容性 | 说明 |
|------|--------|------|
| `stats token today/week` | ✅ | 行为完全不变（不加 `--detail` 时保持 Phase 2 行为） |
| `stats token` 不加参数 | ✅ | 默认 `today`，行为不变 |
| 后端 stats 端点不可用 | ✅ | `remoteFallback: true`，仅展示本地 token 数据 |
| Perception 端点不可用 | ✅ | `perceptionFallback: true`，stats dashboard 跳过感知列，daily digest 静默跳过 |
| `proactive_mode ≠ helpful` | ✅ | daily digest 不展示感知简报 |
| 新用户无足够 events | ✅ | 后端返回 `eventsTotal: 0` 时 AI 渲染 "数据收集中，使用 7 天后来看完整报告" |
| ALLOWED_ENDPOINTS 新增 | ✅ | 新增 3 条正则，不破坏已有匹配 |

### 5.4 Sparkline 字符规范

```
▁  (U+2581)  — 最低 (0.00-0.45)
▂  (U+2582)  — 很低 (0.45-0.50)
▃  (U+2583)  — 较低 (0.50-0.60)
▄  (U+2584)  — 中等偏低 (0.60-0.65)
▅  (U+2585)  — 中等 (0.65-0.72)
▆  (U+2586)  — 较高 (0.72-0.78)
▇  (U+2587)  — 高 (0.78-0.88)
█  (U+2588)  — 最高 (0.88-1.00)
·  (U+00B7)  — 数据缺失占位
```

---

## 6. 文件变更对照表（Phase 3）

| 文件 | 变更类型 | 变更内容 | 关联模块 |
|------|:-------:|---------|---------|
| `scripts/lib/stats.js` | 修改 | 新增 `handleStatsDetail()`：合并本地 token + 后端 stats + perception 数据 | §1, §3 |
| `scripts/lib/core.js` | 修改 | 新增 `fetchUserStats(userId, period)` + `fetchPerceptionTrend(period)` + `fetchPerceptionSummary()` helper | §3 |
| `scripts/lib/http.js` | 修改 | `ALLOWED_ENDPOINTS` 新增 3 条：`/stats/user/`、`/perception/accuracy-trend`、`/perception/summary` | §3 |
| `scripts/shell.js` | 修改 | 调度路由新增 `stats --detail` + `--period` + `--compact` 参数解析 | §3 |
| `scripts/lib/notify.js` | 修改 | `handleNotifyDaily()` 集成 perception summary 到 digest JSON | §4 |
| `SKILL.md` | 新增 | §16 Stats Dashboard 渲染规则；§17 Perception 集成渲染规则 | §1, §2, §4 |
| **后端** | **新增** | `GET /stats/user/:userId` 端点（需与后端团队协调） | §1, §2, §3 |
| **后端** | 已有 | `/perception/accuracy-trend` 和 `/perception/summary` 已实现 | §4 |

---

## 附录 C：Phase 3 完整 Dashboard 渲染示例

### C.1 标准模式（30 天，所有数据可用）

```
📊 Mapick 使用全景 — 过去 30 天

💰 Token 消耗                      │ 🎯 推荐漏斗（30 天）              │ 📐 推荐准确率（后验分析）
─────────────────────              │ ─────────────────────              │ ─────────────────────
总计: 1.44M tokens · $5.92        │ 曝光 340 ──→ 点击 85 (25%)       │ 整体: 75%（70/93 推荐命中）
                                   │          ──→ 安装 42 (49%)       │ 趋势: ▁▂▃▄▅▆▇ ↗ +10%
top 3:                             │ 整体转化率: 12.4%                 │
  github-ops    364K  · $1.68     │ 📈 高于全平台平均（9.8%）          │ by category:
  code-review   287K  · $1.32     │                                   │   security-qa  85% ████████████░ ★
  summarize     144K  · $0.66     │ ⭐ Top Skills                      │   dev-tools    78% ███████████░░
                                   │ ─────────────────────              │   productivity 72% ██████████░░░
📈 安装趋势                        │   github-ops      245次 ██████████│   frontend     60% ████████░░░░░
─────────────────────              │   code-review     189次 ████████░░│   data-science 55% ███████░░░░░░ ▲
W13 ███  3                        │   summarize       156次 ██████░░░░│
W14 █████ 5 ▲                     │   docker-manage    98次 ████░░░░░░│ 💡 洞察
W15 ██ 2    ▼                     │   csv-converter    72次 ███░░░░░░░│ ─────────────────────
W16 ████ 4  ▲                     │                                   │ 安全类推荐最准(85%)
→ 累计 26 skills                   │ 🏷️ 类别分布                      │ 数据科学类偏低(55%)
                                   │ ─────────────────────              │ 建议完善 profile 标签
👤 活跃度                          │ dev-tools 8 · security-qa 5 ·    │
─────────────────────              │ productivity 4 · data-science 3 ·  │
活跃天数: 28/30 (93%)              │ frontend 2 · other 4              │
总事件: 1,520                      │                                   │

费用为预估值，实际以 Claude 官方计费为准。
```

### C.2 降级模式（后端 stats 不可用）

```
📊 Mapick 使用全景 — 过去 30 天

💰 Token 消耗                      │ ⚠️ 后端数据暂时不可用               │ 📐 推荐准确率（后验分析）
─────────────────────              │                                    │ ─────────────────────
总计: 1.44M tokens · $5.92        │ /stats/user/:userId 返回 503        │ 整体: 75%（70/93 推荐命中）
                                   │                                    │ 趋势: ▁▂▃▄▅▆▇ ↗ +10%
top 3:                             │ 个人统计和推荐漏斗暂时无法展示，      │
  github-ops    364K  · $1.68     │ 稍后自动重试。                      │ by category:
  ...                              │                                    │   security-qa  85% ★
                                   │                                    │   dev-tools    78%
                                   │                                    │   ...

费用为预估值，实际以 Claude 官方计费为准。
```

### C.3 紧凑模式（`--detail --compact`）

```
📊 Mapick 使用全景 — 过去 30 天

💰 1.44M tokens · $5.92 | 🎯 340→85→42 (12.4%) | 📐 75% ↗+10%
top: github-ops 364K · code-review 287K · summarize 144K
active: 28/30d · events: 1,520 · installed: 26 skills
categories: dev-tools 8 · security-qa 5 · productivity 4 · data-science 3
💡 安全类推荐最准(85%)，数据科学类偏低(55%)。费用为预估值。
```

---

*Phase 3 设计文档编写完毕，可进入代码实现阶段。*
