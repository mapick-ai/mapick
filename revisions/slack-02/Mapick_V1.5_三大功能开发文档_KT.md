# Mapick V1.5 三大功能开发文档

> 日期：2026-04-23
> 开工：2026-04-27
> 参考：Mercury Agent（token budget + soul system）、OpenClaw message/cron 工具
> 基于：V1 代码库（PR-6~PR-16 已合入）

---

## 总览

| 功能 | 一句话 | 用户得到什么 |
|------|--------|-------------|
| 🔔 主动通知 | Mapick 在用户不说话的时候主动推消息 | 不用记得打开 Mapick，该知道的事它自己告诉你 |
| 💰 Token 透明化 | 告诉用户每个 Skill 花了多少钱 | 知道钱花在哪了，自己决定留什么删什么 |
| ⚙️ 用户偏好 | 用自然语言设置通知时间、语言、自动化规则 | 「每天早上 9 点推摘要」「周末别烦我」一句话搞定 |

三个功能互相依赖：通知是基础设施，token 透明化是通知的内容来源之一，用户偏好控制通知的时间和方式。

---

## 功能一：🔔 主动通知

### 1.1 做什么

Mapick 利用 OpenClaw 内置的 `cron`（定时任务）+ `message`（消息推送）工具，在用户不主动对话的时候推送关键信息到 Telegram/Discord 等渠道。

### 1.2 参考来源

- **Mercury Agent**: 内置 heartbeat 系统 + cron scheduling + proactive notifications，daemon 模式下自动推送。
- **OpenClaw 用户实践**: 已有用户用 cron + message 做每日早报推送 Telegram（参考 WenHao Yu 的教程：「每天 6:47 收到 Daily Brief」）。
- **OpenClaw notify Skill**: `openclaw gateway wake --text "消息" --mode now` 一行命令推送。

### 1.3 用户得到什么

```
早上 9:00 Telegram 收到：
  📊 Mapick 昨日摘要
  Skill 调用 47 次 · 最常用 github (18x)
  💰 预估消耗 $1.2
  ⚠️ 2 个新僵尸（csv-converter 连续 30 天未用）
  🆕 发现 1 个匹配你工作流的新 A 级 Skill

即时推送：
  🚨 你装的 super-helper 刚被降级到 C 级
  发现 eval() 注入，建议换成 safe-helper
  回复「替换」一键操作
```

用户从「我记得打开 Mapick 才能用」变成「Mapick 自己会告诉我该知道的事」。

### 1.4 通知类型

| 类型 | 触发条件 | 频率 | 默认 |
|------|---------|------|------|
| 每日摘要 | cron 每天 09:00 | 1次/天 | 开启 |
| 每周报告 | cron 每周一 09:00 | 1次/周 | 开启 |
| 僵尸提醒 | Skill 连续 30 天未用 | 检测到时 | 开启 |
| 安全降级 | 已装 Skill 被降级到 C 级 | 即时 | 开启 |
| 新 Skill 匹配 | 新 A 级 Skill 匹配用户 profile tags | 最多1次/天 | 开启 |
| Token 异常 | 当日消耗超过 7 日均值 3 倍 | 即时 | 开启 |

### 1.5 代码改动

#### SKILL.md — 新增 §9 Proactive Notifications

```markdown
## 9. Proactive Notifications

### Setup (on first install, after consent-agree)

After user grants consent, automatically configure these cron jobs
using OpenClaw's built-in cron tool:

1. Daily summary — every day at user's preferred time (default 09:00)
   Trigger: `bash shell.sh notify daily-summary`
   Delivery: `openclaw message send --channel <user_channel> --target <user_target> --message "<summary>"`

2. Weekly report — every Monday at user's preferred time
   Trigger: `bash shell.sh notify weekly-report`

3. Security alert — checked every 6 hours
   Trigger: `bash shell.sh notify security-check`

4. Zombie alert — checked daily at 10:00
   Trigger: `bash shell.sh notify zombie-check`

### Cron setup command

On first install (after consent), AI should run:

  openclaw cron add --name "mapick-daily" --schedule "0 9 * * *" \
    --command "bash ~/.openclaw/skills/mapick/scripts/shell.sh notify daily-summary"

  openclaw cron add --name "mapick-weekly" --schedule "0 9 * * 1" \
    --command "bash ~/.openclaw/skills/mapick/scripts/shell.sh notify weekly-report"

  openclaw cron add --name "mapick-security" --schedule "0 */6 * * *" \
    --command "bash ~/.openclaw/skills/mapick/scripts/shell.sh notify security-check"

  openclaw cron add --name "mapick-zombie" --schedule "0 10 * * *" \
    --command "bash ~/.openclaw/skills/mapick/scripts/shell.sh notify zombie-check"

Store cron setup status in CONFIG.md: `cron_configured: true`

### Rendering notifications

Notifications go through `openclaw message send`. Format:
- Short, actionable, one screen
- Include one CTA (e.g. "回复「清理」处理僵尸")
- Respect user's language preference
- Respect quiet hours (see §11 User Preferences)
```

