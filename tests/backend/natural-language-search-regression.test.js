const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { LibraryDatabase } = require('../../electron/main/libraryDatabase');
const { searchNaturalLanguageImages } = require('../../electron/main/naturalLanguageSearch');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function tagImageWithNames(db, imageId, tagNames) {
  for (const tagName of tagNames) {
    const tag = db.findTagByName(tagName);
    assert(tag?.id, `expected tag to exist: ${tagName}`);
    db.tagImage(imageId, tag.id, 1, 'ai');
  }
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-natural-search-');
  const db = new LibraryDatabase('lib_natural_search', libraryPath);
  await db.initialize();

  try {
    const images = [
      {
        filename: 'single-girl-grassland.jpg',
        path: path.join(libraryPath, '\u65b0\u7586', 'single-girl-grassland.jpg'),
        folder: '\u65b0\u7586',
        relativePath: '\u65b0\u7586/single-girl-grassland.jpg',
        size: 1024,
        format: '.jpg',
        autoAiTag: true,
      },
      {
        filename: 'multi-girl-grassland.jpg',
        path: path.join(libraryPath, '\u65b0\u7586', 'multi-girl-grassland.jpg'),
        folder: '\u65b0\u7586',
        relativePath: '\u65b0\u7586/multi-girl-grassland.jpg',
        size: 1024,
        format: '.jpg',
        autoAiTag: true,
      },
      {
        filename: 'pure-scenery-grassland.jpg',
        path: path.join(libraryPath, '\u65b0\u7586', 'pure-scenery-grassland.jpg'),
        folder: '\u65b0\u7586',
        relativePath: '\u65b0\u7586/pure-scenery-grassland.jpg',
        size: 1024,
        format: '.jpg',
        autoAiTag: true,
      },
      {
        filename: 'single-traveler-grassland.jpg',
        path: path.join(libraryPath, '\u65b0\u7586', 'single-traveler-grassland.jpg'),
        folder: '\u65b0\u7586',
        relativePath: '\u65b0\u7586/single-traveler-grassland.jpg',
        size: 1024,
        format: '.jpg',
        autoAiTag: true,
      },
    ];

    for (const image of images) {
      fs.mkdirSync(path.dirname(image.path), { recursive: true });
      fs.writeFileSync(image.path, 'fake-image');
    }

    db.batchInsertImages(images);

    const rows = db.db.prepare(`
      SELECT id, filename
      FROM images
      ORDER BY filename ASC
    `).all();

    const byFilename = new Map(rows.map((row) => [row.filename, row.id]));

    tagImageWithNames(db, byFilename.get('single-girl-grassland.jpg'), ['\u5973\u6027', '\u5355\u4eba', '\u65b0\u7586', '\u8349\u539f']);
    tagImageWithNames(db, byFilename.get('multi-girl-grassland.jpg'), ['\u5973\u6027', '\u591a\u4eba', '\u65b0\u7586', '\u8349\u539f']);
    tagImageWithNames(db, byFilename.get('pure-scenery-grassland.jpg'), ['\u7eaf\u98ce\u666f', '\u65b0\u7586', '\u8349\u539f']);
    tagImageWithNames(db, byFilename.get('single-traveler-grassland.jpg'), ['\u5355\u4eba', '\u65b0\u7586', '\u8349\u539f']);

    const result = searchNaturalLanguageImages(db, {
      query: '\u627e\u4e00\u5f20\u5355\u4eba\u5973\u751f\uff0c\u65b0\u7586\u8349\u539f\u7684\u7167\u7247',
      limit: 10,
    });

    assert.strictEqual(result.mode, 'strict', 'structured natural language query should prefer strict matches');
    assert.deepStrictEqual(
      [...result.intent.requiredTags].sort(),
      ['\u5973\u6027', '\u5355\u4eba', '\u65b0\u7586', '\u8349\u539f'].sort(),
      'query parser should recognize the intended structured tags'
    );
    assert.ok(
      result.images.some((image) => image.filename === 'single-girl-grassland.jpg'),
      'single female grassland image should be returned'
    );
    assert.ok(
      !result.images.some((image) => image.filename === 'multi-girl-grassland.jpg'),
      'multi-person image should be excluded when query asks for a single person'
    );
    assert.ok(
      !result.images.some((image) => image.filename === 'single-traveler-grassland.jpg'),
      'images missing one required condition should not be returned'
    );
  } finally {
    db.close();
  }
}

module.exports = run;
