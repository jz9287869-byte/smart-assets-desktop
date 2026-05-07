const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { LibraryDatabase } = require('../../electron/main/libraryDatabase');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-processing-stats-last-attempt-');
  const db = new LibraryDatabase('lib_processing_stats_last_attempt', libraryPath);
  await db.initialize();

  try {
    const imagePaths = ['one.jpg', 'two.jpg'].map((name) => path.join(libraryPath, name));
    for (const filePath of imagePaths) {
      fs.writeFileSync(filePath, 'stub');
    }

    db.batchInsertImages([
      {
        filename: 'one.jpg',
        path: imagePaths[0],
        folder: path.basename(libraryPath),
        relativePath: 'one.jpg',
        size: 1,
        format: 'jpg',
        autoAiTag: true,
      },
      {
        filename: 'two.jpg',
        path: imagePaths[1],
        folder: path.basename(libraryPath),
        relativePath: 'two.jpg',
        size: 1,
        format: 'jpg',
        autoAiTag: true,
      },
    ]);

    const images = db.db.prepare(`SELECT id, filename FROM images ORDER BY id ASC`).all();
    const imageByName = new Map(images.map((row) => [row.filename, row.id]));

    db.addTask(imageByName.get('one.jpg'), 'aiTag', 0);
    db.addTask(imageByName.get('two.jpg'), 'aiTag', 0);

    const tasks = db.db.prepare(`
      SELECT id, image_id
      FROM processing_queue
      WHERE task_type = 'aiTag'
      ORDER BY id ASC
    `).all();

    const firstTaskByImageId = new Map(tasks.map((row) => [row.image_id, row.id]));
    db.updateTaskStatus(firstTaskByImageId.get(imageByName.get('one.jpg')), 'failed', 'first pass failed');
    db.updateTaskStatus(firstTaskByImageId.get(imageByName.get('two.jpg')), 'failed', 'first pass failed');

    db.db.prepare(`
      INSERT INTO processing_queue (image_id, task_type, status, priority, created_at, completed_at)
      VALUES (?, 'aiTag', 'completed', 0, datetime('now'), datetime('now'))
    `).run(imageByName.get('one.jpg'));

    const stats = db.getProcessingStats();
    const aiTagRows = stats.filter((row) => row.task_type === 'aiTag');
    const statsByStatus = Object.fromEntries(aiTagRows.map((row) => [row.status, row.count]));

    assert.strictEqual(
      Number(statsByStatus.completed || 0),
      1,
      'latest successful retry should count as completed'
    );
    assert.strictEqual(
      Number(statsByStatus.failed || 0),
      1,
      'only images whose latest AI attempt is failed should remain in failed count'
    );
  } finally {
    db.close();
  }
}

module.exports = run;
