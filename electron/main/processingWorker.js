const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const { PythonEngineManager } = require('./pythonEngineManager');
const XenovaAIEngine = require('./xenovaAIEngine');
const { DeepSeekReviewService } = require('./deepseekReviewService');
const { BUILTIN_TAG_DEFINITIONS } = require('./tagDefinitions');
const { normalizeAITagName } = require('./aiTagAliases');
const { resolveModelsRoot } = require('./modelPaths');
const fs = require('fs');

const SHARED_AI_TAG_LOOKUP = new Map(BUILTIN_TAG_DEFINITIONS.map((item) => [item.name, item]));

const AI_SAVE_THRESHOLDS = {
  scene: 0.18,
  location: 0.22,
  animal: 0.2,
  people: 0.18,
  device: 0.22,
  event: 0.2,
  color: 0.9,
  default: 0.18
};

const AI_PER_TAG_THRESHOLDS = {
  '船只': 0.46,
  '小船': 0.48,
  '游船': 0.48,
  '亭子': 0.44,
  '古建筑': 0.46,
};

const AI_GENERIC_BLOCKLIST = new Set([
  '天空',
  '风景',
  '自然',
  '旅游',
  '旅行',
  '极简',
  '动物',
  '活动',
  '地点',
  '未识别',
  '无',
  'unknown',
  'none'
]);

const LOCATION_HINT_TAGS = new Set([
  '北京', '上海', '广州', '深圳', '成都', '重庆', '杭州', '西安', '武汉', '南京',
  '苏州', '青岛', '拉萨', '乌鲁木齐', '昆明', '大理', '丽江', '哈尔滨', '香港', '澳门',
  '西藏', '新疆', '云南', '四川', '青海', '内蒙古',
  '外滩', '东方明珠', '天安门', '故宫', '布达拉宫', '洪崖洞', '西湖', '滇池', '大昭寺'
]);

const ANIMAL_FAMILY_COMPANIONS = new Map([
  ['棕熊', new Set(['熊'])],
  ['熊猫', new Set([])],
  ['老虎', new Set([])],
  ['狮子', new Set([])],
  ['猎豹', new Set([])],
  ['马', new Set([])],
  ['牛', new Set([])],
  ['羊', new Set([])],
  ['牦牛', new Set(['牛'])],
  ['鹿', new Set([])],
  ['骆驼', new Set([])],
  ['狗', new Set([])],
  ['猫', new Set([])],
]);

const EVENT_CONFLICT_GROUPS = [
  new Set(['热气球飞行', '滑翔伞', '跳伞']),
  new Set(['悬崖攀岩', '悬崖瑜伽', '跳伞', '丛林飞跃', '滑翔伞']),
  new Set(['徒步', '骑行']),
  new Set(['潜水', '浮潜']),
];

const OBJECTIVE_PHOTOGRAPHY_TAGS = new Set(['竖屏', '横屏', '360度全景', '广角震撼风光']);

const HIGH_RISK_SCENE_TAGS = new Set(['船只', '小船', '游船', '亭子', '古建筑']);

const HIGH_RISK_FORCE_SAVE_BLOCKLIST = new Set(['船只', '小船', '游船', '亭子', '古建筑']);
const AI_AUTO_CREATE_CATEGORY_ALLOWLIST = new Set(['scene', 'location', 'animal', 'people', 'device', 'event']);
const SEASON_TAGS = new Set(['\u6625\u5929', '\u590f\u5929', '\u79cb\u5929', '\u51ac\u5929']);
const WEATHER_TAGS = new Set(['\u6674\u5929', '\u9634\u5929', '\u96e8\u5929', '\u96ea\u5929', '\u96fe\u5929']);
const PEOPLE_COUNT_TAGS = new Set(['\u5355\u4eba', '\u591a\u4eba']);
const PERSON_TAG = '\u4eba\u7269';
const PURE_SCENERY_TAG = '\u7eaf\u98ce\u666f';
const WEATHER_SKIP_TAGS = new Set([
  '\u591c\u666f',
  '\u9727\u8679\u591c\u666f',
  '\u8d5b\u535a\u670b\u514b',
  '\u9152\u5e97\u5927\u5802',
  '\u603b\u7edf\u5957\u623f',
  '\u89c2\u666f\u9633\u53f0',
  '\u6c11\u5bbf\u5ba2\u623f',
  '\u6e29\u6cc9\u79c1\u6c64',
  '\u9910\u5385\u5305\u95f4',
  '\u673a\u573a\u8d35\u5bbe\u5ba4',
  '\u535a\u7269\u9986\u5c55\u5385',
  '\u827a\u672f\u753b\u5eca',
  '\u6f14\u827a\u5267\u573a',
  '\u514d\u7a0e\u5e97\u8d27\u67b6',
]);

const SCENE_SUPPORT_TAGS = new Map([
  ['船只', new Set(['湖面', '水面', '湖泊', '河流', '海边'])],
  ['小船', new Set(['湖面', '水面', '湖泊', '河流', '海边'])],
  ['游船', new Set(['湖面', '水面', '湖泊', '河流', '海边'])],
  ['亭子', new Set(['园林', '古镇', '寺庙', '古建筑'])],
  ['古建筑', new Set(['古镇', '园林', '寺庙', '亭子'])],
]);

const PEOPLE_HINT_ONLY_TAGS = new Set([
  '导游讲解',
  '举旗导游',
  '领队',
  '潜水教练',
  '滑雪教练',
  '当地居民',
  '原住民',
]);

const MULTI_PERSON_HINT_TAGS = new Set([
  '多人',
  '合照',
  '双人同行',
  '情侣',
  '夫妻',
  '亲子',
  '一家三口',
  '三代同堂',
  '闺蜜团',
  '多人旅行',
  '团队出游',
]);
const SOFT_MULTI_PERSON_HINT_TAGS = new Set([
  '多人',
  '多人旅行',
]);
const HARD_MULTI_PERSON_HINT_TAGS = new Set(
  Array.from(MULTI_PERSON_HINT_TAGS).filter((name) => !SOFT_MULTI_PERSON_HINT_TAGS.has(name))
);

const SINGLE_PERSON_HINT_TAGS = new Set([
  '单人',
  '单人旅行',
  '男性',
  '女性',
  '儿童',
  '婴儿',
  '背影',
  '侧脸',
  '客房服务员',
  '空乘',
  '机长',
  '厨师',
  '摄影师',
  '街头艺人',
  '闭眼休息',
  '睡眠',
  '拍照',
  '看地图',
  '逆光剪影',
  '露齿微笑',
  '仰天大笑',
  '沉思',
  '疲惫',
  '汉服',
  '和服',
  '泰服',
  '泳装',
  '比基尼',
  '滑雪服',
  '潜水服',
  '晚礼服',
  '休闲度假装',
]);

const EVENT_HINT_ONLY_TAGS = new Set([
  '悬崖瑜伽',
  '跳伞',
  '滑翔伞',
  '丛林飞跃',
  '旅拍',
]);

const WIDE_SCENE_TAGS = new Set([
  '雪山',
  '草原',
  '森林',
  '松林',
  '湖泊',
  '河流',
  '溪流',
  '峡谷',
  '山谷',
  '冰川',
  '雪原',
  '云海',
  '海边',
  '沙漠',
  '湿地',
  '花海',
  '田野',
  '高山',
  '山脉',
  '城市天际线',
]);

const PURE_SCENERY_SUPPORT_TAGS = new Set([
  ...Array.from(WIDE_SCENE_TAGS),
  '湖面',
  '水面',
  '湖泊',
  '河流',
  '溪流',
  '峡谷',
  '山谷',
  '冰川',
  '海边',
  '沙漠',
  '湿地',
  '花海',
  '田野',
  '高山',
  '山脉',
  '晴天',
  '阴天',
  '雨天',
  '雪天',
  '雾天',
]);

const PURE_SCENERY_BLOCKING_CATEGORIES = new Set(['people', 'animal', 'device', 'event']);
const ARCHITECTURE_SCENE_TAGS = new Set([
  '桥梁',
  '亭子',
  '古建筑',
  '园林',
  '寺庙',
  '城市天际线',
  '城市街景',
  '极简建筑',
  '工业风',
  '观景台',
  '历史遗迹',
  '佛教寺庙',
  '哥特式教堂',
  '清真寺',
  '欧洲城堡',
  '皇室宫殿',
  '帝王陵墓'
]);
const LANDMARK_LOCATION_TAGS = new Set([
  '天安门',
  '故宫',
  '外滩',
  '东方明珠',
  '布达拉宫',
  '洪崖洞',
  '西湖',
  '滇池',
  '大昭寺',
  '世界文化遗产',
  '国家公园'
]);
const DIMENSION_REVIEW_TAGS = new Set(['人物', '单人', '多人', '纯风景']);
const RETAINED_SCENE_TAGS = new Set([
  '纯风景',
  '晴天',
  '阴天',
  '春天',
  '夏天',
  '秋天',
  '冬天',
  '雪山',
  '草原',
  '森林',
  '松林',
  '湖泊',
  '湖面',
  '河流',
  '溪流',
  '峡谷',
  '山谷',
  '冰川',
  '云海',
  '海边',
  '花海',
  '田野',
  '村庄',
  '古镇',
  '寺庙',
  '桥梁',
  '亭子',
  '古建筑',
  '园林',
  '城市天际线',
  '城市街景',
  '高山',
  '山脉',
  '长城',
  '极简建筑'
]);
const RETAINED_PEOPLE_TAGS = new Set(['单人', '多人']);
const RETAINED_SEMANTIC_CATEGORIES = new Set(['scene', 'location', 'animal', 'people', 'device', 'event']);
const RETAINED_CATEGORY_LIMITS = Object.freeze({
  scene: 6,
  location: 4,
  animal: 4,
  people: 5,
  device: 4,
  event: 4,
});
const RETAINED_CATEGORY_FLOORS = Object.freeze({
  scene: 0.24,
  location: 0.3,
  animal: 0.28,
  people: 0.28,
  device: 0.3,
  event: 0.28,
});
const PROMOTED_AI_SOURCES = new Set([
  'ai_photo_rule',
  'deepseek_review',
  'mediapipe_face',
  'opencv_body',
  'people_detector',
]);

const SEASON_SUPPORT_TAGS = new Map([
  ['春天', new Set(['花海', '田野', '草原', '森林', '松林'])],
  ['夏天', new Set(['海边', '湖面', '湖泊', '溪流', '晴天', '热气球'])],
  ['秋天', new Set(['田野', '森林', '松林', '山谷', '古镇'])],
  ['冬天', new Set(['雪山', '雪原', '冰川', '雪天'])],
]);

const SEASON_MIN_CONFIDENCE = new Map([
  ['春天', 0.36],
  ['夏天', 0.38],
  ['秋天', 0.36],
  ['冬天', 0.3],
]);

const SUNNY_WEATHER_HINT_TAGS = new Set([
  '晴天',
  '阳光明媚',
  '日出',
  '日落',
  '逆光剪影',
  '热气球',
  '海边',
  '花海',
  '彩虹',
]);

const CLOUDY_WEATHER_HINT_TAGS = new Set([
  '阴天',
  '雨天',
  '雪天',
  '雾天',
  '雪景',
  '暴风雪',
  '闪电',
  '夜景',
  '雾凇',
]);

const OCR_LOCATION_HINT_PATTERN = /(?:市|区|县|镇|乡|村|路|街|道|巷|站|机场|车站|景区|公园|广场|博物馆|美术馆|寺|塔|宫|门|湖|江|河|湾|山)$/;
const OCR_STOPWORDS = new Set([
  '欢迎光临',
  '谢谢惠顾',
  '扫码',
  '支付',
  '折扣',
  '优惠',
  '营业中',
  '洗手间',
  'wifi',
  'password',
  'toilet',
  'menu',
]);

/**
 * 后台任务处理器
 * 管理缩略图、AI 标注、人工标注三类任务队列
 * 支持 Python AI 引擎与 Xenova 本地引擎
 */
class ProcessingWorker extends EventEmitter {
  constructor(libraryDatabase, options = {}) {
    super();
    this.db = libraryDatabase;
    this.options = {
      thumbnailConcurrency: options.thumbnailConcurrency || 2,
      aiTagConcurrency: options.aiTagConcurrency || 1,
      aiTaskTimeoutMs: options.aiTaskTimeoutMs || 300000,
      cpuLimit: options.cpuLimit || 30,
      usePythonEngine: options.usePythonEngine || false,
      ...options
    };
    
    this.queues = {
      thumbnail: new TaskQueue('thumbnail', this.options.thumbnailConcurrency),
      aiTag: new TaskQueue('aiTag', this.options.aiTagConcurrency),
      manualTag: new TaskQueue('manualTag', 0) // manual queue is user-triggered only
    };
    
    this.isRunning = false;
    this.stats = {
      thumbnail: { pending: 0, processing: 0, completed: 0, failed: 0 },
      aiTag: { pending: 0, processing: 0, completed: 0, failed: 0 },
      manualTag: { pending: 0, processing: 0, completed: 0, failed: 0 }
    };
    this.vectorBackfillState = {
      enabled: !!this.options.usePythonEngine,
      running: false,
      missing: 0,
      computed: 0,
      lastRunAt: null,
      lastError: null,
      modelPreloaded: false,
    };
    
    this.intervals = {};
    this.aiEngine = null;
    this.aiEngineInitialized = false;
    this.aiEngineInitPromise = null;
    
    // Python 引擎管理
    this.pythonEngineManager = null;
    this.usePythonEngine = this.options.usePythonEngine;
    this.deepseekReviewer = options.deepseekReviewer || new DeepSeekReviewService(options.cloudReview || {});
  }

  async initializeAIEngine() {
    if (this.aiEngineInitialized) {
      return;
    }
    if (this.aiEngineInitPromise) {
      return this.aiEngineInitPromise;
    }

    this.aiEngineInitPromise = (async () => {
      try {
        if (this.usePythonEngine && !this.pythonEngineManager) {
          console.log('[AIEngine] Initializing Python engine...');
          try {
            this.pythonEngineManager = new PythonEngineManager({
              dbPath: this.db.dbFilePath || path.join(this.db.libraryPath, '.data', 'library.db'),
              autoRestart: true,
              maxRestarts: 3
            });
            this.pythonEngineManager.on('error', (error) => {
              console.error('[AIEngine] Python engine manager error:', error?.message || error);
            });
            await this.pythonEngineManager.start();
            this.aiEngineInitialized = true;
            this.vectorBackfillState.enabled = true;
            this.vectorBackfillState.modelPreloaded = true;
            console.log('[AIEngine] Python engine initialized');
            return;
          } catch (error) {
            console.warn('[AIEngine] Python engine unavailable, falling back to Xenova:', error.message);
            this.pythonEngineManager = null;
            this.usePythonEngine = false;
            this.vectorBackfillState.enabled = false;
            this.vectorBackfillState.modelPreloaded = false;
          }
        }

        if (!this.pythonEngineManager) {
          this.aiEngine = new XenovaAIEngine({
            modelName: 'Xenova/chinese-clip-vit-base-patch16',
            cacheDir: resolveModelsRoot(),
            threshold: 0.07,
            maxTags: 18
          });
          await this.aiEngine.initialize();
          this.vectorBackfillState.enabled = true;
          this.vectorBackfillState.modelPreloaded = true;
          console.log('[AIEngine] Xenova AI fallback initialized');
        }

        this.aiEngineInitialized = true;
      } catch (error) {
        console.error('[AIEngine] Initialization failed:', error);
        this.aiEngine = null;
        this.pythonEngineManager = null;
        this.aiEngineInitialized = false;
        throw error;
      } finally {
        this.aiEngineInitPromise = null;
      }
    })();

    return this.aiEngineInitPromise;
  }

