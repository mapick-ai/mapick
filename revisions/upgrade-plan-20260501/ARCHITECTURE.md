# Mapick Phase 1 升级 — 技术架构方案

**版本**：2026-05-01  
**范围**：Phase 1 客户端改动（G1/G2/G3），复用后端现有端点  
**前置**：`revisions/timeline-and-gap-analysis-20260501/`

---

## 1. 模块变更图

### 1.1 总览

| 模块 | 改动类型 | 变更内容 |
|------|----------|----------|
| `scripts/lib/skills.js` | **改动** | 启用 `registerNotifyCron`，`handleInit` 增加 notify 自动触发逻辑 |
| `scripts/lib/updates.js` | **改动** | `handleNotifyPlan` 增加 delivery route 验证步骤 |
| `scripts/lib/privacy.js` | **改动** | `handleNetworkConsent` consent 同步后自动触发 `notify:plan` |
| `scripts/lib/misc.js` | **改动** | 新增 `resolveSlug` helper，`handleBundle` 应用统一 slug 解析 |
| `scripts/lib/core.js` | **改动** | 新增 `resolveCanonicalSlug` 函数，统一 slug 解析逻辑 |
| `install.sh` | **改动** | 增加 3 步验证 + `verify` JSON event |
| `SKILL.md` | **改动** | §1 Install command rule 补充实现说明 |
| `scripts/lib/recommend.js` | **不改** | 调用 `core.resolveCanonicalSlug`，无需直接改动 |
| `scripts/lib/http.js` | **不改** | 无需改动 |
| `scripts/lib/clean.js` | **不改** | 无需改动 |
| `scripts/lib/security.js` | **不改** | 无需改动 |
| `scripts/lib/doctor.js` | **不改** | 无需改动 |
| `scripts/lib/radar.js` | **不改** | 无需改动 |

### 1.2 改动文件详细

#### `scripts/lib/skills.js`

```javascript
// 当前实现（line 95-97）
function registerNotifyCron() {
  return { registered: false, reason: "cron_registration_disabled_in_scan_safe_build" };
}

// Phase 1 改动：恢复实际注册逻辑
function registerNotifyCron() {
  // 注意：此处不直接执行 openclaw 命令
  // 返回 plan JSON，由 AI 执行（遵循 zero-subprocess 原则）
  return {
    registered: false,  // 实际注册由 notify:plan 完成
    needs_setup: true,
    plan_command: "node scripts/shell.js notify:plan",
    hint: "Cron registration requires user confirmation. Run notify:plan to see the setup plan.",
  };
}

// handleInit 改动（line 206-270）
async function handleInit(_args, ctx) {
  // ... existing logic ...
  
  // 新增：首次安装后自动触发 notify:plan 提示
  if (ctx.config.network_consent === "always" && !ctx.config.last_notify_at) {
    return {
      ...existingStatusResponse,
      suggest_notify_setup: true,
      notify_hint: "Daily reminders not set up. Reply 'set up daily reminders' to enable.",
    };
  }
  
  // ... rest of function ...
}
```

#### `scripts/lib/updates.js`

```javascript
// handleNotifyPlan 改动（line 225-259）
function handleNotifyPlan() {
  const plan = {
    intent: "notify_setup:plan",
    target: "mapick-notify",
    purpose: "Daily 9am check for version updates + zombie skills",
    commands: [
      // ... existing commands (RM_BY_ID_INSTRUCTION, cron add) ...
    ],
    what_it_does: "...",
    what_it_doesnt: "...",
    stops: "...",
    after_success_track: "node scripts/shell.js notify:track setup_complete",
    
    // 新增：delivery 验证步骤
    verification: {
      steps: [
        {
          step: 3,
          kind: "instruction",
          instruction: "Run `openclaw cron list --json`. Find the mapick-notify entry. Check its deliveryPreviews field. If it contains 'no route', 'fail-closed', or empty route, the cron will fire but notifications won't reach you.",
          optional: false,
        },
        {
          step: 4,
          kind: "instruction",
          instruction: "Run `openclaw chat list --json` (or equivalent). Confirm at least one chat route is registered. If no route exists, the cron will silently fail-close.",
          optional: false,
        },
      ],
      success_condition: "deliveryPreviews shows valid route AND at least one chat route exists",
      failure_message: "Cron scheduled, but no delivery route configured. Notifications will silently drop. Set up a route first.",
      must_not_claim_success_until_delivery_valid: true,
    },
  };
  
  return plan;
}
```

