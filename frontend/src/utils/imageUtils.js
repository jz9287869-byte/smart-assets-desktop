/**
 * 图片 URL 处理工具函数
 */

export const getImageUrl = (image) => {
  if (image?.signed_thumbnail_url) return image.signed_thumbnail_url;
  if (image?.signed_image_url) return image.signed_image_url;

  const filePath = image.thumbnail_path || image.current_path || image.path;
  if (filePath) {
    try {
      return `smart-image://asset?path=${encodeURIComponent(filePath)}`;
    } catch (error) {
      console.error('生成图片 URL 失败:', error);
      return '';
    }
  }
  return '';
};

export const getThumbnailUrl = (image) => {
  if (image?.signed_thumbnail_url) return image.signed_thumbnail_url;
  if (image?.signed_image_url) return image.signed_image_url;

  const filePath = image.thumbnail_path || image.current_path || image.path;
  return filePath ? `smart-image://asset?path=${encodeURIComponent(filePath)}` : '';
};

/**
 * 文件大小格式化
 */
export const formatFileSize = (bytes) => {
  if (!bytes) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes, idx = 0;
  while (size >= 1024 && idx < units.length - 1) { 
    size /= 1024; 
    idx++; 
  }
  return `${size.toFixed(1)} ${units[idx]}`;
};

/**
 * 解析标签字符串
 */
export const parseTags = (image) => {
  if (!image || !image.tags) return [];

  const rawTags = Array.isArray(image.tags)
    ? image.tags
    : typeof image.tags === 'string'
      ? image.tags.split(',')
      : [];

  const trimmedTags = rawTags
    .map((tag) => String(tag || '').trim())
    .filter(Boolean);

  const uniqueTags = [];
  const seen = new Set();
  for (const tag of trimmedTags) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    uniqueTags.push(tag);
  }

  const mutuallyExclusiveGroups = [
    new Set(['春天', '夏天', '秋天', '冬天']),
    new Set(['晴天', '阴天']),
    new Set(['单人', '多人', '纯风景']),
  ];

  return uniqueTags.filter((tag, index) => {
    const group = mutuallyExclusiveGroups.find((candidate) => candidate.has(tag));
    if (!group) return true;
    return uniqueTags.findIndex((item) => group.has(item)) === index;
  });
};
