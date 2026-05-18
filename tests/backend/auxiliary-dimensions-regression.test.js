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
  const libraryPath = makeTempDir('smart-lib-aux-dim-regression-');
  const db = new LibraryDatabase('lib_aux_dim_regression', libraryPath);
  await db.initialize();

  try {
    const worker = new ProcessingWorker(db, { aiTagConcurrency: 0, thumbnailConcurrency: 0 });

    const sunny = worker.buildWeatherDimensionTags({
      label: '\u6674\u5929',
      confidence: 0.31,
      margin: 0.05,
      source: 'ai_weather',
    });
    assert.deepStrictEqual(
      sunny,
      [{
        name: '\u6674\u5929',
        confidence: 0.31,
        source: 'ai_weather',
        category: 'scene',
      }],
      'weather helper should persist explicit sunny tags when threshold and margin both pass'
    );

    assert.deepStrictEqual(
      worker.buildWeatherDimensionTags({
        label: '\u9634\u5929',
        confidence: 0.2,
        margin: 0.05,
        source: 'ai_weather',
      }),
      [],
      'weather helper should skip low-confidence labels'
    );

    assert.deepStrictEqual(
      worker.buildWeatherDimensionTags({
        label: '\u96fe\u5929',
        confidence: 0.29,
        margin: 0.04,
        source: 'ai_weather',
      }, [{
        name: '\u591c\u666f',
        confidence: 0.61,
        category: 'scene',
      }]),
      [],
      'weather helper should skip weather labels for night or indoor semantic scenes'
    );

    assert.deepStrictEqual(
      worker.buildWeatherDimensionTags({
        label: '\u9634\u5929',
        confidence: 0.29,
        margin: 0.04,
        source: 'ai_weather',
      }, [{
        name: '\u9633\u5149\u660e\u5a9a',
        confidence: 0.62,
        category: 'scene',
      }, {
        name: '\u65e5\u843d',
        confidence: 0.41,
        category: 'scene',
      }]),
      [{
        name: '\u9634\u5929',
        confidence: 0.29,
        source: 'ai_weather',
        category: 'scene',
      }],
      'weather helper should keep the AI-selected weather instead of remapping it with local hints'
    );

    assert.strictEqual(
      worker.inferRequiredWeatherName({
        label: '\u9634\u5929',
        confidence: 0.3,
        margin: 0.04,
      }, [{
        name: '\u9633\u5149\u660e\u5a9a',
        confidence: 0.58,
        category: 'scene',
      }], []),
      '\u9634\u5929',
      'weather inference helper should now only echo explicit AI weather labels'
    );

    const imagePath = path.join(libraryPath, 'cleanup-weather.jpg');
    fs.writeFileSync(imagePath, 'stub');
    const insertResult = db.batchInsertImages([{
      filename: path.basename(imagePath),
      path: imagePath,
      folder: path.basename(libraryPath),
      relativePath: path.basename(imagePath),
      size: 4,
      format: 'jpg',
      autoAiTag: true,
    }]);
    assert.ok(insertResult.inserted >= 1, 'image fixture should be inserted for weather cleanup regression');
    const image = db.db.prepare('SELECT id FROM images WHERE path = ?').get(imagePath.toLowerCase());
    assert.ok(image?.id, 'inserted image should be queryable for weather cleanup regression');

    worker.saveAITag(image.id, {
      name: '\u9634\u5929',
      confidence: 0.64,
      source: 'ai_weather_floor',
      category: 'scene',
    });
    worker.saveAITag(image.id, {
      name: '\u6625\u5929',
      confidence: 0.63,
      source: 'ai_season_floor',
      category: 'scene',
    });
    worker.cleanupDerivedSceneDimensionTags(image.id);
    const retainedSceneDimensions = db.db.prepare(`
      SELECT t.name
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
        AND t.name IN ('\u6674\u5929', '\u9634\u5929', '\u96e8\u5929', '\u96ea\u5929', '\u96fe\u5929', '\u6625\u5929', '\u590f\u5929', '\u79cb\u5929', '\u51ac\u5929')
    `).all(image.id);
    assert.deepStrictEqual(
      retainedSceneDimensions,
      [],
      'retagging should remove stale derived weather and season dimensions before saving new ones'
    );

    const groupTags = worker.buildPeopleDimensionTags({
      face_count: 2,
      label: '\u591a\u4eba',
      source: 'mediapipe_face',
    }, []);
    assert.deepStrictEqual(
      groupTags.map((tag) => tag.name),
      ['\u4eba\u7269', '\u591a\u4eba'],
      '2+ detected faces should produce people and group labels'
    );

    const bodyOnlyPeopleTags = worker.buildPeopleDimensionTags({
      face_count: 0,
      body_count: 1,
      label: null,
      source: 'opencv_body',
    }, []);
    assert.deepStrictEqual(
      bodyOnlyPeopleTags.map((tag) => tag.name),
      [],
      'body-only detections should not create person labels without any semantic people evidence'
    );

    const bodyOnlySingleWithSemantic = worker.buildPeopleDimensionTags({
      face_count: 0,
      body_count: 1,
      label: '\u5355\u4eba',
      source: 'opencv_body',
    }, [{
      name: '\u5973\u6027',
      confidence: 0.42,
      category: 'people',
    }]);
    assert.deepStrictEqual(
      bodyOnlySingleWithSemantic.map((tag) => tag.name),
      ['\u4eba\u7269', '\u5355\u4eba'],
      'body-only single-person detections may survive when explicit people semantics support them'
    );

    const sceneryTags = worker.buildPeopleDimensionTags({
      face_count: 0,
      label: null,
      source: 'mediapipe_face',
    }, [{
      name: '\u96ea\u5c71',
      confidence: 0.44,
      category: 'scene',
    }, {
      name: '\u6674\u5929',
      confidence: 0.31,
      category: 'scene',
    }]);
    assert.deepStrictEqual(
      sceneryTags.map((tag) => tag.name),
      ['\u7eaf\u98ce\u666f'],
      '0 detected faces with multiple scenic cues should become pure scenery'
    );

    const semanticPeopleTags = worker.buildPeopleDimensionTags({
      face_count: 0,
      label: null,
      source: 'mediapipe_face',
    }, [{
      name: '\u4eba\u7269',
      confidence: 0.44,
      category: 'people',
    }]);
    assert.deepStrictEqual(
      semanticPeopleTags.map((tag) => tag.name),
      ['\u4eba\u7269'],
      '0 detected faces should not force pure scenery when CLIP semantics already indicate people'
    );

    const semanticMultiPeopleTags = worker.buildPeopleDimensionTags({
      face_count: 1,
      body_count: 1,
      label: '\u5355\u4eba',
      source: 'mediapipe_face',
    }, [{
      name: '\u4e00\u5bb6\u4e09\u53e3',
      confidence: 0.45,
      category: 'people',
    }, {
      name: '\u95fa\u871c\u56e2',
      confidence: 0.41,
      category: 'people',
    }]);
    assert.deepStrictEqual(
      semanticMultiPeopleTags.map((tag) => tag.name),
      ['\u4eba\u7269', '\u591a\u4eba'],
      'strong multi-person semantics should override a mistaken single-person detector label'
    );

    const noisyBodyGroupTags = worker.buildPeopleDimensionTags({
      face_count: 0,
      body_count: 2,
      label: '\u591a\u4eba',
      source: 'opencv_body',
    }, [{
      name: '\u5973\u6027',
      confidence: 0.42,
      category: 'people',
    }, {
      name: '\u4fa7\u8138',
      confidence: 0.41,
      category: 'people',
    }]);
    assert.deepStrictEqual(
      noisyBodyGroupTags.map((tag) => tag.name),
      ['\u4eba\u7269'],
      'opencv body-only group guesses should not create multi-person tags without strong semantic group hints'
    );

    const portraitSingleTags = worker.buildPeopleDimensionTags({
      face_count: null,
      body_count: 6,
      label: '\u591a\u4eba',
      source: 'opencv_body',
    }, [{
      name: '\u6cf0\u670d',
      confidence: 0.42,
      category: 'people',
    }, {
      name: '\u5ba2\u623f\u670d\u52a1\u5458',
      confidence: 0.4,
      category: 'people',
    }]);
    assert.deepStrictEqual(
      portraitSingleTags.map((tag) => tag.name),
      ['\u4eba\u7269', '\u5355\u4eba'],
      'opencv multi-person false positives should fall back to single person when portrait-oriented people semantics are strong'
    );
  } finally {
    db.close();
  }
}

module.exports = run;
