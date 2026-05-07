const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { LibraryDatabase } = require('../../electron/main/libraryDatabase');
const { ProcessingWorker } = require('../../electron/main/processingWorker');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-ai-tag-');
  const imagePath = path.join(libraryPath, 'samples', 'tiananmen.jpg');

  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, 'fake-image');

  const db = new LibraryDatabase('lib_ai_tag_auto_create', libraryPath);
  await db.initialize();

  try {
    db.batchInsertImages([{
      filename: 'tiananmen.jpg',
      path: imagePath,
      folder: 'samples',
      relativePath: 'samples/tiananmen.jpg',
      size: 128,
      format: '.jpg',
      autoAiTag: true,
    }]);

    const image = db.db.prepare(`
      SELECT id
      FROM images
      WHERE filename = ?
      LIMIT 1
    `).get('tiananmen.jpg');

    assert(image?.id, 'image row should exist before saving AI tag');

    const worker = new ProcessingWorker(db, { aiTagConcurrency: 0, thumbnailConcurrency: 0 });
    worker.saveAITag(image.id, {
      name: '天安门',
      category: 'location',
      confidence: 0.91,
      source: 'ai',
    });

    const tagRow = db.db.prepare(`
      SELECT category_id, name, created_source
      FROM tags
      WHERE name = ?
      LIMIT 1
    `).get('天安门');

    assert.deepStrictEqual(tagRow, {
      category_id: 'location',
      name: '天安门',
      created_source: 'ai',
    }, 'unknown location tag should be auto-created in tags table');

    const imageTagRow = db.db.prepare(`
      SELECT it.source, t.name, t.category_id
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
        AND t.name = ?
      LIMIT 1
    `).get(image.id, '天安门');

    assert.deepStrictEqual(imageTagRow, {
      source: 'ai',
      name: '天安门',
      category_id: 'location',
    }, 'auto-created location tag should be linked to the image');
  } finally {
    db.close();
  }
}

module.exports = run;
