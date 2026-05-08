const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { LibraryDatabase } = require('../../electron/main/libraryDatabase');
const { ProcessingWorker } = require('../../electron/main/processingWorker');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-ai-english-aliases-');
  const imagePath = path.join(libraryPath, 'samples', 'rainbow.jpg');

  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, 'fake-image');

  const db = new LibraryDatabase('lib_ai_english_aliases', libraryPath);
  await db.initialize();

  try {
    db.batchInsertImages([{
      filename: 'rainbow.jpg',
      path: imagePath,
      folder: 'samples',
      relativePath: 'samples/rainbow.jpg',
      size: 128,
      format: '.jpg',
      autoAiTag: true,
    }]);

    const image = db.db.prepare(`
      SELECT id
      FROM images
      WHERE filename = ?
      LIMIT 1
    `).get('rainbow.jpg');

    assert(image?.id, 'image row should exist before saving AI tags');

    const worker = new ProcessingWorker(db, { aiTagConcurrency: 0, thumbnailConcurrency: 0 });
    const aliasCases = [
      ['mountain', '\u5c71\u5cf0'],
      ['rainbow', '\u5f69\u8679'],
      ['night sky', '\u591c\u7a7a'],
      ['silhouette', '\u526a\u5f71'],
      ['stargazing', '\u89c2\u661f'],
      ['natural_phenomenon', '\u81ea\u7136\u73b0\u8c61'],
      ['sunrise', '\u65e5\u51fa'],
      ['landscape', '\u7eaf\u98ce\u666f'],
      ['morning', '\u65e9\u6668'],
    ];

    for (const [input, expected] of aliasCases) {
      assert.strictEqual(
        worker.normalizeTagName(input),
        expected,
        `alias should normalize "${input}" to "${expected}"`
      );
    }

    worker.saveAITag(image.id, {
      name: 'rainbow',
      category: 'scene',
      confidence: 0.92,
      source: 'ai',
    });

    const persisted = db.db.prepare(`
      SELECT t.name
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
      ORDER BY it.id ASC
    `).all(image.id).map((row) => row.name);

    assert.deepStrictEqual(
      persisted,
      ['\u5f69\u8679'],
      'persisted AI tags should use normalized Chinese aliases instead of raw English labels'
    );

    const legacyTagId = db.addTag('scene', 'sunrise', null, null, 'ai');
    db.tagImage(image.id, legacyTagId, 0.88, 'ai');

    const migrateResult = db.normalizeAliasedTags();
    assert(migrateResult.renamed + migrateResult.merged >= 1, 'legacy English AI tags should be normalized during migration');

    const namesAfterMigration = db.db.prepare(`
      SELECT t.name
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
      ORDER BY t.name ASC
    `).all(image.id).map((row) => row.name);

    assert.deepStrictEqual(
      namesAfterMigration,
      ['\u5f69\u8679', '\u65e5\u51fa'],
      'legacy English tags should be merged into their Chinese canonical names'
    );

    const legacyEnglishTag = db.findTagByName('sunrise', { preferNonCustom: false });
    assert(!legacyEnglishTag, 'legacy English alias rows should be removed after migration');
  } finally {
    db.close();
  }
}

module.exports = run;
