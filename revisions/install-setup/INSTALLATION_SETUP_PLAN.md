# Mapick 安装与配置体验改造计划

> 范围：只针对本仓库的 `mapick` Skill。
> 日期：2026-04-28
> 目标：OpenClaw 已安装并能正常对话的新手，执行 `openclaw skills install mapick` 后，Mapick 文件安装到当前 OpenClaw 会加载的位置、下一次会话可见、本地入口可启动、后端 health 可达，并且能明确知道 ACP/Gateway 是否还需要配对或配置；否则安装阶段或首次运行阶段直接拦住并给出修复路径。

## 0. 核心结论

安装体验要从“文件下载成功”升级为“安装成功就一定能启动”。

Mapick 需要建立一条主路径：

```bash
openclaw skills install mapick
```

其他入口全部降级为高级/恢复/开发用途。安装器必须在写入前完成 Mapick 特有预检，在覆盖前给出选择，在写入后运行 smoke test，并明确提示“需要开启新 OpenClaw 会话后才会加载新 Skill”。如果首次使用触发 ACP/Gateway 错误，必须把它归因到 OpenClaw 运行配置或配对状态，而不是说 Mapick 文件没装上。`doctor` 命令作为安装前、安装后、出错后的统一诊断入口。

本计划只解决安装链路，不把隐私 consent、推荐/搜索/安全评分等业务流程纳入安装验收。

### 0.1 问题边界重新校准

这份计划的用户画像是：

| 前提 | 结论 |
|------|------|
| 用户已经按 OpenClaw Getting Started 完成安装、onboarding、模型 API key 和 Gateway 验证 | 不再解决 OpenClaw 安装、模型 API key、Gateway 首次配置 |
| 用户在 ClawHub Mapick 页面或 OpenClaw 里安装 Mapick | 主入口应是 `openclaw skills install mapick` |
| Mapick 是 ClawHub Skill，不是 OpenClaw 本体 | 安装问题重点是 Skill bundle、metadata、加载路径、同名优先级、后端 health、页面安全提示 |
| Mapick 比普通本地 Skill 多依赖固定后端 | `api.mapick.ai/api/v1/health` 必须作为安装阻断项 |
| OpenClaw 已经具备 Node 运行环境 | 不要求新手单独安装系统 Node；只验证 OpenClaw 运行 Mapick 的 runtime |
| 用户可能首次触发 ACP/Gateway flow | 需要诊断 `acp.defaultAgent`、ACP runtime、Gateway pairing，而不是让用户盲改 JSON |

当前 ClawHub Mapick 页暴露的安装阶段问题：

| 页面现象 | 对新手的影响 | 计划处理 |
|----------|--------------|----------|
| Install 区同时展示 Prompt Flow、`openclaw skills install mapick`、`npx clawhub@latest install mapick` | 新手不知道该复制哪一个 | 把 OpenClaw native install 设为唯一推荐主路径 |
| Prompt Preview 写着 `Required binaries: node, jq, curl` | 误导用户以为还要额外处理 Node 和 jq | 保留/验证 Node 作为 OpenClaw baseline，移除 `jq`，用户文案只强调外部 `curl` |
| 页面顶部 ClawHub Security + VirusTotal 都标 `Suspicious`，OpenClaw Analysis medium confidence | 综合扫描信号，谨慎新手直接放弃；不谨慎新手被训练成"忽略安全提示" | 信号按是否可消除分三档治理，详见 §11.3。不靠"忽略警告"绕过 |
| Capability Signals 错挂 `Crypto` / `Requires wallet` / `Requires sensitive credentials` 三条 | 与 Mapick 实际行为不符；和对照 skill `find-skills-skill`(干净 capability) 一比就显得可疑 | §11.3 绿档：Phase 1 SKILL.md 一次性移除三条 |
| Runtime requirements 仍显示 `Bins node, jq, curl` | ClawHub 预检会按错误依赖拦截或误导 | §11.3 绿档：Phase 1 移除 `jq`、Node 版本对齐 `>=22.14`，重发版本 |
| OpenClaw docs 说明 Skill 安装到 active workspace，下一次会话才加载 | 用户可能以为装完当前会话立刻可用 | 成功文案必须提示“start a new OpenClaw session”并显示实际安装路径 |
| OpenClaw skills 有 workspace/user/bundled 优先级 | 用户可能装到了一个路径，但被另一个同名 Skill shadow | doctor 必须显示 active path 和所有同名路径 |
| 首次使用报 `gateway closed (1008): pairing required` | 用户以为 Mapick 安装坏了 | doctor 识别为 Gateway device/node pairing 未完成，提示 `openclaw devices list/approve` 或当前版本对应命令 |
| 首次使用报 `ACP target agent is not configured` | 用户以为要把 `defaultAgent` 改成 `mapick` | doctor 识别为 ACP agent 目标缺失；不能盲填 `mapick`，必须列出可用 ACP agents 并让用户选有效 harness id |

### 0.2 新手首次安装失败模式索引

按"已装好 OpenClaw 的新人想给 OpenClaw 加 Mapick"实际路径走一遍，把会撞到的失败模式集中列在这里。每条都映射到本计划处理位置，避免后续章节漏覆盖。

#### A. 发现路径

