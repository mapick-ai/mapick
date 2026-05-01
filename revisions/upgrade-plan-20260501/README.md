# Mapick 升级计划

**基于**：`revisions/timeline-and-gap-analysis-20260501/`  
**日期**：2026-05-01  

---

## Phase 1：P0 修复（2-3 天）

### 1.1 通知系统启用（2-3 天）

**目标**：解除 scan-safe 禁用，使 notify cron 能正常工作

**现状**：
- `notify:plan` → 返回 `{ registered: false, reason: "cron_registration_disabled_in_scan_safe_build" }`
- 当前通过 `openclaw cron add` 手动配置，但缺乏自动注册

**改法**：
1. 移除 `skills.js` 中 `registerNotifyCron` 的硬编码禁用
2. 确保 ClawHub 安全扫描通过（无 `exec`/`subprocess` 等可疑模式）
3. `notify:plan` 调用 `openclaw cron add` 注册
4. 安装后首次 consent 时自动询问是否注册 cron

**涉及文件**：
| 文件 | 变更 |
|------|------|
| `scripts/lib/skills.js` | 启用 `registerNotifyCron` |
| `scripts/lib/updates.js` | `handleNotifyPlan` 输出增加 delivery 验证步骤 |
| `SKILL.md` §9 | 更新 Background notify 章节 |

### 1.2 安装体验改造（2 天）

**目标**：确保 `curl | bash` 安装路径通畅

**现状**：install.sh 已验证，但缺少安装后检测

**改法**：
1. install.sh 末尾增加 health check（调用 `node scripts/shell.js init`）
2. 检测 workspace 目录覆盖并提示
3. 安装完成自动检测 gateway 状态

**涉及文件**：
| 文件 | 变更 |
|------|------|
| `install.sh` | 增加安装后验证步骤 |
| `scripts/lib/skills.js` | `handleStatus` 增加 duplicate 检测提示 |

### 1.3 安装命令修复（1 天）

**目标**：确保 `openclaw skills install <slug>` 100% 可用

**现状**：SKILL.md 的 Install command rule 已修复 slug 解析，但需要验证

**改法**：
1. 验证 `recommend`/`search`/`bundle install` 返回的 slug 可安装
2. 修复 `skillssh:` 前缀残留
3. consent 后 notify cron 注册不再静默失败

**涉及文件**：
| 文件 | 变更 |
|------|------|
| `scripts/lib/recommend.js` | 验证 slug 解析 |
| `scripts/lib/misc.js` | bundle 安装 slug 解析 |
| `SKILL.md` §1 | Install command rule 更新 |

---

## Phase 2：P1 重要功能（3-5 天）

### 2.1 用户偏好设置（1 天）

**目标**：可配置的通知频率、推荐模式

**改法**：
1. CONFIG.md 新增 `proactive_mode: "off" | "silent" | "helpful"`（P2 plan 已定义）
2. 新增 `profile set proactive_mode=helpful` 或 `update:settings` 扩展
3. SKILL.md 增加偏好渲染规则

### 2.2 Token 透明化（2 天）

**目标**：用户能看到每次 AI 调用的 token 消耗

**改法**：
1. 后端 API 返回 token 消耗信息（需 mapick-api 配合）
2. 前端显示每次命令的 token 使用量
3. 可选的费用估算

### 2.3 推荐引擎增强（2 天）

**目标**：基于用户已安装 skill 做 gap analysis

**现状**：当前 `recommend` 返回 trending，`intent` 做关键词搜索

**改法**：
1. gap analysis 逻辑：扫描已安装 skill，与推荐 feed 交叉对比
2. 按类别推荐缺失的 skill
3. 需要后端 `/recommendations/gap-analysis` 端点配合

---

## Phase 3：P2 远期展望

| 功能 | 说明 | 前置 |
|------|------|------|
| 社交图谱 M5 | Skill 社交关系、分享推荐 | Phase 2 完成 |
| 开发者 API M7 | 外部 API 供第三方集成 | 后端对齐 |
| AI 模型路由 M8 | 多模型切换 | 后端对齐 |

---

## 执行清单

```bash
# Phase 1
cd /Users/evan/projects/mapick/mapick
git checkout -b 1.0/upgrade-phase1

# 1.1 通知系统启用
# 1.2 安装体验改造
# 1.3 安装命令修复

# 测试
# 全量回归 + 安全扫描验证
```

> 注意：所有代码更改后需重启 OpenClaw gateway：
> ```bash
> launchctl unload ~/Library/LaunchAgents/ai.openclaw.gateway.plist
> sleep 2
> launchctl load ~/Library/LaunchAgents/ai.openclaw.gateway.plist
> sleep 3
> ```
