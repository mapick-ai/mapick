三个重要更新：
每个功能都写了：做什么 → 从哪参考的 → 用户得到什么 → 改哪些文件 → 具体代码 → 怎么测。
README/GIF/官网现在不改。 等三个功能跑一周有真实数据（真实 Telegram 推送截图、真实 token 报告、真实偏好设置对话）再更新。模拟的 GIF 没有真实截图有说服力。（@kim 记得下提醒调整）
三个功能的「卧槽」点：
:bell: 通知 — 不是推报表，是推洞察
每日摘要不说「调用 47 次」，说「你的 AI 昨天干了不少活。github 扛了大头（18 次）——你是 OpenClaw 上前 5% 的 github 用户。」然后塞一个用户没想到的发现：「你这周用 summarize 比上周多了 3 倍，开始做研究了？如果是的话你应该试试 deep-research-agent。」
安全降级不说「安全警报：Skill 被降级」，说「你装的一个 Skill 刚被标记了。super-helper 检测到 eval() 注入。它能读你的对话。我建议换掉。说 ‘replace super-helper’ 我 10 秒帮你搞定。」
Token 异常不说「消耗超标」，说「你的 AI 今天在烧钱。现在才下午 2 点已经花了 $6.30，你日均 $1.42。github-ops 过去一小时调了 47 次（正常是 12 次），可能卡循环了。」
:moneybag: Token 透明化 — 不是给账单，是给 X 光片
每个 Skill 旁边不只写金额，写一句话叙事：「你的主力，每分钱都值」「从未使用，但每次对话都在给它付钱」「这周用量涨了 40%——新项目？」
僵尸 Skill 的成本用情感化的语言标出来：「$6.30/月，一分钱没用过。去掉它等于每月请自己吃一顿午饭。」
:gear: 用户偏好 — 不是确认设置，是展示体验变化
用户说「每天 9 点推摘要」，不回「:white_check_mark: daily_time set to 09:00」，回「:white_check_mark: 从明天开始：:sunny: 09:00 你的 Telegram 会收到每日简报。包含：昨日数据、成本检查、新发现。」然后展示所有当前生效的设置，最后提醒「随时用自然语言改——不用记命令。」
核心原则就一条：每个输出都要让用户觉得 Mapick 比他自己更了解他的 AI 使用情况。
以下为：功能开发测试文档+提示词优化文档



27 个测试用例跑完了，看到了完整的截图和报告。整体评价：
好的部分：
搜索功能是亮点——TC05 那张截图很强，用户说「帮我找一个做数据分析和可视化的 Skill」，Mapick 返回 9 个 Skill 按「数据分析核心/数据可视化」两组分类，底部还给了推荐组合（综合首选 / Python 用户 / Excel 用户 / 仪表板需求），这个交互已经超过预期。
状态、清理、工作流、日报、周报都在数据不足时优雅降级了——没有瞎编数据，诚实说「需要更多使用数据」。Delete-all 的安全防护也到位——要求二次确认，没有误删。
要修的 5 个问题：
1. 推荐接口返回 Azure 垃圾数据（TC04） — /mapickii recommend 返回的全是 Azure 相关 Skill（azure-ai、azure-cost-optimization、azure-deploy），安装量都是 15 万+，跟用户场景完全无关。这是后端 sync 数据问题——数据源里 Azure Skill 被刷量了，推荐算法按 popularity 排序就全是 Azure。需要在推荐算法里加去重逻辑（同一个 publisher 的 Skill 最多出 2 个）+ 降低纯 popularity 权重。
2. 安全评分后端 401（TC09/TC10） — security 接口返回 401，Agent 只能做 fallback 的启发式分析。让工程师查后端的 auth 配置——可能是 API Key/Secret 没传对，或者 security 接口的鉴权逻辑跟其他接口不一致。
3. 人格报告全是零还出完整报告（TC21/TC22） — 我们在 SKILL.md 里已经改了这个——数据不够时应该出「:lock: Your persona is brewing...」卡片，不是全是零的报告。工程师是不是还没部署新的 “SKILL4-8修定.md”（见下面）？
4. 人格报告和状态的 Skill 数量不一致 — status 显示 6 个已安装，report 显示 0 个。说明 report 和 status 读的数据源不同——一个读本地 scan，一个读后端。需要统一数据源。
5. help 暴露了 device fingerprint — 不应该在普通 help 输出里显示设备指纹。这是内部标识符，用户不需要看到。移到 debug 模式下。
优先级： 1（推荐数据质量）> 2（401 修复）> 3（部署新 SKILL.md）> 4（数据源一致性）> 5（指纹隐藏）。

