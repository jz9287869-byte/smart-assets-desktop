const path = require('path');
const { LibraryDatabase } = require('../electron/main/libraryDatabase');
const { ImportService } = require('../electron/main/importService');

async function main() {
  const libraryPath = process.argv[2];
  const sourcePath = process.argv[3];

  if (!libraryPath) {
    console.error('Usage: electron repair-import-folders.js <libraryPath> [sourcePath]');
    process.exit(1);
  }

  const db = new LibraryDatabase('repair', libraryPath);
  await db.initialize();

  const service = new ImportService(db, {
    batchAddThumbnailTasks() {},
  });

  if (sourcePath) {
    service.repairImportedSourceFolders(path.normalize(sourcePath));
    console.log(`REPAIRED_IMPORT_FOLDERS ${sourcePath}`);
  } else {
    service.repairAllImportedFolders();
    console.log('REPAIRED_ALL_IMPORT_FOLDERS');
  }
  db.close?.();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

