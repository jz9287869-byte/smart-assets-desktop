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
  const libraryPath = makeTempDir('smart-lib-pure-scenery-season-guards-');
  const db = new LibraryDatabase('lib_pure_scenery_season_guards', libraryPath);
  await db.initialize();

  try {
    const worker = new ProcessingWorker(db, { aiTagConcurrency: 0, thumbnailConcurrency: 0 });

    const weakPureScenery = worker.buildPeopleDimensionTags({
      face_count: 0,
      body_count: 0,
      source: 'people_detector',
    }, [
      { name: '\u96ea\u5c71', confidence: 0.44, category: 'scene' },
    ]);

    assert.deepStrictEqual(
      weakPureScenery,
      [],
      'pure scenery should not be emitted when there is only a single scenic cue'
    );

    const strongPureScenery = worker.buildPeopleDimensionTags({
      face_count: 0,
      body_count: 0,
      source: 'people_detector',
    }, [
      { name: '\u96ea\u5c71', confidence: 0.44, category: 'scene' },
      { name: '\u6674\u5929', confidence: 0.36, category: 'scene' },
    ]);

    assert.deepStrictEqual(
      strongPureScenery.map((tag) => tag.name),
      ['\u7eaf\u98ce\u666f'],
      'pure scenery should remain available when multiple scenic cues support it'
    );

    const filteredWeakSeason = worker.limitSeasonCandidates([
      { name: '\u6625\u5929', confidence: 0.35, category: 'scene' },
      { name: '\u590f\u5929', confidence: 0.31, category: 'scene' },
      { name: '\u96ea\u5c71', confidence: 0.42, category: 'scene' },
    ], {
      filename: 'mountain.jpg',
      folder: 'travel',
    });

    const filteredWeakSeasonNames = new Set(filteredWeakSeason.map((tag) => tag.name));
    assert(
      !['\u6625\u5929', '\u590f\u5929', '\u79cb\u5929', '\u51ac\u5929'].some((name) => filteredWeakSeasonNames.has(name)),
      'season tags should disappear when AI season cues are weak instead of being synthesized'
    );
    assert(
      filteredWeakSeason.some((tag) => tag.category === 'scene' && !['\u6625\u5929', '\u590f\u5929', '\u79cb\u5929', '\u51ac\u5929'].includes(tag.name)),
      'season filtering should preserve the original scenic support cues'
    );

    const supportedWinter = worker.limitSeasonCandidates([
      { name: '\u51ac\u5929', confidence: 0.34, category: 'scene' },
      { name: '\u6625\u5929', confidence: 0.21, category: 'scene' },
      { name: '\u96ea\u5c71', confidence: 0.42, category: 'scene' },
      { name: '\u96ea\u5929', confidence: 0.33, category: 'scene' },
    ], {
      filename: 'alpine-trip.jpg',
      folder: 'travel',
    });

    const supportedWinterNames = new Set(supportedWinter.map((tag) => tag.name));
    assert(supportedWinterNames.has('\u51ac\u5929'), 'winter should be kept when AI already generated it with snowy support cues');
    assert(supportedWinter.some((tag) => tag.category === 'scene' && tag.name !== '\u51ac\u5929'), 'winter support cues should remain alongside the retained season');
  } finally {
    db.close();
  }
}

module.exports = run;
