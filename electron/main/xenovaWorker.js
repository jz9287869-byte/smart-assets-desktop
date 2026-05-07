const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const { BUILTIN_TAG_DEFINITIONS } = require('./tagDefinitions');
const { resolveModelsRoot } = require('./modelPaths');

let transformers = null;
let classifier = null;
let embeddingProcessor = null;
let embeddingTokenizer = null;
let embeddingModel = null;
let embeddingInitPromise = null;
let isInitialized = false;

// Keep prompt volume low enough for local CPU inference.
const PROMPT_TEMPLATES = [
  '{name}',
  'a photo of {name}',
];

const SCENIC_OBJECT_TAGS = [
  '桥梁',
  '亭子',
  '古建筑',
  '园林',
  '寺庙',
  '湖面',
  '水面',
  '树木',
  '绿植',
  '船只',
  '小船',
  '游船',
  '人物',
];

const TAG_VARIANTS = {
  热气球: ['热气球', 'hot air balloon'],
  草原: ['草原', 'grassland'],
  雪山: ['雪山', 'snow mountain'],
  森林: ['森林', 'forest'],
  湖泊: ['湖泊', 'lake'],
  湖面: ['湖面', 'lake surface', 'water surface'],
  水面: ['水面', 'water surface', 'water', 'river water'],
  桥梁: ['桥梁', 'bridge', 'arch bridge', 'stone bridge'],
  亭子: ['亭子', 'gazebo', 'pavilion', 'chinese pavilion'],
  古建筑: ['古建筑', 'traditional architecture', 'historic architecture', 'ancient building'],
  园林: ['园林', 'classical garden', 'chinese garden', 'landscape garden'],
  寺庙: ['寺庙', 'temple', 'shrine'],
  树木: ['树木', 'tree', 'trees', 'willow tree'],
  绿植: ['绿植', 'greenery', 'plants', 'vegetation'],
  船只: ['船只', 'boat', 'vessel', 'wooden boat'],
  小船: ['小船', 'small boat', 'row boat', 'skiff'],
  游船: ['游船', 'tour boat', 'cruise boat', 'sightseeing boat'],
  人物: ['人物', 'people'],
  合照: ['合照', 'group photo'],
  马: ['马', 'horse'],
  牛: ['牛', 'cow'],
  羊: ['羊', 'sheep'],
  相机: ['相机', 'camera'],
  无人机: ['无人机', 'drone'],
  汽车: ['汽车', 'car'],
  飞机: ['飞机', 'airplane'],
  婚礼: ['婚礼', 'wedding'],
  演出: ['演出', 'performance'],
  运动: ['运动', 'sports'],
};

const defaultTags = Array.from(
  new Set(
    BUILTIN_TAG_DEFINITIONS
      .filter((item) => item.categoryId !== 'color' && item.categoryId !== 'custom')
      .map((item) => item.name)
  )
);

const promptCache = new Map();

function buildPromptLabels(tags) {
  const cacheKey = Array.isArray(tags) ? tags.join('\u0001') : '__default__';
  if (promptCache.has(cacheKey)) {
    return promptCache.get(cacheKey);
  }

  const prompts = [];
  const promptToCanonical = new Map();

  for (const tag of tags) {
    const variants = TAG_VARIANTS[tag] || [tag];
    for (const variant of variants.slice(0, 2)) {
      for (const template of PROMPT_TEMPLATES) {
        const prompt = template.replace('{name}', variant);
        prompts.push(prompt);
        promptToCanonical.set(prompt, tag);
      }
    }
  }

  const value = { prompts, promptToCanonical };
  promptCache.set(cacheKey, value);
  return value;
}

function aggregatePromptResults(results, promptToCanonical) {
  const grouped = new Map();

  for (const item of results) {
    const canonical = promptToCanonical.get(item.label) || item.label;
    if (!grouped.has(canonical)) {
      grouped.set(canonical, []);
    }
    grouped.get(canonical).push(item.score);
  }

  return Array.from(grouped.entries())
    .map(([name, scores]) => {
      const best = Math.max(...scores);
      const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
      return {
        name,
        confidence: best * 0.8 + avg * 0.2,
        source: 'ai',
      };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

async function initialize(options = {}) {
  if (isInitialized) return;

  try {
    parentPort.postMessage({ type: 'log', message: 'Initializing Xenova AI engine...' });

    transformers = await import('@xenova/transformers');

    const modelName = options.modelName || 'Xenova/chinese-clip-vit-base-patch16';
    const cacheDir = options.cacheDir || resolveModelsRoot();

    classifier = await transformers.pipeline('zero-shot-image-classification', modelName, {
      cache_dir: cacheDir,
      quantized: true,
    });

    isInitialized = true;
    parentPort.postMessage({ type: 'ready' });
    parentPort.postMessage({ type: 'log', message: 'Xenova AI engine initialized' });
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: error.message, stack: error.stack });
  }
}

async function getRawImageInput(imagePath) {
  if (typeof imagePath === 'string' && fs.existsSync(imagePath)) {
    const imageBytes = fs.readFileSync(imagePath);
    return transformers.RawImage.fromBlob(new Blob([imageBytes]));
  }
  return imagePath;
}

function normalizeVector(values) {
  const vector = Array.from(values || []).map((value) => Number(value));
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm <= 0) {
    return [];
  }
  return vector.map((value) => value / norm);
}

