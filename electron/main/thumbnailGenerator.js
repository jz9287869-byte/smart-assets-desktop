const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class ThumbnailGenerator {
  constructor() {
    this.thumbnailDir = path.join(app.getPath('userData'), 'thumbnails');
    this.ensureThumbnailDir();
  }

  // 确保缩略图目录存在
  ensureThumbnailDir() {
    if (!fs.existsSync(this.thumbnailDir)) {
      fs.mkdirSync(this.thumbnailDir, { recursive: true });
      console.log('✅ 缩略图目录已创建:', this.thumbnailDir);
    }
  }

  // 生成缩略图
  async generateThumbnail(imagePath, options = {}) {
    const {
      width = 400,
      height = 300,
      quality = 80,
      format = 'jpeg'
    } = options;

    try {
      // 生成缩略图文件名（使用图片路径的hash避免冲突）
      const filename = this.generateThumbnailFilename(imagePath);
      const thumbnailPath = path.join(this.thumbnailDir, filename);

      // 检查缩略图是否已存在
      if (fs.existsSync(thumbnailPath)) {
        return thumbnailPath;
      }

      // 检查原图是否存在
      if (!fs.existsSync(imagePath)) {
        console.warn('原图不存在:', imagePath);
        return null;
      }

      // 使用 sharp 生成缩略图
      const image = sharp(imagePath);
      const metadata = await image.metadata();

      // 保持宽高比的缩放
      const transformer = image
        .resize(width, height, {
          fit: 'inside',
          withoutEnlargement: true
        });

      // 根据格式输出
      if (format === 'jpeg') {
        await transformer.jpeg({ quality }).toFile(thumbnailPath);
      } else if (format === 'webp') {
        await transformer.webp({ quality }).toFile(thumbnailPath);
      } else if (format === 'png') {
        await transformer.png({ quality }).toFile(thumbnailPath);
      }

      console.log(`✅ 缩略图已生成: ${thumbnailPath}`);
      return thumbnailPath;

    } catch (error) {
      console.error('❌ 生成缩略图失败:', error.message);
      return null;
    }
  }

  // 批量生成缩略图
  async generateBatchThumbnails(imagePaths, options = {}, progressCallback = null) {
    const results = {
      success: 0,
      failed: 0,
      total: imagePaths.length
    };

    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i];

      try {
        const thumbnailPath = await this.generateThumbnail(imagePath, options);

        if (thumbnailPath) {
          results.success++;
        } else {
          results.failed++;
        }
      } catch (error) {
        results.failed++;
        console.error(`❌ 生成失败 ${i + 1}/${imagePaths.length}:`, error.message);
      }

      // 进度回调
      if (progressCallback) {
        progressCallback({
          current: i + 1,
          total: imagePaths.length,
          fileName: path.basename(imagePath),
          progress: ((i + 1) / imagePaths.length) * 100
        });
      }
    }

    return results;
  }

  // 生成缩略图文件名
  generateThumbnailFilename(imagePath) {
    // 使用路径的 hash 作为文件名
    const crypto = require('crypto');
    const hash = crypto.createHash('md5').update(imagePath).digest('hex');
    return `${hash}.jpg`;
  }

  // 获取缩略图路径（不生成）
  getThumbnailPath(imagePath) {
    const filename = this.generateThumbnailFilename(imagePath);
    return path.join(this.thumbnailDir, filename);
  }

  // 删除缩略图
  async deleteThumbnail(imagePath) {
    const thumbnailPath = this.getThumbnailPath(imagePath);

    if (fs.existsSync(thumbnailPath)) {
      try {
        fs.unlinkSync(thumbnailPath);
        console.log('✅ 缩略图已删除:', thumbnailPath);
        return true;
      } catch (error) {
        console.error('❌ 删除缩略图失败:', error.message);
        return false;
      }
    }

    return false;
  }

  // 清理所有缩略图
  clearAllThumbnails() {
    try {
      const files = fs.readdirSync(this.thumbnailDir);
      files.forEach(file => {
        const filePath = path.join(this.thumbnailDir, file);
        fs.unlinkSync(filePath);
      });
      console.log('✅ 所有缩略图已清理');
      return true;
    } catch (error) {
      console.error('❌ 清理缩略图失败:', error.message);
      return false;
    }
  }

  // 获取缩略图目录统计信息
  getThumbnailStats() {
    try {
      const files = fs.readdirSync(this.thumbnailDir);
      let totalSize = 0;

      files.forEach(file => {
        const filePath = path.join(this.thumbnailDir, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
      });

      return {
        count: files.length,
        totalSize: totalSize,
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2)
      };
    } catch (error) {
      return {
        count: 0,
        totalSize: 0,
        totalSizeMB: '0.00'
      };
    }
  }
}

module.exports = ThumbnailGenerator;
