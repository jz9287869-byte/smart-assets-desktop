const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { LibraryDatabase } = require('../electron/main/libraryDatabase');
const { ImportService } = require('../electron/main/importService');

function makeTempLibrary(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function runModeRegression(mode) {
  const libraryPath = makeTempLibrary(`smart-lib-${mode}-`);
  const sourcePath = path.join(libraryPath, '鏄ュぉ璺嚎');
  fs.mkdirSync(sourcePath, { recursive: true });

  const db = new LibraryDatabase(`lib_${mode}`, libraryPath);
  await db.initialize();

  const workerCalls = [];
  const worker = {
    batchAddThumbnailTasks(imageIds) {
      workerCalls.push([...imageIds]);
      db.batchAddThumbnailTasks(imageIds);
    },
  };

  const service = new ImportService(db, worker);
  service.fastScan = async () => ([
    {
      name: 'a.jpg',
      fullPath: path.join(sourcePath, 'a.jpg'),
      folder: '',
      relativePath: 'a.jpg',
      size: 123,
      ext: '.jpg',
      mtime: new Date(),
    },
    {
      name: 'b.jpg',
      fullPath: path.join(sourcePath, '鍔ㄧ墿', 'b.jpg'),
      folder: '鍔ㄧ墿',
      relativePath: path.join('鍔ㄧ墿', 'b.jpg'),
      size: 456,
      ext: '.jpg',
      mtime: new Date(),
    },
  ]);

  const stats = await service.quickImport(sourcePath, { mode });
  assert.strictEqual(stats.imported, 2, `${mode}: imported count mismatch`);

  const images = db.db.prepare(`
    SELECT filename, folder, relative_path, auto_ai_tag, process_status
    FROM images
    ORDER BY filename
  `).all();

  assert.strictEqual(images.length, 2, `${mode}: image row count mismatch`);
  assert.strictEqual(images[0].folder, '鏄ュぉ璺嚎', `${mode}: root folder mismatch`);
  assert.strictEqual(images[1].folder, '鏄ュぉ璺嚎/鍔ㄧ墿', `${mode}: nested folder mismatch`);
  assert.strictEqual(images[0].relative_path, '鏄ュぉ璺嚎/a.jpg', `${mode}: root relative path mismatch`);
  assert.strictEqual(images[1].relative_path, '鏄ュぉ璺嚎/鍔ㄧ墿/b.jpg', `${mode}: nested relative path mismatch`);

  const queueStats = db.db.prepare(`
    SELECT task_type, status, COUNT(*) AS count
    FROM processing_queue
    GROUP BY task_type, status
    ORDER BY task_type, status
  `).all();

  if (mode === 'quick') {
    assert.deepStrictEqual(workerCalls, [], 'quick: should not enqueue thumbnail work');
    assert.strictEqual(queueStats.length, 0, 'quick: queue should stay empty');
    assert(images.every((image) => image.auto_ai_tag === 0), 'quick: auto_ai_tag should be disabled');
  }

  if (mode === 'standard') {
    assert.strictEqual(workerCalls.length, 1, 'standard: should enqueue thumbnail work once');
    assert(images.every((image) => image.auto_ai_tag === 0), 'standard: auto_ai_tag should be disabled');
    assert.deepStrictEqual(queueStats, [
      { task_type: 'thumbnail', status: 'pending', count: 2 },
    ], 'standard: queue should contain only thumbnail pending tasks');
  }

  if (mode === 'full') {
    assert.strictEqual(workerCalls.length, 1, 'full: should enqueue thumbnail work once');
    assert(images.every((image) => image.auto_ai_tag === 1), 'full: auto_ai_tag should be enabled');
    assert.deepStrictEqual(queueStats, [
      { task_type: 'thumbnail', status: 'pending', count: 2 },
    ], 'full: aiTag should not be inserted before thumbnails complete');
  }

  db.close();
}

(async () => {
  await runModeRegression('quick');
  await runModeRegression('standard');
  await runModeRegression('full');
  console.log('REGRESSION_IMPORT_MODES_OK');
})().catch((error) => {
  console.error('REGRESSION_IMPORT_MODES_FAILED');
  console.error(error);
  process.exitCode = 1;
});

