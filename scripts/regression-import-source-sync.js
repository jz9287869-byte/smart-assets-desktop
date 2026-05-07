const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { LibraryDatabase } = require('../electron/main/libraryDatabase');
const { ImportService } = require('../electron/main/importService');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(targetPath, content = 'test-image') {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-sync-');
  const externalSourcePath = makeTempDir('smart-import-source-');
  const rootImage = path.join(externalSourcePath, '灏侀潰.jpg');
  const nestedImage = path.join(externalSourcePath, '鍔ㄧ墿', '椹兢.jpg');

  writeFile(rootImage);
  writeFile(nestedImage);

  const db = new LibraryDatabase('lib_sync', libraryPath);
  await db.initialize();

  const workerCalls = [];
  const worker = {
    batchAddThumbnailTasks(imageIds) {
      workerCalls.push([...imageIds]);
      db.batchAddThumbnailTasks(imageIds);
    },
  };

  const service = new ImportService(db, worker);

  const firstStats = await service.quickImport(externalSourcePath, { mode: 'standard' });
  assert.strictEqual(firstStats.imported, 2, '棣栨瀵煎叆搴斿鍏?2 寮犲浘鐗?);

  const importSources = service.getImportSources();
  assert.deepStrictEqual(importSources, [path.normalize(externalSourcePath)], '瀵煎叆鏉ユ簮鐩綍璁板綍涓嶆纭?);

  const firstRows = db.db.prepare(`
    SELECT filename, folder, relative_path, auto_ai_tag
    FROM images
    ORDER BY filename
  `).all();

  assert.deepStrictEqual(firstRows, [
    {
      filename: '灏侀潰.jpg',
      folder: path.basename(externalSourcePath),
      relative_path: `${path.basename(externalSourcePath)}/灏侀潰.jpg`,
      auto_ai_tag: 0,
    },
    {
      filename: '椹兢.jpg',
      folder: `${path.basename(externalSourcePath)}/鍔ㄧ墿`,
      relative_path: `${path.basename(externalSourcePath)}/鍔ㄧ墿/椹兢.jpg`,
      auto_ai_tag: 0,
    },
  ], '棣栨瀵煎叆鍚庣殑鐩綍褰掑睘涓嶆纭?);

  const newImage = path.join(externalSourcePath, '鍔ㄧ墿', '鏂板.jpg');
  writeFile(newImage, 'new-image');

  const secondStats = await service.quickImport(externalSourcePath, { mode: 'quick' });
  assert.strictEqual(secondStats.imported, 1, '浜屾鎵弿搴斿彧瀵煎叆鏂板鍥剧墖');

  const importedRows = db.db.prepare(`
    SELECT filename, folder, relative_path
    FROM images
    ORDER BY filename
  `).all();

  assert.deepStrictEqual(importedRows, [
    {
      filename: '灏侀潰.jpg',
      folder: path.basename(externalSourcePath),
      relative_path: `${path.basename(externalSourcePath)}/灏侀潰.jpg`,
    },
    {
      filename: '鏂板.jpg',
      folder: `${path.basename(externalSourcePath)}/鍔ㄧ墿`,
      relative_path: `${path.basename(externalSourcePath)}/鍔ㄧ墿/鏂板.jpg`,
    },
    {
      filename: '椹兢.jpg',
      folder: `${path.basename(externalSourcePath)}/鍔ㄧ墿`,
      relative_path: `${path.basename(externalSourcePath)}/鍔ㄧ墿/椹兢.jpg`,
    },
  ], '鏂板鍥剧墖鍚屾鍚庣洰褰曟垨鐩稿璺緞寮傚父');

  const historyRows = db.db.prepare(`
    SELECT source_path, import_mode, imported_count
    FROM import_history
    ORDER BY id
  `).all();

  assert.strictEqual(historyRows.length, 2, '瀵煎叆鍘嗗彶搴旇褰曚袱娆℃潵婧愭壂鎻?);
  assert.strictEqual(historyRows[0].source_path, externalSourcePath, '棣栨瀵煎叆鍘嗗彶鏉ユ簮璺緞涓嶆纭?);
  assert.strictEqual(historyRows[1].source_path, externalSourcePath, '浜屾鍚屾鍘嗗彶鏉ユ簮璺緞涓嶆纭?);
  assert.strictEqual(historyRows[0].import_mode, 'standard', '棣栨瀵煎叆妯″紡璁板綍閿欒');
  assert.strictEqual(historyRows[1].import_mode, 'quick', '浜屾鍚屾妯″紡璁板綍閿欒');

  assert.strictEqual(workerCalls.length, 1, '浠呮爣鍑嗗鍏ュ簲瑙﹀彂涓€娆＄缉鐣ュ浘闃熷垪');

  db.close();
}

run()
  .then(() => {
    console.log('REGRESSION_IMPORT_SOURCE_SYNC_OK');
  })
  .catch((error) => {
    console.error('REGRESSION_IMPORT_SOURCE_SYNC_FAILED');
    console.error(error);
    process.exitCode = 1;
  });

