const fs = require('fs');
const path = require('path');

const { LibraryDatabase } = require('../electron/main/libraryDatabase');
const { ProcessingWorker } = require('../electron/main/processingWorker');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    limit: 30,
    offset: 0,
    libraryPath: '',
    libraryId: '',
    aiConcurrency: 1,
    aiTaskTimeoutMs: 300000,
    timeoutMs: 3600000,
    cloudEnabled: true,
    resetAiState: true,
    imageIds: [],
  };

  for (const token of argv.slice(2)) {
    if (token.startsWith('--limit=')) args.limit = Math.max(1, Number(token.split('=')[1]) || args.limit);
    if (token.startsWith('--offset=')) args.offset = Math.max(0, Number(token.split('=')[1]) || 0);
    if (token.startsWith('--library-path=')) args.libraryPath = token.slice('--library-path='.length).trim();
    if (token.startsWith('--library-id=')) args.libraryId = token.slice('--library-id='.length).trim();
    if (token.startsWith('--ai-concurrency=')) args.aiConcurrency = Math.max(1, Number(token.split('=')[1]) || 1);
    if (token.startsWith('--ai-task-timeout-ms=')) args.aiTaskTimeoutMs = Math.max(60000, Number(token.split('=')[1]) || args.aiTaskTimeoutMs);
    if (token.startsWith('--timeout-ms=')) args.timeoutMs = Math.max(300000, Number(token.split('=')[1]) || args.timeoutMs);
    if (token === '--no-cloud') args.cloudEnabled = false;
    if (token === '--keep-ai-state') args.resetAiState = false;
    if (token.startsWith('--image-ids=')) {
      args.imageIds = token
        .slice('--image-ids='.length)
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0);
    }
  }

  return args;
}