  async ensureXenovaFallbackEngine() {
    if (this.aiEngine) {
      return this.aiEngine;
    }

    this.aiEngine = new XenovaAIEngine({
      modelName: 'Xenova/chinese-clip-vit-base-patch16',
      cacheDir: resolveModelsRoot(),
      threshold: 0.07,
      maxTags: 18
    });
    await this.aiEngine.initialize();
    console.log('[AIEngine] Xenova fallback engine initialized on demand');
    return this.aiEngine;
  }

  warmSemanticSearch() {
    this.initializeAIEngine()
      .then(() => {
        this.vectorBackfillState.enabled = !!(this.pythonEngineManager || this.aiEngine);
        this.vectorBackfillState.modelPreloaded = !!(this.pythonEngineManager || this.aiEngine);
        this.vectorBackfillState.lastError = null;
      })
      .catch((error) => {
        this.vectorBackfillState.lastError = error.message;
      })
      .finally(() => {
        this.updateStats();
      });
  }

  async getTextEmbedding(text) {
    const content = String(text || '').trim();
    if (!content) {
      return null;
    }

    const result = await this.computeTextEmbedding(content);
    const vector = Array.isArray(result?.vector) ? result.vector : null;
    return vector && vector.length ? vector : null;
  }

  async computeTextEmbedding(text) {
    await this.initializeAIEngine();
    if (this.pythonEngineManager) {
      return this.pythonEngineManager.embedText(text);
    }

    const fallbackEngine = await this.ensureXenovaFallbackEngine();
    return fallbackEngine.embedText(text);
  }

  async computeImageEmbedding(imagePath) {
    await this.initializeAIEngine();
    if (this.pythonEngineManager) {
      return {
        ...(await this.pythonEngineManager.embedImage(imagePath)),
        modelName: this.pythonEngineManager.modelName,
      };
    }

    const fallbackEngine = await this.ensureXenovaFallbackEngine();
    return {
      ...(await fallbackEngine.embedImage(imagePath)),
      modelName: fallbackEngine.options?.modelName || 'Xenova/chinese-clip-vit-base-patch16',
    };
  }

  async ensureImageVectors(images = [], options = {}) {
    const normalizedImages = Array.isArray(images) ? images : [];
    const imageIds = normalizedImages
      .map((image) => Number(image?.id))
      .filter((value) => Number.isInteger(value) && value > 0);

    if (!imageIds.length) {
      return {
        supported: false,
        vectors: new Map(),
        computed: 0,
        requested: 0,
      };
    }

    await this.initializeAIEngine();
    if (!this.pythonEngineManager) {
      return {
        supported: false,
        vectors: new Map(),
        computed: 0,
        requested: imageIds.length,
      };
    }

    const existingRows = typeof this.db.getImageVectors === 'function'
      ? this.db.getImageVectors(imageIds)
      : [];
    const vectorMap = new Map(existingRows.map((row) => [row.image_id, row.vector]));
    const hasExplicitMaxToCompute = Object.prototype.hasOwnProperty.call(options, 'maxToCompute');
    const requestedMaxToCompute = hasExplicitMaxToCompute ? Number(options.maxToCompute) : 16;
    const maxToCompute = Number.isFinite(requestedMaxToCompute)
      ? Math.max(0, Math.min(32, requestedMaxToCompute))
      : 16;

    const missingImages = normalizedImages
      .filter((image) => !vectorMap.has(Number(image?.id)))
      .slice(0, maxToCompute);

    let computed = 0;
    for (const image of missingImages) {
      const imageId = Number(image?.id);
      const imagePath = this.resolveAvailableImagePath(image);
      if (!imageId || !imagePath) {
        continue;
      }

      try {
        const result = await this.computeImageEmbedding(imagePath);
        const vector = Array.isArray(result?.vector) ? result.vector : null;
        if (!vector || !vector.length) {
          continue;
        }

        if (typeof this.db.upsertImageVector === 'function') {
          this.db.upsertImageVector(imageId, vector, result?.modelName || this.pythonEngineManager?.modelName || this.aiEngine?.options?.modelName || 'unknown');
        }
        vectorMap.set(imageId, vector);
        computed += 1;
      } catch (error) {
        console.warn(`[AIEngine] Failed to compute image vector for ${imageId}:`, error.message);
      }
    }

    return {
      supported: true,
      vectors: vectorMap,
      computed,
      requested: imageIds.length,
    };
  }

  async rerankNaturalLanguageMatches(images = [], parsedIntent = null, options = {}) {
    const normalizedImages = Array.isArray(images) ? images : [];
    if (!normalizedImages.length) {
      return {
        images: [],
        vectorSearchApplied: false,
        vectorCoverage: { available: 0, total: 0, computed: 0 },
        cloudRerankApplied: false,
        cloudRerankCoverage: { scored: 0, total: 0 },
      };
    }

    const queryParts = [
      String(options.query || '').trim(),
      ...(Array.isArray(parsedIntent?.requiredTags) ? parsedIntent.requiredTags : []),
      ...(Array.isArray(parsedIntent?.implicitTags) ? parsedIntent.implicitTags : []),
    ].filter(Boolean);
    const queryText = Array.from(new Set(queryParts)).join(' ');
    const textVector = queryText ? await this.getTextEmbedding(queryText) : null;
    let vectorState = {
      supported: false,
      vectors: new Map(),
      computed: 0,
      requested: normalizedImages.length,
    };
    let vectorMap = new Map();

    if (textVector) {
      vectorState = await this.ensureImageVectors(normalizedImages, {
        maxToCompute: Object.prototype.hasOwnProperty.call(options, 'maxToCompute')
          ? options.maxToCompute
          : 16,
      });
      vectorMap = vectorState.vectors || new Map();
    }

    const dotProduct = (a = [], b = []) => {
      const size = Math.min(a.length, b.length);
      let score = 0;
      for (let index = 0; index < size; index += 1) {
        score += Number(a[index] || 0) * Number(b[index] || 0);
      }
      return score;
    };

    const rerankedImages = normalizedImages
      .map((image, index) => {
        const semanticVector = vectorMap.get(Number(image?.id)) || null;
        const semanticSimilarity = semanticVector && textVector ? dotProduct(textVector, semanticVector) : null;
        const lexicalScore = Number(image?.natural_search_score || 0);
        const hybridBoost = semanticSimilarity == null ? 0 : Math.max(0, semanticSimilarity) * 80;
        const hybridScore = lexicalScore + hybridBoost + (image?.strictMatch ? 6 : 0);
        const summary = Array.isArray(image?.natural_search_summary)
          ? [...image.natural_search_summary]
          : [];

        if (semanticSimilarity != null) {
          summary.push(`语义相似度: ${semanticSimilarity.toFixed(3)}`);
        }

        return {
          ...image,
          lexical_search_score: lexicalScore,
          semantic_similarity: semanticSimilarity,
          natural_search_score: hybridScore,
          natural_search_summary: summary,
          _stable_index: index,
        };
      })
      .sort((a, b) => {
        const aSimilarity = a.semantic_similarity == null ? -Infinity : a.semantic_similarity;
        const bSimilarity = b.semantic_similarity == null ? -Infinity : b.semantic_similarity;

        if (b.natural_search_score !== a.natural_search_score) {
          return b.natural_search_score - a.natural_search_score;
        }
        if (bSimilarity !== aSimilarity) {
          return bSimilarity - aSimilarity;
        }
        return a._stable_index - b._stable_index;
      })
      .map(({ _stable_index, ...image }) => image);

    const cloudRerank = options.skipCloudRerank
      ? {
          images: rerankedImages,
          cloudRerankApplied: false,
          cloudRerankCoverage: { scored: 0, total: normalizedImages.length },
        }
      : await this.applyCloudQueryRerank(rerankedImages, parsedIntent, {
          query: queryText,
          maxImages: options.maxCloudRerank || 8,
        });

    return {
      images: cloudRerank.images || rerankedImages,
      vectorSearchApplied: Boolean(vectorState.supported && textVector),
      vectorCoverage: {
        available: rerankedImages.filter((image) => image.semantic_similarity != null).length,
        total: normalizedImages.length,
        computed: vectorState.computed || 0,
      },
      cloudRerankApplied: !!cloudRerank.cloudRerankApplied,
      cloudRerankCoverage: cloudRerank.cloudRerankCoverage || { scored: 0, total: normalizedImages.length },
    };
  }

  async applyCloudQueryRerank(images = [], parsedIntent = null, options = {}) {
    const normalizedImages = Array.isArray(images) ? [...images] : [];
    const query = String(options.query || '').trim();
    const canUseCloudRerank = Boolean(
      query
      && this.deepseekReviewer
      && typeof this.deepseekReviewer.isEnabled === 'function'
      && this.deepseekReviewer.isEnabled()
      && typeof this.deepseekReviewer.scoreImageRelevance === 'function'
    );

    if (!normalizedImages.length || !canUseCloudRerank) {
      return {
        images: normalizedImages,
        cloudRerankApplied: false,
        cloudRerankCoverage: { scored: 0, total: normalizedImages.length },
      };
    }

    const maxImages = Math.max(1, Math.min(12, Number(options.maxImages) || 8));
    const topCandidates = normalizedImages.slice(0, maxImages);
    const cloudScoreById = new Map();
    let scored = 0;

    for (const image of topCandidates) {
      const imagePath = image?.current_path || image?.path || '';
      if (!imagePath) {
        continue;
      }

      try {
        const review = await this.deepseekReviewer.scoreImageRelevance({
          query,
          requiredTags: Array.isArray(parsedIntent?.requiredTags) ? parsedIntent.requiredTags : [],
          implicitTags: Array.isArray(parsedIntent?.implicitTags) ? parsedIntent.implicitTags : [],
          existingTags: String(image?.tags || '').split(',').map((item) => item.trim()).filter(Boolean),
          filename: image?.filename || '',
          folder: image?.folder || '',
          imagePath,
        });

        if (!review || typeof review.relevanceScore !== 'number') {
          continue;
        }

        cloudScoreById.set(Number(image.id), review);
        scored += 1;
      } catch (error) {
        console.warn('[NaturalSearch] Cloud rerank skipped for image:', image?.id, error.message);
      }
    }

    if (!scored) {
      return {
        images: normalizedImages,
        cloudRerankApplied: false,
        cloudRerankCoverage: { scored: 0, total: normalizedImages.length },
      };
    }

    const reranked = normalizedImages
      .map((image, index) => {
        const review = cloudScoreById.get(Number(image?.id)) || null;
        const summary = Array.isArray(image?.natural_search_summary)
          ? [...image.natural_search_summary]
          : [];
        let boostedScore = Number(image?.natural_search_score || 0);

        if (review) {
          boostedScore += review.relevanceScore * 52;
          summary.push(`Gemma相关性: ${review.relevanceScore.toFixed(3)}`);
          if (Array.isArray(review.matchedTags) && review.matchedTags.length) {
            summary.push(`Gemma命中: ${review.matchedTags.slice(0, 3).join(' / ')}`);
          }
          if (Array.isArray(review.contradictions) && review.contradictions.length) {
            boostedScore -= Math.min(12, review.contradictions.length * 4);
            summary.push(`Gemma冲突: ${review.contradictions.slice(0, 2).join(' / ')}`);
          }
        }

        return {
          ...image,
          cloud_relevance_score: review ? review.relevanceScore : null,
          natural_search_score: boostedScore,
          natural_search_summary: summary,
          _stable_index: index,
        };
      })
      .sort((a, b) => {
        if ((b.natural_search_score || 0) !== (a.natural_search_score || 0)) {
          return (b.natural_search_score || 0) - (a.natural_search_score || 0);
        }
        const aCloud = Number.isFinite(a.cloud_relevance_score) ? a.cloud_relevance_score : -Infinity;
        const bCloud = Number.isFinite(b.cloud_relevance_score) ? b.cloud_relevance_score : -Infinity;
        if (bCloud !== aCloud) {
          return bCloud - aCloud;
        }
        return a._stable_index - b._stable_index;
      })
      .map(({ _stable_index, ...image }) => image);

    return {
      images: reranked,
      cloudRerankApplied: true,
      cloudRerankCoverage: { scored, total: normalizedImages.length },
    };
  }

  async backfillImageVectorsBatch(options = {}) {
    if (this.vectorBackfillState.running) {
      return {
        skipped: true,
        reason: 'already_running',
      };
    }

    this.vectorBackfillState.running = true;
    this.vectorBackfillState.lastError = null;

    try {
      try {
        await this.initializeAIEngine();
      } catch (error) {
        console.warn('[AIEngine] Local Python unavailable for vector backfill, trying Xenova fallback:', error.message);
        await this.ensureXenovaFallbackEngine();
      }

      if (!this.pythonEngineManager && !this.aiEngine) {
        this.vectorBackfillState.enabled = false;
        return {
          skipped: true,
          reason: 'semantic_engine_unavailable',
        };
      }
      this.vectorBackfillState.enabled = true;
      this.vectorBackfillState.modelPreloaded = Boolean(this.pythonEngineManager || this.aiEngine);

      const missingImages = typeof this.db.getImagesMissingVectors === 'function'
        ? this.db.getImagesMissingVectors(options.limit || 4)
        : [];
      let computed = 0;

      for (const image of missingImages) {
        const imageId = Number(image?.id);
        const imagePath = this.resolveAvailableImagePath(image);
        if (!imageId || !imagePath) {
          continue;
        }

        try {
          const result = await this.computeImageEmbedding(imagePath);
          const vector = Array.isArray(result?.vector) ? result.vector : null;
          if (!vector || !vector.length) {
            continue;
          }

          if (typeof this.db.upsertImageVector === 'function') {
            this.db.upsertImageVector(imageId, vector, result?.modelName || this.pythonEngineManager?.modelName || this.aiEngine?.options?.modelName || 'unknown');
          }
          computed += 1;
        } catch (error) {
          console.warn(`[AIEngine] Background vector backfill failed for ${imageId}:`, error.message);
        }
      }

      this.vectorBackfillState.computed += computed;
      this.vectorBackfillState.lastRunAt = new Date().toISOString();
      this.vectorBackfillState.missing = typeof this.db.countImagesMissingVectors === 'function'
        ? this.db.countImagesMissingVectors()
        : 0;
      return {
        skipped: false,
        computed,
        missing: this.vectorBackfillState.missing,
      };
    } catch (error) {
      this.vectorBackfillState.lastError = error.message;
      return {
        skipped: true,
        reason: error.message,
      };
    } finally {
      this.vectorBackfillState.running = false;
      this.updateStats();
    }
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    if (typeof this.db.cleanupDuplicateActiveTasks === 'function') {
      this.db.cleanupDuplicateActiveTasks();
    }
    if (typeof this.db.resetInterruptedTasks === 'function') {
      this.db.resetInterruptedTasks();
    }
    if (typeof this.db.resetStaleProcessingTasks === 'function') {
      this.db.resetStaleProcessingTasks(10);
    }
    if (typeof this.db.cleanupDisallowedAITasks === 'function') {
      this.db.cleanupDisallowedAITasks();
    }

    this.intervals.thumbnail = setInterval(() => {
      this.processQueue('thumbnail');
    }, 1000);

    this.intervals.aiTag = setInterval(() => {
      this.processQueue('aiTag');
    }, 500);

    this.intervals.housekeeping = setInterval(() => {
      if (typeof this.db.resetStaleProcessingTasks === 'function') {
        this.db.resetStaleProcessingTasks(Math.ceil(this.options.aiTaskTimeoutMs / 60000) + 1, 'aiTag');
      }
      if (this.isRunning) {
        this.processQueue('aiTag');
      }
    }, 60000);

    this.intervals.stats = setInterval(() => {
      this.updateStats();
    }, 5000);

    this.intervals.vectorBackfill = setInterval(() => {
      this.backfillImageVectorsBatch({ limit: 3 });
    }, 15000);

    console.log('[ProcessingWorker] started');
    this.emit('started');
    this.processQueue('thumbnail');
    this.processQueue('aiTag');
    setTimeout(() => this.warmSemanticSearch(), 1500);
    setTimeout(() => this.backfillImageVectorsBatch({ limit: 6 }), 4000);
  }