#### shell.sh — 新增 notify 子命令

```bash
notify)
  case "$2" in
    daily-summary)
      # 1. Read CONFIG.md for user preferences (language, quiet hours)
      # 2. Call backend: GET /user/:userId/daily-summary
      #    Returns: { calls_today, top_skills, token_estimate, new_zombies, new_matches }
      # 3. Format message
      # 4. Send via: openclaw message send --channel $CHANNEL --target $TARGET --message "$MSG"
      
      CONFIG_PATH="$(dirname "$0")/../CONFIG.md"
      PREFS=$(python3 -c "
import json
config = json.load(open('$CONFIG_PATH'))
prefs = config.get('preferences', {})
print(json.dumps({
  'language': prefs.get('language', 'en'),
  'channel': prefs.get('notify_channel', 'telegram'),
  'target': prefs.get('notify_target', ''),
  'quiet_start': prefs.get('quiet_start', '22:00'),
  'quiet_end': prefs.get('quiet_end', '08:00'),
}))
")
      
      # Check quiet hours
      CURRENT_HOUR=$(date +%H)
      QUIET_START=$(echo "$PREFS" | jq -r '.quiet_start' | cut -d: -f1)
      QUIET_END=$(echo "$PREFS" | jq -r '.quiet_end' | cut -d: -f1)
      if [ "$CURRENT_HOUR" -ge "$QUIET_START" ] || [ "$CURRENT_HOUR" -lt "$QUIET_END" ]; then
        echo '{"status":"skipped","reason":"quiet_hours"}'
        exit 0
      fi
      
      # Get summary from backend
      DEVICE_FP=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('device_fp',''))")
      SUMMARY=$(curl -s "${MAPICKII_API_BASE}/user/${DEVICE_FP}/daily-summary" \
        -H "api-key: ${API_KEY}" \
        -H "api-secret: ${API_SECRET}")
      
      # Format and send
      CHANNEL=$(echo "$PREFS" | jq -r '.channel')
      TARGET=$(echo "$PREFS" | jq -r '.target')
      MSG=$(python3 -c "
import json
s = json.loads('$SUMMARY')
lines = ['📊 Mapick Daily Summary']
lines.append(f'Skill calls: {s.get(\"calls_today\", 0)}')
if s.get('top_skills'):
    lines.append('Top: ' + ', '.join([f'{x[\"name\"]} ({x[\"count\"]}x)' for x in s['top_skills'][:3]]))
if s.get('token_estimate'):
    lines.append(f'💰 Est. cost: \${s[\"token_estimate\"]:.2f}')
if s.get('new_zombies', 0) > 0:
    lines.append(f'⚠️ {s[\"new_zombies\"]} new zombie(s)')
if s.get('new_matches', 0) > 0:
    lines.append(f'🆕 {s[\"new_matches\"]} new skill match(es)')
print('\n'.join(lines))
")
      
      if [ -n "$TARGET" ]; then
        openclaw message send --channel "$CHANNEL" --target "$TARGET" --message "$MSG"
        echo '{"status":"sent","channel":"'$CHANNEL'"}'
      else
        echo '{"status":"skipped","reason":"no_target_configured"}'
      fi
      ;;
      
    weekly-report)
      # Similar to daily but with weekly aggregation
      # Call: GET /user/:userId/weekly-report
      ;;
      
    security-check)
      # Call: GET /user/:userId/security-alerts
      # If any installed skill got downgraded → send alert immediately
      ;;
      
    zombie-check)
      # Call: GET /user/:userId/zombies
      # If new zombies since last check → send notification
      ;;
      
    setup)
      # Configure cron jobs via OpenClaw
      # Called once after consent-agree
      CONFIG_PATH="$(dirname "$0")/../CONFIG.md"
      PREFS=$(python3 -c "import json; print(json.dumps(json.load(open('$CONFIG_PATH')).get('preferences',{})))")
      DAILY_TIME=$(echo "$PREFS" | jq -r '.daily_time // "09:00"')
      HOUR=$(echo "$DAILY_TIME" | cut -d: -f1)
      MIN=$(echo "$DAILY_TIME" | cut -d: -f2)
      
      SHELL_PATH="$HOME/.openclaw/skills/mapick/scripts/shell.sh"
      
      openclaw cron add --name "mapick-daily" --schedule "$MIN $HOUR * * *" \
        --command "bash $SHELL_PATH notify daily-summary" 2>/dev/null
      openclaw cron add --name "mapick-weekly" --schedule "$MIN $HOUR * * 1" \
        --command "bash $SHELL_PATH notify weekly-report" 2>/dev/null
      openclaw cron add --name "mapick-security" --schedule "0 */6 * * *" \
        --command "bash $SHELL_PATH notify security-check" 2>/dev/null
      openclaw cron add --name "mapick-zombie" --schedule "0 10 * * *" \
        --command "bash $SHELL_PATH notify zombie-check" 2>/dev/null
      
      python3 -c "
import json
config = json.load(open('$CONFIG_PATH'))
config['cron_configured'] = True
json.dump(config, open('$CONFIG_PATH','w'), indent=2)
"
      echo '{"status":"configured","jobs":4}'
      ;;
      
    teardown)
      # Remove all Mapick cron jobs
      openclaw cron remove --name "mapick-daily" 2>/dev/null
      openclaw cron remove --name "mapick-weekly" 2>/dev/null
      openclaw cron remove --name "mapick-security" 2>/dev/null
      openclaw cron remove --name "mapick-zombie" 2>/dev/null
      echo '{"status":"removed"}'
      ;;
  esac
  ;;
```

