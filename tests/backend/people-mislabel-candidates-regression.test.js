const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { LibraryDatabase } = require('../../electron/main/libraryDatabase');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-people-mislabel-candidates-');
  const db = new LibraryDatabase('lib_people_mislabel_candidates', libraryPath);
  await db.initialize();

  try {
    const imagePaths = ['multi-ai.jpg', 'single-ai.jpg', 'manual-only.jpg'].map((name) => path.join(libraryPath, name));
    for (const filePath of imagePaths) {
      fs.writeFileSync(filePath, 'stub');
    }

    db.batchInsertImages([
      {
        filename: 'multi-ai.jpg',
        path: imagePaths[0],
        folder: path.basename(libraryPath),
        relativePath: 'multi-ai.jpg',
        size: 4,
        format: 'jpg',
        autoAiTag: true,
      },
      {
        filename: 'single-ai.jpg',
        path: imagePaths[1],
        folder: path.basename(libraryPath),
        relativePath: 'single-ai.jpg',
        size: 4,
        format: 'jpg',
        autoAiTag: true,
      },
      {
        filename: 'manual-only.jpg',
        path: imagePaths[2],
        folder: path.basename(libraryPath),
        relativePath: 'manual-only.jpg',
        size: 4,
        format: 'jpg',
        autoAiTag: false,
      },
    ]);

    const images = db.db.prepare(`
      SELECT id, filename
      FROM images
      ORDER BY id ASC
    `).all();
    const imageByName = new Map(images.map((row) => [row.filename, row.id]));

    const singleTagId = db.addTag('people', '单人', null, null, 'ai');
    const multiTagId = db.addTag('people', '多人', null, null, 'ai');

    db.tagImage(imageByName.get('multi-ai.jpg'), multiTagId, 0.95, 'ai_people_hint');
    db.tagImage(imageByName.get('single-ai.jpg'), singleTagId, 0.93, 'mediapipe_face');
    db.tagImage(imageByName.get('manual-only.jpg'), singleTagId, 1, 'manual');

    const candidateIds = db.getPeopleMislabelCandidateImageIds();

    assert.deepStrictEqual(
      candidateIds.sort((a, b) => a - b),
      [
        imageByName.get('multi-ai.jpg'),
        imageByName.get('single-ai.jpg'),
      ].sort((a, b) => a - b),
      'candidate scan should only include AI-derived people-count labels that are safe to re-check'
    );
  } finally {
    db.close();
  }
}

module.exports = run;
