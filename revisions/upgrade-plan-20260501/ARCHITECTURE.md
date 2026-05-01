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

## 10. Phase 2 升级 — 技术架构方案

**版本**：2026-05-01  
**范围**：Phase 2 客户端改动（F1/F2/F3），增强主动性、透明度、上下文感知  
**前置**：Phase 1 已完成

---

### 10.1 模块变更总览

| 模块 | 改动类型 | 变更内容 |
|------|----------|----------|
| `CONFIG.md` | **改动** | 新增 `proactive_mode` 配置项 |
| `scripts/lib/core.js` | **改动** | 新增 `PROACTIVE_MODES` 常量、`readProactiveMode()` helper |
| `scripts/lib/misc.js` | **改动** | `handleProfile("set")` 支持设置 `proactive_mode` |
| `scripts/lib/skills.js` | **改动** | `handleInit` / `handleStatus` 根据 `proactive_mode` 决定是否推荐 |
| `scripts/lib/recommend.js` | **改动** | `handleRecommend` 支持 `--contextual` flag，切换端点 |
| `scripts/lib/http.js` | **改动** | `ALLOWED_ENDPOINTS` 新增 `/recommendations/contextual` |
| `scripts/lib/radar.js` | **改动** | 支持 contextual feed 端点 |
| `scripts/lib/token.js` | **新增** | Token 使用统计模块 |
| `scripts/shell.js` | **改动** | 新增 `stats token` 命令路由 |

---

### 10.2 Feature 1: Proactive Mode

#### 10.2.1 配置项定义

**CONFIG.md 新增字段**：

```
proactive_mode: helpful
```

**可选值**：
| 值 | 含义 | 行为 |
|---|---|---|
| `helpful` | **默认** | 主动推荐：status/init 返回时附带推荐建议 |
| `minimal` | 极简模式 | 仅响应用户明确请求，不附带额外推荐 |
| `silent` | 静默模式 | 完全不显示推荐，仅返回状态数据 |

#### 10.2.2 核心逻辑

**`scripts/lib/core.js`**：

```javascript
const PROACTIVE_MODES = new Set(["helpful", "minimal", "silent"]);
const DEFAULT_PROACTIVE_MODE = "helpful";

function readProactiveMode() {
  const config = readConfig();
  const mode = config.proactive_mode || DEFAULT_PROACTIVE_MODE;
  if (!PROACTIVE_MODES.has(mode)) {
    return DEFAULT_PROACTIVE_MODE; // fallback to helpful
  }
  return mode;
}

function shouldShowRecommendations() {
  return readProactiveMode() === "helpful";
}

module.exports = {
  // ... existing exports
  PROACTIVE_MODES,
  DEFAULT_PROACTIVE_MODE,
  readProactiveMode,
  shouldShowRecommendations,
};
```

#### 10.2.3 Profile 命令扩展

**`scripts/lib/misc.js` — `handleProfile` 扩展**：

```javascript
async function handleProfile(args, ctx) {
  const sub = args[0] || "get";
  switch (sub) {
    case "set": {
      // ... existing profile text logic ...
      
      // 新增：支持 proactive_mode 设置
      // 格式: profile set --proactive-mode=helpful|minimal|silent
      const proactiveArg = args.find(a => a.startsWith("--proactive-mode="));
      if (proactiveArg) {
        const mode = proactiveArg.split("=")[1];
        if (!PROACTIVE_MODES.has(mode)) {
          return { 
            error: "invalid_proactive_mode", 
            valid: [...PROACTIVE_MODES],
            hint: "Valid modes: helpful (default), minimal, silent"
          };
        }
        writeConfig("proactive_mode", mode);
        result.proactive_mode = mode;
        result.proactive_mode_hint = mode === "helpful" 
          ? "Mapick will proactively suggest relevant skills."
          : mode === "minimal"
          ? "Mapick only responds to explicit requests."
          : "Mapick will not show recommendations.";
      }
      
      return result;
    }
    case "get": {
      // ... existing logic ...
      
      // 新增：返回 proactive_mode
      return {
        intent: "profile:get",
        profile: ctx.config.user_profile || null,
        tags,
        set_at: ctx.config.user_profile_set_at || null,
        proactive_mode: readProactiveMode(),
      };
    }
    // ... rest of cases ...
  }
}
```

#### 10.2.4 Status/Init 推荐控制

**`scripts/lib/skills.js`**：

```javascript
async function handleInit(_args, ctx) {
  // ... existing logic ...
  
  const proactiveMode = readProactiveMode();
  
  // 仅 helpful 模式下附带推荐建议
  if (proactiveMode === "helpful" && !isConsentDeclined(ctx.config)) {
    const recommendations = await fetchRecommendations(2);
    if (recommendations.length > 0) {
      result.suggest_recommend = true;
      result.recommendations = recommendations.map(r => ({
        ...r,
        slug: resolveCanonicalSlug(r.slug || r.id || r.name || ""),
      }));
      result.recommend_hint = "💡 You might find these skills useful:";
    }
  }
  
  return result;
}

async function handleStatus(_args, ctx) {
  // ... existing logic ...
  
  const summary = await aggregateSummary(skills, fresh);
  summary.workspace_shadow = workspaceShadow;
  summary.workspace_shadow_path = workspaceShadow ? workspaceDuplicate : null;
  
  // 仅 helpful 模式下附带推荐建议
  if (readProactiveMode() === "helpful" && !isConsentDeclined(ctx.config)) {
    const recommendations = await fetchRecommendations(2);
    if (recommendations.length > 0) {
      summary.suggest_recommend = true;
      summary.recommendations = recommendations.map(r => ({
        ...r,
        slug: resolveCanonicalSlug(r.slug || r.id || r.name || ""),
      }));
    }
  }
  
  return summary;
}
```

#### 10.2.5 AI 渲染规则

```
┌──────────────────────────────────────────────────────────────┐
│                   Proactive Mode 渲染逻辑                     │
└──────────────────────────────────────────────────────────────┘

  ┌─────────────────┐
  │ handleInit /    │
  │ handleStatus    │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                Check proactive_mode                         │
  │                                                             │
  │  ┌───────────────────────────────────────────────────────┐ │
  │  │ helpful                                               │ │
  │  │                                                       │ │
  │  │ → Fetch 2 recommendations                             │ │
  │  │ → If recommendations.length > 0:                     │ │
  │  │    → Show: "💡 You might find these skills useful:"  │ │
  │  │    → Render recommendations (≤2 lines each)          │ │
  │  │ → Else: silence-first, no extra output               │ │
  │  └───────────────────────────────────────────────────────┘ │
  │                                                             │
  │  ┌───────────────────────────────────────────────────────┐ │
  │  │ minimal / silent                                      │ │
  │  │                                                       │ │
  │  │ → Skip recommendation fetch entirely                  │ │
  │  │ → Return pure status data only                        │ │
  │  └───────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────┘

  用户切换模式:
  
  /mapick profile set --proactive-mode=minimal
  → AI: "✅ 已切换到极简模式。之后 /mapick status 不会再附带推荐建议。"
```

---

### 10.3 Feature 2: Token Transparency

#### 10.3.1 数据源分析

OpenClaw session JSONL 路径：
```
~/.openclaw/agents/main/sessions/*.jsonl
```

**JSONL 行结构（典型）**：

```json
{
  "ts": "2026-05-01T09:15:23.456Z",
  "event": "model_call",
  "model": "claude-3-sonnet",
  "input_tokens": 1245,
  "output_tokens": 387,
  "cost_usd": 0.0234
}
```

#### 10.3.2 Token 模块设计

**新建 `scripts/lib/token.js`**：