#### 后端 — 新增 3 个接口

**文件：** `src/modules/user/user.controller.ts`

```typescript
@Get(':userId/daily-summary')
async getDailySummary(@Param('userId') userId: string) {
  return this.userService.getDailySummary(userId);
}

@Get(':userId/weekly-report')
async getWeeklyReport(@Param('userId') userId: string) {
  return this.userService.getWeeklyReport(userId);
}

@Get(':userId/security-alerts')
async getSecurityAlerts(@Param('userId') userId: string) {
  return this.userService.getSecurityAlerts(userId);
}
```

**文件：** `src/modules/user/user.service.ts`

```typescript
async getDailySummary(userId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Count today's invocations
  const callsToday = await this.userEventRepo.count({
    where: { userId, action: 'skill_invoke', createdAt: MoreThanOrEqual(today) },
  });
  
  // Top skills today
  const topSkills = await this.userEventRepo
    .createQueryBuilder('e')
    .select('e.skillId', 'name')
    .addSelect('COUNT(*)', 'count')
    .where('e.userId = :userId AND e.action = :action AND e.createdAt >= :today', 
      { userId, action: 'skill_invoke', today })
    .groupBy('e.skillId')
    .orderBy('count', 'DESC')
    .limit(3)
    .getRawMany();
  
  // New zombies since last notification
  const zombies = await this.getZombieSkills(userId);
  const newZombies = zombies.filter(z => z.daysSinceLastUse === 30).length;
  
  // New skill matches (from recommend cache)
  const newMatches = 0; // TODO: compare against last notified set
  
  return {
    calls_today: callsToday,
    top_skills: topSkills,
    token_estimate: null, // V2: parse session JSONL
    new_zombies: newZombies,
    new_matches: newMatches,
  };
}

async getSecurityAlerts(userId: string) {
  // Check if any installed skill's grade changed to C since last check
  const records = await this.skillRecordRepo.find({ where: { userId, isUninstalled: false } });
  const alerts = [];
  for (const r of records) {
    const security = await this.securityService.getOrScan(r.skillId);
    if (security?.grade === 'C') {
      alerts.push({
        skillId: r.skillId,
        grade: 'C',
        alternatives: security.alternatives || [],
      });
    }
  }
  return { alerts };
}
```

### 1.6 CONFIG.md 新增字段