#### `scripts/lib/privacy.js`

```javascript
// handleNetworkConsent 改动（line 48-72）
async function handleNetworkConsent(args) {
  const choice = args[0];
  if (!["always", "once", "declined"].includes(choice)) {
    return { error: "invalid_choice", valid: ["always", "once", "declined"] };
  }
  
  writeConfig("network_consent", choice);
  writeConfig("network_consent_at", isoNow());
  
  if (choice === "declined") {
    return { ...existingDeclineResponse };
  }
  
  // 新增：consent 同步后，若用户选择 always，触发 notify:plan 建议
  const result = {
    intent: "network_consent",
    choice,
    hint: choice === "once" ? "..." : "...",
    retry_original_command: true,
  };
  
  // 仅当用户选择 always 且从未设置 notify 时，建议设置
  if (choice === "always") {
    const config = readConfig();
    if (!config.last_notify_at) {
      result.suggest_notify_setup = true;
      result.notify_hint = "Daily reminders can help you stay updated. Reply 'set up daily reminders' to enable.";
    }
  }
  
  return result;
}
```

#### `scripts/lib/core.js`

```javascript
// 新增：统一 slug 解析逻辑
function resolveCanonicalSlug(skillId, installCommands = []) {
  // 优先级 1: 直接使用 skillId（如果是干净的短名）
  if (skillId && /^[a-zA-Z0-9_-]{1,64}$/.test(skillId) && !skillId.includes("/")) {
    return skillId;
  }
  
  // 优先级 2: 从 skillssh:org/repo/skill 格式提取最后一段
  const skillsshMatch = skillId?.match(/skillssh:[^/]+\/[^/]+\/([^/]+)/);
  if (skillsshMatch) {
    return skillsshMatch[1];
  }
  
  // 优先级 3: 从 installCommands[].command 提取
  for (const cmd of installCommands) {
    const command = cmd?.command || "";
    // 匹配 openclaw skills install <slug>
    const installMatch = command.match(/openclaw skills install ([a-zA-Z0-9_-]+)/);
    if (installMatch) {
      return installMatch[1];
    }
    // 匹配 clawhub install skillssh:org/repo/skill → 提取最后段
    const clawhubMatch = command.match(/clawhub install skillssh:[^/]+\/[^/]+\/([^/]+)/);
    if (clawhubMatch) {
      return clawhubMatch[1];
    }
    // 匹配 clawhub install <slug>（直接短名）
    const clawhubShortMatch = command.match(/clawhub install ([a-zA-Z0-9_-]+)$/);
    if (clawhubShortMatch) {
      return clawhubShortMatch[1];
    }
  }
  
  // 优先级 4: 从 org/repo/skill 格式提取最后一段
  if (skillId) {
    const parts = skillId.split("/");
    const lastPart = parts[parts.length - 1];
    if (lastPart && /^[a-zA-Z0-9_-]+$/.test(lastPart)) {
      return lastPart;
    }
  }
  
  // 失败：无法解析，返回原始值并标记警告
  return {
    raw: skillId,
    warning: "Could not resolve canonical slug. Using raw identifier.",
  };
}

module.exports = {
  // ... existing exports ...
  resolveCanonicalSlug,
};
```

#### `scripts/lib/misc.js`

