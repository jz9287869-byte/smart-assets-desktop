const { BUILTIN_TAG_DEFINITIONS } = require('./tagDefinitions');

const BASE_ALIAS_ENTRIES = [
  ['女生', '女性'],
  ['女孩子', '女性'],
  ['女孩', '女性'],
  ['小姐姐', '女性'],
  ['女人', '女性'],
  ['女士', '女性'],
  ['girl', '女性'],
  ['girls', '女性'],
  ['woman', '女性'],
  ['women', '女性'],
  ['female', '女性'],
  ['lady', '女性'],
  ['男生', '男性'],
  ['男士', '男性'],
  ['男人', '男性'],
  ['boy', '男性'],
  ['man', '男性'],
  ['male', '男性'],
  ['gentleman', '男性'],
  ['单人', '单人'],
  ['一个人', '单人'],
  ['独自', '单人'],
  ['独行', '单人'],
  ['solo', '单人'],
  ['single person', '单人'],
  ['one person', '单人'],
  ['alone', '单人'],
  ['多人', '多人'],
  ['两个人', '多人'],
  ['一群人', '多人'],
  ['合照', '多人'],
  ['团体', '多人'],
  ['group', '多人'],
  ['crowd', '多人'],
  ['multiple people', '多人'],
  ['纯风景', '纯风景'],
  ['风光', '纯风景'],
  ['空镜', '纯风景'],
  ['没有人', '纯风景'],
  ['没人', '纯风景'],
  ['无人', '纯风景'],
  ['no people', '纯风景'],
  ['no person', '纯风景'],
  ['landscape only', '纯风景'],
  ['xinjiang', '新疆'],
  ['grassland', '草原'],
  ['prairie', '草原'],
  ['meadow', '草原'],
  ['horse', '马'],
  ['horses', '马'],
  ['cow', '牛'],
  ['cattle', '牛'],
  ['sheep', '羊'],
  ['goat', '羊'],
  ['snow mountain', '雪山'],
  ['snowy mountain', '雪山'],
  ['lake', '湖泊'],
  ['river', '河流'],
  ['forest', '森林'],
  ['woods', '森林'],
];

const STOP_TOKENS = new Set([
  '找',
  '想找',
  '我想找',
  '帮我找',
  '帮忙找',
  '搜索',
  '搜',
  '找出',
  '来一张',
  '一张',
  '一幅',
  '一幅图',
  '一张图',
  '一张照片',
  '图片',
  '照片',
  '图',
  '一个',
  '看看',
  '最好',
  '希望',
  '给我',
  '的',
  '在',
  '里',
  'and',
  'with',
  'photo',
  'image',
  'picture',
]);

