#!/usr/bin/env node
// Mapick Stats Dashboard — standalone HTTP server
// Serves a live stats dashboard at http://127.0.0.1:<port>
//
// Usage: node scripts/stats-dashboard.js [port]
//   port defaults to 3030

const http = require("http");
const path = require("path");

const PORT = parseInt(process.argv[2] || "3030", 10);
const API_BASE = "http://127.0.0.1:3010/api/v1";

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mapick 统计面板</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0d1117;
    color: #c9d1d9;
    padding: 24px;
    min-height: 100vh;
  }
  .container { max-width: 960px; margin: 0 auto; }
  header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 32px; padding-bottom: 16px;
    border-bottom: 1px solid #30363d;
  }
  h1 { font-size: 24px; font-weight: 600; color: #58a6ff; }
  h1 small { font-size: 14px; font-weight: 400; color: #8b949e; margin-left: 12px; }
  .status {
    font-size: 13px; padding: 4px 12px; border-radius: 12px;
    background: #1c2128; color: #8b949e;
  }
  .status.online { color: #3fb950; }
  .status.offline { color: #f85149; }
  .grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
    margin-bottom: 24px;
  }
  .card {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 20px;
  }
  .card h3 {
    font-size: 13px; font-weight: 500; color: #8b949e;
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
  }
  .card .value {
    font-size: 36px; font-weight: 700; color: #f0f6fc;
    line-height: 1.2;
  }
  .card .sub {
    font-size: 13px; color: #8b949e; margin-top: 4px;
  }
  .card .value.green { color: #3fb950; }
  .card .value.blue { color: #58a6ff; }
  .card .value.purple { color: #bc8cff; }
  .card .value.orange { color: #d29922; }
  .card .value.pink { color: #f778ba; }
  h2 {
    font-size: 16px; font-weight: 600; margin-bottom: 16px;
    color: #f0f6fc;
  }
  .conversion {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 24px; margin-bottom: 24px;
  }
  .funnel {
    display: flex; align-items: center; gap: 8px;
    margin-top: 16px;
  }
  .funnel-step {
    flex: 1; text-align: center; padding: 16px 8px;
    border-radius: 6px;
  }
  .funnel-step .label { font-size: 12px; color: #8b949e; margin-bottom: 4px; }
  .funnel-step .count { font-size: 28px; font-weight: 700; }
  .funnel-arrow { color: #30363d; font-size: 24px; }
  .funnel-rate {
    flex: 0 0 auto; text-align: center; padding: 12px 16px;
    background: #1c2128; border-radius: 6px; min-width: 80px;
  }
  .funnel-rate .label { font-size: 12px; color: #8b949e; }
  .funnel-rate .pct { font-size: 20px; font-weight: 700; color: #3fb950; }
  .fun-fact {
    background: linear-gradient(135deg, #1c2128, #161b22);
    border: 1px solid #30363d; border-radius: 8px;
    padding: 20px; text-align: center;
    font-size: 15px; line-height: 1.6;
  }
  .fun-fact .label { color: #8b949e; font-size: 12px; text-transform: uppercase; margin-bottom: 8px; }
  .fun-fact .text { color: #f0f6fc; }
  .events-table {
    width: 100%; border-collapse: collapse; margin-top: 12px;
  }
  .events-table th {
    text-align: left; font-size: 12px; color: #8b949e;
    text-transform: uppercase; padding: 8px 12px;
    border-bottom: 1px solid #21262d;
  }
  .events-table td {
    padding: 8px 12px; font-size: 14px; border-bottom: 1px solid #21262d;
    font-family: monospace;
  }
  footer {
    margin-top: 32px; text-align: center;
    font-size: 12px; color: #484f58;
  }
  .error { color: #f85149; text-align: center; padding: 40px; }
  .loading { text-align: center; padding: 40px; color: #8b949e; }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Mapick 统计面板 <small>v0.0.15</small></h1>
    <span class="status" id="api-status">检查连接中…</span>
  </header>

  <div class="grid" id="global-grid">
    <div class="card"><h3>全球安装</h3><div class="value blue" id="installs">—</div><div class="sub">skill 总安装次数</div></div>
    <div class="card"><h3>每日交互</h3><div class="value green" id="daily">—</div><div class="sub">今日活跃</div></div>
    <div class="card"><h3>覆盖 Skill</h3><div class="value purple" id="covered">—</div><div class="sub">可搜索 Skill 总数</div></div>
  </div>

  <div class="conversion">
    <h2>📈 推荐转化漏斗</h2>
    <div class="funnel" id="funnel">
      <div class="funnel-step" style="background:#1c2128;">
        <div class="label">展示</div><div class="count" id="rec-shown" style="color:#58a6ff;">—</div>
      </div>
      <div class="funnel-arrow">→</div>
      <div class="funnel-step" style="background:#1c2128;">
        <div class="label">点击</div><div class="count" id="rec-clicked" style="color:#d29922;">—</div>
      </div>
      <div class="funnel-arrow">→</div>
      <div class="funnel-step" style="background:#1c2128;">
        <div class="label">安装</div><div class="count" id="rec-installed" style="color:#3fb950;">—</div>
      </div>
      <div class="funnel-rate" id="conversion-rate">
        <div class="label">转化率</div><div class="pct" id="rate-pct">—</div>
      </div>
    </div>
    <table class="events-table">
      <tr><th>事件类型</th><th>数量</th><th>占比</th></tr>
      <tr><td>推荐展示 (rec_shown)</td><td id="t-shown">—</td><td id="t-shown-pct">—</td></tr>
      <tr><td>推荐点击 (rec_click)</td><td id="t-clicked">—</td><td id="t-clicked-pct">—</td></tr>
      <tr><td>推荐安装 (rec_installed)</td><td id="t-installed">—</td><td id="t-installed-pct">—</td></tr>
      <tr><td>事件总数</td><td id="t-total" style="font-weight:700;">—</td><td>100%</td></tr>
    </table>
  </div>

  <div class="fun-fact" id="fun-fact">
    <div class="label">💡 冷知识</div>
    <div class="text" id="fact-text">加载中…</div>
  </div>

  <footer>
    Mapick v0.0.15 · 数据每 30 秒自动刷新 · 后端: 127.0.0.1:3010
  </footer>
</div>

<script>
async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(resp.statusText);
  return resp.json();
}

async function refresh() {
  const apiStatus = document.getElementById('api-status');
  try {
    const [stats, events] = await Promise.all([
      fetchJSON('http://127.0.0.1:3010/api/v1/stats/public').catch(() => ({
        installs: 0, dailyInteractions: 0, skillsCovered: 0
      })),
      fetchJSON('/api/stats/local').catch(() => ({
        events_logged: 0, rec_shown: 0, rec_clicked: 0,
        rec_installed: 0, conversion_rate: '—', fun_fact: '暂无数据'
      })),
    ]);

    apiStatus.textContent = '🟢 已连接';
    apiStatus.className = 'status online';

    document.getElementById('installs').textContent =
      (stats.installs || 0).toLocaleString();
    document.getElementById('daily').textContent =
      (stats.dailyInteractions || 0).toLocaleString();
    document.getElementById('covered').textContent =
      (stats.skillsCovered || 0).toLocaleString();

    const shown = events.rec_shown || 0;
    const clicked = events.rec_clicked || 0;
    const installed = events.rec_installed || 0;
    const total = events.events_logged || 0;

    document.getElementById('rec-shown').textContent = shown || '0';
    document.getElementById('rec-clicked').textContent = clicked || '0';
    document.getElementById('rec-installed').textContent = installed || '0';
    document.getElementById('rate-pct').textContent =
      events.conversion_rate || (shown > 0 ? Math.round(installed/shown*100) + '%' : '—');

    document.getElementById('t-shown').textContent = shown;
    document.getElementById('t-clicked').textContent = clicked;
    document.getElementById('t-installed').textContent = installed;
    document.getElementById('t-total').textContent = total;

    document.getElementById('t-shown-pct').textContent =
      total > 0 ? (shown/total*100).toFixed(1) + '%' : '—';
    document.getElementById('t-clicked-pct').textContent =
      total > 0 ? (clicked/total*100).toFixed(1) + '%' : '—';
    document.getElementById('t-installed-pct').textContent =
      total > 0 ? (installed/total*100).toFixed(1) + '%' : '—';

    document.getElementById('fact-text').textContent =
      events.fun_fact || '暂无冷知识数据';
  } catch (err) {
    apiStatus.textContent = '🔴 连接失败';
    apiStatus.className = 'status offline';
    console.error('Refresh failed:', err);
  }
}

refresh();
setInterval(refresh, 30_000);
</script>
</body>
</html>`;

// ── Local stats proxy ──────────────────────────────────────────
// The dashboard fetches /api/stats/local from this server, which
// runs the local mapick stats command and returns the JSON.
function getLocalStats() {
  const { execFileSync } = require("child_process");
  try {
    const shellPath = path.join(__dirname, "shell.js");
    const out = execFileSync(process.execPath, [shellPath, "stats"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    return JSON.parse(out);
  } catch (e) {
    return {
      events_logged: 0,
      rec_shown: 0,
      rec_clicked: 0,
      rec_installed: 0,
      conversion_rate: "—",
      fun_fact: "Stats unavailable: " + (e.message || "unknown error"),
    };
  }
}

// ── HTTP server ────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === "/api/stats/local") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(getLocalStats()));
    return;
  }
  if (req.url === "/api/health" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
    return;
  }

  // Serve the dashboard HTML for any other path.
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(DASHBOARD_HTML);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`📊 Mapick 统计面板已启动`);
  console.log(`   http://127.0.0.1:${PORT}`);
  console.log(`   数据每 30 秒自动刷新`);
  console.log(`   Ctrl+C 停止服务`);
});
