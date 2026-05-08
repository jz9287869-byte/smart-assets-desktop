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
    let tag = db.findTagByName(tagName);
    if (!tag?.id) {
      const tagId = db.addTag('custom', tagName, null, null, 'ai');
      tag = db.findTagByName(tagName) || { id: tagId };
    }
    assert(tag?.id, `expected tag to exist: ${tagName}`);
    db.tagImage(imageId, tag.id, 1, 'ai');
  }
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-natural-search-folder-keyword-');
  const db = new LibraryDatabase('lib_natural_search_folder_keyword', libraryPath);
  await db.initialize();

  try {
    const yiliFolderName = '\u4f0a\u7281';
    const yiliRouteFolder = '\u4f0a\u7281\u8def\u7ebf';
    const altayRouteFolder = '\u963f\u52d2\u6cf0\u8def\u7ebf';
    const westlakeFolder = '\u897f\u6e56\u666f\u533a';
    const signFolder = '\u8def\u724c\u533a';
    const boatFolder = '\u6e38\u8239\u533a';
    const femaleTag = '\u5973\u6027';
    const soloTag = '\u5355\u4eba';
    const grasslandTag = '\u8349\u539f';
    const sceneryTag = '\u7eaf\u98ce\u666f';
    const signTag = '\u8def\u724c';
    const grasslandQuery = `\u627e\u4e00\u5f20${soloTag}${femaleTag}\uff0c${grasslandTag}\u7684\u7167\u7247`;
    const signKeyword = '\u8def\u724c';

    const images = [
      {
        filename: 'yili-girl-grassland.jpg',
        path: path.join(libraryPath, 'travel', yiliRouteFolder, 'yili-girl-grassland.jpg'),
        folder: `travel/${yiliRouteFolder}`,
        relativePath: `travel/${yiliRouteFolder}/yili-girl-grassland.jpg`,
        size: 1024,
        format: '.jpg',
        autoAiTag: true,
      },
      {
        filename: 'altay-girl-grassland.jpg',
        path: path.join(libraryPath, 'travel', altayRouteFolder, 'altay-girl-grassland.jpg'),
        folder: `travel/${altayRouteFolder}`,
        relativePath: `travel/${altayRouteFolder}/altay-girl-grassland.jpg`,
        size: 1024,
        format: '.jpg',
        autoAiTag: true,
      },
      {
        filename: 'westlake-sign.jpg',
        path: path.join(libraryPath, 'city', westlakeFolder, signFolder, 'westlake-sign.jpg'),
        folder: `city/${westlakeFolder}/${signFolder}`,
        relativePath: `city/${westlakeFolder}/${signFolder}/westlake-sign.jpg`,
        size: 1024,
        format: '.jpg',
        autoAiTag: true,
      },
      {
        filename: 'westlake-boat.jpg',
        path: path.join(libraryPath, 'city', westlakeFolder, boatFolder, 'westlake-boat.jpg'),
        folder: `city/${westlakeFolder}/${boatFolder}`,
        relativePath: `city/${westlakeFolder}/${boatFolder}/westlake-boat.jpg`,
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

    tagImageWithNames(db, byFilename.get('yili-girl-grassland.jpg'), [femaleTag, soloTag, grasslandTag]);
    tagImageWithNames(db, byFilename.get('altay-girl-grassland.jpg'), [femaleTag, soloTag, grasslandTag]);
    tagImageWithNames(db, byFilename.get('westlake-sign.jpg'), [sceneryTag, signTag]);
    tagImageWithNames(db, byFilename.get('westlake-boat.jpg'), [sceneryTag]);

    const folderScopedResult = searchNaturalLanguageImages(db, {
      query: grasslandQuery,
      folderName: yiliFolderName,
      limit: 10,
    });

    assert.strictEqual(folderScopedResult.mode, 'strict');
    assert.deepStrictEqual(
      folderScopedResult.images.map((image) => image.filename),
      ['yili-girl-grassland.jpg'],
      'folderName should scope strict matching independently from the search query'
    );

    const keywordResult = searchNaturalLanguageImages(db, {
      query: signKeyword,
      folderName: westlakeFolder,
      limit: 10,
    });

    assert.deepStrictEqual(
      keywordResult.images.map((image) => image.filename),
      ['westlake-sign.jpg'],
      'folderName should scope tag matching without mixing folder terms into the query parser'
    );
  } finally {
    db.close();
  }
}

module.exports = run;
