const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { resolveChineseClipLocalModelPath, resolveModelsRoot } = require('./modelPaths');

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
 * Python 引擎进程管理器
 * 负责启动、监控、重启 Python AI 引擎进程
 * 支持心跳检测、自动恢复和请求管理
 */
class PythonEngineManager extends EventEmitter {
  constructor(options = {}) {
    super();
    const defaultLocalModelPath = resolveChineseClipLocalModelPath();
    const defaultModelsRoot = resolveModelsRoot();
    this.pythonPath = options.pythonPath || 'python';
    this.engineScript = options.engineScript || path.join(__dirname, '../../python-backend/python_engine.py');
    this.dbPath = options.dbPath;
    this.modelCacheDir = options.modelCacheDir || path.join(defaultModelsRoot, '.hf-cache');
    this.modelName = options.modelName || defaultLocalModelPath || 'OFA-Sys/chinese-clip-vit-base-patch16';
    
    this.process = null;
    this.isRunning = false;
    this.heartbeatInterval = null;
    this.heartbeatTimeout = options.heartbeatTimeout || 1200000; // 20-minute timeout for first model download.
    this.commandTimeouts = {
      health: options.healthTimeout || 60000,
      embed_text: options.embedTextTimeout || 120000,
      embed_image: options.embedImageTimeout || 120000,
      predict_tags: options.predictTimeout || 300000,
      batch_predict_tags: options.batchPredictTimeout || 480000,
    };
    this.autoRestart = options.autoRestart !== false;
    this.maxRestarts = options.maxRestarts || 5;
    this.restartAttempts = 0;
    this.lastHeartbeat = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.stdoutBuffer = '';
    this.isStopping = false;
    this.restartTimer = null;
  }

  waitForReadyMessage(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.off('message', onMessage);
        this.off('exited', onExited);
        this.off('error', onError);
      };

      const onMessage = (message) => {
        if (message?.type !== 'ready') {
          return;
        }
        cleanup();
        resolve(message);
      };

      const onExited = ({ code, signal } = {}) => {
        cleanup();
        reject(new Error(`Python engine exited before ready (code: ${code}, signal: ${signal})`));
      };

