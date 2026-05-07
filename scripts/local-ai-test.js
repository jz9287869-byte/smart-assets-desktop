const path = require('path');
const { LibraryDatabase } = require('../electron/main/libraryDatabase');
const { ProcessingWorker } = require('../electron/main/processingWorker');

const LIBRARY_PATH = 'D:\\绱犳潗搴?;
const DEFAULT_TEST_FILENAMES = [
  'a7cc-hhehtqf2806252.jpg',
  't0427e036536b34b7d4.jpg',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickRows(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

function pickOne(db, sql, params = []) {
  return db.prepare(sql).get(...params);
}

async function run() {
  const usePythonEngine = process.argv.includes('--python');
  const timeoutMsArg = process.argv.find((arg) => arg.startsWith('--timeout-ms='));
  const aiTaskTimeoutMs = timeoutMsArg ? Number(timeoutMsArg.split('=')[1]) : 90000;
  const fileArgs = process.argv
    .filter((arg) => arg.startsWith('--file='))
    .map((arg) => arg.slice('--file='.length))
    .filter(Boolean);
  const testFilenames = fileArgs.length > 0 ? fileArgs : DEFAULT_TEST_FILENAMES;

  const library = new LibraryDatabase('local-ai-test', LIBRARY_PATH);
  await library.initialize();

  const images = testFilenames
    .map((filename) => pickOne(library.db, 'SELECT id, filename, process_status, auto_ai_tag FROM images WHERE filename = ?', [filename]))
    .filter(Boolean);

  if (images.length === 0) {
    throw new Error('No test images found in library');
  }

  const imageIds = images.map((image) => image.id);
  const placeholders = imageIds.map(() => '?').join(',');

  library.db.prepare(`
    DELETE FROM processing_queue
    WHERE image_id IN (${placeholders})
      AND task_type IN ('aiTag', 'thumbnail')
  `).run(...imageIds);

  library.db.prepare(`
    DELETE FROM image_tags
    WHERE image_id IN (${placeholders})
      AND source != 'manual'
  `).run(...imageIds);

  library.db.prepare(`
    UPDATE images
    SET process_status = 'thumbnail',
        auto_ai_tag = 1,
        updated_at = datetime('now')
    WHERE id IN (${placeholders})
  `).run(...imageIds);

  const worker = new ProcessingWorker(library, {
    thumbnailConcurrency: 1,
    aiTagConcurrency: 1,
    aiTaskTimeoutMs,
    usePythonEngine,
  });

  const events = [];
  worker.on('taskStarted', (payload) => {
    events.push({ type: 'started', queueType: payload.queueType, imageId: payload.task.image_id, taskId: payload.task.id, at: new Date().toISOString() });
  });
  worker.on('taskCompleted', (payload) => {
    events.push({ type: 'completed', queueType: payload.queueType, imageId: payload.task.image_id, taskId: payload.task.id, at: new Date().toISOString() });
  });
  worker.on('taskFailed', (payload) => {
    events.push({ type: 'failed', queueType: payload.queueType, imageId: payload.task.image_id, taskId: payload.task.id, error: payload.error?.message || String(payload.error), at: new Date().toISOString() });
  });

  await worker.start();
  const batchResult = worker.batchAddAITagTasks(imageIds);

  const startedAt = Date.now();
  const maxWaitMs = aiTaskTimeoutMs * Math.max(2, imageIds.length);
  let lastSnapshot = null;

  while (Date.now() - startedAt < maxWaitMs) {
    const queueRows = pickRows(library.db, `
      SELECT id, image_id, task_type, status, error_message, started_at, completed_at
      FROM processing_queue
      WHERE image_id IN (${placeholders})
      ORDER BY id ASC
    `, imageIds);

    const tags = pickRows(library.db, `
      SELECT it.image_id, t.name, t.category_id, it.source, it.confidence
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id IN (${placeholders})
      ORDER BY it.image_id, it.source, it.confidence DESC
    `, imageIds);

    lastSnapshot = { queueRows, tags };

    const active = queueRows.filter((row) => row.status === 'pending' || row.status === 'processing');
    if (active.length === 0) {
      break;
    }

    await sleep(3000);
  }

  await worker.stop();

  const summary = {
    mode: usePythonEngine ? 'python' : 'xenova',
    batchResult,
    images,
    events,
    finalQueue: lastSnapshot?.queueRows || [],
    finalTags: lastSnapshot?.tags || [],
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

