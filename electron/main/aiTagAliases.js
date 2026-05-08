const RAW_AI_TAG_ALIASES = [
  ['hot air balloon', '\u70ed\u6c14\u7403'],
  ['air balloon', '\u70ed\u6c14\u7403'],
  ['balloon', '\u70ed\u6c14\u7403'],
  ['ballooning', '\u70ed\u6c14\u7403'],
  ['portrait', '\u4eba\u7269'],
  ['person', '\u4eba\u7269'],
  ['people', '\u4eba\u7269'],
  ['human', '\u4eba\u7269'],
  ['group photo', '\u5408\u7167'],
  ['group', '\u5408\u7167'],
  ['camera', '\u76f8\u673a'],
  ['drone', '\u65e0\u4eba\u673a'],
  ['car', '\u6c7d\u8f66'],
  ['bus', '\u5df4\u58eb'],
  ['train', '\u706b\u8f66'],
  ['airplane', '\u98de\u673a'],
  ['plane', '\u98de\u673a'],
  ['bicycle', '\u81ea\u884c\u8f66'],
  ['bike', '\u81ea\u884c\u8f66'],
  ['motorcycle', '\u6469\u6258\u8f66'],
  ['wedding', '\u5a5a\u793c'],
  ['festival', '\u8282\u5e86'],
  ['performance', '\u6f14\u51fa'],
  ['concert', '\u6f14\u51fa'],
  ['sports', '\u8fd0\u52a8'],
  ['sport', '\u8fd0\u52a8'],
  ['mountain', '\u5c71\u5cf0'],
  ['mountains', '\u5c71\u5cf0'],
  ['rainbow', '\u5f69\u8679'],
  ['night sky', '\u591c\u7a7a'],
  ['starry sky', '\u661f\u7a7a'],
  ['stargazing', '\u89c2\u661f'],
  ['silhouette', '\u526a\u5f71'],
  ['natural phenomenon', '\u81ea\u7136\u73b0\u8c61'],
  ['natural_phenomenon', '\u81ea\u7136\u73b0\u8c61'],
  ['landscape', '\u7eaf\u98ce\u666f'],
  ['scenery', '\u7eaf\u98ce\u666f'],
  ['morning', '\u65e9\u6668'],
  ['morning light', '\u65e9\u6668'],
  ['morning glow', '\u65e9\u6668'],
  ['sunrise', '\u65e5\u51fa'],
  ['dawn', '\u65e5\u51fa'],
  ['hiking', '\u5f92\u6b65'],
  ['camping', '\u9732\u8425'],
  ['cycling', '\u9a91\u884c'],
  ['bear', '\u718a'],
  ['brown bear', '\u68d5\u718a'],
  ['tiger', '\u8001\u864e'],
  ['tiananmen', '\u5929\u5b89\u95e8'],
  ['tiananmen square', '\u5929\u5b89\u95e8'],
  ['gate of heavenly peace', '\u5929\u5b89\u95e8'],
  ['\u5929\u5b89\u95e8\u5e7f\u573a', '\u5929\u5b89\u95e8'],
  ['\u5929\u5b89\u95e8\u57ce\u697c', '\u5929\u5b89\u95e8'],
  ['\u6545\u5bab\u535a\u7269\u9662', '\u6545\u5bab'],
  ['\u7d2b\u7981\u57ce', '\u6545\u5bab'],
  ['the forbidden city', '\u6545\u5bab'],
  ['forbidden city', '\u6545\u5bab'],
  ['the bund', '\u5916\u6ee9'],
  ['waitan', '\u5916\u6ee9'],
  ['shanghai bund', '\u5916\u6ee9'],
  ['oriental pearl', '\u4e1c\u65b9\u660e\u73e0'],
  ['oriental pearl tower', '\u4e1c\u65b9\u660e\u73e0'],
  ['bundadalar palace', '\u5e03\u8fbe\u62c9\u5bab'],
  ['potala palace', '\u5e03\u8fbe\u62c9\u5bab'],
  ['\u5e03\u8fbe\u62c9\u5bab\u5e7f\u573a', '\u5e03\u8fbe\u62c9\u5bab'],
  ['hongyadong', '\u6d2a\u5d16\u6d1e'],
  ['hongya cave', '\u6d2a\u5d16\u6d1e'],
  ['west lake', '\u897f\u6e56'],
  ['xihu', '\u897f\u6e56'],
  ['\u6ec7\u6c60\u98ce\u666f\u533a', '\u6ec7\u6c60'],
  ['dianchi lake', '\u6ec7\u6c60'],
  ['dianchi', '\u6ec7\u6c60'],
  ['jokhang temple', '\u5927\u662d\u5bfa'],
  ['\u5927\u662d\u5bfa\u5e7f\u573a', '\u5927\u662d\u5bfa'],
];

function normalizeAliasKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[`'"“”‘’]/g, '')
    .replace(/[()（）[\]【】{}]/g, '')
    .replace(/[.,!?;:，。！？；：/\\|_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const AI_TAG_ALIASES = new Map(
  RAW_AI_TAG_ALIASES.map(([alias, canonical]) => [normalizeAliasKey(alias), canonical])
);

function normalizeAITagName(name) {
  if (typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  return AI_TAG_ALIASES.get(normalizeAliasKey(trimmed)) || trimmed;
}

module.exports = {
  RAW_AI_TAG_ALIASES,
  AI_TAG_ALIASES,
  normalizeAliasKey,
  normalizeAITagName,
};