| # | 现象 | 根因 | 处理位置 |
|---|------|------|----------|
| A1 | Getting Started 走完没听过 Skills | OpenClaw [Getting Started](https://docs.openclaw.ai/start/getting-started) 五步未涉及 `openclaw skills install`，新人到 Mapick 页才第一次见 | §3.2/§12.1 文案补一句"native OpenClaw skill installer"短解释 |
| A2 | ClawHub Mapick 页同屏 OpenClaw native / npx clawhub / curl 三种命令 | 入口未分级 | §3.1、§12.1/§12.2 |
| A3 | Prompt Flow 与 CLI 命令并列，不知道粘到 dashboard 还是 terminal | 页面未区分使用场景 | §12.1 文案明确 terminal 来源 |

#### B. 安全审查

| # | 现象 | 根因 | 处理位置 |
|---|------|------|----------|
| B1 | ClawHub Security + VirusTotal 都标 Suspicious | 综合扫描信号；与对照 skill `find-skills-skill`(instruction-only, Benign) 形成强对比 | §11.3 三档分类：绿档可一次发版消掉，黄档需要代码 + 文档配合，红档需要 ClawHub verified-publisher 流程 |
| B2 | OpenClaw Analysis 列 redaction skip / `x-device-fp` no consent / curl\|bash 三条 medium-confidence 担忧 | 真实代码行为而非误报 | §11.3 黄档：consent 前不发指纹、redaction 规则透明化；curl 已降级 Advanced(§3.1) |
| B3 | Capability Signals 错挂 `Crypto` / `Requires wallet` / `Requires sensitive credentials` 三条 | SKILL.md metadata 错配 | §11.3 绿档：Phase 1 一次性移除三条，立刻翻成干净 |
| B4 | 静态扫描必标 `child_process` / env+network / file_read+network 三条 ([scripts/shell.js:25/88/171](mapick/scripts/shell.js)) | Mapick 核心功能必须用，不可消 | §11.3 红档：靠 ClawHub verified-publisher / author-attested 流程 + 主动声明行为目的，不能强消 |

#### C. 安装执行

| # | 现象 | 根因 | 处理位置 |
|---|------|------|----------|
| C1 | 不知道 `openclaw skills install mapick` 该在哪个 cwd 执行 | active workspace 概念新人未感知 | §4.5/§7.5 输出 install target 绝对路径 |
| C2 | 跟着页面装 `jq`，发现 Mapick 实际不用 | SKILL.md `requires.bins` 错挂 jq | Phase 1 移除 jq 并重发 |
| C3 | Apple Silicon 上 brew 在 `/opt/homebrew/bin` 不在 PATH | Homebrew shellenv 未写入 rc | §4.6 doctor 检测 brew 实际路径并提示 `brew shellenv` |
| C4 | Node 20 装"成功"但 `/mapick` 运行时 Node API 报错 | preflight Node 下限错写 18，OpenClaw 实际 22.14+ | §4.1/§4.2/§10.1 把下限改为 22.14 |
| C5 | curl 一行没 pin 版本，下次安装得到不同版本 | 默认拉 `main` | §3.2 Advanced 区强制 pin tag 示例 |
| C6 | 公司代理拦 `raw.githubusercontent.com`，curl 拿到 HTML 错误页被 bash 解析 | 无 content-type 校验 | §4.3 检查响应内容类型并提前拒绝 |
| C7 | 用户连试三种入口，三个位置都有 mapick 副本 | 无冲突识别与统一回滚 | §6.1/§6.5 列出所有同名副本与 active 路径 |

#### D. 安装"成功"之后用不了

| # | 现象 | 根因 | 处理位置 |
|---|------|------|----------|
| D1 | 装完回 dashboard 旧会话敲 `/mapick` 没反应 | OpenClaw skill snapshot 在会话开始时锁定 | §7.1/§7.5 收尾文案明确 "start a new OpenClaw session" |
| D2 | 重复 `openclaw skills install mapick` 报 "already installed"，用户以为是别处问题 | same-version skip 缺会话提示 | §6.1 same-version skip 时同样输出新建会话提示 |
| D3 | 第一次真正调用报 `gateway closed (1008): pairing required` | 新 device/node 首次连 Gateway 需 owner approve | §7.3/§8.2 doctor 区分 pairing required，给 `openclaw devices`/`openclaw nodes` 命令 |
| D4 | 接着报 `ACP target agent is not configured` | onboarding 配了 model API key 但没配 ACP defaultAgent | §7.3/§10.1 doctor 引导 `/acp doctor`，**不得**默认填 `mapick` |
| D5 | 用户 Google 找到的修复是 `acp.defaultAgent = mapick` | 错误归因蔓延 | §0.2/§7.3 文案显式反对 |
| D6 | 公司代理 TLS 拦截 `api.mapick.ai`，文件装上但每次调用 health 失败 | 网络归因不清 | §4.2 后端 health 阻断 + §8.4 doctor 区分 DNS/TLS/HTTP/status |
| D7 | dashboard 旧会话能用、新 session 才暴露 pairing 错 | snapshot 缓存导致反向归因 | §7.5/§8.4 安装时主动提示新建会话 |

#### E. 求助归因

| # | 现象 | 根因 | 处理位置 |
|---|------|------|----------|
| E1 | 报错同时出现 OpenClaw / ACP / Gateway / ClawHub / Mapick 五个词，issue 投错仓库 | 错误未标注责任产品 | §8.4 doctor 输出每条 FAIL 标注 owner(OpenClaw / ClawHub / Mapick / Network) |
| E2 | 没有统一自检入口 | doctor 命令尚不存在 | Phase 3 实现 `bash shell doctor` |

## 1. 当前状态

当前 `mapick` Skill 已经具备这些基础：

| 项 | 当前状态 | 风险 |
|----|----------|------|
| 推荐安装入口 | README 顶部应展示 `openclaw skills install mapick` | 当前 ClawHub 页面入口过多，新手仍可能混乱 |
| 一行脚本 | `install.sh` 支持 curl/wget、版本 pin、repo override | 对新手太强，且当前会自动覆盖 |
| 依赖声明 | `SKILL.md` / ClawHub metadata 应区分 OpenClaw baseline 和 Mapick 外部命令 | 当前 ClawHub 页显示 `node, jq, curl`，会误导已安装 OpenClaw 的新手 |
| 运行入口 | `scripts/shell` 依赖 Node，`shell.js` 依赖 curl 调后端 | 安装成功但 OpenClaw runtime/curl 不满足时会运行失败 |
| 后端 health | `shell.js` 会通过固定后端配置访问 `api.mapick.ai` | 如果后端不可达，Mapick 安装后会出现“文件在但命令不可用”的错觉 |
| 安装位置 | OpenClaw native install 会安装到 active workspace `skills/` | 只检查 `~/.openclaw/skills/mapick` 会误判“没装上” |
| 同名覆盖 | active workspace、`~/.openclaw/skills`、personal/project skills、bundled 都可能有同名 `mapick` | 用户本地改动、未知来源安装、版本回退、shadowed install 都可能被忽略 |
| 会话刷新 | OpenClaw docs 要求安装后开启新会话才能加载 | 当前会话里立刻 `/mapick` 可能不可见，用户会误判安装失败 |
| ACP/Gateway 配置 | Mapick 首次使用可能触发 ACP dispatch 或 Gateway node/device 连接 | 文件安装成功后仍可能报 pairing required / ACP target missing |
| ClawHub 安全提示 | Mapick 页显示 suspicious 和能力信号 | 安装前要解释这是页面扫描/metadata 问题，不是 API key 或 OpenClaw 安装问题 |
| doctor | 暂无 | 出错时只能靠用户自己判断 |

## 2. 产品原则

| 原则 | 解释 |
|------|------|
| 一个默认入口 | 普通用户只看到一个最推荐命令，其他入口放到 Advanced |
| 安装前拦截 | 缺必需依赖时不写入 Skill 目录，避免“装完才发现不能用” |
| 覆盖前确认 | 任何会删除/替换已有文件的动作都要明确说明影响 |
| 安装后自检 | 安装成功后立即跑本地入口 smoke test，确认 `/mapick` 不会因环境问题失败 |
| 可用性分层 | 区分 `installed`、`loaded`、`ready`、`needs_openclaw_setup`，不要把“文件已安装”包装成“完全可用” |
| OpenClaw runtime 优先 | 只要 OpenClaw 已安装，就应优先使用/验证 OpenClaw 提供的 Node 环境，不要求用户另装系统 Node |
| 固定后端配置 | Mapick 不需要用户配置 API key；安装只检查固定后端 health 是否可达 |
| 可恢复 | 覆盖、升级、失败安装都必须有备份或 rollback |
| 可机器读取 | `install`、`doctor` 同时支持人类输出和 JSON 输出 |
| 不盲改配置 | 不要求新手手动编辑 `openclaw.json`；优先使用 `openclaw config`、`/acp doctor`、pairing CLI，并在输出中隐藏 token/password |

## 3. 安装入口决策

### 3.1 面向用户的入口排序

| 优先级 | 入口 | 面向谁 | 展示策略 |
|--------|------|--------|----------|
| P0 | `openclaw skills install mapick` | 已安装 OpenClaw 的普通用户 | README/ClawHub 最显眼位置，标注“Recommended, native OpenClaw install” |
| P1 | `openclaw skills search mapick` 后安装 | 不确定 slug 的用户 | 作为找不到 Mapick 时的辅助路径 |
| P2 | `npx clawhub@latest install mapick` 或 `clawhub install mapick` | 需要 ClawHub CLI、CI、registry 调试的用户 | 放到 Advanced，说明会安装到当前 workdir/workspace，不是首选 |
| P3 | `curl -fsSL .../install.sh \| bash` | OpenClaw registry 不可用、恢复安装、CI | 放到 Advanced，附危险提示和版本 pin 示例 |
| P4 | `git clone` + 本地复制/链接 | Mapick 维护者 | 放到 Developer install |

### 3.2 README 调整

README 顶部只保留一个强 CTA：

```bash
openclaw skills install mapick
```

建议文案：

```markdown
Recommended: use OpenClaw's native Skill installer. It installs Mapick into the active OpenClaw workspace, records ClawHub source metadata, and can be updated later with OpenClaw.
```

curl 区域移动到 `Advanced install`，增加警告：

```markdown
Advanced: pipe-to-shell install is for recovery, CI, and pinned-version installs.
Review the script first if you are not sure:

curl -fsSL https://raw.githubusercontent.com/mapick-ai/mapick/v0.0.6/install.sh -o install.sh
less install.sh
bash install.sh
```

### 3.3 “三种安装方式不知道怎么选”的最终规则

| 用户情况 | 推荐 |
|----------|------|
| 第一次安装 Mapick | `openclaw skills install mapick` |
| 不确定 slug 或找不到页面 | `openclaw skills search mapick` |
| 当前会话里看不到 `/mapick` | 开启新的 OpenClaw 会话后再试 |
| OpenClaw native install 失败但 ClawHub 可访问 | 再考虑 Advanced 的 `npx clawhub@latest install mapick` |
| ClawHub 服务异常但用户急需安装 | 使用 pinned curl：`MAPICK_VERSION=v0.0.6 bash install.sh` |
| 企业网络限制 GitHub | 使用离线 tarball + checksum |
| Mapick 开发者本地调试 | git clone 后复制/链接到当前 OpenClaw workspace 的 `skills/mapick` |

## 4. 安装前预检

### 4.1 预检来源

预检优先读取 `SKILL.md` 的 frontmatter，但要区分“机器可验证字段”和“新手看到的安装前置”：

```yaml
metadata:
  openclaw:
    requires:
      bins: ["node", "curl"]
      node: ">=22.14"  # 与 OpenClaw Getting Started 一致：Node 22.14+ supported, Node 24 recommended
```

如果 ClawHub/OpenClaw 当前只能通过 `requires.bins` 过滤二进制，`node` 可以继续作为技术检查存在；但用户文案必须把它解释为 OpenClaw 基础运行环境，而不是 Mapick 额外依赖。新手已经完成 OpenClaw 安装时，安装器要验证的是"OpenClaw 当前会话能不能用 Node 运行 Mapick"，而不是默认让用户 `brew install node`。Node 下限以 OpenClaw 文档为准(`>=22.14`)，不要凭空写 `>=18` 让用户在 Node 20 上看似装成功、运行时再爆。

当前 `scripts/shell.js` 不直接使用 `jq`，所以 `jq` 不应作为安装前置条件。

### 4.2 必需检查项

| 检查项 | 当前要求 | 失败动作 |
|--------|----------|----------|
| OpenClaw CLI | `openclaw` 可执行，且 `openclaw skills install` 可用 | 阻止安装，提示先完成 OpenClaw Getting Started |
| OpenClaw runtime Node | 用 OpenClaw 实际运行 Skill 的 Node 执行 `scripts/shell` smoke test，且 `>=22.14`(推荐 24，与 OpenClaw 文档一致) | 阻止安装，提示修复/升级 OpenClaw，而不是默认提示用户安装系统 Node |
| curl | `curl` 可执行 | 阻止安装，给系统安装命令 |
| tar/gzip/mktemp/cp/chmod | 系统工具可用 | 阻止安装，说明系统环境异常 |
| 临时目录 | `mktemp -d` 成功且可写 | 阻止安装，提示 `TMPDIR` 或磁盘空间问题 |
| active workspace skills 目录可写 | OpenClaw 当前 workspace 的 `skills/` 可创建/写入 | 阻止安装，显示实际 workspace 和权限修复 |
| 后端 health | `curl -fsS https://api.mapick.ai/api/v1/health` 返回 2xx 且 JSON status 为 `ok` | 阻止安装，说明服务端或网络不可用 |
| GitHub release/tarball 可访问 | 下载源返回 200 | 阻止安装，不创建半成品目录 |
| 磁盘空间 | 至少 20MB 可用 | 阻止安装 |
| 已安装冲突 | 同 slug 是否存在 | 进入冲突处理流程 |

### 4.3 可选检查项

| 检查项 | 影响 | 失败动作 |
|--------|------|----------|
| GitHub release API 可达 | latest version resolution | fallback 到 `main` 前必须显示 warning |
| 代理/TLS | 下载和后端请求 | 提供 `HTTPS_PROXY`、`NODE_EXTRA_CA_CERTS` 排查建议 |
| 响应内容类型 | 下载源和 health 是否返回预期 JSON/tarball | 如果返回 HTML/login page，提示代理、校园网、公司网关或 CDN 错误 |

### 4.4 系统安装命令建议

安装器只在用户确认后执行依赖安装。默认只打印命令。

| 平台 | 检测 | 建议命令 |
|------|------|----------|
| macOS + Homebrew | `command -v brew` | `brew install curl` |
| Debian/Ubuntu | `command -v apt` | `sudo apt update && sudo apt install -y curl` |
| Fedora/RHEL | `command -v dnf` | `sudo dnf install -y curl` |
| Arch | `command -v pacman` | `sudo pacman -S --needed curl` |
| Nix | `command -v nix` | `nix shell nixpkgs#curl` |
| Windows | OpenClaw 支持情况决定 | 若不支持 native Windows，明确建议 WSL |

注意：以上命令只用于补齐 Mapick 直接需要的外部命令。Node 属于 OpenClaw runtime 能力；只有在 Advanced/developer install 且无法使用 OpenClaw runtime 时，才提示用户准备系统 Node `>=22.14`（推荐 24，与 OpenClaw 文档一致）。

### 4.5 预检输出示例

成功：

```text
Mapick preflight
OK  OpenClaw CLI: /usr/local/bin/openclaw
OK  OpenClaw runtime Node: v24.15.0 (>=22.14 required)
OK  curl: 8.7.1
OK  backend health: https://api.mapick.ai/api/v1/health
OK  target: /path/to/current-workspace/skills/mapick
OK  source: mapick-ai/mapick v0.0.6
Ready to install.
```

失败：

```text
Mapick preflight failed

Missing required dependencies:
- curl: not found
- backend health: https://api.mapick.ai/api/v1/health returned 503

macOS:
  brew install curl

Ubuntu/Debian:
  sudo apt update && sudo apt install -y curl

Nothing was installed.
```

### 4.6 小白用户常见安装坑（外部资料补充）

这些问题都发生在“安装链路”里，不涉及 Mapick 业务逻辑。

| 常见坑 | 用户看到的现象 | 安装器要怎么处理 |
|--------|----------------|------------------|
| Homebrew 已安装但命令不可用 | `brew: command not found`，尤其是 Apple Silicon 新机器 | 不要求用户懂 PATH；doctor 检查 `/opt/homebrew/bin/brew`、`/usr/local/bin/brew`，提示 `eval "$(<brew-prefix>/bin/brew shellenv)"` |
| Homebrew 安装前置缺失 | 安装 curl 时提示 Command Line Tools / bash 相关错误 | 明确这是 Homebrew/系统工具链问题；提示先按 Homebrew 官方要求修复，不把它归因到 Mapick |
| OpenClaw runtime 不可用 | OpenClaw 已安装，但 Skill smoke test 报 `node: command not found` | 归因为 OpenClaw runtime/安装损坏，提示升级或重装 OpenClaw，不要求新手理解 PATH |
| OpenClaw runtime Node 太旧 | OpenClaw 用来跑 Skill 的 Node `<22.14`（OpenClaw 文档要求） | 阻止安装，提示升级 OpenClaw；不要等 `/mapick` 运行时报错 |
| 系统 Node 干扰排查 | 用户本机有多个 Node，怀疑版本冲突 | doctor 可以展示系统 `which node/node -v` 作为诊断信息，但安装判定以 OpenClaw runtime 为准 |
| npm/global 权限问题 | `EACCES` / permission denied | Mapick 安装不应依赖 npm global install；如果 ClawHub 自身安装遇到 EACCES，提示使用官方推荐的权限修复方式 |
| npm/registry 返回异常内容 | 依赖安装时出现 `Invalid JSON`、HTML 登录页、代理提示页 | 安装器不要继续解析；输出“网络网关/代理返回了非预期内容”，附原始 status/content-type 摘要 |
| curl TLS/CA 问题 | `curl: (60) SSL certificate problem` | health 检查用 `curl -v` 输出证书链摘要；提示 CA store/proxy/TLS，而不是说 API key 缺失 |
| 公司代理 / 本地代理 | 直连超时、`CONNECT` 失败、代理认证失败 | 检查并展示 `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` 是否设置；失败时给出“当前走了哪个代理” |
| GitHub/raw 下载失败 | install tarball 下不下来 | 区分 GitHub 下载失败和 Mapick backend health 失败；二者错误码分开 |
| active workspace 识别错误 | 文件其实装到了当前 workspace `skills/mapick`，用户却去看 `~/.openclaw/skills/mapick` | doctor 显示 OpenClaw active workspace、install target 和所有候选路径 |
| 目标目录权限 | 当前 workspace `skills/` 创建失败 | 阻止安装，提示实际目录和权限；不要自动 sudo |
| 安装后当前会话看不到 `/mapick` | OpenClaw 旧会话还没重新加载 Skill snapshot | 成功页必须提示“start a new OpenClaw session”；doctor 区分“文件已安装”和“当前会话未加载” |
| ClawHub 页面依赖误报 | 页面显示 `node, jq, curl`，用户以为要额外装 `jq` | 修正 metadata；安装器只把 `curl` 当外部命令，Node 归 OpenClaw runtime |
| ClawHub security warning | 页面顶部出现 suspicious，用户以为安装命令坏了 | 发布前修正 capability/metadata 和扫描信号；文案解释“这是安全审查提示，不是安装失败” |
| 临时目录/磁盘空间不足 | `mktemp` 失败、`ENOSPC`、写入 tarball 失败 | 在下载前检查 tmp 和目标盘可写、可用空间；失败时不要留下半成品 |
| shell 不兼容 | 用户在 fish/zsh/bash 里 PATH 行为不同 | 安装器输出“当前 shell”和对应修复命令，不要求用户判断 rc 文件 |
| pipe-to-shell 运行环境混乱 | 用户用 zsh/fish 直接执行 bash 脚本片段 | Advanced 安装必须明确 `bash install.sh`；doctor 输出当前 shell，但脚本内部只假设 bash |
| 半成品安装 | 中途 Ctrl-C 后目录存在但文件缺失 | atomic install + smoke test；失败回滚，不留下 active 半成品 |

以上补充对应到安装器实现时，关键不是提供一堆文档链接，而是把诊断结果翻译成一句明确结论：

```text
FAIL OpenClaw runtime: Node.js v20.10.0, but Mapick requires >=22.14 (OpenClaw recommends 24).
Fix: update OpenClaw, then retry `openclaw skills install mapick`.
```

或：

```text
FAIL Backend health: curl TLS verification failed for api.mapick.ai.
This is not an API key problem. Check your proxy/CA certificate or retry later.
```

## 5. 一键安装依赖

### 5.1 交互规则

当缺依赖且检测到包管理器时，安装器给两个选择：

```text
Install missing dependencies now?

1. Yes, run: brew install curl
2. No, print instructions and exit
```

执行前必须展示完整命令。默认选择 No，避免用户误授权。

### 5.2 非交互规则

CI、pipe-to-shell、无 TTY 场景不弹交互。

| 环境变量 | 行为 |
|----------|------|
| `MAPICK_INSTALL_ASSUME_YES=1` | 允许自动安装依赖和确认覆盖 |
| `MAPICK_INSTALL_NO_AUTO_DEPS=1` | 永不自动安装依赖，只打印命令 |
| `MAPICK_INSTALL_DRY_RUN=1` | 只跑预检，不下载不写入 |
| `MAPICK_INSTALL_JSON=1` | 输出 JSON，便于 ClawHub/测试消费 |

### 5.3 自动安装边界

| 依赖 | 是否自动安装 | 原因 |
|------|--------------|------|
| curl | 可在用户确认后安装 | 标准系统包，Mapick 直接用于 health/download/backend request |
| Node | ClawHub 默认不自动安装 | 应由 OpenClaw runtime 提供；Advanced/developer install 才提示系统 Node `>=22.14`（推荐 24） |
| OpenClaw | 默认不自动安装 | 本计划前提是 OpenClaw 已安装；异常时只提示回到 Getting Started 修复 |
| 企业 CA 证书 | 不自动安装 | 安全风险高，只给排查文档 |
| shell profile 修改 | 不自动修改 | 避免污染用户环境 |

## 6. 同名 Skill 覆盖策略

### 6.1 要识别的冲突类型

| 类型 | 判断 | 默认动作 |
|------|------|----------|
| 未安装 | 目标目录不存在 | 正常安装 |
| 同版本已安装 | `.version` 等于目标版本 | 提示已安装并默认 skip；同时输出 active path 与"如果当前会话仍看不到 `/mapick`，请新开 OpenClaw session"提示，避免用户反复重装(§0.2 D2) |
| 旧版本升级 | `.version` 低于目标版本 | 备份后升级，保留 CONFIG |
| 新版本回退 | `.version` 高于目标版本 | 阻止，除非 `--force-downgrade` |
| 未知来源 | 目录存在但无 `.version` 或 manifest | 提示风险，默认 skip |
| 本地修改 | 文件 hash 与安装 manifest 不一致 | 提示 dirty，默认 skip |
| 多路径同名 | workspace/project/personal/managed/bundled 都有 `mapick` | 显示优先级和实际生效路径 |

### 6.2 交互菜单

检测到 active install target 已存在，或更高优先级路径已有 `mapick` 时，不直接报错，也不直接覆盖：

```text
Mapick is already installed:
  active path: /project/skills/mapick
  install target: /project/skills/mapick
  installed version: v0.0.5
  target version: v0.0.6
  config: will be preserved

Choose:
1. Update to v0.0.6 (backup first)
2. Skip
3. Show version/file diff
4. Backup existing as mapick.backup-20260428 and install fresh
```

### 6.3 非交互默认

| 场景 | 默认 |
|------|------|
| same version clean | skip with exit 0 |
| older version clean | update if `MAPICK_INSTALL_ASSUME_YES=1`，否则 exit 2 with instructions |
| unknown source | fail safe |
| dirty local changes | fail safe |
| target not writable | fail |

### 6.4 备份与回滚

安装流程改为 atomic install：

```text
1. 下载到 tmp
2. 校验 tarball/checksum
3. 解析 OpenClaw active workspace 和 install target
4. 复制到 tmp target: <workspace>/skills/.mapick.tmp-<pid>
5. 备份旧目录: <workspace>/skills/.mapick.backup-<timestamp>
6. rename tmp -> mapick
7. 写入/更新 ClawHub source metadata 或 lockfile
8. 验证 SKILL.md/scripts/shell 存在且可执行
9. 成功后保留最近 3 个备份
10. 失败则 restore backup
```

`CONFIG.md`、用户 cache、trash 不应被删除。升级时只更新 Skill payload。

### 6.5 workspace/bundled 同名提示

如果 OpenClaw 同时发现多个 `mapick`：

```text
Multiple Mapick skills detected:

1. workspace: /project/skills/mapick
2. project agent: /project/.agents/skills/mapick
3. personal agent: ~/.agents/skills/mapick
4. managed/local: ~/.openclaw/skills/mapick
5. bundled: /Applications/OpenClaw.app/.../skills/mapick

Active: workspace copy
The user-installed copy is shadowed and will not run in this workspace.
```

必须告诉用户“哪个生效”，而不是只说“已安装”。

## 7. 安装后 smoke test

### 7.1 安装成功的最低标准

Mapick 当前不需要用户配置账号、API key 或 secrets。API key 属于后端固定配置，不是用户安装问题。

`openclaw skills install mapick` 只有在以下检查全部通过后才能显示 `ready`。如果文件安装成功但 ACP/Gateway 未就绪，状态必须是 `installed, needs_openclaw_setup`，不能显示“fully ready”。

| Smoke test | 命令 | 期望 |
|------------|------|------|
| 文件完整 | 检查 `SKILL.md`、`scripts/shell`、`scripts/shell.js`、`scripts/redact.js`、`reference/` | 全部存在 |
| 可执行权限 | `test -x scripts/shell` | 通过 |
| OpenClaw runtime 入口 | 通过 OpenClaw 实际运行 Skill 的方式执行 `bash shell help` 或 `bash shell id` | 返回单行 JSON 或明确 usage，不崩溃 |
| Redaction 入口 | 使用同一个 OpenClaw runtime 执行 `scripts/redact.js` smoke test | 返回脱敏结果 |
| 后端 health | `curl -fsS https://api.mapick.ai/api/v1/health` | 2xx 且 `status=ok` |
| ACP readiness | 如果 Mapick 当前命令会触发 ACP flow，先跑 `/acp doctor` 或等价 CLI 检查 | ACP runtime enabled、backend configured、default/目标 agent 可解析 |
| Gateway pairing | 如果运行入口触发 Gateway WS/node/device 连接，检查 pending/paired 状态 | 未配对时输出 approve 流程，而不是让用户猜配置 |
| 会话加载提示 | 安装完成后输出 `Start a new OpenClaw session to load Mapick` | 用户知道当前旧会话可能还看不到 `/mapick` |

### 7.2 安装失败边界

以下任一项失败都不能宣称安装成功：

| 失败项 | 行为 |
|--------|------|
| OpenClaw runtime 不可用或缺 curl | 阻止安装；runtime 问题提示升级/重装 OpenClaw，curl 问题提示系统安装命令 |
| `api.mapick.ai` health 失败 | 阻止安装，明确说明“Mapick 后端当前不可达或网络/TLS 有问题” |
| 文件复制不完整 | 回滚旧版本或删除半成品 |
| `scripts/shell` 不能启动 | 阻止安装，输出 stderr 摘要 |
| `gateway closed (1008): pairing required` | 标记 `needs_gateway_pairing`，输出 pending request 查询和 approve 指令 |
| `ACP target agent is not configured` | 标记 `needs_acp_target_agent`，提示运行 `/acp doctor` 并配置有效 ACP agent；不得建议盲填 `mapick` |
| 同名目录冲突未确认 | 不覆盖，退出 |

### 7.3 ACP/Gateway 首次使用引导

真实用户已经遇到过这种状态：

```text
gateway closed (1008): pairing required
ACP target agent is not configured.
```

这类错误说明 Mapick 文件已经安装，但 OpenClaw 运行层还没有准备好。处理原则：

| 错误 | 根因 | 正确引导 |
|------|------|----------|
| `gateway closed (1008): pairing required` | 新 device/node 连接 Gateway 时需要 owner approve | 运行 `openclaw devices list` 查看 pending request，然后 `openclaw devices approve <requestId>`；老版本或 gateway-owned node flow 使用 `openclaw nodes pending` / `openclaw nodes approve <requestId>` |
| `ACP target agent is not configured` | ACP spawn/dispatch 没有可解析的目标 harness agent | 先运行 `/acp doctor`；列出可用 ACP agents，例如 `codex`、`claude`、`gemini`，再配置 `acp.defaultAgent` 或显式传 `agentId` |
| `ACP runtime backend is not configured` | ACP backend plugin 缺失或 disabled | 引导用户启用/修复 OpenClaw bundled `acpx` plugin，然后跑 `/acp doctor` |
| `ACP is disabled by policy` | `acp.enabled=false` 或 dispatch disabled | 用 OpenClaw config 命令开启对应 policy，并提示需要 restart gateway |

不要把 `acp.defaultAgent` 默认写成 `mapick`。按 OpenClaw 文档，`acp.defaultAgent` 是 ACP harness agent id，不是 Skill slug。只有当 Mapick 明确注册了一个名为 `mapick` 的 ACP agent，且 `/acp doctor` 能列出它时，才允许建议 `mapick`。

给用户的推荐输出应该像这样：

```text
Mapick is installed, but OpenClaw setup is incomplete.

OK    Skill files: /Users/chanjames/.openclaw/workspace/skills/mapick
OK    Backend health: api.mapick.ai
FAIL  Gateway pairing: pending approval required
FAIL  ACP target: default agent is not configured

Fix:
1. Run: openclaw devices list
2. Approve the pending request shown by OpenClaw.
3. Run: /acp doctor
4. Configure a valid ACP agent id shown by /acp doctor. Do not use "mapick" unless it is listed as an ACP agent.
```

### 7.4 新增命令建议

在 `scripts/shell.js` 增加：

```bash
bash shell doctor
bash shell doctor --json
```

`doctor` 只诊断安装链路、OpenClaw 运行前置条件、ACP/Gateway readiness，不负责推荐/搜索/安全评分等业务结果。

### 7.5 安装脚本收尾输出

当前 `install.sh` 只打印几个命令。改为：

```text
Mapick installed successfully.

Verified:
  OK OpenClaw runtime Node.js v24.15.0
  OK curl
  OK backend health
  OK skill files
  OK shell entrypoint

Next:
  Start a new OpenClaw session, then use /mapick
  (If you re-ran `openclaw skills install mapick` because /mapick wasn't appearing,
   the old session's skill snapshot is the cause — opening a new session loads the install.)
```

### 7.6 "No setup needed" 文案修正

README 当前写：

```text
No setup needed. Just talk to your agent after installing.
```

建议改成：

```text
No Mapick API key needed. The installer verifies OpenClaw runtime, curl, backend health, file integrity, and the local entrypoint. If OpenClaw ACP/Gateway pairing is required, Mapick doctor will show the exact OpenClaw setup step.
```

这样用户不会把 Mapick API key、业务隐私流程、OpenClaw ACP/Gateway 配对混在一起。

## 8. `doctor` 设计

### 8.1 目标

`doctor` 要回答这些问题：

| 问题 | doctor 回答 |
|------|-------------|
| 我该怎么装？ | 推荐入口、环境是否满足 |
| 为什么装不上？ | 缺依赖、权限、网络、冲突 |
| 为什么装了不能用？ | runtime/backend/权限/文件完整性状态 |
| 当前到底哪个 mapick 生效？ | 列出所有同名路径和优先级 |
| 是不是 Gateway pairing 问题？ | 显示 pending/paired 状态和 approve 命令 |
| 是不是 ACP target 问题？ | 显示 defaultAgent、allowed agents、runtime backend 状态 |

### 8.2 检查清单

| 分类 | 检查 |
|------|------|
| Runtime | OpenClaw runtime Node 版本、curl |
| OpenClaw | CLI 是否存在、runtime 是否可运行 Skill、skills 目录是否可写 |
| Install integrity | `SKILL.md`、`scripts/shell`、`scripts/shell.js`、`scripts/redact.js`、`.version` |
| Permissions | Skill 目录可读写，安装目标目录可写 |
| Entrypoint | `bash shell help` / `bash shell id` 可启动 |
| Redaction | `scripts/redact.js` smoke test |
| Backend | `api.mapick.ai/api/v1/health` DNS/TLS/HTTP/status |
| ACP | `/acp doctor` 或等价检查、`acp.enabled`、`acp.dispatch.enabled`、`acp.defaultAgent`、allowed agents |
| Gateway pairing | `openclaw devices list` 或 `openclaw nodes pending/status` 的 pending/paired 状态 |
| Cache | `~/.mapick/cache` 是否可写，缓存 JSON 是否损坏 |
| Conflict | workspace/user/bundled 同名 `mapick` |
| Version | installed version、latest version、是否有升级 |

### 8.3 输出等级

| 等级 | 含义 |
|------|------|
| OK | 可用 |
| WARN | 可用但功能降级 |
| FAIL | 当前会导致安装或运行失败 |
| SKIP | 当前模式下不需要 |

### 8.4 责任归属标签

每条检查结果都带一个 owner 标签，避免新人把 OpenClaw / ACP / Gateway 错误投到 Mapick issue 仓库(§0.2 E1)：

| 标签 | 含义 | 修复入口 |
|------|------|----------|
| `[OpenClaw]` | OpenClaw 本体或 runtime 问题 | OpenClaw docs / `openclaw` CLI |
| `[Gateway]` | OpenClaw Gateway / pairing | `openclaw devices` / `openclaw nodes` / `openclaw gateway status` |
| `[ACP]` | OpenClaw ACP runtime / agent target | `/acp doctor` |
| `[ClawHub]` | ClawHub 安装链路或页面 metadata | ClawHub CLI / 页面 |
| `[Mapick]` | Mapick 仓库内文件或脚本 | mapick GitHub issue |
| `[Network]` | 用户网络 / 代理 / TLS / DNS | 用户环境，非产品 issue |

### 8.5 输出示例

健康状态：

```text
Mapick doctor

OK [Mapick]   Active skill: /project/skills/mapick
OK [Mapick]   Version: v0.0.6
OK [OpenClaw] Runtime Node.js: v24.15.0 (>=22.14)
OK [Mapick]   curl: 8.7.1
OK [Network]  Backend health: api.mapick.ai/api/v1/health
OK [ACP]      Default agent: codex
OK [Gateway]  Pairing: paired
OK [Mapick]   Entrypoint: bash shell id
OK [Mapick]   Redaction: 23 rules, smoke test passed

Next:
  /mapick
```

部分失败（Mapick 装好了但 OpenClaw 还没准备好）：

```text
Mapick doctor

OK   [Mapick]   Skill files: /project/skills/mapick
OK   [Network]  Backend health: api.mapick.ai
FAIL [Gateway]  Pairing required for this device
              → openclaw devices list
              → openclaw devices approve <requestId>
FAIL [ACP]      Default agent is not configured
              → /acp doctor
              → Configure a valid ACP agent id (e.g. codex / claude / gemini)
              → Do NOT set acp.defaultAgent = mapick

Status: installed, needs_openclaw_setup
```

## 9. API key / secrets 不属于用户安装范围

Mapick 安装不要求用户提供任何 API key。固定后端配置由 Mapick 服务端维护，用户侧安装器只检查 health endpoint 是否可达。

安装器不得提示用户输入 API key，也不得把 “API key missing” 作为用户可修复问题展示。

## 10. 错误码与用户文案

### 10.1 安装错误码

| 错误码 | 触发 | 用户文案 |
|--------|------|----------|
| `openclaw_missing` | 无 `claw/openclaw` | Install OpenClaw first, then retry. |
| `openclaw_runtime_missing` | OpenClaw 无法运行 Node-based Skill | OpenClaw runtime is unavailable. Update or reinstall OpenClaw, then retry. |
| `openclaw_runtime_too_old` | OpenClaw runtime Node <22.14 | OpenClaw runtime is too old for Mapick. Update OpenClaw, then retry. |
| `curl_missing` | 无 curl | curl is required for backend calls and downloads. |
| `target_not_writable` | active workspace `skills/` 不可写 | Fix permissions for the active workspace skills directory. |
| `backend_health_failed` | `api.mapick.ai/api/v1/health` 不可达或非 `ok` | Mapick backend is unreachable. Retry later or check proxy/TLS. |
| `gateway_pairing_required` | Gateway WS 1008 / pairing required | Mapick is installed, but this OpenClaw device/node must be approved. Run the pairing command shown by doctor. |
| `acp_target_not_configured` | ACP spawn/dispatch 没有 agent target | Mapick is installed, but OpenClaw ACP has no target agent. Run `/acp doctor` and configure a valid ACP agent id. |
| `acp_runtime_not_configured` | ACP backend missing/disabled | OpenClaw ACP runtime is not ready. Enable/fix the bundled ACP runtime, then retry. |
| `acp_policy_disabled` | ACP disabled by policy | ACP is disabled by OpenClaw policy. Enable it intentionally, then restart gateway. |
| `download_failed` | tarball 下载失败 | Check network/proxy or pin a version. |
| `checksum_failed` | 校验失败 | Download was corrupted or tampered with. |
| `existing_install` | 同版本已安装 | Mapick is already installed. |
| `dirty_install` | 本地文件修改 | Backup or force overwrite before continuing. |
| `shadowed_install` | 多路径同名 | Another Mapick copy has priority. |

### 10.2 非安装范围错误码

以下错误属于业务运行阶段，不作为安装计划的目标：

| 错误码 | 触发 | 说明 |
|--------|------|------|
| `consent_required` | remote command 未同意 consent | 由首次业务流程处理 |
| `disabled_in_local_mode` | decline 后调用 remote command | 由业务命令解释 |
| `backend_consent_failed` | 后端未记录 consent | 由业务命令解释 |
| `network_error` | 业务 API 请求失败 | 安装阶段只看 health endpoint |
| `parse_error` | 业务 API 返回非 JSON | 由业务命令解释 |

## 11. 安全与供应链

### 11.1 curl 安装防护

curl 安装必须支持：

| 防护 | 说明 |
|------|------|
| 版本 pin | README 默认示例 pin 到 release tag，不鼓励 `main` |
| checksum | release 附 `SHA256SUMS`，install.sh 下载后校验 |
| 最小权限 | 不 sudo，不写系统目录 |
| 先下载后解压 | 当前已做到，继续保留 |
| atomic swap | 防半成品安装 |
| 保留 config | 当前已做到，继续保留并扩展到 cache/trash |
| dry-run | `MAPICK_INSTALL_DRY_RUN=1` |
| no telemetry during install | 安装脚本不上传行为数据 |

### 11.2 权限

目标文件建议：

| 文件 | 权限 |
|------|------|
| `scripts/shell` | executable |
| `scripts/shell.js` | executable |
| `scripts/redact.js` | executable |
| `CONFIG.md` | `0600`，因为可能含用户偏好和设备指纹 |
| cache/trash | user-only writable |

### 11.3 扫描信号分档与发布策略

ClawHub Mapick 页当前展示的所有安全信号不能一刀切处理。把对照参考放在前面，再分档：

**对照参考**：[find-skills-skill](https://clawhub.ai/fangkelvin/find-skills-skill)(v1.0.0) 是 instruction-only skill，无 `scripts/`、无网络调用、无设备指纹、无 redaction，因此 ClawHub Security/VirusTotal/OpenClaw Analysis 全部 Benign。Mapick 是 code-bundled skill，结构上必然触发部分静态扫描信号。目标不是"装成 Benign"，而是把可消的消干净、把不可消的有据可查。

#### 绿档：纯 metadata，Phase 1 一次发版消掉

| 当前信号 | 处理 | 验收 |
|----------|------|------|
| `requires.bins` 含 `jq` | SKILL.md 移除 `jq`，只保留 `node`、`curl` | ClawHub 页 Runtime requirements 不再显示 jq |
| Capability `Crypto` | SKILL.md 移除（Mapick 不涉及加密货币） | ClawHub 页 Capability Signals 不再出现 |
| Capability `Requires wallet` | SKILL.md 移除（Mapick 无钱包概念） | 同上 |
| Capability `Requires sensitive credentials` | SKILL.md 移除（后端固定配置，用户侧无 credential 输入） | 同上 |
| `requires.node` 缺失或写错 | 设为 `">=22.14"` | OpenClaw 文档对齐 |

绿档全部消掉后，"Capability Signals 全错挂"这条强烈不可信信号会消失；ClawHub Security 顶部的 Suspicious 不一定立刻翻 Benign，但页面整体可信度上来。

#### 黄档：行为可缓解，需要代码 + 文档配合

| 当前信号 | 处理 | 验收 |
|----------|------|------|
| `x-device-fp` 设备指纹无 consent | consent 完成前不发该 header；header 含义、生成算法、生命周期写进 [reference/device-fingerprint.md](mapick/reference/) | OpenClaw Analysis 不再列为 medium-confidence concern |
| Redaction `skip-patterns` 和 `preserve code blocks` 行为不透明 | 23 条规则与 skip 触发条件全部写进 [reference/redaction.md](mapick/reference/)，附 [scripts/redact.js](mapick/scripts/redact.js) 行号引用 | OpenClaw Analysis "privacy protections undermined" 表述移除 |
| `curl\|bash` 高风险安装 | §3.1 已降级到 Advanced + pin 版本 + checksum；ClawHub 页主入口收敛后扫描器看到的暴露面降低 | OpenClaw Analysis 不再把 install vector 列为 high-risk |

黄档做完后，OpenClaw Analysis 的 medium-confidence concerns 应能从 3 条降到 0 条或剩 informational。

#### 红档：消不掉，是 Mapick 核心功能

| 当前信号 | 处理路径 | 不能做什么 |
|----------|----------|----------|
| `child_process` ([scripts/shell.js:171](mapick/scripts/shell.js#L171)) | 不可移除（shell.js 入口必须用） | 不要为消信号而拆掉运行入口 |
| Env access + network send ([scripts/shell.js:25](mapick/scripts/shell.js#L25)) | 不可移除（后端调用必须读取/上送会话上下文） | 不要靠 obfuscation 绕扫描器，反而会触发更严重信号 |
| File read + network send ([scripts/shell.js:88](mapick/scripts/shell.js#L88)) | 不可移除（推荐扫描必须读本地 skills 摘要后上传） | 同上 |

红档的出路只有两条：

1. **审查路径**：申请 ClawHub 的 verified-publisher 或 author-attested 流程，让 Mapick 的"已知行为"被人工 acknowledge，标签从 Suspicious 翻成 "Verified, declared behavior: code execution, network, file read"。流程取决于 ClawHub 当前政策，需要单独沟通。
2. **页面文案路径**：在 ClawHub skill 描述、README 和 SKILL.md 里**主动声明**这三条行为及其目的（推荐扫描需要读 skills 目录、后端调用需要会话上下文、shell 入口承接 OpenClaw runtime 调用），让 OpenClaw Analysis 更可能输出 "behavior matches stated purpose"，而不是 "undermined privacy protections"。

#### 发布前 checklist

每次发版前必须三档分别 review：

```text
□ 绿档：requires.bins、requires.node、capability signals 三类全部修正并已发版？
□ 黄档：x-device-fp 在 consent 之前不发？redaction reference 文档同步本次代码？
       curl one-liner 已 pin 版本 + checksum？
□ 红档：本次代码是否新增 child_process/network/file_read 行为？
       如果是，README 与 SKILL.md 描述里是否同步声明？
       是否需要走 ClawHub verified-publisher 重新审查？
```

## 12. ClawHub 技能页改造

### 12.1 首屏

首屏只放一个安装命令：

```bash
openclaw skills install mapick
```

旁边放一句：

```text
Recommended native OpenClaw install. Installs Mapick into the active workspace and picks it up in a new OpenClaw session.
```

### 12.2 Advanced 区

Advanced 区放：

| 方法 | 文案 |
|------|------|
| `npx clawhub@latest install mapick` | Advanced only. Installs into current workdir/workspace; use when debugging ClawHub CLI behavior. |
| curl pinned | For recovery/CI only. Review script first if unsure. |
| wget | Same risk as curl. |
| developer install | For Mapick contributors. |

### 12.3 依赖展示

技能页直接读取 `SKILL.md` metadata：

```text
Requires:
- OpenClaw
- OpenClaw runtime Node.js >=22.14 (24 recommended)
- curl

```

### 12.4 安装成功页展示

ClawHub 安装成功页展示：

```text
Verified:
1. OpenClaw runtime Node.js >=22.14
2. curl
3. api.mapick.ai health
4. Skill files and shell entrypoint
5. ACP/Gateway readiness status, or explicit next setup step

Next:
  Start a new OpenClaw session, then use /mapick
```

## 13. 实施计划

### Phase 1: 文档与契约

目标：先把用户路径说清楚。

改动：

| 文件 | 动作 |
|------|------|
| `README.md` | 主入口只强调 OpenClaw native install，curl 移到 Advanced，说明安装器会验证环境、后端 health、ACP/Gateway readiness；补一句"native OpenClaw skill installer"短解释，覆盖只读过 Getting Started 的用户(§0.2 A1) |
| `SKILL.md` | 明确 install/doctor 规则；`requires.bins` 移除 `jq`(§0.2 C2)；`requires.node` 对齐 OpenClaw 文档为 `>=22.14`(§0.2 C4)；移除错挂的三条 capability signals: `Crypto`、`Requires wallet`、`Requires sensitive credentials`(§0.2 B3，对应 §11.3 绿档)；区分 OpenClaw runtime Node 和外部命令 curl |
| ClawHub 发布元数据 | 与 `SKILL.md` 同步：bins、node 版本、capability signals 三项必须在同一次发布中一并修正，否则 ClawHub 页继续显示旧错误信号 |
| `VERSION.md` | 记录安装体验变更（包含 Node 下限调整、jq 移除、capability signals 修正） |

验收：

| 用例 | 期望 |
|------|------|
| 新用户读 README | 只需记住一个推荐安装命令 |
| 高级用户找 curl | 能找到，但看到风险说明 |
| 用户问安装配置 | 明确“不需要 Mapick API key，也不需要自己配 Node；如果 ACP/Gateway 需要配对，doctor 会给 OpenClaw 官方流程” |

### Phase 2: `install.sh` 预检与冲突处理

目标：安装前知道能不能用，覆盖前知道会发生什么。

改动：

| 文件 | 动作 |
|------|------|
| `install.sh` | 增加 preflight、OpenClaw runtime semver、curl 检查、backend health、target writable 检查 |
| `install.sh` | 增加 conflict menu、noninteractive flags、atomic install、rollback |
| `install.sh` | 增加 dry-run/json 输出 |

验收：

| 用例 | 期望 |
|------|------|
| OpenClaw runtime 不可用 | 阻止安装，不写目标目录，提示修复/升级 OpenClaw |
| OpenClaw runtime Node 20（低于 22.14 floor） | 阻止安装，提示升级 OpenClaw |
| backend health 失败 | 阻止安装，不写目标目录或回滚 |
| 已装同版本 | 默认 skip |
| 已装旧版本 | 询问 update/skip/diff |
| 本地改过脚本 | 默认不覆盖 |
| 安装中断 | 旧版本仍可用 |

### Phase 3: `doctor`

目标：安装前/安装后都能诊断环境、网络、文件完整性、冲突、ACP target、Gateway pairing。

改动：

| 文件 | 动作 |
|------|------|
| `scripts/shell.js` | 增加 `doctor` command |
| `install.sh` | 安装失败时提示 `doctor` 等价检查项 |
| `SKILL.md` | 增加 `/mapick doctor` 渲染规则 |

验收：

| 用例 | 期望 |
|------|------|
| `/mapick doctor` | 列出 runtime/install/backend/permissions/conflict/acp/gateway 状态 |
| backend 挂了 | doctor 显示 FAIL，安装器阻止安装 |
| 同名 shadow | doctor 显示当前 active path |
| Gateway pairing required | doctor 显示 pending/paired 状态和 approve 命令 |
| ACP target missing | doctor 显示 defaultAgent 缺失，并提醒不要盲填 `mapick` |

### Phase 4: 安装后 smoke test

目标：安装成功前验证 `/mapick` 本地入口能启动。

改动：

| 文件 | 动作 |
|------|------|
| `install.sh` | 成功前运行文件完整性、权限、`bash shell help/id`、redact smoke test |
| `scripts/shell.js` | 首次运行捕获 ACP/Gateway 错误并转成结构化诊断 |
| `install.sh` | smoke test 失败则回滚并退出 |
| `README.md` | 明确安装成功代表本地入口可启动 |

验收：

| 用例 | 期望 |
|------|------|
| 文件缺失 | 安装失败，回滚 |
| shell 入口失败 | 安装失败，显示 stderr 摘要 |
| redaction 入口失败 | 安装失败 |
| ACP target missing | 不说“安装失败”，显示 `needs_openclaw_setup` 和 `/acp doctor` |
| Gateway pairing required | 不说“Mapick 后端失败”，显示配对流程 |

### Phase 5: ClawHub 集成

目标：让官方技能页与安装器一致。

改动：

| 模块 | 动作 |
|------|------|
| ClawHub skill page | 主 CTA、Advanced、依赖、安装成功校验项 |
| OpenClaw native installer | 读取 `requires`，安装前预检 |
| OpenClaw native installer | health endpoint 作为阻断项 |
| OpenClaw native installer | 同名冲突菜单 |
| OpenClaw native installer | `doctor` 入口 |
| ClawHub/Mapick docs | ACP/Gateway troubleshooting 文案，不建议手改 `openclaw.json` |

验收：

| 用例 | 期望 |
|------|------|
| ClawHub 页面 | 默认只推荐 `openclaw skills install mapick` |
| OpenClaw runtime 异常 | 页面/CLI 都提示升级或重装 OpenClaw |
| 后端 health 失败 | CLI 阻止安装并说明不是用户 API key 配置问题 |
| 同名 skill | 页面/CLI 都给覆盖/跳过/差异 |
| pairing required | 页面/CLI 都解释为 OpenClaw Gateway 配对，而不是 Mapick API key |

## 14. 测试矩阵

### 14.1 环境矩阵

| 环境 | 必测 |
|------|------|
| macOS Apple Silicon + brew | fresh install、upgrade、missing curl、OpenClaw runtime 异常 |
| macOS Intel + brew | fresh install |
| Ubuntu 22.04/24.04 | OpenClaw runtime 检查、curl 缺失 |
| 无 OpenClaw | 阻止安装 |
| 无网络 | download failed，目标目录不变 |
| 企业代理 | 提示 `HTTPS_PROXY` |
| GitHub release API 不通 | pin version 可安装，latest fallback 有 warning |
| `api.mapick.ai` 不通 | 阻止安装，目标目录不产生半成品 |
| Gateway pending pairing | 安装可完成但状态为 `needs_openclaw_setup`，doctor 给 approve 命令 |
| ACP defaultAgent 缺失 | 安装可完成但状态为 `needs_openclaw_setup`，doctor 给 `/acp doctor` 和 agent 配置说明 |

### 14.2 行为矩阵

| 用例 | 期望 |
|------|------|
| 缺必需依赖 | 预检失败，不写入 |
| 缺可选依赖 | 安装继续，doctor warning |
| 已安装同版本 | skip exit 0 |
| 已安装旧版本 | 交互 update；CI 需显式确认 |
| 已安装新版本 | 阻止 downgrade |
| 未知来源目录 | 默认 skip/fail safe |
| dirty 本地文件 | 默认不覆盖 |
| CONFIG 已存在 | 升级后完整保留 |
| tarball 损坏 | 不动旧目录 |
| 中途 Ctrl-C | 不留下半成品 active 目录 |
| workspace/project/personal/managed/bundled 同名 | doctor 显示 active path |
| gateway closed 1008 | doctor 显示 `gateway_pairing_required`，不建议改 Mapick 配置 |
| ACP target agent is not configured | doctor 显示 `acp_target_not_configured`，不建议默认填 `mapick` |
| redaction smoke test | fake secret 被替换 |

## 15. 最小可交付版本

如果时间有限，先做 M0：

| 优先级 | 内容 | 原因 |
|--------|------|------|
| M0-1 | README 主入口收敛 + curl warning | 立刻降低选择混乱 |
| M0-2 | `install.sh` OpenClaw runtime `>=22.14`、curl、backend health、target writable 阻断 | 避免装完不能用 |
| M0-3 | 已存在目录不再直接覆盖，至少确认/skip | 防数据和本地改动丢失 |
| M0-4 | 安装成功前跑 smoke test | 保证 `/mapick` 入口能启动 |
| M0-5 | `/mapick doctor` 基础版，覆盖 ACP/Gateway 两个真实错误 | 给用户自救入口 |

M0 不需要 ClawHub 平台大改，也不需要完整自动安装依赖。先让 Mapick 自己的安装脚本和文档不再坑新用户。

## 16. 建议的最终用户体验

用户看到：

```bash
openclaw skills install mapick
```

安装器输出：

```text
Checking Mapick...
OK    OpenClaw
OK    OpenClaw runtime Node.js v24.15.0
OK    curl
OK    backend health
OK    ACP/Gateway readiness
OK    target writable
OK    shell entrypoint

Installing mapick v0.0.6...
OK    Installed to /project/skills/mapick

Next:
  Start a new OpenClaw session, then use /mapick
```

出问题：

```bash
/mapick doctor
```

输出直接告诉他缺什么、怎么修、哪个 Mapick 正在生效。如果文件已安装但 OpenClaw 还没完成 ACP/Gateway 设置，输出应该是：

```text
Mapick is installed, but OpenClaw setup is incomplete.

OK    Skill files: /project/skills/mapick
OK    Backend health
FAIL  Gateway pairing: pairing required
FAIL  ACP target: default agent is not configured

Next:
  Run /acp doctor
  Run openclaw devices list and approve the pending request
```

## 17. 外部参考资料

- [OpenClaw Getting Started](https://docs.openclaw.ai/start/getting-started)：用户已经完成 OpenClaw 安装、onboarding、Gateway 验证和模型 API key 后，Mapick 安装计划不再重复解决这些前置。
- [OpenClaw ClawHub](https://docs.openclaw.ai/tools/clawhub)：官方主路径是 `openclaw skills install <skill-slug>`；native install 写入 active workspace，并提示新会话加载 Skill。
- [OpenClaw Skills](https://docs.openclaw.ai/tools/skills)：Skill 加载存在 workspace/project/personal/managed/bundled 多级优先级；doctor 必须显示 active path，不能只检查 `~/.openclaw/skills`。
- [OpenClaw ACP Agents](https://docs.openclaw.ai/tools/acp-agents)：`acp.defaultAgent` 是 ACP harness agent id，缺失时会触发 ACP target 错误；应通过 `/acp doctor` 诊断，而不是默认填 Skill slug。
- [OpenClaw Pairing](https://docs.openclaw.ai/pairing)：Gateway/device/node pairing 是 owner approval 流程；`pairing required` 应引导用户 approve pending request。
- [OpenClaw Gateway-owned pairing](https://docs.openclaw.ai/gateway/pairing)：部分版本/flow 使用 `openclaw nodes pending|approve|status`；doctor 应按当前 CLI 能力显示正确命令。
- [ClawHub Mapick 页面](https://clawhub.ai/sunlleyevan/mapick)：当前页面同时展示多种安装入口、`node/jq/curl` 依赖和 suspicious 提示，是本计划需要优先修正的 Mapick 安装体验来源。
- [ClawHub find-skills-skill 页面](https://clawhub.ai/fangkelvin/find-skills-skill)：instruction-only skill 的对照参考，全部 Benign。用于 §11.3 说明 Mapick 的红档信号是结构性而非配置问题。
- [Homebrew Installation](https://docs.brew.sh/Installation.html)：Homebrew 安装后需要把 `brew shellenv` 写入 shell 配置；否则会出现 `brew` 装了但命令不可用。
- [Node.js Download](https://nodejs.org/en/download)：Node 官方下载页展示当前 LTS 和 EOL 版本；仅用于 Advanced/developer install 或 OpenClaw runtime 版本排查，不作为普通用户手动安装前置。
- [curl SSL CA Certificates](https://curl.se/docs/sslcerts.html)：curl 默认校验证书，CA store / 自签证书 / 企业代理都可能导致 TLS 校验失败。
- [curl environment variables](https://curl.se/libcurl/c/libcurl-env.html)：curl 会读取 proxy 环境变量，安装器诊断应展示当前是否走代理。
- [curl manpage environment](https://curl.se/docs/manpage.html?force_isolation=true)：`HTTPS_PROXY`、`HTTP_PROXY`、`NO_PROXY` 会影响请求路径。
- [npm EACCES permissions](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/)：全局安装权限错误是新手常见坑；Mapick 安装应避免依赖用户手动修 npm global 权限。
- [npm common errors](https://docs.npmjs.com/common-errors/)：npm 常见错误包含磁盘空间、权限、SSL、代理、Invalid JSON 等；可转化为 doctor 的网络/权限/空间诊断项。
- [npm folders](https://docs.npmjs.com/cli/v7/configuring-npm/folders)：npm 全局安装路径和可执行文件路径会受 prefix 影响，诊断时要显示真实生效路径。
