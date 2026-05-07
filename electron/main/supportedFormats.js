const IMAGE_FORMATS = Object.freeze([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.raw',
  '.cr2',
  '.nef',
  '.arw',
]);

const IMAGE_FORMAT_NAMES = Object.freeze(IMAGE_FORMATS.map((ext) => ext.slice(1)));

const COMMON_VIDEO_FORMATS = Object.freeze([
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.wmv',
  '.flv',
  '.webm',
  '.m4v',
  '.mpg',
  '.mpeg',
  '.3gp',
  '.m2ts',
  '.mts',
  '.ts',
]);

function isSupportedImageFormat(extension) {
  const normalized = String(extension || '').trim().toLowerCase();
  return IMAGE_FORMATS.includes(normalized);
}

module.exports = {
  IMAGE_FORMATS,
  IMAGE_FORMAT_NAMES,
  COMMON_VIDEO_FORMATS,
  isSupportedImageFormat,
};
