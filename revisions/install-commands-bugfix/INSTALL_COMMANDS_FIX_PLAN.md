# Mapick 安装命令与一键安装链路修复计划

> 范围：仅针对本仓库（`mapick-ai/mapick` Skill 端 + `mapick-api` 后端共享库）的安装命令生成逻辑、SKILL.md 调用契约、与 mapickii 同名路径冲突、首次同意后的 cron 静默失败。
> 日期：2026-04-28
> 来源：Mapick 工程师在试装 `recommend` 推荐结果时撞到 5 个问题（含一个排查清单），原始报告附在 §0.1。
> 目标：让 `/mapick recommend` / `/mapick search` 给出的 `installCommands` 在用户终端里**一键就能跑通**；让 SKILL.md 写的命令格式与实际投递到用户机器的二进制一致；让 mapick 与 mapickii 共存时不再混淆；让 consent 之后的后台 cron 不再静默失败。

## 0. 核心结论

推荐流程已经能从后端拿到结果，但**最后一步（执行 install 命令）100% 失败**：
后端生成的 `clawhub install skillssh:...` ClawHub 不认，`npx @mapick/install ...` 这个 npm 包根本不存在。
用户体验是「Mapick 推得很准、但叫他装的时候 0/3 成功」。

修复方向收敛成两条：

1. **后端 `buildInstallCommands` 必须按数据来源（`source` + `slug` + `skillsshId`）生成可执行命令**，不能再统一拼接 `clawhub install ${skillId}`。
2. **Skill 端 SKILL.md 的命令格式要与实际安装产物一致**，并显式说明 `bash shell` wrapper 与 `shell.js` 的关系，避免新人改 SKILL.md 时把 wrapper 删掉、或在没有 wrapper 的环境（clawhub install 落到 workspace skills/）里走错路径。

其他三个问题（mapick/mapickii 路径、consent-agree 静默 cron、ACP/agentId 误导）都是上面两条主线的边界条件，分别有局部解。

### 0.1 原始问题报告（保留原文）

> 问题 1：installCommands 中的命令无法执行（高，核心功能不可用）
> `/mapick recommend` 返回的 `installCommands` 有两种格式：
> - openclaw: `clawhub install skillssh:soultrace-ai/soultrace-skill/soultrace`
> - claude/codex: `npx @mapick/install skillssh:...`
> 两种都失败：
> - `clawhub install skillssh:...` → `Error: Invalid slug`，clawhub 不认 `skillssh:` 前缀
> - `npx @mapick/install` → `npm 404 Not Found`，`@mapick/install` 这个 npm 包根本不存在
>
> 问题 2：SKILL.md 中的命令格式与实际文件不匹配（中）
> SKILL.md 写的是 `bash shell <subcommand>`（即 `scripts/shell`），但实际文件是 `scripts/shell.js`（没有 `scripts/shell` 这个可执行文件）。
> 正确调用应是 `node scripts/shell.js <subcommand>`，而不是 `bash shell <subcommand>`。
>
> 问题 3：openclaw skills install mapick 的路径歧义（中）
> - `clawhub install mapick` 装到 `/Users/.openclaw/workspace/skills/mapick`（workspace 级别）
> - mapickii（curl install.sh）装到 `/Users/.openclaw/skills/mapickii`（managed 级别）
> 两者同时存在且都显示 ✓ ready，可能造成用户混淆。
>
> 问题 4：consent-agree 后 cron 注册失败（静默，低）
> `privacy consent-agree 1.0` 成功后自动注册 cron 失败：
> `{"notifyCron":{"registered":false,"reason":"Command failed: openclaw cron add ..."}}`
> 但这个失败对用户是静默的，用户不知道每日通知没有生效。
>
> 排查清单（给其他用户安装问题）
> 1. `scripts/shell` 找不到 → 检查是否有 `scripts/shell.js`，改用 `node scripts/shell.js`
> 2. `clawhub install` 报 Invalid slug → 检查 slug 格式，去掉 `skillssh:` 前缀
> 3. `npx @mapick/install` 报 404 → 这个包目前不存在，不要使用
> 4. pairing required 错误 → 不要用 `sessions_spawn runtime=acp agentId=mapick`，mapick 是普通 skill 不是 ACP agent
> 5. `openclaw.json` 中的 `acp.agentId` → 这不是合法字段，会导致 Config invalid

### 0.2 与已有计划的关系

| 计划 | 关注点 | 与本计划关系 |
|------|--------|--------------|
| [revisions/install-setup/INSTALLATION_SETUP_PLAN.md](../install-setup/INSTALLATION_SETUP_PLAN.md) | 一键脚本/CLI 装到本机的链路（preflight、smoke test、doctor、ACP/Gateway 排错） | 本计划继承其 doctor 设计（§7.1, §8.1）和 §10.1 错误码命名习惯，但不重复说明 |
| [revisions/slack-01/slack-01-mapickii-upgrade.md](../slack-01/slack-01-mapickii-upgrade.md) | mapickii Skill 端升级（推荐数据质量、render 模板） | 本计划补它没覆盖的 install 命令链路——mapickii 同样依赖后端 `buildInstallCommands`，所以问题 1 修复对它一并生效 |
| [revisions/slack-01/slack-01-mapick-api-upgrade.md](../slack-01/slack-01-mapick-api-upgrade.md) | API 后端去重 + 401 修复 | 本计划新增 `buildInstallCommands` 重构，建议与那批 PR 同窗口部署 |

## 1. 问题清单（按修复优先级）