```json
{
  "cron_configured": true,
  "cron_configured_at": "2026-04-27T09:00:00Z",
  "last_daily_sent": "2026-04-27T09:00:00Z",
  "last_weekly_sent": "2026-04-21T09:00:00Z",
  "last_security_check": "2026-04-27T06:00:00Z"
}
```

### 1.7 测试

```
测试 1：cron 配置
  操作：首次安装 → consent-agree → 检查 openclaw cron list
  预期：看到 4 个 mapick- 开头的 cron job

测试 2：每日摘要推送
  操作：手动触发 bash shell.sh notify daily-summary
  预期：Telegram 收到摘要消息，包含调用次数、top skills

测试 3：安全降级即时推送
  操作：模拟某个已装 Skill 评分降到 C 级
  预期：6 小时内收到 Telegram 推送

测试 4：静默时段
  操作：在 22:00-08:00 之间触发 daily-summary
  预期：跳过，不推送

测试 5：未配置通知目标
  操作：preferences 里没有 notify_target
  预期：跳过，返回 skipped + reason

测试 6：cron 卸载
  操作：bash shell.sh notify teardown
  预期：openclaw cron list 里没有 mapick- 开头的 job
```

---

## 功能二：💰 Token 透明化

### 2.1 做什么

解析 OpenClaw 的 session JSONL 日志，按 Skill 归因 token 消耗，告诉用户「哪个 Skill 最烧钱」。

### 2.2 参考来源

- **Mercury Agent**: `~/.mercury/token-usage.json` 追踪每日 token 用量，`/budget` 命令查看。70% 自动切换精简模式。
- **OpenClaw `/usage` 命令**: 已有 per-response 的 token 追踪，但不按 Skill 拆分。
- **openclaw-cost-tracker Skill**: 第三方 Skill 通过解析 session JSONL 做成本分析，证明这条路可行。
- **OpenClaw 官方文档**: `/context list` 可以看到 per-skill 的 context 占用。

### 2.3 用户得到什么

```
你：我花了多少钱？

mapick：💰 本月 Token 消耗报告

  总计：$42.70 · 12.5M tokens

  按 Skill 拆分：
  1. github-ops        $18.20 (43%)  ████████████░░ 活跃
  2. summarize          $8.50 (20%)  ██████░░░░░░░░ 活跃
  3. docker-manage      $5.10 (12%)  ████░░░░░░░░░░ 活跃
  4. capability-evolver $6.30 (15%)  █████░░░░░░░░░ 从未使用❗
  5. 其他 (13个)        $4.60 (10%)

  ⚠️ capability-evolver 从未使用但间接消耗 $6.30
  （它占 context 窗口，每次对话都要加载）
  清掉它每月省 ~$6

  今天 vs 平均：$2.10 / 日均 $1.42（正常）
```

不设上限，不替用户决定。只让用户看到钱花在哪了。

### 2.4 技术实现

OpenClaw 的 session 日志在 `~/.openclaw/sessions/` 目录下，每个 session 是一个 `.jsonl` 文件，每行包含 `usage.input_tokens` 和 `usage.output_tokens`。

Mapick 在本地解析这些日志，按时间窗口（日/周/月）归因到 Skill。归因逻辑：如果一条日志里出现了某个 Skill 的调用（tool call），那这条的 token 归到那个 Skill。如果没有 Skill 调用（纯对话），归到「系统/对话」分类。

**不精确但够用。** 用户要的不是精确到分的账单，要的是「谁最烧钱」的大方向。

### 2.5 代码改动

#### shell.sh — 新增 token 子命令

