const fs = require('fs');
const path = require('path');

function hasModelConfig(dirPath) {
  if (!dirPath) return false;
  return fs.existsSync(path.join(dirPath, 'config.json'));
}

function hasTransformersWeights(dirPath) {
  if (!dirPath) return false;
  return (
    fs.existsSync(path.join(dirPath, 'model.safetensors'))
    || fs.existsSync(path.join(dirPath, 'pytorch_model.bin'))
  );
}

function hasUsableTransformersModel(dirPath) {
  return hasModelConfig(dirPath) && hasTransformersWeights(dirPath);
}

function getProjectRoot() {
  return path.resolve(__dirname, '../..');
}

function getDevelopmentModelsRoot() {
  return path.join(getProjectRoot(), '.models');
}

function getPackagedModelsRoot() {
  if (!process.resourcesPath) return null;
  return path.join(process.resourcesPath, 'models');
}

function getModelRootCandidates() {
  return [
    process.env.SMART_ASSETS_MODELS_PATH || null,
    getPackagedModelsRoot(),
    getDevelopmentModelsRoot(),
    'D:\\models',
  ].filter(Boolean);
}

function resolveModelsRoot() {
  const candidates = getModelRootCandidates();
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  return existing || candidates[0] || getDevelopmentModelsRoot();
}

function resolveChineseClipLocalModelPath() {
  const roots = getModelRootCandidates();
  const candidates = roots.flatMap((root) => [
    path.join(root, 'chinese-clip'),
    path.join(root, 'chinese-clip-vit-base-patch16'),
    path.join(root, 'Xenova', 'chinese-clip-vit-base-patch16'),
  ]);

  return candidates.find((candidate) => hasUsableTransformersModel(candidate)) || null;
}

module.exports = {
  getDevelopmentModelsRoot,
  getPackagedModelsRoot,
  resolveModelsRoot,
  resolveChineseClipLocalModelPath,
};
