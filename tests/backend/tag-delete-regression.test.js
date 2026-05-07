const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { LibraryDatabase } = require('../../electron/main/libraryDatabase');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-tag-delete-');
  const db = new LibraryDatabase('lib_tag_delete', libraryPath);
  await db.initialize();

  try {
    const imagePath = path.join(libraryPath, 'extra-tag.jpg');
    fs.writeFileSync(imagePath, 'stub');

    db.batchInsertImages([{
      filename: path.basename(imagePath),
      path: imagePath,
      folder: path.basename(libraryPath),
      relativePath: path.basename(imagePath),
      size: 4,
      format: 'jpg',
      autoAiTag: false,
    }]);

    const image = db.db.prepare('SELECT id, process_status FROM images WHERE path = ?').get(imagePath.toLowerCase());
    assert.ok(image?.id, 'fixture image should exist');
    assert.strictEqual(image.process_status, 'imported', 'new image should start as imported');

    const extraTagId = db.addTag('custom', 'Extra AI', null, null, 'ai');
    db.tagImage(image.id, extraTagId, 0.88, 'ai');

    const taggedImage = db.db.prepare('SELECT process_status FROM images WHERE id = ?').get(image.id);
    assert.strictEqual(taggedImage.process_status, 'auto_tagged', 'tagged image should become auto_tagged');

    const deleted = db.deleteTag(extraTagId);
    assert.strictEqual(deleted, true, 'non-system tag should be deletable');

    const remainingLinks = db.db.prepare('SELECT COUNT(*) AS count FROM image_tags WHERE image_id = ?').get(image.id);
    assert.strictEqual(remainingLinks.count, 0, 'deleting the tag should remove image links');

    const revertedImage = db.db.prepare('SELECT process_status FROM images WHERE id = ?').get(image.id);
    assert.strictEqual(revertedImage.process_status, 'imported', 'image status should be reconciled after tag deletion');

    const systemTag = db.db.prepare(`
      SELECT id
      FROM tags
      WHERE created_source = 'system'
      LIMIT 1
    `).get();
    assert.ok(systemTag?.id, 'fixture should include a system tag');

    assert.throws(
      () => db.deleteTag(systemTag.id),
      /系统预设标签不可删除/,
      'system tags should not be deletable'
    );
  } finally {
    db.close();
  }
}

module.exports = run;
