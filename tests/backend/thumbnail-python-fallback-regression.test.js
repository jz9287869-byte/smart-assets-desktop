const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { LibraryDatabase } = require('../../electron/main/libraryDatabase');
const { ProcessingWorker } = require('../../electron/main/processingWorker');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writePng(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S8AAAAASUVORK5CYII=';
  fs.writeFileSync(targetPath, Buffer.from(pngBase64, 'base64'));
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-thumbnail-fallback-');
  const imagePath = path.join(libraryPath, 'fallback-test.png');
  writePng(imagePath);

  const db = new LibraryDatabase('lib_thumbnail_fallback', libraryPath);
  await db.initialize();

  try {
    const result = db.batchInsertImages([{
      filename: 'fallback-test.png',
      path: imagePath,
      folder: path.basename(libraryPath),
      relativePath: `${path.basename(libraryPath)}/fallback-test.png`,
      size: fs.statSync(imagePath).size,
      format: 'png',
      autoAiTag: true,
    }]);
    assert.strictEqual(result.inserted, 1, 'test image should be inserted into the library');

    const image = db.db.prepare(`
      SELECT id, path, auto_ai_tag
      FROM images
      WHERE filename = 'fallback-test.png'
      LIMIT 1
    `).get();

    const worker = new ProcessingWorker(db, { aiTagConcurrency: 0, thumbnailConcurrency: 0 });
    await worker.generateThumbnail({
      image_id: image.id,
      path: image.path,
      auto_ai_tag: image.auto_ai_tag,
    });

    const updated = db.db.prepare(`
      SELECT process_status, thumbnail_path, width, height, dominant_color
      FROM images
      WHERE id = ?
    `).get(image.id);

    assert.strictEqual(updated.process_status, 'thumbnail', 'thumbnail generation should move image into thumbnail status');
    assert(updated.thumbnail_path, 'thumbnail path should be persisted');
    assert(fs.existsSync(updated.thumbnail_path), 'thumbnail file should exist on disk');
    assert(updated.width > 0 && updated.height > 0, 'image dimensions should be captured');
    assert(updated.dominant_color, 'dominant color should be computed');

    const aiTask = db.db.prepare(`
      SELECT task_type, status
      FROM processing_queue
      WHERE image_id = ? AND task_type = 'aiTag'
      LIMIT 1
    `).get(image.id);
    assert(aiTask, 'AI tagging task should be enqueued after thumbnail generation');
    assert.strictEqual(aiTask.status, 'pending', 'AI tagging task should remain pending');
  } finally {
    db.close();
  }
}

module.exports = run;


