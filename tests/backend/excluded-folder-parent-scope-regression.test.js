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
  const libraryPath = makeTempDir('smart-lib-excluded-parent-scope-');
  const sourceRoot = makeTempDir('smart-lib-excluded-parent-source-');
  writeFile(path.join(sourceRoot, 'root-visible.jpg'), 'root');
  writeFile(path.join(sourceRoot, 'child', 'hidden.jpg'), 'child');

  const db = new LibraryDatabase('lib_excluded_parent_scope', libraryPath);
  await db.initialize();
  const worker = { batchAddThumbnailTasks() {} };
  const service = new ImportService(db, worker);
  const importRootName = path.basename(sourceRoot);
  const excludedChildFolder = `${importRootName}/child`;

  try {
    db.addExcludedFolder(excludedChildFolder);

    assert.strictEqual(
      db.isFolderExcluded(importRootName),
      false,
      'excluding a child folder must not exclude the parent root folder'
    );
    assert.strictEqual(
      db.isFolderExcluded(excludedChildFolder),
      true,
      'excluded child folder should still be recognized as excluded'
    );

    const stats = await service.quickImport(sourceRoot, { mode: 'quick' });
    assert.strictEqual(stats.imported, 1, 'root-level image should still import normally');

    const rows = db.db.prepare(`
      SELECT filename, folder
      FROM images
      WHERE is_deleted = 0
      ORDER BY filename
    `).all();

    assert.deepStrictEqual(rows, [
      { filename: 'root-visible.jpg', folder: importRootName },
    ], 'root image should remain visible while excluded child folder stays hidden');
  } finally {
    db.close();
  }
}

module.exports = run;


