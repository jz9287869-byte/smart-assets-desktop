const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const { LibraryDatabase } = require('../../electron/main/libraryDatabase');
const { ProcessingWorker } = require('../../electron/main/processingWorker');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-season-regression-');
  const db = new LibraryDatabase('lib_season_regression', libraryPath);
  await db.initialize();

  try {
    const worker = new ProcessingWorker(db, { aiTagConcurrency: 0, thumbnailConcurrency: 0 });

    assert.strictEqual(
      worker.resolveSemanticTagCategory({ name: '春天' }),
      'scene',
      'season tags should resolve into the scene category'
    );

    const springTag = db.findTagByName('春天');
    assert(springTag, 'spring should be inserted as a builtin tag during library initialization');
    assert.strictEqual(springTag.category_id, 'scene', 'spring builtin tag should belong to scene category');

    const withoutHints = worker.limitSeasonCandidates([
      { name: '春天', confidence: 0.46, category: 'scene' },
      { name: '夏天', confidence: 0.35, category: 'scene' },
      { name: '花海', confidence: 0.41, category: 'scene' },
    ], { filename: 'mountain.jpg', folder: 'travel' });

    assert.deepStrictEqual(
      withoutHints.map((tag) => tag.name),
      ['春天', '花海'],
      'supported season should be kept when confidence and semantic cues both align'
    );

    const withHint = worker.limitSeasonCandidates([
      { name: '春天', confidence: 0.41, category: 'scene' },
      { name: '秋天', confidence: 0.33, category: 'scene' },
      { name: '田野', confidence: 0.36, category: 'scene' },
    ], { filename: '秋天-trip.jpg', folder: 'travel' });

    assert.deepStrictEqual(
      withHint.map((tag) => tag.name),
      ['秋天', '田野'],
      'filename or folder hints should override the top generic season score'
    );

    const snowyImagePath = path.join(libraryPath, 'synthetic-snow.png');
    const snowyPixel = Buffer.from([225, 230, 245, 235, 240, 250, 220, 228, 242, 238, 242, 250]);
    await sharp(snowyPixel, {
      raw: {
        width: 2,
        height: 2,
        channels: 3,
      },
    }).resize(64, 64, { kernel: 'nearest' }).png().toFile(snowyImagePath);

    const visualWinterTags = await worker.buildVisualSeasonHintTags({
      path: snowyImagePath,
    });
    assert.deepStrictEqual(
      visualWinterTags.map((tag) => tag.name),
      ['冬天'],
      'snow-like visual scenes should provide a winter hint even when semantic tags are weak'
    );
  } finally {
    db.close();
  }
}

module.exports = run;