TC07 和 TC08 测了隐私状态查看。
但只测了「查看」，没测「保护」。
测了的：

查看 consent 状态（未设置）
查看脱敏引擎状态（已启用）
查看受信任 Skill 列表（空）
没测的：

redact.py 实际脱敏效果——传一段含 API Key 的文本进去，出来是不是 [REDACTED]
consent-agree 之后行为变化——同意前 vs 同意后，recommend/search 是否有差异
consent-decline 之后 local-only 模式——推荐和搜索是否真的被禁用
trust/untrust 实际效果——信任一个 Skill 后它是不是真的能看到未脱敏内容
delete-all 执行后验证——报告里说了「没执行」，所以不知道实际删没删干净
报告里还发现一个问题：TC07 显示 consent 未设置但 search/recommend 仍然可用。如果设计意图是「不同意就不能用推荐」，这就是一个 bug——用户没同意隐私条款就能调后端接口了。
需要补的隐私测试：
TC-P1：redact.py 脱敏验证
  输入：含 OpenAI API Key + SSH 密钥 + 手机号的文本
  预期：全部替换为 [REDACTED]

TC-P2：consent-decline 后 local-only
  操作：执行 consent-decline → 再试 /mapickii recommend
  预期：拒绝，提示「需要同意隐私条款」

TC-P3：consent 未设置时接口行为
  操作：不设置 consent → 调 search/recommend
  预期：按设计——要么允许（宽松模式）要么拒绝（严格模式），但要跟 privacy status 的展示一致

TC-P4：trust/untrust
  操作：trust github → 检查 github 是否免脱敏
  预期：trust 列表里出现 github

TC-P5：delete-all 完整执行
  操作：执行 delete-all --confirm → 检查 CONFIG.md + 后端数据
  预期：本地和后端全部清空让工程师补跑这 5 个。特别是 TC-P3——如果 consent 没设置但推荐能用，要么1）改代码要么  2 ）改 privacy status 的展示文案（改展示文档吧evan @Evan），不能自相矛盾。
[中午 11:09]Claude评价：现在上线还不能让用户来句：卧槽牛逼！
现在上线社区的反应会是「哦，又一个 Skill 推荐工具」，不是「卧槽」。
原因很直接：
推荐返回的是 Azure 垃圾。 这是用户第一次体验 Mapick 最可能触发的功能，结果推出来 5 个 Azure Skill，每个安装量 15 万——明显是刷的。用户第一反应是「这什么垃圾推荐」，直接卸载。推荐数据质量不修好就上线等于自杀。
人格报告全是零。 用户装完第一件事就是想看「分析我」，结果使用天数 0、对话次数 0、活跃技能 0。我们改的「brewing 卡片」还没部署上去。全是零的报告没人想分享。
安全评分后端 401。 用户问「这个 Skill 安全吗」，后端挂了只能做 fallback 分析。安全评分是我们 README 里写的四大卖点之一，挂了就是虚假宣传。
onboarding 汇总还没接上。 我们定的「装完第一次对话先出诊断汇总 + 问工作流」，PR-16 代码已合入但还没实际跑通。用户装完只看到一个普通的状态页，没有「卧槽它扫出我有 19 个僵尸」的震撼。
要让社区「卧槽」，至少修好这 4 个再上线：

推荐数据——去掉 Azure 刷量的垃圾，加同 publisher 去重
部署新 SKILL.md——人格 brewing 卡片 + 推荐连接工作流 + 僵尸清理的羞耻感话术
修 security 401
onboarding 汇总跑通
修完这 4 个，用户装完的体验是：「扫出我 19 个僵尸吃了 40% context → 问我做什么工作 → 推了 3 个正好是我缺的 → 安全评分全是 A → 一键装完」。这个流程跑通才有「卧槽」。

