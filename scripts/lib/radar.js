// P2: 每日低频 Radar（"机会雷达"）
//
// Locally detects skill gaps by cross-referencing trending recommendations
// against installed skills. Returns at most 2 personalized gap alerts, or
// goes silent when there's nothing to report.
//
// Frequency control:
//   - 1 run per day max (last_radar_at)
//   - Same category silent for 7 days (radar_cat_<name>_at)
//   - 2 user rejections → skip category for 14 days (radar_cat_<name>_rejects)

const {
  OUT_ARR,
  isoNow,
  readConfig, writeConfig, deleteConfig,
  isConsentDeclined,
} = require("./core");
const { httpCall } = require("./http");

const RADAR_COOLDOWN_HOURS = 23;   // ~1 day
const CATEGORY_COOLDOWN_DAYS = 7;
const CATEGORY_REJECT_DAYS = 14;
const MAX_REJECTS_BEFORE_MUTE = 2;

// Simple category tagger: maps a skill name to a coarse category so we
// can suppress same-category repeats.
function categorize(skillName) {
  const s = (skillName || "").toLowerCase();
  if (/git|github|pr|code.review|merge|commit|diff|branch/i.test(s)) return "dev-tools";
  if (/deploy|k8s|docker|ci|cd|pipeline|terraform|infra/i.test(s)) return "devops";
  if (/test|qa|security|audit|scan|vuln/i.test(s)) return "security-qa";
  if (/data|analytics|visualization|chart|dashboard|report/i.test(s)) return "data";
  if (/content|writing|blog|seo|marketing|social/i.test(s)) return "content";
  if (/productivity|calendar|email|notion|todo|task/i.test(s)) return "productivity";
  if (/ai|llm|gpt|claude|prompt|agent|chat/i.test(s)) return "ai-tools";
  if (/design|ui|ux|figma|css|component/i.test(s)) return "design";
  if (/api|rest|graphql|http|backend|server/i.test(s)) return "backend";
  return "general";
}

function daysSince(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / 86_400_000;
}

// Check frequency gates. Returns null if OK, or a reason string if blocked.
function checkFrequency(config) {
  const lastRadar = config.last_radar_at;
  const hoursSince = lastRadar ? (Date.now() - new Date(lastRadar).getTime()) / 3_600_000 : Infinity;
  if (hoursSince < RADAR_COOLDOWN_HOURS) {
    return `cooldown_${Math.round(RADAR_COOLDOWN_HOURS - hoursSince)}h`;
  }
  return null;
}

// Check category-level cooldown. Returns null if OK, or a reason string.
function checkCategoryCooldown(config, category) {
  const lastSeen = config[`radar_cat_${category}_at`];
  if (daysSince(lastSeen) < CATEGORY_COOLDOWN_DAYS) return "category_cooldown";

  const rejects = parseInt(config[`radar_cat_${category}_rejects`] || "0", 10);
  if (rejects >= MAX_REJECTS_BEFORE_MUTE) {
    // After MAX_REJECTS, use extended cooldown
    if (daysSince(lastSeen) < CATEGORY_REJECT_DAYS) return "category_muted";
  }
  return null;
}

// Track that a category was shown (so it won't show again for 7 days).
function trackCategoryShown(category) {
  writeConfig(`radar_cat_${category}_at`, isoNow());
}

// Track user rejection — increments the rejection counter.
function trackReject(category) {
  const config = readConfig();
  const count = parseInt(config[`radar_cat_${category}_rejects`] || "0", 10);
  writeConfig(`radar_cat_${category}_rejects`, String(count + 1));
  writeConfig(`radar_cat_${category}_at`, isoNow());
}

async function handleRadar(_args, ctx) {
  // Respect consent — radar pulls from recommend feed (remote).
  if (isConsentDeclined(ctx.config)) {
    return { intent: "radar", silent: true, reason: "consent_declined" };
  }

  // Frequency gate.
  const freqBlock = checkFrequency(ctx.config);
  if (freqBlock) {
    return { intent: "radar", silent: true, reason: freqBlock };
  }

  // Get installed skills for cross-reference.
  const { scanSkills } = require("./skills");
  const installed = new Set(scanSkills().map((s) => s.id.toLowerCase()));
  const installedCount = scanSkills().length;

  // Build recentSkills from top_used if available
  let recentSkills = [];
  if (ctx.config.top_used) {
    try {
      recentSkills = JSON.parse(ctx.config.top_used);
    } catch {
      // Parse failure, use empty
    }
  }
  recentSkills = recentSkills.slice(0, 5);

  // Get trending recommendations as candidate gaps — try contextual first.
  let candidates = [];
  try {
    // Try contextual endpoint first
    let contextualUrl = `/recommendations/contextual?limit=${Math.min(OUT_ARR, 10)}&installedCount=${installedCount}`;
    if (recentSkills.length > 0) {
      contextualUrl += `&recentSkills=${encodeURIComponent(recentSkills.join(","))}`;
    }
    const resp = await httpCall("GET", contextualUrl, null, "radar");
    if (!resp.error) {
      candidates = resp.items || resp.recommendations || [];
    } else {
      // Fall back to feed endpoint on contextual error
      const feedResp = await httpCall("GET", `/recommendations/feed?limit=${Math.min(OUT_ARR, 10)}`, null, "radar");
      candidates = feedResp.items || feedResp.recommendations || [];
    }
  } catch {
    return { intent: "radar", silent: true, reason: "backend_unreachable" };
  }

  // Filter: remove already-installed skills.
  const gaps = candidates.filter((item) => {
    const id = (item.skillId || item.skillName || "").toLowerCase();
    return !installed.has(id);
  });

  if (gaps.length === 0) {
    writeConfig("last_radar_at", isoNow());
    return { intent: "radar", silent: true, reason: "no_gaps" };
  }

  // Apply category cooldown and pick top 2 gaps.
  const active = [];
  for (const gap of gaps) {
    if (active.length >= 2) break;
    const name = gap.skillName || gap.name || "";
    const category = categorize(name);
    if (!checkCategoryCooldown(ctx.config, category)) {
      active.push({ ...gap, _category: category });
      trackCategoryShown(category);
    }
  }

  if (active.length === 0) {
    writeConfig("last_radar_at", isoNow());
    return { intent: "radar", silent: true, reason: "all_categories_cooling" };
  }

  writeConfig("last_radar_at", isoNow());

  return {
    intent: "radar",
    silent: false,
    gaps: active.map((g) => ({
      skillName: g.skillName || g.name,
      skillId: g.skillId || g.skillName,
      reasonEn: g.reasonEn || "Trending skill that fills a gap in your toolkit.",
      installCount: g.installCount,
      score: g.score,
      safety: g.safety,
      category: g._category,
    })),
    checked_at: isoNow(),
  };
}

// handleRadarReject: track user dismissal of a radar gap. Increments the
// rejection counter for the category. After 2 rejections in the same
// category, the category is muted for 14 days.
function handleRadarReject(args) {
  const category = args[0];
  if (!category) return { error: "missing_argument", hint: "Usage: radar:reject <category>" };
  trackReject(category);
  return { intent: "radar:reject", category, rejected: true };
}

module.exports = {
  handleRadar,
  handleRadarReject,
  // Exported for testing and external use (e.g., notify integration).
  categorize,
  checkFrequency,
  checkCategoryCooldown,
  trackReject,
};