```javascript
const fs = require("fs");
const path = require("path");
const os = require("os");
const { isoNow, readCache, writeCache, readConfig, writeConfig } = require("./core");

const SESSION_DIR = path.join(os.homedir(), ".openclaw", "agents", "main", "sessions");
const TOKEN_CACHE_KEY = "token_stats";
const TOKEN_CACHE_TTL_HOURS = 1;

// Token 使用记录结构
function parseSessionLine(line) {
  try {
    const entry = JSON.parse(line);
    if (entry.event === "model_call" && entry.input_tokens && entry.output_tokens) {
      return {
        ts: entry.ts,
        model: entry.model || "unknown",
        input_tokens: entry.input_tokens,
        output_tokens: entry.output_tokens,
        total_tokens: (entry.input_tokens || 0) + (entry.output_tokens || 0),
        cost_usd: entry.cost_usd || null,
      };
    }
  } catch {}
  return null;
}

// 读取所有 session 文件并聚合
function aggregateTokenUsage(sinceDate = null) {
  if (!fs.existsSync(SESSION_DIR)) {
    return { error: "session_dir_not_found", path: SESSION_DIR };
  }
  
  const sessionFiles = fs.readdirSync(SESSION_DIR)
    .filter(f => f.endsWith(".jsonl"))
    .map(f => path.join(SESSION_DIR, f));
  
  const records = [];
  for (const file of sessionFiles) {
    try {
      const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        const record = parseSessionLine(line);
        if (record) {
          // 时间过滤
          if (sinceDate) {
            const recordTs = new Date(record.ts).getTime();
            const sinceTs = new Date(sinceDate).getTime();
            if (recordTs < sinceTs) continue;
          }
          records.push(record);
        }
      }
    } catch {}
  }
  
  return records;
}

// 按时间段聚合统计
function summarizeTokenUsage(records) {
  const total_input = records.reduce((sum, r) => sum + (r.input_tokens || 0), 0);
  const total_output = records.reduce((sum, r) => sum + (r.output_tokens || 0), 0);
  const total_tokens = total_input + total_output;
  const total_cost = records.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
  
  // 按模型分组
  const byModel = {};
  for (const r of records) {
    const model = r.model || "unknown";
    if (!byModel[model]) {
      byModel[model] = { input: 0, output: 0, count: 0 };
    }
    byModel[model].input += r.input_tokens || 0;
    byModel[model].output += r.output_tokens || 0;
    byModel[model].count += 1;
  }
  
  return {
    total_input,
    total_output,
    total_tokens,
    total_cost_usd: total_cost,
    sessions_count: records.length,
    by_model: byModel,
  };
}

// 获取时间范围起始点
function getStartDate(range) {
  const now = new Date();
  switch (range) {
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    case "week":
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return weekAgo.toISOString();
    case "month":
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return monthAgo.toISOString();
    default:
      return null; // all time
  }
}

// Shell handler: stats token [today|week|month]
function handleStatsToken(args) {
  const range = args[0] || "today";
  const validRanges = ["today", "week", "month", "all"];
  if (!validRanges.includes(range)) {
    return { 
      error: "invalid_range", 
      valid: validRanges,
      hint: "Usage: stats token [today|week|month|all]"
    };
  }
  
  // 尝试使用缓存（仅 today 和 week）
  const shouldCache = range === "today" || range === "week";
  if (shouldCache) {
    const cacheKey = `${TOKEN_CACHE_KEY}_${range}`;
    const cached = readCache(cacheKey);
    if (cached) {
      return { 
        intent: "stats:token", 
        range, 
        ...cached.stats,
        cached: true,
        cached_at: cached.cached_at
      };
    }
  }
  
  const sinceDate = getStartDate(range);
  const records = aggregateTokenUsage(sinceDate);
  
  if (records.error) {
    return { 
      intent: "stats:token", 
      range, 
      error: records.error,
      hint: "OpenClaw session logs not found. Token tracking requires OpenClaw to be installed."
    };
  }
  
  const summary = summarizeTokenUsage(records);
  
  // 写入缓存
  if (shouldCache) {
    const cacheKey = `${TOKEN_CACHE_KEY}_${range}`;
    writeCache(cacheKey, { stats: summary }, TOKEN_CACHE_TTL_HOURS);
  }
  
  // 存储到 CONFIG.md（可选，用于 dashboard）
  writeConfig(`last_token_${range}_at`, isoNow());
  writeConfig(`token_${range}_total`, String(summary.total_tokens));
  
  return {
    intent: "stats:token",
    range,
    ...summary,
    records_sample: records.slice(0, 5), // 仅展示前 5 条原始记录
  };
}

module.exports = {
  handleStatsToken,
  aggregateTokenUsage,
  summarizeTokenUsage,
  parseSessionLine,
  getStartDate,
};
```