```javascript
// handleBundle 改动（line 86-119）
async function handleBundle(args, ctx) {
  const sub = args[0];
  
  // ... existing cases ...
  
  if (sub === "install") {
    if (!args[1]) return missingArg("Usage: bundle install <bundleId>");
    const r = await apiCall("GET", `/bundle/${args[1]}/install`, null, "bundle:install");
    r.bundleId = args[1];
    
    // 新增：解析 installCommands 中的 slug
    if (r.installCommands && Array.isArray(r.installCommands)) {
      r.resolved_install_commands = r.installCommands.map((cmd) => {
        const slug = resolveCanonicalSlug(null, [cmd]);
        return {
          ...cmd,
          resolved_slug: slug,
          display_command: `openclaw skills install ${typeof slug === "string" ? slug : slug.raw}`,
          warning: typeof slug === "object" ? slug.warning : null,
        };
      });
    }
    
    return r;
  }
  
  // ... rest of function ...
}
```

#### `install.sh`

```bash
# 新增：安装后验证步骤（在 line 480 之后）

# -- Post-install verification ------------------------------------------

if [[ "${JSON_MODE}" == "1" ]]; then
  # JSON mode: emit verify events
  json_event verify step="file_integrity" status="checking"
fi

# Step 1: 文件完整性检查
verify_files=(SKILL.md scripts/shell.js scripts/redact.js)
verify_ok=true
for f in "${verify_files[@]}"; do
  if [[ ! -f "${target_dir}/${f}" ]]; then
    verify_ok=false
    if [[ "${JSON_MODE}" != "1" ]]; then
      error "Missing required file: ${f}"
    fi
  fi
done

if [[ "${JSON_MODE}" == "1" ]]; then
  json_event verify step="file_integrity" status="${verify_ok}"
fi

if [[ "${verify_ok}" != "true" ]]; then
  rollback
  error "File integrity check failed — rolled back."
fi

# Step 2: init 扫描（仅非 JSON mode）
if [[ "${JSON_MODE}" != "1" ]]; then
  info "Running init scan..."
  init_output=$(node "${target_dir}/scripts/shell.js" init 2>&1) || true
  if echo "${init_output}" | grep -q "error"; then
    warn "Init scan reported an error (non-fatal): ${init_output}"
  else
    ok "Init scan complete"
  fi
fi

if [[ "${JSON_MODE}" == "1" ]]; then
  json_event verify step="init_scan" status="skipped_in_json_mode"
fi

# Step 3: 环境检测（Node + OpenClaw）
if [[ "${JSON_MODE}" == "1" ]]; then
  json_event verify step="environment" node_version="${NODE_VER}" openclaw_path="${OPENCLAW_PATH}"
fi

# 重新检测 workspace shadow（安装后状态）
workspace_shadow_active=0
if [[ -f "${workspace_skill_dir}/SKILL.md" ]] \
   && grep -Eq '^name:[[:space:]]*mapick[[:space:]]*$' "${workspace_skill_dir}/SKILL.md"; then
  workspace_shadow_active=1
fi

if [[ "${JSON_MODE}" == "1" ]]; then
  json_event verify step="workspace_shadow" status="${workspace_shadow_active}"
fi

# 更新最终 done event
json_event done state="${CONFLICT_STATE}" version="${VERSION}" target="${target_dir}" \
  shadow_remaining="${shadow_remaining}" verified="${verify_ok}" \
  workspace_shadow_active="${workspace_shadow_active}"
```

#### `SKILL.md`

```markdown
# §1 Install command rule — 实现说明

## 统一 slug 解析逻辑

所有 recommendation / bundle install 返回的安装命令，均经过 `resolveCanonicalSlug()` 函数处理：

### 解析优先级

1. **直接短名**：`code-review` → `code-review`
2. **skillssh 格式**：`skillssh:soultrace-ai/soultrace-skill/soultrace` → `soultrace`
3. **installCommands 提取**：从 `openclaw skills install <slug>` 或 `clawhub install ...` 提取
4. **org/repo/skill 格式**：`soultrace-ai/soultrace-skill/soultrace` → `soultrace`

### 失败处理

当无法解析时，返回 `{ raw, warning }` 对象，AI 应：
- 渲染警告信息
- 尝试使用 raw 值安装
- 若安装失败，提示用户检查 skill 名称

### 实现位置

- `scripts/lib/core.js` — `resolveCanonicalSlug()` 函数
- `scripts/lib/misc.js` — `handleBundle` 应用解析
- 推荐渲染（AI）— 使用解析后的 `resolved_slug`

## AI 渲染规则

始终渲染：`openclaw skills install <resolved_slug>`

禁止渲染/执行：
- 原始 `installCommands[].command`
- `skillssh:` 前缀
- `npx @mapick/install`
- `clawhub install skillssh:...`
```