```bash
token)
  case "$2" in
    report)
      # Parse OpenClaw session JSONL files
      # Aggregate by skill, by day
      PERIOD="${3:-month}"  # day / week / month
      
      python3 << PYEOF
import json, os, glob
from datetime import datetime, timedelta
from collections import defaultdict

sessions_dir = os.path.expanduser("~/.openclaw/sessions")
period = "$PERIOD"

# Determine time window
now = datetime.utcnow()
if period == "day":
    cutoff = now - timedelta(days=1)
elif period == "week":
    cutoff = now - timedelta(weeks=1)
else:
    cutoff = now - timedelta(days=30)

# Parse all session files
skill_tokens = defaultdict(lambda: {"input": 0, "output": 0, "calls": 0})
total_input = 0
total_output = 0

for filepath in glob.glob(os.path.join(sessions_dir, "*.jsonl")):
    try:
        with open(filepath, 'r') as f:
            current_skill = None
            for line in f:
                try:
                    entry = json.loads(line)
                except:
                    continue
                
                # Check timestamp
                ts = entry.get("timestamp") or entry.get("ts")
                if ts:
                    try:
                        entry_time = datetime.fromisoformat(ts.replace("Z", "+00:00")).replace(tzinfo=None)
                        if entry_time < cutoff:
                            continue
                    except:
                        pass
                
                # Detect skill usage from tool calls
                tool_name = entry.get("tool") or entry.get("name")
                if tool_name:
                    # Map tool calls to skill IDs
                    current_skill = tool_name.split(".")[0] if "." in tool_name else tool_name
                
                # Aggregate token usage
                usage = entry.get("usage", {})
                inp = usage.get("input_tokens", 0)
                out = usage.get("output_tokens", 0)
                
                if inp > 0 or out > 0:
                    skill = current_skill or "_system"
                    skill_tokens[skill]["input"] += inp
                    skill_tokens[skill]["output"] += out
                    skill_tokens[skill]["calls"] += 1
                    total_input += inp
                    total_output += out
    except:
        continue

# Estimate cost (using Sonnet pricing as default)
# Input: $3/1M, Output: $15/1M
INPUT_PRICE = 3.0 / 1_000_000
OUTPUT_PRICE = 15.0 / 1_000_000

results = []
for skill, data in skill_tokens.items():
    cost = data["input"] * INPUT_PRICE + data["output"] * OUTPUT_PRICE
    results.append({
        "skill": skill,
        "input_tokens": data["input"],
        "output_tokens": data["output"],
        "total_tokens": data["input"] + data["output"],
        "calls": data["calls"],
        "estimated_cost": round(cost, 2),
    })

results.sort(key=lambda x: x["estimated_cost"], reverse=True)
total_cost = sum(r["estimated_cost"] for r in results)

print(json.dumps({
    "intent": "token:report",
    "period": period,
    "total_input": total_input,
    "total_output": total_output,
    "total_tokens": total_input + total_output,
    "total_cost": round(total_cost, 2),
    "by_skill": results[:10],
    "daily_average": round(total_cost / max((now - cutoff).days, 1), 2),
}))
PYEOF
      ;;
      
    today)
      bash "$0" token report day
      ;;
  esac
  ;;
```

#### SKILL.md — 新增 §10 Token Transparency

```markdown
## 10. Token Transparency

### Intent: token / cost / spending

Reference triggers: how much am I spending, token usage, cost report,
what's eating my tokens, 花了多少钱, token消耗.

Match in ANY language.

Shell command: `bash shell.sh token report [day|week|month]`

### Rendering

When shell returns token report:

1. Show total cost + total tokens for the period
2. Break down by skill, sorted by cost descending
3. For each skill, show:
   - Cost + percentage of total
   - A simple bar chart (█ blocks)
   - Status label: "active" / "never used ❗" / "idle 30d+"
4. If any never-used or zombie skill has significant cost:
   "⚠️ <skill> never used but costs $X/month (context overhead)"
   "Clean it to save ~$X"
5. Show today vs daily average — flag if 3x above normal:
   "⚠️ Today $6.30, your daily average is $1.42 — something burning?"

NEVER set limits or block usage. Only inform. User decides what to do.
```

### 2.6 测试

```
测试 1：基本报告
  操作：bash shell.sh token report month
  预期：返回 JSON，total_cost > 0，by_skill 非空

测试 2：无 session 日志
  操作：清空 sessions 目录后运行
  预期：返回 total_cost: 0，by_skill: []，不报错

测试 3：僵尸 Skill 标记
  操作：有一个从未调用但占 context 的 Skill
  预期：by_skill 里出现，标记为 never used

测试 4：异常消耗检测
  操作：模拟当日消耗 3 倍以上日均
  预期：daily-summary 通知里包含异常提醒

测试 5：多模型定价
  操作：用户切换过模型（Sonnet → Haiku）
  预期：成本估算反映不同模型的定价（V2 做精确，V1.5 用默认定价）
```

---

## 功能三：⚙️ 用户偏好

### 3.1 做什么

