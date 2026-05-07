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
      { name: '雪山', confidence: 0.44, category: 'scene' },
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
      { name: '雪山', confidence: 0.44, category: 'scene' },
      { name: '晴天', confidence: 0.36, category: 'scene' },
    ]);

    assert.deepStrictEqual(
      strongPureScenery.map((tag) => tag.name),
      ['纯风景'],
      'pure scenery should remain available when multiple scenic cues support it'
    );

    const filteredWeakSeason = worker.limitSeasonCandidates([
      { name: '春天', confidence: 0.35, category: 'scene' },
      { name: '夏天', confidence: 0.31, category: 'scene' },
      { name: '雪山', confidence: 0.42, category: 'scene' },
    ], {
      filename: 'mountain.jpg',
      folder: 'travel',
    });

    const filteredWeakSeasonNames = new Set(filteredWeakSeason.map((tag) => tag.name));
    assert(
      ['春天', '夏天', '秋天', '冬天'].some((name) => filteredWeakSeasonNames.has(name)),
      'season tags should still resolve to a single inferred season when explicit season cues are weak'
    );
    assert(
      filteredWeakSeason.some((tag) => tag.category === 'scene' && !['春天', '夏天', '秋天', '冬天'].includes(tag.name)),
      'season filtering should preserve the original scenic support cues'
    );

    const supportedWinter = worker.limitSeasonCandidates([
      { name: '冬天', confidence: 0.34, category: 'scene' },
      { name: '春天', confidence: 0.21, category: 'scene' },
      { name: '雪山', confidence: 0.42, category: 'scene' },
      { name: '雪天', confidence: 0.33, category: 'scene' },
    ], {
      filename: 'alpine-trip.jpg',
      folder: 'travel',
    });

    const supportedWinterNames = new Set(supportedWinter.map((tag) => tag.name));
    assert(supportedWinterNames.has('冬天'), 'winter should be kept when confidence and snowy support cues are both present');
    assert(supportedWinter.some((tag) => tag.category === 'scene' && tag.name !== '冬天'), 'winter support cues should remain alongside the resolved season');
  } finally {
    db.close();
  }
}

module.exports = run;
