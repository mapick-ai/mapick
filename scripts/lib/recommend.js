// recommend / search / recommend:track / intent handlers.

const {
  OUT_ARR, VALID_TRACK_ACTIONS,
  readCache, writeCache,
} = require("./core");
const { httpCall, apiCall, missingArg } = require("./http");

// P1: Intent → Keyword → Search
// Locally extract keywords from natural language without sending the full
// chat to the backend. Only the extracted keywords are transmitted.
//
// Two-pass extraction:
//   1. English/technical terms — always preserved (space-separated).
//   2. CJK text — filler phrases stripped, meaningful chars grouped into
//      n-grams, then joined with spaces.

// Multi-char CJK filler phrases (ordered longest-first to avoid partial matches).
const CN_FILLER_PHRASES = [
  "可不可以", "能不能", "有没有", "是不是", "会不会", "需不需要",
  "帮我做", "帮我把", "帮我找", "帮我看看", "帮我查", "帮我读", "帮我写",
  "我想用", "我想要", "我需要", "我要做", "我想做",
  "怎么用", "怎么样", "怎么做", "如何做", "怎么做才能", "怎么才能",
  "能不能帮我", "可不可以帮我",
  "有没有办法", "有没有什么",
  "请问有没有", "麻烦问一下",
  "能不能帮我生成",
];

// Single-char CJK stopwords — particles, pronouns, generic verbs that
// carry no domain signal.
const CN_CHAR_STOPWORDS = new Set(
  "的是在了有不这和或吗呢吧啊哦嗯我你他她它我们你们他们这那哪些哪个请请问麻烦谢谢" +
  "要会能可以好吗行的一个些点种么麽怎哪给到对从让被把和跟与".split(""),
);

// Min meaningful CJK segment length (chars).
const MIN_CJK_SEGMENT = 2;

// CJK meta-words — domain-independent terms that add no search signal
// when used alongside content-bearing CJK terms.
const CJK_META_WORDS = new Set([
  "工具", "方法", "方式", "软件", "插件", "扩展",
  "系统", "平台", "功能", "服务", "应用",
]);

// EN meta-words — when CJK content is present, these generic English
// terms are filler, not search topics (e.g. "skill", "tool").
const EN_META_WORDS = new Set([
  "skill", "tool", "plugin", "extension", "help",
  "how", "use", "want", "need", "get", "make",
  "take", "find",
]);

function extractIntentKeywords(text) {
  if (!text || typeof text !== "string") return "";
  let s = text.toLowerCase().trim();

  // ---- Pass 1: extract English / alphanumeric terms ----
  // Match standalone English-like tokens (words, acronyms, tech terms like "k8s").
  const enTerms = [];
  s = s.replace(/\b[a-z0-9][a-z0-9_.-]{1,}\b/gi, (match) => {
    // Filter short noise ("is", "be", "do", etc.)
    if (match.length >= 3 && !/^(the|and|for|are|was|not|but|all|any|its)$/i.test(match)) {
      enTerms.push(match.toLowerCase());
    }
    return " "; // replace with space so CJK neighbors don't merge
  });

  // ---- Pass 2: CJK content extraction ----
  // 2a. Strip multi-char filler phrases.
  for (const phrase of CN_FILLER_PHRASES) {
    // Use split-join instead of replaceAll for broader Node compat.
    s = s.split(phrase).join(" ");
  }

  // 2b. Walk the remaining string, collecting CJK runs.
  const cjkRuns = [];
  let buf = "";
  const flush = () => {
    if (buf.length >= MIN_CJK_SEGMENT) cjkRuns.push(buf);
    buf = "";
  };

  for (const ch of s) {
    if (/[\u4e00-\u9fff]/.test(ch)) {
      // CJK character — accumulate unless it's a stopword.
      if (!CN_CHAR_STOPWORDS.has(ch)) {
        buf += ch;
      } else {
        flush();
      }
    } else {
      flush();
    }
  }
  flush();

  // 2c. Keep CJK segments as-is after filler/stopword stripping.
  //     The remaining runs are already meaningful keywords — no further
  //     fragmentation (bigrams/n-grams) needed.
  const cjkTokens = [...cjkRuns];

  // ---- Combine, filter meta-terms, deduplicate ----
  // EN meta-words like "want", "skill", "tool" add no search signal —
  // always drop them. CJK meta-words ("工具", "方法"…) are only dropped
  // when other CJK content is present (otherwise they might be the sole topic).
  const filteredEn = enTerms.filter((t) => !EN_META_WORDS.has(t));
  const hasCJKContent = cjkTokens.length > 0;
  const filteredCjk = hasCJKContent
    ? cjkTokens.filter((t) => !CJK_META_WORDS.has(t))
    : cjkTokens;
  const all = [...filteredEn, ...filteredCjk];
  const seen = new Set();
  const filtered = [];
  for (const t of all) {
    if (!seen.has(t)) {
      seen.add(t);
      filtered.push(t);
    }
  }

  // Return keywords sorted longest-first (more specific is better).
  filtered.sort((a, b) => b.length - a.length || a.localeCompare(b));
  return filtered.join(" ");
}

