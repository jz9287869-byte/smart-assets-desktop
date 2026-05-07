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
  const libraryPath = makeTempDir('smart-lib-detach-regression-');
  const sourceRoot = makeTempDir('smart-lib-detach-source-');
  const keepImagePath = path.join(sourceRoot, 'keep', 'keep.jpg');
  const excludedImagePath = path.join(sourceRoot, 'excluded', 'excluded.jpg');

  writeFile(keepImagePath, 'keep');
  writeFile(excludedImagePath, 'excluded');

  const db = new LibraryDatabase('lib_detach_regression', libraryPath);
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
    const initialStats = await service.quickImport(sourceRoot, { mode: 'quick' });
    assert.strictEqual(initialStats.imported, 2, 'initial import should include both folders');

    const initialRows = db.db.prepare(`
      SELECT filename, folder
      FROM images
      WHERE is_deleted = 0
      ORDER BY filename
    `).all();

    assert.deepStrictEqual(initialRows, [
      { filename: 'excluded.jpg', folder: excludedFolder },
      { filename: 'keep.jpg', folder: `${importRootName}/keep` },
    ], 'initial rows should include both imported folders');

    db.addExcludedFolder(excludedFolder);
    db.db.prepare(`
      DELETE FROM images
      WHERE folder = ?
         OR folder LIKE ?
    `).run(excludedFolder, `${excludedFolder}/%`);

    const rowsAfterDetach = db.db.prepare(`
      SELECT filename, folder
      FROM images
      WHERE is_deleted = 0
      ORDER BY filename
    `).all();

    assert.deepStrictEqual(rowsAfterDetach, [
      { filename: 'keep.jpg', folder: `${importRootName}/keep` },
    ], 'detached folder should be removed from the library rows');

    writeFile(path.join(sourceRoot, 'keep', 'restored-later.jpg'), 'restored');
    const rescanStats = await service.quickImport(sourceRoot, { mode: 'quick' });

    assert.strictEqual(
      db.isFolderExcluded(excludedFolder),
      true,
      'detached folder should remain persisted in the exclusion table'
    );
    assert.strictEqual(
      rescanStats.imported,
      1,
      'rescan should only import the unrelated restored file'
    );

    const finalRows = db.db.prepare(`
      SELECT filename, folder
      FROM images
      WHERE is_deleted = 0
      ORDER BY filename
    `).all();

    assert.deepStrictEqual(finalRows, [
      { filename: 'keep.jpg', folder: `${importRootName}/keep` },
      { filename: 'restored-later.jpg', folder: `${importRootName}/keep` },
    ], 'rescan should not re-import files from the detached folder');
  } finally {
    db.close();
  }
}

module.exports = run;


