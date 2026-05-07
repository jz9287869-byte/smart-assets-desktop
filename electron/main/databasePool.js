const Database = require('better-sqlite3');
const path = require('path');

/**
 * 数据库连接池管理器
 * 提供连接池、连接重用、自动清理等功能
 */
class DatabasePool {
  constructor(maxConnections = 5) {
    this.maxConnections = maxConnections;
    this.connections = new Map(); // { dbPath => connection }
    this.connectionCount = new Map(); // { dbPath => count }
  }

  /**
   * 获取或创建数据库连接
   * @param {string} dbPath - 数据库文件路径
   * @returns {Database.Database} 数据库连接
   */
  getConnection(dbPath) {
    if (!this.connections.has(dbPath)) {
      // 创建新连接
      const db = new Database(dbPath);
      
      // 应用性能优化 PRAGMA
      this.applyOptimizations(db);
      
      this.connections.set(dbPath, db);
      this.connectionCount.set(dbPath, 1);
    }

    // 更新连接使用计数
    const count = (this.connectionCount.get(dbPath) || 0) + 1;
    this.connectionCount.set(dbPath, count);

    return this.connections.get(dbPath);
  }

  /**
   * 应用数据库性能优化
   */
  applyOptimizations(db) {
    try {
      // 1. 开启 WAL 模式（提高并发性能）
      db.pragma('journal_mode = WAL');
      
      // 2. 关闭同步模式（加速写入，系统崩溃时可能丢失数据，生产环境建议用 NORMAL）
      db.pragma('synchronous = NORMAL'); // FULL = 0, NORMAL = 1, OFF = 2
      
      // 3. 增加缓存大小（单位：页面数，1页=4KB，这里设 64MB）
      db.pragma('cache_size = 16384');
      
      // 4. 启用外键约束
      db.pragma('foreign_keys = ON');
      
      // 5. 优化查询规划器（NORMAL = 1, AGGRESSIVE = 2）
      db.pragma('query_only = FALSE');
      db.pragma('optimize');
      
      // 6. 临时存储使用内存（加快临时表操作）
      db.pragma('temp_store = MEMORY');
      
      // 7. 设置最大页面数（防止数据库文件无限增长）
      db.pragma('max_page_count = 2097152'); // ~8GB
      
      // 8. 启用自动分析（优化查询性能）
      db.pragma('automatic_index = TRUE');
      
      console.log('✅ 数据库性能优化已应用');
    } catch (error) {
      console.error('❌ 应用数据库优化失败:', error);
    }
  }

  /**
   * 关闭连接
   */
  closeConnection(dbPath) {
    try {
      const db = this.connections.get(dbPath);
      if (db) {
        db.close();
        this.connections.delete(dbPath);
        this.connectionCount.delete(dbPath);
        console.log(`✅ 数据库连接已关闭: ${path.basename(dbPath)}`);
      }
    } catch (error) {
      console.error('❌ 关闭数据库连接失败:', error);
    }
  }

  /**
   * 关闭所有连接
   */
  closeAllConnections() {
    for (const [dbPath] of this.connections) {
      this.closeConnection(dbPath);
    }
    console.log('✅ 所有数据库连接已关闭');
  }

  /**
   * 清理过期连接
   */
  cleanupExpiredConnections(maxIdleTime = 300000) { // 5分钟
    const now = Date.now();
    const expired = [];
    
    for (const [dbPath, lastUsed] of this.lastAccessTime || new Map()) {
      if (now - lastUsed > maxIdleTime) {
        expired.push(dbPath);
      }
    }

    expired.forEach(dbPath => this.closeConnection(dbPath));
  }

  /**
   * 获取池状态
   */
  getStats() {
    return {
      totalConnections: this.connections.size,
      details: Array.from(this.connections.keys()).map(dbPath => ({
        path: path.basename(dbPath),
        uses: this.connectionCount.get(dbPath) || 0
      }))
    };
  }
}

module.exports = { DatabasePool };
