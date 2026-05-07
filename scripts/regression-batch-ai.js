const fs = require('fs');
const path = require('path');

const { LibraryDatabase } = require('../electron/main/libraryDatabase');
const { ProcessingWorker } = require('../electron/main/processingWorker');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadActiveLibraryConfig() {
  const librariesPath = path.join(process.env.APPDATA, 'smart-image-library', 'libraries.json');
  const raw = fs.readFileSync(librariesPath, 'utf8');
  const config = JSON.parse(raw);
  const activeLibrary =
    config.libraries.find((item) => item.id === config.activeLibraryId) ||
    config.libraries[0] ||
    null;

  if (!activeLibrary) {
    throw new Error('No active library found in libraries.json');
  }

  return activeLibrary;
}

async function main() {
  const activeLibrary = await loadActiveLibraryConfig();
  const db = new LibraryDatabase(activeLibrary.id, activeLibrary.path);
  let worker = null;

  try {
    await db.initialize();

    const candidates = db.db
      .prepare(
        `
          SELECT id, filename, process_status
          FROM images
          WHERE is_deleted = 0
          ORDER BY imported_at DESC
          LIMIT 3
        `
      )
      .all();

    console.log('ACTIVE_LIBRARY', JSON.stringify(activeLibrary));
    console.log('CANDIDATES', JSON.stringify(candidates));

    if (!candidates.length) {
      console.log('NO_IMAGES_TO_TEST');
      return;
    }

    const imageIds = candidates.map((row) => row.id);
    worker = new ProcessingWorker(db, {
      thumbnailConcurrency: 1,
      aiTagConcurrency: 1,
      cpuLimit: 30,
      usePythonEngine: true,
    });

    worker.on('taskFailed', ({ queueType, error, task }) => {
      console.log('TASK_FAILED', queueType, task?.image_id ?? null, error?.message || String(error));
    });

    worker.on('taskCompleted', ({ queueType, task }) => {
      console.log('TASK_COMPLETED', queueType, task?.image_id ?? null);
    });

    worker.on('tasksAdded', (payload) => {
      console.log('TASKS_ADDED', JSON.stringify(payload));
    });

    await worker.start();

    const initStartedAt = Date.now();
    await Promise.race([
      worker.initializeAIEngine(),
      sleep(15000).then(() => {
        throw new Error('AI engine initialization timeout after 15s');
      }),
    ]);
    console.log('ENGINE_READY_MS', Date.now() - initStartedAt);

    worker.batchAddAITagTasks(imageIds);
    await sleep(8000);

    const stats = worker.getStats();
    const queueRows = db.db
      .prepare(
        `
          SELECT image_id, task_type, status, error_message
          FROM processing_queue
          WHERE image_id IN (${imageIds.map(() => '?').join(',')})
          ORDER BY id DESC
          LIMIT 20
        `
      )
      .all(...imageIds);

    console.log('FINAL_STATS', JSON.stringify(stats));
    console.log('QUEUE_ROWS', JSON.stringify(queueRows));
  } finally {
    if (worker) {
      await worker.stop();
    }
    db.close();
  }
}

main()
  .then(() => {
    console.log('REGRESSION_BATCH_AI_OK');
    process.exit(0);
  })
  .catch((error) => {
    console.error('REGRESSION_BATCH_AI_FAILED', error && error.stack ? error.stack : error);
    process.exit(1);
  });