function readJsonIfExists(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function resolveUserDataDir() {
  const appData = process.env.APPDATA || '';
  const candidates = [
    path.join(appData, '智能素材管理系统数据', 'userData'),
    path.join(appData, 'smart-image-library'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function resolveLibraryPath(args, userDataDir) {
  if (args.libraryPath && fs.existsSync(path.join(args.libraryPath, '.data', 'library.db'))) {
    return args.libraryPath;
  }

  const preferred = 'D:\\素材库';
  if (fs.existsSync(path.join(preferred, '.data', 'library.db'))) {
    return preferred;
  }

  const librariesPath = userDataDir ? path.join(userDataDir, 'libraries.json') : '';
  const libraries = readJsonIfExists(librariesPath);
  if (libraries && Array.isArray(libraries.libraries) && libraries.libraries.length > 0) {
    const active = libraries.libraries.find((item) => item.id === libraries.activeLibraryId) || libraries.libraries[0];
    if (active?.path && fs.existsSync(path.join(active.path, '.data', 'library.db'))) {
      return active.path;
    }
  }

  const driveRoot = 'D:\\';
  try {
    const folders = fs.readdirSync(driveRoot, { withFileTypes: true });
    for (const entry of folders) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(driveRoot, entry.name);
      if (fs.existsSync(path.join(candidate, '.data', 'library.db'))) {
        return candidate;
      }
    }
  } catch (_) {}

  throw new Error('No library path found. Please pass --library-path=');
}

function resolveLibraryId(args, userDataDir, libraryPath) {
  if (args.libraryId) return args.libraryId;

  const librariesPath = userDataDir ? path.join(userDataDir, 'libraries.json') : '';
  const libraries = readJsonIfExists(librariesPath);
  if (libraries && Array.isArray(libraries.libraries)) {
    const match = libraries.libraries.find((item) => item.path === libraryPath);
    if (match?.id) return match.id;
  }

  return `retag_${Date.now()}`;
}

function buildCloudConfig(args, config) {
  const provider = String(config?.cloudReviewProvider || 'openai_compatible').trim() || 'openai_compatible';
  const baseURL = String(config?.cloudReviewBaseUrl || '').trim()
    || (provider === 'google_ai' ? 'https://generativelanguage.googleapis.com' : 'http://127.0.0.1:11434/v1');
  const model = String(config?.cloudReviewModel || '').trim()
    || (provider === 'google_ai' ? 'gemini-1.5-flash' : 'gemma3:4b');
  const timeoutCandidate = Number(config?.cloudReviewTimeoutMs || 180000);
  const timeoutMs = Number.isFinite(timeoutCandidate)
    ? Math.max(15000, Math.min(600000, Math.round(timeoutCandidate)))
    : 180000;

  return {
    enabled: !!args.cloudEnabled,
    provider,
    apiKey: '',
    baseURL,
    model,
    timeoutMs,
  };
}

function chunkedInClause(ids) {
  const placeholders = ids.map(() => '?').join(',');
  return {
    placeholders,
    params: ids,
  };
}

function countAnimalPeopleConflicts(db, ids) {
  if (!ids.length) return 0;
  const { placeholders, params } = chunkedInClause(ids);
  const row = db.prepare(
    `
      SELECT COUNT(DISTINCT i.id) AS count
      FROM images i
      JOIN image_tags ita ON ita.image_id = i.id
      JOIN tags ta ON ta.id = ita.tag_id AND ta.category_id = 'animal'
      JOIN image_tags itp ON itp.image_id = i.id
      JOIN tags tp ON tp.id = itp.tag_id AND tp.category_id = 'people'
      WHERE i.id IN (${placeholders})
    `
  ).get(...params);
  return Number(row?.count || 0);
}

function getTopTags(db, imageId, limit = 12) {
  return db.prepare(
    `
      SELECT t.name, t.category_id AS category, it.source, ROUND(it.confidence, 3) AS confidence
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
      ORDER BY it.confidence DESC, t.name ASC
      LIMIT ?
    `
  ).all(imageId, limit);
}

async function waitForBatchDone(db, imageIds, timeoutMs) {
  const started = Date.now();
  const { placeholders, params } = chunkedInClause(imageIds);
  while (Date.now() - started <= timeoutMs) {
    const row = db.prepare(
      `
        SELECT COUNT(*) AS active
        FROM processing_queue
        WHERE image_id IN (${placeholders})
          AND task_type IN ('thumbnail', 'aiTag')
          AND status IN ('pending', 'processing')
      `
    ).get(...params);

    if (Number(row?.active || 0) === 0) {
      return { done: true, waitedMs: Date.now() - started };
    }
    await sleep(3000);
  }
  return { done: false, waitedMs: Date.now() - started };
}

function resetAiRetagState(db, imageIds) {
  if (!imageIds.length) {
    return {
      queueDeleted: 0,
      imageTagsDeleted: 0,
      imagesReset: 0,
    };
  }

  const { placeholders, params } = chunkedInClause(imageIds);
  const aiSources = [
    'ai',
    'ai_hint',
    'ai_fallback',
    'ai_color',
    'ai_color_hint',
    'ai_weather',
    'ai_weather_floor',
    'ai_season_floor',
    'ai_visual_season',
    'ai_photo_rule',
    'ai_ocr',
    'deepseek_review',
    'mediapipe_face',
    'opencv_body',
    'people_detector',
  ];
  const sourcePlaceholders = aiSources.map(() => '?').join(',');

  const deleteQueue = db.prepare(`
    DELETE FROM processing_queue
    WHERE image_id IN (${placeholders})
      AND task_type IN ('thumbnail', 'aiTag')
      AND status IN ('pending', 'processing', 'failed', 'completed')
  `).run(...params);

  const deleteTags = db.prepare(`
    DELETE FROM image_tags
    WHERE image_id IN (${placeholders})
      AND source IN (${sourcePlaceholders})
  `).run(...params, ...aiSources);

  const resetImages = db.prepare(`
    UPDATE images
    SET process_status = CASE
          WHEN COALESCE(thumbnail_path, '') != '' THEN 'thumbnail'
          ELSE 'imported'
        END,
        auto_ai_tag = 1,
        tagged_at = NULL,
        updated_at = datetime('now')
    WHERE id IN (${placeholders})
      AND is_deleted = 0
  `).run(...params);

  return {
    queueDeleted: Number(deleteQueue?.changes || 0),
    imageTagsDeleted: Number(deleteTags?.changes || 0),
    imagesReset: Number(resetImages?.changes || 0),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const userDataDir = resolveUserDataDir();
  const configPath = userDataDir ? path.join(userDataDir, 'config.json') : '';
  const config = readJsonIfExists(configPath) || {};
  const libraryPath = resolveLibraryPath(args, userDataDir);
  const libraryId = resolveLibraryId(args, userDataDir, libraryPath);
  const cloudReview = buildCloudConfig(args, config);

  const db = new LibraryDatabase(libraryId, libraryPath);
  let worker = null;

  try {
    await db.initialize();

    let candidates = [];
    if (args.imageIds.length > 0) {
      const placeholders = args.imageIds.map(() => '?').join(',');
      candidates = db.db.prepare(
        `
          SELECT id, filename, path, folder, process_status
          FROM images
          WHERE is_deleted = 0
            AND path IS NOT NULL
            AND TRIM(path) != ''
            AND id IN (${placeholders})
          ORDER BY id ASC
        `
      ).all(...args.imageIds);
    } else {
      candidates = db.db.prepare(
        `
          SELECT id, filename, path, folder, process_status
          FROM images
          WHERE is_deleted = 0
            AND path IS NOT NULL
            AND TRIM(path) != ''
          ORDER BY imported_at DESC, id DESC
          LIMIT ? OFFSET ?
        `
      ).all(args.limit, args.offset);
    }

    if (!candidates.length) {
      console.log(JSON.stringify({
        ok: false,
        reason: 'NO_CANDIDATES',
        libraryPath,
        libraryId,
      }, null, 2));
      return;
    }

    const imageIds = candidates.map((row) => row.id);
    const beforeConflictCount = countAnimalPeopleConflicts(db.db, imageIds);
    const beforeTagSnapshot = Object.fromEntries(
      candidates.slice(0, 12).map((row) => [String(row.id), getTopTags(db.db, row.id, 12)])
    );
    const resetSummary = args.resetAiState ? resetAiRetagState(db.db, imageIds) : null;

    worker = new ProcessingWorker(db, {
      thumbnailConcurrency: 2,
      aiTagConcurrency: args.aiConcurrency,
      aiTaskTimeoutMs: args.aiTaskTimeoutMs,
      cpuLimit: Number(config.cpuLimit || 30),
      usePythonEngine: config.usePythonEngine !== false,
      cloudReview,
    });

    const failedEvents = [];
    worker.on('taskFailed', ({ task, error }) => {
      failedEvents.push({
        imageId: task?.image_id || null,
        taskType: task?.task_type || null,
        error: error?.message || String(error),
      });
    });

    await worker.start();
    const queueResult = worker.batchAddAITagTasks(imageIds);
    const waitResult = await waitForBatchDone(db.db, imageIds, args.timeoutMs);
    await worker.stop();
    worker = null;

    const afterConflictCount = countAnimalPeopleConflicts(db.db, imageIds);

    const { placeholders, params } = chunkedInClause(imageIds);
    const queueStats = db.db.prepare(
      `
        SELECT task_type, status, COUNT(*) AS count
        FROM processing_queue
        WHERE image_id IN (${placeholders})
          AND task_type IN ('thumbnail', 'aiTag')
        GROUP BY task_type, status
        ORDER BY task_type, status
      `
    ).all(...params);

    const afterTagSample = candidates.slice(0, 12).map((row) => ({
      id: row.id,
      filename: row.filename,
      process_status: db.db.prepare('SELECT process_status FROM images WHERE id = ?').get(row.id)?.process_status || row.process_status,
      tags: getTopTags(db.db, row.id, 12),
    }));

    const report = {
      ok: true,
      startedAt: new Date().toISOString(),
      libraryPath,
      libraryId,
      cloudReview,
      usePythonEngine: config.usePythonEngine !== false,
      args,
      selectedCount: candidates.length,
      queueResult,
      resetSummary,
      waitResult,
      beforeConflictCount,
      afterConflictCount,
      conflictReducedBy: beforeConflictCount - afterConflictCount,
      queueStats,
      failedEvents,
      sampleBeforeTags: beforeTagSnapshot,
      sampleAfter: afterTagSample,
    };

    const outDir = path.join(process.cwd(), 'scripts', 'reports');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `retag-report-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(JSON.stringify({
      summary: {
        selectedCount: report.selectedCount,
        resetSummary: report.resetSummary,
        waitDone: report.waitResult.done,
        waitedMs: report.waitResult.waitedMs,
        beforeConflictCount: report.beforeConflictCount,
        afterConflictCount: report.afterConflictCount,
        conflictReducedBy: report.conflictReducedBy,
        failedEvents: report.failedEvents.length,
        reportPath: outPath,
      },
      sampleAfter: report.sampleAfter.slice(0, 6),
    }, null, 2));
  } finally {
    if (worker) {
      try {
        await worker.stop();
      } catch (_) {}
    }
    db.close();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
