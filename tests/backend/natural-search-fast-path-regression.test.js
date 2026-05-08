const assert = require('assert');
const path = require('path');

const { ProcessingWorker } = require('../../electron/main/processingWorker');

async function run() {
  let computedEmbeddings = 0;
  const db = {
    getImageVectors() {
      return [];
    },
    upsertImageVector() {
      throw new Error('search-time vector backfill should be disabled');
    },
  };

  const worker = new ProcessingWorker(db, {
    aiTagConcurrency: 0,
    thumbnailConcurrency: 0,
  });

  worker.initializeAIEngine = async () => {};
  worker.pythonEngineManager = { modelName: 'test-model' };
  worker.resolveAvailableImagePath = () => path.join(__dirname, 'fixture.jpg');
  worker.computeImageEmbedding = async () => {
    computedEmbeddings += 1;
    return { vector: [1, 0], modelName: 'test-model' };
  };

  const vectorState = await worker.ensureImageVectors([
    { id: 1, path: path.join(__dirname, 'fixture.jpg') },
  ], {
    maxToCompute: 0,
  });

  assert.strictEqual(vectorState.computed, 0, 'maxToCompute: 0 should not compute image vectors');
  assert.strictEqual(computedEmbeddings, 0, 'no image embedding should run during fast search');

  worker.getTextEmbedding = async () => [1, 0];
  worker.ensureImageVectors = async () => ({
    supported: true,
    vectors: new Map([[1, [1, 0]]]),
    computed: 0,
    requested: 1,
  });
  worker.applyCloudQueryRerank = async () => {
    throw new Error('cloud rerank should be skipped for fast natural search');
  };

  const result = await worker.rerankNaturalLanguageMatches([
    {
      id: 1,
      filename: 'grassland.jpg',
      folder: 'travel/grassland',
      path: path.join(__dirname, 'fixture.jpg'),
      tags: '草原,多人',
      natural_search_score: 10,
      natural_search_summary: ['base'],
      strictMatch: true,
    },
  ], {
    requiredTags: ['草原', '多人'],
    implicitTags: [],
  }, {
    query: '多人 草原',
    maxToCompute: 0,
    skipCloudRerank: true,
  });

  assert.strictEqual(result.images.length, 1, 'rerank should keep the candidate');
  assert.strictEqual(result.vectorCoverage.computed, 0, 'rerank should not backfill image vectors');
  assert.strictEqual(result.cloudRerankApplied, false, 'cloud rerank should be disabled on fast path');
}

module.exports = run;
