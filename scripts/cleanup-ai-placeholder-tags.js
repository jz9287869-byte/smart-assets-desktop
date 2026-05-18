const fs = require('fs');
const path = require('path');

const { LibraryDatabase } = require('../electron/main/libraryDatabase');

const PLACEHOLDER_TAG_NAMES = ['\u672a\u8bc6\u522b', '\u65e0', 'unknown', 'none'];
const LEGACY_FLOOR_SOURCES = ['ai_weather_floor', 'ai_season_floor'];
const DEFAULT_LIBRARY_PATH = 'D:\\\u7d20\u6750\u5e93';
const APPDATA_DIR_CANDIDATES = [
  ['\u667a\u80fd\u7d20\u6750\u7ba1\u7406\u7cfb\u7edf\u6570\u636e', 'userData'],
  ['smart-image-library'],
];

function parseArgs(argv) {
  const args = {
    apply: false,
    libraryPath: '',
    libraryId: '',
  };

  for (const token of argv.slice(2)) {
    if (token === '--apply') args.apply = true;
    if (token.startsWith('--library-path=')) args.libraryPath = token.slice('--library-path='.length).trim();
    if (token.startsWith('--library-id=')) args.libraryId = token.slice('--library-id='.length).trim();
  }

  return args;
}

function readJsonIfExists(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function resolveUserDataDir() {
  const appData = process.env.APPDATA || '';
  const candidates = APPDATA_DIR_CANDIDATES.map((parts) => path.join(appData, ...parts));
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function hasLibraryDatabase(folderPath) {
  return Boolean(folderPath) && fs.existsSync(path.join(folderPath, '.data', 'library.db'));
}

function resolveLibraryPath(args, userDataDir) {
  if (hasLibraryDatabase(args.libraryPath)) {
    return args.libraryPath;
  }

  const librariesPath = userDataDir ? path.join(userDataDir, 'libraries.json') : '';
  const libraries = readJsonIfExists(librariesPath);
  if (libraries && Array.isArray(libraries.libraries) && libraries.libraries.length > 0) {
    const active = libraries.libraries.find((item) => item.id === libraries.activeLibraryId) || libraries.libraries[0];
    if (hasLibraryDatabase(active?.path)) {
      return active.path;
    }
  }

  if (hasLibraryDatabase(DEFAULT_LIBRARY_PATH)) {
    return DEFAULT_LIBRARY_PATH;
  }

  try {
    const folders = fs.readdirSync('D:\\', { withFileTypes: true });
    for (const entry of folders) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join('D:\\', entry.name);
      if (hasLibraryDatabase(candidate)) {
        return candidate;
      }
    }
  } catch (_) {}

  throw new Error('No library path found. Please pass --library-path=');
}

function resolveLibraryId(args, userDataDir, libraryPath) {
  if (args.libraryId) return args.libraryId;

  const librariesPath = userDataDir ? path.join(userDataDir, 'libraries.json') : '';
  const libraries = readJsonIfExists(librariesPath);
  if (libraries && Array.isArray(libraries.libraries)) {
    const match = libraries.libraries.find((item) => item.path === libraryPath);
    if (match?.id) return match.id;
  }

  return `cleanup_${Date.now()}`;
}

function buildCleanupPlan(db) {
  const placeholderPlaceholders = PLACEHOLDER_TAG_NAMES.map(() => '?').join(',');
  const sourcePlaceholders = LEGACY_FLOOR_SOURCES.map(() => '?').join(',');

  const placeholderTags = db.prepare(`
    SELECT
      t.id,
      t.name,
      t.category_id,
      t.created_source,
      COUNT(it.id) AS link_count,
      SUM(CASE WHEN it.source = 'manual' THEN 1 ELSE 0 END) AS manual_link_count
    FROM tags t
    LEFT JOIN image_tags it ON it.tag_id = t.id
    WHERE t.name IN (${placeholderPlaceholders})
    GROUP BY t.id, t.name, t.category_id, t.created_source
    ORDER BY t.name ASC, t.id ASC
  `).all(...PLACEHOLDER_TAG_NAMES).map((row) => ({
    ...row,
    link_count: Number(row.link_count || 0),
    manual_link_count: Number(row.manual_link_count || 0),
  }));

  const deletablePlaceholderTags = placeholderTags.filter((row) => (
    row.manual_link_count === 0 && (row.created_source === 'ai' || row.link_count === 0)
  ));

  const skippedPlaceholderTags = placeholderTags.filter((row) => (
    !deletablePlaceholderTags.some((item) => item.id === row.id)
  ));

  const placeholderTagIds = deletablePlaceholderTags.map((row) => row.id);
  const placeholderLinkedImages = placeholderTagIds.length
    ? db.prepare(`
      SELECT DISTINCT image_id
      FROM image_tags
      WHERE tag_id IN (${placeholderTagIds.map(() => '?').join(',')})
    `).all(...placeholderTagIds).map((row) => Number(row.image_id)).filter((id) => Number.isInteger(id))
    : [];

  const floorSourceRows = db.prepare(`
    SELECT id, image_id, source
    FROM image_tags
    WHERE source IN (${sourcePlaceholders})
    ORDER BY image_id ASC, id ASC
  `).all(...LEGACY_FLOOR_SOURCES);

  const floorImageIds = Array.from(new Set(
    floorSourceRows.map((row) => Number(row.image_id)).filter((id) => Number.isInteger(id))
  ));

  return {
    placeholderTags,
    deletablePlaceholderTags,
    skippedPlaceholderTags,
    placeholderLinkedImages,
    floorSourceRows,
    floorImageIds,
  };
}

function refreshUsageCounts(db) {
  db.prepare(`
    UPDATE tags
    SET usage_count = (
      SELECT COUNT(*)
      FROM image_tags
      WHERE image_tags.tag_id = tags.id
    )
  `).run();
}

function reconcileImages(libraryDb, imageIds) {
  const uniqueIds = Array.from(new Set(
    (Array.isArray(imageIds) ? imageIds : []).filter((id) => Number.isInteger(id) && id > 0)
  ));

  for (const imageId of uniqueIds) {
    libraryDb.reconcileImageStatus(imageId);
  }

  return uniqueIds.length;
}

async function main() {
  const args = parseArgs(process.argv);
  const userDataDir = resolveUserDataDir();
  const libraryPath = resolveLibraryPath(args, userDataDir);
  const libraryId = resolveLibraryId(args, userDataDir, libraryPath);

  const libraryDb = new LibraryDatabase(libraryId, libraryPath);
  await libraryDb.initialize();

  try {
    const db = libraryDb.db;
    const plan = buildCleanupPlan(db);
    const affectedImageIds = Array.from(new Set([
      ...plan.placeholderLinkedImages,
      ...plan.floorImageIds,
    ]));

    const summary = {
      mode: args.apply ? 'apply' : 'dry-run',
      libraryPath,
      libraryId,
      placeholderTagCandidates: plan.placeholderTags.length,
      placeholderTagDeletable: plan.deletablePlaceholderTags.length,
      placeholderTagSkipped: plan.skippedPlaceholderTags.length,
      floorSourceLinks: plan.floorSourceRows.length,
      affectedImages: affectedImageIds.length,
    };

    if (!args.apply) {
      console.log(JSON.stringify({
        summary,
        deletablePlaceholderTags: plan.deletablePlaceholderTags,
        skippedPlaceholderTags: plan.skippedPlaceholderTags,
      }, null, 2));
      return;
    }

    const deletePlaceholderTagLinks = plan.deletablePlaceholderTags.length
      ? db.prepare(`DELETE FROM image_tags WHERE tag_id IN (${plan.deletablePlaceholderTags.map(() => '?').join(',')})`)
      : null;
    const deletePlaceholderTags = plan.deletablePlaceholderTags.length
      ? db.prepare(`DELETE FROM tags WHERE id IN (${plan.deletablePlaceholderTags.map(() => '?').join(',')})`)
      : null;
    const deleteFloorSources = db.prepare(`
      DELETE FROM image_tags
      WHERE source IN (${LEGACY_FLOOR_SOURCES.map(() => '?').join(',')})
    `);

    const changes = db.transaction(() => {
      let placeholderLinksDeleted = 0;
      let placeholderTagsDeleted = 0;

      if (deletePlaceholderTagLinks) {
        placeholderLinksDeleted = Number(
          deletePlaceholderTagLinks.run(...plan.deletablePlaceholderTags.map((row) => row.id)).changes || 0
        );
      }

      if (deletePlaceholderTags) {
        placeholderTagsDeleted = Number(
          deletePlaceholderTags.run(...plan.deletablePlaceholderTags.map((row) => row.id)).changes || 0
        );
      }

      const floorLinksDeleted = Number(deleteFloorSources.run(...LEGACY_FLOOR_SOURCES).changes || 0);
      refreshUsageCounts(db);

      return {
        placeholderLinksDeleted,
        placeholderTagsDeleted,
        floorLinksDeleted,
      };
    })();

    const reconciledImages = reconcileImages(libraryDb, affectedImageIds);

    console.log(JSON.stringify({
      summary: {
        ...summary,
        reconciledImages,
        ...changes,
      },
      skippedPlaceholderTags: plan.skippedPlaceholderTags,
    }, null, 2));
  } finally {
    libraryDb.close();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
