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
      { name: '\u96ea\u5c71', confidence: 0.45, category: 'scene' },
      { name: '\u6674\u5929', confidence: 0.43, category: 'scene' },
    ], [], {
      filename: 'alps.jpg',
      folder: 'travel',
    });

    const pureSceneryNames = new Set(pureSceneryResolved.map((tag) => tag.name));
    assert(pureSceneryNames.has('\u7eaf\u98ce\u666f'), 'pure scenery photos should keep the pure-scenery dimension');
    assert(!pureSceneryNames.has('\u4eba\u7269'), 'pure scenery photos should not keep generic people labels');
    assert(!pureSceneryNames.has('\u5355\u4eba'), 'pure scenery photos should not keep single-person labels');
    assert(!pureSceneryNames.has('\u591a\u4eba'), 'pure scenery photos should not keep multi-person labels');

    const nonSceneryResolved = worker.applyLocalDimensionGuards({
      weather: null,
      people_analysis: {
        face_count: 0,
        body_count: 0,
        label: null,
        source: 'people_detector',
      },
    }, [
      { name: '\u53e4\u9547', confidence: 0.42, category: 'scene' },
    ], [], {
      filename: 'old-town.jpg',
      folder: 'travel',
    });

    const names = new Set(nonSceneryResolved.map((tag) => tag.name));
    assert(!names.has('\u4eba\u7269'), 'non-pure-scenery photos without people evidence should not force generic people labels');
    assert(!names.has('\u5355\u4eba'), 'non-pure-scenery photos without people evidence should not force single-person labels');
    assert(!names.has('\u591a\u4eba'), 'non-pure-scenery photos without people evidence should not force multi-person labels');
    assert(!names.has('\u7eaf\u98ce\u666f'), 'non-scenery photos should not be labeled as pure scenery');
    assert(!names.has('\u6674\u5929') && !names.has('\u9634\u5929'), 'weather should not be synthesized when AI did not generate it');
    assert(!['\u6625\u5929', '\u590f\u5929', '\u79cb\u5929', '\u51ac\u5929'].some((name) => names.has(name)), 'season should not be synthesized when AI did not generate it');
  } finally {
    db.close();
  }
}

module.exports = run;
