// Token usage transparency — reads OpenClaw session logs to show usage stats.
// Parses ~/.openclaw/agents/main/sessions/*.jsonl files for token consumption.

const fs = require("fs");
const path = require("path");
const os = require("os");

const SESSIONS_DIR = path.join(os.homedir(), ".openclaw", "agents", "main", "sessions");

// Pricing constants (approximate, for estimation only)
const PRICE_PER_1M_INPUT = 3.0;    // $3 per 1M input tokens
const PRICE_PER_1M_OUTPUT = 15.0;  // $15 per 1M output tokens
const PRICE_PER_1M_CACHE_READ = 0.3; // $0.30 per 1M cache read tokens

function getDaysAgo(days) {
  const now = new Date();
  now.setDate(now.getDate() - days);
  return now;
}

function isWithinDays(filename, days) {
  // Session files are named with timestamps like "2026-04-30.jsonl"
  const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return false;
  const fileDate = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  return fileDate >= getDaysAgo(days);
}

function parseSessionFile(filepath) {
  const results = [];
  try {
    const content = fs.readFileSync(filepath, "utf8");
    const lines = content.split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        // Look for usage in result.meta.agentMeta.usage
        if (record?.result?.meta?.agentMeta?.usage) {
          const usage = record.result.meta.agentMeta.usage;
          results.push({
            input: usage.input_tokens || usage.input || 0,
            output: usage.output_tokens || usage.output || 0,
            cacheRead: usage.cache_read_tokens || usage.cache_read || 0,
            model: usage.model || record.result.meta.agentMeta?.model || "unknown",
          });
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // File read error
  }
  return results;
}

function aggregateUsage(records) {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  for (const r of records) {
    totalInput += r.input || 0;
    totalOutput += r.output || 0;
    totalCacheRead += r.cacheRead || 0;
  }
  // Estimate cost: input * $3/1M + output * $15/1M + cache_read * $0.30/1M
  const estimatedCost =
    (totalInput / 1_000_000) * PRICE_PER_1M_INPUT +
    (totalOutput / 1_000_000) * PRICE_PER_1M_OUTPUT +
    (totalCacheRead / 1_000_000) * PRICE_PER_1M_CACHE_READ;
  return {
    input: totalInput,
    output: totalOutput,
    cacheRead: totalCacheRead,
    total: totalInput + totalOutput + totalCacheRead,
    estimatedCost: Math.round(estimatedCost * 100) / 100, // 2 decimal places
  };
}

async function handleToken(args) {
  const subcommand = args[0] || "today";
  let period = "today";
  let days = 1;

  if (subcommand === "week" || subcommand === "7d") {
    period = "week";
    days = 7;
  } else if (subcommand === "today" || subcommand === "1d") {
    period = "today";
    days = 1;
  } else if (subcommand === "all") {
    period = "all";
    days = Infinity;
  }

  // Check if sessions directory exists
  if (!fs.existsSync(SESSIONS_DIR)) {
    return {
      intent: "stats:token",
      period,
      available: false,
      reason: "sessions_dir_not_found",
      hint: "OpenClaw session logs not found. Token stats are only available when OpenClaw session logging is enabled.",
      sessions_dir: SESSIONS_DIR,
    };
  }

  // Find session files within the period
  let sessionFiles = [];
  try {
    const files = fs.readdirSync(SESSIONS_DIR);
    sessionFiles = files
      .filter((f) => f.endsWith(".jsonl") && (days === Infinity || isWithinDays(f, days)))
      .map((f) => path.join(SESSIONS_DIR, f));
  } catch {
    return {
      intent: "stats:token",
      period,
      available: false,
      reason: "sessions_dir_read_error",
    };
  }

  if (sessionFiles.length === 0) {
    return {
      intent: "stats:token",
      period,
      available: true,
      input: 0,
      output: 0,
      cacheRead: 0,
      total: 0,
      sessions: 0,
      estimatedCost: 0,
      message: days === Infinity
        ? "No session files found."
        : `No session files found in the last ${days} days.`,
    };
  }

  // Parse each session file
  const allRecords = [];
  for (const fp of sessionFiles) {
    const records = parseSessionFile(fp);
    allRecords.push(...records);
  }

  if (allRecords.length === 0) {
    return {
      intent: "stats:token",
      period,
      available: true,
      input: 0,
      output: 0,
      cacheRead: 0,
      total: 0,
      sessions: sessionFiles.length,
      estimatedCost: 0,
      message: "Session files exist but no usage records were found.",
    };
  }

  const aggregated = aggregateUsage(allRecords);
  return {
    intent: "stats:token",
    period,
    available: true,
    input: aggregated.input,
    output: aggregated.output,
    cacheRead: aggregated.cacheRead,
    total: aggregated.total,
    sessions: sessionFiles.length,
    estimatedCost: aggregated.estimatedCost,
  };
}

module.exports = {
  handleToken,
};