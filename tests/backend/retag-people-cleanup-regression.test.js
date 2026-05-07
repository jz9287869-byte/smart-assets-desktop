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
  const libraryPath = makeTempDir('smart-lib-retag-people-cleanup-');
  const db = new LibraryDatabase('lib_retag_people_cleanup', libraryPath);
  await db.initialize();

  try {
    const worker = new ProcessingWorker(db, { aiTagConcurrency: 0, thumbnailConcurrency: 0 });
    const imagePath = path.join(libraryPath, 'portrait.jpg');
    fs.writeFileSync(imagePath, 'stub');

    db.batchInsertImages([{
      filename: path.basename(imagePath),
      path: imagePath,
      folder: path.basename(libraryPath),
      relativePath: path.basename(imagePath),
      size: 4,
      format: 'jpg',
      autoAiTag: true,
    }]);

    const image = db.db.prepare('SELECT id FROM images WHERE path = ?').get(imagePath.toLowerCase());
    assert.ok(image?.id, 'fixture image should exist');

    const personTagId = db.addTag('people', '人物', null, null, 'ai');
    const multiTagId = db.addTag('people', '多人', null, null, 'ai');
    db.tagImage(image.id, personTagId, 0.94, 'opencv_body');
    db.tagImage(image.id, multiTagId, 0.96, 'opencv_body');

    worker.cleanupDerivedPeopleTags(image.id);

    const staleRows = db.db.prepare(`
      SELECT t.name, it.source
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
    `).all(image.id);
    assert.deepStrictEqual(staleRows, [], 'cleanup should remove stale derived people tags before re-tagging');

    const nextPeopleTags = worker.buildPeopleDimensionTags({
      face_count: 1,
      body_count: 1,
      label: '单人',
      source: 'mediapipe_face',
    }, [{
      name: '女性',
      confidence: 0.41,
      category: 'people',
    }]);

    for (const tag of nextPeopleTags) {
      worker.saveAITag(image.id, tag);
    }

    const persisted = db.db.prepare(`
      SELECT t.name
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
      ORDER BY it.id ASC
    `).all(image.id).map((row) => row.name);

    assert.deepStrictEqual(
      persisted,
      ['人物', '单人'],
      're-tagging should replace stale group labels with the latest people result'
    );
  } finally {
    db.close();
  }
}

module.exports = run;
