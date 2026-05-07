const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { LibraryDatabase } = require('../../electron/main/libraryDatabase');
const { ProcessingWorker } = require('../../electron/main/processingWorker');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-animal-people-guards-');
  const db = new LibraryDatabase('lib_animal_people_guards', libraryPath);
  await db.initialize();

  try {
    const worker = new ProcessingWorker(db, { aiTagConcurrency: 0, thumbnailConcurrency: 0 });

    const semanticTags = [
      { name: '\u8001\u864e', confidence: 0.82, category: 'animal', source: 'ai' },
      { name: '\u68ee\u6797', confidence: 0.51, category: 'scene', source: 'ai' },
    ];
    const resolved = worker.applyLocalDimensionGuards({
      weather: null,
      people_analysis: {
        face_count: 0,
        body_count: 0,
        label: null,
        source: 'people_detector',
      },
    }, semanticTags, [...semanticTags], {
      filename: 'tiger-forest.jpg',
      folder: 'wildlife',
    });

    const names = new Set(resolved.map((tag) => tag.name));
    assert(names.has('\u8001\u864e'), 'animal tag should be preserved');
    assert(!names.has('\u4eba\u7269'), 'animal images without people evidence should not force person tag');
    assert(!names.has('\u5355\u4eba'), 'animal images without people evidence should not force single-person tag');
    assert(!names.has('\u591a\u4eba'), 'animal images without people evidence should not force multi-person tag');
  } finally {
    db.close();
  }
}

module.exports = run;
