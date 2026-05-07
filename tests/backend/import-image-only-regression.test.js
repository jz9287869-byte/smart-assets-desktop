const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { LibraryDatabase } = require('../../electron/main/libraryDatabase');
const { ImportService } = require('../../electron/main/importService');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-import-image-only-');
  const sourceRoot = makeTempDir('smart-lib-import-image-only-source-');

  writeFile(path.join(sourceRoot, 'cover.jpg'), 'image');
  writeFile(path.join(sourceRoot, 'clip.mp4'), 'video');
  writeFile(path.join(sourceRoot, 'movie.mov'), 'video');
  writeFile(path.join(sourceRoot, 'nested', 'scene.png'), 'image');
  writeFile(path.join(sourceRoot, 'nested', 'demo.webm'), 'video');

  const db = new LibraryDatabase('lib_import_image_only_regression', libraryPath);
  await db.initialize();

  const worker = {
    batchAddThumbnailTasks(imageIds) {
      db.batchAddThumbnailTasks(imageIds);
    },
  };

  const service = new ImportService(db, worker);

  try {
    const stats = await service.quickImport(sourceRoot, { mode: 'quick' });
    assert.strictEqual(stats.imported, 2, 'only image files should be imported');

    const imported = db.db.prepare(`
      SELECT filename
      FROM images
      ORDER BY filename ASC
    `).all().map((row) => row.filename);

    assert.deepStrictEqual(imported, ['cover.jpg', 'scene.png']);
  } finally {
    db.close();
  }
}

module.exports = run;
