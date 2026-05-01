# Revisions Index

> 所有需求文档、开发计划、设计方案、重构计划等索引。

## 子目录

### `m3-skill-bundle-2026-04/`
**M3 Skill Bundle Recommendation v2.0** (2026-04-27)
- `M3_Skill套装推荐_KT.md` — 通用开发者场景套装推荐、模型消耗预估、Onboarding 对话流

### `install-setup/`
**安装与配置体验改造计划** (2026-04-28)
- `INSTALLATION_SETUP_PLAN.md` — 安装体验从"文件下载成功"升级为"安装成功就一定能启动"，建立 `openclaw skills install mapick` 主路径（1048 行）

### `install-commands-bugfix/`
**安装命令与一键安装链路修复计划** (2026-04-28)
- `INSTALL_COMMANDS_FIX_PLAN.md` — 修复 recommend/search 生成的 install 命令 100% 失败问题，解决 mapick vs mapickii 路径冲突、consent 后 cron 静默失败（667 行）

### `timeline-and-gap-analysis-20260501/`
**群组文件时间线 & 差距分析** (2026-05-01)
- `README.md` — 65 个 Slack 文件按时间线排序，逐阶段总结，对比当前代码，提取 10 项差距 (P0×3, P1×4, P2×3)

### `upgrade-plan-20260501/`
**Mapick 升级计划** (2026-05-01)
- `README.md` — 基于差距分析的升级路线 (Phase 1-3, P0-P2, 执行清单)

### `security-hardening-20260501/`
**Security Hardening — P0 Issue Fixes** (2026-05-01) [Commit: `2ec4461`]
- `README.md` — 背景分析、2 个 P0 问题详情、修复方案、影响范围、实施结果

### `slack-01/`
**Slack Integration — Phase 1** (5 个 Bug 修复)
- `slack-01.md` — 原始问题汇总 + 修复方案
- `slack-01-mapick-api-upgrade.md` — 后端 API 升级方案
- `slack-01-mapickii-upgrade.md` — Skill 端升级方案

### `slack-02/`
**Slack Integration — Phase 2** (三大功能：通知推送、Token 透明化、用户偏好)
- `slack-02.md` — 需求总览 + 27 个测试用例结果
- `Mapick_V1.5_三大功能开发文档_KT.md` — 详细开发文档 (853 行)
- `SKILL4-8修定.md` — SKILL 文件修订
- `SKILL（后台常驻_偏好设置_skill成本）提示词.md` — 提示词优化

---

*Last updated: 2026-05-01*