function tensorToVector(tensor) {
  if (!tensor?.data) {
    return [];
  }
  return normalizeVector(tensor.data);
}

async function initializeEmbedding(options = {}) {
  if (embeddingModel && embeddingProcessor && embeddingTokenizer) {
    return;
  }
  if (embeddingInitPromise) {
    return embeddingInitPromise;
  }

  embeddingInitPromise = (async () => {
    if (!transformers) {
      transformers = await import('@xenova/transformers');
    }

    const modelName = options.modelName || workerData?.options?.modelName || 'Xenova/chinese-clip-vit-base-patch16';
    const cacheDir = options.cacheDir || workerData?.options?.cacheDir || resolveModelsRoot();

    parentPort.postMessage({ type: 'log', message: 'Initializing Xenova embedding model...' });
    const loadOptions = {
      cache_dir: cacheDir,
      quantized: true,
    };
    embeddingProcessor = await transformers.AutoProcessor.from_pretrained(modelName, loadOptions);
    embeddingTokenizer = await transformers.AutoTokenizer.from_pretrained(modelName, loadOptions);
    embeddingModel = await transformers.ChineseCLIPModel.from_pretrained(modelName, loadOptions);
    parentPort.postMessage({ type: 'log', message: 'Xenova embedding model initialized' });
  })();

  try {
    await embeddingInitPromise;
  } finally {
    embeddingInitPromise = null;
  }
}

async function embedImage(imagePath, requestId = null) {
  try {
    await initializeEmbedding();
    const imageInput = await getRawImageInput(imagePath);
    const imageInputs = await embeddingProcessor(imageInput);
    const textInputs = await embeddingTokenizer(['a photo'], {
      padding: true,
      truncation: true,
    });
    const output = await embeddingModel({ ...textInputs, ...imageInputs });
    const vector = tensorToVector(output?.image_embeds || output?.pooler_output || output?.last_hidden_state);

    if (!vector.length) {
      throw new Error('Xenova image embedding returned an empty vector');
    }

    parentPort.postMessage({
      type: 'result',
      requestId,
      success: true,
      vector,
      model: workerData?.options?.modelName || 'Xenova/chinese-clip-vit-base-patch16',
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'result',
      requestId,
      success: false,
      error: error.message,
      vector: [],
    });
  }
}

async function embedText(text, requestId = null) {
  try {
    await initializeEmbedding();
    const content = String(text || '').trim();
    if (!content) {
      throw new Error('Text embedding input is empty');
    }

    const textInputs = await embeddingTokenizer([content], {
      padding: true,
      truncation: true,
    });
    const placeholderImage = new transformers.RawImage(new Uint8ClampedArray(224 * 224 * 3).fill(255), 224, 224, 3);
    const imageInputs = await embeddingProcessor(placeholderImage);
    const output = await embeddingModel({ ...textInputs, ...imageInputs });
    const vector = tensorToVector(output?.text_embeds || output?.pooler_output || output?.last_hidden_state);

    if (!vector.length) {
      throw new Error('Xenova text embedding returned an empty vector');
    }

    parentPort.postMessage({
      type: 'result',
      requestId,
      success: true,
      vector,
      model: workerData?.options?.modelName || 'Xenova/chinese-clip-vit-base-patch16',
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'result',
      requestId,
      success: false,
      error: error.message,
      vector: [],
    });
  }
}

async function analyzeImage(imagePath, customTags = null, requestId = null) {
  try {
    if (!isInitialized) {
      await initialize();
    }

    const imageInput = await getRawImageInput(imagePath);

    const tags = Array.isArray(customTags) && customTags.length > 0 ? customTags : defaultTags;
    const { prompts, promptToCanonical } = buildPromptLabels(tags);
    const result = await classifier(imageInput, prompts);
    const aggregated = aggregatePromptResults(result, promptToCanonical);

    // Run a second small pass for scenic objects that are often underrepresented in the broad tag set.
    const { prompts: scenicPrompts, promptToCanonical: scenicPromptMap } = buildPromptLabels(SCENIC_OBJECT_TAGS);
    const scenicResults = await classifier(imageInput, scenicPrompts);
    const scenicAggregated = aggregatePromptResults(scenicResults, scenicPromptMap)
      .map((item) => ({
        ...item,
        confidence: item.confidence * 1.18,
      }));

    const merged = new Map();
    for (const item of [...aggregated, ...scenicAggregated]) {
      const prev = merged.get(item.name);
      if (!prev || (item.confidence || 0) > (prev.confidence || 0)) {
        merged.set(item.name, item);
      }
    }

    const filteredTags = Array.from(merged.values())
      .filter((item) => item.confidence >= 0.08)
      .slice(0, 12);

    parentPort.postMessage({
      type: 'result',
      requestId,
      success: true,
      tags: filteredTags,
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'result',
      requestId,
      success: false,
      error: error.message,
      tags: [],
    });
  }
}

parentPort.on('message', async (message) => {
  switch (message.type) {
    case 'initialize':
      await initialize(message.options);
      break;
    case 'analyze':
      await analyzeImage(message.imagePath, message.tags, message.requestId);
      break;
    case 'embed_image':
      await embedImage(message.imagePath, message.requestId);
      break;
    case 'embed_text':
      await embedText(message.text, message.requestId);
      break;
    default:
      break;
  }
});

if (workerData && workerData.autoInitialize) {
  initialize(workerData.options);
}