  async stop() {
    this.isRunning = false;
    Object.values(this.intervals).forEach(clearInterval);
    this.intervals = {};
    
    // 优雅停止 Python 引擎
    if (this.pythonEngineManager) {
      try {
        await this.pythonEngineManager.stop();
        console.log('[AIEngine] Python engine stopped');
      } catch (error) {
        console.error('[AIEngine] Failed to stop Python engine:', error);
      }
    }
    
    console.log('[ProcessingWorker] stopped');
    this.emit('stopped');
  }

  // 暂停指定队列
  pauseQueue(queueType) {
    this.queues[queueType].paused = true;
    this.emit('paused', queueType);
  }

  // 继续指定队列
  resumeQueue(queueType) {
    this.queues[queueType].paused = false;
    this.emit('resumed', queueType);
  }

  // 处理队列
  async processQueue(queueType) {
    const queue = this.queues[queueType];
    if (queue.paused || queue.running >= queue.concurrency) return;
    
    const tasks = this.db.getPendingTasks(queueType, queue.concurrency - queue.running);
    
    for (const task of tasks) {
      queue.running++;
      this.processTask(task, queueType).finally(() => {
        queue.running--;
        if (this.isRunning) {
          setImmediate(() => this.processQueue(queueType));
        }
      });
    }
  }

  // 处理单个任务
  async processTask(task, queueType) {
    try {
      this.db.updateTaskStatus(task.id, 'processing');
      this.emit('taskStarted', { task, queueType });

      switch (queueType) {
        case 'thumbnail':
          await this.generateThumbnail(task);
          break;
        case 'aiTag':
          await this.runAiTaskWithTimeout(task);
          break;
        case 'manualTag':
          // 人工标签不参与自动处理
          break;
      }

      this.db.updateTaskStatus(task.id, 'completed');
      this.emit('taskCompleted', { task, queueType });
      
    } catch (error) {
      console.error(`任务失败 [${queueType}]:`, error);
      this.db.updateTaskStatus(task.id, 'failed', error.message);
      this.emit('taskFailed', { task, queueType, error });
    }
  }

  // recovered from corrupted comment
  async generateThumbnail(task) {
    const fs = require('fs').promises;
    const path = require('path');
    
    const thumbnailDir = path.join(this.db.libraryPath, '.data', 'thumbnails');
    await fs.mkdir(thumbnailDir, { recursive: true });
    
    const thumbnailPath = path.join(thumbnailDir, `${task.image_id}.jpg`);
    
    try {
      let metadata = null;
      let dominantColor = null;

      try {
        const sharp = require('sharp');
        await sharp(task.path)
          .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toFile(thumbnailPath);

        metadata = await sharp(task.path).metadata();
        const stats = await sharp(task.path).stats();
        dominantColor = this.rgbToHex(stats.dominant);
      } catch (sharpError) {
        console.warn('[Thumbnail] Sharp failed, falling back to Pillow:', sharpError.message);
        const fallback = await this.generateThumbnailWithPython(task.path, thumbnailPath);
        metadata = {
          width: fallback?.width || null,
          height: fallback?.height || null,
        };
        dominantColor = fallback?.dominantColor || null;
      }
      
      // recovered from corrupted comment
      const transaction = this.db.db.transaction(() => {
        // recovered from corrupted comment
        this.db.db.prepare(`
          UPDATE images 
          SET thumbnail_path = ?, width = ?, height = ?, dominant_color = ?, process_status = 'thumbnail'
          WHERE id = ?
        `).run(thumbnailPath, metadata.width, metadata.height, dominantColor, task.image_id);
        
        // 只有完整导入的图片才会在缩略图完成后继续自动打 AI 标签。
        if (task.auto_ai_tag) {
          try {
            this.db.db.prepare(`
              INSERT OR IGNORE INTO processing_queue (image_id, task_type, priority)
              VALUES (?, 'aiTag', 0)
            `).run(task.image_id);
          } catch (e) {
            console.error('Failed to enqueue AI tagging task:', e);
            // Continue even if the follow-up AI task cannot be queued.
          }
        }
      });
      
      transaction();
    } catch (error) {
      // 清理已生成的缩略图文件
      try {
        await fs.unlink(thumbnailPath);
      } catch (_) {}
      throw error;
    }
  }

