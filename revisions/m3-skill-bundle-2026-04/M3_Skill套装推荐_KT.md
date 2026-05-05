# M3 — Skill 套装推荐模块

> **所属产品**：Mapick
> **模块版本**：v2.0
> **优先级**：P1（V2 上线）
> **文档日期**：2026-03-26
> **变更说明**：v1.0 → v2.0：移除韩股/日股套装和股市 Bot 联动、替换为通用开发者场景、交互改为消息形态、新增模型消耗预估（M8 联动）、Onboarding 改为对话流

---

## 一、模块定位

### 1.1 核心价值

套装推荐解决「单点推荐」的局限：用户不只需要一个 Skill，需要完成完整工作流的一套工具。

```
单点推荐：「你可能需要 Code Review AI」
套装推荐：「全栈开发者需要这 4 个 Skill 配合，你已经装了 2 个，补全另外 2 个，整套每月模型费约 $1.20」
```

套装推荐转化率高于单点推荐，因为：
1. 用户能理解「为什么是这些」（完整场景）
2. 已有的 Skill 形成沉没成本，促使补全
3. 套装有名字，增强身份认同（「我是全栈开发者」）
4. 模型费用透明，用户知道一套装下来花多少钱

---

## 二、初始套装库（V2 手工配置 11 套）

### 套装 1：全栈开发者

```yaml
bundle_id: fullstack_dev
name: 全栈开发者套装
description: 全栈 Web 开发的完整工具链
trigger_skills:
  - github-ops
  - docker-manager
skills:
  - id: github-ops
    name: GitHub Ops
    role: core
    required: true
    co_usage_rate: 1.0
    est_cost_per_invoke: 0.02
  - id: docker-manager
    name: Docker 管理
    role: essential
    co_usage_rate: 0.79
    est_cost_per_invoke: 0.01
  - id: cicd-pipeline
    name: CI/CD Pipeline
    role: essential
    co_usage_rate: 0.71
    est_cost_per_invoke: 0.02
  - id: code-review-ai
    name: AI 代码审查
    role: recommended
    co_usage_rate: 0.65
    est_cost_per_invoke: 0.05
target_users: 全栈 Web 开发者
est_monthly_cost: 1.20
```

### 套装 2：内容创作者

```yaml
bundle_id: content_creator
name: 内容创作者套装
description: 内容营销和文档工作的核心工具
trigger_skills:
  - doc-generator
  - seo-optimizer
skills:
  - id: doc-generator
    name: 文档生成
    role: core
    co_usage_rate: 0.85
    est_cost_per_invoke: 0.03
  - id: ppt-maker
    name: PPT 制作
    role: essential
    co_usage_rate: 0.72
    est_cost_per_invoke: 0.04
  - id: seo-optimizer
    name: SEO 优化
    role: recommended
    co_usage_rate: 0.66
    est_cost_per_invoke: 0.02
  - id: image-processor
    name: 图片处理
    role: optional
    co_usage_rate: 0.54
    est_cost_per_invoke: 0.01
target_users: 内容营销、文档工作者
est_monthly_cost: 0.90
```

### 套装 3：pnpm Monorepo 开发者

```yaml
bundle_id: pnpm_monorepo
name: pnpm Monorepo 开发者套装
description: 解决 pnpm workspace 常见痛点的工具组合
trigger_skills:
  - pnpm-workspace-helper
skills:
  - id: pnpm-workspace-helper
    name: pnpm Workspace Helper
    role: core
    co_usage_rate: 1.0
    est_cost_per_invoke: 0.01
  - id: lockfile-fixer
    name: 锁文件冲突修复
    role: essential
    co_usage_rate: 0.88
    est_cost_per_invoke: 0.01
  - id: cross-package-deps
    name: 跨包依赖管理
    role: recommended
    co_usage_rate: 0.74
    est_cost_per_invoke: 0.01
  - id: monorepo-publisher
    name: Monorepo 发布助手
    role: optional
    co_usage_rate: 0.61
    est_cost_per_invoke: 0.02
target_users: pnpm workspace 开发者
est_monthly_cost: 0.50
```