const STRICT_TAG_ONLY_MATCHES = new Set([
  '人物',
  '女性',
  '男性',
  '单人',
  '多人',
  '纯风景',
]);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[`'"“”‘’]/g, ' ')
    .replace(/[()（）[\]【】{}]/g, ' ')
    .replace(/[.,!?;:，。！？；：/\\|_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values) {
  const output = [];
  const seen = new Set();

  for (const value of values || []) {
    const nextValue = String(value || '').trim();
    if (!nextValue || seen.has(nextValue)) {
      continue;
    }
    seen.add(nextValue);
    output.push(nextValue);
  }

  return output;
}

const SUPPLEMENTAL_STOP_TOKENS = new Set([
  '找',
  '找一张',
  '找张',
  '搜索',
  '搜图',
  '检索',
  '查询',
  '图片',
  '照片',
  '图',
  '一张',
  '一个',
  '一下',
  '帮我',
  '我想',
  '想找',
  '想搜',
  '请找',
  '请搜',
  '的',
  '在',
  '里',
  '里面',
  '里的',
  '文件夹',
  '目录',
  '素材',
  '相关',
  '包含',
  '关于',
  'with',
  'from',
]);

function stripMatchedPhrases(normalizedQuery, phrases = []) {
  let remaining = ` ${String(normalizedQuery || '')} `;
  for (const phrase of phrases) {
    const normalizedPhrase = normalizeText(phrase);
    if (!normalizedPhrase) {
      continue;
    }
    remaining = remaining.split(normalizedPhrase).join(' ');
  }
  return remaining.replace(/\s+/g, ' ').trim();
}

function extractKeywordHints(rawQuery, normalizedQuery, phrasesToStrip = []) {
  const strippedQuery = stripMatchedPhrases(
    stripMatchedPhrases(normalizedQuery, phrasesToStrip),
    Array.from(SUPPLEMENTAL_STOP_TOKENS)
  );
  const rawTokens = uniqueStrings(
    strippedQuery
      .split(/\s+/)
      .map((token) => String(token || '').trim())
      .filter(Boolean)
  );

  return uniqueStrings(
    rawTokens.filter((token) => {
      if (!token) {
        return false;
      }
      if (STOP_TOKENS.has(token) || SUPPLEMENTAL_STOP_TOKENS.has(token)) {
        return false;
      }
      if (/^[a-z0-9]+$/.test(token)) {
        return token.length >= 2;
      }
      return token.length >= 2;
    })
  );
}

function splitTags(rawTags) {
  if (!rawTags) return [];
  if (Array.isArray(rawTags)) {
    return uniqueStrings(rawTags);
  }
  return uniqueStrings(String(rawTags).split(','));
}

function collectCandidateTerms(parsedQuery, rawQuery = '') {
  return uniqueStrings([
    ...(parsedQuery?.requiredTags || []),
    ...(parsedQuery?.implicitTags || []),
    ...(parsedQuery?.keywordHints || []),
    rawQuery,
  ]);
}

function buildAvailableTagMap(tagNames = []) {
  const tagMap = new Map();
  const builtinNames = BUILTIN_TAG_DEFINITIONS.map((item) => item.name);

  for (const tagName of [...builtinNames, ...tagNames]) {
    const trimmedName = String(tagName || '').trim();
    const normalizedName = normalizeText(trimmedName);
    if (!trimmedName || !normalizedName || tagMap.has(normalizedName)) {
      continue;
    }
    tagMap.set(normalizedName, trimmedName);
  }

  return tagMap;
}

function parseNaturalLanguageQuery(query, options = {}) {
  const rawQuery = String(query || '').trim();
  const normalizedQuery = normalizeText(rawQuery);
  const availableTagMap = buildAvailableTagMap(options.tagNames || []);
  const requiredTags = [];
  const implicitTags = [];
  const excludedTags = [];
  const matchedAliases = [];
  const matchedNormalizedPhrases = [];

  const aliasEntries = BASE_ALIAS_ENTRIES
    .map(([phrase, canonical]) => ({
      phrase,
      canonical,
      normalizedPhrase: normalizeText(phrase),
    }))
    .filter((item) => item.normalizedPhrase)
    .sort((a, b) => b.normalizedPhrase.length - a.normalizedPhrase.length);

  const sortedTagEntries = Array.from(availableTagMap.entries())
    .sort((a, b) => b[0].length - a[0].length);

  const addRequiredTag = (tagName) => {
    if (tagName && !requiredTags.includes(tagName)) {
      requiredTags.push(tagName);
    }
  };

  const addImplicitTag = (tagName) => {
    if (tagName && !requiredTags.includes(tagName) && !implicitTags.includes(tagName)) {
      implicitTags.push(tagName);
    }
  };

  const addExcludedTag = (tagName) => {
    if (tagName && !excludedTags.includes(tagName)) {
      excludedTags.push(tagName);
    }
  };

  if (normalizedQuery) {
    for (const alias of aliasEntries) {
      if (!normalizedQuery.includes(alias.normalizedPhrase)) {
        continue;
      }
      addRequiredTag(alias.canonical);
      matchedAliases.push({
        phrase: alias.phrase,
        canonical: alias.canonical,
      });
      matchedNormalizedPhrases.push(alias.normalizedPhrase);
    }

    for (const [normalizedTagName, canonicalTagName] of sortedTagEntries) {
      if (normalizedQuery.includes(normalizedTagName)) {
        addRequiredTag(canonicalTagName);
        matchedNormalizedPhrases.push(normalizedTagName);
      }
    }
  }

  if (
    requiredTags.includes('女性')
    || requiredTags.includes('男性')
    || requiredTags.includes('单人')
    || requiredTags.includes('多人')
  ) {
    addImplicitTag('人物');
  }

  if (requiredTags.includes('单人')) {
    addExcludedTag('多人');
  }

  if (requiredTags.includes('多人')) {
    addExcludedTag('单人');
  }

  if (requiredTags.includes('纯风景')) {
    for (const blockedTagName of ['人物', '单人', '多人', '女性', '男性']) {
      addExcludedTag(blockedTagName);
    }
  }

  const keywordHints = uniqueStrings([
    ...(normalizedQuery.match(/[a-z0-9]{2,}/g) || [])
      .map((token) => token.trim())
      .filter((token) => token && !STOP_TOKENS.has(token) && !SUPPLEMENTAL_STOP_TOKENS.has(token)),
    ...extractKeywordHints(rawQuery, normalizedQuery, matchedNormalizedPhrases),
  ]);

  if (!requiredTags.length && !keywordHints.length && rawQuery) {
    keywordHints.push(rawQuery);
  }

  const notes = [];
  if (requiredTags.length) {
    notes.push(`已识别 ${requiredTags.length} 个检索条件`);
    notes.push('仅显示同时满足全部条件的图片');
  } else if (rawQuery) {
    notes.push('未识别到明确标签，已回退到关键词检索');
  }

  if (excludedTags.length) {
    notes.push(`自动排除 ${excludedTags.join(' / ')}`);
  }

  return {
    rawQuery,
    normalizedQuery,
    requiredTags,
    implicitTags,
    excludedTags,
    matchedAliases,
    keywordHints,
    notes,
    hasStructuredIntent: requiredTags.length > 0 || implicitTags.length > 0,
  };
}

function canUseHaystackMatch(tagName) {
  return !STRICT_TAG_ONLY_MATCHES.has(String(tagName || '').trim());
}

function scoreCandidateImage(image, parsedQuery) {
  const tags = splitTags(image?.tags);
  const normalizedTagSet = new Set(tags.map((tagName) => normalizeText(tagName)));
  const haystack = normalizeText([
    image?.filename,
    tags.join(' '),
  ].join(' '));

  const matchedRequiredTags = [];
  const missingRequiredTags = [];
  const matchedImplicitTags = [];
  const matchedKeywordHints = [];
  const missingKeywordHints = [];
  const matchedExcludedTags = [];
  let score = 0;

  for (const tagName of parsedQuery.requiredTags) {
    const normalizedTagName = normalizeText(tagName);
    if (normalizedTagSet.has(normalizedTagName)) {
      matchedRequiredTags.push(tagName);
      score += 36;
      continue;
    }

    if (canUseHaystackMatch(tagName) && normalizedTagName && haystack.includes(normalizedTagName)) {
      matchedRequiredTags.push(tagName);
      score += 14;
      continue;
    }

    missingRequiredTags.push(tagName);
  }

  for (const tagName of parsedQuery.implicitTags) {
    const normalizedTagName = normalizeText(tagName);
    if (normalizedTagSet.has(normalizedTagName)) {
      matchedImplicitTags.push(tagName);
      score += 16;
      continue;
    }

    if (canUseHaystackMatch(tagName) && normalizedTagName && haystack.includes(normalizedTagName)) {
      matchedImplicitTags.push(tagName);
      score += 6;
    }
  }

  for (const keyword of parsedQuery.keywordHints) {
    const normalizedKeyword = normalizeText(keyword);
    if (!normalizedKeyword) {
      continue;
    }
    if (!haystack.includes(normalizedKeyword)) {
      missingKeywordHints.push(keyword);
      continue;
    }
    matchedKeywordHints.push(keyword);
    score += 12;
  }

  for (const tagName of parsedQuery.excludedTags) {
    const normalizedTagName = normalizeText(tagName);
    if (
      normalizedTagSet.has(normalizedTagName)
      || (canUseHaystackMatch(tagName) && normalizedTagName && haystack.includes(normalizedTagName))
    ) {
      matchedExcludedTags.push(tagName);
      score -= 100;
    }
  }

  const rawQueryHit = parsedQuery.normalizedQuery && haystack.includes(parsedQuery.normalizedQuery);
  if (rawQueryHit) {
    score += 10;
  }

  if (parsedQuery.requiredTags.length && missingRequiredTags.length === 0) {
    score += 24;
  }

  if (parsedQuery.keywordHints.length && missingKeywordHints.length === 0) {
    score += 14;
  }

  const strictMatch = (
    parsedQuery.requiredTags.length > 0
    && missingRequiredTags.length === 0
    && missingKeywordHints.length === 0
    && matchedExcludedTags.length === 0
  );

  const relaxedMatch = (
    matchedExcludedTags.length === 0
    && (
      matchedRequiredTags.length > 0
      || matchedImplicitTags.length > 0
      || matchedKeywordHints.length > 0
      || rawQueryHit
    )
  );

  const summary = [];
  if (matchedRequiredTags.length) {
    summary.push(`命中条件: ${matchedRequiredTags.join(' / ')}`);
  }
  if (missingRequiredTags.length) {
    summary.push(`缺少条件: ${missingRequiredTags.join(' / ')}`);
  }
  if (matchedImplicitTags.length) {
    summary.push(`辅助条件: ${matchedImplicitTags.join(' / ')}`);
  }
  if (matchedKeywordHints.length) {
    summary.push(`Keywords: ${matchedKeywordHints.join(' / ')}`);
  }
  if (missingKeywordHints.length) {
    summary.push(`Missing keywords: ${missingKeywordHints.join(' / ')}`);
  }
  if (matchedExcludedTags.length) {
    summary.push(`排除原因: ${matchedExcludedTags.join(' / ')}`);
  }

  return {
    ...image,
    natural_search_score: score,
    natural_search_summary: summary,
    natural_search_match: {
      matchedRequiredTags,
      missingRequiredTags,
      matchedImplicitTags,
      matchedKeywordHints,
      missingKeywordHints,
      matchedExcludedTags,
    },
    strictMatch,
    relaxedMatch,
  };
}

function compareSearchResult(a, b) {
  if (b.natural_search_score !== a.natural_search_score) {
    return b.natural_search_score - a.natural_search_score;
  }
  return String(b.imported_at || '').localeCompare(String(a.imported_at || ''));
}

function buildNaturalLanguageSearchState(libraryDb, options = {}) {
  const query = String(options.query || '').trim();
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 40));
  const offset = Math.max(0, Number(options.offset) || 0);
  const folderName = String(options.folderName || '').trim();
  const candidateLimit = Math.max((offset + limit) * 6, 120);
  const parsedQuery = parseNaturalLanguageQuery(query, {
    tagNames: typeof libraryDb?.getAllTagNames === 'function' ? libraryDb.getAllTagNames() : [],
  });

  const candidateTerms = collectCandidateTerms(parsedQuery, query);
  const candidates = typeof libraryDb?.getNaturalSearchCandidates === 'function'
    ? libraryDb.getNaturalSearchCandidates({
      terms: candidateTerms,
      limit: candidateLimit,
      status: options.status,
      folderPath: options.folderPath,
      folderName,
    })
    : [];

  const scoredCandidates = candidates
    .map((image) => scoreCandidateImage(image, parsedQuery))
    .filter((image) => image.relaxedMatch || image.strictMatch)
    .sort(compareSearchResult);
  const folderOnlyResults = !query && folderName
    ? candidates.map((image) => ({
      ...image,
      natural_search_score: 1,
      natural_search_summary: [`Folder: ${folderName}`],
      natural_search_match: {
        matchedRequiredTags: [],
        missingRequiredTags: [],
        matchedImplicitTags: [],
        matchedKeywordHints: [],
        missingKeywordHints: [],
        matchedExcludedTags: [],
      },
      strictMatch: true,
      relaxedMatch: true,
    }))
    : [];

  return {
    query,
    limit,
    offset,
    folderName,
    parsedQuery,
    candidateTerms,
    candidates,
    scoredCandidates,
    strictResults: folderOnlyResults.length ? folderOnlyResults : scoredCandidates.filter((image) => image.strictMatch),
    relaxedResults: scoredCandidates.filter((image) => image.relaxedMatch),
  };
}

function searchNaturalLanguageImages(libraryDb, options = {}) {
  const {
    query,
    limit,
    offset,
    folderName,
    parsedQuery,
    candidateTerms,
    candidates,
    scoredCandidates,
    strictResults,
  } = buildNaturalLanguageSearchState(libraryDb, options);

  let images = strictResults;
  let mode = 'strict';
  let usedKeywordFallback = false;

  if (!parsedQuery.hasStructuredIntent && !images.length && query) {
    mode = 'keyword';
    usedKeywordFallback = true;
    images = (typeof libraryDb?.searchImages === 'function'
      ? libraryDb.searchImages({
        keyword: query,
        terms: parsedQuery.keywordHints.length ? parsedQuery.keywordHints : candidateTerms,
        limit: offset + limit,
        offset: 0,
        status: options.status,
        folderPath: options.folderPath,
        folderName,
        includeFolderInKeyword: false,
      })
      : []
    ).map((image) => ({
      ...image,
      natural_search_score: 1,
      natural_search_summary: ['按原始关键词模糊匹配'],
      natural_search_match: {
        matchedRequiredTags: [],
        missingRequiredTags: [],
        matchedImplicitTags: [],
        matchedKeywordHints: parsedQuery.keywordHints.length ? parsedQuery.keywordHints : [query],
        missingKeywordHints: [],
        matchedExcludedTags: [],
      },
      strictMatch: false,
      relaxedMatch: true,
    }));
  }

  return {
    images: images.slice(offset, offset + limit),
    intent: parsedQuery,
    candidateTerms,
    mode,
    usedKeywordFallback,
    total: images.length,
    candidateCount: candidates.length,
    scoredCount: scoredCandidates.length,
  };
}

module.exports = {
  buildNaturalLanguageSearchState,
  collectCandidateTerms,
  compareSearchResult,
  parseNaturalLanguageQuery,
  scoreCandidateImage,
  searchNaturalLanguageImages,
};
