const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { LibraryDatabase } = require('../../electron/main/libraryDatabase');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-vector-storage-');
  const imagePath = path.join(libraryPath, 'samples', 'vector.jpg');
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, 'fake-image');

  const db = new LibraryDatabase('lib_vector_storage', libraryPath);
  await db.initialize();

  try {
    db.batchInsertImages([{
      filename: 'vector.jpg',
      path: imagePath,
      folder: 'samples',
      relativePath: 'samples/vector.jpg',
      size: 256,
      format: '.jpg',
      autoAiTag: true,
    }]);

    const image = db.db.prepare(`
      SELECT id
      FROM images
      WHERE filename = ?
      LIMIT 1
    `).get('vector.jpg');

    assert(image?.id, 'image should exist before vector storage');

    const vector = [0.125, 0.25, 0.5, 1];
    const saved = db.upsertImageVector(image.id, vector, 'unit-test-model');
    assert.strictEqual(saved, true, 'vector upsert should succeed');

    const rows = db.getImageVectors([image.id]);
    assert.strictEqual(rows.length, 1, 'stored vector should be queryable');
    assert.strictEqual(rows[0].image_id, image.id, 'stored vector should keep image id');
    assert.strictEqual(rows[0].model_name, 'unit-test-model', 'stored vector should keep model name');
    assert.strictEqual(rows[0].vector.length, vector.length, 'vector dimensions should roundtrip');
    assert.ok(
      rows[0].vector.every((value, index) => Math.abs(value - vector[index]) < 1e-6),
      'vector values should roundtrip without corruption'
    );
  } finally {
    db.close();
  }
}

module.exports = run;