// handleIntent: the P1 entry point. Takes natural language, extracts
// keywords locally, searches. The full user message is never sent to the
// backend — only the extracted keywords are transmitted.
async function handleIntent(args) {
  const phrase = args.join(" ").trim();
  if (!phrase) return missingArg("Usage: intent <natural language description>");

  const keywords = extractIntentKeywords(phrase);
  if (!keywords) {
    return {
      intent: "intent",
      original: phrase,
      keywords: "",
      items: [],
      total: 0,
      notice: "Could not extract meaningful keywords. Try a more specific description, or use /mapick search with your own keywords.",
    };
  }

  // Search with the extracted keywords — only keywords leave the machine.
  let searchedWith = keywords;
  let searchResp = await httpCall(
    "GET",
    `/skills/live-search?query=${encodeURIComponent(keywords)}&limit=${Math.min(OUT_ARR, 5)}`,
  );

  // Fallback: when the combined query returns 0 results (common with mixed
  // CJK+EN multi-term queries due to AND-search logic), retry with the
  // longest single keyword.
  if (!searchResp.error) {
    let items = searchResp.results || searchResp.items || [];
    if (items.length === 0) {
      const parts = keywords.split(" ");
      if (parts.length > 1) {
        // Try each keyword individually, stop at first hit.
        for (let i = 0; i < Math.min(parts.length, 3); i++) {
          const fbResp = await httpCall(
            "GET",
            `/skills/live-search?query=${encodeURIComponent(parts[i])}&limit=${Math.min(OUT_ARR, 5)}`,
          );
          if (!fbResp.error) {
            const fbItems = fbResp.results || fbResp.items || [];
            if (fbItems.length > 0) {
              searchResp = fbResp;
              searchedWith = parts[i];
              break;
            }
          }
        }
      }
    }
  }

  if (searchResp.error) {
    return {
      intent: "intent",
      original: phrase,
      keywords,
      items: [],
      total: 0,
      error: searchResp.error,
      notice: `Keywords extracted: "${keywords}" — but the search backend is unreachable. Try again later or use explicit keywords with /mapick search.`,
    };
  }

  const items = searchResp.results || searchResp.items || [];
  return {
    intent: "intent",
    original: phrase,
    keywords: searchedWith === keywords ? keywords : `${keywords} (fallback: ${searchedWith})`,
    items,
    total: items.length,
    notice: items.length === 0
      ? `No matches for keywords "${keywords}". Try broadening your description.`
      : undefined,
  };
}

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
      ? { notice: "Few matches. Try a broader keyword or another category." }
      : {}),
  };
}

module.exports = {
  extractIntentKeywords,
  handleIntent,
  handleRecommend,
  handleTrack,
  handleSearch,
};
