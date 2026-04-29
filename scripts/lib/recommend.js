// recommend / search / recommend:track handlers.

const {
  OUT_ARR, VALID_TRACK_ACTIONS,
  readCache, writeCache,
} = require("./core");
const { httpCall, apiCall, missingArg } = require("./http");

async function handleRecommend(args, ctx) {
  const withProfile = args.includes("--with-profile");
  const numericArgs = args.filter((a) => !a.startsWith("--"));
  const limit = parseInt(numericArgs[0]) || 5;
  const cacheKey = `recommend_${ctx.fp}_${withProfile ? "profile" : "plain"}`;
  const cached = readCache(cacheKey);

  // Explicit limit or --with-profile bypasses the 24h cache.
  const useCache = !withProfile && numericArgs.length === 0;
  if (useCache && cached) {
    return { intent: "recommend", items: cached.items, cached: true };
  }

  let url = `/recommendations/feed?limit=${limit}`;
  if (withProfile) {
    const tagsRaw = ctx.config.user_profile_tags || "";
    // JSON array string; on parse failure, fall back to comma-separated.
    let tags = [];
    try {
      tags = JSON.parse(tagsRaw);
    } catch {
      tags = tagsRaw.split(",").filter(Boolean);
    }
    if (tags.length > 0) {
      url += `&profileTags=${encodeURIComponent(tags.join(","))}`;
    }
    url += `&withProfile=1`;
  }
  const resp = await httpCall("GET", url);
  if (resp.error) return resp;
  const result = {
    intent: "recommend",
    items: resp.items || resp.recommendations || [],
    withProfile,
  };
  writeCache(cacheKey, { items: result.items });
  return result;
}

async function handleTrack(args, ctx) {
  if (args.length < 3) {
    return missingArg("Usage: recommend:track <recId> <skillId> <action>");
  }
  const [recId, skillId, action] = args;
  if (!VALID_TRACK_ACTIONS.includes(action)) {
    return { error: "invalid_action", valid: VALID_TRACK_ACTIONS };
  }
  return apiCall(
    "POST",
    "/recommendations/track",
    { recId, skillId, action, userId: ctx.fp },
    "recommend:track",
  );
}

async function handleSearch(args) {
  const query = args[0] || "";
  const searchLimit = Math.min(parseInt(args[1]) || 10, 20);
  if (!query.trim()) {
    return { intent: "search", items: [], total: 0, query: "" };
  }
  const searchResp = await httpCall(
    "GET",
    `/skills/live-search?query=${encodeURIComponent(query)}&limit=${searchLimit}`,
  );
  if (searchResp.error) return searchResp;
  const items = searchResp.results || searchResp.items || [];
  return {
    intent: "search",
    items,
    total: items.length,
    query,
    ...(items.length < 5
      ? { notice: "Few local matches. Try ClawHub for more results." }
      : {}),
  };
}

module.exports = {
  handleRecommend,
  handleTrack,
  handleSearch,
};