---

## 2. 数据流：Notify 从注册到投递

### 2.1 完整链路图

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Phase 1 Notify System Flow                        │
└─────────────────────────────────────────────────────────────────────┘

 ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
 │  Trigger 1   │    │  Trigger 2   │    │  Trigger 3   │
 │              │    │              │    │              │
 │ handleInit   │    │ consent-agree│    │ update:check │
 │ (首次安装)   │    │ (用户同意)   │    │ (检测缺失)   │
 └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
        │                   │                   │
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                            ▼
                   ┌────────────────┐
                   │  notify:plan   │
                   │                │
                   │ 返回安装计划   │
                   │ (commands[])   │
                   └──────┬─────────┘
                          │
                          │  AI 渲染并请求用户确认
                          │
                          ▼
         ┌────────────────────────────────────┐
         │         User Confirmation         │
         │                                    │
         │  "Reply '确认' to proceed"        │
         └────────────┬───────────────────────┘
                      │
                      ▼
         ┌────────────────────────────────────┐
         │      AI Executes Commands          │
         │                                    │
         │  Step 1: openclaw cron list --json │
         │          → find mapick-notify      │
         │          → openclaw cron rm <id>   │
         │                                    │
         │  Step 2: openclaw cron add         │
         │          --name mapick-notify      │
         │          --cron "0 9 * * *"        │
         │          --message "Run /mapick notify"
         │                                    │
         │  Step 3: openclaw cron list --json │
         │          → check deliveryPreviews  │
         │                                    │
         │  Step 4: openclaw chat list --json │
         │          → confirm route exists    │
         └────────────┬───────────────────────┘
                      │
                      ▼
         ┌────────────────────────────────────┐
         │   Verification Result              │
         │                                    │
         │  ┌──────────────────────────────┐  │
         │  │ Delivery Valid               │  │
         │  │                              │  │
         │  │ → notify:track setup_complete│  │
         │  │ → writeConfig last_notify_at │  │
         │  │ → "All set!"                 │  │
         │  └──────────────────────────────┘  │
         │                                    │
         │  ┌──────────────────────────────┐  │
         │  │ Delivery Invalid             │  │
         │  │                              │  │
         │  │ → "⚠️ Cron scheduled, but    │  │
         │  │    no delivery route. Set up │  │
         │  │    a route first."           │  │
         │  │ → DO NOT claim success       │  │
         │  └──────────────────────────────┘  │
         └────────────────────────────────────┘

 ┌─────────────────────────────────────────────────────────────────────┐
 │                      Daily Execution (Cron Fire)                     │
 └─────────────────────────────────────────────────────────────────────┘

         ┌────────────┐
         │   Cron     │
         │   Fire     │
         │ (9am daily)│
         └─────┬──────┘
               │
               ▼
         ┌────────────┐
         │  OpenClaw  │
         │  Gateway   │
         │            │
         │ Sends msg: │
         │ "/mapick   │
         │  notify"   │
         └─────┬──────┘
               │
               ▼
         ┌────────────────────────────────────┐
         │       AI Receives Message          │
         │                                    │
         │  node scripts/shell.js notify      │
         └────────────┬───────────────────────┘
                      │
                      ▼
         ┌────────────────────────────────────┐
         │   GET /notify/daily-check          │
         │                                    │
         │   Query params:                    │
         │   - currentVersion=v0.0.15         │
         │   - repo=mapick-ai/mapick          │
         │   - compact=1                      │
         │   - limit=10                       │
         └────────────┬───────────────────────┘
                      │
                      ▼
         ┌────────────────────────────────────┐
         │   Backend Response                 │
         │                                    │
         │   {                                │
         │     alerts: [                      │
         │       { type: "version",           │
         │         latest: "v0.0.17" },       │
         │       { type: "zombie",            │
         │         skillId: "old-tool" }      │
         │     ],                             │
         │     recommendations: [...]         │
         │   }                                │
         └────────────┬───────────────────────┘
                      │
                      ▼
         ┌────────────────────────────────────┐
         │   AI Renders to User               │
         │                                    │
         │   ┌──────────────────────────────┐ │
         │   │ alerts: [] (Silence-first)   │ │
         │   │                              │ │
         │   │ → "没有新通知 ✅"            │ │
         │   │ → Show 2 recommendations     │ │
         │   └──────────────────────────────┘ │
         │                                    │
         │   ┌──────────────────────────────┐ │
         │   │ alerts: non-empty            │ │
         │   │                              │ │
         │   │ → Version update first       │ │
         │   │ → Zombie skills second       │ │
         │   │ → ≤6 lines, friendly tone    │ │
         │   └──────────────────────────────┘ │
         └────────────────────────────────────┘

 ┌─────────────────────────────────────────────────────────────────────┐
 │                         Liveness Tracking                            │
 └─────────────────────────────────────────────────────────────────────┘

         handleNotify → writeConfig("last_notify_at", isoNow())
         
         update:check → reads last_notify_at
                     → if stale > 7 days → suggest notify:plan
