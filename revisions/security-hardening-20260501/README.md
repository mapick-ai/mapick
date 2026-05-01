# Security Hardening — P0 Issue Fixes

**日期**：2026-05-01
**来源**：Slack #mapick 频道审计（James 多轮测试 + 代码审计）
**流程**：Superpowers Phase 2（编写计划）

---

## 背景

从 #mapick 频道的完整聊天记录和代码审计中，发现 2 个 P0 严重度问题尚未修复：

| 问题 | 来源 | 当前状态 |
|------|------|---------|
| `profile set` 泄露敏感信息 🔴 | James 审计 R3 | 未修复 |
| 缺少 ID 校验 🔴 | James 审计 R3 | 未修复 |

---

## 问题 1：`profile set` 泄露敏感信息

### 问题描述

`handleProfile("set", args)` 在 `misc.js:260` 直接将用户输入的 `text` 写入 CONFIG.md：

```js
writeConfig("user_profile", text);  // 未经过 redact！
```

如果用户输入 `"我写 Go + Python，API key 是 sk-xxx"`，全文（含 API key）会被持久化到 `CONFIG.md`。

### 修复方案

在写入前调用 `redactForUpload(text)` 脱敏。如果脱敏结果为空，拒绝写入。

```js
const redacted = redactForUpload(text);
if (!redacted.ok) return { error: "profile_redact_failed", message: redacted.error };
writeConfig("user_profile", redacted.text);
```

### 影响范围

| 文件 | 行 | 变更 |
|------|----|------|
| `scripts/lib/misc.js` | 256-272 | 添加 redact 步骤 |
| `scripts/lib/redact.js` | 可能需调整 | 确保覆盖 API key 等模式 |

---

## 问题 2：缺少 ID 校验

### 问题描述

skill ID 直接作为 `args[0]` 传入，未经任何校验即用于文件操作（`clean.js:139`、`privacy.js` 等）：

```js
// misc.js - 无校验直接传
// clean.js - 直接 resolveSkillTarget(args[0])
// privacy.js - 无 args 校验
```

如果传入恶意 ID（如 `../../../etc`），可能导致路径穿越。

### 修复方案

添加 `validateSkillId(id)` 统一校验函数，只允许字母/数字/短横/下划线：

```js
// 新增到 core.js
function validateSkillId(id) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}
```

应用到 `clean.js`、`privacy.js`、`security.js`、`misc.js` 等所有接收 skill ID 的 handler。

### 影响范围

| 文件 | 函数 | 变更 |
|------|------|------|
| `scripts/lib/core.js` | 新增 `validateSkillId` | +8 行 |
| `scripts/lib/clean.js` | `handleClean`, `handleTrack` | +校验 |
| `scripts/lib/privacy.js` | `handle("trust")`, `handle("untrust")` | +校验 |
| `scripts/lib/security.js` | `handleSecurity`, `handleReport` | +校验 |
| `scripts/lib/misc.js` | `handleShare` | +校验 |

---

## 实施计划（Superpowers Phase 3 用）

| Task | 文件 | 估算 |
|------|------|:----:|
| 1. 添加 `validateSkillId` 到 core.js | `core.js` | 2 min |
| 2. 修复 profile set 的 redact | `misc.js` | 3 min |
| 3. 校验 clean.js 的 skillId | `clean.js` | 3 min |
| 4. 校验 privacy.js 的 skillId | `privacy.js` | 3 min |
| 5. 校验 security.js 的 skillId | `security.js` | 3 min |
| 6. 同步到 workspace 副本 | `cp` | 1 min |
| 7. 重启 gateway + 验证 | — | 3 min |

**总计**：约 18 分钟