### 套装 4：数据分析师

```yaml
bundle_id: data_analyst
name: 数据分析师套装
description: 数据处理、可视化和报告生成全链路
trigger_skills:
  - data-analyzer
  - chart-generator
skills:
  - id: data-analyzer
    name: Data Analyzer
    role: core
    co_usage_rate: 1.0
    est_cost_per_invoke: 0.04
  - id: chart-generator
    name: Chart Generator
    role: essential
    co_usage_rate: 0.82
    est_cost_per_invoke: 0.03
  - id: csv-cleaner
    name: CSV Cleaner
    role: recommended
    co_usage_rate: 0.68
    est_cost_per_invoke: 0.01
  - id: report-builder
    name: Report Builder
    role: optional
    co_usage_rate: 0.55
    est_cost_per_invoke: 0.04
target_users: 数据分析师、BI 工程师
est_monthly_cost: 1.50
```

### 套装 5：DevOps 工程师

```yaml
bundle_id: devops_engineer
name: DevOps 工程师套装
description: 服务器运维、监控和部署自动化
trigger_skills:
  - server-monitor
  - log-analyzer
skills:
  - id: server-monitor
    name: Server Monitor
    role: core
    co_usage_rate: 1.0
    est_cost_per_invoke: 0.02
  - id: log-analyzer
    name: Log Analyzer
    role: essential
    co_usage_rate: 0.76
    est_cost_per_invoke: 0.03
  - id: deploy-automator
    name: Deploy Automator
    role: recommended
    co_usage_rate: 0.69
    est_cost_per_invoke: 0.02
  - id: backup-manager
    name: Backup Manager
    role: optional
    co_usage_rate: 0.52
    est_cost_per_invoke: 0.01
target_users: DevOps、SRE 工程师
est_monthly_cost: 0.80
```

### 套装 6：知识管理 / 第二大脑

```yaml
bundle_id: knowledge_mgmt
name: 第二大脑套装
description: 个人知识库搭建与智能笔记管理
trigger_skills:
  - obsidian
  - ontology
skills:
  - id: obsidian
    name: Obsidian 笔记集成
    role: core
    required: true
    co_usage_rate: 1.0
    est_cost_per_invoke: 0.01
  - id: summarize
    name: Summarize（摘要）
    role: essential
    co_usage_rate: 0.81
    est_cost_per_invoke: 0.02
  - id: ontology
    name: Ontology（知识图谱）
    role: recommended
    co_usage_rate: 0.63
    est_cost_per_invoke: 0.03
  - id: web-clipper
    name: Web Clipper
    role: optional
    co_usage_rate: 0.55
    est_cost_per_invoke: 0.01
target_users: 研究者、写作者、知识工作者
est_monthly_cost: 0.70
```

### 套装 7：自动化 / 工作流编排

```yaml
bundle_id: workflow_automation
name: 工作流自动化套装
description: 跨平台自动化与日常办公流程编排
trigger_skills:
  - n8n-workflow
  - composio
skills:
  - id: n8n-workflow
    name: n8n Workflow
    role: core
    required: true
    co_usage_rate: 1.0
    est_cost_per_invoke: 0.01
  - id: composio
    name: Composio（860+ 服务集成）
    role: essential
    co_usage_rate: 0.74
    est_cost_per_invoke: 0.02
  - id: cron-scheduler
    name: Cron Scheduler
    role: recommended
    co_usage_rate: 0.66
    est_cost_per_invoke: 0.01
  - id: webhook-manager
    name: Webhook Manager
    role: optional
    co_usage_rate: 0.51
    est_cost_per_invoke: 0.01
target_users: 非开发者自动化用户、运营人员
est_monthly_cost: 0.60
```

### 套装 8：研究 / 深度搜索

