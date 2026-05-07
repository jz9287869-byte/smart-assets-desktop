const Database = require('better-sqlite3');
const osPath = require('path');
const fs = require('fs');
const { BUILTIN_TAG_DEFINITIONS } = require('./tagDefinitions');
let electronApp = null;
try {
  const electron = require('electron');
  electronApp = electron && electron.app ? electron.app : null;
} catch (_) {
  electronApp = null;
}

const path = osPath;


// recovered from corrupted comment
function normalizePath(filePath) {
  if (!filePath) return filePath;
  if (process.platform === 'win32') {
    return filePath.toLowerCase();
  }
  return filePath;
}

function normalizeFolderValue(folderPath) {
  return String(folderPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '');
}

function escapeLikePattern(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function normalizeVectorValues(vector) {
  if (!vector) return [];
  const values = Array.isArray(vector) ? vector : Array.from(vector);
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

function serializeVector(vector) {
  const values = normalizeVectorValues(vector);
  if (!values.length) return null;
  const typedArray = Float32Array.from(values);
  return Buffer.from(typedArray.buffer.slice(0));
}

function deserializeVector(buffer) {
  if (!buffer) return null;
  const sourceBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!sourceBuffer.byteLength || sourceBuffer.byteLength % 4 !== 0) {
    return null;
  }

  const rawArrayBuffer = sourceBuffer.buffer.slice(
    sourceBuffer.byteOffset,
    sourceBuffer.byteOffset + sourceBuffer.byteLength
  );

  return Array.from(new Float32Array(rawArrayBuffer));
}

/**
 * 多资源库数据库管理器
 * V2.0 - 支持多库、任务队列和多维度标签
 */
class LibraryDatabase {
  constructor(libraryId, libraryPath) {
    this.libraryId = libraryId;
    this.libraryPath = libraryPath;
    this.db = null;
    this.dbFilePath = null;
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      try {
        // 每个资源库独立使用自己的 .data 目录
        const dbDir = path.join(this.libraryPath, '.data');
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }

        this.dbFilePath = path.join(dbDir, 'library.db');
        this.db = new Database(this.dbFilePath);
        
        // ========== 数据库性能优化 ==========
        // 1. 外键约束
        this.db.pragma('foreign_keys = ON');
        
        // 2. WAL 日志模式
        this.db.pragma('journal_mode = WAL');
        
        // 3. 同步模式（NORMAL 在速度与安全之间折中）
        this.db.pragma('synchronous = NORMAL');
        
        // 4. 缓存大小：16384 * 4KB = 64MB
        this.db.pragma('cache_size = 16384');
        
        // recovered from corrupted comment
        this.db.pragma('temp_store = MEMORY');
        
        // 6. 自动分析优化查询计划
        this.db.pragma('automatic_index = TRUE');
        
        this.createTables();
        this.migrateSchema();
        this.ensureBuiltinTags();
        console.log(`资源库初始化完成: ${this.libraryId}`);
        resolve();
      } catch (error) {
        console.error(`资源库初始化失败: ${this.libraryId}`, error);
        reject(error);
      }
    });
  }

  createTables() {
    // recovered from corrupted comment
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        path TEXT UNIQUE NOT NULL,
        folder TEXT NOT NULL,
        relative_path TEXT,           -- 相对于库根目录的路径
        size INTEGER,
        width INTEGER,
        height INTEGER,
        format TEXT,
        dominant_color TEXT,
        thumbnail_path TEXT,
        auto_ai_tag INTEGER DEFAULT 0,
        
        -- 处理状态: imported -> thumbnail -> auto_tagged -> manual_tagged
        process_status TEXT DEFAULT 'imported',
        process_priority INTEGER DEFAULT 0,  -- 处理优先级
        is_deleted INTEGER DEFAULT 0,
        delete_batch TEXT,
        current_path TEXT,
        
        -- 时间戳
        imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        thumbnail_at DATETIME,
        tagged_at DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_images_status ON images(process_status);
      CREATE INDEX IF NOT EXISTS idx_images_folder ON images(folder);
      CREATE INDEX IF NOT EXISTS idx_images_deleted ON images(is_deleted);
      CREATE INDEX IF NOT EXISTS idx_images_imported ON images(imported_at);
      
      -- 复合索引，优化常见查询
      CREATE INDEX IF NOT EXISTS idx_images_deleted_status ON images(is_deleted, process_status);
      CREATE INDEX IF NOT EXISTS idx_images_deleted_imported ON images(is_deleted, imported_at DESC);
      CREATE INDEX IF NOT EXISTS idx_images_folder_deleted ON images(folder, is_deleted);
      CREATE INDEX IF NOT EXISTS idx_images_filename ON images(filename);
      
      -- 全文搜索优化（用于模糊匹配）
      CREATE INDEX IF NOT EXISTS idx_images_filename_pattern ON images(filename) WHERE is_deleted = 0;
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS excluded_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_path TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_excluded_folders_path ON excluded_folders(folder_path);
    `);

    try {
      this.db.prepare(`ALTER TABLE tags ADD COLUMN created_source TEXT DEFAULT 'system'`).run();
    } catch (_) {}

    // recovered from corrupted comment
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processing_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        image_id INTEGER NOT NULL,
        task_type TEXT NOT NULL,      -- 'thumbnail', 'ai_tag', 'manual_tag'
        status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
        priority INTEGER DEFAULT 0,
        retry_count INTEGER DEFAULT 0,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        completed_at DATETIME,
        
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_queue_status ON processing_queue(status, priority DESC, created_at);
      CREATE INDEX IF NOT EXISTS idx_queue_type ON processing_queue(task_type, status);
    `);

    // recovered from corrupted comment
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tag_categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        is_system INTEGER DEFAULT 0,  -- 系统预设，不可删除
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- 插入预设分类
      INSERT OR IGNORE INTO tag_categories (id, name, sort_order, is_system) VALUES
        ('scene', '场景', 1, 1),
        ('location', '地点', 2, 1),
        ('people', '人物', 3, 1),
        ('color', '颜色', 4, 1),
        ('animal', '动物', 5, 1),
        ('device', '设备', 6, 1),
        ('event', '活动', 7, 1),
        ('custom', '自定义', 99, 1);
    `);

    const systemCategories = [
      ['scene', '场景', 1],
      ['location', '地点', 2],
      ['people', '人物', 3],
      ['color', '颜色', 4],
      ['animal', '动物', 5],
      ['device', '设备', 6],
      ['event', '活动', 7],
      ['custom', '自定义', 99],
    ];
    for (const [id, name, sortOrder] of systemCategories) {
      this.db.prepare(`
        UPDATE tag_categories
        SET name = ?, sort_order = ?, is_system = 1
        WHERE id = ?
      `).run(name, sortOrder, id);
    }

    // 标签表，支持层级结构
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_id INTEGER,
        color TEXT,                    -- 标签颜色（UI 用）
        usage_count INTEGER DEFAULT 0, -- 使用次数
        created_source TEXT DEFAULT 'system',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (category_id) REFERENCES tag_categories(id),
        FOREIGN KEY (parent_id) REFERENCES tags(id),
        UNIQUE(category_id, name)
      );

      CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category_id);
      CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags(parent_id);
    `);

    // recovered from corrupted comment
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS image_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        image_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        confidence REAL DEFAULT 1.0,   -- 缃俊搴?0-1
        source TEXT DEFAULT 'manual',  -- 'ai', 'manual', 'exif', 'folder'
        ai_model TEXT,                 -- AI 模型版本
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
        UNIQUE(image_id, tag_id, source)
      );

      CREATE INDEX IF NOT EXISTS idx_img_tags_image ON image_tags(image_id);
      CREATE INDEX IF NOT EXISTS idx_img_tags_tag ON image_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_img_tags_confidence ON image_tags(confidence);
    `);

    // recovered from corrupted comment
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS import_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_path TEXT NOT NULL,
        imported_count INTEGER DEFAULT 0,
        skipped_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        import_mode TEXT,              -- 'quick', 'standard', 'full'
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME
      );
    `);

    // 资源库统计信息表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS library_stats (
        key TEXT PRIMARY KEY,
        value INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT OR IGNORE INTO library_stats (key, value) VALUES
        ('total_images', 0),
        ('thumbnail_completed', 0),
        ('ai_tag_completed', 0),
        ('manual_tag_completed', 0);
    `);

    // 智能文件夹表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS smart_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        icon TEXT,
        color TEXT,
        filter_query TEXT,      -- JSON 格式的筛选条件
        is_system INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_smart_folders_sort ON smart_folders(sort_order);
    `);

    // recovered from corrupted comment
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS image_vectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        image_id INTEGER NOT NULL UNIQUE,
        vector BLOB,             -- 序列化后的 CLIP 向量
        model_name TEXT,         -- 使用的模型版本
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_vectors_image ON image_vectors(image_id);
    `);
  }

  migrateSchema() {
    this.ensureColumn('images', 'imported_at', "ALTER TABLE images ADD COLUMN imported_at DATETIME");
    this.ensureColumn('images', 'thumbnail_at', "ALTER TABLE images ADD COLUMN thumbnail_at DATETIME");
    this.ensureColumn('images', 'tagged_at', "ALTER TABLE images ADD COLUMN tagged_at DATETIME");
    this.ensureColumn('images', 'updated_at', "ALTER TABLE images ADD COLUMN updated_at DATETIME");
    this.ensureColumn('images', 'auto_ai_tag', "ALTER TABLE images ADD COLUMN auto_ai_tag INTEGER DEFAULT 0");
    this.ensureColumn('images', 'process_priority', "ALTER TABLE images ADD COLUMN process_priority INTEGER DEFAULT 0");
    this.ensureColumn('images', 'delete_batch', "ALTER TABLE images ADD COLUMN delete_batch TEXT");
    this.ensureColumn('images', 'current_path', "ALTER TABLE images ADD COLUMN current_path TEXT");
    this.ensureColumn('tags', 'created_source', "ALTER TABLE tags ADD COLUMN created_source TEXT DEFAULT 'system'");
    this.ensureColumn('smart_folders', 'is_system', "ALTER TABLE smart_folders ADD COLUMN is_system INTEGER DEFAULT 0");

    this.db.prepare(`
      UPDATE images
      SET imported_at = COALESCE(imported_at, CURRENT_TIMESTAMP),
          updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
      WHERE imported_at IS NULL OR updated_at IS NULL
    `).run();
  }

  ensureColumn(tableName, columnName, alterSql) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.db.exec(alterSql);
  }

  ensureBuiltinTags() {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO tags (category_id, name, color, created_source)
      VALUES (?, ?, ?, 'system')
    `);
    const update = this.db.prepare(`
      UPDATE tags
      SET category_id = ?, color = ?, created_source = 'system'
      WHERE name = ?
    `);

    const insertMany = this.db.transaction((items) => {
      for (const item of items) {
        insert.run(item.categoryId, item.name, item.color || null);
        update.run(item.categoryId, item.color || null, item.name);
      }
    });

    insertMany(BUILTIN_TAG_DEFINITIONS);
  }

  // ========== 图片操作 ==========

  // 快速批量插入（仅路径信息）
  batchInsertImages(images) {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO images 
      (filename, path, folder, relative_path, size, format, auto_ai_tag, process_status, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', datetime('now'))
    `);
    const updateExisting = this.db.prepare(`
      UPDATE images
      SET folder = ?, relative_path = ?, size = ?, format = ?, auto_ai_tag = ?, updated_at = datetime('now')
      WHERE path = ?
        AND (
          COALESCE(folder, '') != COALESCE(?, '')
          OR COALESCE(relative_path, '') != COALESCE(?, '')
          OR COALESCE(size, 0) != COALESCE(?, 0)
          OR COALESCE(format, '') != COALESCE(?, '')
          OR COALESCE(auto_ai_tag, 0) != COALESCE(?, 0)
        )
    `);

    const insertMany = this.db.transaction((imgs) => {
      let inserted = 0;
      let updated = 0;
      let unchanged = 0;

      for (const img of imgs) {
        const normalizedPath = normalizePath(img.path);
        const result = insert.run(
          img.filename,
          normalizedPath,
          img.folder,
          img.relativePath,
          img.size,
          img.format,
          img.autoAiTag ? 1 : 0
        );
        inserted += result.changes || 0;

        if (!result.changes) {
          const updateResult = updateExisting.run(
            img.folder,
            img.relativePath,
            img.size,
            img.format,
            img.autoAiTag ? 1 : 0,
            normalizedPath,
            img.folder,
            img.relativePath,
            img.size,
            img.format,
            img.autoAiTag ? 1 : 0
          );
          if (updateResult.changes) {
            updated += updateResult.changes;
          } else {
            unchanged += 1;
          }
        }
      }

      return {
        changes: inserted,
        inserted,
        updated,
        unchanged,
      };
    });

    return insertMany(images);
  }

  // 获取待处理任务
  getPendingTasks(taskType, limit = 10) {
    return this.db.prepare(`
      SELECT q.*, i.path, i.current_path, i.thumbnail_path, i.filename, i.folder, i.dominant_color, i.process_status, i.auto_ai_tag
      FROM processing_queue q
      JOIN images i ON q.image_id = i.id
      WHERE q.task_type = ? AND q.status = 'pending'
      ORDER BY q.priority DESC, q.created_at ASC
      LIMIT ?
    `).all(taskType, limit);
  }

  // 添加处理任务
  addTask(imageId, taskType, priority = 0) {
    this.db.prepare(`
      INSERT INTO processing_queue (image_id, task_type, priority)
      SELECT ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1
        FROM processing_queue
        WHERE image_id = ?
          AND task_type = ?
          AND status IN ('pending', 'processing')
      )
    `).run(imageId, taskType, priority, imageId, taskType);
  }

  getExcludedFolders() {
    return this.db.prepare(`
      SELECT folder_path
      FROM excluded_folders
      ORDER BY folder_path ASC
    `).all().map((row) => normalizeFolderValue(row.folder_path)).filter(Boolean);
  }

  addExcludedFolder(folderPath) {
    const normalizedFolder = normalizeFolderValue(folderPath);
    if (!normalizedFolder) return false;

    const result = this.db.prepare(`
      INSERT OR IGNORE INTO excluded_folders (folder_path)
      VALUES (?)
    `).run(normalizedFolder);

    return Boolean(result.changes);
  }

  removeExcludedFolder(folderPath) {
    const normalizedFolder = normalizeFolderValue(folderPath);
    if (!normalizedFolder) return false;

    const result = this.db.prepare(`
      DELETE FROM excluded_folders
      WHERE folder_path = ?
         OR folder_path LIKE ?
         OR ? LIKE folder_path || '/%'
    `).run(
      normalizedFolder,
      `${normalizedFolder}/%`,
      normalizedFolder
    );

    return Boolean(result.changes);
  }

  removeExcludedFolderExact(folderPath) {
    const normalizedFolder = normalizeFolderValue(folderPath);
    if (!normalizedFolder) return false;

    const result = this.db.prepare(`
      DELETE FROM excluded_folders
      WHERE folder_path = ?
    `).run(normalizedFolder);

    return Boolean(result.changes);
  }

  isFolderExcluded(folderPath) {
    const normalizedFolder = normalizeFolderValue(folderPath);
    if (!normalizedFolder) return false;

    const row = this.db.prepare(`
      SELECT 1
      FROM excluded_folders
      WHERE folder_path = ?
         OR ? LIKE folder_path || '/%'
      LIMIT 1
    `).get(
      normalizedFolder,
      normalizedFolder
    );

    return Boolean(row);
  }

  // recovered from corrupted comment
  batchAddThumbnailTasks(imageIds) {
    if (!imageIds || imageIds.length === 0) return;

    const placeholders = imageIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      INSERT INTO processing_queue (image_id, task_type, priority)
      SELECT i.id, 'thumbnail', 0
      FROM images i
      WHERE i.id IN (${placeholders})
        AND i.process_status = 'imported'
        AND NOT EXISTS (
          SELECT 1
          FROM processing_queue q
          WHERE q.image_id = i.id
            AND q.task_type = 'thumbnail'
            AND q.status IN ('pending', 'processing')
        )
    `);
    stmt.run(...imageIds);
  }

  // recovered from corrupted comment
  updateTaskStatus(taskId, status, errorMessage = null) {
    const updates = { status };
    if (status === 'processing') {
      updates.started_at = new Date().toISOString();
    } else if (status === 'completed' || status === 'failed') {
      updates.completed_at = new Date().toISOString();
    }
    if (errorMessage) {
      updates.error_message = errorMessage;
    }

    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    
    this.db.prepare(`UPDATE processing_queue SET ${fields} WHERE id = ?`)
      .run(...values, taskId);
  }

  // recovered from corrupted comment
  updateImageStatus(imageId, status) {
    const timeField = status === 'thumbnail' ? 'thumbnail_at' : 
                      status === 'auto_tagged' ? 'tagged_at' : 'updated_at';
    
    this.db.prepare(`
      UPDATE images 
      SET process_status = ?, ${timeField} = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(status, imageId);
  }

  // 获取处理统计
  getProcessingStats() {
    return this.db.prepare(`
      WITH latest_task_per_image AS (
        SELECT
          q.task_type,
          q.image_id,
          q.status
        FROM processing_queue q
        INNER JOIN (
          SELECT
            task_type,
            image_id,
            MAX(id) AS latest_id
          FROM processing_queue
          GROUP BY task_type, image_id
        ) latest
          ON latest.latest_id = q.id
      )
      SELECT
        task_type,
        status,
        COUNT(*) as count
      FROM latest_task_per_image
      GROUP BY task_type, status
    `).all();
  }

  cleanupDuplicateActiveTasks() {
    this.db.prepare(`
      DELETE FROM processing_queue
      WHERE status IN ('pending', 'processing')
        AND id NOT IN (
          SELECT MIN(id)
          FROM processing_queue
          WHERE status IN ('pending', 'processing')
          GROUP BY image_id, task_type
        )
    `).run();
  }

  resetInterruptedTasks(taskType = null) {
    if (taskType) {
      return this.db.prepare(`
        UPDATE processing_queue
        SET status = 'pending',
            started_at = NULL,
            error_message = NULL
        WHERE task_type = ?
          AND status = 'processing'
      `).run(taskType);
    }

    return this.db.prepare(`
      UPDATE processing_queue
      SET status = 'pending',
          started_at = NULL,
          error_message = NULL
      WHERE status = 'processing'
    `).run();
  }

  resetStaleProcessingTasks(maxAgeMinutes = 10, taskType = null) {
    const baseSql = `
      UPDATE processing_queue
      SET status = 'pending',
          started_at = NULL,
          error_message = 'stale_processing_reset'
      WHERE status = 'processing'
        AND started_at IS NOT NULL
        AND datetime(replace(replace(started_at, 'T', ' '), 'Z', '')) <= datetime('now', ?)
    `;

    const ageExpr = `-${Math.max(1, Number(maxAgeMinutes) || 10)} minutes`;
    if (taskType) {
      return this.db.prepare(`
        ${baseSql}
          AND task_type = ?
      `).run(ageExpr, taskType);
    }

    return this.db.prepare(baseSql).run(ageExpr);
  }

  cleanupDisallowedAITasks() {
    return this.db.prepare(`
      DELETE FROM processing_queue
      WHERE task_type IN ('aiTag', 'ai_tag')
        AND status = 'pending'
        AND image_id IN (
          SELECT id
          FROM images
          WHERE COALESCE(auto_ai_tag, 0) = 0
        )
    `).run();
  }

  // recovered from corrupted comment
  getLibraryOverview() {
    return this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN process_status = 'imported' THEN 1 ELSE 0 END) as imported,
        SUM(CASE WHEN process_status = 'thumbnail' THEN 1 ELSE 0 END) as thumbnail_done,
        SUM(CASE WHEN process_status = 'auto_tagged' THEN 1 ELSE 0 END) as ai_tagged,
        SUM(CASE WHEN process_status = 'manual_tagged' THEN 1 ELSE 0 END) as manual_tagged
      FROM images
      WHERE is_deleted = 0
    `).get();
  }

  getImportSourceCount() {
    const folders = this.db.prepare(`
      SELECT DISTINCT folder
      FROM images
      WHERE is_deleted = 0
        AND folder IS NOT NULL
    `).all();

    const topLevelFolders = new Set();
    let hasRootFiles = false;

    for (const row of folders) {
      const normalizedFolder = normalizeFolderValue(row?.folder);
      if (!normalizedFolder) {
        hasRootFiles = true;
        continue;
      }
      topLevelFolders.add(normalizedFolder.split('/')[0]);
    }

    if (hasRootFiles) {
      topLevelFolders.add(path.basename(this.libraryPath || '') || '__library_root__');
    }

    return topLevelFolders.size;
  }

  // recovered from corrupted comment
  getUntaggedImages(limit = 50, offset = 0) {
    return this.db.prepare(`
      SELECT i.* FROM images i
      LEFT JOIN image_tags it ON i.id = it.image_id
      WHERE i.is_deleted = 0
        AND i.process_status NOT IN ('auto_tagged', 'manual_tagged')
        AND it.id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM processing_queue pq
          WHERE pq.image_id = i.id
            AND (
              pq.task_type IN ('aiTag', 'ai_tag')
              OR (pq.task_type = 'thumbnail' AND COALESCE(i.auto_ai_tag, 0) = 1)
            )
            AND pq.status IN ('pending', 'processing')
        )
      ORDER BY i.imported_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  // 添加标签
  addTag(categoryId, name, parentId = null, color = null, createdSource = 'system') {
    try {
      const result = this.db.prepare(`
        INSERT INTO tags (category_id, name, parent_id, color, created_source)
        VALUES (?, ?, ?, ?, ?)
      `).run(categoryId, name, parentId, color, createdSource);
      return result.lastInsertRowid;
    } catch (e) {
      // 已存在则返回现有 ID
      const existing = this.db.prepare(`
        SELECT id FROM tags WHERE category_id = ? AND name = ?
      `).get(categoryId, name);
      return existing?.id;
    }
  }

  findTagByName(name, options = {}) {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) return null;

    const { preferNonCustom = true } = options;
    return this.db.prepare(`
      SELECT id, category_id, name, color, created_source, usage_count
      FROM tags
      WHERE name = ?
      ORDER BY
        CASE WHEN ? = 1 AND category_id = 'custom' THEN 1 ELSE 0 END ASC,
        usage_count DESC,
        id ASC
      LIMIT 1
    `).get(trimmedName, preferNonCustom ? 1 : 0);
  }

  // 删除标签
  deleteTag(tagId) {
    const tag = this.db.prepare(`
      SELECT id, created_source
      FROM tags
      WHERE id = ?
      LIMIT 1
    `).get(tagId);

    if (!tag) {
      return false;
    }

    if ((tag.created_source || 'system') === 'system') {
      throw new Error('系统预设标签不可删除');
    }

    const linkedImages = this.db.prepare(`
      SELECT DISTINCT image_id
      FROM image_tags
      WHERE tag_id = ?
    `).all(tagId);
    const affectedImageIds = linkedImages
      .map((row) => Number(row.image_id))
      .filter((imageId) => Number.isInteger(imageId) && imageId > 0);

    const removeTag = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM image_tags WHERE tag_id = ?`).run(tagId);
      const result = this.db.prepare(`DELETE FROM tags WHERE id = ?`).run(tagId);

      if (affectedImageIds.length > 0) {
        const placeholders = affectedImageIds.map(() => '?').join(',');
        this.db.prepare(`
          UPDATE images
          SET process_status = CASE
                WHEN EXISTS (
                  SELECT 1
                  FROM image_tags it_manual
                  WHERE it_manual.image_id = images.id
                    AND it_manual.source = 'manual'
                ) THEN 'manual_tagged'
                WHEN EXISTS (
                  SELECT 1
                  FROM image_tags it_any
                  WHERE it_any.image_id = images.id
                ) THEN 'auto_tagged'
                WHEN COALESCE(images.thumbnail_path, '') != ''
                  OR images.width IS NOT NULL
                  OR images.height IS NOT NULL
                  THEN 'thumbnail'
                ELSE 'imported'
              END,
              tagged_at = CASE
                WHEN EXISTS (
                  SELECT 1
                  FROM image_tags it_auto
                  WHERE it_auto.image_id = images.id
                )
                THEN COALESCE(images.tagged_at, datetime('now'))
                ELSE images.tagged_at
              END,
              updated_at = datetime('now')
          WHERE id IN (${placeholders})
        `).run(...affectedImageIds);
      }

      return result.changes > 0;
    });

    return removeTag();
  }

  // recovered from corrupted comment
  renameTag(tagId, newName) {
    const result = this.db.prepare(`
      UPDATE tags SET name = ? WHERE id = ?
    `).run(newName, tagId);
    return result.changes > 0;
  }

  // 更新标签颜色
  updateTagColor(tagId, color) {
    const result = this.db.prepare(`
      UPDATE tags SET color = ? WHERE id = ?
    `).run(color, tagId);
    return result.changes > 0;
  }

  tagImage(imageId, tagId, confidence = 1.0, source = 'manual') {
    const existingLink = this.db.prepare(`
      SELECT id
      FROM image_tags
      WHERE image_id = ? AND tag_id = ?
      LIMIT 1
    `).get(imageId, tagId);

    this.db.prepare(`
      INSERT OR REPLACE INTO image_tags (image_id, tag_id, confidence, source)
      VALUES (?, ?, ?, ?)
    `).run(imageId, tagId, confidence, source);

    if (!existingLink) {
      this.db.prepare(`
        UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?
      `).run(tagId);
    }

    const nextStatus = source === 'manual' ? 'manual_tagged' : 'auto_tagged';
    const timeField = nextStatus === 'auto_tagged' ? 'tagged_at' : 'updated_at';
    this.db.prepare(`
      UPDATE images
      SET process_status = ?, ${timeField} = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(nextStatus, imageId);
  }

  getImageTagStats(imageId) {
    return this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN source = 'manual' THEN 1 ELSE 0 END) AS manual_count
      FROM image_tags
      WHERE image_id = ?
    `).get(imageId);
  }

  reconcileImageStatus(imageId) {
    const tagStats = this.getImageTagStats(imageId) || {};
    const totalTags = Number(tagStats.total || 0);
    const manualTags = Number(tagStats.manual_count || 0);

    if (totalTags > 0) {
      const nextStatus = manualTags > 0 ? 'manual_tagged' : 'auto_tagged';
      const timeField = nextStatus === 'auto_tagged' ? 'tagged_at' : 'updated_at';
      this.db.prepare(`
        UPDATE images
        SET process_status = ?, ${timeField} = COALESCE(${timeField}, datetime('now')), updated_at = datetime('now')
        WHERE id = ?
      `).run(nextStatus, imageId);
      return nextStatus;
    }

    const imageMeta = this.db.prepare(`
      SELECT thumbnail_path, width, height
      FROM images
      WHERE id = ?
    `).get(imageId);
    const fallbackStatus = imageMeta?.thumbnail_path || imageMeta?.width || imageMeta?.height ? 'thumbnail' : 'imported';

    this.db.prepare(`
      UPDATE images
      SET process_status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(fallbackStatus, imageId);
    return fallbackStatus;
  }

  getPeopleMislabelCandidateImageIds(limit = 500) {
    const normalizedLimit = Math.max(1, Math.min(5000, Number(limit) || 500));
    const derivedPeopleSources = [
      'mediapipe_face',
      'opencv_body',
      'ai_people_hint',
      'people_detector',
      'ai_semantic_fallback',
      'ai_semantic_floor',
    ];
    const countTagNames = ['单人', '多人'];
    const sourcePlaceholders = derivedPeopleSources.map(() => '?').join(',');
    const tagPlaceholders = countTagNames.map(() => '?').join(',');

    const rows = this.db.prepare(`
      SELECT DISTINCT i.id
      FROM images i
      JOIN image_tags it ON it.image_id = i.id
      JOIN tags t ON t.id = it.tag_id
      WHERE i.is_deleted = 0
        AND t.category_id = 'people'
        AND t.name IN (${tagPlaceholders})
        AND it.source IN (${sourcePlaceholders})
      ORDER BY i.updated_at DESC, i.id DESC
      LIMIT ?
    `).all(...countTagNames, ...derivedPeopleSources, normalizedLimit);

    return rows.map((row) => row.id).filter((id) => Number.isInteger(id));
  }

  // 从图片移除标签（通过标签名称）
  untagImage(imageId, tagName) {
    const tag = this.db.prepare(`
      SELECT id FROM tags WHERE name = ? LIMIT 1
    `).get(tagName);
    
    if (tag) {
      this.db.prepare(`
        DELETE FROM image_tags WHERE image_id = ? AND tag_id = ?
      `).run(imageId, tag.id);
      
      // 更新标签使用次数
      this.db.prepare(`
        UPDATE tags SET usage_count = MAX(0, usage_count - 1) WHERE id = ?
      `).run(tag.id);

      this.reconcileImageStatus(imageId);
    }
  }

  // 添加标签分类
  addTagCategory(id, name, sortOrder = 99, isSystem = 0) {
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO tag_categories (id, name, sort_order, is_system)
        VALUES (?, ?, ?, ?)
      `).run(id, name, sortOrder, isSystem);
      return true;
    } catch (e) {
      return false;
    }
  }

  // recovered from corrupted comment
  getTagCategories() {
    return this.db.prepare(`
      SELECT * FROM tag_categories ORDER BY sort_order
    `).all();
  }

  // 获取所有标签（按分类）
  getTagsByCategory() {
    return this.db.prepare(`
      SELECT
        tc.id as category_id,
        tc.name as category_name,
        tc.sort_order,
        t.id as tag_id,
        t.name as tag_name,
        t.color as color,
        t.created_source as created_source,
        COALESCE(COUNT(DISTINCT it.image_id), 0) as linked_count,
        t.usage_count
      FROM tag_categories tc
      LEFT JOIN tags t ON tc.id = t.category_id
      LEFT JOIN image_tags it ON t.id = it.tag_id
      GROUP BY tc.id, tc.name, tc.sort_order, t.id, t.name, t.color, t.created_source, t.usage_count
      ORDER BY tc.sort_order, linked_count DESC, t.usage_count DESC, t.name
    `).all();
  }

  getAllTagNames() {
    return this.db.prepare(`
      SELECT DISTINCT name
      FROM tags
      WHERE name IS NOT NULL AND TRIM(name) != ''
      ORDER BY usage_count DESC, name ASC
    `).all().map((row) => row.name);
  }

  getNaturalSearchCandidates(options = {}) {
    const {
      terms = [],
      folder,
      folderPath,
      status,
      limit = 240,
    } = options;

    let whereClause = 'i.is_deleted = 0';
    const params = [];

    const effectiveFolder = folderPath || folder;
    if (effectiveFolder) {
      whereClause += ` AND (i.folder = ? OR i.folder LIKE ? OR i.folder LIKE ?)`;
      params.push(
        effectiveFolder,
        `${effectiveFolder}/%`,
        `${effectiveFolder}\\%`
      );
    }

    if (status) {
      whereClause += ` AND i.process_status = ?`;
      params.push(status);
    }

    const candidateTerms = Array.from(new Set(
      (Array.isArray(terms) ? terms : [terms])
        .map((term) => String(term || '').trim())
        .filter(Boolean)
    ));

    if (candidateTerms.length) {
      const termClauses = [];
      for (const term of candidateTerms) {
        const escapedTerm = `%${escapeLikePattern(term)}%`;
        termClauses.push(`(
          i.filename LIKE ? ESCAPE '\\'
          OR i.path LIKE ? ESCAPE '\\'
          OR i.folder LIKE ? ESCAPE '\\'
          OR EXISTS (
            SELECT 1
            FROM image_tags it2
            JOIN tags t2 ON t2.id = it2.tag_id
            WHERE it2.image_id = i.id
              AND t2.name LIKE ? ESCAPE '\\'
          )
        )`);
        params.push(escapedTerm, escapedTerm, escapedTerm, escapedTerm);
      }
      whereClause += ` AND (${termClauses.join(' OR ')})`;
    }

    const normalizedLimit = Math.max(1, Math.min(2000, Number(limit) || 240));
    const query = `
      SELECT i.*, GROUP_CONCAT(DISTINCT t.name) AS tags
      FROM images i
      LEFT JOIN image_tags it ON i.id = it.image_id
      LEFT JOIN tags t ON t.id = it.tag_id
      WHERE ${whereClause}
      GROUP BY i.id
      ORDER BY i.imported_at DESC
      LIMIT ?
    `;

    return this.db.prepare(query).all(...params, normalizedLimit);
  }

  upsertImageVector(imageId, vector, modelName = null) {
    const serializedVector = serializeVector(vector);
    if (!serializedVector) {
      return false;
    }

    this.db.prepare(`
      INSERT INTO image_vectors (image_id, vector, model_name, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(image_id) DO UPDATE SET
        vector = excluded.vector,
        model_name = excluded.model_name,
        created_at = CURRENT_TIMESTAMP
    `).run(
      Number(imageId),
      serializedVector,
      modelName || null
    );

    return true;
  }

  getImageVectors(imageIds = []) {
    const normalizedIds = Array.from(new Set(
      (Array.isArray(imageIds) ? imageIds : [imageIds])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    ));

    if (!normalizedIds.length) {
      return [];
    }

    const placeholders = normalizedIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT image_id, vector, model_name, created_at
      FROM image_vectors
      WHERE image_id IN (${placeholders})
    `).all(...normalizedIds);

    return rows
      .map((row) => ({
        ...row,
        vector: deserializeVector(row.vector),
      }))
      .filter((row) => Array.isArray(row.vector) && row.vector.length > 0);
  }

  getImagesMissingVectors(limit = 8) {
    const normalizedLimit = Math.max(1, Math.min(200, Number(limit) || 8));
    return this.db.prepare(`
      SELECT
        i.id,
        i.filename,
        i.path,
        i.current_path,
        i.thumbnail_path,
        i.folder,
        i.process_status,
        i.imported_at
      FROM images i
      LEFT JOIN image_vectors iv ON iv.image_id = i.id
      WHERE i.is_deleted = 0
        AND iv.image_id IS NULL
        AND COALESCE(i.current_path, i.path, i.thumbnail_path) IS NOT NULL
      ORDER BY
        CASE i.process_status
          WHEN 'manual_tagged' THEN 1
          WHEN 'auto_tagged' THEN 2
          WHEN 'thumbnail' THEN 3
          ELSE 4
        END,
        i.imported_at DESC,
        i.id DESC
      LIMIT ?
    `).all(normalizedLimit);
  }

  countImagesMissingVectors() {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM images i
      LEFT JOIN image_vectors iv ON iv.image_id = i.id
      WHERE i.is_deleted = 0
        AND iv.image_id IS NULL
        AND COALESCE(i.current_path, i.path, i.thumbnail_path) IS NOT NULL
    `).get();

    return Number(row?.total || 0);
  }

  // 搜索图片（支持文件名、路径、标签）
  searchImages(options = {}) {
    const { keyword, folder, folderPath, status, limit = 50, offset = 0 } = options;
    
    let whereClause = 'i.is_deleted = 0';
    const params = [];

    if (keyword) {
      whereClause += ` AND (
        i.filename LIKE ?
        OR i.path LIKE ?
        OR EXISTS (
          SELECT 1
          FROM image_tags it2
          JOIN tags t2 ON t2.id = it2.tag_id
          WHERE it2.image_id = i.id
            AND t2.name LIKE ?
        )
      )`;
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const effectiveFolder = folderPath || folder;
    if (effectiveFolder) {
      whereClause += ` AND (i.folder = ? OR i.folder LIKE ? OR i.folder LIKE ?)`;
      params.push(
        effectiveFolder,
        `${effectiveFolder}/%`,
        `${effectiveFolder}\\%`
      );
    }

    if (status) {
      whereClause += ` AND i.process_status = ?`;
      params.push(status);
    }

    const query = `
      SELECT i.*, GROUP_CONCAT(DISTINCT t.name) as tags
      FROM images i
      LEFT JOIN image_tags it ON i.id = it.image_id
      LEFT JOIN tags t ON it.tag_id = t.id
      WHERE ${whereClause}
      GROUP BY i.id
      ORDER BY i.imported_at DESC
      LIMIT ? OFFSET ?
    `;

    return this.db.prepare(query).all(...params, limit, offset);
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

/**
 * 全局资源库管理器
 */
class LibraryManager {
  constructor() {
    this.libraries = new Map(); // libraryId -> LibraryDatabase
    this.configPath = null;
    this.globalConfig = null;
    this.librariesRootPath = null;
  }

  getDefaultConfig() {
    return {
      version: '2.0',
      activeLibraryId: null,
      libraries: []
    };
  }

  backupBrokenConfig(rawContent) {
    if (!this.configPath || !rawContent) return;
    try {
      const backupPath = `${this.configPath}.broken.${Date.now()}.bak`;
      fs.writeFileSync(backupPath, rawContent, 'utf8');
    } catch (_) {}
  }

  buildRecoveredConfigFromRaw(rawContent) {
    const fallback = this.getDefaultConfig();
    const text = String(rawContent || '');
    if (!text.trim()) {
      return fallback;
    }

    const activeLibraryIdMatch = text.match(/"activeLibraryId"\s*:\s*"([^"]+)"/);
    const idMatch = text.match(/"id"\s*:\s*"([^"]+)"/);
    const pathMatch = text.match(/"path"\s*:\s*"([^"]+)"/);
    const createdAtMatch = text.match(/"createdAt"\s*:\s*"([^"]+)"/);
    const nameMatch = text.match(/"name"\s*:\s*"([^"]*)/);

    const libraryId = idMatch?.[1] || activeLibraryIdMatch?.[1] || null;
    const libraryPath = pathMatch?.[1] || null;
    if (!libraryId || !libraryPath) {
      return fallback;
    }

    const libraryName = (nameMatch?.[1] || '').trim().replace(/[",]+$/g, '') || path.basename(libraryPath);
    return {
      version: '2.0',
      activeLibraryId: activeLibraryIdMatch?.[1] || libraryId,
      libraries: [
        {
          id: libraryId,
          name: libraryName,
          dataPath: libraryPath,
          path: libraryPath,
          createdAt: createdAtMatch?.[1] || new Date().toISOString()
        }
      ]
    };
  }

  loadConfigSafely() {
    if (!this.configPath || !fs.existsSync(this.configPath)) {
      return this.getDefaultConfig();
    }

    const rawContent = fs.readFileSync(this.configPath, 'utf8');
    try {
      const parsed = JSON.parse(rawContent);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('libraries.json is not an object');
      }
      if (!Array.isArray(parsed.libraries)) {
        parsed.libraries = [];
      }
      if (!Object.prototype.hasOwnProperty.call(parsed, 'activeLibraryId')) {
        parsed.activeLibraryId = null;
      }
      if (!parsed.version) {
        parsed.version = '2.0';
      }
      return parsed;
    } catch (_) {
      const recovered = this.buildRecoveredConfigFromRaw(rawContent);
      this.backupBrokenConfig(rawContent);
      return recovered;
    }
  }

  async initialize() {
    const userDataPath = electronApp
      ? electronApp.getPath('userData')
      : path.join(process.cwd(), '.data');
    
    this.configPath = path.join(userDataPath, 'libraries.json');
    this.librariesRootPath = path.join(userDataPath, 'libraries');
    fs.mkdirSync(this.librariesRootPath, { recursive: true });
    
    this.globalConfig = this.loadConfigSafely();
    for (const library of this.globalConfig.libraries) {
      if (!library.dataPath) {
        library.dataPath = library.path || path.join(this.librariesRootPath, library.id);
      }
    }
    this.saveConfig();

    if (this.globalConfig.activeLibraryId) {
      await this.loadLibrary(this.globalConfig.activeLibraryId);
    }
  }

  saveConfig() {
    fs.writeFileSync(this.configPath, JSON.stringify(this.globalConfig, null, 2));
  }

  // 创建新资源库
  async createLibrary(name) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      throw new Error('资源库名称不能为空');
    }

    const id = `lib_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const dataPath = path.join(this.librariesRootPath, id);
    
    const libraryConfig = {
      id,
      name: normalizedName,
      dataPath,
      path: '',
      createdAt: new Date().toISOString()
    };

    this.globalConfig.libraries.push(libraryConfig);
    this.saveConfig();

    // 初始化数据库
    const libDb = new LibraryDatabase(id, dataPath);
    await libDb.initialize();
    this.libraries.set(id, libDb);

    return libraryConfig;
  }

  // recovered from corrupted comment
  async loadLibrary(libraryId) {
    if (this.libraries.has(libraryId)) {
      return this.libraries.get(libraryId);
    }

    const config = this.globalConfig.libraries.find(l => l.id === libraryId);
    if (!config) {
      throw new Error(`资源库不存在: ${libraryId}`);
    }

    const libDb = new LibraryDatabase(libraryId, config.dataPath || config.path);
    await libDb.initialize();
    this.libraries.set(libraryId, libDb);

    return libDb;
  }

  // recovered from corrupted comment
  unloadLibrary(libraryId) {
    const lib = this.libraries.get(libraryId);
    if (lib) {
      lib.close();
      this.libraries.delete(libraryId);
    }
  }

  deleteLibrary(libraryId) {
    const index = this.globalConfig.libraries.findIndex(lib => lib.id === libraryId);
    if (index === -1) {
      throw new Error(`资源库不存在: ${libraryId}`);
    }

    this.unloadLibrary(libraryId);
    this.globalConfig.libraries.splice(index, 1);

    if (this.globalConfig.activeLibraryId === libraryId) {
      this.globalConfig.activeLibraryId = null;
    }

    this.saveConfig();
  }

  renameLibrary(libraryId, name) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      throw new Error('资源库名称不能为空');
    }

    const library = this.globalConfig.libraries.find((lib) => lib.id === libraryId);
    if (!library) {
      throw new Error(`资源库不存在: ${libraryId}`);
    }

    library.name = normalizedName;
    this.saveConfig();
    return {
      ...library,
      isActive: library.id === this.globalConfig.activeLibraryId,
      isLoaded: this.libraries.has(library.id),
    };
  }

  // 获取当前激活的资源库
  getActiveLibrary() {
    const id = this.globalConfig.activeLibraryId;
    return id ? this.libraries.get(id) : null;
  }

  // 获取所有库配置
  getAllLibraries() {
    return this.globalConfig.libraries.map(lib => ({
      ...lib,
      isActive: lib.id === this.globalConfig.activeLibraryId,
      isLoaded: this.libraries.has(lib.id)
    }));
  }

  // 设置激活库
  setActiveLibrary(libraryId) {
    this.globalConfig.activeLibraryId = libraryId || null;
    this.saveConfig();
  }
}

// 导出
module.exports = {
  LibraryDatabase,
  LibraryManager
};

