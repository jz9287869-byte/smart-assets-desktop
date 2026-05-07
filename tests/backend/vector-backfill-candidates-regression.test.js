const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { LibraryDatabase } = require('../../electron/main/libraryDatabase');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-vector-backfill-');
  const db = new LibraryDatabase('lib_vector_backfill', libraryPath);
  await db.initialize();

  try {
    const imageRecords = [
      {
        filename: 'needs-vector.jpg',
        path: path.join(libraryPath, 'samples', 'needs-vector.jpg'),
        folder: 'samples',
        relativePath: 'samples/needs-vector.jpg',
        size: 64,
        format: '.jpg',
        autoAiTag: true,
      },
      {
        filename: 'already-vectorized.jpg',
        path: path.join(libraryPath, 'samples', 'already-vectorized.jpg'),
        folder: 'samples',
        relativePath: 'samples/already-vectorized.jpg',
        size: 64,
        format: '.jpg',
        autoAiTag: true,
      },
    ];

    for (const image of imageRecords) {
      fs.mkdirSync(path.dirname(image.path), { recursive: true });
      fs.writeFileSync(image.path, 'fake-image');
    }

    db.batchInsertImages(imageRecords);

    const rows = db.db.prepare(`
      SELECT id, filename
      FROM images
      ORDER BY filename ASC
    `).all();
    const byFilename = new Map(rows.map((row) => [row.filename, row.id]));

    db.upsertImageVector(byFilename.get('already-vectorized.jpg'), [0.2, 0.3, 0.4], 'seed-model');

    const missing = db.getImagesMissingVectors(10);
    const missingNames = missing.map((row) => row.filename);

    assert(missingNames.includes('needs-vector.jpg'), 'missing-vector image should be returned for backfill');
    assert(!missingNames.includes('already-vectorized.jpg'), 'vectorized image should not be returned for backfill');
    assert.strictEqual(db.countImagesMissingVectors(), 1, 'missing vector count should only include unvectorized images');
  } finally {
    db.close();
  }
}

module.exports = run;