```yaml
bundle_id: deep_research
name: 深度研究套装
description: AI 搜索 + 内容分析 + 文献管理
trigger_skills:
  - tavily-search
  - exa-search
skills:
  - id: tavily-search
    name: Tavily Search（AI 搜索）
    role: core
    required: true
    co_usage_rate: 1.0
    est_cost_per_invoke: 0.02
  - id: exa-search
    name: Exa Search（开发者向搜索）
    role: essential
    co_usage_rate: 0.72
    est_cost_per_invoke: 0.02
  - id: summarize
    name: Summarize（长文摘要）
    role: essential
    co_usage_rate: 0.78
    est_cost_per_invoke: 0.02
  - id: citation-manager
    name: Citation Manager
    role: recommended
    co_usage_rate: 0.58
    est_cost_per_invoke: 0.01
target_users: 研究者、分析师、记者
est_monthly_cost: 0.90
```

### 套装 9：安全审计 / 逆向工程

```yaml
bundle_id: security_audit
name: 安全审计套装
description: 网络分析、代码审计和漏洞扫描工具链
trigger_skills:
  - reverse-engineering
  - skill-vetter
skills:
  - id: reverse-engineering
    name: Reverse Engineering（逆向分析）
    role: core
    required: true
    co_usage_rate: 1.0
    est_cost_per_invoke: 0.04
  - id: skill-vetter
    name: Skill Vetter（Skill 安全检查）
    role: essential
    co_usage_rate: 0.77
    est_cost_per_invoke: 0.02
  - id: network-analyzer
    name: Network Analyzer
    role: recommended
    co_usage_rate: 0.65
    est_cost_per_invoke: 0.03
  - id: vulnerability-scanner
    name: Vulnerability Scanner
    role: optional
    co_usage_rate: 0.53
    est_cost_per_invoke: 0.03
target_users: 安全工程师、渗透测试人员
est_monthly_cost: 1.20
```

### 套装 10：Google Workspace 办公

```yaml
bundle_id: google_workspace
name: Google Workspace 办公套装
description: Gmail + Calendar + Drive + Docs 全家桶自动化
trigger_skills:
  - gog
  - gmail-manager
skills:
  - id: gog
    name: Gog（Google Workspace 集成）
    role: core
    required: true
    co_usage_rate: 1.0
    est_cost_per_invoke: 0.02
  - id: gmail-manager
    name: Gmail Manager
    role: essential
    co_usage_rate: 0.83
    est_cost_per_invoke: 0.01
  - id: calendar-sync
    name: Calendar Sync
    role: recommended
    co_usage_rate: 0.71
    est_cost_per_invoke: 0.01
  - id: drive-organizer
    name: Drive Organizer
    role: optional
    co_usage_rate: 0.56
    est_cost_per_invoke: 0.01
target_users: 办公白领、项目经理
est_monthly_cost: 0.50
```

### 套装 11：多平台通信管理

```yaml
bundle_id: multi_platform_comm
name: 多平台通信管理套装
description: 跨平台消息聚合与自动化回复
trigger_skills:
  - telegram-bot
  - whatsapp-cli
skills:
  - id: telegram-bot
    name: Telegram Bot
    role: core
    required: true
    co_usage_rate: 1.0
    est_cost_per_invoke: 0.01
  - id: whatsapp-cli
    name: WhatsApp CLI
    role: essential
    co_usage_rate: 0.69
    est_cost_per_invoke: 0.01
  - id: slack-integration
    name: Slack Integration
    role: recommended
    co_usage_rate: 0.62
    est_cost_per_invoke: 0.01
  - id: elevenlabs-agent
    name: ElevenLabs Agent（语音通话）
    role: optional
    co_usage_rate: 0.44
    est_cost_per_invoke: 0.05
target_users: 社区管理员、客服、运营人员
est_monthly_cost: 0.80
```

---

## 三、套装推荐触发逻辑

### 3.1 触发条件（按优先级）

```
条件 1：用户装了套装中的 1-2 个 → 推荐补全
条件 2：用户的使用序列匹配套装场景 → 推荐整套
条件 3：用户自述角色/场景（Onboarding） → 推荐对应套装
条件 4：Pattern-Key 匹配套装场景 → 推荐整套
```

### 3.2 触发判断算法

