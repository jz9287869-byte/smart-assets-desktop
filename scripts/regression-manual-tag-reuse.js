const fs = require('fs');
const path = require('path');
const { LibraryDatabase } = require('../electron/main/libraryDatabase');

async function main() {
  const libraryPath = 'D:/manual_tag_reuse_regression';
  fs.rmSync(libraryPath, { recursive: true, force: true });
  fs.mkdirSync(path.join(libraryPath, '.data'), { recursive: true });

  const db = new LibraryDatabase('manual-tag-reuse', libraryPath);
  await db.initialize();

  db.db.prepare(`
    INSERT INTO images (filename, path, folder, relative_path, process_status, is_deleted)
    VALUES (?, ?, ?, ?, 'imported', 0)
  `).run(
    'sunset.jpg',
    'D:/manual_tag_reuse_regression/sunset.jpg',
    '娴嬭瘯璺嚎',
    '娴嬭瘯璺嚎/sunset.jpg'
  );

  const imageId = db.db.prepare(`SELECT id FROM images WHERE filename = ?`).get('sunset.jpg').id;
  const existingTag = db.findTagByName('鏃ヨ惤', { preferNonCustom: true });
  if (!existingTag) {
    throw new Error('SYSTEM_TAG_NOT_FOUND');
  }

  db.tagImage(imageId, existingTag.id, 1, 'manual');
  db.tagImage(imageId, existingTag.id, 1, 'manual');

  const customDuplicate = db.db.prepare(`
    SELECT COUNT(*) AS count
    FROM tags
    WHERE name = '鏃ヨ惤' AND category_id = 'custom'
  `).get();

  const imageTagLinks = db.db.prepare(`
    SELECT COUNT(*) AS count
    FROM image_tags
    WHERE image_id = ? AND tag_id = ?
  `).get(imageId, existingTag.id);

  const usageCount = db.db.prepare(`
    SELECT usage_count
    FROM tags
    WHERE id = ?
  `).get(existingTag.id);

  if (customDuplicate.count !== 0) {
    throw new Error(`CUSTOM_DUPLICATE_FOUND:${customDuplicate.count}`);
  }

  if (imageTagLinks.count !== 1) {
    throw new Error(`IMAGE_TAG_LINK_COUNT_INVALID:${imageTagLinks.count}`);
  }

  if (usageCount.usage_count !== 1) {
    throw new Error(`USAGE_COUNT_INVALID:${usageCount.usage_count}`);
  }

  db.db.close();
  console.log('REGRESSION_MANUAL_TAG_REUSE_OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