让用户用自然语言设置 Mapick 的行为：通知时间、语言、静默时段、自动化规则。存在 CONFIG.md 里，所有其他功能读取并遵守。

### 3.2 参考来源

- **Mercury Agent**: `soul.md` / `persona.md` / `taste.md` / `heartbeat.md` 四文件系统，用户用纯文本定义 Agent 行为。
- **核心区别**: Mercury 的 soul 文件定义 Agent 人格（怎么说话）。Mapick 的偏好定义用户规则（什么时候通知我、用什么语言、关注什么类型的 Skill）。

### 3.3 用户得到什么

```
你：每天早上 9 点给我推昨天的摘要
mapick：✅ 已设置。每天 09:00 推送昨日摘要。

你：用中文回复我
mapick：✅ 以后都用中文。

你：周末别烦我
mapick：✅ 周六周日不推任何通知。

你：新出的数据分析类 A 级 Skill 通知我
mapick：✅ 有匹配的新 A 级 Skill 时会通知你。

你：看下我的设置
mapick：⚙️ 你的 Mapick 偏好
  语言：中文
  通知时间：每天 09:00
  通知渠道：Telegram
  静默时段：22:00 - 08:00
  周末通知：关闭
  关注类型：数据分析
  Token 异常提醒：开启（>3x 日均）
```

### 3.4 代码改动

#### shell.sh — 新增 preferences 子命令

```bash
preferences)
  CONFIG_PATH="$(dirname "$0")/../CONFIG.md"
  
  case "$2" in
    get)
      python3 -c "
import json
config = json.load(open('$CONFIG_PATH'))
prefs = config.get('preferences', {
  'language': 'en',
  'daily_time': '09:00',
  'notify_channel': 'telegram',
  'notify_target': '',
  'quiet_start': '22:00',
  'quiet_end': '08:00',
  'weekend_notify': False,
  'watch_categories': [],
  'token_alert_multiplier': 3,
})
print(json.dumps({'intent': 'preferences:get', 'data': prefs}))
"
      ;;
      
    set)
      KEY="$3"
      VALUE="$4"
      python3 -c "
import json
config = json.load(open('$CONFIG_PATH'))
prefs = config.get('preferences', {})
key = '$KEY'
value = '$VALUE'

# Type coercion
if value.lower() in ('true', 'yes', 'on'): value = True
elif value.lower() in ('false', 'no', 'off'): value = False
elif value.isdigit(): value = int(value)

prefs[key] = value
config['preferences'] = prefs
json.dump(config, open('$CONFIG_PATH', 'w'), indent=2)
print(json.dumps({'intent': 'preferences:set', 'key': key, 'value': value}))
"
      # If daily_time changed, update cron
      if [ "$KEY" = "daily_time" ]; then
        bash "$0" notify teardown
        bash "$0" notify setup
      fi
      ;;
      
    reset)
      python3 -c "
import json
config = json.load(open('$CONFIG_PATH'))
config.pop('preferences', None)
json.dump(config, open('$CONFIG_PATH', 'w'), indent=2)
print(json.dumps({'intent': 'preferences:reset'}))
"
      ;;
  esac
  ;;
```

#### SKILL.md — 新增 §11 User Preferences

```markdown
## 11. User Preferences

### Intent: preferences / settings

Reference triggers: settings, preferences, configure, set language,
notification time, quiet hours, 设置, 偏好, 通知时间, 别烦我.

Match in ANY language.

### Natural language mapping

AI must parse natural language preference requests and map to shell commands:

| User says | Shell command |
|-----------|--------------|
| "每天早上 9 点推摘要" | preferences set daily_time 09:00 |
| "用中文" | preferences set language zh |
| "周末别烦我" | preferences set weekend_notify false |
| "新数据分析 Skill 通知我" | preferences set watch_categories data-analysis |
| "看下我的设置" | preferences get |
| "恢复默认" | preferences reset |
| "晚上 10 点到早上 8 点别发" | preferences set quiet_start 22:00, preferences set quiet_end 08:00 |
| "通知发到 Discord" | preferences set notify_channel discord |

AI should confirm each change with one line, not ask for confirmation.
Changes take effect immediately.

If user changes daily_time, AI should also run `notify teardown` then
`notify setup` to update the cron schedule.

### Rendering (preferences:get)

Show a clean settings card, translated to user's language:
  ⚙️ Your Mapick Preferences
  Language: <language>
  Daily summary: <daily_time>
  Notification channel: <notify_channel>
  Quiet hours: <quiet_start> - <quiet_end>
  Weekend notifications: <on/off>
  Watch categories: <list or "none">
  Token anomaly alert: <on/off> (>Nx daily average)
```

