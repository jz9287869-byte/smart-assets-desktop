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
  const libraryPath = makeTempDir('smart-lib-single-person-soft-hint-');
  const db = new LibraryDatabase('lib_single_person_soft_hint', libraryPath);
  await db.initialize();

  try {
    const worker = new ProcessingWorker(db, { aiTagConcurrency: 0, thumbnailConcurrency: 0 });

    const tags = worker.buildPeopleDimensionTags(
      {
        face_count: 1,
        body_count: 1,
        label: '单人',
        source: 'mediapipe_face',
      },
      [{
        name: '多人旅行',
        confidence: 0.62,
        category: 'people',
        source: 'ai',
      }]
    );

    const names = tags.map((tag) => tag.name);
    assert(names.includes('单人'), 'single-face portrait should keep the single-person label');
    assert(!names.includes('多人'), 'soft crowd hints should not override a clear single-face portrait');

    const inferred = worker.inferRequiredPeopleCountTag(
      {
        face_count: 1,
        body_count: 3,
        source: 'mediapipe_face',
      },
      [{
        name: '多人旅行',
        confidence: 0.62,
        category: 'people',
        source: 'ai',
      }],
      []
    );

    assert.strictEqual(
      inferred,
      '单人',
      'a single reliable face should win over soft multi-person hints from background passersby'
    );
  } finally {
    db.close();
  }
}

module.exports = run;