```

### 2.2 关键节点说明

| 节点 | 数据内容 | 错误处理 |
|------|----------|----------|
| `notify:plan` | `{ intent, commands[], verification }` | 无网络调用，纯本地返回 plan |
| `cron add` | `openclaw cron add ...` | 失败 → AI 捕获 stderr，终止流程 |
| `cron list` | `{ jobs: [{ id, name, deliveryPreviews }] }` | 解析失败 → 降级：仅检查 name 存在 |
| `chat list` | `{ routes: [{ type, target }] }` | 空数组 → delivery 验证失败 |
| `notify` (daily) | `GET /notify/daily-check` | 网络错误 → `alerts: []`，silence-first |
| `notify:track` | `POST /events/track` + 本地 `writeConfig` | 网络失败 → 仅写本地状态 |

---

## 3. 接口规范：install.sh JSON Event Schema

### 3.1 Event Types

| Event | 发送时机 | Schema |
|-------|----------|---------|
| `start` | 脚本开始 | `{ event: "start", version, repo, dry_run }` |
| `preflight` | 冲突检测完成 | `{ event: "preflight", state, current_version, target_version }` |
| `download` | 开始下载 | `{ event: "download", url }` |
| `stage` | 开始 staging | `{ event: "stage", path }` |
| `backup` | 开始备份 | `{ event: "backup", from, to }` |
| `swap` | 开始 atomic swap | `{ event: "swap", target }` |
| `rollback` | 安装失败回滚 | `{ event: "rollback", from, to }` |
| `verify` **新增** | 验证步骤 | `{ event: "verify", step, status, ...fields }` |
| `done` | 安装完成 | `{ event: "done", state, version, target, shadow_remaining, verified, workspace_shadow_active }` |

### 3.2 Verify Event 详细 Schema

```json
// Step 1: File integrity
{
  "event": "verify",
  "step": "file_integrity",
  "status": "checking" | "true" | "false",
  "checked_files": ["SKILL.md", "scripts/shell.js", "scripts/redact.js"]
}

// Step 2: Init scan
{
  "event": "verify",
  "step": "init_scan",
  "status": "skipped_in_json_mode" | "success" | "error",
  "output": "..." // 仅非 JSON mode
}

// Step 3: Environment check
{
  "event": "verify",
  "step": "environment",
  "node_version": "v24.15.0",
  "openclaw_path": "/usr/local/bin/claw"
}

