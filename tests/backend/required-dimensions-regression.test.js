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
  const libraryPath = makeTempDir('smart-lib-required-dimensions-');
  const db = new LibraryDatabase('lib_required_dimensions', libraryPath);
  await db.initialize();

  try {
    const worker = new ProcessingWorker(db, { aiTagConcurrency: 0, thumbnailConcurrency: 0 });

    const pureSceneryResolved = worker.applyLocalDimensionGuards({
      weather: null,
      people_analysis: {
        face_count: 0,
        body_count: 0,
        label: null,
        source: 'people_detector',
      },
    }, [
      { name: '雪山', confidence: 0.45, category: 'scene' },
      { name: '晴天', confidence: 0.43, category: 'scene' },
    ], [], {
      filename: 'alps.jpg',
      folder: 'travel',
    });

    const pureSceneryNames = new Set(pureSceneryResolved.map((tag) => tag.name));
    assert(pureSceneryNames.has('纯风景'), 'pure scenery photos should keep the pure-scenery dimension');
    assert(pureSceneryNames.has('晴天'), 'pure scenery photos should still keep a sunny/cloudy result');
    assert(pureSceneryNames.has('冬天'), 'pure scenery photos should still keep a season result');
    assert(!pureSceneryNames.has('人物'), 'pure scenery photos should not keep generic people labels');
    assert(!pureSceneryNames.has('单人'), 'pure scenery photos should not keep single-person labels');
    assert(!pureSceneryNames.has('多人'), 'pure scenery photos should not keep multi-person labels');

    const nonSceneryResolved = worker.applyLocalDimensionGuards({
      weather: null,
      people_analysis: {
        face_count: 0,
        body_count: 0,
        label: null,
        source: 'people_detector',
      },
    }, [
      { name: '古镇', confidence: 0.42, category: 'scene' },
    ], [], {
      filename: 'old-town.jpg',
      folder: 'travel',
    });

    const names = new Set(nonSceneryResolved.map((tag) => tag.name));
    assert(!names.has('人物'), 'non-pure-scenery photos without people evidence should not force generic people labels');
    assert(!names.has('单人'), 'non-pure-scenery photos without people evidence should not force single-person labels');
    assert(!names.has('多人'), 'non-pure-scenery photos without people evidence should not force multi-person labels');
    assert(
      names.has('阴天') || names.has('晴天'),
      'photos should always resolve to either sunny or cloudy weather'
    );
    assert(
      ['春天', '夏天', '秋天', '冬天'].some((name) => names.has(name)),
      'photos should always resolve to one season'
    );
    assert(!names.has('纯风景'), 'non-scenery photos should not be labeled as pure scenery');
  } finally {
    db.close();
  }
}

module.exports = run;
