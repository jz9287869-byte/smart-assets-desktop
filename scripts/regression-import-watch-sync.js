const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const chokidar = require('chokidar');

const { LibraryDatabase } = require('../electron/main/libraryDatabase');
const { ImportService } = require('../electron/main/importService');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(targetPath, content = 'watch-image') {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, timeoutMs = 8000, intervalMs = 150) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error('waitFor timeout');
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-watch-');
  const sourcePath = makeTempDir('smart-watch-source-');
  const initialImage = path.join(sourcePath, 'cover.jpg');

  writeFile(initialImage, 'initial');

  const db = new LibraryDatabase('lib_watch', libraryPath);
  await db.initialize();

  const worker = {
    batchAddThumbnailTasks(imageIds) {
      db.batchAddThumbnailTasks(imageIds);
    },
  };

  const service = new ImportService(db, worker);
  const supportedFormats = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']);
  let watchRoots = [];
  let watchTimer = null;
  let watcher = null;

  const normalizeWindowsPath = (filePath) => {
    let value = String(filePath || '').trim();
    if (!value) return '';
    value = value.replace(/\//g, '\\').replace(/[\\]+$/g, '');
    if (/^[a-zA-Z]:/.test(value)) value = value[0].toUpperCase() + value.slice(1);
    return value;
  };

  const getImportRoots = () => {
    const roots = new Set([normalizeWindowsPath(libraryPath)]);
    for (const source of service.getImportSources()) {
      roots.add(normalizeWindowsPath(source));
    }
    return Array.from(roots).filter(Boolean);
  };

  const resolveWatchSourceRoot = (triggerPath) => {
    const normalizedTrigger = normalizeWindowsPath(triggerPath);
    const matchedRoot = watchRoots
      .slice()
      .sort((a, b) => b.length - a.length)
      .find((root) => normalizedTrigger === root || normalizedTrigger.startsWith(`${root}\\`));
    return matchedRoot || normalizeWindowsPath(libraryPath);
  };

  const refreshImportSources = async (sourcePaths = null) => {
    const targets = Array.isArray(sourcePaths) && sourcePaths.length > 0
      ? sourcePaths
      : getImportRoots();

    const summary = { imported: 0, scannedSources: [] };
    for (const source of targets) {
      const stats = await service.quickImport(source, { mode: 'quick' });
      summary.imported += stats.imported || 0;
      summary.scannedSources.push(source);
    }
    return summary;
  };

  const scheduleWatchImport = (triggerPath) => {
    if (watchTimer) clearTimeout(watchTimer);
    watchTimer = setTimeout(async () => {
      const sourceRoot = resolveWatchSourceRoot(triggerPath);
      await service.quickImport(sourceRoot, { mode: 'quick' });
    }, 350);
  };

  try {
    const initialStats = await service.quickImport(sourcePath, { mode: 'quick' });
    assert.strictEqual(initialStats.imported, 1, '棣栨瀵煎叆搴斿鍏?1 寮犲浘鐗?);

    watchRoots = getImportRoots();
    assert.deepStrictEqual(
      watchRoots.sort(),
      [normalizeWindowsPath(libraryPath), normalizeWindowsPath(sourcePath)].sort(),
      '鐩戝惉鏍圭洰褰曞簲鍖呭惈璧勬簮搴撴牴鐩綍鍜屽巻鍙插鍏ユ潵婧愮洰褰?
    );

    watcher = chokidar.watch(watchRoots, {
      ignored: [/(^|[\\/])\../, /[\\/]\.data([\\/]|$)/],
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
    });

    watcher.on('add', (addedPath) => {
      const ext = path.extname(addedPath).toLowerCase();
      if (!supportedFormats.has(ext)) return;
      scheduleWatchImport(addedPath);
    });

    await new Promise((resolve) => watcher.once('ready', resolve));

    const watchedImage = path.join(sourcePath, 'animals', 'watched-added.jpg');
    writeFile(watchedImage, 'watch-added');

    await waitFor(() => db.db.prepare(`
      SELECT id
      FROM images
      WHERE filename = ?
    `).get('watched-added.jpg'));

    const watchedRow = db.db.prepare(`
      SELECT folder, relative_path
      FROM images
      WHERE filename = ?
    `).get('watched-added.jpg');

    assert.deepStrictEqual(watchedRow, {
      folder: `${path.basename(sourcePath)}/animals`,
      relative_path: `${path.basename(sourcePath)}/animals/watched-added.jpg`,
    }, '鐩戝惉鑷姩鍚屾鍚庣殑鐩綍褰掑睘涓嶆纭?);

    const refreshImage = path.join(sourcePath, 'animals', 'refresh-added.jpg');
    writeFile(refreshImage, 'refresh-added');

    const refreshStats = await refreshImportSources();
    assert(refreshStats.scannedSources.includes(normalizeWindowsPath(sourcePath)), '鍒锋柊搴旀壂鎻忓巻鍙插鍏ユ潵婧愮洰褰?);
    assert(refreshStats.imported >= 1, '鍒锋柊鍚庡簲瀵煎叆鏂板鍥剧墖');

    const refreshedRow = db.db.prepare(`
      SELECT folder, relative_path
      FROM images
      WHERE filename = ?
    `).get('refresh-added.jpg');

    assert.deepStrictEqual(refreshedRow, {
      folder: `${path.basename(sourcePath)}/animals`,
      relative_path: `${path.basename(sourcePath)}/animals/refresh-added.jpg`,
    }, '鍒锋柊鎸夐挳閾捐矾瀵煎叆鍚庣殑鐩綍褰掑睘涓嶆纭?);
  } finally {
    if (watchTimer) clearTimeout(watchTimer);
    if (watcher) {
      await watcher.close();
    }
    db.close();
  }
}

run()
  .then(() => {
    console.log('REGRESSION_IMPORT_WATCH_SYNC_OK');
    process.exit(0);
  })
  .catch((error) => {
    console.error('REGRESSION_IMPORT_WATCH_SYNC_FAILED');
    console.error(error);
    process.exit(1);
  });

