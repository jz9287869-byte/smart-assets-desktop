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
  const libraryPath = makeTempDir('smart-lib-fallback-people-regression-');
  const db = new LibraryDatabase('lib_fallback_people_regression', libraryPath);
  await db.initialize();

  try {
    const worker = new ProcessingWorker(db, { aiTagConcurrency: 0, thumbnailConcurrency: 0 });
    const imagePath = path.join(libraryPath, 'u=332923318,170454427&fm=253&app=138&f=jpeg.jpg');
    fs.writeFileSync(imagePath, 'stub');

    const insertResult = db.batchInsertImages([{
      filename: path.basename(imagePath),
      path: imagePath,
      folder: path.basename(libraryPath),
      relativePath: path.basename(imagePath),
      size: 4,
      format: 'jpg',
      autoAiTag: true,
    }]);

    assert.ok(insertResult.inserted >= 1, 'image fixture should be inserted');
    const image = db.db.prepare('SELECT id FROM images WHERE path = ?').get(imagePath.toLowerCase());
    assert.ok(image?.id, 'inserted image should be queryable');

    await worker.generateAITagsFallback({
      image_id: image.id,
      path: imagePath,
    }, {
      weather: null,
      people_analysis: {
        face_count: 2,
        body_count: 4,
        label: '多人',
        source: 'mediapipe_face',
      }
    });

    const persistedTags = db.db.prepare(`
      SELECT t.name
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
      ORDER BY it.id ASC
    `).all(image.id).map((row) => row.name);

    assert.ok(persistedTags.includes('人物'), 'fallback should persist person tag from people analysis');
    assert.ok(persistedTags.includes('多人'), 'fallback should persist group tag from people analysis');
  } finally {
    db.close();
  }
}

module.exports = run;
