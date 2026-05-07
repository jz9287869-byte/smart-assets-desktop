const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

function safeConsole(method, ...args) {
  try {
    const fn = console?.[method];
    if (typeof fn === 'function') {
      fn(...args);
    }
  } catch (error) {
    if (error?.code !== 'EPIPE') {
      throw error;
    }
  }
}

/**
 * 快速导入服务
 * 支持批量扫描、快速入库、后台处理
 */
class ImportService {
  constructor(libraryDatabase, processingWorker) {
    this.db = libraryDatabase;
    this.worker = processingWorker;
    this.supportedFormats = new Set([
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp',
      '.raw', '.cr2', '.nef', '.arw', // 相机RAW
      '.mp4', '.mov', '.avi' // 视频（仅记录，不生成缩略图）
    ]);
  }

  /**
   * 快速导入文件夹
   * @param {string} folderPath - 要导入的文件夹路径
   * @param {Object} options - 导入选项
   * @param {Function} progressCallback - 进度回调
   */
  async quickImport(folderPath, options = {}, progressCallback = null) {
    const startTime = Date.now();
    const normalizedSourcePath = path.normalize(folderPath);
    const importRootName = path.basename(normalizedSourcePath);
    const importMode = options.mode || 'quick';
    const stats = {
      scanned: 0,
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: 0
    };

    try {
      this.restoreExcludedFolderForManualImport(normalizedSourcePath);
      this.restoreExcludedFolderForTrigger(normalizedSourcePath, options.triggerPath);

      // 1. 快速扫描所有文件
      if (progressCallback) {
        progressCallback({ stage: 'scanning', message: '正在扫描文件...' });
      }

      const files = await this.fastScan(folderPath, (count) => {
        stats.scanned = count;
        if (progressCallback && count % 100 === 0) {
          progressCallback({ 
            stage: 'scanning', 
            scanned: count,
            message: `已扫描 ${count} 个文件...`
          });
        }
      });

      if (progressCallback) {
        progressCallback({ 
          stage: 'scanning_complete', 
          scanned: files.length,
          message: `扫描完成，共发现 ${files.length} 个文件`
        });
      }

      // 2. 批量入库
      if (progressCallback) {
        progressCallback({ stage: 'importing', message: '正在入库...' });
      }

      const batchSize = 500;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        
        const imageRecords = batch
          .map((file) => this.buildImportRecord(file, importRootName, importMode))
          .filter((record) => !this.isImportRecordExcluded(record));

        const result = this.db.batchInsertImages(imageRecords);
        const inserted = Number(result?.inserted ?? result?.changes ?? 0);
        const updated = Number(result?.updated ?? 0);
        const unchanged = Number(result?.unchanged ?? Math.max(imageRecords.length - inserted - updated, 0));
        stats.imported += inserted;
        stats.updated += updated;
        stats.skipped += unchanged;

        if (progressCallback) {
          progressCallback({
            stage: 'importing',
            current: Math.min(i + batchSize, files.length),
            total: files.length,
            percentage: Math.round((i + batchSize) / files.length * 100),
            message: `已入库 ${Math.min(i + batchSize, files.length)}/${files.length}`
          });
        }
      }

      // 3. 根据导入模式决定后续处理
      if (importMode === 'standard' || importMode === 'full') {
        // 添加缩略图任务
        const imageIds = this.db.db.prepare(`
          SELECT id FROM images 
          WHERE process_status = 'imported' 
          AND imported_at > datetime('now', '-1 hour')
        `).all().map(r => r.id);

        if (imageIds.length > 0) {
          this.worker.batchAddThumbnailTasks(imageIds);
          
          if (progressCallback) {
            progressCallback({
              stage: 'queued',
              message: `已添加 ${imageIds.length} 个缩略图任务到后台队列`
            });
          }
        }
      }

      if (importMode === 'full') {
        // 添加AI标签任务（等缩略图完成后再处理）
        // 这里不立即添加，由缩略图完成后自动触发
      }

      // 4. 记录导入历史
      const duration = Date.now() - startTime;
      this.db.db.prepare(`
        INSERT INTO import_history (source_path, imported_count, import_mode, completed_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(normalizedSourcePath, stats.imported, importMode);

      this.repairImportedSourceFolders(normalizedSourcePath);

      if (progressCallback) {
        progressCallback({
          stage: 'completed',
          stats,
          duration,
          message: `导入完成！共导入 ${stats.imported} 个文件，耗时 ${(duration/1000).toFixed(1)} 秒`
        });
      }

      return stats;

    } catch (error) {
      console.error('导入失败:', error);
      if (progressCallback) {
        progressCallback({
          stage: 'error',
          error: error.message,
          message: `导入失败: ${error.message}`
        });
      }
      throw error;
    }
  }

  /**
   * 快速扫描文件夹
   * 使用原生命令加速大目录扫描
   */
  async fastScan(folderPath, onProgress = null) {
    const files = [];
    const normalizedFolder = path.normalize(folderPath);
    let usedRecursiveFallback = false;

    if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync(
          `dir /s /b /a:-d "${folderPath}"`,
          { maxBuffer: 1024 * 1024 * 10 }
        );

        const lines = stdout.split(/\r?\n/).filter(line => line.trim());

        for (const line of lines) {
          const fullPath = line.trim();
          const ext = path.extname(fullPath).toLowerCase();

          if (!this.supportedFormats.has(ext)) continue;

          try {
            const stats = await fs.stat(fullPath);
            const relativePath = path.relative(normalizedFolder, fullPath);

            const relativeDir = path.dirname(relativePath);
            files.push({
              name: path.basename(fullPath),
              fullPath,
              folder: relativeDir === '.' ? '' : relativeDir.split(path.sep).join('/'),
              relativePath,
              size: stats.size,
              ext,
              mtime: stats.mtime
            });

            if (onProgress) onProgress(files.length);
          } catch (_) {}
        }

        if (files.length === 0) {
          usedRecursiveFallback = true;
          await this.recursiveScan(folderPath, normalizedFolder, files, onProgress);
        }
      } catch (error) {
        safeConsole('log', 'dir scan failed, falling back to recursive scan:', error.message);
        usedRecursiveFallback = true;
        await this.recursiveScan(folderPath, normalizedFolder, files, onProgress);
      }
    } else {
      usedRecursiveFallback = true;
      await this.recursiveScan(folderPath, normalizedFolder, files, onProgress);
    }

    if (usedRecursiveFallback) {
      safeConsole('log', `[ImportService] recursive scan matched ${files.length} files for ${folderPath}`);
    }

    return files;
  }

  /**
   * 递归扫描（备用方案）
   */
  async recursiveScan(currentPath, rootPath, files, onProgress) {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.isDirectory()) {
          // 跳过隐藏文件夹
          if (entry.name.startsWith('.')) continue;
          await this.recursiveScan(fullPath, rootPath, files, onProgress);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          
          if (this.supportedFormats.has(ext)) {
            try {
              const stats = await fs.stat(fullPath);
              const relativePath = path.relative(rootPath, fullPath);
              
              const relativeDir = path.dirname(relativePath);
              files.push({
                name: entry.name,
                fullPath: fullPath,
                folder: relativeDir === '.' ? '' : relativeDir.split(path.sep).join('/'),
                relativePath: relativePath,
                size: stats.size,
                ext: ext,
                mtime: stats.mtime
              });
              
              if (onProgress) onProgress(files.length);
            } catch (e) {
              // 跳过
            }
          }
        }
      }
    } catch (error) {
      safeConsole('error', '扫描错误:', currentPath, error.message);
    }
  }

  /**
   * 获取导入历史
   */
  getImportHistory(limit = 10) {
    return this.db.db.prepare(`
      SELECT * FROM import_history
      ORDER BY started_at DESC
      LIMIT ?
    `).all(limit);
  }

  getImportSources() {
    return this.db.db.prepare(`
      SELECT DISTINCT source_path
      FROM import_history
      WHERE source_path IS NOT NULL
        AND TRIM(source_path) != ''
      ORDER BY source_path ASC
    `).all().map((row) => path.normalize(row.source_path));
  }

  /**
   * 获取导入预览（不实际导入）
   */
  async previewImport(folderPath) {
    const files = await this.fastScan(folderPath);
    
    // 按格式分组统计
    const byFormat = {};
    let totalSize = 0;
    
    for (const file of files) {
      byFormat[file.ext] = (byFormat[file.ext] || 0) + 1;
      totalSize += file.size;
    }

    return {
      totalFiles: files.length,
      totalSize,
      byFormat,
      sampleFiles: files.slice(0, 10) // 前10个文件作为示例
    };
  }

  buildImportRecord(file, importRootName, importMode = 'quick') {
    const normalizedRelativePath = (file.relativePath || file.name || '')
      .split(path.sep)
      .join('/');
    const normalizedFolder = (file.folder || '')
      .split(path.sep)
      .join('/');

    const folder = normalizedFolder
      ? `${importRootName}/${normalizedFolder}`
      : importRootName;

    const relativePath = normalizedRelativePath
      ? `${importRootName}/${normalizedRelativePath}`
      : importRootName;

    return {
      filename: file.name,
      path: file.fullPath,
      folder,
      relativePath,
      size: file.size,
      format: file.ext.slice(1).toLowerCase(),
      autoAiTag: importMode === 'full',
    };
  }

  isImportRecordExcluded(record) {
    const folder = record?.folder || '';
    if (!folder || typeof this.db?.isFolderExcluded !== 'function') {
      return false;
    }

    return this.db.isFolderExcluded(folder);
  }

  restoreExcludedFolderForManualImport(sourcePath) {
    const normalizedSourcePath = path.normalize(sourcePath || '');
    if (!normalizedSourcePath) {
      return false;
    }

    const importRootName = path.basename(normalizedSourcePath);
    if (!importRootName || typeof this.db?.removeExcludedFolderExact !== 'function') {
      return false;
    }

    // Manual imports should only restore the exact folder being imported.
    return this.db.removeExcludedFolderExact(importRootName);
  }

  restoreExcludedFolderForTrigger(sourcePath, triggerPath) {
    const normalizedSourcePath = path.normalize(sourcePath || '');
    const normalizedTriggerPath = path.normalize(triggerPath || '');
    if (!normalizedSourcePath || !normalizedTriggerPath) {
      return false;
    }
    if (typeof this.db?.removeExcludedFolder !== 'function') {
      return false;
    }
    if (normalizedTriggerPath !== normalizedSourcePath && !normalizedTriggerPath.startsWith(`${normalizedSourcePath}${path.sep}`)) {
      return false;
    }

    let relativeTarget = path.relative(normalizedSourcePath, normalizedTriggerPath);
    if (!relativeTarget || relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
      return false;
    }

    const normalizedRelative = relativeTarget.split(path.sep).join('/');
    const targetFolder = path.extname(normalizedTriggerPath)
      ? path.posix.dirname(normalizedRelative)
      : normalizedRelative;
    const importRootName = path.basename(normalizedSourcePath);
    const logicalFolder = targetFolder && targetFolder !== '.'
      ? `${importRootName}/${targetFolder}`
      : importRootName;

    return this.db.removeExcludedFolder(logicalFolder);
  }

  repairImportedSourceFolders(sourcePath) {
    const importRootName = path.basename(sourcePath);
    if (!importRootName) return;

    const rows = this.db.db.prepare(`
      SELECT id, path
      FROM images
      WHERE is_deleted = 0
        AND path LIKE ?
    `).all(`${sourcePath}%`);

    const updateStmt = this.db.db.prepare(`
      UPDATE images
      SET folder = ?, relative_path = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    const updateMany = this.db.db.transaction((items) => {
      for (const item of items) {
        const relativePath = path.relative(sourcePath, item.path);
        if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
          continue;
        }

        const normalizedRelativePath = relativePath.split(path.sep).join('/');
        const relativeDir = path.dirname(normalizedRelativePath);
        const folder = relativeDir === '.'
          ? importRootName
          : `${importRootName}/${relativeDir}`;
        const fullRelativePath = `${importRootName}/${normalizedRelativePath}`;

        updateStmt.run(folder, fullRelativePath, item.id);
      }
    });

    updateMany(rows);
  }

  repairAllImportedFolders() {
    const sources = this.db.db.prepare(`
      SELECT DISTINCT source_path
      FROM import_history
      WHERE source_path IS NOT NULL AND TRIM(source_path) != ''
      ORDER BY id DESC
    `).all();

    for (const row of sources) {
      this.repairImportedSourceFolders(path.normalize(row.source_path));
    }
  }
}

module.exports = { ImportService };