```python
def check_bundle_triggers(user_id):
    installed_skills = get_installed_skills(user_id)
    triggered_bundles = []

    for bundle in get_all_bundles():
        installed_in_bundle = [s for s in bundle.skills if s.id in installed_skills]
        missing_in_bundle = [s for s in bundle.skills if s.id not in installed_skills]
        install_ratio = len(installed_in_bundle) / len(bundle.skills)

        # 装了 25%-75% → 推荐补全
        if 0.25 <= install_ratio < 1.0 and missing_in_bundle:
            triggered_bundles.append({
                'bundle': bundle,
                'installed': installed_in_bundle,
                'missing': missing_in_bundle,
                'trigger_type': 'partial_completion',
                'priority': install_ratio
            })
        # 装了触发 Skill → 立即推荐
        elif any(s.id in installed_skills for s in bundle.trigger_skills):
            triggered_bundles.append({
                'bundle': bundle,
                'installed': installed_in_bundle,
                'missing': missing_in_bundle,
                'trigger_type': 'trigger_skill_installed',
                'priority': 0.9
            })

    return sorted(triggered_bundles, key=lambda x: x['priority'], reverse=True)
```

---

## 四、消息交互设计

### 4.1 套装补全推荐

**触发：** 用户装了套装中的部分 Skill

**Mapick 消息：**

```
🗂️ 全栈开发者套装

你已经装了 2/4 个
✅ GitHub Ops
✅ Docker 管理
⬜ CI/CD Pipeline（搭配率 71%）— $0.02/次
⬜ AI 代码审查（搭配率 65%）— $0.05/次

为什么推荐？
79% 的全栈开发者同时在用这 4 个工具
整套每月模型费约 $1.20

回复「补全」一键安装缺少的 2 个
回复「1」只装 CI/CD Pipeline
回复「2」只装 AI 代码审查
回复「不用」跳过
```

### 4.2 整套推荐

**触发：** 用户序列匹配或 Onboarding 选择

**Mapick 消息：**

```
🗂️ 推荐：数据分析师套装

发现你的工作流与数据分析场景高度匹配

包含 4 个 Skill：
1. Data Analyzer（核心）— $0.04/次
2. Chart Generator（必配）— $0.03/次
3. CSV Cleaner（推荐）— $0.01/次
4. Report Builder（可选）— $0.04/次

整套每月模型费约 $1.50
12K 人在用 | 30 天整套留存 58%

回复「全装」一键安装 4 个
回复数字选装（如「1 2 3」）
回复「不用」跳过
```

### 4.3 Onboarding 对话流

用户首次使用 Mapick 时通过对话了解用户：

```
👋 我是 Mapick，你的 Skill 和模型管家。

先了解一下你，这样推荐会更准——

你主要用 OpenClaw 做什么？（回复数字，可多选）
1. 软件开发
2. 内容创作 / 营销
3. 数据分析
4. DevOps / 运维
5. 知识管理 / 笔记
6. 工作流自动化
7. 研究 / 搜索
8. 安全审计
9. 办公自动化（Gmail/日历/文档）
10. 多平台通信管理
11. 其他

💡 也可以跳过，直接说「推荐几个」
```

**用户回复：** 「1 4」

```
收到！你是做软件开发 + DevOps 的

为你匹配了 2 个套装：

🗂️ 全栈开发者套装（4 个 Skill，月模型费 $1.20）
🗂️ DevOps 工程师套装（4 个 Skill，月模型费 $0.80）

回复「看 1」看全栈开发者套装详情
回复「看 2」看 DevOps 套装详情
回复「全要」两套都装
回复「先不」跳过，以后再看

💡 你随时可以说「推荐套装」来看适合你的套装
```

---

## 五、动态套装生成（V4 功能）

V2 手工配置 5 套，V4 基于真实数据自动生成。

### 5.1 自动发现算法

