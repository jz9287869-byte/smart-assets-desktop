const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { LibraryDatabase } = require('../../electron/main/libraryDatabase');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-source-count-');
  const db = new LibraryDatabase('lib_source_count', libraryPath);
  await db.initialize();

  try {
    db.batchInsertImages([
      {
        filename: 'a.jpg',
        path: path.join(libraryPath, 'one.jpg'),
        folder: '好看滴',
        relativePath: '好看滴/one.jpg',
        size: 1,
        format: 'jpg',
        autoAiTag: false,
      },
      {
        filename: 'b.jpg',
        path: path.join(libraryPath, 'two.jpg'),
        folder: '伊犁路线/草原',
        relativePath: '伊犁路线/草原/two.jpg',
        size: 1,
        format: 'jpg',
        autoAiTag: false,
      },
      {
        filename: 'c.jpg',
        path: path.join(libraryPath, 'three.jpg'),
        folder: '春天路线',
        relativePath: '春天路线/three.jpg',
        size: 1,
        format: 'jpg',
        autoAiTag: false,
      },
    ]);

    db.db.prepare(`
      INSERT INTO import_history (source_path, imported_count, import_mode, completed_at)
      VALUES (?, 1, 'quick', datetime('now'))
    `).run('D:\\素材库');
    db.db.prepare(`
      INSERT INTO import_history (source_path, imported_count, import_mode, completed_at)
      VALUES (?, 1, 'quick', datetime('now'))
    `).run('D:/素材库');
    db.db.prepare(`
      INSERT INTO import_history (source_path, imported_count, import_mode, completed_at)
      VALUES (?, 1, 'quick', datetime('now'))
    `).run('D:\\\\素材库');

    assert.strictEqual(
      db.getImportSourceCount(),
      3,
      'source count should reflect current top-level folders instead of duplicate historical import paths'
    );
  } finally {
    db.close();
  }
}

module.exports = run;
