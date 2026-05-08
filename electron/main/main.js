const { app, BrowserWindow, ipcMain, dialog, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const fsPromises = fs.promises;
const { resolveChineseClipLocalModelPath } = require('./modelPaths');

// 新架构：多资源库管理
const { LibraryManager } = require('./libraryDatabase');
const { ProcessingWorker } = require('./processingWorker');
const { ImportService } = require('./importService');
const { buildNaturalLanguageSearchState } = require('./naturalLanguageSearch');
const { IMAGE_FORMAT_NAMES } = require('./supportedFormats');

// 工具模块
const { ok, fail, wrap } = require('./ipcResponse');
const { signLocalAssetUrl, verifyLocalAssetUrl } = require('./signedUrl');
const { getLogger } = require('./logger');
const Store = require('electron-store');
const chokidar = require('chokidar');

function installSafeConsole() {
  if (global.__SAFE_CONSOLE_INSTALLED__) {
    return;
  }

  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  for (const method of methods) {
    const original = typeof console[method] === 'function' ? console[method].bind(console) : null;
    console[method] = (...args) => {
      try {
        if (original) {
          original(...args);
        }
      } catch (error) {
        if (error?.code !== 'EPIPE') {
          throw error;
        }
      }
    };
  }

  global.__SAFE_CONSOLE_INSTALLED__ = true;
}

installSafeConsole();

const APP_DATA_FOLDER_NAME = '智能素材管理系统数据';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_OPENAI_COMPATIBLE_MODEL = 'gemma3:4b';
const DEFAULT_GOOGLE_AI_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_CLOUD_REVIEW_TIMEOUT_MS = 180000;

function hasLocalChineseClipModel() {
  return Boolean(resolveChineseClipLocalModelPath());
}

function ensureDirectorySync(dirPath) {
  if (!dirPath) return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDirContentsSync(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  ensureDirectorySync(targetDir);
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirContentsSync(sourcePath, targetPath);
      continue;
    }
    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function resolveManagedAppDataRoot() {
  const configuredRoot = String(process.env.SMART_ASSETS_APP_DATA_ROOT || '').trim();
  if (configuredRoot) {
    return configuredRoot;
  }

  return path.join(app.getPath('appData'), APP_DATA_FOLDER_NAME);
}

function relocateAppPathsToManagedRoot() {
  if (!app || typeof app.getPath !== 'function' || typeof app.setPath !== 'function') {
    return;
  }

  const appDataRoot = resolveManagedAppDataRoot();
  const userDataDir = path.join(appDataRoot, 'userData');
  const sessionDataDir = path.join(appDataRoot, 'sessionData');
  const logsDir = path.join(appDataRoot, 'logs');
  const crashDumpsDir = path.join(appDataRoot, 'crashDumps');

  ensureDirectorySync(appDataRoot);
  ensureDirectorySync(userDataDir);
  ensureDirectorySync(sessionDataDir);
  ensureDirectorySync(logsDir);
  ensureDirectorySync(crashDumpsDir);

  const previousUserDataDir = path.join(app.getPath('appData'), app.getName());
  if (path.resolve(previousUserDataDir) !== path.resolve(userDataDir) && fs.existsSync(previousUserDataDir)) {
    copyDirContentsSync(previousUserDataDir, userDataDir);
  }

  app.setPath('userData', userDataDir);
  app.setPath('sessionData', sessionDataDir);
  app.setPath('crashDumps', crashDumpsDir);
  app.setAppLogsPath(logsDir);
}

relocateAppPathsToManagedRoot();

// 日志实例延迟初始化
let logger = null;
let loggerInitialized = false;
function getLoggerInstance() {
  if (!loggerInitialized && typeof app !== 'undefined' && app) {
    logger = getLogger({ logDir: path.join(app.getPath('userData'), 'logs') });
    loggerInitialized = true;
  }
  return logger;
}

function installMainProcessErrorGuards() {
  if (global.__MAIN_PROCESS_ERROR_GUARDS_INSTALLED__) {
    return;
  }

  let epipeLogged = false;

  const swallowEpipe = (error) => {
    if (error?.code === 'EPIPE') {
      if (!epipeLogged) {
        epipeLogged = true;
        try {
          getLoggerInstance()?.warn('Swallowed EPIPE from process stream', { code: error.code, message: error.message });
        } catch (_) {}
      }
      return true;
    }
    return false;
  };

  if (process.stdout?.on) {
    process.stdout.on('error', (error) => {
      if (!swallowEpipe(error)) {
        try {
          getLoggerInstance()?.error('stdout stream error', error);
        } catch (_) {}
      }
    });
  }

  if (process.stderr?.on) {
    process.stderr.on('error', (error) => {
      if (!swallowEpipe(error)) {
        try {
          getLoggerInstance()?.error('stderr stream error', error);
        } catch (_) {}
      }
    });
  }

  process.on('uncaughtException', (error) => {
    if (swallowEpipe(error)) {
      return;
    }
    try {
      getLoggerInstance()?.error('Main process uncaught exception', {
        message: error?.message,
        stack: error?.stack
      });
    } catch (_) {}
  });

  process.on('unhandledRejection', (reason) => {
    if (swallowEpipe(reason)) {
      return;
    }
    try {
      getLoggerInstance()?.error('Main process unhandled rejection', {
        message: reason?.message || String(reason),
        stack: reason?.stack || null
      });
    } catch (_) {}
  });

  global.__MAIN_PROCESS_ERROR_GUARDS_INSTALLED__ = true;
}

installMainProcessErrorGuards();

// 注册自定义安全协议
function registerPrivilegedSchemes() {
  if (typeof protocol !== 'undefined' && protocol) {
    try {
      protocol.registerSchemesAsPrivileged([
        {
          scheme: 'smart-image',
          privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
        }
      ]);
    } catch (e) {
      // 协议可能已注册，忽略重复注册错误
    }
  }
}

// 配置存储
const store = new Store({
  name: 'config',
  defaults: {
    watchFolders: [],
    trashFolder: 'D:\\素材库回收站',
    supportedFormats: [...IMAGE_FORMAT_NAMES],
    cpuLimit: 30,
    usePythonEngine: hasLocalChineseClipModel(),
    enableCloudReview: true,
    cloudReviewProvider: 'openai_compatible',
    cloudReviewBaseUrl: DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    cloudReviewModel: DEFAULT_OPENAI_COMPATIBLE_MODEL,
    cloudReviewTimeoutMs: DEFAULT_CLOUD_REVIEW_TIMEOUT_MS,
    deepseekBaseUrl: DEFAULT_DEEPSEEK_BASE_URL,
    deepseekModel: DEFAULT_DEEPSEEK_MODEL,
    activeUserId: 1,
    signedUrlTtlSec: 120,
    signedUrlSecret: null,
    // 新架构配置
    libraryVersion: '2.0',
    activeLibraryId: null
  }
});

// 全局变量
let mainWindow;
let libraryManager;      // 新：资源库管理器

// 初始化时清理无效的 watchFolders
const currentWatchFolders = store.get('watchFolders') || [];
const validWatchFolders = currentWatchFolders.filter(f => typeof f === 'string');
if (validWatchFolders.length !== currentWatchFolders.length) {
  store.set('watchFolders', validWatchFolders);
}
const currentSupportedFormats = Array.isArray(store.get('supportedFormats')) ? store.get('supportedFormats') : [];
const normalizedSupportedFormats = [...IMAGE_FORMAT_NAMES];
const hasOnlySupportedImages = currentSupportedFormats.length === normalizedSupportedFormats.length
  && currentSupportedFormats.every((ext, index) => String(ext || '').toLowerCase() === normalizedSupportedFormats[index]);
if (!hasOnlySupportedImages) {
  store.set('supportedFormats', normalizedSupportedFormats);
}
let currentLibrary = null;
let currentWorker = null;
let currentImportService = null;
let libraryWatcher = null;
let libraryWatchTimer = null;
let libraryWatchRoots = [];
let workerHealthTimer = null;



// ==================== 工具函数 ====================

function getSignedUrlSecret() {
  let secret = store.get('signedUrlSecret');
  if (secret && typeof secret === 'string' && secret.length >= 32) return secret;
  secret = require('crypto').randomBytes(32).toString('hex');
  store.set('signedUrlSecret', secret);
  return secret;
}

function getCloudReviewConfig() {
  const envEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.SMART_ASSETS_ENABLE_CLOUD_REVIEW || '').trim().toLowerCase());
  const storeEnabled = !!store.get('enableCloudReview');
  const provider = String(
    process.env.SMART_ASSETS_CLOUD_REVIEW_PROVIDER
      || store.get('cloudReviewProvider')
      || 'openai_compatible'
  ).trim() || 'openai_compatible';
  const apiKey = String(
    process.env.SMART_ASSETS_CLOUD_REVIEW_API_KEY
      || process.env.DEEPSEEK_API_KEY
      || ''
  ).trim();
  const configuredBaseURL = String(
    process.env.SMART_ASSETS_CLOUD_REVIEW_BASE_URL
      || store.get('cloudReviewBaseUrl')
      || ''
  ).trim();
  const configuredModel = String(
    process.env.SMART_ASSETS_CLOUD_REVIEW_MODEL
      || store.get('cloudReviewModel')
      || ''
  ).trim();
  // Backward-compat: explicit env can still override defaults for legacy DeepSeek deployments.
  const legacyBaseURL = String(process.env.DEEPSEEK_BASE_URL || '').trim();
  const legacyModel = String(process.env.DEEPSEEK_MODEL || '').trim();
  const fallbackBaseURL = provider === 'google_ai'
    ? DEFAULT_GOOGLE_AI_BASE_URL
    : (legacyBaseURL || DEFAULT_OPENAI_COMPATIBLE_BASE_URL);
  const fallbackModel = provider === 'google_ai'
    ? (legacyModel || DEFAULT_DEEPSEEK_MODEL)
    : (legacyModel || DEFAULT_OPENAI_COMPATIBLE_MODEL);
  const timeoutCandidate = Number(
    process.env.SMART_ASSETS_CLOUD_REVIEW_TIMEOUT_MS
      || store.get('cloudReviewTimeoutMs')
      || DEFAULT_CLOUD_REVIEW_TIMEOUT_MS
  );
  const timeoutMs = Number.isFinite(timeoutCandidate)
    ? Math.max(15000, Math.min(600000, Math.round(timeoutCandidate)))
    : DEFAULT_CLOUD_REVIEW_TIMEOUT_MS;

  return {
    enabled: envEnabled || storeEnabled,
    provider,
    apiKey,
    baseURL: configuredBaseURL || fallbackBaseURL,
    model: configuredModel || fallbackModel,
    timeoutMs
  };
}