有几个小问题，稍等下
[上午 9:44]进步很大。v1 到 v2 的对比：
已修复：
:white_check_mark: 推荐质量 — Azure 垃圾没了，返回 OpenClaw 相关 Skill
:white_check_mark: help 不再暴露设备指纹
:white_check_mark: 人格报告和 status 的 Skill 数量一致了（都是 1）
:white_check_mark: 错误文案大幅改善 — bundle 401 现在给出 consent-agree 1.0 引导

:white_check_mark: typo 自动纠错 — /mapikii staus 自动修正
:white_check_mark: 多语言工作 — 中英文 NL 都命中正确意图
还没修好的 3 个问题，按优先级：
P0：Consent gate 不一致。 自然语言说「推荐几个」被 consent 拦截（正确），但 /mapickii recommend 命令模式不拦截直接返回结果（错误）。同时 privacy status 写着「推荐功能不可用」但命令模式实际能用。这是信任问题——你说不可用但实际可用，用户发现了就不信你的隐私承诺了。 修法：shell.sh 的 recommend 命令在执行前检查 CONFIG.md 的 consent_status，未同意就拒绝并引导。
P1：安全评分后端仍然 401。 两轮测试都是 401，本地 fallback 分析虽然详尽但不是真正的安全扫描。这是 README 四大卖点之一，不能一直挂着。让工程师查 security 接口的鉴权——可能跟其他接口用的 API Key 格式不一样。
P2：status 仍暴露设备指纹。 help 修了但 status 没修。统一处理——指纹只在 /mapickii privacy fingerprint 显示，其他命令不显示。
上线评估：
P0 的修改量很小——shell.sh 里 recommend 和 bundle 命令前加一个 consent 检查，半小时的活。修完再跑一次 TC04 和 TC08 确认一致就行。[上午 9:45]P1---先查清楚 401 的根因——是鉴权配置问题还是接口本身有 bug。找到根因了。
问题很清楚： shell.sh 调的是 /skill/:id/security（走 SecuritySkillController，用 DeviceFpGuard），但它只传了 x-device-fp header。而后端的 SecuritySkillController 第 28 行确实用的是 DeviceFpGuard——**理论上应该能过。**找到根因了。
问题是全局路径前缀。 后端设了 app.setGlobalPrefix("api/v1")，所以 security 接口的实际路径是 /api/v1/skill/:skillId/security。
但 shell.sh 的 API_BASE 已经是 https://api.mapick.ai/v1，调用时拼的路径是 /skill/${skill_id}/security，最终请求的 URL 是 https://api.mapick.ai/v1/skill/${skill_id}/security。
如果后端的前缀是 /api/v1 而 shell.sh 发到的是 /v1/skill/...，路径就对不上。
让工程师排查这两步：
第一步：确认实际 URL 是否能通。 在服务器上直接 curl 测试：
# 测试 1：shell.sh 实际调用的路径
curl -v https://api.mapick.ai/v1/skill/github/security

# 测试 2：加上 /api 前缀
curl -v https://api.mapick.ai/api/v1/skill/github/security