| # | 问题 | 严重 | 改动范围 | 责任 |
|---|------|------|----------|------|
| P0 | `installCommands` 全部不可执行 | 高 | `mapick-shared/src/install-commands.ts`、两处调用点、bundle.service.ts、`@mapick/install` 决策 | mapick-api + mapick-shared |
| P0 | SKILL.md `bash shell` 与实际产物不一致 | 中 | `mapick/SKILL.md`、`mapick/install.sh`（产物校验）、`mapick/scripts/shell` | mapick Skill |
| P1 | mapick / mapickii 同名路径冲突 | 中 | `mapick/install.sh` shadow 检测 + `mapick/SKILL.md` doctor 输出 | mapick Skill |
| P1 | consent-agree 后 cron 静默失败 | 低 | `mapick/scripts/shell.js` `registerNotifyCron`、`privacy:status` | mapick Skill |
| P1 | ClawHub 页 Crypto / wallet / sensitive credentials 误标（绿档可立刻消） | 中 | `mapick/SKILL.md` frontmatter、ClawHub 发布元数据、长尾走 verified-publisher | mapick Skill |
| P2 | 排查清单（含 ACP/agentId 误导） | 低 | `mapick/reference/troubleshooting.md`（新增）、SKILL.md 错误码表 | mapick Skill |

## 2. 问题 1：installCommands 不可执行（P0）

### 2.1 现状

