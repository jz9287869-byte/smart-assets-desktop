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
  const libraryPath = makeTempDir('smart-lib-excluded-trigger-regression-');
  const sourceRoot = makeTempDir('smart-lib-excluded-trigger-source-');
  const excludedFolderPath = path.join(sourceRoot, 'excluded');
  const excludedImagePath = path.join(excludedFolderPath, 'excluded.jpg');

  writeFile(excludedImagePath, 'excluded');

  const db = new LibraryDatabase('lib_excluded_trigger_regression', libraryPath);
  await db.initialize();

  const worker = {
    batchAddThumbnailTasks(imageIds) {
      db.batchAddThumbnailTasks(imageIds);
    },
  };

  const service = new ImportService(db, worker);
  const importRootName = path.basename(sourceRoot);
  const excludedFolder = `${importRootName}/excluded`;

  try {
    await service.quickImport(sourceRoot, { mode: 'quick' });

    db.addExcludedFolder(excludedFolder);
    db.db.prepare(`
      DELETE FROM images
      WHERE folder = ?
         OR folder LIKE ?
    `).run(excludedFolder, `${excludedFolder}/%`);

    const newImagePath = path.join(excludedFolderPath, 'new-after-detach.jpg');
    writeFile(newImagePath, 'new');

    const rescanStats = await service.quickImport(sourceRoot, {
      mode: 'quick',
      triggerPath: newImagePath,
    });

    assert.strictEqual(
      db.isFolderExcluded(excludedFolder),
      false,
      'adding a new file under an excluded folder should automatically restore that folder'
    );
    assert.strictEqual(
      rescanStats.imported,
      2,
      'rescan should import the restored folder files after removing the exclusion'
    );

    const finalRows = db.db.prepare(`
      SELECT filename, folder
      FROM images
      WHERE is_deleted = 0
      ORDER BY filename
    `).all();

    assert.deepStrictEqual(finalRows, [
      { filename: 'excluded.jpg', folder: excludedFolder },
      { filename: 'new-after-detach.jpg', folder: excludedFolder },
    ], 'restored folder should become visible again with both old and new files');
  } finally {
    db.close();
  }
}

module.exports = run;