# 测试 3：带 device-fp header
curl -v -H "x-device-fp: fdc2eb8c781050b5" https://api.mapick.ai/api/v1/skill/github/security看哪个返回 200，哪个返回 401/404。
第二步：根据结果修。 大概率是以下三种情况之一：
情况 A：Nginx/CDN 把 /v1 转发到后端的 /api/v1——那路径没问题，401 是鉴权问题。GET /skill/:id/security 在 SecuritySkillController 上没有挂任何 Guard（我刚看了代码），不应该 401。那就是 Nginx 层面有 auth，或者还有别的中间件。
情况 B：路径前缀对不上——shell.sh 的 API_BASE 需要从 https://api.mapick.ai/v1 改成 https://api.mapick.ai/api/v1。
情况 C：SecuritySkillController 路由跟 SkillController 冲突了——两个都注册在 @Controller("skill")，NestJS 的路由匹配可能把 /skill/github/security 匹配到了 SkillController 的 @Get(":skillId") 上（把 github/security 当成 skillId），而 SkillController 挂了 FpOrApiKeyGuard，所以返回 401。
情况 C 的可能性最大。 因为 NestJS 的路由匹配是按注册顺序的，如果 SkillController 先注册，它的 @Get(":skillId") 会吞掉所有 /skill/* 请求，包括 /skill/github/security。
修法：在 SkillController 里把 @Get(":skillId") 的路径改得更具体，或者让 SecuritySkillController 的路由优先级更高（在 app.module 里先 import）。
让工程师先跑那三条 curl 确认是哪种情况，然后对症下药。[上午 9:49]核心问题----每日通知系统必须上线！！！！没有主动触达能力，Mapick 就是一个装完用一次就忘的工具。
所以通知系统不是“锦上添花“，是生死线。没有它：

用户装完用一次，再也不打开
你发新版本，用户不知道
你加了工作流自动化，没人用
推荐越来越准了，没人看到
那就改优先级。V1 先不急着上线，V1.5 的通知跟 V1 一起上。
最小可行方案——不需要做完整个 V1.5，只需要一个东西：装完 Mapick 的时候配一个 cron，每天跑一次，有事就推 Telegram。
用户装完 Mapick
  → init 阶段自动跑 openclaw cron add
  → 每天早上 9 点触发 shell.sh notify
  → shell.sh 检查：
    1. 有没有新版本？ → 推升级提醒
    2. 有没有新僵尸？ → 推清理提醒  
    3. 有没有匹配工作流的新 A 级 Skill？ → 推推荐
    4. 什么都没有？ → 不推，不打扰这个改动量：shell.sh 加一个 notify 命令 + SKILL.md 里 init 流程加一步配 cron。两个文件，半天搞定。不需要后端改任何东西——版本号硬编码在 shell.sh 里，跟 GitHub release 对比就行。
偏好系统和 token 透明化可以后面做，但 cron + notify 必须跟 V1 一起上线。没有这个，后面做什么都等于零。
告诉工程师：V1 的 3 个 bug 修完之后，下一个不是上线，是加 notify，然后一起上线。[上午 9:49]@Evan 再加一个每日通知系统（不然用户以后永远没法自动更新新功能了）

站在一个普通用户视角，老实说：一般。不是卧槽，是「哦，行吧」。
好的变化（跟上一轮比）：
人格报告终于不是全是零了——「:lock: 你的 Mapickii 人格还在酝酿中」，brewing 卡片上线了，比全是零好 100 倍
推荐不再是 Azure 垃圾了——find-skills、vercel-react-best-practices、soultrace，至少是真实有用的 Skill

脱敏引擎实测通过——OpenAI key + SSH key 全部 [REDACTED]
隐私状态表格清晰，consent 引导明确
为什么不是「卧槽」：
推荐那段——「找到了 3 个你可能感兴趣的技能」，然后列了三个 Skill 名 + 安装量 + Grade A + 「可能对你有帮助」。这就是我们说的产品目录问题，SKILL.md 的新渲染指令还没部署上去。 应该是「你缺什么 → 这个解决什么 → 装了之后你的工作流怎么变」，不是「这里有三个东西你可能喜欢」。
Status 返回全是零——「活跃率 0%，Skill 库是空的」。但 mapickii 自己明明装了，说空的就不对。这是那个 status 走了后端缓存路径而不是本地扫描的老 bug。
Security 后端还是挂着——fallback 分析虽然有内容但不是真正的安全评分。
总结：bug 修了一些，但「哇塞」的 prompt 改动没上去。 推荐还在用旧的渲染逻辑（列名字 + 数据），没有连接用户工作流、没有说替代了什么手动工作。让工程师部署我们改过的那版 SKILL.md——就是加了推荐连接工作流、僵尸羞耻感、安全惊悚感、套装升级感那些的版本。prompt 不换，功能再对也出不来「卧槽」的感觉。
[中午 11:20]promt你没上
[中午 11:21]我fa你的skil md文件，有2个还是3个，你都上了吧，promt不上，基本上AIgc就是完蛋的