// Step 4: Workspace shadow
{
  "event": "verify",
  "step": "workspace_shadow",
  "status": 0 | 1,
  "path": "~/.openclaw/workspace/skills/mapick"
}
```

### 3.3 Done Event 扩展

```json
{
  "event": "done",
  "state": "not_installed" | "same_version" | "older_version" | "newer_version" | "unknown_source",
  "version": "v0.0.15",
  "target": "~/.openclaw/skills/mapick",
  "shadow_remaining": 0 | 1,
  "verified": true | false,
  "workspace_shadow_active": 0 | 1
}
```

### 3.4 JSON Mode 使用示例

```bash
# 安装并获取 JSON 输出
MAPICK_INSTALL_JSON=1 bash install.sh

# 输出流（单行 JSON events）
{"event":"start","version":"v0.0.15","repo":"mapick-ai/mapick","dry_run":"0"}
{"event":"preflight","state":"not_installed","current_version":"","target_version":"v0.0.15"}
{"event":"download","url":"https://github.com/mapick-ai/mapick/archive/v0.0.15.tar.gz"}
{"event":"stage","path":"~/.openclaw/skills/.mapick.tmp-12345"}
{"event":"swap","target":"~/.openclaw/skills/mapick"}
{"event":"verify","step":"file_integrity","status":"true"}
{"event":"verify","step":"init_scan","status":"skipped_in_json_mode"}
{"event":"verify","step":"environment","node_version":"v24.15.0","openclaw_path":"/usr/local/bin/claw"}
{"event":"verify","step":"workspace_shadow","status":"0"}
{"event":"done","state":"not_installed","version":"v0.0.15","target":"~/.openclaw/skills/mapick","shadow_remaining":"0","verified":"true","workspace_shadow_active":"0"}
```

---

## 4. 错误处理：各环节 Fallback 策略

### 4.1 Notify 注册链路

| 失败点 | 错误类型 | Fallback 策略 |
|--------|----------|----------------|
| `notify:plan` 返回 | 无错误（纯本地） | N/A |
| AI 渲染 plan | 用户拒绝 | `update:dismissed notify_setup` → 14 天静默 |
| `cron rm` | entry 不存在 | `optional: true` → 忽略，继续 |
| `cron add` | OpenClaw 不可用 | 捕获 stderr，终止，提示用户手动设置 |
| `cron list` | 解析失败 | 降级：仅检查 `name` 字段存在 |
| `chat list` | 空数组 | delivery 验证失败 → 显示警告，不声称成功 |
| delivery 验证 | `no route` | 显示警告 + 设置指引，不调用 `notify:track` |

### 4.2 Notify Daily 执行

| 失败点 | 错误类型 | Fallback 策略 |
|--------|----------|----------------|
| `/notify/daily-check` | 网络错误 (dns/tcp/tls) | `alerts: []` → silence-first |
| Backend 5xx | HTTP error | `alerts: []` → silence-first |
| Backend 429 | Rate limit | `alerts: []` + `notice: "rate limited, retry later"` |
| Response parse | Invalid JSON | `{ error: "parse_error" }` → silence-first |
| Recommendations fetch | 网络错误 | `recommendations: []` → 仅显示 alerts |

### 4.3 安装体验

| 失败点 | 错误类型 | Fallback 策略 |
|--------|----------|----------------|
| File integrity | 文件缺失 | `rollback` → 恢复备份，exit 1 |
| Init scan | Node 执行失败 | 非致命，记录 warn，继续 |
| Node version check | < 22.14 | 安装前已检查，不会到达此步 |
| OpenClaw not found | 无 `claw` 命令 | 安装前已检查，不会到达此步 |
| Workspace shadow | 存在冲突 | JSON mode: `workspace_shadow_active: 1`；Human mode: 显示提示 |
| Atomic swap | `mv` 失败 | `rollback` → 恢复备份，exit 1 |
| Backup preserve | CONFIG 读取失败 | 跳过 preserve，使用新文件 |

### 4.4 Slug 解析

| 输入格式 | 解析失败 | Fallback 策略 |
|----------|----------|----------------|
| `skillssh:org/repo/skill` | 格式异常 | 返回 `{ raw, warning }` → AI 显示警告 |
| `org/repo/skill` | 多段路径 | 提取最后段，若无效 → `{ raw, warning }` |
| `installCommands[]` | 无匹配模式 | 尝试其他优先级 → 全失败 → `{ raw, warning }` |
| 安装执行 | `openclaw skills install <raw>` 失败 | AI 提示用户检查 skill 名称 |

---

## 5. 验证策略

### 5.1 安装后验证（install.sh）

**触发时机**：Atomic swap 成功后  
**执行环境**：目标目录已就位

| 步骤 | 命令 | 成功条件 | 失败处理 |
|------|------|----------|----------|
| 1. 文件完整性 | `ls` + `grep` | SKILL.md, shell.js, redact.js 存在 | rollback + exit 1 |
| 2. Init 扫描 | `node scripts/shell.js init` | JSON 无 `error` 字段 | 非致命，warn + continue |
| 3. 环境检测 | 已在安装前完成 | Node >= 22.14, OpenClaw 存在 | N/A |
| 4. Workspace shadow | `grep SKILL.md` | workspace 目录不存在同名 skill | JSON: `workspace_shadow_active: 1`；Human: 显示提示 |

**JSON Mode 差异**：
- Step 2 跳过 init 扫描（避免 AI 解析嵌套 JSON）
- 所有验证结果通过 `verify` event 输出
- 最终 `done` event 包含 `verified` 字段

### 5.2 Notify Plan 验证（handleNotifyPlan）

**触发时机**：AI 执行完 cron 命令后  
**执行环境**：OpenClaw cron 已注册

| 步骤 | 命令 | 成功条件 | 失败处理 |
|------|------|----------|----------|
| 1. Cron list | `openclaw cron list --json` | `name: "mapick-notify"` 存在 | 继续验证 delivery |
| 2. Delivery check | 解析 `deliveryPreviews` | 非 `no route` / `fail-closed` | 显示警告 |
| 3. Chat route | `openclaw chat list --json` | `routes[].length > 0` | 显示警告 + 不声称成功 |

**验证失败渲染**（AI）：

```
⚠️ Cron is scheduled, but no chat delivery route is configured.

