const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { LibraryDatabase } = require('../../electron/main/libraryDatabase');
const { ProcessingWorker } = require('../../electron/main/processingWorker');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-ai-english-aliases-');
  const imagePath = path.join(libraryPath, 'samples', 'rainbow.jpg');

  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, 'fake-image');

  const db = new LibraryDatabase('lib_ai_english_aliases', libraryPath);
  await db.initialize();

  try {
    db.batchInsertImages([{
      filename: 'rainbow.jpg',
      path: imagePath,
      folder: 'samples',
      relativePath: 'samples/rainbow.jpg',
      size: 128,
      format: '.jpg',
      autoAiTag: true,
    }]);

    const image = db.db.prepare(`
      SELECT id
      FROM images
      WHERE filename = ?
      LIMIT 1
    `).get('rainbow.jpg');

    assert(image?.id, 'image row should exist before saving AI tags');

    const worker = new ProcessingWorker(db, { aiTagConcurrency: 0, thumbnailConcurrency: 0 });
    const aliasCases = [
      ['mountain', '山峰'],
      ['rainbow', '彩虹'],
      ['night sky', '夜空'],
      ['silhouette', '剪影'],
      ['stargazing', '观星'],
      ['natural_phenomenon', '自然现象'],
    ];

    for (const [input, expected] of aliasCases) {
      assert.strictEqual(
        worker.normalizeTagName(input),
        expected,
        `alias should normalize "${input}" to "${expected}"`
      );
    }

    worker.saveAITag(image.id, {
      name: 'rainbow',
      category: 'scene',
      confidence: 0.92,
      source: 'ai',
    });

    const persisted = db.db.prepare(`
      SELECT t.name
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
      ORDER BY it.id ASC
    `).all(image.id).map((row) => row.name);

    assert.deepStrictEqual(
      persisted,
      ['彩虹'],
      'persisted AI tags should use normalized Chinese aliases instead of raw English labels'
    );
  } finally {
    db.close();
  }
}

module.exports = run;
