# Slack Revision 01 - mapickii Upgrade

## 范围

本文件只覆盖 Skill 端工程 [mapickii](/Users/evan/projects/mapick/mapickii) 的升级项。

对应文件：

- [SKILL.md](/Users/evan/projects/mapick/mapickii/SKILL.md)
- [scripts/shell.js](/Users/evan/projects/mapick/mapickii/scripts/shell.js)
- [scripts/redact.py](/Users/evan/projects/mapick/mapickii/scripts/redact.py)
- [scripts/redact.js](/Users/evan/projects/mapick/mapickii/scripts/redact.js)
- [README.md](/Users/evan/projects/mapick/mapickii/README.md)

## P0 升级项

### 1. 部署新版 SKILL.md

目标：

- 让 Skill 端体验与新设计一致

主要改动点：

- [SKILL.md](/Users/evan/projects/mapick/mapickii/SKILL.md)
- [scripts/shell.js](/Users/evan/projects/mapick/mapickii/scripts/shell.js)

任务：

- 确认 `persona brewing` 卡片逻辑已经实际生效
- 确认推荐结果会连接到 workflow 上下文
- 确认僵尸 Skill 清理文案已更新
- 确认首次状态页不再只是普通概览

验收：

- `TC21` / `TC22` 低数据人格展示正确
- onboarding 话术与预期版本一致

### 2. Onboarding 前端化呈现

目标：

- 让用户第一次交互就看到强诊断感

主要改动点：

- [SKILL.md](/Users/evan/projects/mapick/mapickii/SKILL.md)
- [scripts/shell.js](/Users/evan/projects/mapick/mapickii/scripts/shell.js)
- [reference/lifecycle.md](/Users/evan/projects/mapick/mapickii/reference/lifecycle.md)
- [reference/intents.md](/Users/evan/projects/mapick/mapickii/reference/intents.md)

任务：

- 调整首次状态输出结构
- 让 workflow 问答在正确时机出现
- 把推荐、安全、清理建议串成一个连续对话

验收：

- 首次使用不再只是“状态页”，而是完整诊断体验

## P1 升级项

### 3. 隐私链路补测与行为修复

目标：

- 验证并修复 Skill 端隐私行为

主要改动点：

- [scripts/redact.py](/Users/evan/projects/mapick/mapickii/scripts/redact.py)
- [scripts/redact.js](/Users/evan/projects/mapick/mapickii/scripts/redact.js)
- [scripts/shell.js](/Users/evan/projects/mapick/mapickii/scripts/shell.js)
- [SKILL.md](/Users/evan/projects/mapick/mapickii/SKILL.md)

任务：

- 跑 `TC-P1`：验证 API Key / SSH 私钥 / 手机号脱敏
- 跑 `TC-P2`：`consent-decline` 后验证 local-only
- 跑 `TC-P3`：consent 未设置时验证 `search/recommend`
- 跑 `TC-P4`：验证 `trust/untrust`
- 跑 `TC-P5`：验证 `delete-all --confirm`

如果测试失败：

- 在 shell 层增加显式拦截
- 调整 `privacy status` 文案
- 修复本地配置与远程状态不同步

验收：

- 隐私状态、实际能力、删除结果三者一致

### 4. Device Fingerprint 隐藏

目标：

- 普通用户路径中不再暴露内部标识

主要改动点：

- [scripts/shell.js](/Users/evan/projects/mapick/mapickii/scripts/shell.js)
- [SKILL.md](/Users/evan/projects/mapick/mapickii/SKILL.md)
- [README.md](/Users/evan/projects/mapick/mapickii/README.md)

任务：

- 从普通 `help` 输出移除 fingerprint
- 保留独立 `id` 或 debug-only 入口
- 检查 README / 文案中是否对外暴露

验收：

- 普通用户执行 `help` 时不再看到 device fingerprint

### 5. 与后端一致性联调

目标：

- Skill 端展示与后端真实数据保持一致

主要改动点：

- [scripts/shell.js](/Users/evan/projects/mapick/mapickii/scripts/shell.js)
- [SKILL.md](/Users/evan/projects/mapick/mapickii/SKILL.md)

任务：

- 对齐 `status` 与 `report` 的数据读取和展示逻辑
- 对齐 consent 状态和实际接口可用性
- 对齐安全评分失败时的展示策略

验收：

- 不再出现 status / report / privacy 展示互相矛盾的情况

## 测试建议

- 首次安装体验脚本
- 人格低数据量展示回归
- `help` 输出检查
- 隐私 5 条补测
- 与后端联调 smoke test

## 执行顺序

1. 部署新版 `SKILL.md`
2. Onboarding 前端化呈现
3. 隐私链路补测与行为修复
4. Device Fingerprint 隐藏
5. 与后端一致性联调