The cron will fire at 9am daily, but notifications cannot reach you without a route.

Set up a route:
  openclaw chat add --type telegram --target <chat-id>

After setting up, re-run:
  node scripts/shell.js notify:plan
```

### 5.3 Status Workspace Shadow 检测（handleStatus）

**触发时机**：`/mapick status` 或 `/mapick` 命令  
**检测逻辑**：复用 `handleDiagnose` 已有逻辑

```javascript
// handleStatus 新增字段
async function handleStatus(_args, ctx) {
  // ... existing logic ...
  
  const home = process.env.HOME || "";
  const managedSkillFile = path.join(home, ".openclaw", "skills", "mapick", "SKILL.md");
  const workspaceSkillFile = path.join(home, ".openclaw", "workspace", "skills", "mapick", "SKILL.md");
  
  const managedExists = fs.existsSync(managedSkillFile);
  const workspaceExists = fs.existsSync(workspaceSkillFile);
  const shadowConflict = managedExists && workspaceExists;
  
  return {
    ...existingSummary,
    workspace_shadow: shadowConflict ? {
      active: true,
      path: path.join(home, ".openclaw", "workspace", "skills", "mapick"),
      hint: "Workspace copy shadows managed install. Move it aside and restart gateway.",
    } : { active: false },
  };
}
```

---

## 6. 实现清单

### 6.1 代码改动顺序

```bash
# Phase 1 改动（建议顺序）

# G1: 通知系统启用
1. scripts/lib/skills.js   → registerNotifyCron, handleInit
2. scripts/lib/updates.js  → handleNotifyPlan verification
3. scripts/lib/privacy.js  → handleNetworkConsent suggest_notify

# G2: 安装体验改造
4. install.sh              → verify steps + JSON events
5. scripts/lib/skills.js   → handleStatus workspace_shadow

