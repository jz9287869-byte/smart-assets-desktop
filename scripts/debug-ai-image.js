const path = require('path');
const { LibraryDatabase } = require('../electron/main/libraryDatabase');
const { ProcessingWorker } = require('../electron/main/processingWorker');

async function main() {
  const libraryPath = process.argv[2] || 'D:/绱犳潗搴?;
  const filenameLike = process.argv[3] || '2974451685';
  const persist = process.argv.includes('--persist');

  const db = new LibraryDatabase('debug-library', libraryPath);
  await db.initialize();

  const image = db.db.prepare(`
    SELECT id, filename, path, folder, dominant_color, process_status
    FROM images
    WHERE filename LIKE ?
    ORDER BY id DESC
    LIMIT 1
  `).get(`%${filenameLike}%`);

  if (!image) {
    throw new Error(`Image not found: ${filenameLike}`);
  }

  const worker = new ProcessingWorker(db, {
    usePythonEngine: true,
    aiTagConcurrency: 1
  });

  try {
    await worker.initializeAIEngine();
    const result = await worker.pythonEngineManager.analyzeImage(image.path);
    console.log('AI_RESULT', JSON.stringify(result.tags, null, 2));

    if (persist) {
      const aiSources = ['ai', 'ai_hint', 'ai_fallback', 'ai_color', 'ai_color_hint'];
      const placeholders = aiSources.map(() => '?').join(',');
      db.db.prepare(`
        DELETE FROM image_tags
        WHERE image_id = ?
          AND source IN (${placeholders})
      `).run(image.id, ...aiSources);

      await worker.generateAITags({
        image_id: image.id,
        path: image.path,
        filename: image.filename,
        folder: image.folder,
        dominant_color: image.dominant_color
      });

      const rows = db.db.prepare(`
        SELECT t.name, t.category_id, it.source, it.confidence
        FROM image_tags it
        JOIN tags t ON t.id = it.tag_id
        WHERE it.image_id = ?
        ORDER BY it.source, it.confidence DESC, t.name ASC
      `).all(image.id);

      console.log('PERSISTED_TAGS', JSON.stringify(rows, null, 2));
    }
  } finally {
    await worker.stop().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