function applyCloudReviewConfigToWorker() {
  if (!currentWorker?.deepseekReviewer || typeof currentWorker.deepseekReviewer.updateConfig !== 'function') {
    return;
  }

  currentWorker.deepseekReviewer.updateConfig(getCloudReviewConfig());
}

function getCloudReviewConfigResponse() {
  const config = getCloudReviewConfig();
  return {
    success: true,
    enabled: !!config.enabled,
    provider: config.provider || 'openai_compatible',
    baseURL: config.baseURL || '',
    model: config.model || '',
    hasApiKey: Boolean(config.apiKey),
    timeoutMs: config.timeoutMs,
  };
}

function normalizeWindowsPath(p) {
  let s = String(p || '').trim();
  if (!s) return '';
  s = s.replace(/\//g, '\\');
  s = s.replace(/[\\]+$/g, '');
  if (/^[a-zA-Z]:/.test(s)) s = s[0].toUpperCase() + s.slice(1);
  return s;
}

function attachSignedUrls(image) {
  if (!image || typeof image !== 'object') return image;

  const ttlSec = Number(store.get('signedUrlTtlSec')) || 120;
  const expiresAtMs = Date.now() + ttlSec * 1000;
  const secret = getSignedUrlSecret();
  const next = { ...image };
  const imageFilePath = image.current_path || image.path;
  const thumbnailPath = image.thumbnail_path && fs.existsSync(image.thumbnail_path)
    ? image.thumbnail_path
    : null;
  next.thumbnail_path = thumbnailPath;

  try {
    if (imageFilePath) {
      next.signed_image_url = signLocalAssetUrl({
        filePath: imageFilePath,
        expiresAtMs,
        secret
      }).url;
    }

    if (thumbnailPath) {
      next.signed_thumbnail_url = signLocalAssetUrl({
        filePath: thumbnailPath,
        expiresAtMs,
        secret
      }).url;
    }
  } catch (error) {
    const log = getLoggerInstance();
    if (log && typeof log.warn === 'function') {
      log.warn('Failed to generate signed asset URL', {
        imageId: image.id,
        error: error.message
      });
    }
  }

  return next;
}

function attachSignedUrlsToList(images) {
  if (!Array.isArray(images)) return [];
  return images.map(attachSignedUrls);
}

function getTrashFolderPath() {
  return normalizeWindowsPath(store.get('trashFolder') || 'D:\\素材库回收站');
}

function getDeletionRecordRoot() {
  return getTrashFolderPath();
}

function getDailyDeletionFolder(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return path.join(getDeletionRecordRoot(), `${year}-${month}-${day}删除图片记录`);
}

function ensureDirectory(dirPath) {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getUniqueFilePath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath;

  const parsed = path.parse(targetPath);
  let counter = 1;
  let candidate = targetPath;
  while (fs.existsSync(candidate)) {
    candidate = path.join(parsed.dir, `${parsed.name}_${counter}${parsed.ext}`);
    counter += 1;
  }
  return candidate;
}

async function moveFileWithCrossDeviceSupport(sourcePath, targetPath) {
  ensureDirectory(path.dirname(targetPath));

  try {
    await fsPromises.rename(sourcePath, targetPath);
    return;
  } catch (error) {
    if (!['EXDEV', 'EPERM'].includes(error?.code)) {
      throw error;
    }
  }

  await fsPromises.copyFile(sourcePath, targetPath);
  await fsPromises.unlink(sourcePath);
}

async function archiveDeletedImage({ image, reason = 'permanently_delete' }) {
  const sourcePath = image?.current_path || image?.path || '';
  const filename = image?.filename || (sourcePath ? path.basename(sourcePath) : `image_${image?.id || Date.now()}`);
  const archiveDir = getDailyDeletionFolder();
  ensureDirectory(archiveDir);
  const archiveLabel = path.basename(archiveDir);

  let archivedPath = sourcePath;
  if (sourcePath && fs.existsSync(sourcePath)) {
    archivedPath = getUniqueFilePath(path.join(archiveDir, filename));
    ensureDirectory(path.dirname(archivedPath));
    await moveFileWithCrossDeviceSupport(sourcePath, archivedPath);
  }

  const recordPath = path.join(archiveDir, `${archiveLabel}.jsonl`);
  const record = {
    archivedAt: new Date().toISOString(),
    reason,
    imageId: image?.id || null,
    filename,
    originalPath: image?.path || '',
    sourcePath,
    archivedPath,
    deleteBatch: image?.delete_batch || null
  };
  await fsPromises.appendFile(recordPath, `${JSON.stringify(record)}\n`, 'utf8');

  return { archivedPath, archiveDir, recordPath };
}

function getDailyBackupFolder(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function backupLibraryDatabase(libDb) {
  const dbFilePath = libDb?.dbFilePath;
  if (!dbFilePath || !fs.existsSync(dbFilePath)) {
    return { skipped: true, reason: 'db_missing' };
  }

  const backupRoot = path.join(path.dirname(dbFilePath), 'backups', getDailyBackupFolder());
  ensureDirectory(backupRoot);

  const version = (typeof app?.getVersion === 'function' ? app.getVersion() : 'dev').replace(/[^\w.-]+/g, '_');
  const libraryLabel = String(libDb?.libraryId || 'library').replace(/[^\w.-]+/g, '_');
  const backupPath = path.join(backupRoot, `${libraryLabel}-v${version}.db`);

  if (fs.existsSync(backupPath)) {
    return { skipped: true, reason: 'already_backed_up', backupPath };
  }

  const escapedBackupPath = backupPath.replace(/'/g, "''");
  libDb.db.exec(`VACUUM INTO '${escapedBackupPath}'`);
  return { skipped: false, backupPath };
}

// ==================== 资源库管理 ====================

async function initializeLibrarySystem() {
  getLoggerInstance().info('初始化资源库系统...');
  
  libraryManager = new LibraryManager();
  await libraryManager.initialize();
  
  // recovered from corrupted comment
  const activeLibrary = libraryManager.getActiveLibrary();
  if (activeLibrary) {
    await activateLibrary(activeLibrary.libraryId);
  }
  
  getLoggerInstance().info('资源库系统初始化完成');
}

async function activateLibrary(libraryId) {
  getLoggerInstance().info(`激活资源库: ${libraryId}`);
  
  // recovered from corrupted comment
  if (currentWorker) {
    await currentWorker.stop();
    currentWorker = null;
  }
  
  // 加载新资源库
  const libDb = await libraryManager.loadLibrary(libraryId);
  currentLibrary = libDb;
  libraryManager.setActiveLibrary(libraryId);

  try {
    const backupResult = await backupLibraryDatabase(libDb);
    if (!backupResult?.skipped) {
      getLoggerInstance().info('资源库数据库已自动备份', {
        libraryId,
        backupPath: backupResult.backupPath
      });
    }
  } catch (error) {
    getLoggerInstance().warn('资源库数据库自动备份失败', {
      libraryId,
      dbPath: libDb?.dbFilePath,
      error: error.message
    });
  }
  
  await ensureWorkerReady(libDb);

  const overview = currentLibrary.getLibraryOverview();
  if ((overview?.total || 0) === 0) {
    try {
      await currentImportService.quickImport(currentLibrary.libraryPath, { mode: 'quick' });
    } catch (error) {
      getLoggerInstance().warn('Auto import on activate failed', {
        libraryId,
        path: currentLibrary.libraryPath,
        error: error.message
      });
    }
  }
  
  getLoggerInstance().info(`资源库已激活: ${libraryId}`);
  return libDb;
}

async function ensureWorkerReady(libDb = currentLibrary) {
  if (!libDb) {
    throw new Error('资源库未加载');
  }

  if (currentWorker?.isRunning) {
    return currentWorker;
  }

  if (currentWorker && !currentWorker.isRunning) {
    try {
      await currentWorker.stop();
    } catch (_) {}
    currentWorker = null;
  }

  const usePythonEngine = !!store.get('usePythonEngine');
  const cpuLimit = store.get('cpuLimit') || 30;
  const aiTagConcurrency = resolveAiTagConcurrency({ usePythonEngine, cpuLimit });
  const cloudReview = getCloudReviewConfig();

  const worker = new ProcessingWorker(libDb, {
    thumbnailConcurrency: 2,
    aiTagConcurrency,
    cpuLimit,
    usePythonEngine,
    cloudReview
  });

  await worker.start();

  worker.on('statsUpdated', (stats) => {
    if (mainWindow) {
      mainWindow.webContents.send('processing-stats', stats);
    }
  });

  worker.on('pythonEngine:health-warning', () => {
    if (mainWindow) {
      mainWindow.webContents.send('warning', {
        type: 'pythonEngine',
        message: 'Python AI 引擎需要关注，可能存在性能问题'
      });
    }
  });

  worker.on('started', () => {
    if (mainWindow) {
      mainWindow.webContents.send('processing-stats', worker.getStats());
    }
  });

  worker.on('taskCompleted', ({ task, queueType }) => {
    if (queueType === 'thumbnail' || queueType === 'aiTag' || queueType === 'manualTag') {
      notifyTagDataChanged({
        imageId: task?.image_id,
        taskId: task?.id,
        source: queueType === 'aiTag'
          ? 'ai'
          : queueType === 'manualTag'
            ? 'manual'
            : 'thumbnail',
      });
    }
  });

  worker.on('stopped', () => {
    if (currentWorker === worker) {
      currentWorker = null;
    }
    if (mainWindow) {
      mainWindow.webContents.send('processing-stats', {
        ...worker.getStats(),
        isRunning: false
      });
    }
  });

  currentWorker = worker;
  currentImportService = new ImportService(libDb, currentWorker);
  await startLibraryWatcher();
  store.set('activeLibraryId', libDb.libraryId);
  startWorkerHealthMonitor();

  getLoggerInstance().info('处理器已就绪', {
    libraryId: libDb.libraryId,
    libraryPath: libDb.libraryPath,
    aiTagConcurrency
  });

  return currentWorker;
}

async function clearActiveLibrary() {
  stopWorkerHealthMonitor();
  stopLibraryWatcher();
  if (currentWorker) {
    await currentWorker.stop();
    currentWorker = null;
  }

  currentImportService = null;
  currentLibrary = null;
  libraryManager.setActiveLibrary(null);
  store.set('activeLibraryId', null);
}

// ==================== 窗口管理 ====================

function stopLibraryWatcher() {
  if (libraryWatchTimer) {
    clearTimeout(libraryWatchTimer);
    libraryWatchTimer = null;
  }

  if (libraryWatcher) {
    libraryWatcher.close();
    libraryWatcher = null;
  }

  libraryWatchRoots = [];
}

function stopWorkerHealthMonitor() {
  if (workerHealthTimer) {
    clearInterval(workerHealthTimer);
    workerHealthTimer = null;
  }
}

function getQueuedTaskCounts(libDb = currentLibrary) {
  if (!libDb?.db) {
    return { pending: 0, processing: 0 };
  }

  const row = libDb.db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing
    FROM processing_queue
    WHERE status IN ('pending', 'processing')
  `).get();

  return {
    pending: Number(row?.pending || 0),
    processing: Number(row?.processing || 0),
  };
}

function startWorkerHealthMonitor() {
  stopWorkerHealthMonitor();

  workerHealthTimer = setInterval(async () => {
    if (!currentLibrary) {
      return;
    }

    const counts = getQueuedTaskCounts(currentLibrary);
    if (counts.pending + counts.processing === 0) {
      return;
    }

    try {
      if (!currentWorker || !currentWorker.isRunning) {
        await ensureWorkerReady(currentLibrary);
        return;
      }

      currentWorker.processQueue('thumbnail');
      currentWorker.processQueue('aiTag');
    } catch (error) {
      getLoggerInstance()?.warn('Worker health monitor failed', {
        error: error.message,
        pending: counts.pending,
        processing: counts.processing,
      });
    }
  }, 5000);
}

function notifyTagDataChanged(payload = {}) {
  if (mainWindow) {
    let enrichedPayload = payload;
    const imageId = Number(payload?.imageId);

    if (currentLibrary && Number.isInteger(imageId) && imageId > 0) {
      try {
        const image = currentLibrary.db.prepare(`
          SELECT i.*, GROUP_CONCAT(DISTINCT t.name) AS tags
          FROM images i
          LEFT JOIN image_tags it ON it.image_id = i.id
          LEFT JOIN tags t ON t.id = it.tag_id
          WHERE i.id = ?
          GROUP BY i.id
          LIMIT 1
        `).get(imageId);

        if (image) {
          enrichedPayload = {
            ...payload,
            image: attachSignedUrls(image),
          };
        }
      } catch (error) {
        getLoggerInstance()?.warn('Failed to enrich image-tagged payload', {
          imageId,
          error: error.message,
        });
      }
    }

    mainWindow.webContents.send('image-tagged', enrichedPayload);
  }
}

function notifyImageDeleted(payload = {}) {
  if (mainWindow) {
    mainWindow.webContents.send('image-deleted', payload);
  }
}

async function moveImagesToTrash(ids = []) {
  if (!currentLibrary) {
    return { success: false, error: '请先选择资源库' };
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return { success: false, error: '未提供要移入回收站的图片' };
  }

  const numericIds = ids
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (numericIds.length === 0) {
    return { success: false, error: '图片 ID 无效' };
  }

  const batchId = `trash_${Date.now()}`;
  const trashFolder = getTrashFolderPath();
  const batchDir = path.join(trashFolder, batchId);
  ensureDirectory(batchDir);

  const placeholders = numericIds.map(() => '?').join(',');
  const images = currentLibrary.db.prepare(`
    SELECT id, path, filename
    FROM images
    WHERE id IN (${placeholders})
  `).all(...numericIds);

  const updateStmt = currentLibrary.db.prepare(`
    UPDATE images
    SET is_deleted = 1, delete_batch = ?, current_path = ?
    WHERE id = ?
  `);

  for (const image of images) {
    const sourcePath = image.path;
    let targetPath = sourcePath;

    if (sourcePath && fs.existsSync(sourcePath)) {
      targetPath = getUniqueFilePath(path.join(batchDir, image.filename || path.basename(sourcePath)));
      ensureDirectory(path.dirname(targetPath));
      await moveFileWithCrossDeviceSupport(sourcePath, targetPath);
    }

    updateStmt.run(batchId, targetPath, image.id);
  }

  notifyImageDeleted({ imageIds: images.map((image) => image.id), batchId, source: 'manual-trash' });
  return { success: true, batchId, deletedCount: images.length };
}

function resolveAiTagConcurrency({ usePythonEngine, cpuLimit }) {
  const cpuCount = Math.max(1, Number(os.cpus?.().length || 1));
  const normalizedCpuLimit = Number.isFinite(Number(cpuLimit)) ? Number(cpuLimit) : 30;

  if (usePythonEngine) {
    if (cpuCount >= 12 && normalizedCpuLimit >= 60) return 3;
    return cpuCount >= 8 && normalizedCpuLimit >= 35 ? 2 : 1;
  }

  if (cpuCount >= 12 && normalizedCpuLimit >= 55) return 3;
  return cpuCount >= 6 && normalizedCpuLimit >= 30 ? 2 : 1;
}

async function getLibraryImportRoots() {
  const roots = new Set();

  if (currentImportService?.getImportSources) {
    for (const sourcePath of currentImportService.getImportSources()) {
      const normalizedPath = normalizeWindowsPath(sourcePath);
      if (normalizedPath) {
        roots.add(normalizedPath);
      }
    }
  }

  return Array.from(roots).filter((item) => item && fs.existsSync(item));
}

async function refreshImportSources(sourcePaths = null) {
  if (!currentImportService) {
    return { imported: 0, skipped: 0, errors: 0, scannedSources: [] };
  }

  const targets = Array.isArray(sourcePaths) && sourcePaths.length > 0
    ? sourcePaths
    : await getLibraryImportRoots();

  const summary = {
    imported: 0,
    skipped: 0,
    errors: 0,
    scannedSources: [],
  };

  for (const sourcePath of targets) {
    try {
      const stats = await currentImportService.quickImport(sourcePath, { mode: 'quick' });
      summary.imported += stats?.imported || 0;
      summary.skipped += stats?.skipped || 0;
      summary.errors += stats?.errors || 0;
      summary.scannedSources.push(sourcePath);
    } catch (error) {
      summary.errors += 1;
      getLoggerInstance().warn('Refresh import source failed', { path: sourcePath, error: error.message });
    }
  }

  return summary;
}

function resolveWatchSourceRoot(triggerPath) {
  const normalizedTriggerPath = normalizeWindowsPath(triggerPath || '');
  if (!normalizedTriggerPath) return libraryWatchRoots[0] || null;

  const matchedRoot = libraryWatchRoots
    .slice()
    .sort((a, b) => b.length - a.length)
    .find((rootPath) => normalizedTriggerPath === rootPath || normalizedTriggerPath.startsWith(`${rootPath}\\`));

  return matchedRoot || null;
}

function scheduleLibraryWatchImport(triggerPath = null) {
  if (libraryWatchTimer) {
    clearTimeout(libraryWatchTimer);
  }

  libraryWatchTimer = setTimeout(async () => {
    if (!currentLibrary || !currentImportService) return;

    try {
      const sourceRoot = resolveWatchSourceRoot(triggerPath);
      if (!sourceRoot) return;
      const stats = await currentImportService.quickImport(sourceRoot, { mode: 'quick', triggerPath });
      if ((stats?.imported || 0) > 0 && mainWindow) {
        mainWindow.webContents.send('image-added', { imported: stats.imported, triggerPath, sourceRoot });
      }
    } catch (error) {
      getLoggerInstance().warn('Auto watch import failed', { path: triggerPath, error: error.message });
    }
  }, 1200);
}

async function startLibraryWatcher() {
  stopLibraryWatcher();

  const supportedFormats = new Set((store.get('supportedFormats') || []).map((ext) => '.' + String(ext).toLowerCase()));
  const watchRoots = await getLibraryImportRoots();
  if (watchRoots.length === 0) return;
  libraryWatchRoots = watchRoots;

  libraryWatcher = chokidar.watch(watchRoots, {
    ignored: [/(^|[\\/])\../, /[\\/]\.data([\\/]|$)/],
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1200, pollInterval: 200 }
  });

  libraryWatcher.on('add', (watchPath) => {
    const ext = path.extname(watchPath).toLowerCase();
    if (!supportedFormats.has(ext)) return;
    scheduleLibraryWatchImport(watchPath);
  });

  libraryWatcher.on('unlink', () => {
    if (mainWindow) {
      mainWindow.webContents.send('image-deleted');
    }
  });

  libraryWatcher.on('error', (error) => {
    getLoggerInstance().warn('Library watcher error', { paths: watchRoots, error: error.message });
  });
}

function registerAssetProtocol() {
  try {
    protocol.registerFileProtocol('smart-image', (request, callback) => {
      try {
        const u = new URL(request.url);
        if (u.hostname !== 'asset') return callback({ error: -6 });
        const filePath = decodeURIComponent(u.searchParams.get('path') || '');
        const exp = u.searchParams.get('exp');
        const sig = u.searchParams.get('sig');
        const v = verifyLocalAssetUrl({ filePath, exp, sig, secret: getSignedUrlSecret() });
        if (!v.ok) return callback({ error: -6 });
        if (!filePath) return callback({ error: -6 });
        if (!fs.existsSync(filePath)) return callback({ error: -6 });
        const st = fs.statSync(filePath);
        if (!st.isFile()) return callback({ error: -6 });
        return callback({ path: filePath });
      } catch (_) {
        return callback({ error: -6 });
      }
    });
  } catch (_) {}
}

function createWindow() {
  getLoggerInstance().info('创建主窗口...');
  
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: '智能素材管理系统',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: false
    },
    icon: fs.existsSync(path.join(__dirname, '../../assets/icon.ico')) 
      ? path.join(__dirname, '../../assets/icon.ico') 
      : undefined,
    show: true
  });

  getLoggerInstance().info('主窗口已创建');

  const htmlPath = app.isPackaged
    ? path.join(process.resourcesPath, 'frontend', 'build', 'index.html')
    : path.join(__dirname, '../../frontend/build/index.html');
  getLoggerInstance().info('HTML 路径:', htmlPath);
  getLoggerInstance().info('HTML 文件存在:', fs.existsSync(htmlPath));

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    getLoggerInstance().error('页面加载失败:', { errorCode, errorDescription, validatedURL });
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    getLoggerInstance().info('渲染进程控制台', { level, message, line, sourceId });
  });

  mainWindow.loadFile(htmlPath).then(() => {
    getLoggerInstance().info('HTML 加载成功');
  }).catch(err => {
    getLoggerInstance().error('HTML 加载失败:', err);
    dialog.showErrorBox('加载失败', err.message);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ==================== 应用生命周期 ====================

async function quickInitialize() {
  try {
    getLoggerInstance().info('快速初始化...');
    registerAssetProtocol();
    createWindow();

    // 初始化资源库系统
    try {
      await initializeLibrarySystem();
    } catch (err) {
      getLoggerInstance().error('资源库系统初始化失败:', err);
      // 继续运行，允许用户通过 UI 重试
    }

  } catch (error) {
    getLoggerInstance().error('快速启动失败:', error);
    dialog.showErrorBox('启动失败', error.message);
    app.quit();
  }
}

app.whenReady().then(async () => {
  // 初始化日志
  getLoggerInstance();
  if (logger) logger.info('应用就绪');
  
  // 注册协议
  registerPrivilegedSchemes();
  
  await quickInitialize();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (currentWorker) {
    await currentWorker.stop();
  }
});

// ==================== IPC 通信：资源库管理 ====================

// 获取所有资源库（包含图片统计）
ipcMain.handle('library:list', async () => {
  if (!libraryManager) return { success: false, error: '系统未初始化' };
  const libraries = libraryManager.getAllLibraries();

  // 为每个资源库补充图片统计信息
  for (const lib of libraries) {
    try {
      const libDb = await libraryManager.loadLibrary(lib.id);
      const overview = libDb.getLibraryOverview();
      lib.total = overview?.total || 0;
      lib.sourceCount = typeof libDb.getImportSourceCount === 'function' ? libDb.getImportSourceCount() : 0;
    } catch (_) {
      lib.total = 0;
      lib.sourceCount = 0;
    }
  }

  return { success: true, libraries };
});

// recovered from corrupted comment
ipcMain.handle('library:create', async (event, { name }) => {
  try {
    if (!libraryManager) throw new Error('系统未初始化');

    const config = await libraryManager.createLibrary(name);
    
    // recovered from corrupted comment
    await activateLibrary(config.id);

    return { success: true, library: config, importStats: null };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// recovered from corrupted comment
ipcMain.handle('library:switch', async (event, { libraryId }) => {
  try {
    await activateLibrary(libraryId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// recovered from corrupted comment
ipcMain.handle('library:delete', async (event, { libraryId }) => {
  try {
    if (!libraryManager) throw new Error('System not ready');

    const libraries = libraryManager.getAllLibraries();
    const target = libraries.find(lib => lib.id === libraryId);
    if (!target) {
      throw new Error('Library not found');
    }

    const remainingLibraries = libraries.filter(lib => lib.id !== libraryId);
    const fallbackLibrary = remainingLibraries[0] || null;

    if (currentLibrary?.libraryId === libraryId) {
      if (fallbackLibrary) {
        await activateLibrary(fallbackLibrary.id);
      } else {
        await clearActiveLibrary();
      }
    }

    libraryManager.deleteLibrary(libraryId);

    return {
      success: true,
      deletedLibraryId: libraryId,
      nextLibraryId: fallbackLibrary?.id || null
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('library:rename', async (event, { libraryId, name }) => {
  try {
    if (!libraryManager) throw new Error('系统未初始化');
    const library = libraryManager.renameLibrary(libraryId, name);
    return { success: true, library };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('library:refresh', async () => {
  try {
    if (!currentLibrary || !currentImportService) {
      return { success: false, error: 'Please select a library first' };
    }

    const stats = await refreshImportSources();
    await startLibraryWatcher();
    return { success: true, stats };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('library:cleanup-people-mislabels', async () => {
  if (currentLibrary && !currentWorker) {
    await ensureWorkerReady(currentLibrary);
  }
  if (!currentLibrary || !currentWorker) {
    return { success: false, error: '请先选择资源库' };
  }

  try {
    const candidateImageIds = currentLibrary.getPeopleMislabelCandidateImageIds(500);
    if (candidateImageIds.length === 0) {
      return {
        success: true,
        candidates: 0,
        requested: 0,
        queued: 0,
        message: '当前资源库没有可复核的人物误标候选图片',
      };
    }

    const queueResult = currentWorker.batchAddAITagTasks(candidateImageIds);
    try {
      currentWorker.processQueue('aiTag');
    } catch (_) {}

    return {
      success: true,
      candidates: candidateImageIds.length,
      requested: Number(queueResult?.requested || 0),
      queued: Number(queueResult?.totalQueued || 0),
      thumbnailQueued: Number(queueResult?.thumbnailQueued || 0),
      aiQueued: Number(queueResult?.aiQueued || 0),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('library:status', async () => {
  if (!currentLibrary) {
    return { success: true, active: false };
  }
  
  const overview = currentLibrary.getLibraryOverview();
  const stats = currentWorker ? currentWorker.getStats() : null;
  const libraryConfig = libraryManager?.getAllLibraries?.().find(
    (library) => library.id === currentLibrary.libraryId
  );
  
  return {
    success: true,
    active: true,
    libraryId: currentLibrary.libraryId,
    name: libraryConfig?.name || '',
    path: libraryConfig?.path || '',
    overview,
    stats
  };
});

// ==================== IPC 通信：导入功能 ====================

// recovered from corrupted comment
ipcMain.handle('import:select-folder', async () => {
  if (!mainWindow) throw new Error('窗口未初始化');
  
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择要导入的文件夹'
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, cancelled: true };
  }
  
  return { success: true, path: result.filePaths[0] };
});

// 预览导入
ipcMain.handle('import:preview', async (event, { folderPath }) => {
  try {
    if (!currentImportService) {
        return { success: false, error: '请先选择或创建资源库' };
    }

    const preview = await currentImportService.previewImport(folderPath);
    return { success: true, preview };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 执行导入
ipcMain.handle('import:start', async (event, { folderPath, mode = 'quick' }) => {
  try {
    if (!currentImportService) {
        return { success: false, error: '请先选择或创建资源库' };
    }

    // recovered from corrupted comment
    const progressCallback = (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('import:progress', progress);
      }
    };
    
    const stats = await currentImportService.quickImport(folderPath, { mode }, progressCallback);
    await startLibraryWatcher();
    
    return { success: true, stats };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 获取导入历史
ipcMain.handle('import:history', async () => {
  if (!currentImportService) {
    return { success: true, history: [] };
  }
  
  const history = currentImportService.getImportHistory(10);
  return { success: true, history };
});

// ==================== IPC 通信：队列控制 ====================

// 获取处理统计
ipcMain.handle('queue:stats', async () => {
  if (!currentWorker && currentLibrary) {
    await ensureWorkerReady(currentLibrary);
  }
  if (!currentWorker) {
    return { success: false, error: '处理器未启动' };
  }
  
  return { success: true, stats: currentWorker.getStats() };
});

// 暂停/继续队列
ipcMain.handle('queue:control', async (event, { queueType, action }) => {
  if (!currentWorker && currentLibrary) {
    await ensureWorkerReady(currentLibrary);
  }
  if (!currentWorker) {
    return { success: false, error: '处理器未启动' };
  }
  
  if (action === 'pause') {
    currentWorker.pauseQueue(queueType);
  } else if (action === 'resume') {
    currentWorker.resumeQueue(queueType);
  }
  
  return { success: true };
});

// ==================== IPC 通信：图片浏览 ====================

// 获取图片列表
ipcMain.handle('images:list', async (event, options = {}) => {
  if (!currentLibrary) {
    return { success: false, error: '请先选择资源库' };
  }
  
  try {
    const images = attachSignedUrlsToList(currentLibrary.searchImages(options));
    return { success: true, images };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 获取待打标签图片
ipcMain.handle('images:untagged', async (event, { limit = 50, offset = 0 }) => {
  if (!currentLibrary) {
    return { success: false, error: '请先选择资源库' };
  }
  
  try {
    const images = attachSignedUrlsToList(currentLibrary.getUntaggedImages(limit, offset));
    return { success: true, images };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('images:untagged-ids', async () => {
  if (!currentLibrary) {
    return { success: false, error: '请先选择资源库', ids: [] };
  }

  try {
    const ids = typeof currentLibrary.getUntaggedImageIds === 'function'
      ? currentLibrary.getUntaggedImageIds()
      : [];
    return { success: true, ids, total: ids.length };
  } catch (error) {
    return { success: false, error: error.message, ids: [] };
  }
});

// ==================== IPC 通信：标签管理 ====================

// recovered from corrupted comment
ipcMain.handle('images:deleted', async (event, { limit = 50, offset = 0 } = {}) => {
  if (!currentLibrary) {
    return { success: false, error: 'Please select a library first' };
  }

  try {
    const images = currentLibrary.db.prepare(`
      SELECT i.*, GROUP_CONCAT(t.name) as tags
      FROM images i
      LEFT JOIN image_tags it ON i.id = it.image_id
      LEFT JOIN tags t ON it.tag_id = t.id
      WHERE i.is_deleted = 1
      GROUP BY i.id
      ORDER BY i.imported_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    return { success: true, images: attachSignedUrlsToList(images) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('tags:list', async () => {
  if (!currentLibrary) {
    return { success: false, error: '请先选择资源库' };
  }
  
  try {
    const tags = currentLibrary.getTagsByCategory();
    return { success: true, tags };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 添加标签
ipcMain.handle('tags:add', async (event, { categoryId, name, parentId, color }) => {
  if (!currentLibrary) {
    return { success: false, error: '请先选择资源库' };
  }
  
  try {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return { success: false, error: '标签名称不能为空' };
    }
    
    // 检查重复：同一分类下不允许同名标签
    const existing = currentLibrary.db.prepare(`
      SELECT id FROM tags WHERE category_id = ? AND name = ?
    `).get(categoryId, trimmedName);
    
    if (existing) {
      return { success: false, error: '该分类下已存在同名标签' };
    }
    
    const tagId = currentLibrary.addTag(categoryId, trimmedName, parentId, color, 'user');
    return { success: true, tagId };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 给图片打标签
ipcMain.handle('tags:assign', async (event, { imageId, tagId, confidence = 1.0 }) => {
  if (!currentLibrary) {
    return { success: false, error: '请先选择资源库' };
  }
  
  try {
    currentLibrary.tagImage(imageId, tagId, confidence, 'manual');
    notifyTagDataChanged({ imageId, tagId, source: 'manual' });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 删除标签
ipcMain.handle('tags:delete', async (event, { tagId }) => {
  if (!currentLibrary) {
    return { success: false, error: '请先选择资源库' };
  }
  
  try {
    const deleted = currentLibrary.deleteTag(tagId);
    if (deleted) {
      notifyTagDataChanged({ tagId, source: 'delete' });
    }
    return { success: true, deleted };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// recovered from corrupted comment
ipcMain.handle('tags:rename', async (event, { tagId, name }) => {
  if (!currentLibrary) {
    return { success: false, error: '请先选择资源库' };
  }
  
  try {
    const updated = currentLibrary.renameTag(tagId, name);
    return { success: true, updated };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 更新标签颜色
ipcMain.handle('tags:update', async (event, { tagId, color }) => {
  if (!currentLibrary) {
    return { success: false, error: '请先选择资源库' };
  }
  
  try {
    const updated = currentLibrary.updateTagColor(tagId, color);
    return { success: true, updated };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 新建标签分类
ipcMain.handle('tag_categories:add', async (event, { id, name }) => {
  if (!currentLibrary) {
    return { success: false, error: '请先选择资源库' };
  }
  
  try {
    currentLibrary.addTagCategory(id, name);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// recovered from corrupted comment
ipcMain.handle('tag_categories:delete', async (event, { categoryId }) => {
  if (!currentLibrary) {
    return { success: false, error: '请先选择资源库' };
  }
  
  try {
    // 检查是否为系统预设分类
    const cat = currentLibrary.db.prepare(`SELECT is_system FROM tag_categories WHERE id = ?`).get(categoryId);
    if (cat && cat.is_system) {
      return { success: false, error: '系统预设分类不可删除' };
    }

    const affectedImages = currentLibrary.db.prepare(`
      SELECT DISTINCT it.image_id
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE t.category_id = ?
    `).all(categoryId);

    // recovered from corrupted comment
    const transaction = currentLibrary.db.transaction(() => {
      // 1. 删除分类下所有标签的图片关联
      currentLibrary.db.prepare(`
        DELETE FROM image_tags WHERE tag_id IN (SELECT id FROM tags WHERE category_id = ?)
      `).run(categoryId);
      
      // 2. 删除分类下所有标签
      currentLibrary.db.prepare(`DELETE FROM tags WHERE category_id = ?`).run(categoryId);
      
      // 3. 删除分类本身
      currentLibrary.db.prepare(`DELETE FROM tag_categories WHERE id = ?`).run(categoryId);

      for (const row of affectedImages) {
        currentLibrary.reconcileImageStatus(row.image_id);
      }
    });
    
    transaction();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 获取标签分类列表
ipcMain.handle('tag_categories:list', async () => {
  if (!currentLibrary) {
    return { success: false, error: '请先选择资源库' };
  }
  
  try {
    const categories = currentLibrary.getTagCategories();
    return { success: true, categories };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== 旧架构兼容 IPC ====================

// recovered from corrupted comment
ipcMain.handle('get-config', () => store.store);
ipcMain.handle('update-config', (event, newConfig) => {
  const nextConfig = { ...(newConfig || {}) };
  if (typeof nextConfig.trashFolder === 'string') {
    nextConfig.trashFolder = normalizeWindowsPath(nextConfig.trashFolder);
  }
  store.set(nextConfig);
  return store.store;
});

// 文件夹管理（旧架构兼容）
ipcMain.handle('select-folder', async () => {
  if (!mainWindow) return { success: false, error: '窗口未初始化' };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择文件夹'
  });
  if (result.canceled) return { success: false, cancelled: true };
  return { success: true, path: result.filePaths[0] };
});

ipcMain.handle('add-watch-folder', async (event, folderPath) => {
  try {
    const folders = store.get('watchFolders') || [];
    if (!folders.includes(folderPath)) {
      folders.push(folderPath);
      store.set('watchFolders', folders);
    }
    return { success: true, folders };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('remove-watch-folder', async (event, folderPath, deletePhysical = false) => {
  try {
    let folders = store.get('watchFolders') || [];
    folders = folders.filter(f => f !== folderPath);
    store.set('watchFolders', folders);
    return { success: true, folders };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-folder-tree', async () => {
  // recovered from corrupted comment
  if (!currentLibrary) {
    return { success: false, error: '请先选择资源库', tree: [] };
  }
  
  try {
    // recovered from corrupted comment
    const folders = currentLibrary.db.prepare(`
      SELECT DISTINCT folder FROM images WHERE is_deleted = 0 ORDER BY folder
    `).all().map(r => r.folder).filter(f => f);
    
    return { success: true, tree: folders };
  } catch (error) {
    return { success: false, error: error.message, tree: [] };
  }
});

// 新增：为 FolderTree 提供专门的 API
ipcMain.handle('library:folder-tree', async () => {
  if (!currentLibrary) {
    return { success: false, error: '请先选择资源库', tree: [] };
  }
  
  try {
    const folders = currentLibrary.db.prepare(`
      SELECT DISTINCT folder FROM images WHERE is_deleted = 0 ORDER BY folder
    `).all().map(r => r.folder).filter(f => f);
    
    return { success: true, tree: folders };
  } catch (error) {
    return { success: false, error: error.message, tree: [] };
  }
});

// recovered from corrupted comment
ipcMain.handle('search-images', async (event, query) => {
  if (!currentLibrary) return { success: false, error: '请先选择资源库', images: [] };
  try {
    const images = attachSignedUrlsToList(currentLibrary.searchImages(query || {}));
    return { success: true, images };
  } catch (error) {
    return { success: false, error: error.message, images: [] };
  }
});

function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timer = null;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => {
        if (timer) {
          clearTimeout(timer);
        }
      });
  });
}

async function executeNaturalLanguageSearch(payload = {}) {
  const searchState = buildNaturalLanguageSearchState(currentLibrary, payload || {});
  const {
    query,
    limit,
    parsedQuery,
    candidates,
    strictResults,
  } = searchState;

  let mode = 'strict';
  let selectedResults = strictResults;

  let vectorSearchApplied = false;
  let vectorCoverage = { available: 0, total: selectedResults.length, computed: 0 };
  let cloudRerankApplied = false;
  let cloudRerankCoverage = { scored: 0, total: selectedResults.length };

  try {
    if (currentWorker && selectedResults.length) {
      const rerankTimeoutMs = Math.max(800, Math.min(8000, Number(payload.semanticRerankTimeoutMs) || 3500));
      const rerankResult = await withTimeout(
        currentWorker.rerankNaturalLanguageMatches(
          selectedResults,
          parsedQuery,
          {
            query,
            maxToCompute: 0,
            skipCloudRerank: true,
          }
        ),
        rerankTimeoutMs,
        `自然语言语义重排超过 ${rerankTimeoutMs}ms，已先返回数据库匹配结果`
      );

      if (rerankResult?.vectorSearchApplied) {
        vectorSearchApplied = true;
        vectorCoverage = rerankResult.vectorCoverage || vectorCoverage;
      }
      if (rerankResult?.cloudRerankApplied) {
        cloudRerankApplied = true;
        cloudRerankCoverage = rerankResult.cloudRerankCoverage || cloudRerankCoverage;
      }
      selectedResults = rerankResult.images || selectedResults;
    }
  } catch (error) {
    console.warn('[NaturalSearch] Semantic rerank skipped:', error.message);
  }

  let usedKeywordFallback = false;
  if (!parsedQuery.hasStructuredIntent && !selectedResults.length && query) {
    mode = 'keyword';
    usedKeywordFallback = true;
    selectedResults = currentLibrary.searchImages({
      keyword: query,
      limit,
      offset: 0,
      status: payload.status,
      folderPath: payload.folderPath,
    }).map((image) => ({
      ...image,
      natural_search_score: 1,
      natural_search_summary: ['按原始关键词模糊匹配'],
      natural_search_match: {
        matchedRequiredTags: [],
        missingRequiredTags: [],
        matchedImplicitTags: [],
        matchedKeywordHints: [query],
        matchedExcludedTags: [],
      },
      strictMatch: false,
      relaxedMatch: true,
    }));
    vectorCoverage = { available: 0, total: selectedResults.length, computed: 0 };
    cloudRerankCoverage = { scored: 0, total: selectedResults.length };
  }

  return {
    images: selectedResults.slice(0, limit),
    intent: parsedQuery,
    mode,
    usedKeywordFallback,
    total: selectedResults.length,
    candidateCount: candidates.length,
    vectorSearchApplied,
    vectorCoverage,
    cloudRerankApplied,
    cloudRerankCoverage,
  };
}

ipcMain.handle('search-images-natural', async (event, payload = {}) => {
  if (!currentLibrary) {
    return {
      success: false,
      error: '请先选择资源库',
      images: [],
      intent: null,
      mode: 'strict',
      total: 0,
    };
  }

  try {
    const result = await executeNaturalLanguageSearch(payload || {});
    return {
      success: true,
      images: attachSignedUrlsToList(result.images || []),
      intent: result.intent || null,
      mode: result.mode || 'strict',
      usedKeywordFallback: !!result.usedKeywordFallback,
      total: Number(result.total || 0),
      candidateCount: Number(result.candidateCount || 0),
      vectorSearchApplied: !!result.vectorSearchApplied,
      vectorCoverage: result.vectorCoverage || { available: 0, total: 0, computed: 0 },
      cloudRerankApplied: !!result.cloudRerankApplied,
      cloudRerankCoverage: result.cloudRerankCoverage || { scored: 0, total: 0 },
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      images: [],
      intent: null,
      mode: 'strict',
      total: 0,
    };
  }
});

ipcMain.handle('images:natural-search', async (event, payload = {}) => {
  if (!currentLibrary) {
    return {
      success: false,
      error: '请先选择资源库',
      images: [],
      intent: null,
      mode: 'strict',
      total: 0,
    };
  }

  try {
    const result = await executeNaturalLanguageSearch(payload || {});
    return {
      success: true,
      images: attachSignedUrlsToList(result.images || []),
      intent: result.intent || null,
      mode: result.mode || 'strict',
      usedKeywordFallback: !!result.usedKeywordFallback,
      total: Number(result.total || 0),
      candidateCount: Number(result.candidateCount || 0),
      vectorSearchApplied: !!result.vectorSearchApplied,
      vectorCoverage: result.vectorCoverage || { available: 0, total: 0, computed: 0 },
      cloudRerankApplied: !!result.cloudRerankApplied,
      cloudRerankCoverage: result.cloudRerankCoverage || { scored: 0, total: 0 },
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      images: [],
      intent: null,
      mode: 'strict',
      total: 0,
    };
  }
});

// 获取回收站批次（旧架构兼容）
ipcMain.handle('get-trash-batches', async () => {
  if (!currentLibrary) return { success: true, data: [] };
  try {
    const batches = currentLibrary.db.prepare(`
      SELECT DISTINCT delete_batch as batch_name, 
             COUNT(*) as count, 
             MAX(imported_at) as deleted_at
      FROM images 
      WHERE is_deleted = 1 AND delete_batch IS NOT NULL
      GROUP BY delete_batch 
      ORDER BY deleted_at DESC
    `).all();
    return { success: true, data: batches };
  } catch (error) {
    return { success: true, data: [] };
  }
});

ipcMain.handle('get-folders', async () => {
  if (!currentLibrary) return { success: true, folders: [] };
  try {
    const folders = currentLibrary.db.prepare(`
      SELECT folder, COUNT(*) as count FROM images 
      WHERE is_deleted = 0 GROUP BY folder
    `).all();
    return { success: true, folders };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-tags', async () => {
  if (!currentLibrary) return { success: true, tags: [] };
  try {
    const tags = currentLibrary.getTagsByCategory();
    return { success: true, tags };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-stats', async () => {
  if (!currentLibrary) {
    return { success: true, stats: { total: 0, thumbnail: 0, tagged: 0 } };
  }
  try {
    const overview = currentLibrary.getLibraryOverview();
    return { success: true, stats: overview };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// recovered from corrupted comment
ipcMain.handle('move-to-trash', async (event, ids) => {
  try {
    return await moveImagesToTrash(ids);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('library:delete-folder', async (event, { folderPath, deleteMode = 'trash' } = {}) => {
  if (!currentLibrary) return { success: false, error: '请先选择资源库' };

  try {
    const normalizedFolder = String(folderPath || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalizedFolder) {
      return { success: false, error: '未提供要删除的目录' };
    }

    const images = currentLibrary.db.prepare(`
      SELECT id
      FROM images
      WHERE is_deleted = 0
        AND (
          folder = ?
          OR folder LIKE ?
          OR folder LIKE ?
        )
    `).all(
      normalizedFolder,
      `${normalizedFolder}/%`,
      `${normalizedFolder}\\%`
    );

    if (images.length === 0) {
      return { success: false, error: '该目录下没有可删除的图片' };
    }

    if (deleteMode === 'detach') {
      const imageIds = images.map((row) => row.id);
      const placeholders = imageIds.map(() => '?').join(',');
      const tagUsageRows = currentLibrary.db.prepare(`
        SELECT it.tag_id, COUNT(*) AS usage_count
        FROM image_tags it
        WHERE it.image_id IN (${placeholders})
        GROUP BY it.tag_id
      `).all(...imageIds);

      const detachTransaction = currentLibrary.db.transaction(() => {
        if (typeof currentLibrary.addExcludedFolder === 'function') {
          currentLibrary.addExcludedFolder(normalizedFolder);
        }

        for (const row of tagUsageRows) {
          currentLibrary.db.prepare(`
            UPDATE tags
            SET usage_count = MAX(0, usage_count - ?)
            WHERE id = ?
          `).run(Number(row.usage_count || 0), row.tag_id);
        }

        currentLibrary.db.prepare(`
          DELETE FROM images
          WHERE id IN (${placeholders})
        `).run(...imageIds);
      });

      detachTransaction();
      notifyImageDeleted({ imageIds, folderPath: normalizedFolder, source: 'library-detach' });

      return {
        success: true,
        deletedCount: imageIds.length,
        mode: 'detach',
      };
    }

    const result = await moveImagesToTrash(images.map((row) => row.id));
    if (!result?.success) {
      return result || { success: false, error: '目录删除失败' };
    }

    return {
      success: true,
      deletedCount: images.length,
      batchId: result.batchId,
      mode: 'trash',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-in-folder', async (event, filePath) => {
  try {
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-image-native', async (event, filePath) => {
  try {
    shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('copy-image-to-clipboard', async (event, filePath) => {
  try {
    const { nativeImage } = require('electron');
    const image = nativeImage.createFromPath(filePath);
    const clipboard = require('electron').clipboard;
    clipboard.writeImage(image);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('copy-path-to-clipboard', async (event, text) => {
  try {
    const clipboard = require('electron').clipboard;
    clipboard.writeText(text);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-tag-to-image', async (event, imageId, tagName) => {
  if (!currentLibrary) return { success: false, error: '请先选择资源库' };
  try {
    const trimmedName = typeof tagName === 'string' ? tagName.trim() : '';
    if (!trimmedName) {
      return { success: false, error: '标签名称不能为空' };
    }

    const existingTag = currentLibrary.findTagByName(trimmedName, { preferNonCustom: true });
    const tagId = existingTag?.id || currentLibrary.addTag('custom', trimmedName, null, null, 'user');
    currentLibrary.tagImage(imageId, tagId, 1.0, 'manual');
    notifyTagDataChanged({ imageId, tagId, source: 'manual' });
    return {
      success: true,
      reusedExisting: Boolean(existingTag),
      tag: existingTag ? {
        id: existingTag.id,
        name: existingTag.name,
        categoryId: existingTag.category_id,
      } : null,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('remove-tag-from-image', async (event, imageId, tagName) => {
  if (!currentLibrary) return { success: false, error: '请先选择资源库' };
  try {
    currentLibrary.untagImage(imageId, tagName);
    notifyTagDataChanged({ imageId, tagName, source: 'manual-remove' });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-disk-quota', async (event, patch) => {
  return { success: true };
});

ipcMain.handle('list-jobs', async (event, query) => {
  return { success: true, data: [] };
});

ipcMain.handle('get-job-stats', async (event, query) => {
  return { success: true, data: {} };
});

ipcMain.handle('retry-job', async (event, id) => {
  return { success: true };
});

ipcMain.handle('sanitize-watch-folders', async () => {
  return { success: true };
});

// recovered from corrupted comment
ipcMain.handle('trigger-ai-tagging', async (event, imageId) => {
  if (currentLibrary && !currentWorker) {
    await ensureWorkerReady(currentLibrary);
  }
  if (!currentLibrary || !currentWorker) return { success: false, error: '系统未初始化' };
  try {
    const result = currentWorker.batchAddAITagTasks([imageId]);
    if (!result?.totalQueued) {
      return { success: false, error: '没有可加入 AI 队列的图片' };
    }
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('batch-ai-tagging', async (event, imageIds) => {
  if (currentLibrary && !currentWorker) {
    await ensureWorkerReady(currentLibrary);
  }
  if (!currentLibrary || !currentWorker) return { success: false, error: '系统未初始化' };
  try {
    const result = currentWorker.batchAddAITagTasks(imageIds);
    if (!result?.totalQueued) {
      return { success: false, error: '没有可加入 AI 队列的图片' };
    }
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-manual-tags', async (event, imageId, tags) => {
  if (!currentLibrary) return { success: false, error: '请先选择资源库' };
  try {
    for (const tagName of tags) {
      const trimmedName = typeof tagName === 'string' ? tagName.trim() : '';
      if (!trimmedName) continue;

      const existingTag = currentLibrary.findTagByName(trimmedName, { preferNonCustom: true });
      const tagId = existingTag?.id || currentLibrary.addTag('custom', trimmedName, null, null, 'user');
      currentLibrary.tagImage(imageId, tagId, 1.0, 'manual');
      notifyTagDataChanged({ imageId, tagId, source: 'manual' });
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 缩略图（旧架构兼容）
ipcMain.handle('regenerate-thumbnails', async (event, imageIds) => {
  if (currentLibrary && !currentWorker) {
    await ensureWorkerReady(currentLibrary);
  }
  if (!currentLibrary || !currentWorker) return { success: false, error: '系统未初始化' };
  try {
    currentWorker.batchAddThumbnailTasks(imageIds);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// recovered from corrupted comment
ipcMain.handle('get-signed-url', async (event, payload) => {
  try {
    const url = signLocalAssetUrl({ ...payload, secret: getSignedUrlSecret() });
    return { success: true, url };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-from-trash', async (event, batchId) => {
  if (!currentLibrary) return { success: false, error: '请先选择资源库' };
  try {
    const images = currentLibrary.db.prepare(`
      SELECT id, filename, path, current_path, delete_batch
      FROM images
      WHERE delete_batch = ?
    `).all(batchId);

    let archiveDir = '';
    for (const image of images) {
      const archived = await archiveDeletedImage({
        image,
        reason: 'delete_from_trash_batch'
      });
      archiveDir = archiveDir || archived.archiveDir;
    }

    currentLibrary.db.prepare(`
      DELETE FROM images WHERE delete_batch = ?
    `).run(batchId);
    return { success: true, archiveDir };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('restore-images', async (event, ids) => {
  if (!currentLibrary) return { success: false, error: 'Please select a library first' };
  try {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { success: true };
    }

    const images = currentLibrary.db.prepare(`
      SELECT id, path, current_path
      FROM images
      WHERE id IN (${ids.join(',')})
    `).all();

    const updateStmt = currentLibrary.db.prepare(`
      UPDATE images
      SET is_deleted = 0, delete_batch = NULL, current_path = path
      WHERE id = ?
    `);

    for (const image of images) {
      if (
        image.current_path &&
        image.path &&
        image.current_path !== image.path &&
        !fs.existsSync(image.current_path) &&
        !fs.existsSync(image.path)
      ) {
        throw new Error(`Restore source missing: ${image.current_path}`);
      }

      if (
        image.current_path &&
        image.path &&
        image.current_path !== image.path &&
        fs.existsSync(image.current_path)
      ) {
        ensureDirectory(path.dirname(image.path));
        await moveFileWithCrossDeviceSupport(image.current_path, image.path);
      }

      updateStmt.run(image.id);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('restore-from-trash', async (event, batchId) => {
  if (!currentLibrary) return { success: false, error: '请先选择资源库' };
  try {
    const images = currentLibrary.db.prepare(`
      SELECT id, path, current_path
      FROM images
      WHERE delete_batch = ?
    `).all(batchId);

    const updateStmt = currentLibrary.db.prepare(`
      UPDATE images
      SET is_deleted = 0, delete_batch = NULL, current_path = path
      WHERE id = ?
    `);

    for (const image of images) {
      if (
        image.current_path &&
        image.path &&
        image.current_path !== image.path &&
        !fs.existsSync(image.current_path) &&
        !fs.existsSync(image.path)
      ) {
        throw new Error(`Restore source missing: ${image.current_path}`);
      }

      if (
        image.current_path &&
        image.path &&
        image.current_path !== image.path &&
        fs.existsSync(image.current_path)
      ) {
        ensureDirectory(path.dirname(image.path));
        await moveFileWithCrossDeviceSupport(image.current_path, image.path);
      }

      updateStmt.run(image.id);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('permanently-delete', async (event, ids) => {
  if (!currentLibrary) return { success: false, error: 'Please select a library first' };
  try {
    // Archive deleted files into the daily deletion folder instead of removing them from disk.
    if (!Array.isArray(ids) || ids.length === 0) {
      return { success: true };
    }

    const images = currentLibrary.db.prepare(`
      SELECT id, filename, path, current_path, delete_batch
      FROM images WHERE id IN (${ids.join(',')})
    `).all();

    let archiveDir = '';
    for (const img of images) {
      try {
        const archiveResult = await archiveDeletedImage({
          image: img,
          reason: 'permanently_delete'
        });
        if (!archiveDir && archiveResult?.archiveDir) {
          archiveDir = archiveResult.archiveDir;
        }
      } catch (e) {
        console.error('Failed to archive deleted image:', img.path, e);
      }
    }

    currentLibrary.db.prepare(`DELETE FROM images WHERE id IN (${ids.join(',')})`).run();
    return { success: true, archiveDir };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-disk-status', async (event, targetPath) => {
  try {
    const { execSync } = require('child_process');
    const output = execSync(`wmic logicaldisk where "DeviceID='${targetPath[0]}:'" get FreeSpace,Size /value`, { encoding: 'utf8' });
    const freeMatch = output.match(/FreeSpace=(\d+)/);
    const sizeMatch = output.match(/Size=(\d+)/);
    return {
      success: true,
      free: freeMatch ? parseInt(freeMatch[1]) : 0,
      total: sizeMatch ? parseInt(sizeMatch[1]) : 0
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-ai-status', async () => {
  try {
    if (!currentWorker) {
      return { success: true, status: 'not_initialized', message: '处理器未启动' };
    }
    
    // recovered from corrupted comment
    if (currentWorker.pythonEngineManager) {
      const status = currentWorker.pythonEngineManager.getStatus();
      return { 
        success: true, 
        engine: 'python',
        running: status.running,
        pid: status.pid,
        pendingRequests: status.pendingRequests,
        uptime: status.uptime,
        lastHeartbeat: status.lastHeartbeat
      };
    }
    
    // 回退到 Xenova 状态
    if (currentWorker.aiEngine) {
      return { 
        success: true, 
        engine: 'xenova',
        status: 'initialized',
        model: 'Xenova/chinese-clip-vit-base-patch16'
      };
    }
    
    return { success: true, status: 'not_initialized', message: 'AI 引擎未初始化' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('restart-python-engine', async () => {
  try {
    if (!currentWorker || !currentWorker.pythonEngineManager) {
      return { success: false, error: 'Python 引擎未运行' };
    }
    
    console.log('[IPC] Restarting Python engine...');
    await currentWorker.pythonEngineManager.stop();
    await new Promise(resolve => setTimeout(resolve, 1000)); // 等待 1 秒
    await currentWorker.pythonEngineManager.start();
    
    return { success: true, message: 'Python 引擎已重启' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('ai:initialize', async () => {
  try {
    if (currentWorker) {
      await currentWorker.initializeAIEngine();
      return { success: true };
    }
    return { success: false, error: '处理器未启动' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('ai:analyze', async (event, { imagePath }) => {
  try {
    if (!currentWorker) {
      return { success: false, error: '处理器未启动' };
    }
    await currentWorker.initializeAIEngine();
    
    // 优先使用 Python 引擎
    if (currentWorker.pythonEngineManager) {
      try {
        const result = await currentWorker.pythonEngineManager.analyzeImage(imagePath);
        return { success: true, ...result };
      } catch (error) {
        console.warn('[AIEngine] Python analysis failed, falling back to Xenova:', error.message);
      }
    }
    
    // 回退到 Xenova
    if (!currentWorker.aiEngine) {
      return { success: false, error: 'AI 引擎初始化失败' };
    }
    
    const result = await currentWorker.aiEngine.analyzeImage(imagePath);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== Python 引擎配置管理 ====================

ipcMain.handle('config:set-python-engine', async (event, enabled) => {
  try {
    store.set('usePythonEngine', enabled);
    
    if (currentWorker) {
      currentWorker.usePythonEngine = enabled;
      
      // 如果启用，尝试启动 Python 引擎
      if (enabled && !currentWorker.pythonEngineManager) {
        try {
          await currentWorker.initializeAIEngine();
          return { success: true, message: 'Python 引擎已启用' };
        } catch (error) {
          store.set('usePythonEngine', false);
          currentWorker.usePythonEngine = false;
          return { success: false, error: '无法启动 Python 引擎: ' + error.message };
        }
      }
      
      return { success: true, message: '配置已更新，重启应用后生效' };
    }
    
    return { success: true, message: '配置已保存' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('config:get-python-engine', async () => {
  try {
    const enabled = !!store.get('usePythonEngine');
    const available = hasLocalChineseClipModel();
    const status = {
      enabled,
      available,
      running: false,
      pid: null,
      message: enabled ? '等待启动' : (available ? '可启用' : '未启用')
    };
    
    if (currentWorker && currentWorker.pythonEngineManager) {
      const engineStatus = currentWorker.pythonEngineManager.getStatus();
      status.running = engineStatus.running;
      status.pid = engineStatus.pid;
      status.message = engineStatus.running ? '运行中' : '已停止';
    }
    
    return { success: true, ...status };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('config:get-cloud-review', async () => {
  try {
    return getCloudReviewConfigResponse();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('config:set-cloud-review', async (event, payload = {}) => {
  try {
    const provider = String(payload?.provider || 'openai_compatible').trim() || 'openai_compatible';
    const normalizedBaseUrl = String(payload?.baseURL || '').trim().replace(/\/+$/, '');
    const normalizedModel = String(payload?.model || '').trim();
    const timeoutCandidate = Number(payload?.timeoutMs);
    const normalizedTimeoutMs = Number.isFinite(timeoutCandidate)
      ? Math.max(15000, Math.min(600000, Math.round(timeoutCandidate)))
      : Number(store.get('cloudReviewTimeoutMs') || DEFAULT_CLOUD_REVIEW_TIMEOUT_MS);
    const apiKeyProvided = Object.prototype.hasOwnProperty.call(payload || {}, 'apiKey');
    const normalizedApiKey = String(payload?.apiKey || '').trim();
    const enabled = Boolean(payload?.enabled);

    store.set({
      enableCloudReview: enabled,
      cloudReviewProvider: provider,
      cloudReviewBaseUrl: normalizedBaseUrl,
      cloudReviewModel: normalizedModel,
      cloudReviewTimeoutMs: normalizedTimeoutMs,
    });

    if (apiKeyProvided) {
      if (normalizedApiKey) {
        process.env.SMART_ASSETS_CLOUD_REVIEW_API_KEY = normalizedApiKey;
      } else {
        delete process.env.SMART_ASSETS_CLOUD_REVIEW_API_KEY;
      }
    }

    process.env.SMART_ASSETS_CLOUD_REVIEW_PROVIDER = provider;
    process.env.SMART_ASSETS_CLOUD_REVIEW_BASE_URL = normalizedBaseUrl;
    process.env.SMART_ASSETS_CLOUD_REVIEW_MODEL = normalizedModel;
    process.env.SMART_ASSETS_CLOUD_REVIEW_TIMEOUT_MS = String(normalizedTimeoutMs);
    process.env.SMART_ASSETS_ENABLE_CLOUD_REVIEW = enabled ? 'true' : 'false';

    applyCloudReviewConfigToWorker();
    return getCloudReviewConfigResponse();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 涓昏繘绋嬫ā鍧楀姞杞藉畬鎴?