[api/mapick-shared/src/install-commands.ts:17](../../api/mapick-shared/src/install-commands.ts#L17)：

```ts
export function buildInstallCommands(skillId: string): InstallCommands {
  return {
    openclaw: `clawhub install ${skillId}`,
    claude:   `npx @mapick/install ${skillId} --platform claude`,
    codex:    `npx @mapick/install ${skillId} --platform codex`,
  };
}
```

被两处调用：
- [api/mapick-api/src/modules/skill/skill.service.ts:176](../../api/mapick-api/src/modules/skill/skill.service.ts#L176)（live-search）
- [api/mapick-api/src/modules/recommend/recommend.service.ts:162](../../api/mapick-api/src/modules/recommend/recommend.service.ts#L162)（feed）
- [api/mapick-api/src/modules/bundle/bundle.service.ts:109](../../api/mapick-api/src/modules/bundle/bundle.service.ts#L109)（bundle install）

数据来源已经在 [Skill](../../api/mapick-shared/src/entities/skill/skill.entity.ts) 实体里区分：

| 字段 | 含义 |
|------|------|
| `source` | `'clawhub' \| 'skillssh'` |
| `skillId` | 全局唯一（skillssh 来源会带 `skillssh:` 前缀，例如 `skillssh:soultrace-ai/soultrace-skill/soultrace`） |
| `slug` | ClawHub 人类可读 slug（如 `git-assistant`） |
| `skillsshId` | skills.sh 专属 ID（`owner/repo/skill-name`） |
| `skillsshUrl` | skills.sh 主页 URL |

但 `buildInstallCommands` 把这些信息全丢了，只看 `skillId`，导致 skillssh 来源的 skill 被拼成 `clawhub install skillssh:...`，而 ClawHub CLI 当然不认这个前缀（slug 校验失败 → `Invalid slug`）。

`@mapick/install` 这个包目前**没发布**。`install-commands.ts` 顶部注释写「其余平台通过 `@mapick/install` CLI 统一安装」是计划，不是已实现状态。所以 claude/codex 平台 100% 报 404。

### 2.2 修复

#### 2.2.1 重构 `buildInstallCommands` 签名

把入参从 `skillId: string` 改为读取 Skill 的来源字段：

```ts
export type SkillInstallSource = {
  source: 'clawhub' | 'skillssh';
  skillId: string;        // 兜底
  slug?: string | null;   // ClawHub slug，优先级最高
  skillsshId?: string | null;     // skills.sh owner/repo/skill 三段式
  skillsshUrl?: string | null;    // skills.sh 主页（fallback 给文档链接）
};

export function buildInstallCommands(skill: SkillInstallSource): InstallCommands {
  if (skill.source === 'clawhub') {
    const slug = skill.slug || stripPrefix(skill.skillId, 'clawhub:');
    return {
      openclaw: `clawhub install ${slug}`,
      claude:   `# Manual install required: see ${clawhubUrl(slug)}`,
      codex:    `# Manual install required: see ${clawhubUrl(slug)}`,
    };
  }
  if (skill.source === 'skillssh') {
    const sshId = skill.skillsshId || stripPrefix(skill.skillId, 'skillssh:');
    return {
      openclaw: `clawhub install --source skillssh ${sshId}`, // 见 §2.2.2
      claude:   `# skills.sh install: see ${skill.skillsshUrl ?? skillsshUrl(sshId)}`,
      codex:    `# skills.sh install: see ${skill.skillsshUrl ?? skillsshUrl(sshId)}`,
    };
  }
  // unknown source → 显式 fallback，不静默生成无效命令
  return {
    openclaw: `# Unknown source for ${skill.skillId}; manual install required`,
    claude:   `# Unknown source for ${skill.skillId}; manual install required`,
    codex:    `# Unknown source for ${skill.skillId}; manual install required`,
  };
}
```

关键约束：
- 调用方必须把 `Skill` 实体或等价的来源字段传进来。`skill.service.ts:176`、`recommend.service.ts:162`、`bundle.service.ts:109` 三处调用都要改。
- 当 `source = clawhub` 且没有 `slug` 时，回退到去前缀的 `skillId`（兼容历史数据）。
- 当 `source = skillssh` 且 ClawHub CLI 不支持 `--source skillssh` 时，走 §2.2.2 的临时方案。

#### 2.2.2 ClawHub CLI 是否支持 `--source skillssh`

发版前必须先和 ClawHub 团队确认。三种可能：

| ClawHub 状态 | 命令模板 | 验证方法 |
|--------------|----------|----------|
| 已支持多 source | `clawhub install --source skillssh <ownerRepoSkill>` | 联系 ClawHub 跑一遍真实命令 |
| 不支持但接受 GitHub raw URL 安装 | `clawhub install --url <skillsshUrl>` 或同类 | 用 `skills.sh` 的 raw README/SKILL.md 路径试装 |
| 完全不支持 skillssh | 推荐里**直接不返回 skillssh 来源的 skill**（推荐器层过滤）；或者返回时 `installCommands.openclaw` 输出注释 + 文档链接，AI 在 SKILL.md 渲染时主动告知"这条 skill 来自 skills.sh，需手动安装" | 推荐结果只剩 ClawHub 来源 |

默认走「跟 ClawHub 团队确认 + 推荐器层过滤」组合。在确认前，**先把 §2.2.4 的过滤兜底打开**，避免线上继续给用户发不可执行命令。

#### 2.2.3 `@mapick/install` CLI 决策

二选一，必须挑一个并落地：

- **A. 不再依赖 @mapick/install**：从 `InstallCommands` 类型里**移除** `claude` / `codex`，或者像 §2.2.1 那样改成「Manual install required + 文档链接」。Skill 端 SKILL.md 在 install 失败 fallback 时只引用 openclaw 路径。
- **B. 真正发布 `@mapick/install`**：此时此刻不在本计划范围。如果要做，单开一个 PR / repo，发版前禁止再让线上 API 引用它。

推荐选 A：当前生态里 OpenClaw 是主路径，Claude / Codex 平台对 ClawHub Skill 没有原生导入器，硬塞一个 npm CLI 反而是「为了凑齐三个平台」的产品负担。改造完 `installCommands` 同时缩成 `{ openclaw: string, manual?: string }` 这种「主推 + 兜底」结构会更诚实。

#### 2.2.4 推荐器/搜索层的兜底过滤

在 §2.2.2 ClawHub 答复前，先在调用 `buildInstallCommands` 的三个地方加一道过滤：

```ts
// 推荐 / 搜索结果里：
const cmds = buildInstallCommands({ source, skillId, slug, skillsshId, skillsshUrl });
if (cmds.openclaw.startsWith('#')) {
  // 没有可执行命令 — 不要把这条结果带到用户端
  continue;
}
```

`bundle.service.ts:109` 的 bundle 安装是用户已经"明确选择"的步骤，不能静默丢弃，但要确保 `installCommands` 里至少有一个 `# manual` 注释行 + 跳转文档，让 SKILL.md 渲染层能识别并提示用户去对应页面手动安装。

### 2.3 测试

| 用例 | 期望 |
|------|------|
| ClawHub 来源（有 slug） | `clawhub install <slug>`，本地复制到终端能跑 |
| ClawHub 来源（无 slug，兜底 skillId） | 与上等价，去前缀后 ClawHub 仍能识别 |
| skills.sh 来源 | 走 §2.2.2 选定方案，本地复制到终端能跑或被推荐器过滤掉 |
| 未知 source | `installCommands.openclaw` 是注释行；推荐/搜索不返回此条 |
| `@mapick/install` 引用 | 全仓库 grep 不到 `npx @mapick/install` |

### 2.4 验收

- 选 5 个最近热门 ClawHub skill + 5 个 skills.sh skill，从 `recommend` 拿命令，把 `installCommands.openclaw` 直接复制到终端跑，**全部不能再出现 `Invalid slug` 或 npm 404**。
- 失败用例必须是「ClawHub 真服务异常 / 网络异常」，不再是命令拼接错。

## 3. 问题 2：SKILL.md `bash shell` 与产物不一致（P0）

### 3.1 现状

仓库里 [mapick/scripts/shell](../../mapick/scripts/shell) 是一个 bash wrapper，[mapick/scripts/shell.js](../../mapick/scripts/shell.js) 是真正的 Node 实现。`install.sh` 在 [INSTALL_ITEMS](../../mapick/install.sh#L262) 里把 `scripts` 整目录拷过去，并在 [smoke test](../../mapick/install.sh#L290) 里跑 `bash "${tmp_target}/scripts/shell" id`。所以**走 curl install.sh 路径的安装产物里 `scripts/shell` 是存在的**。

工程师报告的「实际文件是 `scripts/shell.js`，没有 `scripts/shell`」对应的是另一条路径：`clawhub install mapick` 走的是 ClawHub native installer，它从打包的发布产物里抽文件。如果发布产物（GitHub release tarball / ClawHub 索引）里没有 `scripts/shell` 这个 bash wrapper，那 SKILL.md 写的 `bash shell <subcommand>` 在用户机器上就会找不到。

工程师把这条归为「SKILL.md 与实际不匹配」并不冤枉——因为我们对**两条安装路径产物的差异**没有任何校验，SKILL.md 假设了 wrapper 必然存在，但发布产物可能漏掉。

### 3.2 修复

#### 3.2.1 在发布前显式校验 `scripts/shell` 在 release tarball 里

修 [mapick/install.sh:281](../../mapick/install.sh#L281) `REQUIRED_FILES` 已经把 `scripts/shell` 列入了；但**发布前的 GitHub release 检查**没人跑这套校验。需要在 CI / release 脚本里加一步：

```bash
# release 流水线里，从 GitHub release 下载 tarball 后跑：
tar -tzf mapick.tar.gz | grep -E 'scripts/shell$' || {
  echo "release tarball missing scripts/shell wrapper"; exit 1;
}
```

这样一旦未来重构 monorepo 把 wrapper 拆出去，CI 立刻挡。

#### 3.2.2 SKILL.md 显式说明 wrapper 与回退命令

SKILL.md 第 §"Script invocation" 段（[SKILL.md:15](../../mapick/SKILL.md#L15) 附近）改写为：

```markdown
## Script invocation

Mapick ships two equivalent entrypoints under `scripts/`:

- `scripts/shell` — bash wrapper, used in all examples below as `bash shell <subcommand>`.
- `scripts/shell.js` — the actual Node.js implementation; the wrapper just `exec`s it.

If `scripts/shell` is missing (e.g. an older or trimmed install), run
`node scripts/shell.js <subcommand>` instead — the arguments and JSON output
are identical.

Node.js >=22.14 is required (OpenClaw runtime baseline).
```

#### 3.2.3 错误码 `wrapper_missing`

`shell.js` 在 doctor / smoke 路径里检测：如果调用方走的是 `node shell.js doctor`，且 `scripts/shell` 文件不存在，就在 `intent: "doctor"` 输出里追加一条 WARN：

```json
{ "kind": "WARN", "owner": "Mapick", "code": "wrapper_missing",
  "message": "scripts/shell wrapper not found; SKILL.md examples may need 'node scripts/shell.js' instead." }
```

不阻断、只提示。配合 §6 doctor 设计（与 [INSTALLATION_SETUP_PLAN](../install-setup/INSTALLATION_SETUP_PLAN.md) §7.4 / §8.1 对齐）。

#### 3.2.4 不要在 SKILL.md 里硬切到 `node scripts/shell.js`

理由：90% 的安装路径下 wrapper 是存在的，硬切会让 OpenClaw runtime 的 `bash shell` 自动补全/历史命令丢一致性。保留 `bash shell` 作为主示例，把 `node scripts/shell.js` 作为备用，是最低噪声的修法。

### 3.3 验收

- 跑 `bash install.sh` 装一遍：`scripts/shell` 存在且可执行；`bash shell id` 输出包含 `"intent":"id"`。
- 跑 `clawhub install mapick` 装一遍（在 §2.2.2 确认能跑通后）：检查产物是否有 `scripts/shell`；如果没有，CI 应该在发版前已经挡住。
- SKILL.md 渲染层的 example 命令在缺 wrapper 时切到 `node scripts/shell.js`。

## 4. 问题 3：mapick / mapickii 路径冲突（P1）

### 4.1 现状

- `clawhub install mapick` → `~/.openclaw/workspace/skills/mapick`（workspace 级）
- `curl install.sh | bash`（mapickii 仓库）→ `~/.openclaw/skills/mapickii`（managed 级）

`/mapick scan` 和 `/mapickii scan` 在 OpenClaw 里都被识别为 `✓ ready`，用户分不清两个产品的关系。

mapick 与 mapickii 是同一团队的双产品（mapick 是新版，mapickii 是早期 fork / 灰度版本，两者共用大部分协议但有命名歧义）。本仓库就是 mapick；mapickii 在另一个仓库，**本计划不修 mapickii 自己**，只修 mapick 这边的「冲突识别和文案」。

### 4.2 修复

#### 4.2.1 install.sh 多副本扫描（与 [INSTALLATION_SETUP_PLAN](../install-setup/INSTALLATION_SETUP_PLAN.md) §6.5 对齐）

`install.sh` 的 conflict check（[install.sh:177](../../mapick/install.sh#L177)）扩展为扫描所有候选路径：

```bash
SCAN_PATHS=(
  "${HOME}/.openclaw/workspace/skills/mapick"
  "${HOME}/.openclaw/workspace/skills/mapickii"
  "${HOME}/.openclaw/skills/mapick"
  "${HOME}/.openclaw/skills/mapickii"
  "${HOME}/.agents/skills/mapick"
  "${HOME}/.agents/skills/mapickii"
)
# 列出所有命中并标注 active 的那个
```

如果同时检测到 `mapick` 和 `mapickii`，**不阻塞安装**，但在 banner 里提示：

```
[WARN] Both mapick and mapickii are installed:
  - mapick:  ~/.openclaw/workspace/skills/mapick   (this install, active in workspace)
  - mapickii: ~/.openclaw/skills/mapickii          (managed level, older fork)

These are sibling skills sharing protocol. Pick one entrypoint to talk to:
  - /mapick   → recommended (this install)
  - /mapickii → legacy (kept for compatibility)

You can leave both installed; doctor will show which one OpenClaw routes to.
```

#### 4.2.2 SKILL.md 顶部加一段「同名 / 同族说明」

在 [SKILL.md](../../mapick/SKILL.md) 的 frontmatter 之后、`# Mapick` 之前加：

```markdown
> **Sibling skill notice** — `mapickii` is a legacy fork of this skill (same
> protocol, older codebase). If `/mapick` and `/mapickii` are both installed,
> they will both work, but only one will be wired to your OpenClaw session
> by default. Prefer `/mapick`. Run `bash shell doctor` to see which copy is
> active.
```

#### 4.2.3 doctor 输出 active path

doctor 命令（待新增，参考 [INSTALLATION_SETUP_PLAN §8](../install-setup/INSTALLATION_SETUP_PLAN.md#8-doctor-设计)）必须列出：

```
[Mapick] Active skill:    /Users/foo/.openclaw/workspace/skills/mapick
[Mapick] Sibling found:   /Users/foo/.openclaw/skills/mapickii (managed)
[Mapick] Routing:         /mapick → this install; /mapickii → managed copy
```

### 4.3 验收

- `clawhub install mapick` + `curl install.sh`（mapickii）都装上后，再跑 `bash install.sh`（mapick），banner 里出现 sibling 提示。
- doctor 在两者并存时区分 active path，不再让用户猜。

## 5. 问题 4：consent-agree 后 cron 静默失败（P1）

### 5.1 现状

[scripts/shell.js:504](../../mapick/scripts/shell.js#L504) `registerNotifyCron` 失败时返回 `{ registered: false, reason: ... }`，[shell.js:1047](../../mapick/scripts/shell.js#L1047) 把它塞到 `intent: "privacy:consent-agree"` 的响应里。

但 SKILL.md 的 consent-agree 渲染规则（[SKILL.md:179](../../mapick/SKILL.md#L179)）对 `notifyCron` 字段**没有任何提示规则**。AI 收到响应后只会说"consent recorded"，用户不知道每日通知失败了。

### 5.2 修复

#### 5.2.1 SKILL.md 加 `notifyCron` 渲染规则

在 SKILL.md「First-install consent flow」段尾追加：

```markdown
After `consent-agree` returns, inspect `notifyCron`:

- `{ registered: true }` → say nothing extra (cron ready, fires daily 9am).
- `{ registered: false, reason: "openclaw_not_found" }` → tell the user
  "Daily notify is off because OpenClaw CLI isn't on PATH yet. Once it is,
  run `/mapick init` and Mapick will register the cron automatically."
- `{ registered: false, reason: <other> }` → tell the user
  "Consent saved, but the daily notify cron failed to register
  (`<short reason>`). You can retry later with `/mapick init` after fixing
  the cron environment, or skip notifications entirely."
```

不要让用户以为 consent 失败——consent 本身已经成功，只是后续的 cron 注册有问题。

#### 5.2.2 `privacy:status` 显示 cron 状态

`bash shell privacy status` 当前不返回 cron 状态。新增字段：

```json
{
  "intent": "privacy:status",
  "consent": { ... },
  "trustedSkills": [ ... ],
  "redactionEngine": "...",
  "notifyCron": { "registered": true | false, "reason"?: "..." }
}
```

`shell.js` 通过 `openclaw cron list --json | grep mapick-notify` 兜一下；命令不存在或失败就标 `registered: false`，不阻断。

SKILL.md 的 privacy:status 渲染里加一行：

```markdown
- `notifyCron.registered = false` → 末尾追加 "Daily notify is off — run
  `/mapick init` after fixing OpenClaw to retry."
```

#### 5.2.3 `registerNotifyCron` 返回更可读的 reason

[shell.js:521](../../mapick/scripts/shell.js#L521) 现在返回的 `reason` 是 `Command failed: openclaw cron add ...`（execSync 抛出来的字符串）。改成把 stderr 截断到 200 字符 + 一个固定的错误码：

```js
return {
  registered: false,
  reason: classifyCronError(err),       // openclaw_not_found / cron_add_failed / cron_invalid_args / cron_timeout
  detail: (err.stderr || err.message || '').toString().slice(0, 200),
};
```

`reason` 给 SKILL.md 渲染分支用，`detail` 给 doctor 用。

### 5.3 验收

- 把 `openclaw` 临时从 PATH 拿掉，跑 `consent-agree 1.0`：响应里 `notifyCron.registered = false, reason = openclaw_not_found`，AI 渲染把这条提示给用户。
- `privacy status` 里能看到 cron 当前是否注册。
- 把 `openclaw` 加回 PATH 后跑 `init`，cron 被重新注册。

## 6. 问题 5：排查清单（含 ACP/agentId 误导）（P2）

### 6.1 现状

工程师报告里的排查清单 5 条目前没有任何文档承载。两条尤其重要：

- 第 4 条：「不要用 `sessions_spawn runtime=acp agentId=mapick`，mapick 是普通 skill 不是 ACP agent」
- 第 5 条：「`openclaw.json` 中的 `acp.agentId` 不是合法字段，会导致 Config invalid」

这两条与 [INSTALLATION_SETUP_PLAN §7.3](../install-setup/INSTALLATION_SETUP_PLAN.md#73-acpgateway-首次使用引导)「不要把 `acp.defaultAgent` 默认写成 `mapick`」是同一类问题——用户/AI 在搜「pairing required」「Config invalid」时**很容易找到把 `mapick` 当 ACP agent 的错误修法**，本计划必须在 mapick 这一侧的文档里反向声明。

### 6.2 修复

#### 6.2.1 新增 `mapick/reference/troubleshooting.md`

按错误现象组织，每条带「现象 / 根因 / 正确修法 / 错误修法」四段。骨架：

```markdown
# Mapick troubleshooting

## A. Install errors

### A1. clawhub install mapick → "Invalid slug"
- Symptom: ClawHub CLI rejects the slug, often because the recommend feed
  returned a `skillssh:` prefix.
- Root cause: backend `buildInstallCommands` was generating commands without
  separating ClawHub vs skills.sh sources. Fixed in mapick-api ≥ <release>.
- Correct fix: upgrade mapick-api; recommend feed will only return commands
  that match the user's installed CLI.
- Wrong fix: stripping `skillssh:` by hand — works only for ClawHub CLI
  versions that accept three-segment slugs as raw paths.

### A2. npx @mapick/install … → 404
- Symptom: npm cannot find @mapick/install.
- Root cause: package was never published; commands were generated speculatively.
- Correct fix: use the openclaw command instead, or follow the manual install
  link from the recommend output.
- Wrong fix: publishing a placeholder @mapick/install package on personal
  accounts to make the URL resolve.

### A3. scripts/shell not found
- Symptom: `bash shell <cmd>` errors with "no such file or directory".
- Root cause: install medium dropped the bash wrapper.
- Correct fix: run `node scripts/shell.js <cmd>` — same arguments, same JSON.
  Reinstall via `bash install.sh` to restore the wrapper.
- Wrong fix: writing your own wrapper that forwards args differently from
  the upstream one (it pre-checks Node availability and exits with the
  documented JSON error envelope).

## B. Runtime errors (OpenClaw side)

### B1. "pairing required" / Gateway closed (1008)
- Root cause: OpenClaw Gateway needs the device or node approved.
- Correct fix: `openclaw devices list` → `openclaw devices approve <id>`,
  or the equivalent `openclaw nodes ...` flow on older versions.
- Wrong fix (DO NOT DO):
  - `sessions_spawn runtime=acp agentId=mapick` — `mapick` is a Skill, not
    an ACP agent. This will not "force pairing" and may pollute session state.
  - Setting `acp.defaultAgent = mapick` in openclaw.json — same reason.

### B2. "Config invalid: acp.agentId is not a recognized field"
- Root cause: `acp.agentId` is not in the OpenClaw config schema. `acp.defaultAgent`
  is — and even that takes an ACP harness agent id (codex / claude / gemini),
  not a Skill slug.
- Correct fix: remove `acp.agentId` entirely. If you need to point ACP
  somewhere, run `/acp doctor` first to see valid agent ids.
- Wrong fix: replacing `acp.agentId` with `acp.skillId` or `acp.target` —
  none of those are valid either.

## C. Privacy / consent

### C1. consent-agree returns notifyCron.registered = false
- See SKILL.md §"First-install consent flow" — consent itself succeeded;
  only the daily-notify cron failed to register.

```

#### 6.2.2 SKILL.md error-handling 表追加引用

在 [SKILL.md §"Error handling"](../../mapick/SKILL.md#L898) 末尾加一段：

```markdown
For install / runtime errors not covered above (Invalid slug, npm 404 on
@mapick/install, pairing required, "acp.agentId" config errors), see
[reference/troubleshooting.md](reference/troubleshooting.md).
```

#### 6.2.3 在 install.sh banner 里反向声明一次

[install.sh:348](../../mapick/install.sh#L348) `Next:` 段后面加一行 anti-guidance：

```bash
echo -e "  ${DIM}Note: Mapick is an OpenClaw Skill, not an ACP agent. If you${NC}"
echo -e "  ${DIM}see 'pairing required', run 'openclaw devices list/approve';${NC}"
echo -e "  ${DIM}don't set acp.defaultAgent = mapick or sessions_spawn agentId=mapick.${NC}"
```

仅 3 行，价值在于把高搜索热度的错误修法 **在权威输出里反向声明**。

### 6.3 验收

- `mapick/reference/troubleshooting.md` 落地，至少覆盖原始报告 5 条排查项 + ACP/agentId 反向声明。
- 跑 `bash install.sh`，结尾出现 ACP 反向声明三行。
- 跑 `bash shell help`（如果有 help intent）或在 SKILL.md error 章节出现指向 troubleshooting.md 的链接。

## 7. 问题 6：ClawHub 页 Crypto / wallet / sensitive credentials 误标（P1）

### 7.1 现状

ClawHub Mapick 页上半部 Capability Signals 当前展示三条与 Mapick 实际行为不符的高风险标签：

- **Crypto** — ClawHub 静态扫描器看到 `shell.js` 里有 hash 计算（`device_fp` 用 sha256 摘要），把 *crypto hash* 误判成 *cryptocurrency*。代码里出现 `token`、`key`、`secret` 等字眼也会触发同类归类。
- **Requires wallet** — 同上，crypto 类标签的副作用，扫描器自动把"涉及加密"等价为"需要钱包"。
- **Requires sensitive credentials** — `shell.js` 读 `API_KEY` / `API_SECRET` 环境变量并在请求 header 里带 `x-device-fp`，扫描器把这些归类为"需要敏感凭证"。

叠加上 `child_process`、`curl 调外部 API`、`file_read + network` 三条**真实存在且不可消**的行为，ClawHub Security 顶部直接综合成 **Suspicious**，VirusTotal 同步标 Suspicious。

对照参考——[find-skills-skill](https://clawhub.ai/fangkelvin/find-skills-skill) 是 instruction-only skill（只有 SKILL.md，无脚本），扫描结果是 Benign。Mapick 是 code-bundled skill，结构上必然触发部分静态扫描信号；目标不是"装成 Benign"，而是把可消的消干净、把不可消的有据可查。

这条与 [INSTALLATION_SETUP_PLAN §11.3](../install-setup/INSTALLATION_SETUP_PLAN.md#113-扫描信号分档与发布策略) 是同一组信号；本计划把"绿档 5 分钟发版"独立成一个 P1 改动单独跟踪，因为它是**唯一一档不需要 ClawHub 团队介入、纯发版即生效**的修法，工程师容易遗漏到下一次发版才一并处理。

### 7.2 修复

#### 7.2.1 绿档：删错误 metadata，立刻发版

[mapick/SKILL.md](../../mapick/SKILL.md) frontmatter 里 / ClawHub 发布元数据里如果存在以下声明，**全部删除并发版**：

| 错误声明 | 删除理由 |
|----------|----------|
| `metadata.openclaw.capabilities` 含 `crypto` | Mapick 不涉及加密货币；hash 函数与 cryptocurrency 无关 |
| `metadata.openclaw.capabilities` 含 `wallet` / `requires_wallet` | Mapick 没有钱包概念 |
| `metadata.openclaw.needs` 含 `sensitive_credentials` | 后端固定配置（API_KEY / API_SECRET 是后端 sync 任务用的，不是用户侧输入），用户侧无凭证输入 |
| `requires.bins` 含 `jq` | shell.js 不调用 jq，[VERSION.md v0.0.7 已记录修正](../../mapick/VERSION.md#L13)，需要再 grep 确认全仓库一致 |

发版动作：

1. 在 mapick 仓库改 SKILL.md frontmatter，跑 `git diff` 确认只删了上述 metadata，没有动渲染内容。
2. 同步 ClawHub 控制台里 Mapick skill 页的 metadata（如果 ClawHub 不是从 SKILL.md 自动读取，则两边都要改）。
3. 发一个 patch 版本（例：v0.0.8），VERSION.md 写 changelog："Removed mis-classified capability signals (`crypto` / `wallet` / `sensitive_credentials`); these were never accurate."
4. 等 ClawHub 重新扫描（一般 5–30 分钟），确认页面 Capability Signals 不再显示这三条。

预期效果：Crypto 和 Requires wallet 标签**立即消失**；Suspicious 综合等级**不一定立刻翻 Benign**（红档信号还在），但 Capability Signals 错挂导致的"明显不可信"信号被消除，页面整体可信度上升。

#### 7.2.2 黄档：行为可缓解，需要代码 + 文档配合

延续 [INSTALLATION_SETUP_PLAN §11.3 黄档](../install-setup/INSTALLATION_SETUP_PLAN.md#113-扫描信号分档与发布策略)，本计划只补一条：

| 信号 | 缓解 |
|------|------|
| `x-device-fp` 设备指纹 / `API_KEY` / `API_SECRET` 三条联合触发 sensitive credentials | consent 完成前不发 `x-device-fp` header；用户侧从来不传 API_KEY，后端 sync 任务才用——在 [mapick/reference/](../../mapick/reference/) 下加一份 `auth-model.md` 区分"用户侧 (DeviceFp only)"和"后端 sync (ApiKey)"两条 auth 路径，让 ClawHub 人工审查 / 用户阅读时一眼区分 |

#### 7.2.3 红档：消不掉，走 verified-publisher

`child_process`（[scripts/shell.js:171](../../mapick/scripts/shell.js#L171) 附近）、`env access + network send`、`file_read + network send` 三条是 Mapick 核心功能必须用的，扫描器一定会标。出路：

1. **ClawHub verified-publisher 流程**：申请将 Mapick 标为 verified author / publisher，让 ClawHub 给 Mapick 加信任标记，标签从 Suspicious 翻成 "Verified, declared behavior: code execution, network, file read"。
2. **页面文案路径**：在 ClawHub skill 描述、README、SKILL.md 里**主动声明**这三条行为及其目的（推荐扫描需要读 skills 目录、后端调用需要会话上下文、shell 入口承接 OpenClaw runtime 调用），让 OpenClaw Analysis 输出 "behavior matches stated purpose"。

verified-publisher 流程取决于 ClawHub 当前政策，需要单独沟通；本计划只承诺「绿档立刻消、黄档同步发布」，红档由 [INSTALLATION_SETUP_PLAN §11.3](../install-setup/INSTALLATION_SETUP_PLAN.md#113-扫描信号分档与发布策略) 持续跟进。

### 7.3 验收

- ClawHub Mapick 页 Capability Signals 区域**不再显示** `Crypto`、`Requires wallet`、`Requires sensitive credentials` 三条。
- VERSION.md 该次发版条目里写明了"删除了三条 mis-classified capability signals"。
- `mapick/reference/auth-model.md` 落地，明确区分用户侧 DeviceFp auth 与后端 sync ApiKey auth。
- 红档行为在 SKILL.md / README 里有主动声明（可与 §6.2.1 troubleshooting 同发）。

## 8. 实施顺序

按依赖关系切成三批，控制每批 PR 范围。

### Phase A：止血（同窗口部署）

| # | 改动 | 仓库 |
|---|------|------|
| A1 | `buildInstallCommands` 重构（§2.2.1） | api/mapick-shared |
| A2 | 三处调用点改签名（§2.1） | api/mapick-api |
| A3 | 推荐器/搜索层兜底过滤无效命令（§2.2.4） | api/mapick-api |
| A4 | `@mapick/install` 引用从 InstallCommands 类型剔除（§2.2.3 选 A） | api/mapick-shared + api/mapick-api |
| A5 | release CI 校验 `scripts/shell` 在 tarball 内（§3.2.1） | mapick |

A1–A4 是一个 PR，A5 是另一个 PR，**两者必须一起部署**——否则后端给的 openclaw 命令依然假设 wrapper 存在，但 release 没校验。

### Phase B：用户可感知的修复

| # | 改动 | 仓库 |
|---|------|------|
| B1 | SKILL.md `Script invocation` 段重写（§3.2.2） | mapick |
| B2 | `notifyCron` 渲染规则 + privacy status cron 字段（§5.2.1, §5.2.2） | mapick |
| B3 | `registerNotifyCron` 错误码归类（§5.2.3） | mapick |
| B4 | install.sh sibling 检测 + banner（§4.2.1） | mapick |
| B5 | SKILL.md sibling notice（§4.2.2） | mapick |
| B6 | 绿档：SKILL.md / ClawHub metadata 删除 `crypto` / `wallet` / `sensitive_credentials` 三条声明并发 patch 版本（§7.2.1） | mapick |
| B7 | 黄档：`reference/auth-model.md` 区分用户侧 vs 后端 sync 的 auth 路径（§7.2.2） | mapick |

### Phase C：长期收敛

| # | 改动 | 仓库 |
|---|------|------|
| C1 | `bash shell doctor` 实现（与 [INSTALLATION_SETUP_PLAN §7.4 / §8](../install-setup/INSTALLATION_SETUP_PLAN.md#74-新增命令建议) 一起做） | mapick |
| C2 | doctor 输出 wrapper_missing / sibling / cron 状态（§3.2.3, §4.2.3） | mapick |
| C3 | `reference/troubleshooting.md`（§6.2.1） | mapick |
| C4 | install.sh ACP 反向声明（§6.2.3） | mapick |
| C5 | SKILL.md error handling 链接（§6.2.2） | mapick |

C1 和 [INSTALLATION_SETUP_PLAN](../install-setup/INSTALLATION_SETUP_PLAN.md) 的 doctor Phase 3 合并实现，不要重复造。

## 9. 最小可交付版本（M0）

如果只能挑 6 个改动先发，优先级如下：

| # | 改动 | 理由 |
|---|------|------|
| M0-1 | `buildInstallCommands` 按 source 分支生成命令（§2.2.1） | 否则推荐核心功能 0/N 跑通 |
| M0-2 | 推荐/搜索层过滤无效命令（§2.2.4） | 修 §2.2.1 之前的兜底 |
| M0-3 | `@mapick/install` 引用全部移除（§2.2.3 选 A） | 修复 npm 404，避免诚实性问题 |
| M0-4 | SKILL.md `bash shell` / `node scripts/shell.js` 等价说明（§3.2.2） | 让缺 wrapper 的安装产物里用户能继续用 |
| M0-5 | consent-agree 渲染规则识别 `notifyCron.registered = false`（§5.2.1） | 不再让 cron 失败静默 |
| M0-6 | 绿档：SKILL.md / ClawHub metadata 删除 `crypto` / `wallet` / `sensitive_credentials` 并 patch 发版（§7.2.1） | ClawHub 页 Suspicious 标签里至少一半（绿档）能 5 分钟消掉，新用户在装之前不会先被劝退 |

M0 不要求 doctor 落地，也不要求 troubleshooting.md 完整。但 §2.2.4 兜底必须在 M0 里——否则 §2.2.2 ClawHub 答复期间，线上推荐还在持续输出 0% 可执行命令。M0-6 与其他几条并行做，不阻塞 PR 合并：metadata 改动只动 SKILL.md frontmatter / ClawHub 控制台，几行 diff 就能发版。

## 10. 风险与回滚

| 风险 | 缓解 |
|------|------|
| `buildInstallCommands` 改签名后调用方漏改 | Phase A 把签名改成 `buildInstallCommands(skill: SkillInstallSource)`，类型层面阻挡漏改；编译失败即暴露 |
| ClawHub CLI 不支持 `--source skillssh` | 推荐器层过滤兜底（§2.2.4），不会发出无效命令；先收紧、不发布、再扩展 |
| 移除 `@mapick/install` 影响线上某个不应存在的依赖方 | 全仓库 grep 确认无人消费；mapickii 仓库另行通知 |
| `notifyCron` 字段添加后，老 SKILL.md 渲染层不识别 → 多输出一段 cron 文案 | 字段是新增，老渲染层会忽略；新增渲染规则只在 `false` 分支输出，silence-first |
| sibling 检测扫错路径，触发误报 | `SCAN_PATHS` 写死为已知 OpenClaw 路径；命中数 > 1 才报警 |
| 删 metadata 后 ClawHub 反向校验失败（例如 ClawHub 强制要求声明所有触发的扫描标签） | 发版前用 `clawhub validate` / 等价命令本地检查；保留绿档 metadata diff 在一个独立 commit，回滚成本最低 |

## 11. 验收门槛（合入前必跑）

```text
□ /mapick recommend → 至少 3 条结果，installCommands.openclaw 全部能在终端执行
□ /mapick search <kw> → 同上
□ /mapick bundle install <id> → installCommands 数组每条都能跑
□ npm registry 不再有人调 @mapick/install
□ bash shell privacy consent-agree 1.0 → AI 在 cron 失败时给用户提示
□ install.sh 检测到 mapickii 已存在时打印 sibling 警告
□ release tarball 必含 scripts/shell（CI 校验通过）
□ SKILL.md / reference/troubleshooting.md 反向声明：mapick 不是 ACP agent
□ ClawHub Mapick 页 Capability Signals 不再显示 Crypto / Requires wallet / Requires sensitive credentials
□ VERSION.md 该次发版条目记录绿档 metadata 删除
```

10 条全过才能合入。

## 12. 外部参考

- [INSTALLATION_SETUP_PLAN.md](../install-setup/INSTALLATION_SETUP_PLAN.md)：doctor 设计与错误码继承自此计划，本计划不重复其内容。
- [api/mapick-shared/src/install-commands.ts](../../api/mapick-shared/src/install-commands.ts)：本计划 §2 的核心改造对象。
- [api/mapick-shared/src/entities/skill/skill.entity.ts](../../api/mapick-shared/src/entities/skill/skill.entity.ts)：`source / slug / skillsshId / skillsshUrl` 字段定义。
- [mapick/scripts/shell.js](../../mapick/scripts/shell.js)：`registerNotifyCron`、consent flow、init flow 的实现入口。
- [mapick/install.sh](../../mapick/install.sh)：sibling 检测、smoke test、banner 改造的落点。
- [mapick/SKILL.md](../../mapick/SKILL.md)：渲染规则改造的落点。
