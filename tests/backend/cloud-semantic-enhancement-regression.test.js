const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { LibraryDatabase } = require('../../electron/main/libraryDatabase');
const { ProcessingWorker } = require('../../electron/main/processingWorker');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-cloud-semantic-enhance-');
  const db = new LibraryDatabase('lib_cloud_semantic_enhance', libraryPath);
  await db.initialize();

  try {
    const reviewer = {
      isEnabled() {
        return true;
      },
      async extractImageStructuredTags() {
        return {
          tags: [
            { name: '雪山', confidence: 0.78, category: 'scene' },
            { name: '鹿', confidence: 0.74, category: 'animal' },
            { name: '人物', confidence: 0.71, category: 'people' },
          ],
          ocrKeywords: ['西湖景区', '扫码优惠'],
          peopleDecision: {
            hasPeople: false,
            count: 'none',
            confidence: 0.91,
          },
        };
      },
      async scoreImageRelevance(payload) {
        return {
          relevanceScore: payload.filename === 'best.jpg' ? 0.95 : 0.12,
          matchedTags: payload.filename === 'best.jpg' ? ['雪山', '鹿'] : [],
          contradictions: payload.filename === 'best.jpg' ? [] : ['多人'],
        };
      },
    };

    const worker = new ProcessingWorker(db, {
      aiTagConcurrency: 0,
      thumbnailConcurrency: 0,
      deepseekReviewer: reviewer,
    });

    const enhanced = await worker.enhanceSemanticTagsWithCloud({
      task: {
        path: path.join(libraryPath, 'animal.jpg'),
        filename: 'animal.jpg',
        folder: 'wildlife',
      },
      result: {
        people_analysis: {
          face_count: 0,
          body_count: 1,
          source: 'opencv_body',
        },
      },
      semanticTags: [
        { name: '老虎', confidence: 0.49, category: 'animal', source: 'ai' },
        { name: '人物', confidence: 0.61, category: 'people', source: 'opencv_body' },
      ],
    });

    assert.strictEqual(enhanced.applied, true, 'cloud semantic enhancement should be applied');
    const enhancedNames = new Set((enhanced.tags || []).map((tag) => tag.name));
    assert(enhancedNames.has('鹿'), 'cloud structured animal tag should be merged');
    assert(enhancedNames.has('西湖景区'), 'OCR location-like keyword should be promoted as searchable tag');
    assert(!enhancedNames.has('人物'), 'people decision should remove noisy people labels on animal scenes');
    assert(!enhancedNames.has('单人'), 'people decision should remove single-person dimensions on animal scenes');
    assert(!enhancedNames.has('多人'), 'people decision should remove multi-person dimensions on animal scenes');

    worker.getTextEmbedding = async () => null;
    const reranked = await worker.rerankNaturalLanguageMatches([
      {
        id: 1,
        filename: 'weak.jpg',
        folder: 'travel',
        path: 'D:/tmp/weak.jpg',
        tags: '雪山,多人',
        natural_search_score: 20,
        natural_search_summary: ['base'],
        strictMatch: true,
      },
      {
        id: 2,
        filename: 'best.jpg',
        folder: 'travel',
        path: 'D:/tmp/best.jpg',
        tags: '雪山,鹿',
        natural_search_score: 19,
        natural_search_summary: ['base'],
        strictMatch: true,
      },
    ], {
      requiredTags: ['雪山', '鹿'],
      implicitTags: [],
    }, {
      query: '帮我找有两只鹿、阴天、雪山',
      maxCloudRerank: 4,
    });

    assert.strictEqual(reranked.cloudRerankApplied, true, 'Gemma query rerank should be applied');
    assert.strictEqual(reranked.images[0]?.filename, 'best.jpg', 'higher Gemma relevance should move image to the top');
  } finally {
    db.close();
  }
}

module.exports = run;
