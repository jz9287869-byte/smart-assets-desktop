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
  const libraryPath = makeTempDir('smart-lib-refresh-stats-regression-');
  const sourceRoot = makeTempDir('smart-lib-refresh-source-');
  const imagePath = path.join(sourceRoot, 'existing.jpg');
  writeFile(imagePath, 'existing');

  const db = new LibraryDatabase('lib_refresh_stats_regression', libraryPath);
  await db.initialize();

  const worker = {
    batchAddThumbnailTasks(imageIds) {
      db.batchAddThumbnailTasks(imageIds);
    },
  };

  const service = new ImportService(db, worker);

  try {
    const firstImport = await service.quickImport(sourceRoot, { mode: 'quick' });
    assert.strictEqual(firstImport.imported, 1, 'first import should report one new image');
    assert.strictEqual(firstImport.skipped, 0, 'first import should not skip unchanged images');

    const secondImport = await service.quickImport(sourceRoot, { mode: 'quick' });
    assert.strictEqual(secondImport.imported, 0, 're-importing unchanged files should not be counted as new images');
    assert.strictEqual(secondImport.skipped, 1, 're-importing unchanged files should be counted as skipped');
  } finally {
    db.close();
  }
}

module.exports = run;