  async generateThumbnailWithPython(sourcePath, thumbnailPath) {
    const { execFile } = require('child_process');
    const util = require('util');
    const execFileAsync = util.promisify(execFile);
    const pythonScript = [
      'import json',
      'import sys',
      'from PIL import Image, ImageOps',
      'source_path = sys.argv[1]',
      'thumbnail_path = sys.argv[2]',
      'with Image.open(source_path) as img:',
      '    image = ImageOps.exif_transpose(img).convert("RGB")',
      '    width, height = image.size',
      '    thumb = image.copy()',
      '    thumb.thumbnail((400, 400))',
      '    thumb.save(thumbnail_path, format="JPEG", quality=85)',
      '    dominant = image.resize((1, 1)).getpixel((0, 0))',
      'print(json.dumps({"width": width, "height": height, "dominant": list(dominant)}))',
    ].join('; ');
    const { stdout } = await execFileAsync('python', ['-c', pythonScript, sourcePath, thumbnailPath], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const parsed = JSON.parse(String(stdout || '').trim() || '{}');
    return {
      width: Number(parsed.width || 0) || null,
      height: Number(parsed.height || 0) || null,
      dominantColor: Array.isArray(parsed.dominant)
        ? this.rgbToHex({ r: parsed.dominant[0], g: parsed.dominant[1], b: parsed.dominant[2] })
        : null,
    };
  }

  // AI 标签识别（支持 Python 与 Xenova）
  async generateAITags(task) {
    let shouldReconcileStatus = true;
    let result = null;
    const aiInputPath = this.resolveAITagInputPath(task);
    try {
      if (!aiInputPath) {
        throw new Error(`AI source image missing for image ${task?.image_id || 'unknown'}`);
      }

      try {
        await this.initializeAIEngine();
      } catch (error) {
        const cloudOnlyAvailable = Boolean(
          this.deepseekReviewer
          && typeof this.deepseekReviewer.isEnabled === 'function'
          && this.deepseekReviewer.isEnabled()
        );

        if (!cloudOnlyAvailable) {
          throw error;
        }

        console.warn('[AIEngine] Local semantic engines unavailable, trying cloud-only semantic tagging:', error.message);
      }
      const visualSeasonHintTags = await this.buildVisualSeasonHintTags(task);
      const existingSeasonHintTags = this.getExistingSeasonHintTags(task.image_id);

      // 优先使用 Python 引擎
      if (this.pythonEngineManager) {
        try {
          result = await this.pythonEngineManager.analyzeImage(aiInputPath);
        } catch (error) {
          console.warn('[AIEngine] Python engine analysis failed:', error.message);
          try {
            await this.ensureXenovaFallbackEngine();
          } catch (fallbackInitError) {
            console.error('[AIEngine] Xenova fallback initialization failed:', fallbackInitError);
          }
          result = null;
        }
      }
      
      // Python 引擎失败时回退到 Xenova
      if (!result && this.aiEngine) {
        result = await this.aiEngine.analyzeImage(aiInputPath);
      }
      
      const normalizedTags = Array.isArray(result?.tags)
        ? result.tags
          .map((tag) => {
            if (typeof tag === 'string') {
              return {
                name: tag,
                confidence: 0.8,
                source: 'ai',
                category: null
              };
            }

            if (tag && typeof tag === 'object' && tag.name) {
              return {
                name: tag.name,
                confidence: typeof tag.confidence === 'number' ? tag.confidence : 0.8,
                source: tag.source || 'ai',
                category: tag.category || null
              };
            }

            return null;
          })
          .filter(Boolean)
        : [];

      const semanticTags = normalizedTags.filter((tag) => !this.isColorTag(tag));
      const enrichedTags = this.enrichAITags(
        this.mergeDerivedAITags(semanticTags, visualSeasonHintTags, existingSeasonHintTags),
        task
      );
      const cloudEnhanced = await this.enhanceSemanticTagsWithCloud({
        task,
        result,
        semanticTags: enrichedTags,
      });
      const semanticTagsForFinalize = this.enrichAITags(
        this.mergeDerivedAITags(
          cloudEnhanced?.tags || enrichedTags,
          visualSeasonHintTags,
          existingSeasonHintTags
        ),
        task
      );

      if (semanticTagsForFinalize.length > 0) {
        if (Array.isArray(result?.vector) && result.vector.length && typeof this.db.upsertImageVector === 'function') {
          this.db.upsertImageVector(
            task.image_id,
            result.vector,
            this.pythonEngineManager?.modelName || this.aiEngine?.options?.modelName || 'unknown'
          );
        }
        let finalTags = this.mergeDerivedAITags(
          semanticTagsForFinalize,
          visualSeasonHintTags,
          this.buildAuxiliaryDimensionTags(result, semanticTagsForFinalize)
        );
        finalTags = await this.reviewAndFinalizeAITags({
          task,
          result,
          semanticTags: semanticTagsForFinalize,
          finalTags
        });
        this.cleanupAISemanticTags(task.image_id);
        this.cleanupAIColorTags(task.image_id);
        this.cleanupDerivedPeopleTags(task.image_id);
        this.cleanupDerivedSceneDimensionTags(task.image_id);

        for (const tag of finalTags) {
          this.saveAITag(task.image_id, tag);
        }
        this.ensureSemanticTagCoverage(task.image_id, finalTags, semanticTags.length > 0 ? 6 : 4);
        console.log(`[AIEngine] Image ${task.image_id} generated ${normalizedTags.length} AI tags`);
      } else {
        console.log(`[AIEngine] Image ${task.image_id} did not return semantic tags, using fallback rules`);
        await this.generateAITagsFallback(task, result);
      }

      const storedImage = this.db.db.prepare(`
        SELECT dominant_color, width, height FROM images WHERE id = ?
      `).get(task.image_id);
      const colorTag = this.getPhotographicColorTag(task.dominant_color || storedImage?.dominant_color);
      if (colorTag) {
        this.replaceAIColorTag(task.image_id, colorTag);
      }
      this.applyObjectivePhotographyTags(task.image_id, storedImage);
    } catch (error) {
      console.error('[AIEngine] AI tagging failed:', error);
      const hasFallbackSignals = Boolean(
        result
        && (
          (Array.isArray(result?.tags) && result.tags.length > 0)
          || result?.weather
          || result?.people_analysis
          || result?.peopleAnalysis
        )
      );

      if (!hasFallbackSignals) {
        throw error;
      }

      await this.generateAITagsFallback(task, result);
    }

    if (shouldReconcileStatus && typeof this.db.reconcileImageStatus === 'function') {
      this.db.reconcileImageStatus(task.image_id);
    } else {
      this.db.updateImageStatus(task.image_id, 'auto_tagged');
    }
  }

  async runAiTaskWithTimeout(task) {
    const timeoutMs = Math.max(60000, Number(this.options.aiTaskTimeoutMs) || 300000);
    let timeoutId = null;

    try {
      await Promise.race([
        this.generateAITags(task),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`AI tagging timed out after ${Math.round(timeoutMs / 1000)}s`));
          }, timeoutMs);
        })
      ]);
    } catch (error) {
      if (String(error?.message || '').includes('timed out')) {
        await this.restartAIEngine();
      }
      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  async restartAIEngine() {
    try {
      if (this.pythonEngineManager) {
        await this.pythonEngineManager.stop();
      }
    } catch (error) {
      console.error('[AIEngine] Failed to stop Python engine during restart:', error);
    }

    try {
      if (this.aiEngine) {
        this.aiEngine.stop();
      }
    } catch (error) {
      console.error('[AIEngine] Failed to stop Xenova engine during restart:', error);
    }

    this.pythonEngineManager = null;
    this.aiEngine = null;
    this.aiEngineInitialized = false;
    this.aiEngineInitPromise = null;
  }

  // recovered from corrupted comment
  async generateAITagsFallback(task, aiResult = null) {
    const path = require('path');
    try {
      const effectivePath = task?.path || task?.current_path || task?.thumbnail_path || '';
      const filename = path.basename(effectivePath, path.extname(effectivePath));
      const folder = path.basename(path.dirname(effectivePath));
      const keywords = this.extractSemanticKeywords(`${filename} ${folder}`);
      const visualSeasonHintTags = await this.buildVisualSeasonHintTags(task);
      const derivedTags = this.mergeDerivedAITags(
        visualSeasonHintTags,
        this.buildWeatherDimensionTags(aiResult?.weather || null, []),
        this.buildPeopleDimensionTags(aiResult?.people_analysis || aiResult?.peopleAnalysis || null, [])
      );
      const retainedDerivedTags = this.filterRetainedAITags(
        this.applyLocalDimensionGuards(aiResult, [], derivedTags, task)
      );
      this.cleanupAISemanticTags(task.image_id);
      this.cleanupDerivedPeopleTags(task.image_id);
      this.cleanupDerivedSceneDimensionTags(task.image_id);

      for (const keyword of keywords) {
        this.saveAITag(task.image_id, {
          name: keyword,
          confidence: 0.5,
          source: 'ai_fallback'
        });
      }
      for (const tag of retainedDerivedTags) {
        this.saveAITag(task.image_id, {
          ...tag,
          source: tag.source || 'ai_fallback'
        });
      }

      this.ensureSemanticTagCoverage(task.image_id, [
        ...retainedDerivedTags
      ], 4);
      console.log(`[AIEngine] Image ${task.image_id} fallback tagged with ${retainedDerivedTags.length} tags`);
    } catch (error) {
      console.error('[AIEngine] Fallback tagging failed:', error);
    }
  }
  extractKeywords(text) {
    return this.extractSemanticKeywords(text).slice(0, 5);
  }
  rgbToHex(rgb) {
    if (!rgb) return null;
    const toHex = (n) => n.toString(16).padStart(2, '0');
    return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
  }
  extractSemanticKeywords(text) {
    const keywords = [];
    const patterns = {
      '\u65b0\u7586': ['xinjiang'],
      '\u897f\u85cf': ['tibet', 'lhasa'],
      '\u4e91\u5357': ['yunnan', 'dali', 'lijiang'],
      '\u56db\u5ddd': ['sichuan', 'chengdu'],
      '\u9752\u6d77': ['qinghai'],
      '\u5317\u4eac': ['beijing'],
      '\u4e0a\u6d77': ['shanghai', 'bund', 'pudong'],
      '\u5e7f\u5dde': ['guangzhou', 'canton'],
      '\u6df1\u5733': ['shenzhen'],
      '\u676d\u5dde': ['hangzhou'],
      '\u897f\u5b89': ['xian', 'xi an'],
      '\u6b66\u6c49': ['wuhan'],
      '\u9752\u5c9b': ['qingdao', 'tsingtao'],
      '\u8349\u539f': ['grassland', 'meadow', 'prairie'],
      '\u68ee\u6797': ['forest', 'woods'],
      '\u96ea\u5c71': ['snow mountain', 'snowy mountain'],
      '\u6e56\u6cca': ['lake'],
      '\u6cb3\u6d41': ['river'],
      '\u6c34\u9762': ['water surface', 'water', 'river water'],
      '\u6811\u6728': ['tree', 'trees', 'willow tree'],
      '\u7eff\u690d': ['greenery', 'plants', 'vegetation'],
      '\u8239\u53ea': ['boat', 'vessel', 'wooden boat'],
      '\u5c0f\u8239': ['small boat', 'row boat', 'skiff'],
      '\u6e38\u8239': ['tour boat', 'cruise boat', 'sightseeing boat'],
      '\u5ce1\u8c37': ['canyon'],
      '\u6865\u6881': ['bridge', 'arch bridge', 'stone bridge'],
      '\u4ead\u5b50': ['gazebo', 'pavilion', 'chinese pavilion'],
      '\u53e4\u5efa\u7b51': ['traditional architecture', 'historic architecture', 'ancient building'],
      '\u56ed\u6797': ['classical garden', 'chinese garden', 'landscape garden'],
      '\u6e56\u9762': ['lake surface', 'water surface'],
      '\u5bfa\u5e99': ['temple', 'shrine'],
      '\u70ed\u6c14\u7403': ['hot air balloon', 'air balloon', 'balloon', 'ballooning'],
      '\u65e5\u843d': ['sunset', 'dusk'],
      '\u65e5\u51fa': ['sunrise', 'dawn'],
      '\u591c\u666f': ['night view', 'nightscape'],
      '\u4eba\u7269': ['person', 'people', 'portrait', 'human', 'traveler', 'tourist'],
      '\u5408\u7167': ['group photo', 'group portrait', 'team photo'],
      '\u76f8\u673a': ['camera', 'dslr'],
      '\u65e0\u4eba\u673a': ['drone', 'uav', 'quadcopter'],
      '\u6c7d\u8f66': ['car', 'vehicle', 'jeep', 'suv'],
      '\u5df4\u58eb': ['bus', 'coach'],
      '\u706b\u8f66': ['train', 'railway'],
      '\u98de\u673a': ['airplane', 'plane', 'aircraft'],
      '\u81ea\u884c\u8f66': ['bicycle', 'bike', 'cycling'],
      '\u6469\u6258\u8f66': ['motorcycle', 'motorbike'],
      '\u5a5a\u793c': ['wedding', 'bride', 'groom'],
      '\u6f14\u51fa': ['performance', 'concert', 'show', 'stage'],
      '\u8282\u5e86': ['festival', 'ceremony', 'celebration'],
      '\u8fd0\u52a8': ['sports', 'sport', 'match', 'game'],
      '\u5f92\u6b65': ['hiking', 'trekking'],
      '\u9732\u8425': ['camping', 'camp'],
      '\u9a91\u884c': ['cycling', 'riding'],
      '\u57ce\u5e02\u5929\u9645\u7ebf': ['skyline', 'city skyline', 'urban skyline'],
      '\u57ce\u5e02\u8857\u666f': ['street', 'street view', 'city street', 'urban street', 'avenue', 'roadside'],
      '\u53e4\u9547': ['ancient town', 'old town', 'historic town'],
      '\u6751\u5e84': ['village', 'hamlet', 'countryside'],
      '\u82b1\u6d77': ['flower field', 'flowers', 'blossom', 'bloom'],
      '\u7530\u91ce': ['field', 'farmland', 'pasture'],
      '\u6625\u5929': ['spring', 'springtime', 'spring season'],
      '\u590f\u5929': ['summer', 'summertime', 'summer season'],
      '\u79cb\u5929': ['autumn', 'fall', 'autumn season', 'fall season'],
      '\u51ac\u5929': ['winter', 'wintertime', 'winter season', 'snowy winter'],
      '\u6d77\u8fb9': ['beach', 'seaside', 'coast', 'shore'],
      '\u9ad8\u5c71': ['peak', 'alpine', 'mount ridge'],
      '\u72d7': ['dog', 'puppy', 'canine'],
      '\u732b': ['cat', 'kitten', 'feline'],
      '\u718a': ['bear'],
      '\u68d5\u718a': ['brown bear', 'grizzly'],
      '\u8001\u864e': ['tiger'],
      '\u718a\u732b': ['panda'],
      '\u72d0\u72f8': ['fox'],
      '\u9e1f': ['bird', 'eagle', 'sparrow', 'seagull'],
      '\u9e7f': ['deer', 'stag'],
      '\u9a6c': ['horse', 'pony'],
      '\u725b': ['cow', 'cattle', 'bull'],
      '\u7f8a': ['sheep', 'goat', 'lamb']
    };
    const sourceText = String(text || '');
    const lowerText = sourceText.toLowerCase();
    for (const [tag, words] of Object.entries(patterns)) {
      const hasDirectChineseHit = tag.length >= 2 && sourceText.includes(tag);
      if (hasDirectChineseHit || words.some((word) => lowerText.includes(word))) {
        keywords.push(tag);
      }
    }
    return keywords.slice(0, 6);
  }
  normalizeTagName(name) {
    return normalizeAITagName(name);
  }

  isColorTag(tag) {
    const name = this.normalizeTagName(tag?.name || tag);
    if (!name) return false;

    if (tag && typeof tag === 'object' && tag.category === 'color') {
      return true;
    }

    const definition = this.getAITagDefinition(name);
    if (definition?.categoryId === 'color') {
      return true;
    }

    const existing = this.getExistingTagRecord(name);
    return existing?.category_id === 'color';
  }

  cleanupAIColorTags(imageId) {
    const aiSources = ['ai', 'ai_hint', 'ai_color', 'ai_fallback', 'ai_color_hint'];
    const placeholders = aiSources.map(() => '?').join(',');
    const rows = this.db.db.prepare(`
      SELECT it.tag_id
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
        AND t.category_id = 'color'
        AND it.source IN (${placeholders})
    `).all(imageId, ...aiSources);

    if (rows.length === 0) return;

    this.db.db.prepare(`
      DELETE FROM image_tags
      WHERE image_id = ?
        AND source IN (${placeholders})
        AND tag_id IN (
          SELECT id FROM tags WHERE category_id = 'color'
        )
    `).run(imageId, ...aiSources);

    for (const row of rows) {
      this.db.db.prepare(`
        UPDATE tags
        SET usage_count = MAX(0, usage_count - 1)
        WHERE id = ?
      `).run(row.tag_id);
    }
  }

  cleanupAISemanticTags(imageId) {
    const aiSources = [
      'ai',
      'ai_hint',
      'ai_fallback',
      'ai_people_hint',
      'mediapipe_face',
      'opencv_body',
      'people_detector',
      'ai_semantic_fallback',
      'ai_semantic_floor',
      'deepseek_review'
    ];
    const sourcePlaceholders = aiSources.map(() => '?').join(',');
    const rows = this.db.db.prepare(`
      SELECT it.tag_id
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
        AND it.source IN (${sourcePlaceholders})
        AND t.category_id NOT IN ('color', 'custom')
    `).all(imageId, ...aiSources);

    if (rows.length === 0) return;

    this.db.db.prepare(`
      DELETE FROM image_tags
      WHERE image_id = ?
        AND source IN (${sourcePlaceholders})
        AND tag_id IN (
          SELECT id FROM tags WHERE category_id NOT IN ('color', 'custom')
        )
    `).run(imageId, ...aiSources);

    for (const row of rows) {
      this.db.db.prepare(`
        UPDATE tags
        SET usage_count = MAX(0, usage_count - 1)
        WHERE id = ?
      `).run(row.tag_id);
    }
  }

  cleanupDerivedPeopleTags(imageId) {
    const derivedPeopleTags = [PERSON_TAG, '单人', '多人', PURE_SCENERY_TAG];
    const derivedSources = [
      'mediapipe_face',
      'opencv_body',
      'ai_people_hint',
      'people_detector',
      'ai_semantic_fallback',
      'ai_semantic_floor',
    ];
    const tagPlaceholders = derivedPeopleTags.map(() => '?').join(',');
    const sourcePlaceholders = derivedSources.map(() => '?').join(',');
    const rows = this.db.db.prepare(`
      SELECT it.tag_id
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
        AND t.name IN (${tagPlaceholders})
        AND it.source IN (${sourcePlaceholders})
    `).all(imageId, ...derivedPeopleTags, ...derivedSources);

    if (rows.length === 0) return;

    this.db.db.prepare(`
      DELETE FROM image_tags
      WHERE image_id = ?
        AND source IN (${sourcePlaceholders})
        AND tag_id IN (
          SELECT id FROM tags WHERE name IN (${tagPlaceholders})
        )
    `).run(imageId, ...derivedSources, ...derivedPeopleTags);

    for (const row of rows) {
      this.db.db.prepare(`
        UPDATE tags
        SET usage_count = MAX(0, usage_count - 1)
        WHERE id = ?
      `).run(row.tag_id);
    }
  }

  cleanupDerivedSceneDimensionTags(imageId) {
    const derivedSceneTags = [...Array.from(WEATHER_TAGS), ...Array.from(SEASON_TAGS)];
    const derivedSources = [
      'ai_weather',
      'ai_weather_floor',
      'ai_season_floor',
      'ai_visual_season',
    ];
    const tagPlaceholders = derivedSceneTags.map(() => '?').join(',');
    const sourcePlaceholders = derivedSources.map(() => '?').join(',');
    const rows = this.db.db.prepare(`
      SELECT it.tag_id
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
        AND t.name IN (${tagPlaceholders})
        AND it.source IN (${sourcePlaceholders})
    `).all(imageId, ...derivedSceneTags, ...derivedSources);

    if (rows.length === 0) return;

    this.db.db.prepare(`
      DELETE FROM image_tags
      WHERE image_id = ?
        AND source IN (${sourcePlaceholders})
        AND tag_id IN (
          SELECT id FROM tags WHERE name IN (${tagPlaceholders})
        )
    `).run(imageId, ...derivedSources, ...derivedSceneTags);

    for (const row of rows) {
      this.db.db.prepare(`
        UPDATE tags
        SET usage_count = MAX(0, usage_count - 1)
        WHERE id = ?
      `).run(row.tag_id);
    }
  }

  async buildVisualSeasonHintTags(task) {
    const imagePath = this.resolveAITagInputPath(task);
    if (!imagePath) {
      return [];
    }

    try {
      const sharp = require('sharp');
      const { data, info } = await sharp(imagePath)
        .resize(64, 64, { fit: 'inside', withoutEnlargement: true })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      if (!info?.width || !info?.height || !data?.length) {
        return [];
      }

      let snowLikePixels = 0;
      const totalPixels = info.width * info.height;
      for (let offset = 0; offset < data.length; offset += info.channels) {
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const avg = (r + g + b) / 3;
        const saturation = max === 0 ? 0 : (max - min) / max;
        const lowSaturation = saturation <= 0.22;
        const bright = avg >= 170;
        const nearWhite = (max - min) <= 28;
        const coolOrNeutral = b >= r - 12 && b >= g - 12;

        if (bright && lowSaturation && (nearWhite || coolOrNeutral)) {
          snowLikePixels += 1;
        }
      }

      const snowRatio = totalPixels > 0 ? snowLikePixels / totalPixels : 0;
      if (snowRatio >= 0.16) {
        return [{
          name: '冬天',
          confidence: Math.min(0.84, 0.58 + snowRatio),
          source: 'ai_visual_season',
          category: 'scene'
        }];
      }
    } catch (error) {
      console.warn('[SeasonHint] Visual season hint skipped:', error.message);
    }

    return [];
  }

  getExistingTagRecord(name) {
    if (!name) return null;
    return this.db.db.prepare(`
      SELECT id, category_id, color
      FROM tags
      WHERE name = ?
      ORDER BY usage_count DESC, id ASC
      LIMIT 1
    `).get(name);
  }

  getAITagDefinition(name) {
    return SHARED_AI_TAG_LOOKUP.get(name) || null;
  }

  getExistingSeasonHintTags(imageId) {
    if (!imageId) {
      return [];
    }

    return this.db.db.prepare(`
      SELECT t.name, it.confidence, it.source
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
        AND t.name IN (${Array.from(SEASON_TAGS).map(() => '?').join(',')})
        AND it.source NOT IN ('ai_season_floor', 'ai_visual_season')
      ORDER BY it.confidence DESC, it.id ASC
    `).all(imageId, ...Array.from(SEASON_TAGS))
      .filter((row) => (row.confidence || 0) >= 0.4)
      .map((row) => ({
        name: this.normalizeTagName(row.name),
        confidence: Math.max(0.4, Number(row.confidence || 0)),
        source: 'ai_history_hint',
        category: 'scene'
      }));
  }

  resolveSemanticTagCategory(tag) {
    const name = this.normalizeTagName(tag?.name);
    if (SEASON_TAGS.has(name)) {
      return 'scene';
    }
    return tag?.category
      || this.getAITagDefinition(name)?.categoryId
      || this.getExistingTagRecord(name)?.category_id
      || null;
  }

  enrichAITags(tags, task) {
    const byName = new Map();
    for (const tag of tags) {
      const name = this.normalizeTagName(tag?.name);
      if (!name) continue;
      const confidence = typeof tag.confidence === 'number' ? tag.confidence : 0.8;
      const existing = byName.get(name);
      if (!existing || confidence > existing.confidence) {
        byName.set(name, {
          name,
          confidence,
          source: tag.source || 'ai',
          category: tag.category || this.getAITagDefinition(name)?.categoryId || this.getExistingTagRecord(name)?.category_id || null
        });
      }
    }
    const filename = task?.filename || '';
    const folder = task?.folder || '';
    for (const keyword of this.extractSemanticKeywords(`${filename} ${folder}`)) {
      if (!byName.has(keyword)) {
        byName.set(keyword, {
          name: keyword,
          confidence: 0.62,
          source: 'ai_hint',
          category: this.resolveSemanticTagCategory({ name: keyword })
        });
      }
    }
    let enriched = Array.from(byName.values());
    enriched = this.limitAnimalCandidates(enriched);
    enriched = this.limitSceneCandidates(enriched, task);
    enriched = this.limitSeasonCandidates(enriched, task);
    enriched = this.limitLocationCandidates(enriched, task);
    enriched = this.limitPeopleCandidates(enriched, task);
    enriched = this.limitEventCandidates(enriched, task);
    enriched = this.limitConflictingEvents(enriched);
    enriched = this.ensureRepresentativeTags(enriched);
    return enriched
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, 18);
  }

  normalizeCloudCategory(categoryName) {
    const normalized = String(categoryName || '').trim().toLowerCase();
    if (['scene', 'location', 'animal', 'people', 'device', 'event'].includes(normalized)) {
      return normalized;
    }
    return null;
  }

  shouldUseCloudTagEnhancement(task, semanticTags = [], result = null) {
    if (
      !this.deepseekReviewer
      || typeof this.deepseekReviewer.isEnabled !== 'function'
      || !this.deepseekReviewer.isEnabled()
      || typeof this.deepseekReviewer.extractImageStructuredTags !== 'function'
    ) {
      return false;
    }

    if (!task?.path) {
      return false;
    }

    const normalizedTags = Array.isArray(semanticTags) ? semanticTags : [];
    const highConfidenceTagCount = normalizedTags.filter((tag) => Number(tag?.confidence || 0) >= 0.42).length;
    const topConfidence = normalizedTags.reduce((best, tag) => Math.max(best, Number(tag?.confidence || 0)), 0);
    const hasStrongAnimal = normalizedTags.some((tag) => {
      const categoryId = tag?.category || this.resolveSemanticTagCategory(tag) || null;
      return categoryId === 'animal' && Number(tag?.confidence || 0) >= 0.46;
    });
    const hasAnyPeople = normalizedTags.some((tag) => {
      const categoryId = tag?.category || this.resolveSemanticTagCategory(tag) || null;
      return categoryId === 'people';
    });
    const peopleAnalysis = result?.people_analysis || result?.peopleAnalysis || null;
    const faceCount = Number.isFinite(peopleAnalysis?.face_count) ? Number(peopleAnalysis.face_count) : 0;
    const bodyCount = Number.isFinite(peopleAnalysis?.body_count) ? Number(peopleAnalysis.body_count) : 0;
    const detectorSource = String(peopleAnalysis?.source || '');
    const weakBodyOnlyPeople = detectorSource === 'opencv_body' && faceCount === 0 && bodyCount > 0;

    const lowConfidence = topConfidence < 0.4 || highConfidenceTagCount < 3 || normalizedTags.length <= 4;
    const animalPeopleConflict = hasStrongAnimal && hasAnyPeople && faceCount === 0;
    return lowConfidence || weakBodyOnlyPeople || animalPeopleConflict;
  }

  buildOcrDerivedTags(ocrKeywords = []) {
    const snippets = Array.isArray(ocrKeywords) ? ocrKeywords : [];
    const candidates = [];
    for (const snippet of snippets) {
      const rawSnippet = String(snippet || '').trim();
      if (!rawSnippet) {
        continue;
      }
      const parts = rawSnippet.split(/[,\s，。；;、|/]+/g).map((item) => item.trim()).filter(Boolean);
      candidates.push(rawSnippet, ...parts);
    }

    const seen = new Set();
    const tags = [];
    for (const raw of candidates) {
      const token = this.normalizeTagName(raw);
      if (!token || seen.has(token)) {
        continue;
      }
      seen.add(token);

      if (token.length < 2 || token.length > 16) {
        continue;
      }
      if (OCR_STOPWORDS.has(token.toLowerCase())) {
        continue;
      }
      if (/^\d+$/.test(token)) {
        continue;
      }

      const resolvedCategory = this.resolveSemanticTagCategory({ name: token });
      if (resolvedCategory === 'location') {
        tags.push({
          name: token,
          confidence: 0.48,
          source: 'ai_ocr',
          category: 'location',
        });
      } else if (OCR_LOCATION_HINT_PATTERN.test(token)) {
        tags.push({
          name: token,
          confidence: 0.43,
          source: 'ai_ocr',
          category: 'location',
        });
      }

      if (tags.length >= 4) {
        break;
      }
    }

    return tags;
  }

  applyCloudPeopleDecision(tags = [], peopleDecision = null) {
    const normalizedTags = this.mergeDerivedAITags(tags);
    const byName = new Map(normalizedTags.map((tag) => [this.normalizeTagName(tag?.name), tag]).filter(([name]) => name));
    const hasPeople = Boolean(peopleDecision?.hasPeople);
    const confidence = Number.isFinite(Number(peopleDecision?.confidence)) ? Number(peopleDecision.confidence) : 0;
    const rawCount = String(peopleDecision?.count || '').trim().toLowerCase();

    if (confidence < 0.62) {
      return normalizedTags;
    }

    if (!hasPeople || rawCount === 'none' || rawCount === 'no_people') {
      byName.delete('人物');
      byName.delete('单人');
      byName.delete('多人');
      return Array.from(byName.values()).sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    }

    const resolvedCount = ['single', 'one', '1'].includes(rawCount)
      ? '单人'
      : ['multi', 'multiple', 'group', 'many', '2+'].includes(rawCount)
        ? '多人'
        : null;

    const personConfidence = Math.max(confidence * 0.86, Number(byName.get('人物')?.confidence || 0), 0.72);
    byName.set('人物', {
      ...(byName.get('人物') || {}),
      name: '人物',
      confidence: personConfidence,
      source: 'deepseek_review',
      category: 'people',
    });

    if (resolvedCount) {
      byName.set(resolvedCount, {
        ...(byName.get(resolvedCount) || {}),
        name: resolvedCount,
        confidence: Math.max(confidence * 0.83, Number(byName.get(resolvedCount)?.confidence || 0), 0.66),
        source: 'deepseek_review',
        category: 'people',
      });
      if (resolvedCount === '单人') {
        byName.delete('多人');
      } else {
        byName.delete('单人');
      }
    }

    return Array.from(byName.values()).sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  }

  async enhanceSemanticTagsWithCloud({ task, result, semanticTags = [] }) {
    if (!this.shouldUseCloudTagEnhancement(task, semanticTags, result)) {
      return {
        applied: false,
        tags: Array.isArray(semanticTags) ? semanticTags : [],
      };
    }

    try {
      const reviewImagePath = this.resolveReviewImagePath(task);
      const cloudResult = await this.deepseekReviewer.extractImageStructuredTags({
        imagePath: reviewImagePath,
        filename: task?.filename || path.basename(task?.path || ''),
        folder: task?.folder || path.basename(path.dirname(task?.path || '')),
        existingTags: this.serializeReviewTags(semanticTags).map((tag) => tag.name),
        intentHints: this.extractSemanticKeywords(`${task?.filename || ''} ${task?.folder || ''}`),
      });

      if (!cloudResult) {
        return {
          applied: false,
          tags: Array.isArray(semanticTags) ? semanticTags : [],
        };
      }

      const structuredTags = (Array.isArray(cloudResult.tags) ? cloudResult.tags : [])
        .map((tag) => {
          const name = this.normalizeTagName(tag?.name);
          if (!name) {
            return null;
          }
          const cloudCategory = this.normalizeCloudCategory(tag?.category);
          const resolvedCategory = cloudCategory || this.resolveSemanticTagCategory({ name }) || null;
          if (!resolvedCategory || !RETAINED_SEMANTIC_CATEGORIES.has(resolvedCategory)) {
            return null;
          }
          return {
            name,
            confidence: Math.max(0.26, Math.min(0.92, Number(tag?.confidence || 0.55))),
            source: 'deepseek_review',
            category: resolvedCategory,
          };
        })
        .filter(Boolean);

      const ocrTags = this.buildOcrDerivedTags(cloudResult.ocrKeywords || []);
      let merged = this.mergeDerivedAITags(semanticTags, structuredTags, ocrTags);
      merged = this.applyCloudPeopleDecision(merged, cloudResult.peopleDecision || null);

      return {
        applied: structuredTags.length > 0 || ocrTags.length > 0 || Boolean(cloudResult.peopleDecision),
        tags: merged,
        structuredTags,
        ocrTags,
        peopleDecision: cloudResult.peopleDecision || null,
      };
    } catch (error) {
      console.warn('[AIReview] Cloud semantic enhancement skipped:', error.message);
      return {
        applied: false,
        tags: Array.isArray(semanticTags) ? semanticTags : [],
      };
    }
  }

  buildAuxiliaryDimensionTags(result, semanticTags) {
    const weatherResult = result?.weather || null;
    const peopleAnalysis = result?.people_analysis || result?.peopleAnalysis || null;
    return this.mergeDerivedAITags(
      this.buildWeatherDimensionTags(weatherResult, semanticTags),
      this.buildPeopleDimensionTags(peopleAnalysis, semanticTags)
    );
  }

  async reviewAndFinalizeAITags({ task, result, semanticTags = [], finalTags = [] }) {
    const locallyResolved = this.applyLocalDimensionGuards(result, semanticTags, finalTags, task);
    if (!this.shouldUseCloudDimensionReview(result, semanticTags, finalTags, locallyResolved)) {
      return this.filterRetainedAITags(locallyResolved);
    }

    try {
      const reviewImagePath = this.resolveReviewImagePath(task);
      const review = await this.deepseekReviewer.reviewDimensions({
        imagePath: reviewImagePath,
        filename: task?.filename || path.basename(task?.path || ''),
        folder: task?.folder || path.basename(path.dirname(task?.path || '')),
        peopleAnalysis: result?.people_analysis || result?.peopleAnalysis || null,
        semanticTags: this.serializeReviewTags(semanticTags),
        finalTags: this.serializeReviewTags(locallyResolved),
        riskFlags: this.buildCloudReviewRiskFlags(result, semanticTags, locallyResolved)
      });

      if (!review) {
        return locallyResolved;
      }

      return this.filterRetainedAITags(this.applyCloudDimensionReview(locallyResolved, review, finalTags));
    } catch (error) {
      console.warn('[AIReview] DeepSeek dimension review skipped:', error.message);
      return this.filterRetainedAITags(locallyResolved);
    }
  }

  serializeReviewTags(tags = []) {
    return (Array.isArray(tags) ? tags : [])
      .map((tag) => ({
        name: this.normalizeTagName(tag?.name),
        confidence: typeof tag?.confidence === 'number' ? Number(tag.confidence.toFixed(3)) : 0,
        source: tag?.source || 'ai',
        category: tag?.category || this.resolveSemanticTagCategory(tag) || null
      }))
      .filter((tag) => tag.name);
  }

  buildCloudReviewRiskFlags(result, semanticTags = [], finalTags = []) {
    const riskFlags = [];
    const names = new Set(finalTags.map((tag) => this.normalizeTagName(tag?.name)).filter(Boolean));
    const peopleAnalysis = result?.people_analysis || result?.peopleAnalysis || null;
    const faceCount = Number.isFinite(peopleAnalysis?.face_count) ? Number(peopleAnalysis.face_count) : 0;
    const bodyCount = Number.isFinite(peopleAnalysis?.body_count) ? Number(peopleAnalysis.body_count) : 0;
    const detectorSource = peopleAnalysis?.source || 'people_detector';

    if (detectorSource === 'opencv_body' && faceCount === 0 && bodyCount > 0) {
      riskFlags.push('body_only_person_detection');
    }
    if (names.has('纯风景') && (names.has('人物') || names.has('单人') || names.has('多人'))) {
      riskFlags.push('dimension_conflict_people_vs_pure_scenery');
    }
    if (this.hasArchitectureEvidence(finalTags) && (names.has('人物') || names.has('单人') || names.has('多人'))) {
      riskFlags.push('architecture_with_people_labels');
    }
    if (!this.hasStrongSemanticPeopleEvidence(semanticTags) && (names.has('单人') || names.has('多人'))) {
      riskFlags.push('count_label_without_strong_people_semantics');
    }
    const hasStrongAnimal = (Array.isArray(finalTags) ? finalTags : []).some((tag) => {
      const categoryId = tag?.category || this.resolveSemanticTagCategory(tag) || null;
      return categoryId === 'animal' && Number(tag?.confidence || 0) >= 0.46;
    });
    if (hasStrongAnimal && (names.has('人物') || names.has('单人') || names.has('多人')) && faceCount === 0) {
      riskFlags.push('animal_scene_with_people_dimension_conflict');
    }

    return riskFlags;
  }

  resolveReviewImagePath(task) {
    const thumbnailPath = String(task?.thumbnail_path || '').trim();
    if (thumbnailPath && require('fs').existsSync(thumbnailPath)) {
      return thumbnailPath;
    }

    const imageId = Number(task?.image_id);
    if (imageId > 0) {
      try {
        const row = this.db.db.prepare(`
          SELECT thumbnail_path
          FROM images
          WHERE id = ?
          LIMIT 1
        `).get(imageId);
        const dbThumbnailPath = String(row?.thumbnail_path || '').trim();
        if (dbThumbnailPath && require('fs').existsSync(dbThumbnailPath)) {
          return dbThumbnailPath;
        }
      } catch (error) {
        console.warn('[AIReview] Failed to resolve thumbnail for cloud review:', error.message);
      }
    }

    return this.resolveAvailableImagePath(task);
  }

  resolveAITagInputPath(task) {
    return this.resolveAvailableImagePath(task);
  }

  resolveAvailableImagePath(imageLike) {
    const candidates = [
      imageLike?.current_path,
      imageLike?.path,
      imageLike?.thumbnail_path,
    ].map((value) => String(value || '').trim()).filter(Boolean);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return '';
  }

  filterRetainedAITags(tags = []) {
    const normalizedByName = new Map();

    for (const tag of Array.isArray(tags) ? tags : []) {
      const name = this.normalizeTagName(tag?.name);
      if (!name) {
        continue;
      }

      const categoryId = tag?.category || this.resolveSemanticTagCategory({ ...tag, name }) || null;
      if (!categoryId || !RETAINED_SEMANTIC_CATEGORIES.has(categoryId)) {
        continue;
      }

      if (AI_GENERIC_BLOCKLIST.has(name)) {
        continue;
      }

      if (OBJECTIVE_PHOTOGRAPHY_TAGS.has(name) && tag?.source !== 'ai_photo_rule') {
        continue;
      }

      const normalizedTag = {
        ...tag,
        name,
        category: categoryId,
        confidence: Number(tag?.confidence || 0),
      };

      const existing = normalizedByName.get(name);
      if (!existing || normalizedTag.confidence >= existing.confidence) {
        normalizedByName.set(name, normalizedTag);
      }
    }

    const bucketed = new Map();

    for (const tag of normalizedByName.values()) {
      const categoryId = tag.category;
      const name = tag.name;
      const floor = RETAINED_CATEGORY_FLOORS[categoryId] ?? 0.28;
      const isPromotedScene = categoryId === 'scene' && RETAINED_SCENE_TAGS.has(name);
      const isPromotedPeople = categoryId === 'people' && (RETAINED_PEOPLE_TAGS.has(name) || name === '人物');
      const isPromotedSource = PROMOTED_AI_SOURCES.has(tag.source);
      const requiredConfidence = (isPromotedScene || isPromotedPeople || isPromotedSource)
        ? Math.max(0.18, floor - 0.06)
        : floor;

      if (tag.confidence < requiredConfidence) {
        continue;
      }

      if (!bucketed.has(categoryId)) {
        bucketed.set(categoryId, []);
      }
      bucketed.get(categoryId).push(tag);
    }

    const retained = [];
    for (const [categoryId, items] of bucketed.entries()) {
      const limit = RETAINED_CATEGORY_LIMITS[categoryId] || 4;
      retained.push(
        ...items
          .sort((left, right) => {
            if ((right.confidence || 0) !== (left.confidence || 0)) {
              return (right.confidence || 0) - (left.confidence || 0);
            }
            return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN');
          })
          .slice(0, limit)
      );
    }

    return retained.sort((left, right) => {
      if ((right.confidence || 0) !== (left.confidence || 0)) {
        return (right.confidence || 0) - (left.confidence || 0);
      }
      return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN');
    });
  }

  shouldUseCloudDimensionReview(result, semanticTags = [], originalTags = [], resolvedTags = []) {
    if (
      !this.deepseekReviewer
      || typeof this.deepseekReviewer.isEnabled !== 'function'
      || !this.deepseekReviewer.isEnabled()
      || typeof this.deepseekReviewer.reviewDimensions !== 'function'
    ) {
      return false;
    }

    const originalRiskCount = this.buildCloudReviewRiskFlags(result, semanticTags, originalTags).length;
    const resolvedRiskCount = this.buildCloudReviewRiskFlags(result, semanticTags, resolvedTags).length;
    return originalRiskCount > 0 || resolvedRiskCount > 0;
  }

  addOrReplaceDerivedTag(byName, tag) {
    if (!tag?.name) {
      return;
    }
    const existing = byName.get(tag.name);
    if (!existing || (tag.confidence || 0) >= (existing.confidence || 0)) {
      byName.set(tag.name, tag);
    }
  }

  hasSunnyWeatherHints(tags = []) {
    const names = this.collectSemanticNames(tags);
    return Array.from(names).some((name) => SUNNY_WEATHER_HINT_TAGS.has(name));
  }

  hasCloudyWeatherHints(tags = []) {
    const names = this.collectSemanticNames(tags);
    return Array.from(names).some((name) => CLOUDY_WEATHER_HINT_TAGS.has(name) || WEATHER_SKIP_TAGS.has(name));
  }

  inferRequiredWeatherName(weatherResult, semanticTags = [], finalTags = []) {
    const explicitWeather = this.normalizeTagName(weatherResult?.label);
    return WEATHER_TAGS.has(explicitWeather) ? explicitWeather : null;
  }

  inferRequiredPeopleCountTag(peopleAnalysis, semanticTags = [], finalTags = []) {
    const faceCount = Number.isFinite(peopleAnalysis?.face_count) ? Number(peopleAnalysis.face_count) : 0;
    const bodyCount = Number.isFinite(peopleAnalysis?.body_count) ? Number(peopleAnalysis.body_count) : 0;
    const detectorLabel = this.normalizeTagName(peopleAnalysis?.label);
    const mergedNames = new Set([
      ...Array.from(this.collectSemanticNames(semanticTags)),
      ...Array.from(this.collectSemanticNames(finalTags)),
    ]);
    const hasHardMultiPersonHint = Array.from(mergedNames).some((name) => HARD_MULTI_PERSON_HINT_TAGS.has(name));
    const hasAnyMultiPersonHint = Array.from(mergedNames).some((name) => MULTI_PERSON_HINT_TAGS.has(name));

    // Prefer a clear single-face portrait over soft crowd hints from background passersby.
    if (faceCount === 1 && detectorLabel !== '多人' && !hasHardMultiPersonHint) {
      return '单人';
    }

    if (detectorLabel === '多人' || faceCount >= 2 || bodyCount >= 2) {
      return '多人';
    }
    if (hasAnyMultiPersonHint) {
      return '多人';
    }
    return '单人';
  }

  inferRequiredSeasonName(tags = [], task = {}) {
    const seasonTags = tags
      .filter((tag) => {
        const categoryId = tag?.category || this.getAITagDefinition(tag?.name)?.categoryId || this.getExistingTagRecord(tag?.name)?.category_id;
        return categoryId === 'scene' && SEASON_TAGS.has(tag.name);
      })
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    const supportedSeason = this.getSupportedSeasonName(seasonTags, task, tags);
    if (supportedSeason) {
      return supportedSeason;
    }

    const hintKeywords = new Set(this.extractSemanticKeywords(`${task?.filename || ''} ${task?.folder || ''}`));
    for (const seasonName of SEASON_TAGS) {
      if (hintKeywords.has(seasonName)) {
        return seasonName;
      }
    }

    const presentNames = new Set(tags.map((tag) => this.normalizeTagName(tag?.name)).filter(Boolean));
    const hasStrongSpringEvidence = (
      presentNames.has('花海')
      || presentNames.has('花田')
      || presentNames.has('樱花')
      || presentNames.has('桃花')
      || presentNames.has('油菜花')
      || hintKeywords.has('春天')
    );
    const hasStrongWinterEvidence = (
      presentNames.has('雪景')
      || presentNames.has('雪山')
      || presentNames.has('雪天')
      || seasonTags.some((tag) => tag.name === '冬天' && (tag.confidence || 0) >= 0.72)
    );

    if (hasStrongSpringEvidence && !hasStrongWinterEvidence) {
      return '春天';
    }

    const scoredSeasons = Array.from(SEASON_TAGS).map((seasonName) => {
      let score = 0;
      const explicitTag = seasonTags.find((tag) => tag.name === seasonName);
      if (explicitTag) {
        score += explicitTag.confidence || 0;
      }

      const supportTags = SEASON_SUPPORT_TAGS.get(seasonName) || new Set();
      for (const supportTag of supportTags) {
        if (presentNames.has(supportTag) || hintKeywords.has(supportTag)) {
          score += 0.22;
        }
      }

      if (seasonName === '冬天' && (presentNames.has('雪景') || presentNames.has('雪山') || presentNames.has('雪天'))) {
        score += 0.24;
      }
      if (seasonName === '夏天' && (presentNames.has('晴天') || presentNames.has('热气球'))) {
        score += 0.16;
      }
      return { seasonName, score };
    }).sort((a, b) => b.score - a.score);

    if ((scoredSeasons[0]?.score || 0) > 0) {
      return scoredSeasons[0].seasonName;
    }

    if (seasonTags[0]?.name) {
      return seasonTags[0].name;
    }

    return '春天';
  }

  applyLocalDimensionGuards(result, semanticTags = [], finalTags = [], task = null) {
    const normalized = this.mergeDerivedAITags(finalTags);
    const byName = new Map(normalized.map((tag) => [tag.name, tag]));
    const peopleAnalysis = result?.people_analysis || result?.peopleAnalysis || null;
    const faceCount = Number.isFinite(peopleAnalysis?.face_count) ? Number(peopleAnalysis.face_count) : 0;
    const bodyCount = Number.isFinite(peopleAnalysis?.body_count) ? Number(peopleAnalysis.body_count) : 0;
    const detectorSource = peopleAnalysis?.source || 'people_detector';
    const semanticNames = this.collectSemanticNames(semanticTags);
    const hasStrongMultiPersonHint = Array.from(semanticNames).some((name) => MULTI_PERSON_HINT_TAGS.has(name));
    const hasHardMultiPersonHint = Array.from(semanticNames).some((name) => HARD_MULTI_PERSON_HINT_TAGS.has(name));
    const hasStrongSinglePersonHint = Array.from(semanticNames).some((name) => SINGLE_PERSON_HINT_TAGS.has(name));
    const hasStrongSemanticPeopleEvidence = this.hasStrongSemanticPeopleEvidence(semanticTags);
    const hasArchitectureEvidence = this.hasArchitectureEvidence(normalized);
    const hasAnyPeopleDimension = () => byName.has('人物') || byName.has('单人') || byName.has('多人');
    const strongPeopleDimensionInFinal = ['人物', '单人', '多人']
      .map((name) => byName.get(name))
      .some((tag) => (tag?.confidence || 0) >= 0.44);
    const detectorLabel = this.normalizeTagName(peopleAnalysis?.label);
    const hasReliableDetectorEvidence = faceCount > 0
      || (detectorSource !== 'opencv_body' && bodyCount >= 1)
      || (detectorSource !== 'opencv_body' && PEOPLE_COUNT_TAGS.has(detectorLabel));
    const hasPeopleEvidence = hasStrongSemanticPeopleEvidence
      || hasStrongMultiPersonHint
      || hasStrongSinglePersonHint
      || hasReliableDetectorEvidence
      || strongPeopleDimensionInFinal;
    const bodyOnlyDetector = detectorSource === 'opencv_body' && faceCount === 0 && bodyCount > 0;
    const weakBodyOnlyPeople = bodyOnlyDetector
      && !hasStrongSemanticPeopleEvidence
      && !hasStrongMultiPersonHint
      && !hasStrongSinglePersonHint;

    if (weakBodyOnlyPeople || (bodyOnlyDetector && hasArchitectureEvidence && !hasStrongMultiPersonHint && !hasStrongSinglePersonHint)) {
      byName.delete('人物');
      byName.delete('单人');
      byName.delete('多人');
    }

    const hasBlockingSceneryTag = Array.from(byName.values()).some((tag) => {
      const categoryId = tag?.category || this.resolveSemanticTagCategory(tag) || null;
      if (tag?.name === '纯风景') {
        return false;
      }
      if (categoryId === 'people') {
        return hasStrongSemanticPeopleEvidence || faceCount > 0 || hasStrongMultiPersonHint || hasStrongSinglePersonHint;
      }
      return PURE_SCENERY_BLOCKING_CATEGORIES.has(categoryId);
    });

    if (hasBlockingSceneryTag) {
      byName.delete('纯风景');
    }

    if (byName.has('纯风景') && hasAnyPeopleDimension()) {
      if (faceCount > 0 || hasStrongSemanticPeopleEvidence || hasStrongMultiPersonHint || hasStrongSinglePersonHint) {
        byName.delete('纯风景');
      } else {
        byName.delete('人物');
        byName.delete('单人');
        byName.delete('多人');
      }
    }

    if (!byName.has('人物')) {
      byName.delete('单人');
      byName.delete('多人');
    }

    if (byName.has('单人') && byName.has('多人')) {
      if (faceCount >= 2 || hasHardMultiPersonHint) {
        byName.delete('单人');
      } else {
        byName.delete('多人');
      }
    }

    const shouldForcePureScenery = !byName.has('纯风景')
      && !hasStrongSemanticPeopleEvidence
      && !hasStrongMultiPersonHint
      && !hasStrongSinglePersonHint
      && faceCount === 0
      && bodyCount === 0
      && this.hasPureSceneryEvidence([...semanticTags, ...Array.from(byName.values())]);

    if (shouldForcePureScenery) {
      this.addOrReplaceDerivedTag(byName, {
        name: '纯风景',
        confidence: 0.92,
        source: 'ai_semantic_floor',
        category: 'scene'
      });
    }

    const shouldForcePeopleDimension = !byName.has('纯风景')
      && hasPeopleEvidence
      && !(weakBodyOnlyPeople || (bodyOnlyDetector && hasArchitectureEvidence && !hasStrongMultiPersonHint && !hasStrongSinglePersonHint));

    if (byName.has('纯风景')) {
      byName.delete('人物');
      byName.delete('单人');
      byName.delete('多人');
    } else if (shouldForcePeopleDimension) {
      const requiredCountName = byName.has('多人')
        ? '多人'
        : byName.has('单人')
          ? '单人'
          : this.inferRequiredPeopleCountTag(peopleAnalysis, semanticTags, Array.from(byName.values()));

      this.addOrReplaceDerivedTag(byName, {
        name: '人物',
        confidence: byName.get('人物')?.confidence || 0.72,
        source: byName.get('人物')?.source || 'ai_semantic_floor',
        category: 'people'
      });
      this.addOrReplaceDerivedTag(byName, {
        name: requiredCountName,
        confidence: byName.get(requiredCountName)?.confidence || 0.68,
        source: byName.get(requiredCountName)?.source || 'ai_semantic_floor',
        category: 'people'
      });
      if (requiredCountName === '单人') {
        byName.delete('多人');
      } else {
        byName.delete('单人');
      }
    } else {
      byName.delete('人物');
      byName.delete('单人');
      byName.delete('多人');
    }

    const requiredSeasonName = this.inferRequiredSeasonName([
      ...semanticTags,
      ...Array.from(byName.values())
    ], task || {});
    for (const seasonName of Array.from(byName.keys()).filter((name) => SEASON_TAGS.has(name))) {
      if (seasonName !== requiredSeasonName) {
        byName.delete(seasonName);
      }
    }

    return Array.from(byName.values()).sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  }

  hasStrongSemanticPeopleEvidence(tags = []) {
    const semanticTags = Array.isArray(tags) ? tags : [];
    const explicitPeopleTags = semanticTags.filter((tag) => {
      const name = this.normalizeTagName(tag?.name);
      const categoryId = tag?.category || this.resolveSemanticTagCategory(tag) || null;
      if (categoryId !== 'people') {
        return false;
      }
      if (name === PERSON_TAG) {
        return false;
      }
      return (tag?.confidence || 0) >= 0.34;
    });

    if (explicitPeopleTags.length > 0) {
      return true;
    }

    const semanticNames = this.collectSemanticNames(semanticTags);
    return Array.from(semanticNames).some((name) => MULTI_PERSON_HINT_TAGS.has(name) || SINGLE_PERSON_HINT_TAGS.has(name));
  }

  hasArchitectureEvidence(tags = []) {
    return (Array.isArray(tags) ? tags : []).some((tag) => {
      const name = this.normalizeTagName(tag?.name);
      if (!name) {
        return false;
      }
      const confidence = typeof tag?.confidence === 'number' ? tag.confidence : 0;
      if (confidence < 0.28) {
        return false;
      }
      return ARCHITECTURE_SCENE_TAGS.has(name) || LANDMARK_LOCATION_TAGS.has(name);
    });
  }

  applyCloudDimensionReview(finalTags = [], review = null, originalTags = []) {
    if (!review || !Array.isArray(review.keepDimensionTags)) {
      return finalTags;
    }

    const originalByName = new Map(
      this.mergeDerivedAITags(originalTags)
        .filter((tag) => DIMENSION_REVIEW_TAGS.has(this.normalizeTagName(tag?.name)))
        .map((tag) => [this.normalizeTagName(tag?.name), tag])
    );

    const keepSet = new Set(
      review.keepDimensionTags
        .map((name) => this.normalizeTagName(name))
        .filter((name) => DIMENSION_REVIEW_TAGS.has(name))
    );

    if (keepSet.has('单人') || keepSet.has('多人')) {
      keepSet.add('人物');
    }
    if (keepSet.has('纯风景')) {
      keepSet.delete('人物');
      keepSet.delete('单人');
      keepSet.delete('多人');
    }

    const kept = finalTags.filter((tag) => {
      const name = this.normalizeTagName(tag?.name);
      if (!DIMENSION_REVIEW_TAGS.has(name)) {
        return true;
      }
      return keepSet.has(name);
    });

    for (const name of keepSet) {
      if (!kept.some((tag) => this.normalizeTagName(tag?.name) === name) && originalByName.has(name)) {
        kept.push(originalByName.get(name));
      }
    }

    return kept.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  }

  collectSemanticNames(semanticTags = []) {
    return new Set(
      (Array.isArray(semanticTags) ? semanticTags : [])
        .map((tag) => this.normalizeTagName(tag?.name))
        .filter(Boolean)
    );
  }

  getSemanticCategory(name) {
    return this.resolveSemanticTagCategory({ name });
  }

  hasPureSceneryEvidence(semanticTags = []) {
    const semanticNames = this.collectSemanticNames(semanticTags);
    if (semanticNames.size === 0) {
      return false;
    }

    for (const name of semanticNames) {
      if (PURE_SCENERY_BLOCKING_CATEGORIES.has(this.getSemanticCategory(name))) {
        return false;
      }
    }

    let scenicSupportCount = 0;
    for (const name of semanticNames) {
      if (PURE_SCENERY_SUPPORT_TAGS.has(name)) {
        scenicSupportCount += 1;
      }
    }

    const hasWideScene = Array.from(semanticNames).some((name) => WIDE_SCENE_TAGS.has(name));
    const hasWeatherScene = Array.from(semanticNames).some((name) => WEATHER_TAGS.has(name));
    return scenicSupportCount >= 2 || (hasWideScene && hasWeatherScene);
  }

  getSupportedSeasonName(seasonTags = [], task = {}, allTags = []) {
    const hintKeywords = new Set(this.extractSemanticKeywords(`${task?.filename || ''} ${task?.folder || ''}`));
    const hintedSeason = seasonTags.find((tag) => hintKeywords.has(tag.name));
    if (hintedSeason) {
      return hintedSeason.name;
    }

    const presentNames = new Set((Array.isArray(allTags) ? allTags : []).map((tag) => this.normalizeTagName(tag?.name)).filter(Boolean));
    const sortedSeasonTags = [...seasonTags].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const strongest = sortedSeasonTags[0] || null;
    const secondStrongest = sortedSeasonTags[1] || null;
    if (!strongest) {
      return null;
    }

    const minConfidence = SEASON_MIN_CONFIDENCE.get(strongest.name) || 0.36;
    const confidenceGap = (strongest.confidence || 0) - (secondStrongest?.confidence || 0);
    const supportTags = SEASON_SUPPORT_TAGS.get(strongest.name) || new Set();
    const hasSupport = Array.from(supportTags).some((name) => presentNames.has(name) || hintKeywords.has(name));

    if ((strongest.confidence || 0) < minConfidence) {
      return null;
    }

    if (strongest.name !== '冬天' && confidenceGap < 0.08) {
      return null;
    }

    if (!hasSupport) {
      return null;
    }

    return strongest.name;
  }

  buildWeatherDimensionTags(weatherResult, semanticTags = []) {
    if (!weatherResult || !WEATHER_TAGS.has(weatherResult.label)) {
      return [];
    }

    const semanticNames = this.collectSemanticNames(semanticTags);
    if (Array.from(semanticNames).some((name) => WEATHER_SKIP_TAGS.has(name))) {
      return [];
    }

    const confidence = typeof weatherResult.confidence === 'number' ? weatherResult.confidence : 0;
    const margin = typeof weatherResult.margin === 'number' ? weatherResult.margin : 0;
    if (confidence < 0.22 || margin < 0.03) {
      return [];
    }

    const resolvedWeatherName = this.normalizeTagName(weatherResult?.label);
    if (!WEATHER_TAGS.has(resolvedWeatherName)) {
      return [];
    }

    return [{
      name: resolvedWeatherName,
      confidence,
      source: weatherResult.source || 'ai_weather',
      category: 'scene'
    }];
  }

  buildPeopleDimensionTags(peopleAnalysis, semanticTags = []) {
    const faceCount = Number.isFinite(peopleAnalysis?.face_count) ? Number(peopleAnalysis.face_count) : null;
    const bodyCount = Number.isFinite(peopleAnalysis?.body_count) ? Number(peopleAnalysis.body_count) : null;
    const detectorCounts = [faceCount, bodyCount].filter((value) => value !== null);
    const detectorCount = detectorCounts.length > 0 ? Math.max(...detectorCounts) : null;
    const detectorLabel = this.normalizeTagName(peopleAnalysis?.label);
    const detectorSource = peopleAnalysis?.source || 'people_detector';
    const semanticNames = this.collectSemanticNames(semanticTags);
    const hasStrongMultiPersonHint = Array.from(semanticNames).some((name) => MULTI_PERSON_HINT_TAGS.has(name));
    const hasHardMultiPersonHint = Array.from(semanticNames).some((name) => HARD_MULTI_PERSON_HINT_TAGS.has(name));
    const hasStrongSinglePersonHint = Array.from(semanticNames).some((name) => SINGLE_PERSON_HINT_TAGS.has(name));
    const hasSemanticPeople = Array.from(semanticNames).some((name) => {
      const categoryId = this.resolveSemanticTagCategory({ name });
      return categoryId === 'people' || name === PERSON_TAG || PEOPLE_COUNT_TAGS.has(name);
    });
    const hasStrongSemanticPeopleEvidence = this.hasStrongSemanticPeopleEvidence(semanticTags);
    const output = [];
    const resolvedDetectorLabel = detectorLabel === '单人' && hasHardMultiPersonHint ? '多人' : detectorLabel;

    if (resolvedDetectorLabel === '多人' && detectorSource === 'opencv_body' && !hasStrongMultiPersonHint) {
      if (hasStrongSinglePersonHint) {
        const portraitFallback = [{
          name: PERSON_TAG,
          confidence: 0.88,
          source: 'ai_people_hint',
          category: 'people'
        }];
        if (Number.isFinite(bodyCount) && bodyCount >= 3) {
          portraitFallback.push({
            name: '单人',
            confidence: 0.8,
            source: 'ai_people_hint',
            category: 'people'
          });
        }
        return portraitFallback;
      }
      return [{
        name: PERSON_TAG,
        confidence: 0.84,
        source: detectorSource,
        category: 'people'
      }];
    }

    if (PEOPLE_COUNT_TAGS.has(resolvedDetectorLabel)) {
      if (detectorSource === 'opencv_body' && (faceCount === null || faceCount === 0)) {
        if (resolvedDetectorLabel === '多人' && !hasStrongMultiPersonHint) {
          return hasStrongSemanticPeopleEvidence ? [{
            name: PERSON_TAG,
            confidence: 0.78,
            source: 'ai_people_hint',
            category: 'people'
          }] : [];
        }

        if (resolvedDetectorLabel === '单人' && !hasStrongSinglePersonHint && !hasStrongSemanticPeopleEvidence) {
          return [];
        }
      }

      output.push({
        name: PERSON_TAG,
        confidence: 0.94,
        source: detectorSource,
        category: 'people'
      });
      output.push({
        name: resolvedDetectorLabel,
        confidence: resolvedDetectorLabel === '\u591a\u4eba' ? 0.96 : 0.93,
        source: hasStrongMultiPersonHint ? 'ai_people_hint' : detectorSource,
        category: 'people'
      });
      return output;
    }

    if (detectorCount === 1 && hasHardMultiPersonHint) {
      return [{
        name: PERSON_TAG,
        confidence: 0.94,
        source: 'ai_people_hint',
        category: 'people'
      }, {
        name: '多人',
        confidence: 0.95,
        source: 'ai_people_hint',
        category: 'people'
      }];
    }

    if (detectorCount === 1) {
      if (detectorSource === 'opencv_body' && !hasStrongSinglePersonHint && !hasStrongMultiPersonHint && !hasStrongSemanticPeopleEvidence) {
        return [];
      }
      return [{
        name: PERSON_TAG,
        confidence: 0.83,
        source: detectorSource,
        category: 'people'
      }, {
        name: '单人',
        confidence: 0.91,
        source: detectorSource,
        category: 'people'
      }];
    }

    if (detectorCount === 0) {
      if (hasSemanticPeople) {
        return [{
          name: PERSON_TAG,
          confidence: 0.72,
          source: detectorSource,
          category: 'people'
        }];
      }

      if (!this.hasPureSceneryEvidence(semanticTags)) {
        return [];
      }

      return [{
        name: PURE_SCENERY_TAG,
        confidence: 0.92,
        source: detectorSource,
        category: 'scene'
      }];
    }

    if (hasSemanticPeople) {
      return [{
        name: PERSON_TAG,
        confidence: 0.7,
        source: peopleAnalysis?.source || 'ai_people_hint',
        category: 'people'
      }];
    }

    return [];
  }

  mergeDerivedAITags(...groups) {
    const byName = new Map();
    for (const group of groups) {
      for (const tag of Array.isArray(group) ? group : []) {
        const name = this.normalizeTagName(tag?.name);
        if (!name) continue;
        const confidence = typeof tag.confidence === 'number' ? tag.confidence : 0;
        const existing = byName.get(name);
        if (!existing || confidence > (existing.confidence || 0)) {
          byName.set(name, {
            ...tag,
            name,
            category: tag?.category || this.resolveSemanticTagCategory({ ...tag, name }) || null
          });
        }
      }
    }
    return Array.from(byName.values()).sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  }

  limitSceneCandidates(tags, task) {
    const hintKeywords = new Set(this.extractSemanticKeywords(`${task?.filename || ''} ${task?.folder || ''}`));
    const presentNames = new Set(tags.map((tag) => tag.name));

    return tags.filter((tag) => {
      const categoryId = tag?.category || this.getAITagDefinition(tag?.name)?.categoryId || this.getExistingTagRecord(tag?.name)?.category_id;
      if (categoryId !== 'scene' || !HIGH_RISK_SCENE_TAGS.has(tag.name)) {
        return true;
      }

      if (hintKeywords.has(tag.name)) {
        return true;
      }

      const minConfidence = AI_PER_TAG_THRESHOLDS[tag.name] || AI_SAVE_THRESHOLDS.scene;
      if ((tag.confidence || 0) < minConfidence) {
        return false;
      }

      const supportTags = SCENE_SUPPORT_TAGS.get(tag.name);
      if (!supportTags || supportTags.size === 0) {
        return true;
      }

      for (const supportTag of supportTags) {
        if (presentNames.has(supportTag) || hintKeywords.has(supportTag)) {
          return true;
        }
      }

      return false;
    });
  }

  limitAnimalCandidates(tags) {
    const animalTags = tags
      .filter((tag) => (tag?.category || this.getAITagDefinition(tag?.name)?.categoryId || this.getExistingTagRecord(tag?.name)?.category_id) === 'animal')
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    if (animalTags.length <= 1) {
      return tags;
    }

    const primaryAnimal = animalTags[0]?.name;
    const allowedCompanions = ANIMAL_FAMILY_COMPANIONS.get(primaryAnimal) || new Set();
    return tags.filter((tag) => {
      const categoryId = tag?.category || this.getAITagDefinition(tag?.name)?.categoryId || this.getExistingTagRecord(tag?.name)?.category_id;
      if (categoryId !== 'animal') {
        return true;
      }
      return tag.name === primaryAnimal || allowedCompanions.has(tag.name);
    });
  }

  limitSeasonCandidates(tags, task) {
    const seasonTags = tags
      .filter((tag) => {
        const categoryId = tag?.category || this.getAITagDefinition(tag?.name)?.categoryId || this.getExistingTagRecord(tag?.name)?.category_id;
        return categoryId === 'scene' && SEASON_TAGS.has(tag.name);
      })
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    const winnerName = this.inferRequiredSeasonName(tags, task);
    const filteredTags = tags.filter((tag) => {
      const categoryId = tag?.category || this.getAITagDefinition(tag?.name)?.categoryId || this.getExistingTagRecord(tag?.name)?.category_id;
      if (categoryId !== 'scene' || !SEASON_TAGS.has(tag.name)) {
        return true;
      }
      return tag.name === winnerName;
    });

    if (!winnerName || filteredTags.some((tag) => tag.name === winnerName)) {
      return filteredTags;
    }
    return filteredTags;
  }

  limitLocationCandidates(tags, task) {
    const locationTags = tags
      .filter((tag) => (tag?.category || this.getAITagDefinition(tag?.name)?.categoryId || this.getExistingTagRecord(tag?.name)?.category_id) === 'location')
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    if (locationTags.length === 0) {
      return tags;
    }

    const filename = task?.filename || '';
    const folder = task?.folder || '';
    const hintKeywords = new Set(this.extractSemanticKeywords(`${filename} ${folder}`));
    const strongest = locationTags[0];
    const hintedLocations = locationTags.filter((tag) => hintKeywords.has(tag.name) || LOCATION_HINT_TAGS.has(tag.name) && hintKeywords.has(tag.name));
    const keepNames = new Set();

    if (hintedLocations.length > 0) {
      hintedLocations
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
        .slice(0, 2)
        .forEach((tag) => keepNames.add(tag.name));
    } else if ((strongest?.confidence || 0) >= 0.3) {
      keepNames.add(strongest.name);
    }

    return tags.filter((tag) => {
      const categoryId = tag?.category || this.getAITagDefinition(tag?.name)?.categoryId || this.getExistingTagRecord(tag?.name)?.category_id;
      if (categoryId !== 'location') {
        return true;
      }
      return keepNames.has(tag.name);
    });
  }

  limitPeopleCandidates(tags, task) {
    const hintKeywords = new Set(this.extractSemanticKeywords(`${task?.filename || ''} ${task?.folder || ''}`));
    const animalPrimary = tags
      .filter((tag) => (tag?.category || this.getAITagDefinition(tag?.name)?.categoryId || this.getExistingTagRecord(tag?.name)?.category_id) === 'animal')
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
    const hasStrongAnimalPrimary = !!animalPrimary && (animalPrimary.confidence || 0) >= 0.44;

    return tags.filter((tag) => {
      const categoryId = tag?.category || this.getAITagDefinition(tag?.name)?.categoryId || this.getExistingTagRecord(tag?.name)?.category_id;
      if (categoryId !== 'people') {
        return true;
      }
      if (PEOPLE_HINT_ONLY_TAGS.has(tag.name) && !hintKeywords.has(tag.name)) {
        return false;
      }
      if (hasStrongAnimalPrimary) {
        if (hintKeywords.has(tag.name)) {
          return true;
        }
        return (tag.confidence || 0) >= 0.56;
      }
      return hintKeywords.has(tag.name) || (tag.confidence || 0) >= 0.3;
    });
  }

  limitEventCandidates(tags, task) {
    const hintKeywords = new Set(this.extractSemanticKeywords(`${task?.filename || ''} ${task?.folder || ''}`));
    const eventTags = tags
      .filter((tag) => (tag?.category || this.getAITagDefinition(tag?.name)?.categoryId || this.getExistingTagRecord(tag?.name)?.category_id) === 'event')
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    if (eventTags.length === 0) {
      return tags;
    }

    const hintedNames = new Set(
      eventTags
        .filter((tag) => hintKeywords.has(tag.name))
        .map((tag) => tag.name)
    );
    const topEvent = eventTags[0];

    return tags.filter((tag) => {
      const categoryId = tag?.category || this.getAITagDefinition(tag?.name)?.categoryId || this.getExistingTagRecord(tag?.name)?.category_id;
      if (categoryId !== 'event') {
        return true;
      }
      if (EVENT_HINT_ONLY_TAGS.has(tag.name) && !hintKeywords.has(tag.name)) {
        return false;
      }
      if (hintedNames.size > 0) {
        return hintedNames.has(tag.name);
      }
      if ((topEvent?.confidence || 0) >= 0.28) {
        return tag.name === topEvent.name;
      }
      return (tag.confidence || 0) >= 0.28;
    });
  }

  limitConflictingEvents(tags) {
    const tagMap = new Map(tags.map((tag) => [tag.name, tag]));
    const blockedNames = new Set();

    for (const group of EVENT_CONFLICT_GROUPS) {
      const present = Array.from(group)
        .map((name) => tagMap.get(name))
        .filter(Boolean)
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

      if (present.length <= 1) {
        continue;
      }

      for (const loser of present.slice(1)) {
        blockedNames.add(loser.name);
      }
    }

    return tags.filter((tag) => !blockedNames.has(tag.name));
  }

  ensureRepresentativeTags(tags) {
    const enriched = Array.isArray(tags) ? [...tags] : [];
    const peopleTags = enriched
      .filter((tag) => (tag?.category || this.getAITagDefinition(tag?.name)?.categoryId || this.getExistingTagRecord(tag?.name)?.category_id) === 'people')
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    if (peopleTags.length > 0 && !peopleTags.some((tag) => tag.name === '人物')) {
      const leadTag = peopleTags[0];
      enriched.push({
        name: '人物',
        confidence: Math.max((leadTag?.confidence || 0) * 0.92, 0.26),
        source: leadTag?.source || 'ai',
        category: 'people',
      });
    }

    return enriched;
  }

  shouldPersistAITag(tag) {
    const name = this.normalizeTagName(tag?.name);
    if (!name) return false;
    if (AI_GENERIC_BLOCKLIST.has(name)) return false;

    const confidence = typeof tag?.confidence === 'number' ? tag.confidence : 0;
    const definition = this.getAITagDefinition(name);
    const existing = this.getExistingTagRecord(name);
    const categoryId = this.resolveSemanticTagCategory({ ...tag, name }) || 'default';
    const minConfidence = Math.max(
      AI_SAVE_THRESHOLDS[categoryId] ?? AI_SAVE_THRESHOLDS.default,
      AI_PER_TAG_THRESHOLDS[name] || 0
    );

    if (OBJECTIVE_PHOTOGRAPHY_TAGS.has(name) && tag?.source !== 'ai_photo_rule') {
      return false;
    }

    if (confidence < minConfidence) {
      return false;
    }

    if (definition) {
      return true;
    }

    if (!existing && AI_AUTO_CREATE_CATEGORY_ALLOWLIST.has(categoryId)) {
      return true;
    }

    if (!existing) {
      return false;
    }

    return existing.category_id && existing.category_id !== 'custom';
  }

  saveAITag(imageId, tag) {
    const name = this.normalizeTagName(tag?.name);
    if (!name) return;

    if (!this.shouldPersistAITag({ ...tag, name })) {
      return;
    }

    const existing = this.getExistingTagRecord(name);
    const definition = this.getAITagDefinition(name);
    const categoryId = this.resolveSemanticTagCategory({ ...tag, name });
    if (!definition && !existing && !categoryId) {
      return;
    }
    const tagId = existing?.id || this.db.addTag(
      definition?.categoryId || categoryId,
      name,
      null,
      definition?.color || null,
      'ai'
    );
    const confidence = typeof tag?.confidence === 'number' ? tag.confidence : 0.8;
    this.db.tagImage(imageId, tagId, confidence, tag?.source || 'ai');
  }

  getPersistedSemanticTagNames(imageId) {
    const rows = this.db.db.prepare(`
      SELECT t.name
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
        AND t.category_id NOT IN ('color', 'custom')
    `).all(imageId);

    return new Set(rows.map((row) => row.name));
  }

  forceSaveSemanticTag(imageId, tag) {
    const name = this.normalizeTagName(tag?.name);
    if (!name || AI_GENERIC_BLOCKLIST.has(name) || OBJECTIVE_PHOTOGRAPHY_TAGS.has(name) || HIGH_RISK_FORCE_SAVE_BLOCKLIST.has(name)) {
      return false;
    }

    const definition = this.getAITagDefinition(name);
    const existing = this.getExistingTagRecord(name);
    const categoryId = tag?.category || definition?.categoryId || existing?.category_id || null;
    if (!categoryId || categoryId === 'color' || categoryId === 'custom') {
      return false;
    }

    const tagId = existing?.id || this.db.addTag(
      definition?.categoryId || categoryId,
      name,
      null,
      definition?.color || null,
      'ai'
    );

    const confidence = Math.max(typeof tag?.confidence === 'number' ? tag.confidence : 0.3, 0.3);
    this.db.tagImage(imageId, tagId, confidence, tag?.source || 'ai_semantic_fallback');
    return true;
  }

  ensureSemanticTagCoverage(imageId, tags, minCount = 2) {
    const semanticCandidates = (Array.isArray(tags) ? tags : [])
      .map((tag) => ({
        ...tag,
        name: this.normalizeTagName(tag?.name),
        category: tag?.category || this.getAITagDefinition(tag?.name)?.categoryId || this.getExistingTagRecord(tag?.name)?.category_id || null
      }))
      .filter((tag) => tag.name && tag.category && tag.category !== 'color' && tag.category !== 'custom' && !OBJECTIVE_PHOTOGRAPHY_TAGS.has(tag.name))
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    const persistedNames = this.getPersistedSemanticTagNames(imageId);
    let count = persistedNames.size;
    const targetCount = semanticCandidates.length > 0 ? Math.max(1, minCount) : minCount;

    for (const tag of semanticCandidates) {
      if (count >= targetCount) {
        break;
      }
      if (persistedNames.has(tag.name)) {
        continue;
      }
      if (this.forceSaveSemanticTag(imageId, { ...tag, source: tag.source || 'ai_semantic_fallback' })) {
        persistedNames.add(tag.name);
        count += 1;
      }
    }

    if (count === 0 && semanticCandidates.length > 0) {
      this.forceSaveSemanticTag(imageId, {
        ...semanticCandidates[0],
        confidence: Math.max(semanticCandidates[0].confidence || 0, 0.18),
        source: semanticCandidates[0].source || 'ai_semantic_floor',
      });
    }
  }

  replaceAIColorTag(imageId, colorTag) {
    if (!colorTag?.name) return;

    const oldRows = this.db.db.prepare(`
      SELECT tag_id
      FROM image_tags
      WHERE image_id = ? AND source = 'ai_color'
    `).all(imageId);

    this.db.db.prepare(`
      DELETE FROM image_tags
      WHERE image_id = ? AND source = 'ai_color'
    `).run(imageId);

    for (const row of oldRows) {
      this.db.db.prepare(`
        UPDATE tags
        SET usage_count = MAX(0, usage_count - 1)
        WHERE id = ?
      `).run(row.tag_id);
    }

    const colorTagId = this.db.addTag('color', colorTag.name, null, colorTag.uiColor, 'ai');
    this.db.tagImage(imageId, colorTagId, 0.92, 'ai_color');
  }

  applyObjectivePhotographyTags(imageId, imageMeta = null) {
    const meta = imageMeta || this.db.db.prepare(`
      SELECT width, height
      FROM images
      WHERE id = ?
    `).get(imageId);

    const width = Number(meta?.width || 0);
    const height = Number(meta?.height || 0);
    if (!width || !height) return;

    const aspectRatio = width / height;

    this.cleanupObjectivePhotographyTags(imageId);

    if (height >= width * 1.15) {
      this.saveAITag(imageId, {
        name: '竖屏',
        confidence: 0.99,
        source: 'ai_photo_rule',
      });
    } else if (width >= height * 1.15) {
      this.saveAITag(imageId, {
        name: '横屏',
        confidence: 0.99,
        source: 'ai_photo_rule',
      });
    }

    if (aspectRatio >= 2.2) {
      this.saveAITag(imageId, {
        name: '360度全景',
        confidence: 0.97,
        source: 'ai_photo_rule',
      });
    }

    if (aspectRatio >= 1.45) {
      const tagRows = this.db.db.prepare(`
        SELECT t.name
        FROM image_tags it
        JOIN tags t ON t.id = it.tag_id
        WHERE it.image_id = ?
      `).all(imageId);
      const tagNames = new Set(tagRows.map((row) => row.name));
      const hasWideScene = Array.from(tagNames).some((name) => WIDE_SCENE_TAGS.has(name));
      if (hasWideScene) {
        this.saveAITag(imageId, {
          name: '广角震撼风光',
          confidence: 0.9,
          source: 'ai_photo_rule',
        });
      }
    }
  }

  cleanupObjectivePhotographyTags(imageId) {
    const objectivePhotoTags = ['竖屏', '横屏', '360度全景', '广角震撼风光'];
    const placeholders = objectivePhotoTags.map(() => '?').join(',');

    const rows = this.db.db.prepare(`
      SELECT it.tag_id
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
        AND it.source = 'ai_photo_rule'
        AND t.name IN (${placeholders})
    `).all(imageId, ...objectivePhotoTags);

    if (rows.length === 0) return;

    this.db.db.prepare(`
      DELETE FROM image_tags
      WHERE image_id = ?
        AND source = 'ai_photo_rule'
        AND tag_id IN (
          SELECT id FROM tags WHERE name IN (${placeholders})
        )
    `).run(imageId, ...objectivePhotoTags);

    for (const row of rows) {
      this.db.db.prepare(`
        UPDATE tags
        SET usage_count = MAX(0, usage_count - 1)
        WHERE id = ?
      `).run(row.tag_id);
    }
  }

  getPhotographicColorTag(hexColor) {
    const rgb = this.parseHexColor(hexColor);
    if (!rgb) return null;
    const { hue, saturation, lightness } = this.rgbToHsl(rgb);
    if (lightness >= 0.9) return { name: '\u96ea\u5cf0\u767d', uiColor: 'slate' };
    if (lightness >= 0.8 && saturation <= 0.16) return { name: '\u4e91\u96fe\u767d', uiColor: 'slate' };
    if (lightness <= 0.16) return { name: '\u591c\u5e55\u9ed1', uiColor: 'slate' };
    if (saturation <= 0.12) {
      if (lightness >= 0.65) return { name: '\u96fe\u972d\u7070', uiColor: 'slate' };
      if (lightness <= 0.32) return { name: '\u5ca9\u58c1\u7070', uiColor: 'slate' };
      return { name: '\u94f6\u76d0\u7070', uiColor: 'slate' };
    }
    if (hue < 18 || hue >= 345) return { name: lightness < 0.45 ? '\u971e\u5149\u7ea2' : '\u6696\u65e5\u7ea2', uiColor: 'rose' };
    if (hue < 30) return { name: lightness < 0.52 ? '\u66ae\u8272\u6a59' : '\u6668\u5149\u6a59', uiColor: 'amber' };
    if (hue < 48) return { name: saturation > 0.5 ? '\u6696\u9633\u6a59' : '\u5ca9\u58c1\u68d5', uiColor: 'amber' };
    if (hue < 66) return { name: lightness > 0.55 ? '\u843d\u65e5\u91d1' : '\u7425\u73c0\u91d1', uiColor: 'amber' };
    if (hue < 92) return { name: lightness < 0.4 ? '\u6c99\u4e18\u68d5' : '\u82d4\u539f\u7eff', uiColor: 'emerald' };
    if (hue < 132) return { name: lightness < 0.42 ? '\u677e\u6797\u7eff' : '\u8349\u7538\u7eff', uiColor: 'emerald' };
    if (hue < 165) return { name: saturation > 0.38 ? '\u8349\u6728\u7eff' : '\u82d4\u539f\u7eff', uiColor: 'emerald' };
    if (hue < 195) return { name: lightness < 0.45 ? '\u6e56\u6c34\u9752' : '\u51b0\u6e56\u84dd', uiColor: 'blue' };
    if (hue < 235) return { name: lightness < 0.43 ? '\u5c71\u5f71\u84dd' : '\u5929\u7a7a\u84dd', uiColor: 'blue' };
    if (hue < 285) return { name: '\u66ae\u4e91\u7d2b', uiColor: 'violet' };
    if (hue < 330) return { name: '\u971e\u96fe\u7d2b', uiColor: 'violet' };
    return { name: '\u6696\u65e5\u7ea2', uiColor: 'rose' };
  }
  getClosestColorTag(hexColor) {
    return this.getPhotographicColorTag(hexColor);
  }
  parseHexColor(hexColor) {
    if (!hexColor || typeof hexColor !== 'string') return null;
    const normalized = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor;
    if (normalized.length !== 6) return null;
    const value = parseInt(normalized, 16);
    if (Number.isNaN(value)) return null;
    return {
      r: (value >> 16) & 0xff,
      g: (value >> 8) & 0xff,
      b: value & 0xff
    };
  }
  rgbToHsl(rgb) {
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = (max + min) / 2;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
    let hue = 0;
    if (delta !== 0) {
      if (max === r) hue = 60 * (((g - b) / delta) % 6);
      else if (max === g) hue = 60 * (((b - r) / delta) + 2);
      else hue = 60 * (((r - g) / delta) + 4);
    }
    if (hue < 0) hue += 360;
    return { hue, saturation, lightness };
  }
  updateStats() {
    const dbStats = this.db.getProcessingStats();
    
    // 重置统计
    for (const type of Object.keys(this.stats)) {
      this.stats[type] = { pending: 0, processing: 0, completed: 0, failed: 0 };
    }
    
    // recovered from corrupted comment
    for (const row of dbStats) {
      const type = (row.task_type === 'ai_tag' || row.task_type === 'aiTag') ? 'aiTag' : 
                   row.task_type === 'thumbnail' ? 'thumbnail' : 'manualTag';
      if (this.stats[type]) {
        this.stats[type][row.status] = row.count;
      }
    }

    this.vectorBackfillState.enabled = !!(this.usePythonEngine || this.pythonEngineManager || this.aiEngine);
    if (typeof this.db.countImagesMissingVectors === 'function') {
      this.vectorBackfillState.missing = this.db.countImagesMissingVectors();
    }
    
    this.emit('statsUpdated', this.getStats());
  }

  // 获取统计
  getStats() {
    return {
      ...this.stats,
      vectorBackfill: { ...this.vectorBackfillState },
      libraryId: this.db.libraryId,
      isRunning: this.isRunning
    };
  }

  // recovered from corrupted comment
  batchAddThumbnailTasks(imageIds) {
    if (!imageIds || imageIds.length === 0) return;
    
    const placeholders = imageIds.map(() => '?').join(',');
    const stmt = this.db.db.prepare(`
      INSERT OR IGNORE INTO processing_queue (image_id, task_type, priority)
      SELECT id, 'thumbnail', 0 FROM images 
      WHERE id IN (${placeholders}) AND process_status = 'imported'
    `);
    stmt.run(...imageIds);
    
    this.emit('tasksAdded', { type: 'thumbnail', count: imageIds.length });
  }

  // 批量添加 AI 标注任务
  batchAddAITagTasks(imageIds) {
    if (!imageIds || imageIds.length === 0) {
      return { requested: 0, thumbnailQueued: 0, aiQueued: 0, totalQueued: 0 };
    }

    const placeholders = imageIds.map(() => '?').join(',');
    this.db.db.prepare(`
      UPDATE images
      SET auto_ai_tag = 1,
          updated_at = datetime('now')
      WHERE id IN (${placeholders}) AND is_deleted = 0
    `).run(...imageIds);

    const rows = this.db.db.prepare(`
      SELECT id, process_status
      FROM images
      WHERE id IN (${placeholders}) AND is_deleted = 0
    `).all(...imageIds);

    const thumbnailIds = rows
      .filter((row) => row.process_status === 'imported')
      .map((row) => row.id);

    const aiTagIds = rows
      .filter((row) => row.process_status !== 'imported')
      .map((row) => row.id);

    if (thumbnailIds.length > 0) {
      this.batchAddThumbnailTasks(thumbnailIds);
    }

    let addedCount = 0;
    for (const imageId of aiTagIds) {
      const before = this.db.db.prepare(`
        SELECT COUNT(*) AS count
        FROM processing_queue
        WHERE image_id = ? AND task_type = 'aiTag' AND status IN ('pending', 'processing')
      `).get(imageId);
      this.db.addTask(imageId, 'aiTag', 0);
      const after = this.db.db.prepare(`
        SELECT COUNT(*) AS count
        FROM processing_queue
        WHERE image_id = ? AND task_type = 'aiTag' AND status IN ('pending', 'processing')
      `).get(imageId);
      if ((after?.count || 0) > (before?.count || 0)) {
        addedCount++;
      }
    }

    this.emit('tasksAdded', { type: 'aiTag', count: thumbnailIds.length + addedCount });
    return {
      requested: imageIds.length,
      thumbnailQueued: thumbnailIds.length,
      aiQueued: addedCount,
      totalQueued: thumbnailIds.length + addedCount,
    };
  }
}

/**
 * 任务队列
 */
class TaskQueue {
  constructor(type, concurrency) {
    this.type = type;
    this.concurrency = concurrency;
    this.running = 0;
    this.paused = false;
  }
}

module.exports = { ProcessingWorker };