```python
def discover_bundles_from_data():
    # 1. 计算所有 Skill 对的共现率
    co_occurrence_matrix = calculate_co_occurrence(all_users)

    # 2. 聚类：经常一起出现的 Skill 群组
    clusters = cluster_by_co_occurrence(
        matrix=co_occurrence_matrix,
        min_cluster_size=3,
        min_co_occurrence_rate=0.5
    )

    # 3. 过滤：只保留质量 > 6 的群组
    filtered = [c for c in clusters if all(s.quality_score > 6 for s in c)]

    # 4. AI 命名：为每个套装生成名称和描述
    named = [ai_name_bundle(cluster) for cluster in filtered]

    # 5. 计算模型消耗预估
    for bundle in named:
        bundle.est_monthly_cost = sum(
            get_avg_model_cost(s.id) * get_avg_monthly_invokes(s.id)
            for s in bundle.skills
        )

    return named
```

### 5.2 用户自定义套装（对话方式）

**用户说：** 「我想创建一个套装」

```
好的，来创建你的套装

套装名称叫什么？
```

**用户回复：** 「前端开发全家桶」

```
✅ 套装名称：前端开发全家桶

选择要包含的 Skill（回复 Skill 名称或从你已安装的里选）：
你已安装的 Skill 中，跟前端相关的有：
1. React Helper
2. CSS Debugger
3. Browser Testing
4. Vite Builder

回复数字选择（如「1 2 3 4」），或直接输入 Skill 名称
```

**用户回复：** 「1 2 3 4」

```
✅ 前端开发全家桶
包含：React Helper + CSS Debugger + Browser Testing + Vite Builder

要分享给社区吗？
1. 公开（让其他前端开发者发现）
2. 私人（仅自己使用）
```

**用户回复：** 「1」

```
✅ 套装已创建并公开分享！

前端开发全家桶
4 个 Skill | 预估月模型费 $0.80
已上架社区套装库

💡 你的套装被其他用户安装时，你会收到通知
```

---

## 六、数据模型

```typescript
interface Bundle {
  bundle_id: string
  name: string
  description: string
  target_users: string
  created_by: 'mapick' | 'community' | 'user'
  creator_user_id?: string

  skills: BundleSkill[]
  trigger_skill_ids: string[]

  // 模型消耗预估（M8 联动）
  est_monthly_cost: number           // 整套每月预估模型费

  // 统计
  install_count: number
  partial_install_count: number
  avg_retention_30d: number
  created_at: Date
  updated_at: Date
}

interface BundleSkill {
  skill_id: string
  skill_name: string
  role: 'core' | 'essential' | 'recommended' | 'optional'
  co_usage_rate: number
  is_required: boolean
  est_cost_per_invoke: number        // M8 联动：预估每次调用模型费
}

interface BundleTrigger {
  user_id: string
  bundle_id: string
  trigger_type: 'partial_completion' | 'trigger_skill' | 'onboarding' | 'pattern_key'
  installed_skill_ids: string[]
  missing_skill_ids: string[]
  shown_at?: Date
  action?: 'bulk_installed' | 'partial_installed' | 'individual_viewed' | 'dismissed'
}
```

---

## 七、成功指标

| 指标 | V2 目标 | V4 目标 |
|------|---------|---------|
| 套装推荐后「一键安装」率 | 15%+ | 25%+ |
| 套装推荐后「选装部分」率 | 20%+ | 15%+ |
| 套装安装后 30 日整套留存率 | 40%+ | 55%+ |
| 用户「套装完成度」平均值 | 60%+ | 75%+ |
| Onboarding 完成率 | 50%+ | 65%+ |
| 社区用户创建套装数（V4） | N/A | 20+ |

---

## 八、开发任务清单

```
V2（第 3-4 周）
[ ] 套装 YAML 配置系统
[ ] 配置初始 11 个套装（含模型消耗预估）
[ ] 套装触发检测逻辑
[ ] 套装推荐消息渲染（消息形态，非网页）
[ ] 「一键安装」和「选装」逻辑
[ ] Onboarding 对话流
[ ] 套装安装追踪

V4（用户 > 1,000）
[ ] 共现分析算法
[ ] 自动套装发现
[ ] 用户自定义套装（对话创建）
[ ] 社区套装分享
[ ] AI 套装命名和描述生成
[ ] 套装模型消耗自动计算
```

---

*M3 模块文档 v2.0_KT | Mapick | 2026-03-26*