#### 10.3.3 数据流图

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Token Tracking Data Flow                          │
└─────────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────┐
  │                  OpenClaw Session JSONL                           │
  │                                                                   │
  │  ~/.openclaw/agents/main/sessions/*.jsonl                        │
  │                                                                   │
  │  ┌─────────────────────────────────────────────────────────────┐ │
  │  │ Line 1: { event: "model_call", input: 1245, output: 387 }  │ │
  │  │ Line 2: { event: "model_call", input: 892, output: 234 }   │ │
  │  │ Line 3: { event: "model_call", input: 1567, output: 512 }  │ │
  │  │ ...                                                        │ │
  │  └─────────────────────────────────────────────────────────────┘ │
  └──────────────────────────────────┬───────────────────────────────┘
                                     │
                                     │ fs.readFileSync()
                                     │
                                     ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                     aggregateTokenUsage()                         │
  │                                                                   │
  │  1. 遍历所有 *.jsonl 文件                                        │
  │  2. 逐行 JSON.parse()                                            │
  │  3. 过滤 event === "model_call"                                  │
  │  4. 时间范围筛选 (sinceDate)                                     │
  │                                                                   │
  │  → records[] = [{ ts, model, input, output, cost }, ...]        │
  └──────────────────────────────────┬───────────────────────────────┘
                                     │
                                     │ summarizeTokenUsage()
                                     │
                                     ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                     Token Summary                                 │
  │                                                                   │
  │  {                                                                │
  │    total_input: 3704,                                            │
  │    total_output: 1133,                                           │
  │    total_tokens: 4837,                                           │
  │    total_cost_usd: 0.0678,                                       │
  │    sessions_count: 3,                                            │
  │    by_model: {                                                   │
  │      "claude-3-sonnet": { input: 3704, output: 1133, count: 3 } │
  │    }                                                              │
  │  }                                                                │
  └──────────────────────────────────┬───────────────────────────────┘
                                     │
                                     ├──────────────────┬─────────────
                                     │                  │
                                     ▼                  ▼
                    ┌────────────────────┐    ┌──────────────────────┐
                    │   Cache (1h TTL)   │    │   CONFIG.md          │
                    │                    │    │                      │
                    │  ~/.mapick/cache/  │    │  token_today_total   │
                    │  token_stats_today │    │  last_token_today_at │
                    │                    │    │                      │
                    │  仅 today/week     │    │  (用于 dashboard)    │
                    └────────────────────┘    └──────────────────────┘
                                     │
                                     ▼
                    ┌────────────────────────────────────────────────┐
                    │            Shell Response                      │
                    │                                                │
                    │  stats token today                             │
                    │                                                │
                    │  → AI renders:                                 │
                    │                                                │
                    │  ┌──────────────────────────────────────────┐ │
                    │  │ 📊 Token Usage Today                     │ │
                    │  │                                          │ │
                    │  │ Total: 4,837 tokens                      │ │
                    │  │ Input:  3,704 | Output: 1,133           │ │
                    │  │ Cost:   $0.0678                          │ │
                    │  │                                          │ │
                    │  │ By model:                                │ │
                    │  │ • claude-3-sonnet: 3 sessions            │ │
                    │  └──────────────────────────────────────────┘ │
                    └────────────────────────────────────────────────┘
```

#### 10.3.4 Shell 命令路由

**`scripts/shell.js` 扩展**：

```javascript
// stats 子命令路由
if (command === "stats") {
  const sub = args[0] || "";
  if (sub === "token") {
    const { handleStatsToken } = require("./lib/token");
    return handleStatsToken(args.slice(1));
  }
  // 原有 stats 命令
  const { handleStats } = require("./lib/misc");
  return handleStats();
}
```

---

### 10.4 Feature 3: Contextual Recommendations

#### 10.4.1 端点变更

| 原端点 | 新端点 | 差异 |
|-------|-------|------|
| `GET /recommendations/feed` | `GET /recommendations/contextual` | 接收当前 session 上下文参数 |
| 无 profile 参数 | `profileTags` + `currentSession` | 后端根据上下文匹配推荐 |

#### 10.4.2 HTTP Allowlist 扩展

**`scripts/lib/http.js`**：

```javascript
const ALLOWED_ENDPOINTS = [
  /^\/assistant\/(status|workflow|daily-digest|weekly)\/[a-f0-9]{16}$/,
  /^\/recommendations\/(feed|track|contextual)$/,  // ← 新增 contextual
  /^\/skills\/live-search$/,
  // ... rest of patterns ...
];
```

#### 10.4.3 Recommend Handler 扩展

**`scripts/lib/recommend.js`**：

```javascript
async function handleRecommend(args, ctx) {
  const withProfile = args.includes("--with-profile");
  const contextual = args.includes("--contextual");  // ← 新增 flag
  const numericArgs = args.filter((a) => !a.startsWith("--"));
  const limit = parseInt(numericArgs[0]) || 5;
  
  // 缓存策略：contextual 模式不缓存（上下文可能变化）
  const cacheKey = contextual 
    ? null 
    : `recommend_${ctx.fp}_${withProfile ? "profile" : "plain"}`;
  
  // 仅非 contextual 模式使用缓存
  if (cacheKey) {
    const cached = readCache(cacheKey);
    const useCache = !withProfile && numericArgs.length === 0;
    if (useCache && cached) {
      return { intent: "recommend", items: cached.items, cached: true };
    }
  }
  
  // 端点选择
  const endpoint = contextual 
    ? "/recommendations/contextual" 
    : "/recommendations/feed";
  
  let url = `${endpoint}?limit=${limit}`;
  
  // Profile tags 参数
  if (withProfile || contextual) {
    const tagsRaw = ctx.config.user_profile_tags || "";
    let tags = [];
    try {
      tags = JSON.parse(tagsRaw);
    } catch {
      tags = tagsRaw.split(",").filter(Boolean);
    }
    if (tags.length > 0) {
      url += `&profileTags=${encodeURIComponent(tags.join(","))}`;
    }
  }
  
  // Contextual 模式：额外传递当前 session 信息
  if (contextual) {
    // 从最近技能操作推断上下文
    const recentSkills = getRecentSkillInteractions(3);
    if (recentSkills.length > 0) {
      url += `&recentSkills=${encodeURIComponent(recentSkills.join(","))}`;
    }
    
    // 当前安装的技能数量（作为上下文信号）
    const { scanSkills } = require("./skills");
    const installed = scanSkills();
    url += `&installedCount=${installed.length}`;
    
    url += `&contextual=1`;
  }
  
  const resp = await httpCall("GET", url);
  if (resp.error) return resp;
  
  const rawItems = resp.items || resp.recommendations || [];
  const items = rawItems.map((item) => ({
    ...item,
    slug: resolveCanonicalSlug(item.slug || item.id || item.name || ""),
  }));
  
  const result = {
    intent: "recommend",
    items,
    withProfile,
    contextual,
    endpoint_used: endpoint,
  };
  
  // 仅非 contextual 模式写入缓存
  if (cacheKey && !contextual) {
    writeCache(cacheKey, { items: result.items });
  }
  
  return result;
}

// 获取最近技能交互（用于 contextual 推荐）
function getRecentSkillInteractions(limit = 3) {
  const { readOutboundLog } = require("./audit");
  try {
    const events = readOutboundLog();
    const skillEvents = events.filter(e => 
      e.endpoint?.includes("/events/track") ||
      e.endpoint?.includes("/recommendations/track")
    );
    
    // 提取 skillId，去重，取最近 limit 个
    const seen = new Set();
    const recent = [];
    for (const e of skillEvents.reverse()) {
      const skillId = e.body_fields?.skillId || e.params?.skillId;
      if (skillId && !seen.has(skillId)) {
        seen.add(skillId);
        recent.push(skillId);
        if (recent.length >= limit) break;
      }
    }
    return recent;
  } catch {
    return [];
  }
}
```

#### 10.4.4 Radar 模块适配

**`scripts/lib/radar.js`**：

```javascript
async function handleRadar(_args, ctx) {
  // ... existing consent and frequency checks ...
  
  // 新增：支持 contextual 模式
  const useContextual = ctx.config.proactive_mode === "helpful";
  
  const endpoint = useContextual 
    ? "/recommendations/contextual" 
    : "/recommendations/feed";
  
  let candidates = [];
  try {
    let url = `${endpoint}?limit=${Math.min(OUT_ARR, 10)}`;
    
    // Contextual 参数
    if (useContextual) {
      const tagsRaw = ctx.config.user_profile_tags || "";
      let tags = [];
      try { tags = JSON.parse(tagsRaw); } catch { tags = tagsRaw.split(",").filter(Boolean); }
      if (tags.length > 0) {
        url += `&profileTags=${encodeURIComponent(tags.join(","))}`;
      }
      
      const recentSkills = getRecentSkillInteractions(3);
      if (recentSkills.length > 0) {
        url += `&recentSkills=${encodeURIComponent(recentSkills.join(","))}`;
      }
      
      url += `&contextual=1`;
    }
    
    const resp = await httpCall("GET", url);
    candidates = resp.items || resp.recommendations || [];
  } catch {
    return { intent: "radar", silent: true, reason: "backend_unreachable" };
  }
  
  // ... rest of existing logic ...
}
```

---

### 10.5 模块交互图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Phase 2 Module Interaction Map                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│     CONFIG.md       │     │   scripts/lib/      │     │   OpenClaw         │
│                     │     │                     │     │   Sessions         │
│ ┌─────────────────┐ │     │ ┌─────────────────┐ │     │ ┌─────────────────┐ │
│ │ proactive_mode  │ │     │ │ core.js         │ │     │ │ *.jsonl         │ │
│ │ helpful/minimal │ │◄────│ │ readProactive() │ │     │ │ model_call      │ │
│ │ /silent         │ │     │ │ shouldShowRec() │ │     │ │ input/output    │ │
│ └─────────────────┘ │     │ └─────────────────┘ │     │ └─────────────────┘ │
│ ┌─────────────────┐ │     │ ┌─────────────────┐ │     └─────────────────────┘
│ │ user_profile    │ │     │ │ misc.js         │ │              │
│ │ user_profile_   │ │◄────│ │ handleProfile() │ │              │
│ │ tags            │ │     │ │   (set/get)     │ │              ▼
│ └─────────────────┘ │     │ └─────────────────┘ │     ┌─────────────────────┐
│ ┌─────────────────┐ │     │ ┌─────────────────┐ │     │ scripts/lib/token.js│
│ │ token_today_    │ │◄────│ │ skills.js       │ │     │ ┌─────────────────┐ │
│ │ total           │ │     │ │ handleInit()    │ │     │ │ handleStatsToken│ │
│ └─────────────────┘ │     │ │ handleStatus()  │ │◄────│ │ aggregateUsage  │ │
│                     │     │ └─────────────────┘ │     │ │ summarizeUsage  │ │
└─────────────────────┘     │ ┌─────────────────┐ │     └─────────────────┘ │
                            │ │ recommend.js    │ │     └─────────────────────┘
              ┌─────────────│ │ handleRecommend │ │              │
              │             │ │   --contextual  │ │              ▼
              │             │ └─────────────────┘ │     ┌─────────────────────┐
              │             │ ┌─────────────────┐ │     │ ~/.mapick/cache/    │
              │             │ │ radar.js        │ │     │ token_stats_today   │
              │             │ │ handleRadar()   │ │◄────│ token_stats_week    │
              │             │ │   contextual    │ │     └─────────────────────┘
              │             │ └─────────────────┘ │
              │             │ ┌─────────────────┐ │
              │             │ │ http.js         │ │
              │             │ │ ALLOWED_        │ │
              │             │ │ ENDPOINTS       │ │◄──── 新增 /recommendations/contextual
              │             │ └─────────────────┘ │
              │             └─────────────────────┘
              │                        │
              │                        ▼
              │             ┌─────────────────────────────────────────────────────┐
              │             │                    Backend API                      │
              │             │                                                     │
              │             │  GET /recommendations/feed                         │
              │             │  GET /recommendations/contextual ← NEW             │
              │             │      ?profileTags=rust,typescript                  │
              │             │      &recentSkills=code-review,git-helper         │
              │             │      &installedCount=12                            │
              │             │      &contextual=1                                 │
              │             └─────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Shell Command Routing                               │
│                                                                             │
│  /mapick profile set --proactive-mode=minimal                               │
│      → handleProfile("set", ["--proactive-mode=minimal"])                   │
│      → writeConfig("proactive_mode", "minimal")                             │
│                                                                             │
│  /mapick status                                                             │
│      → handleStatus()                                                       │
│      → if readProactiveMode() === "helpful":                                │
│          → fetchRecommendations(2)                                          │
│          → result.suggest_recommend = true                                  │
│                                                                             │
│  /mapick stats token today                                                  │
│      → handleStatsToken(["today"])                                          │
│      → aggregateTokenUsage(todayStart)                                      │
│      → summarizeTokenUsage(records)                                         │
│      → writeCache("token_stats_today", summary)                             │
│                                                                             │
│  /mapick recommend --contextual                                             │
│      → handleRecommend(["--contextual"])                                    │
│      → endpoint = "/recommendations/contextual"                             │
│      → url += &recentSkills=... &installedCount=...                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 10.6 错误处理策略

#### 10.6.1 Proactive Mode 错误处理

| 失败点 | 错误类型 | Fallback 策略 |
|-------|---------|---------------|
| `proactive_mode` 无效值 | 未知模式 | fallback 到 `helpful` |
| 推荐获取失败 | 网络错误 | silence-first，不附带推荐 |
| Profile 设置无效参数 | 缺少值 | 返回 `error: invalid_proactive_mode` |

#### 10.6.2 Token Tracking 错误处理

| 失败点 | 错误类型 | Fallback 策略 |
|-------|---------|---------------|
| Session 目录不存在 | `session_dir_not_found` | 返回错误 + 提示 OpenClaw 未安装 |
| JSONL 解析失败 | 单行 JSON 异常 | 跳过该行，继续处理 |
| 缓存读取失败 | 缓存损坏 | 直接读取 JSONL，重新聚合 |
| 时间范围无效 | 未知参数 | 返回 `error: invalid_range` |

#### 10.6.3 Contextual Recommendations 错误处理

| 失败点 | 错误类型 | Fallback 策略 |
|-------|---------|---------------|
| `/recommendations/contextual` 不可达 | 网络错误 | fallback 到 `/recommendations/feed` |
| 端点不在 allowlist | 安全拒绝 | 返回 `endpoint_not_allowed` |
| recentSkills 解析失败 | audit 日志异常 | 不传递 recentSkills 参数 |
| 后端返回空结果 | 无匹配推荐 | silence-first，返回空数组 |

---

### 10.7 影响分析

#### 10.7.1 现有模块影响

| 模块 | 影响程度 | 改动范围 |
|-----|---------|---------|
| `skills.js` | **中等** | `handleInit` / `handleStatus` 新增推荐逻辑 |
| `misc.js` | **低** | `handleProfile` 新增 proactive_mode 设置 |
| `recommend.js` | **中等** | `handleRecommend` 新增 `--contextual` 分支 |
| `http.js` | **低** | Allowlist 新增一条规则 |
| `radar.js` | **低** | 端点选择逻辑新增 contextual 分支 |
| `shell.js` | **低** | `stats` 命令新增 `token` 子路由 |

#### 10.7.2 新增依赖

| 依赖 | 来源 | 用途 |
|-----|-----|-----|
| OpenClaw session JSONL | 外部 | Token 统计数据源 |
| `~/.openclaw/agents/main/sessions/*.jsonl` | OpenClaw | 模型调用记录 |

#### 10.7.3 性能考量

| 特性 | 性能影响 | 优化策略 |
|-----|---------|---------|
| Proactive 推荐 | 每次 status/init +1 HTTP 调用 | 仅 helpful 模式触发，minimal/silent 跳过 |
| Token 统计 | 首次读取需遍历 JSONL | 缓存 1 小时，仅 today/week 缓存 |
| Contextual 推荐 | 端点切换，参数增加 | 失败自动 fallback 到普通 feed |

---

### 10.8 实现清单

#### 10.8.1 代码改动顺序

```bash
# Phase 2 改动（建议顺序）

# F1: Proactive Mode
1. scripts/lib/core.js      → PROACTIVE_MODES, readProactiveMode, shouldShowRecommendations
2. scripts/lib/misc.js      → handleProfile("set") 支持 --proactive-mode
3. scripts/lib/skills.js    → handleInit/handleStatus 推荐逻辑

# F2: Token Transparency
4. scripts/lib/token.js     → 新建模块，handleStatsToken
5. scripts/shell.js         → stats token 命令路由

# F3: Contextual Recommendations
6. scripts/lib/http.js      → ALLOWED_ENDPOINTS 新增 contextual
7. scripts/lib/recommend.js → handleRecommend --contextual 分支
8. scripts/lib/radar.js     → contextual 端点选择
```

#### 10.8.2 测试验证

| 测试项 | 命令 | 预期结果 |
|-------|-----|---------|
| Proactive mode 设置 | `profile set --proactive-mode=minimal` | `proactive_mode: minimal` |
| Status 推荐控制 | `status` (minimal 模式) | 无 `suggest_recommend` 字段 |
| Status 推荐显示 | `status` (helpful 模式) | `suggest_recommend: true` + recommendations |
| Token 统计 today | `stats token today` | `total_tokens, by_model` |
| Token 统计 week | `stats token week` | 缓存生效，返回 cached: true |
| Contextual 推荐 | `recommend --contextual` | `endpoint_used: /recommendations/contextual` |
| 端点 allowlist | `recommend --contextual` | 无 `endpoint_not_allowed` 错误 |

---

### 10.9 后端需求

| 端点 | Phase 2 需求 | 状态 |
|-----|-------------|------|
| `GET /recommendations/contextual` | **新增** | 需后端支持 |
| `GET /recommendations/feed` | 已存在 | **复用** |

**新增端点参数**：

```
GET /recommendations/contextual
  ?limit=5
  &profileTags=rust,typescript
  &recentSkills=code-review,git-helper
  &installedCount=12
  &contextual=1
```

---

### 10.10 总结

Phase 2 升级聚焦于增强用户体验与透明度：

| Feature | 关键改动 | 预期收益 |
|--------|---------|---------|
| **F1: Proactive Mode** | CONFIG.md 新增配置，status/init 推荐控制 | 用户可控制推荐主动性 |
| **F2: Token Transparency** | 新增 token.js，解析 session JSONL | 用户可查看 API 使用情况 |
| **F3: Contextual Recommendations** | `--contextual` flag，新端点 | 推荐更精准，基于上下文匹配 |

**技术栈**：
- Node.js 22.14+ (ES5/CommonJS)
- OpenClaw Session JSONL（外部数据源）
- Cache TTL 1 hour（Token 统计）

**风险控制**：
- Silence-first fallback（推荐获取失败不报错）
- Endpoint allowlist（新端点必须声明）
- 缓存失效自动重建（Token 统计）

---

*Phase 2 架构方案编写完毕，可进入代码实现阶段。*

---

## 11. Phase 3 升级 — 技术架构方案

**版本**：2026-05-01  
**范围**：Phase 3 客户端 + 后端改动（G7/G8），Stats Dashboard 增强、Perception 集成  
**前置**：Phase 2 已完成（G4 proactive_mode、G5 stats token、G6 contextual recommend）

---

### 11.1 模块变更总览

| 模块 | 改动类型 | 变更内容 |
|------|----------|----------|
| `scripts/lib/stats.js` | **改动** | 新增 `handleStatsDetail()`：三路数据合并（本地 token + 后端 stats + perception） |
| `scripts/lib/core.js` | **改动** | 新增 `fetchUserStats()` / `fetchPerceptionTrend()` / `fetchPerceptionSummary()` 网络请求 helper |
| `scripts/lib/http.js` | **改动** | `ALLOWED_ENDPOINTS` 新增 3 条正则 |
| `scripts/shell.js` | **改动** | 新增 `stats --detail` / `--period` / `--compact` 参数解析与路由 |
| `scripts/lib/notify.js` | **改动** | `handleNotifyDaily()` 集成 `GET /perception/summary` 到 daily digest JSON |
| `SKILL.md` | **改动** | 新增 §16 Stats Dashboard 渲染规则、§17 Perception 渲染规则 |
| **后端** | **新增** | `src/modules/stats/` 模块（controller + service）、`GET /stats/user/:userId` 端点 |

---

### 11.2 后端新模块：`src/modules/stats/`

#### 11.2.1 模块结构

```
src/modules/stats/
├── stats.module.ts          # NestJS module 注册
├── stats.controller.ts      # GET /stats/user/:userId
├── stats.service.ts         # 聚合 events 表 + 查询逻辑
├── dto/
│   └── user-stats.dto.ts    # 请求参数 DTO（period, includeTrend）
└── interfaces/
    └── user-stats.interface.ts  # 响应类型定义
```

#### 11.2.2 Controller 设计

```typescript
// src/modules/stats/stats.controller.ts

@Controller("stats")
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get("user/:userId")
  async getUserStats(
    @Param("userId") userId: string,
    @Query("period") period: string,
    @Query("includeTrend") includeTrend: string,
    @Headers("x-device-fp") deviceFp: string,
  ): Promise<UserStatsResponse> {
    // 1. 认证校验
    const isValid = await this.authService.validateDeviceFp(deviceFp, userId);
    if (!isValid) throw new ForbiddenException("Device FP does not match user");

    // 2. 周期参数校验与默认值
    const validPeriods = ["7d", "30d", "90d"];
    const resolvedPeriod = validPeriods.includes(period) ? period : "30d";
    const shouldIncludeTrend = includeTrend !== "false"; // 默认 true

    // 3. 调用 service 聚合数据
    return this.statsService.aggregateUserStats(userId, resolvedPeriod, shouldIncludeTrend);
  }
}
```

**端点认证流**：
```
Client Request (x-device-fp: abc123)
    │
    ▼
Controller: validateDeviceFp(abc123, userId)
    │
    ├─ 查询 device_fp ↔ user 绑定关系 (users 表)
    │
    ├─ 匹配 → 允许
    │
    └─ 不匹配 → 403 Forbidden
```

#### 11.2.3 Service 设计

```typescript
// src/modules/stats/stats.service.ts

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(Event) private eventRepo: Repository<Event>,
    @InjectRepository(UserSkill) private userSkillRepo: Repository<UserSkill>,
  ) {}

  async aggregateUserStats(
    userId: string,
    period: string,      // "7d" | "30d" | "90d"
    includeTrend: boolean,
  ): Promise<UserStatsResponse> {
    const range = this.resolveDateRange(period);

    // 并行查询所有聚合指标
    const [
      eventsTotal,
      eventsByType,
      recommendMetrics,
      activeDays,
      topSkills,
      installTrend,
      categoryDistribution,
    ] = await Promise.all([
      this.countTotalEvents(userId, range),
      this.countEventsByType(userId, range),
      this.computeRecommendFunnel(userId, range),
      this.countActiveDays(userId, range),
      this.getTopSkills(userId, range, 5),
      includeTrend ? this.computeInstallTrend(userId, range) : [],
      this.getCategoryDistribution(userId),
    ]);

    return {
      userId,
      period: { from: range.from.toISOString(), to: range.to.toISOString(), days: range.days },
      stats: {
        eventsTotal,
        eventsByType,
        ...recommendMetrics,
        activeDays,
        activeDaysRatio: activeDays / range.days,
        topSkills,
        installTrend,
        categoryDistribution,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  private resolveDateRange(period: string): DateRange {
    const to = new Date();
    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    const from = new Date(to.getTime() - days * 86400000);
    return { from, to, days };
  }

  private async countTotalEvents(userId: string, range: DateRange): Promise<number> {
    return this.eventRepo.count({
      where: { userId, createdAt: Between(range.from, range.to) },
    });
  }

  private async countEventsByType(userId: string, range: DateRange): Promise<Record<string, number>> {
    return this.eventRepo
      .createQueryBuilder("e")
      .select("e.eventType", "type")
      .addSelect("COUNT(*)", "count")
      .where("e.userId = :userId", { userId })
      .andWhere("e.createdAt BETWEEN :from AND :to", { from: range.from, to: range.to })
      .groupBy("e.eventType")
      .getRawMany()
      .then(rows => Object.fromEntries(rows.map(r => [r.type, parseInt(r.count)])));
  }

  private async computeRecommendFunnel(userId: string, range: DateRange): Promise<{
    recommendShown: number;
    recommendClicked: number;
    recommendInstalled: number;
    conversionRate: { click_through: number; install_rate: number; overall: number };
  }> {
    const [shown, clicked, installed] = await Promise.all([
      this.eventRepo.count({ where: { userId, eventType: "recommend_view", createdAt: Between(range.from, range.to) } }),
      this.eventRepo.count({ where: { userId, eventType: "recommend_click", createdAt: Between(range.from, range.to) } }),
      this.eventRepo.count({ where: { userId, eventType: "recommend_install", createdAt: Between(range.from, range.to) } }),
    ]);

    return {
      recommendShown: shown,
      recommendClicked: clicked,
      recommendInstalled: installed,
      conversionRate: {
        click_through: shown > 0 ? +(clicked / shown).toFixed(4) : 0,
        install_rate: clicked > 0 ? +(installed / clicked).toFixed(4) : 0,
        overall: shown > 0 ? +(installed / shown).toFixed(4) : 0,
      },
    };
  }

  private async countActiveDays(userId: string, range: DateRange): Promise<number> {
    const result = await this.eventRepo
      .createQueryBuilder("e")
      .select("DATE(e.createdAt)", "date")
      .where("e.userId = :userId", { userId })
      .andWhere("e.createdAt BETWEEN :from AND :to", { from: range.from, to: range.to })
      .groupBy("DATE(e.createdAt)")
      .getRawMany();
    return result.length;
  }

  private async getTopSkills(userId: string, range: DateRange, limit: number): Promise<TopSkill[]> {
    return this.eventRepo
      .createQueryBuilder("e")
      .select("e.skillSlug", "slug")
      .addSelect("e.skillName", "name")
      .addSelect("e.category", "category")
      .addSelect("COUNT(*)", "interactions")
      .where("e.userId = :userId", { userId })
      .andWhere("e.createdAt BETWEEN :from AND :to", { from: range.from, to: range.to })
      .andWhere("e.skillSlug IS NOT NULL")
      .groupBy("e.skillSlug")
      .addGroupBy("e.skillName")
      .addGroupBy("e.category")
      .orderBy("interactions", "DESC")
      .limit(limit)
      .getRawMany()
      .then(rows => rows.map(r => ({
        slug: r.slug,
        name: r.name,
        interactions: parseInt(r.interactions),
        category: r.category,
      })));
  }

  private async computeInstallTrend(userId: string, range: DateRange): Promise<InstallTrendItem[]> {
    const rows = await this.eventRepo
      .createQueryBuilder("e")
      .select("DATE_TRUNC('week', e.createdAt)", "week")
      .addSelect("COUNT(*)", "count")
      .where("e.userId = :userId", { userId })
      .andWhere("e.eventType = 'install'")
      .andWhere("e.createdAt BETWEEN :from AND :to", { from: range.from, to: range.to })
      .groupBy("DATE_TRUNC('week', e.createdAt)")
      .orderBy("week", "ASC")
      .getRawMany();

    let cumulative = 0;
    return rows.map(r => {
      cumulative += parseInt(r.count);
      return { week: this.formatISOWeek(r.week), count: parseInt(r.count), cumulative };
    });
  }

  private async getCategoryDistribution(userId: string): Promise<Record<string, number>> {
    const rows = await this.userSkillRepo
      .createQueryBuilder("us")
      .select("us.category", "category")
      .addSelect("COUNT(*)", "count")
      .where("us.userId = :userId", { userId })
      .andWhere("us.status = 'active'")
      .groupBy("us.category")
      .getRawMany();
    return Object.fromEntries(rows.map(r => [r.category, parseInt(r.count)]));
  }
}

// 类型定义
interface DateRange { from: Date; to: Date; days: number; }
interface TopSkill { slug: string; name: string; interactions: number; category: string; }
interface InstallTrendItem { week: string; count: number; cumulative: number; }

interface UserStatsResponse {
  userId: string;
  period: { from: string; to: string; days: number; };
  stats: {
    eventsTotal: number;
    eventsByType: Record<string, number>;
    recommendShown: number;
    recommendClicked: number;
    recommendInstalled: number;
    conversionRate: { click_through: number; install_rate: number; overall: number; };
    activeDays: number;
    activeDaysRatio: number;
    topSkills: TopSkill[];
    installTrend: InstallTrendItem[];
    categoryDistribution: Record<string, number>;
  };
  generatedAt: string;
}
```

#### 11.2.4 Service 查询性能优化

| 查询 | 数据量级 | 优化策略 |
|------|---------|---------|
| `countTotalEvents` | 单用户最多 ~10K 行/月 (events 表) | 索引：`(userId, createdAt)` |
| `countEventsByType` | 同上 | 同一索引 + `GROUP BY eventType` |
| `countActiveDays` | 同上 | `DISTINCT DATE(createdAt)` — 索引覆盖 |
| `getTopSkills` | 同上 | 索引：`(userId, createdAt, skillSlug)` |
| `computeInstallTrend` | 单用户最多 ~500 行/月 | `DATE_TRUNC` + 索引 |
| `getCategoryDistribution` | 查询 `user_skills` 表 (小表) | `(userId, status)` 索引 |

**后端性能目标**：
- 所有查询在单次请求中完成（并行 `Promise.all`）
- p95 响应时间 ≤ 500ms（单用户数据量 ≤ 100K events）
- 数据库层建立覆盖索引确保查询不走全表扫描

---

### 11.3 `GET /stats/user/:userId` 端点契约

#### 11.3.1 端点规范

| 属性 | 值 |
|------|-----|
| **方法** | `GET` |
| **路径** | `/api/v1/stats/user/:userId` |
| **认证** | Device FP（via `x-device-fp` header），`userId` 必须与 `x-device-fp` 绑定的用户一致 |
| **查询参数** | `period`（可选，`7d` / `30d` / `90d`，默认 `30d`）、`includeTrend`（可选，`true` / `false`，默认 `true`） |
| **成功响应** | `200 OK`，JSON body（见 11.2.3 `UserStatsResponse`） |
| **错误响应** | `401` — 缺失 `x-device-fp` header；`403` — userId 与 device FP 不匹配；`404` — 用户不存在；`500` — 内部错误 |
| **频率限制** | 10 req/min per device FP |
| **缓存建议** | 响应头 `Cache-Control: private, max-age=300`（客户端 5 分钟缓存）；可选 `ETag` 支持 |

#### 11.3.2 认证流程

```
Client sends: GET /stats/user/a1b2c3d4e5f6g7h8
              x-device-fp: <16-char hex>

Server:
  1. 查 events 表: SELECT userId FROM events WHERE deviceFp = :fp LIMIT 1
  2. 比较 userId 与 URL param 中的 userId
  3. 不匹配 → 403 {"error": "forbidden", "message": "userId does not match device fingerprint"}
  4. 匹配 → 继续查询
```

#### 11.3.3 数据库依赖

| 表 | 用途 | 关键字段 |
|------|------|---------|
| `events` | 存放所有用户行为事件 | `userId`, `eventType`, `skillSlug`, `skillName`, `category`, `createdAt`, `deviceFp` |
| `user_skills` | 用户当前已安装技能 | `userId`, `slug`, `category`, `status` |

**索引要求**：
```
events:
  - (userId, createdAt)              -- 时间范围 + 计数查询
  - (userId, eventType, createdAt)   -- 按事件类型聚合
  - (userId, skillSlug, createdAt)   -- top skills 排名

user_skills:
  - (userId, status)                 -- 类别分布查询
```

---

### 11.4 Perception 端点集成

#### 11.4.1 `GET /perception/accuracy-trend` 集成

**端点**（后端已有，客户端首次接入）：

| 属性 | 值 |
|------|-----|
| **方法** | `GET` |
| **路径** | `/api/v1/perception/accuracy-trend` |
| **认证** | Device FP（via `x-device-fp` header） |
| **查询参数** | `period`（可选，`7d`/`30d`/`90d`，默认 `30d`） |
| **缓存** | 客户端 10 分钟缓存 |

**客户端调用位置**：`scripts/lib/stats.js` → `handleStatsDetail()` → 三路并行请求之一

```javascript
// scripts/lib/core.js 中的新 helper
async function fetchPerceptionTrend(period = "30d") {
  const url = `/perception/accuracy-trend?period=${encodeURIComponent(period)}`;
  return httpCall("GET", url);
}
```

#### 11.4.2 `GET /perception/summary` 集成

**端点**（后端已有，客户端首次接入）：

| 属性 | 值 |
|------|-----|
| **方法** | `GET` |
| **路径** | `/api/v1/perception/summary` |
| **认证** | Device FP（via `x-device-fp` header） |
| **查询参数** | 无 |
| **缓存** | 客户端 30 分钟缓存（数据变化频率低） |

**客户端调用位置**：`scripts/lib/notify.js` → `handleNotifyDaily()`

```javascript
// scripts/lib/core.js 中的新 helper
async function fetchPerceptionSummary() {
  return httpCall("GET", "/perception/summary");
}
```

#### 11.4.3 降级策略实现

```
stats --detail
    │
    ├── (1) 本地 token 解析 ─────────────── 失败 → local.tokenReport = null
    │                                          ├─ 记录日志
    │                                          └─ 继续
    │
    ├── (2) GET /stats/user/:userId ──────── 失败 (超时 2s / 4xx / 5xx)
    │                                          ├─ remoteFallback = true
    │                                          ├─ 记录 remoteFallbackReason
    │                                          └─ 继续
    │
    └── (3) GET /perception/accuracy-trend ─ 失败 (超时 2s / 4xx / 5xx)
                                               ├─ perceptionFallback = true
                                               ├─ 记录 perceptionFallbackReason
                                               └─ 继续

最终返回合并 JSON（缺失部分置 null）
```

**降级时的 AI 渲染行为**（参见 DESIGN.md §1.4）：

| 数据状况 | 渲染策略 |
|---------|---------|
| 仅本地 token 可用 | 显示 token 列 + "后端数据暂时不可用" |
| 后端 stats 可用，perception 不可用 | 显示 stats 列 + token 列，perception 列留空 |
| 全部不可用 | 显示单一错误卡片 |

---

### 11.5 ALLOWED_ENDPOINTS 变更

#### 11.5.1 完整 diff

```diff
  // scripts/lib/http.js
  const ALLOWED_ENDPOINTS = [
    /^\/assistant\/(status|workflow|daily-digest|weekly)\/[a-f0-9]{16}$/,
    /^\/recommendations\/(feed|track)$/,
    /^\/recommendations\/contextual$/,        // Phase 2
    /^\/skills\/live-search$/,
    /^\/skills\/check-updates$/,
    /^\/users\/[a-f0-9]{16}\/(zombies|profile-text)$/,
+   /^\/stats\/user\/[a-f0-9]{16}$/,          // Phase 3 — G7
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
+   /^\/perception\/accuracy-trend$/,         // Phase 3 — G8
+   /^\/perception\/summary$/,                // Phase 3 — G8
    /^\/notify\/daily-check$/,
  ];
```

#### 11.5.2 新增端点汇总

| # | 正则 | 来源 | 用途 |
|:-:|------|:---:|------|
| — | `/^\/stats\/user\/[a-f0-9]{16}$/` | G7 | 获取个人 stats 全貌 |
| — | `/^\/perception\/accuracy-trend$/` | G8 | 获取推荐准确率趋势 |
| — | `/^\/perception\/summary$/` | G8 | 获取感知摘要（daily digest） |

**总计**：ALLOWED_ENDPOINTS 从 Phase 2 的 21 条增加至 **24 条**。

---

### 11.6 完整数据流：后端 DB → API → 客户端 Shell → Dashboard HTML

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    Phase 3 Stats Dashboard Full Data Flow                       │
└──────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────┐
  │         Backend Database         │
  │                                 │
  │  ┌───────────────────────────┐  │
  │  │      events 表             │  │
  │  │  ┌─────────────────────┐  │  │
  │  │  │ userId              │  │  │
  │  │  │ eventType           │  │  │
  │  │  │ skillSlug           │  │  │
  │  │  │ skillName           │  │  │
  │  │  │ category            │  │  │
  │  │  │ createdAt           │  │  │
  │  │  │ deviceFp            │  │  │
  │  │  └─────────────────────┘  │  │
  │  └───────────────────────────┘  │
  │                                 │
  │  ┌───────────────────────────┐  │
  │  │    user_skills 表          │  │
  │  │  ┌─────────────────────┐  │  │
  │  │  │ userId              │  │  │
  │  │  │ slug                │  │  │
  │  │  │ category            │  │  │
  │  │  │ status              │  │  │
  │  │  └─────────────────────┘  │  │
  │  └───────────────────────────┘  │
  └────────────────┬────────────────┘
                   │
                   │ SQL queries (by StatsService)
                   │
                   ▼
  ┌─────────────────────────────────┐
  │    NestJS StatsController        │
  │                                 │
  │  GET /stats/user/:userId         │
  │    ?period=30d                   │
  │    &includeTrend=true            │
  │    x-device-fp: abc123           │
  │                                 │
  │  1. Auth: validate device FP    │
  │  2. Call StatsService            │
  │  3. Return JSON response         │
  └────────────────┬────────────────┘
                   │
                   │ HTTP 200 JSON
                   │
                   ▼
  ┌─────────────────────────────────┐
  │     Mapick Client Shell          │
  │     (scripts/shell.js)           │
  │                                 │
  │  $ stats --detail                │
  │     --period 30d                 │
  │                                 │
  │  ┌───────────────────────────┐  │
  │  │   handleStatsDetail()      │  │
  │  │   (scripts/lib/stats.js)   │  │
  │  │                           │  │
  │  │  // 三路并行请求           │  │
  │  │  const [token, stats,    │  │
  │  │    perception] = await    │  │
  │  │    Promise.allSettled([   │  │
  │  │   (1) parseLocalToken()  │  │
  │  │     → ~/sessions/*.jsonl │  │
  │  │   (2) fetchUserStats()   │  │
  │  │     → GET /stats/user/   │  │
  │  │   (3) fetchPerception()  │  │
  │  │     → GET /perception/   │  │
  │  │     accuracy-trend        │  │
  │  │  ]);                     │  │
  │  │                           │  │
  │  │  // 合并 + 降级处理        │  │
  │  │  return mergeResults(    │  │
  │  │    token, stats,          │  │
  │  │    perception             │  │
  │  │  );                       │  │
  │  └───────────────────────────┘  │
  └────────────────┬────────────────┘
                   │
                   │ JSON → stdout
                   │
                   ▼
  ┌─────────────────────────────────┐
  │         AI (OpenClaw)           │
  │                                 │
  │  Receives: { intent:            │
  │    "stats:detail", ... }        │
  │                                 │
  │  Renders → Dashboard HTML       │
  │  (per SKILL.md §16 rules)       │
  └────────────────┬────────────────┘
                   │
                   ▼
  ┌─────────────────────────────────┐
  │       User sees Dashboard       │
  │                                 │
  │  📊 Mapick 使用全景 — 过去 30 天  │
  │  ┌─────────┬─────────┬────────┐ │
  │  │ Global  │ Personal │ Percep │ │
  │  │ Overview│  Stats   │Insights│ │
  │  │         │         │        │ │
  │  │ 💰 Token│ 🎯漏斗   │ 📐准确率│ │
  │  │ 📈趋势   │ ⭐Skills │ 趋势    │ │
  │  │ 👤活跃度 │ 🏷️类别   │ 💡洞察  │ │
  │  └─────────┴─────────┴────────┘ │
  └─────────────────────────────────┘
```

### 11.7 客户端实现细节

#### 11.7.1 `scripts/lib/stats.js` — `handleStatsDetail()`

```javascript
const { readConfig } = require("./core");
const { httpCall } = require("./http");
const { aggregateTokenUsage, summarizeTokenUsage, getStartDate } = require("./token");

async function handleStatsDetail(args) {
  // 参数解析
  const periodIdx = args.indexOf("--period");
  const period = periodIdx >= 0 ? args[periodIdx + 1] : "30d";
  const compact = args.includes("--compact");
  const validPeriods = ["7d", "30d", "90d"];
  const resolvedPeriod = validPeriods.includes(period) ? period : "30d";

  const config = readConfig();
  const userId = config.user_id;
  if (!userId) {
    return {
      intent: "stats:detail",
      period: resolvedPeriod,
      error: "user_id_not_found",
      hint: "User ID not found in CONFIG.md. Ensure Mapick has been initialized.",
    };
  }

  // 三路并行请求（allSettled 确保部分失败不阻塞）
  const [tokenResult, statsResult, perceptionResult] = await Promise.allSettled([
    // (1) 本地 token 解析
    (async () => {
      const sinceDate = getStartDate(resolvedPeriod);
      const records = aggregateTokenUsage(sinceDate);
      const summary = summarizeTokenUsage(records);
      return { ...summary, source: { sessions_scanned: records.length } };
    })(),
    // (2) 后端 user stats
    httpCall("GET", `/stats/user/${userId}?period=${resolvedPeriod}&includeTrend=true`),
    // (3) 后端 perception accuracy-trend
    httpCall("GET", `/perception/accuracy-trend?period=${resolvedPeriod}`),
  ]);

  // 合并结果 + 降级标记
  const local = tokenResult.status === "fulfilled"
    ? { tokenReport: tokenResult.value, parsedAt: new Date().toISOString() }
    : { tokenReport: null, error: tokenResult.reason?.message };

  let remote = null;
  let remoteFallback = false;
  let remoteFallbackReason = null;
  let perceptionFallback = false;
  let perceptionFallbackReason = null;

  if (statsResult.status === "fulfilled" && !statsResult.value.error) {
    remote = {
      userStats: statsResult.value,
      perception: perceptionResult.status === "fulfilled" ? perceptionResult.value : null,
      source: "api",
      fetchedAt: new Date().toISOString(),
    };
    if (perceptionResult.status === "rejected") {
      perceptionFallback = true;
      perceptionFallbackReason = perceptionResult.reason?.message || "Unknown error";
    }
  } else {
    remoteFallback = true;
    remoteFallbackReason = statsResult.status === "rejected"
      ? statsResult.reason?.message
      : `GET /stats/user/${userId} returned ${statsResult.value?.status || "unknown"}`;
  }

  const result = {
    intent: "stats:detail",
    period: resolvedPeriod,
    from: getStartDate(resolvedPeriod),
    to: new Date().toISOString(),
    local,
    remote,
    remoteFallback,
    perceptionFallback,
    generatedAt: new Date().toISOString(),
  };

  if (remoteFallbackReason) result.remoteFallbackReason = remoteFallbackReason;
  if (perceptionFallbackReason) result.perceptionFallbackReason = perceptionFallbackReason;

  return result;
}
```

#### 11.7.2 `scripts/lib/notify.js` — Daily Digest Perception 集成

```javascript
// handleNotifyDaily() 扩展
async function handleNotifyDaily(_args, ctx) {
  // ... 现有 logic (radar + token_snapshot + alerts) ...

  const digest = {
    intent: "notify:daily",
    radar: radarResult,
    token_snapshot: tokenSnapshot,
    alerts: notifyAlerts,
    perception: null,  // 新增字段
  };

  // 仅 helpful 模式下获取 perception summary
  const proactiveMode = readProactiveMode();
  if (proactiveMode === "helpful") {
    try {
      const perceptionSummary = await httpCall("GET", "/perception/summary");
      if (perceptionSummary && !perceptionSummary.error) {
        digest.perception = {
          overallAccuracy: perceptionSummary.overallAccuracy,
          trendDirection: perceptionSummary.trendDirection,
          trendDelta: perceptionSummary.trendDelta,
          topCorrectCategories: perceptionSummary.topCorrectCategories?.slice(0, 2),
          topMissedCategories: perceptionSummary.topMissedCategories?.slice(0, 2),
          insights: perceptionSummary.insights?.slice(0, 1), // 最多 1 条洞察
        };
      }
    } catch {
      // 静默跳过 — perception 数据不可用不影响核心 digest
    }
  }

  return digest;
}
```

#### 11.7.3 `scripts/shell.js` — 路由扩展

```javascript
// shell.js 中 stats 子命令路由
if (command === "stats") {
  const sub = args[0] || "";

  // Phase 2: stats token [today|week]
  if (sub === "token") {
    const { handleStatsToken } = require("./lib/token");
    return handleStatsToken(args.slice(1));
  }

  // Phase 3: stats --detail [--period 7d|30d|90d] [--compact]
  if (args.includes("--detail")) {
    const { handleStatsDetail } = require("./lib/stats");
    return handleStatsDetail(args);
  }

  // 原有 stats 命令
  const { handleStats } = require("./lib/misc");
  return handleStats();
}
```

---

### 11.8 错误处理策略

#### 11.8.1 Stats Dashboard 错误矩阵

| 失败点 | 错误类型 | Fallback 策略 |
|--------|----------|----------------|
| `userId` 不存在于 CONFIG.md | 本地配置缺失 | 返回 `error: "user_id_not_found"` + hint |
| 本地 token 解析失败 | JSONL 文件损坏/不存在 | `local.tokenReport: null`，记录 `local.error` |
| `GET /stats/user/:userId` 2s 超时 | 网络超时 | `remoteFallback: true`，仅展示本地 token 数据 |
| `GET /stats/user/:userId` 返回 401/403 | 认证失败 | `remoteFallback: true` + 原因说明，不重试 |
| `GET /stats/user/:userId` 返回 404 | 用户不存在 | `remoteFallback: true` + "暂无数据，使用一段时间后查看" |
| `GET /stats/user/:userId` 返回 500 | 服务端错误 | `remoteFallback: true` + "后端暂时不可用" |
| `GET /stats/user/:userId` 返回 429 | 频率限制 | `remoteFallback: true` + "请求过于频繁，请稍后重试" |
| `GET /perception/accuracy-trend` 2s 超时 | 网络超时 | `perceptionFallback: true`，跳过感知列 |
| `GET /perception/accuracy-trend` 返回 5xx | 服务端错误 | 同上 |
| 所有请求均失败 | 完全不可用 | 返回统一错误卡片 |

#### 11.8.2 Daily Digest Perception 错误矩阵

| 失败点 | 错误类型 | Fallback 策略 |
|--------|----------|----------------|
| `GET /perception/summary` 请求失败 | 网络/服务端错误 | 静默跳过 — `digest.perception = null` |
| `GET /perception/summary` 返回 429 | 频率限制 | 静默跳过 |
| `GET /perception/summary` 响应格式异常 | 解析错误 | 静默跳过（`try/catch` 包裹） |
| `proactive_mode !== "helpful"` | 模式不匹配 | 不请求 perception，`digest.perception = null` |

#### 11.8.3 新增后端端点错误处理

| HTTP 状态码 | 含义 | 客户端行为 |
|:----------:|------|-----------|
| 200 | 成功 | 正常解析 |
| 400 | 参数错误（如 period=invalid） | 返回 `error: "invalid_params"` |
| 401 | 缺少 x-device-fp header | 返回 `error: "unauthorized"` |
| 403 | userId 不匹配 device FP | 返回 `error: "forbidden"`，不重试 |
| 404 | 用户不存在（userId 不在 users 表） | 返回 `error: "user_not_found"`，提示使用一段时间后查看 |
| 429 | 频率限制（>10 req/min） | 返回 `error: "rate_limited"`，提示稍后重试 |
| 500 | 服务端内部错误 | 降级到本地 token 数据 |

---

### 11.9 性能与缓存策略

#### 11.9.1 客户端缓存

| 数据 | 缓存 TTL | 缓存 Key | 存储位置 |
|------|:------:|---------|---------|
| 本地 token 解析 (today) | 1 小时 | `token_stats_today` | `~/.mapick/cache/` |
| 本地 token 解析 (week) | 1 小时 | `token_stats_week` | `~/.mapick/cache/` |
| `GET /stats/user/:userId` | 5 分钟 | `user_stats_{userId}_{period}` | `~/.mapick/cache/` |
| `GET /perception/accuracy-trend` | 10 分钟 | `perception_trend_{period}` | `~/.mapick/cache/` |
| `GET /perception/summary` | 30 分钟 | `perception_summary` | `~/.mapick/cache/` |

#### 11.9.2 请求超时设置

```javascript
// httpCall 调用时设置 timeout
function httpCall(method, url, body, intent, timeout = 2000) {
  // ...
  // stats 和 perception 类请求使用 2s 超时
  // 超时后触发 remoteFallback / perceptionFallback
}
```

| 请求 | 超时时间 | 理由 |
|------|:------:|------|
| `GET /stats/user/:userId` | 2s | 聚合查询可能较重，但 p95 应在 500ms 内 |
| `GET /perception/accuracy-trend` | 2s | 后端查询 + 传输，p95 应在 300ms 内 |
| `GET /perception/summary` | 2s | 轻量查询，p95 应在 200ms 内 |

---

### 11.10 模块交互图

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                      Phase 3 Module Interaction Map                            │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│    Backend DB         │     │   Backend API         │     │   Client Shell       │
│                      │     │                      │     │                      │
│ ┌────────────────┐   │     │ ┌────────────────┐   │     │ ┌────────────────┐   │
│ │ events 表       │   │     │ │ StatsController│   │     │ │ shell.js       │   │
│ │ - userId        │◄──┼─────│→│ GET /stats/    │   │     │ │ stats --detail │   │
│ │ - eventType     │   │     │ │ user/:userId   │───┼─────│→│                │   │
│ │ - skillSlug     │   │     │ └────────────────┘   │     │ └───────┬────────┘   │
│ │ - createdAt     │   │     │                      │     │         │            │
│ └────────────────┘   │     │ (已有)                │     │         ▼            │
│                      │     │ ┌────────────────┐   │     │ ┌────────────────┐   │
│ ┌────────────────┐   │     │ │ Perception     │   │     │ │ stats.js       │   │
│ │ user_skills 表  │   │     │ │ Controller     │   │     │ │ handleStats    │   │
│ │ - userId        │   │     │ │ GET /percep-   │   │     │ │ Detail()       │   │
│ │ - slug          │   │     │ │ tion/accuracy- │───┼─────│→│                │   │
│ │ - category      │   │     │ │ -trend         │   │     │ │ ┌────────────┐ │   │
│ │ - status        │   │     │ │ GET /percep-   │   │     │ │ │ 本地 token  │ │   │
│ └────────────────┘   │     │ │ tion/summary   │───┼─────│→│ │ │ 解析       │ │   │
└──────────────────────┘     │ └────────────────┘   │     │ │ └────────────┘ │   │
                             └──────────────────────┘     │ │ ┌────────────┐ │   │
                                                          │ │ │ GET /stats │ │   │
                                                          │ │ │ /user/     │ │   │
                                                          │ │ └────────────┘ │   │
                                                          │ │ ┌────────────┐ │   │
                                                          │ │ │ GET /per-  │ │   │
                                                          │ │ │ ception/   │ │   │
                                                          │ │ │ accuracy-  │ │   │
                                                          │ │ │ trend      │ │   │
                                                          │ │ └────────────┘ │   │
                                                          │ │                │   │
                                                          │ │ → 合并 JSON   │   │
                                                          │ └────────────────┘   │
                                                          │         │            │
                                                          │         ▼            │
                                                          │ ┌────────────────┐   │
                                                          │ │ notify.js      │   │
                                                          │ │ handleNotify   │   │
                                                          │ │ Daily()        │   │
                                                          │ │                │   │
                                                          │ │ + perception   │   │
                                                          │ │   summary      │   │
                                                          │ └────────────────┘   │
                                                          │                      │
                                                          │ ┌────────────────┐   │
                                                          │ │ http.js        │   │
                                                          │ │ ALLOWED_       │   │
                                                          │ │ ENDPOINTS      │   │
                                                          │ │ + 3 new        │   │
                                                          │ │ patterns       │   │
                                                          │ └────────────────┘   │
                                                          └──────────────────────┘
                                                                    │
                                                                    │ JSON → stdout
                                                                    ▼
                                                          ┌──────────────────────┐
                                                          │   AI (OpenClaw)      │
                                                          │                      │
                                                          │   Render Dashboard   │
                                                          │   (3-column grid)    │
                                                          └──────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────┐
  │                          Perception in Daily Digest                       │
  └─────────────────────────────────────────────────────────────────────────┘

  notify daily trigger (cron / manual)
      │
      ├─ handleNotifyDaily()
      │   ├─ radar scan
      │   ├─ token snapshot
      │   ├─ version/zombie alerts
      │   └─ IF proactive_mode === "helpful":
      │       └─ GET /perception/summary (try/catch)
      │           └─ 成功 → append to digest JSON
      │           └─ 失败 → silent skip (digest.perception = null)
      │
      └─ stdout JSON → AI renders daily digest
```

---

### 11.11 影响分析

#### 11.11.1 现有模块影响

| 模块 | 影响程度 | 改动范围 |
|------|:------:|---------|
| `stats.js` | **高** | 新增 `handleStatsDetail()` 函数 + 三路合并逻辑 |
| `core.js` | **低** | 新增 3 个网络请求 helper 函数 |
| `http.js` | **低** | Allowlist 新增 3 条正则 |
| `shell.js` | **低** | `stats` 子路由新增 `--detail` flag 解析 |
| `notify.js` | **低** | `handleNotifyDaily()` 新增 perception 获取 + 合并 |
| `SKILL.md` | **中** | 新增 §16、§17 渲染规则 |
| **后端** | **高** | 新建 `src/modules/stats/` 模块 |

#### 11.11.2 新增依赖

| 依赖 | 来源 | 用途 |
|------|------|------|
| 后端 `events` 表 | 已有 | G7 stats 聚合（eventsTotal / eventsByType / topSkills） |
| 后端 `user_skills` 表 | 已有 | G7 类别分布（categoryDistribution） |
| `GET /stats/user/:userId` | **新增** | G7 核心数据源 |
| `GET /perception/accuracy-trend` | 已有 | G8 stats 中的准确率趋势展示 |
| `GET /perception/summary` | 已有 | G8 daily digest 中的感知简报 |

#### 11.11.3 性能考量

| 特性 | 性能影响 | 优化策略 |
|------|---------|---------|
| stats --detail 三路并行 | 最多 3 个并发请求 + 本地 I/O | `Promise.allSettled` 并行执行，单点超时不阻塞 |
| 后端 stats 聚合 | 每条查询扫描 events 表 | 索引 `(userId, createdAt)` + 并行 `Promise.all` |
| 大数据量用户 (>100K events) | 可能超 500ms | 服务端分页 or 预聚合表（后续优化） |
| Perception 缓存 | 30 分钟内不重复请求 | 客户端缓存 + `try/catch` 包裹 |
| Daily digest perception | 每次 notify 触发一次 GET | 仅在 helpful 模式下请求，30 分钟缓存 |

---

### 11.12 实现清单

#### 11.12.1 代码改动顺序

```bash
# Phase 3 改动（建议顺序）

# G7: Stats Dashboard 增强
1. 后端 src/modules/stats/          → 新建模块: controller + service + DTO
2. 后端 app.module.ts               → 注册 StatsModule
3. scripts/lib/http.js              → ALLOWED_ENDPOINTS 新增 /^\/stats\/user\/[a-f0-9]{16}$/
4. scripts/lib/core.js              → 新增 fetchUserStats() helper
5. scripts/lib/stats.js             → 新增 handleStatsDetail()
6. scripts/shell.js                 → stats --detail 路由

# G8: Perception 集成
7. scripts/lib/http.js              → ALLOWED_ENDPOINTS 新增 perception 端点 (2条)
8. scripts/lib/core.js              → 新增 fetchPerceptionTrend() + fetchPerceptionSummary()
9. scripts/lib/stats.js             → handleStatsDetail() 新增 perception 获取 + 合并
10. scripts/lib/notify.js           → handleNotifyDaily() 集成 perception summary

# Rule updates
11. SKILL.md                         → 新增 §16 Stats Dashboard 渲染规则
12. SKILL.md                         → 新增 §17 Perception 集成渲染规则
```

#### 11.12.2 测试验证

| 测试项 | 命令 | 预期结果 |
|--------|------|----------|
| Stats detail (全部成功) | `stats --detail` | JSON 包含 local + remote.userStats + remote.perception |
| Stats detail (后端不可用) | `stats --detail` (模拟 503) | `remoteFallback: true`，仅含 local.tokenReport |
| Stats detail (perception 不可用) | `stats --detail` (模拟 perception 503) | `perceptionFallback: true`，remote.userStats 正常，remote.perception = null |
| Stats detail --period 7d | `stats --detail --period 7d` | from-to 间隔 7 天 |
| Stats detail --compact | `stats --detail --compact` | JSON 正常返回 |
| Notify daily + perception | `notify daily` (simulate cron fire) | digest JSON 含 `perception` 字段（helpful 模式） |
| Notify daily - silent skip | `notify daily` (simulate perception 500) | digest JSON 中 `perception: null`，不阻塞 |
| ALLOWED_ENDPOINTS | 代码检查 | 3 条新正则存在且不破坏已有匹配 |
| Backend stats endpoint | `curl GET /stats/user/:id` | 200 + JSON 符合 UserStatsResponse schema |
| Backend auth guard | `curl GET /stats/user/OTHER_ID` (wrong FP) | 403 |

---

### 11.13 后端模块注册示例

```typescript
// src/modules/stats/stats.module.ts

import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { StatsController } from "./stats.controller";
import { StatsService } from "./stats.service";
import { Event } from "../events/event.entity";
import { UserSkill } from "../user-skills/user-skill.entity";
import { AuthModule } from "../auth/auth.module";  // 用于 device FP 校验

@Module({
  imports: [
    TypeOrmModule.forFeature([Event, UserSkill]),
    AuthModule,
  ],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
```

```typescript
// src/app.module.ts (diff)
@Module({
  imports: [
    // ... existing modules
+   StatsModule,
  ],
})
export class AppModule {}
```

---

### 11.14 总结

Phase 3 升级聚焦于数据洞察与感知闭环：

| Goal | 关键改动 | 预期收益 |
|------|----------|----------|
| **G7: Stats Dashboard** | 新增 `handleStatsDetail()`（三路合并）+ 后端 `GET /stats/user/:userId` | 用户可查看使用全貌（token + 漏斗 + 趋势） |
| **G8: Perception 集成** | 客户端接入 accuracy-trend + summary 端点；daily digest 集成 | 推荐系统拥有可见的反馈回路，用户信任度提升 |

**技术栈**：
- NestJS (TypeORM + PostgreSQL) — StatsModule 后端
- Node.js 22.14+ — 客户端 `handleStatsDetail()`
- `Promise.allSettled` — 三路并行 + 降级容错
- ASCII sparkline — perception 趋势可视化

**核心数据流**：
```
events 表 (PostgreSQL) → StatsService.aggregate → StatsController → HTTP JSON
    ──→ (并行) handleStatsDetail() + 本地 session JSONL 解析
    ──→ 合并 JSON → AI 渲染 → Dashboard HTML
```

**风险控制**：
- 三路 `Promise.allSettled`：任一路失败不阻塞其他路
- 2s 超时 + 多层降级：remoteFallback → perceptionFallback
- ALLOWED_ENDPOINTS 白名单：新增端点需显式声明
- Perception 静默跳过：daily digest 中 perception 失败不干扰主体通知
- 后端性能：索引覆盖 + 并行查询 + p95 ≤ 500ms

---

*Phase 3 架构方案编写完毕，可进入代码实现阶段。*