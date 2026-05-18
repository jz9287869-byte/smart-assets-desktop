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
        label: '\u591a\u4eba',
        source: 'opencv_body',
      }
    }, [
      { name: '\u6865\u6881', confidence: 0.72, category: 'scene' },
      { name: '\u57ce\u5e02\u5929\u9645\u7ebf', confidence: 0.58, category: 'scene' },
    ], [
      { name: '\u6865\u6881', confidence: 0.72, category: 'scene', source: 'ai' },
      { name: '\u57ce\u5e02\u5929\u9645\u7ebf', confidence: 0.58, category: 'scene', source: 'ai' },
      { name: '\u4eba\u7269', confidence: 0.84, category: 'people', source: 'opencv_body' },
      { name: '\u591a\u4eba', confidence: 0.92, category: 'people', source: 'opencv_body' },
    ]);

    const localNames = new Set(localResolved.map((tag) => tag.name));
    assert(localNames.has('\u6865\u6881'), 'architecture-heavy images should keep their scene tags');
    assert(localNames.has('\u57ce\u5e02\u5929\u9645\u7ebf'), 'architecture-heavy images should keep their scene tags');
    assert(!localNames.has('\u4eba\u7269'), 'architecture-heavy images should drop body-only generic people dimensions');
    assert(!localNames.has('\u5355\u4eba'), 'architecture-heavy images should drop body-only single-person dimensions');
    assert(!localNames.has('\u591a\u4eba'), 'architecture-heavy images should drop body-only group dimensions');
    assert(!localNames.has('\u6674\u5929') && !localNames.has('\u9634\u5929'), 'weather should not be synthesized during local guard cleanup');
    assert(!['\u6625\u5929', '\u590f\u5929', '\u79cb\u5929', '\u51ac\u5929'].some((name) => localNames.has(name)), 'season should not be synthesized during local guard cleanup');

    let reviewInvoked = false;
    const reviewer = {
      isEnabled() {
        return true;
      },
      async reviewDimensions() {
        reviewInvoked = true;
        return {
          keepDimensionTags: ['\u7eaf\u98ce\u666f'],
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
          label: '\u5355\u4eba',
          source: 'mediapipe_face',
        }
      },
      semanticTags: [
        { name: '\u6865\u6881', confidence: 0.74, category: 'scene' },
        { name: '\u6674\u5929', confidence: 0.42, category: 'scene' },
      ],
      finalTags: [
        { name: '\u6865\u6881', confidence: 0.74, category: 'scene', source: 'ai' },
        { name: '\u6674\u5929', confidence: 0.42, category: 'scene', source: 'ai_weather' },
        { name: '\u4eba\u7269', confidence: 0.88, category: 'people', source: 'mediapipe_face' },
        { name: '\u5355\u4eba', confidence: 0.91, category: 'people', source: 'mediapipe_face' },
        { name: '\u7eaf\u98ce\u666f', confidence: 0.92, category: 'scene', source: 'people_detector' },
      ]
    });

    assert.ok(reviewInvoked, 'cloud reviewer should be invoked for conflicting pure-scenery and people dimensions');
    const reviewedNames = new Set(reviewed.map((tag) => tag.name));
    assert(reviewedNames.has('\u6674\u5929'), 'cloud review should preserve AI-generated weather tags that already exist');
    assert(!reviewedNames.has('\u4eba\u7269'), 'cloud review should drop conflicting generic people dimensions');
    assert(!reviewedNames.has('\u5355\u4eba'), 'cloud review should drop conflicting single-person dimensions');
    assert(!reviewedNames.has('\u591a\u4eba'), 'cloud review should drop conflicting multi-person dimensions');
  } finally {
    db.close();
  }
}

module.exports = run;