### 3.5 CONFIG.md preferences 结构

```json
{
  "preferences": {
    "language": "zh",
    "daily_time": "09:00",
    "notify_channel": "telegram",
    "notify_target": "@username",
    "quiet_start": "22:00",
    "quiet_end": "08:00",
    "weekend_notify": false,
    "watch_categories": ["data-analysis", "devops"],
    "token_alert_multiplier": 3
  }
}
```

### 3.6 测试

```
测试 1：自然语言设置
  操作：跟 Agent 说「每天早上 8 点推摘要」
  预期：preferences.daily_time 变成 08:00，cron 更新

测试 2：语言切换
  操作：「用日语回复」
  预期：preferences.language 变成 ja，后续回复用日语

测试 3：静默时段
  操作：「晚上 11 点到早上 7 点别发通知」
  预期：quiet_start=23:00, quiet_end=07:00

测试 4：查看设置
  操作：「看下我的设置」
  预期：显示完整偏好卡片

测试 5：重置
  操作：「恢复默认设置」
  预期：preferences 被删除，下次读取走默认值

测试 6：cron 联动
  操作：改 daily_time → 检查 openclaw cron list
  预期：mapick-daily 的 schedule 更新了
```

---

## 改动汇总

### 文件清单

| 文件 | 改动 | 归属 |
|------|------|------|
| `SKILL.md` | 新增 §9 §10 §11 三节 | Skill 端 |
| `scripts/shell.sh` | 新增 notify / token / preferences 三组子命令 | Skill 端 |
| `src/modules/user/user.controller.ts` | 新增 3 个 GET 接口 | 后端 |
| `src/modules/user/user.service.ts` | 新增 getDailySummary / getWeeklyReport / getSecurityAlerts | 后端 |
| `CONFIG.md` | 新增 preferences + cron_configured + last_*_sent 字段 | Skill 端 |

### 不改的

- 现有 V1 功能全部不动（推荐/清理/安全/隐私/人格/套装/onboarding）
- 后端数据库不加新表，不加 migration
- README 不改（V1.5 功能稳定后再更新）
- 官网不改（同上）

---

## README / GIF / 官网更新计划

**现在不改。** 等三个功能开发完、测试通过、实际跑了一周之后再更新。原因：

1. 通知效果要看真实推送截图，不是模拟 GIF 能展示的
2. Token 报告的数据要真实 session 日志才准，模拟数据不可信
3. 用户偏好的自然语言解析质量要实测才知道

**一周后更新内容：**

README 新增：
- 🔔 Proactive Notifications 功能段 + 真实 Telegram 推送截图
- 💰 Token Transparency 功能段 + 真实消耗报告截图
- ⚙️ User Preferences 功能段 + 对话示例

GIF 新增：
- notification.gif — Telegram 收到每日摘要的真实截图
- token.gif — token 报告终端动画
- preferences.gif — 自然语言设置偏好终端动画

官网：
- 「Six things Mapick does」改成「Nine things」或者保持六个把新功能合并进现有段落
- 是否改官网取决于这三个功能的实际体验——如果用户反馈好就加，反馈一般就先不放

---

## 执行顺序

```
Day 1（4月27日）：
  上午：shell.sh preferences 子命令 + SKILL.md §11    2h
  下午：shell.sh notify 子命令 + SKILL.md §9          3h
  晚上：后端 3 个接口                                   2h

Day 2（4月28日）：
  上午：shell.sh token 子命令 + SKILL.md §10           2h
  下午：cron 配置联调（确认 openclaw cron 能跑通）      2h
  晚上：通知推送联调（确认 Telegram 能收到）            2h

Day 3（4月29日）：
  全天：测试 18 个场景（6+5+6+1 集成测试）              4h
  修 bug                                                2h

Day 4（4月30日）：
  上午：内测（自己用一天看效果）
  下午：根据实际效果调整通知频率、话术
  晚上：合入 dev 分支
```

总工时：约 3 天。第 4 天是内测和调整。

---

_Jms · 2026-04-23_
