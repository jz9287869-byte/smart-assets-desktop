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
  const libraryPath = makeTempDir('smart-lib-natural-search-folder-keyword-');
  const db = new LibraryDatabase('lib_natural_search_folder_keyword', libraryPath);
  await db.initialize();

  try {
    const images = [
      {
        filename: 'yili-girl-grassland.jpg',
        path: path.join(libraryPath, 'travel', '伊犁路线', 'yili-girl-grassland.jpg'),
        folder: 'travel/伊犁路线',
        relativePath: 'travel/伊犁路线/yili-girl-grassland.jpg',
        size: 1024,
        format: '.jpg',
        autoAiTag: true,
      },
      {
        filename: 'altay-girl-grassland.jpg',
        path: path.join(libraryPath, 'travel', '阿勒泰路线', 'altay-girl-grassland.jpg'),
        folder: 'travel/阿勒泰路线',
        relativePath: 'travel/阿勒泰路线/altay-girl-grassland.jpg',
        size: 1024,
        format: '.jpg',
        autoAiTag: true,
      },
      {
        filename: 'westlake-sign.jpg',
        path: path.join(libraryPath, 'city', '西湖景区', '路牌区', 'westlake-sign.jpg'),
        folder: 'city/西湖景区/路牌区',
        relativePath: 'city/西湖景区/路牌区/westlake-sign.jpg',
        size: 1024,
        format: '.jpg',
        autoAiTag: true,
      },
      {
        filename: 'westlake-boat.jpg',
        path: path.join(libraryPath, 'city', '西湖景区', '游船区', 'westlake-boat.jpg'),
        folder: 'city/西湖景区/游船区',
        relativePath: 'city/西湖景区/游船区/westlake-boat.jpg',
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

    tagImageWithNames(db, byFilename.get('yili-girl-grassland.jpg'), ['女性', '单人', '草原']);
    tagImageWithNames(db, byFilename.get('altay-girl-grassland.jpg'), ['女性', '单人', '草原']);
    tagImageWithNames(db, byFilename.get('westlake-sign.jpg'), ['纯风景']);
    tagImageWithNames(db, byFilename.get('westlake-boat.jpg'), ['纯风景']);

    const folderScopedResult = searchNaturalLanguageImages(db, {
      query: '找一张单人女生，伊犁文件夹里的草原照片',
      limit: 10,
    });

    assert.strictEqual(folderScopedResult.mode, 'strict');
    assert(
      folderScopedResult.intent.keywordHints.includes('伊犁'),
      'structured query should preserve folder-name keyword hints'
    );
    assert.deepStrictEqual(
      folderScopedResult.images.map((image) => image.filename),
      ['yili-girl-grassland.jpg'],
      'folder name should act as an additional required condition in strict matching'
    );

    const keywordResult = searchNaturalLanguageImages(db, {
      query: '西湖景区 路牌',
      limit: 10,
    });

    assert.strictEqual(keywordResult.mode, 'keyword');
    assert.deepStrictEqual(
      keywordResult.intent.keywordHints,
      ['西湖景区', '路牌'],
      'keyword-only query should split into usable keyword terms'
    );
    assert.deepStrictEqual(
      keywordResult.images.map((image) => image.filename),
      ['westlake-sign.jpg'],
      'keyword fallback should support matching folder names and multiple keywords together'
    );
  } finally {
    db.close();
  }
}

module.exports = run;
