/**
 * 日志系统
 * 支持控制台输出和文件持久化
 */
const fs = require('fs');
const path = require('path');

class Logger {
  constructor(options = {}) {
    this.logDir = options.logDir || path.join(process.cwd(), '.data', 'logs');
    this.level = options.level || 'info'; // debug, info, warn, error
    this.maxFiles = options.maxFiles || 7; // 保留最近7天日志
    
    this.levels = { debug: 0, info: 1, warn: 2, error: 3 };
    
    // 确保日志目录存在
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    
    this.currentLogFile = this.getLogFilePath();
  }
  
  getLogFilePath() {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logDir, `app-${date}.log`);
  }
  
  shouldLog(level) {
    return this.levels[level] >= this.levels[this.level];
  }
  
  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }
  
  writeToFile(formattedMessage) {
    try {
      // 检查是否需要切换日志文件（跨天时）
      const newLogFile = this.getLogFilePath();
      if (newLogFile !== this.currentLogFile) {
        this.currentLogFile = newLogFile;
        this.cleanupOldLogs();
      }
      
      fs.appendFileSync(this.currentLogFile, formattedMessage + '\n');
    } catch (error) {
      console.error('写入日志文件失败:', error);
    }
  }
  
  cleanupOldLogs() {
    try {
      const files = fs.readdirSync(this.logDir)
        .filter(f => f.startsWith('app-') && f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: path.join(this.logDir, f),
          time: fs.statSync(path.join(this.logDir, f)).mtime
        }))
        .sort((a, b) => b.time - a.time);
      
      // 删除旧日志
      for (let i = this.maxFiles; i < files.length; i++) {
        try {
          fs.unlinkSync(files[i].path);
        } catch (e) {
          // 忽略删除错误
        }
      }
    } catch (error) {
      console.error('清理旧日志失败:', error);
    }
  }
  
  log(level, ...args) {
    if (!this.shouldLog(level)) return;
    
    // 处理多个参数，像 console.log 那样
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    const formatted = this.formatMessage(level, message);
    
    // 控制台输出
    const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[consoleMethod](formatted);
    
    // 文件输出（error 和 warn 级别才写入文件，减少IO）
    if (this.levels[level] >= this.levels.warn) {
      this.writeToFile(formatted);
    }
  }
  
  debug(...args) { this.log('debug', ...args); }
  info(...args) { this.log('info', ...args); }
  warn(...args) { this.log('warn', ...args); }
  error(...args) { this.log('error', ...args); }
}

// 单例模式
let instance = null;
function getLogger(options) {
  if (!instance) {
    instance = new Logger(options);
  }
  return instance;
}

module.exports = { Logger, getLogger };
