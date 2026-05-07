const fs = require('fs');
const path = require('path');

async function main() {
  const targetDir = process.env.AUTO_TAG_TARGET_DIR || 'D:\\Pictures';
  const filename = `auto_tag_snow_${Date.now()}.jpg`;
  const filePath = path.join(targetDir, filename);

  const sharp = require('sharp');
  await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 3,
      background: { r: 240, g: 240, b: 255 }
    }
  })
    .jpeg({ quality: 85 })
    .toFile(filePath);

  process.stdout.write(`created: ${filePath}\n`);

  await new Promise((resolve) => setTimeout(resolve, Number(process.env.AUTO_TAG_WAIT_MS || 4000)));

  const ImageDatabase = require('../electron/main/database');
  const db = new ImageDatabase();
  await db.initialize();

  const row = db.getImageByPath(filePath);
  if (!row || !row.id) {
    process.stderr.write(`not indexed: ${filePath}\n`);
    process.exit(2);
  }

  const tags = db.getImageTags(row.id).map((tag) => tag.name);
  process.stdout.write(`image_id: ${row.id}\n`);
  process.stdout.write(`tags: ${JSON.stringify(tags)}\n`);

  const hasSnow = tags.includes('闆北');
  if (!hasSnow) {
    process.stderr.write('expected tag "闆北" missing\n');
    process.exit(3);
  }

  db.close();

  if (process.env.AUTO_TAG_CLEANUP === '1') {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
  }
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});

