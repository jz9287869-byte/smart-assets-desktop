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
  const libraryPath = makeTempDir('smart-lib-ai-review-guards-');
  const db = new LibraryDatabase('lib_ai_review_guards', libraryPath);
  await db.initialize();

  try {
    const disabledReviewer = {
      isEnabled() {
        return false;
      }
    };
    const worker = new ProcessingWorker(db, {
      aiTagConcurrency: 0,
      thumbnailConcurrency: 0,
      deepseekReviewer: disabledReviewer
    });

    const localResolved = worker.applyLocalDimensionGuards({
      people_analysis: {
        face_count: 0,
        body_count: 2,
        label: '多人',
        source: 'opencv_body',
      }
    }, [
      { name: '桥梁', confidence: 0.72, category: 'scene' },
      { name: '城市天际线', confidence: 0.58, category: 'scene' },
    ], [
      { name: '桥梁', confidence: 0.72, category: 'scene', source: 'ai' },
      { name: '城市天际线', confidence: 0.58, category: 'scene', source: 'ai' },
      { name: '人物', confidence: 0.84, category: 'people', source: 'opencv_body' },
      { name: '多人', confidence: 0.92, category: 'people', source: 'opencv_body' },
    ]);

    const localNames = new Set(localResolved.map((tag) => tag.name));
    assert(localNames.has('桥梁'), 'architecture-heavy images should keep their scene tags');
    assert(localNames.has('城市天际线'), 'architecture-heavy images should keep their scene tags');
    assert(
      localNames.has('阴天') || localNames.has('晴天'),
      'weather should still be resolved when people dimensions are removed'
    );
    assert(
      ['春天', '夏天', '秋天', '冬天'].some((name) => localNames.has(name)),
      'season should still be resolved when people dimensions are removed'
    );
    assert(!localNames.has('人物'), 'architecture-heavy images should drop body-only generic people dimensions');
    assert(!localNames.has('单人'), 'architecture-heavy images should drop body-only single-person dimensions');
    assert(!localNames.has('多人'), 'architecture-heavy images should drop body-only group dimensions');

    let reviewInvoked = false;
    const reviewer = {
      isEnabled() {
        return true;
      },
      async reviewDimensions() {
        reviewInvoked = true;
        return {
          keepDimensionTags: ['纯风景'],
          source: 'deepseek_review'
        };
      }
    };

    const reviewWorker = new ProcessingWorker(db, {
      aiTagConcurrency: 0,
      thumbnailConcurrency: 0,
      deepseekReviewer: reviewer
    });

    const reviewed = await reviewWorker.reviewAndFinalizeAITags({
      task: {
        path: path.join(libraryPath, 'bridge.jpg'),
        filename: 'bridge.jpg',
        folder: 'travel'
      },
      result: {
        people_analysis: {
          face_count: 1,
          body_count: 0,
          label: '单人',
          source: 'mediapipe_face',
        }
      },
      semanticTags: [
        { name: '桥梁', confidence: 0.74, category: 'scene' },
        { name: '晴天', confidence: 0.42, category: 'scene' },
      ],
      finalTags: [
        { name: '桥梁', confidence: 0.74, category: 'scene', source: 'ai' },
        { name: '晴天', confidence: 0.42, category: 'scene', source: 'ai_weather' },
        { name: '人物', confidence: 0.88, category: 'people', source: 'mediapipe_face' },
        { name: '单人', confidence: 0.91, category: 'people', source: 'mediapipe_face' },
        { name: '纯风景', confidence: 0.92, category: 'scene', source: 'people_detector' },
      ]
    });

    assert.ok(reviewInvoked, 'cloud reviewer should be invoked for conflicting pure-scenery and people dimensions');
    const reviewedNames = new Set(reviewed.map((tag) => tag.name));
    assert(reviewedNames.has('阴天') || reviewedNames.has('晴天'), 'cloud review should preserve a resolved weather dimension');
    assert(
      ['春天', '夏天', '秋天', '冬天'].some((name) => reviewedNames.has(name)),
      'cloud review should preserve a resolved season'
    );
    assert(!reviewedNames.has('人物'), 'cloud review should drop conflicting generic people dimensions');
    assert(!reviewedNames.has('单人'), 'cloud review should drop conflicting single-person dimensions');
    assert(!reviewedNames.has('多人'), 'cloud review should drop conflicting multi-person dimensions');
  } finally {
    db.close();
  }
}

module.exports = run;