      const onError = (error) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error || 'Python engine startup failed')));
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for Python engine ready signal'));
      }, timeoutMs);

      this.on('message', onMessage);
      this.on('exited', onExited);
      this.on('error', onError);
    });
  }

  async waitForEngineAvailability(timeoutMs = 180000) {
    const startTime = Date.now();
    let lastError = null;

    while (Date.now() - startTime < timeoutMs) {
      if (!this.process) {
        throw new Error('Python engine process exited before becoming available');
      }

      try {
        const health = await this.send('health');
        if (health?.enabled) {
          return health;
        }
        lastError = new Error('Python engine health check reported disabled');
      } catch (error) {
        lastError = error;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw lastError || new Error('Timed out waiting for Python engine availability');
  }

  /**
   * 启动 Python 引擎进程
   */
  async start() {
    return new Promise((resolve, reject) => {
      (async () => {
        if (this.isRunning) {
          return resolve();
        }

        safeConsole('log', '[PythonEngine] Starting Python engine process...');
        
        // 检查脚本文件是否存在
        if (!fs.existsSync(this.engineScript)) {
          throw new Error(`Python script not found: ${this.engineScript}`);
        }

        // 生成启动参数
        const args = [
          this.engineScript,
          '--db', this.dbPath,
          '--model', this.modelName
        ];

        // 启动进程
        this.process = spawn(this.pythonPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONUTF8: process.env.PYTHONUTF8 || '1',
            PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8',
            TRANSFORMERS_CACHE: process.env.TRANSFORMERS_CACHE || this.modelCacheDir,
            HF_HOME: process.env.HF_HOME || this.modelCacheDir,
            HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com'
          }
        });

        // 设置进程事件监听
        this.process.on('exit', (code, signal) => {
          safeConsole('log', `[PythonEngine] Process exited (code: ${code}, signal: ${signal})`);
          this.isRunning = false;
          this.stopHeartbeat();
          this.process = null;
          this.emit('exited', { code, signal });
          
          // 自动重启
          if (!this.isStopping && this.autoRestart && this.restartAttempts < this.maxRestarts) {
            this.restartAttempts++;
            safeConsole('log', `[PythonEngine] Restarting process (${this.restartAttempts}/${this.maxRestarts})...`);
            this.restartTimer = setTimeout(() => {
              this.restartTimer = null;
              this.start().catch((error) => {
                safeConsole('error', '[PythonEngine] Restart failed:', error);
              });
            }, 2000);
          }

          this.isStopping = false;
        });

        this.process.on('error', (error) => {
          safeConsole('error', '[PythonEngine] Process error:', error);
          this.emit('error', error);
        });

        // 处理 stdout（AI 引擎响应）
        this.process.stdout.on('data', (data) => {
          this.stdoutBuffer += data.toString();
          const lines = this.stdoutBuffer.split(/\r?\n/);
          this.stdoutBuffer = lines.pop() || '';

          for (const line of lines) {
            const message = line.trim();
            if (!message) continue;
            try {
              this.handleMessage(JSON.parse(message));
            } catch (error) {
              try {
                safeConsole('warn', '[PythonEngine] Failed to parse stdout message:', message);
              } catch (logError) {
                if (logError?.code !== 'EPIPE') {
                  throw logError;
                }
              }
            }
          }
        });

        // 处理 stderr（AI 引擎日志）
        this.process.stderr.on('data', (data) => {
          const message = data.toString().trim();
          if (message) {
            safeConsole('log', '[PythonEngine stderr]', message);
          }
        });

        this.isRunning = true;
        this.isStopping = false;
        this.restartAttempts = 0;

        try {
          const readyMessage = await this.waitForReadyMessage(30000);
          if (readyMessage && readyMessage.enabled === false) {
            throw new Error('Python engine reported disabled during startup');
          }
        } catch (error) {
          safeConsole('warn', '[PythonEngine] Ready signal wait did not complete, falling back to health polling:', error.message);
        }

        const health = await this.waitForEngineAvailability();
        if (!health?.enabled) {
          throw new Error('Python engine health check reported disabled');
        }

        // 启动心跳检测
        this.startHeartbeat();

        safeConsole('log', '[PythonEngine] Python engine process started');
        this.emit('started');
        resolve();
      })().catch(async (error) => {
        this.stopHeartbeat();
        this.isRunning = false;
        if (this.process && !this.isStopping) {
          this.isStopping = true;
          try {
            this.process.kill('SIGTERM');
          } catch (_) {}
        }
        safeConsole('error', '[PythonEngine] Startup failed:', error);
        this.emit('error', error);
        reject(error);
      });
    });
  }

  /**
   * 停止 Python 引擎进程
   */
  stop() {
    return new Promise((resolve) => {
      if (!this.process || !this.isRunning) {
        this.isStopping = false;
        return resolve();
      }

      safeConsole('log', '[PythonEngine] Stopping Python engine process...');
      
      this.isStopping = true;
      this.stopHeartbeat();
      this.isRunning = false;
      if (this.restartTimer) {
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
      }

      // 优雅关闭，超时后强制终止
      const timeout = setTimeout(() => {
        safeConsole('warn', '[PythonEngine] Process did not exit in time, forcing shutdown');
        if (this.process) {
          this.process.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      this.process.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.process.kill('SIGTERM');
    });
  }

  /**
   * 向 Python 引擎发送消息
   */
  send(command, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isRunning || !this.process) {
        return reject(new Error('Python engine is not running'));
      }

      const requestId = ++this.requestId;
      const timeoutMs = this.commandTimeouts[command] || this.heartbeatTimeout;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Command timed out: ${command}`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      const message = {
        id: requestId,
        cmd: command,
        data: params
      };

      try {
        this.process.stdin.write(JSON.stringify(message) + '\n');
      } catch (error) {
        this.pendingRequests.delete(requestId);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * 处理来自 Python 的消息
   */
  handleMessage(message) {
    const { id, success, ok, data, error } = message;
    const isSuccess = typeof success === 'boolean' ? success : ok;
    
    if (id && this.pendingRequests.has(id)) {
      const { resolve, reject, timeout } = this.pendingRequests.get(id);
      clearTimeout(timeout);
      this.pendingRequests.delete(id);

      if (isSuccess) {
        resolve(data);
      } else {
        reject(new Error(error || 'Unknown error'));
      }
    } else if (id) {
      safeConsole('warn', '[PythonEngine] Received unknown requestId:', id);
    }

    // 发出通用消息事件
    this.emit('message', message);
    this.lastHeartbeat = Date.now();
  }

  /**
   * 启动心跳检测
   */
  startHeartbeat() {
    this.stopHeartbeat();
    
    this.heartbeatInterval = setInterval(async () => {
      if (!this.isRunning || !this.process) {
        return;
      }

      // Python 引擎是串行处理请求的。识别任务进行中时跳过心跳，
      // 避免 health 请求排队后超时，误判为引擎挂死。
      if (this.pendingRequests.size > 0) {
        return;
      }

      try {
        // 发送 ping 指令测试进程健康状态
        await this.send('health');
        safeConsole('log', '[PythonEngine] Heartbeat ok');
      } catch (error) {
        safeConsole('error', '[PythonEngine] Heartbeat failed:', error.message);
        this.emit('heartbeat-failed', error);
        
        // 心跳失败时尝试重启
        if (!this.isStopping && this.autoRestart) {
          await this.stop();
          await this.start();
        }
      }
    }, 10000); // 每 10 秒检查一次
  }

  /**
   * 停止心跳检测
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * 获取进程状态
   */
  getStatus() {
    return {
      running: this.isRunning,
      pid: this.process?.pid || null,
      uptime: this.process ? Date.now() - this.process.startTime : 0,
      pendingRequests: this.pendingRequests.size,
      restartAttempts: this.restartAttempts,
      lastHeartbeat: this.lastHeartbeat ? new Date(this.lastHeartbeat).toISOString() : null
    };
  }

  /**
   * 调用 AI 分析图片
   */
  async analyzeImage(imagePath) {
    return this.send('predict_tags', {
      path: imagePath,
      threshold: 0.07,
      max_tags: 18
    });
  }

  /**
   * 批量分析图片
   */
  async batchAnalyzeImages(imagePaths) {
    return this.send('batch_predict_tags', {
      paths: imagePaths,
      threshold: 0.07,
      max_tags: 18
    });
  }

  async embedText(text) {
    return this.send('embed_text', {
      text: String(text || ''),
    });
  }

  async embedImage(imagePath) {
    return this.send('embed_image', {
      path: imagePath,
    });
  }

  /**
   * 获取 AI 引擎配置
   */
  async getConfig() {
    return this.send('get_config');
  }
}

module.exports = { PythonEngineManager };

