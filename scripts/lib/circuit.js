/**
 * circuit.js — 持久化熔断器
 *
 * 状态机：CLOSED → OPEN → HALF_CLOSED → CLOSED
 * 两级：全局（API 整体宕机）+ 端点组（单端点不稳定）
 * 429 不计入熔断——API 在线但限流
 */

const path = require("path");
const os = require("os");

const CACHE_DIR = path.join(os.homedir(), ".mapick", "cache");

// ---- 常量 ----

const STATE = { CLOSED: 0, OPEN: 1, HALF_CLOSED: 2 };

// 触发阈值：[错误类别] → { 计数, 窗口秒 }
const TRIGGERS = {
  dns: { count: 2, windowSec: 60 },
  tcp: { count: 3, windowSec: 60 },
  abort: { count: 3, windowSec: 120 },
  server: { count: 3, windowSec: 60 },
};

// 冷却时间（指数退避）
const BASE_COOLDOWN = 30;
const MAX_COOLDOWN = 300;

// 端点分组
const GROUP_MAP = {
  assistant: ["/assistant/"],
  recommend: ["/recommendations/"],
  search: ["/skills/live-search", "/skills/check-updates"],
  security: ["/skill/", "/users/data"],
  event: ["/events/", "/recommendations/track", "/notify/"],
  bundle: ["/bundle"],
  profile: ["/users/", "/report/", "/share/"],
  stats: ["/stats/", "/perception/"],
};

// ---- 工具函数 ----

let _fs, _mkdir;
try {
  _fs = require("fs");
  _mkdir = (d) => _fs.mkdirSync(d, { recursive: true });
} catch { /* browser env -- noop */ }

function readJson(file) {
  try {
    if (!_fs) return null;
    const raw = _fs.readFileSync(file, "utf-8");
    const data = JSON.parse(raw);
    if (data._expires && Date.now() > data._expires) return null;
    return data;
  } catch {
    return null;
  }
}

function writeJson(file, data, ttlMs) {
  if (!_fs) return;
  try {
    if (!_fs.existsSync(CACHE_DIR)) _mkdir(CACHE_DIR);
    if (ttlMs) data._expires = Date.now() + ttlMs;
    _fs.writeFileSync(file, JSON.stringify(data));
  } catch { /* 静默失败，下次命令再写 */ }
}

function cooldownMs(retryCount) {
  return Math.min(BASE_COOLDOWN * Math.pow(2, retryCount), MAX_COOLDOWN) * 1000;
}

function groupForEndpoint(endpoint) {
  for (const [group, prefixes] of Object.entries(GROUP_MAP)) {
    if (prefixes.some((p) => endpoint.startsWith(p))) return group;
  }
  return "other";
}

// ---- 状态读写 ----

function readGlobal() {
  const data = readJson(path.join(CACHE_DIR, "circuit-global.json"));
  return (data && data.state !== undefined) ? data : { state: STATE.CLOSED, openedAt: 0, retryCount: 0, reason: "" };
}

function writeGlobal(state) {
  writeJson(path.join(CACHE_DIR, "circuit-global.json"), state, 600_000); // TTL 10min
}

function readGroup(name) {
  const data = readJson(path.join(CACHE_DIR, `circuit-${name}.json`));
  return (data && data.state !== undefined) ? data : { state: STATE.CLOSED, openedAt: 0, retryCount: 0, reason: "" };
}

function writeGroup(name, state) {
  writeJson(path.join(CACHE_DIR, `circuit-${name}.json`), state, 600_000);
}

// ---- 核心 API ----

/** 检查端点是否可以发出请求。返回 false 表示熔断中 */
function allowRequest(endpoint) {
  const global = readGlobal();
  const now = Date.now();

  // 全局熔断
  if (global.state === STATE.OPEN) {
    if (now >= global.openedAt + cooldownMs(global.retryCount)) {
      // 冷却到 → 进入 HALF_CLOSED
      global.state = STATE.HALF_CLOSED;
      writeGlobal(global);
    } else {
      return false; // 仍在熔断
    }
  }

  // 组熔断
  const group = groupForEndpoint(endpoint);
  const gs = readGroup(group);
  if (gs.state === STATE.OPEN) {
    if (now >= gs.openedAt + cooldownMs(gs.retryCount)) {
      gs.state = STATE.HALF_CLOSED;
      writeGroup(group, gs);
    } else {
      return false;
    }
  }

  return true;
}

/** 记录请求失败 */
function recordFailure(endpoint, errorClass, statusCode) {
  const now = Date.now();
  const group = groupForEndpoint(endpoint);

  // 429 不计入熔断
  if (statusCode === 429 || errorClass === "rate_limit") return;

  // 更新组状态
  const gs = readGroup(group);
  const trigger = TRIGGERS[errorClass] || { count: 3, windowSec: 60 };

  // 滑动窗口：清理过期记录
  gs._errors = (gs._errors || []).filter((e) => now - e.ts < trigger.windowSec * 1000);
  gs._errors.push({ ts: now, class: errorClass, status: statusCode });

  if (gs._errors.length >= trigger.count) {
    gs.state = STATE.OPEN;
    gs.openedAt = now;
    gs.retryCount = (gs.retryCount || 0) + 1;
    gs.reason = `${errorClass}: ${gs._errors.length} failures in ${trigger.windowSec}s`;
    gs._errors = [];
    writeGroup(group, gs);
  } else {
    writeGroup(group, gs); // 只更新计数器
  }

  // 检查是否需要升级到全局熔断
  const global = readGlobal();
  global._errors = (global._errors || []).filter((e) => now - e.ts < trigger.windowSec * 1000);
  global._errors.push({ ts: now, group });
  if (global._errors.length >= trigger.count) {
    global.state = STATE.OPEN;
    global.openedAt = now;
    global.retryCount = (global.retryCount || 0) + 1;
    global.reason = `Multiple group failures: ${global._errors.map((e) => e.group).join(", ")}`;
    global._errors = [];
    writeGlobal(global);
  }
}

/** 记录请求成功 */
function recordSuccess(endpoint) {
  const now = Date.now();
  const group = groupForEndpoint(endpoint);
  const gs = readGroup(group);

  if (gs.state === STATE.HALF_CLOSED) {
    // HALF_CLOSED 测试通过 → 回到 CLOSED
    gs.state = STATE.CLOSED;
    gs.retryCount = 0;
    gs.reason = "";
    writeGroup(group, gs);
  } else {
    // 正常 success → 重置失败计数
    gs._errors = [];
    writeGroup(group, gs);
  }

  // 尝试恢复全局
  const global = readGlobal();
  if (global.state === STATE.HALF_CLOSED) {
    global.state = STATE.CLOSED;
    global.retryCount = 0;
    global.reason = "";
    writeGlobal(global);
  }
}

/** 快速失败返回值 */
function fastFail(reason, hint) {
  return {
    error: reason,
    circuit_open: true,
    hint,
  };
}

module.exports = {
  STATE,
  allowRequest,
  recordFailure,
  recordSuccess,
  fastFail,
  groupForEndpoint,
  // 暴露给 shell.js 做全局拦截
  readGlobal,
  readGroup,
  GROUP_MAP,
};