# G3: 安装命令修复
6. scripts/lib/core.js     → resolveCanonicalSlug
7. scripts/lib/misc.js     → handleBundle resolved_install_commands
8. SKILL.md                → §1 补充实现说明
```

### 6.2 测试验证

| 测试项 | 命令 | 预期结果 |
|--------|------|----------|
| Notify plan | `node scripts/shell.js notify:plan` | 返回 plan + verification steps |
| Notify setup | AI 执行 plan + 确认 | delivery 验证通过或显示警告 |
| Notify daily | `node scripts/shell.js notify` | `alerts: []` 或非空，+ recommendations |
| Install JSON | `MAPICK_INSTALL_JSON=1 bash install.sh` | verify events + done with verified=true |
| Status shadow | `node scripts/shell.js status` | `workspace_shadow: { active: true/false }` |
| Slug resolve | `resolveCanonicalSlug("skillssh:org/repo/skill")` | `"skill"` |
| Bundle install | `node scripts/shell.js bundle install <id>` | `resolved_install_commands[].resolved_slug` |

### 6.3 安全扫描验证

**关键点**：
- `skills.js` 的 `registerNotifyCron` 不执行 `exec` / `subprocess`
- 返回 plan JSON，由 AI 执行（zero-subprocess 原则）
- 无新增可疑模式（`eval`, `Function`, `rm -rf`, data exfil）

---

## 7. 部署方案

### 7.1 发布流程

1. 本地改动 + 测试验证
2. ClawHub 安全扫描（Static Analysis + ClawScan + VirusTotal）
3. 合并到 main / 发布分支
4. 更新 VERSION.md
5. 发布到 ClawHub
6. 重启 OpenClaw gateway 验证

### 7.2 回滚方案

| 场景 | 回滚操作 |
|------|----------|
| Notify 功能异常 | `node scripts/shell.js notify:disable` → 移除 cron |
| Install 验证失败 | install.sh 已自动 rollback 到 backup |
| Slug 解析异常 | AI 使用 `{ raw, warning }` fallback |
| Workspace shadow | 用户手动 `mv ~/.openclaw/workspace/skills/mapick ...` |

---

## 8. 附录

### 8.1 相关文件索引

| 文件 | 行数 | 主要职责 |
|------|------|----------|
| `scripts/lib/skills.js` | 316 | scan, init/status/summary, registerNotifyCron |
| `scripts/lib/updates.js` | 438 | update:check, notify:plan, upgrade:plan |
| `scripts/lib/privacy.js` | 263 | consent, network-consent, trust/untrust |
| `scripts/lib/misc.js` | 468 | bundle, report, profile, workflow/daily |
| `scripts/lib/core.js` | 261 | config, cache, fp, helpers |
| `scripts/lib/http.js` | 320 | httpCall, endpoint allowlist, outbound log |
| `install.sh` | 520+ | atomic install pipeline |

### 8.2 后端依赖端点

| 端点 | Phase 1 需求 | 状态 |
|------|---------------|------|
| `GET /notify/daily-check` | 已使用 | **复用** |
| `POST /events/track` | 已使用 | **复用** |
| `GET /assistant/status/:fp` | 已使用 | **复用** |
| `GET /recommendations/feed` | 已使用 | **复用** |

**无需新增后端改动** — Phase 1 完全复用现有端点。

---

## 9. 总结

Phase 1 升级聚焦于客户端改动，核心目标：

| Goal | 关键改动 | 预期收益 |
|------|----------|----------|
| **G1: 通知系统启用** | 启用 `registerNotifyCron` + delivery 验证 | 用户可接收每日更新提醒 |
| **G2: 安装体验改造** | install.sh 3 步验证 + JSON events | 安装路径更健壮，CI 可解析 |
| **G3: 安装命令修复** | `resolveCanonicalSlug` 统一解析 | 所有推荐/bundle 安装命令可用 |

**技术栈**：
- Node.js 22.14+ (ES5/CommonJS)
- OpenClaw CLI (cron/chat 管理)
- Bash (install.sh)
- JSON event stream (CI 集成)

**风险控制**：
- Zero-subprocess 原则（Mapick 不直接执行 shell 命令）
- Fail-closed redaction（敏感数据不出站）
- Idempotent cron setup（重复执行不累积）
- Atomic install + rollback（失败自动恢复）

---

*架构方案编写完毕，可进入代码实现阶段。*