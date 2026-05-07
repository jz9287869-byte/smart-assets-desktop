const { Worker } = require('worker_threads');
const path = require('path');
const EventEmitter = require('events');
const { resolveModelsRoot } = require('./modelPaths');

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

class XenovaAIEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      modelName: options.modelName || 'Xenova/chinese-clip-vit-base-patch16',
      cacheDir: options.cacheDir || resolveModelsRoot(),
      maxTags: options.maxTags || 10,
      threshold: options.threshold || 0.3,
      ...options
    };

    this.worker = null;
    this.isInitialized = false;
    this.isInitializing = false;
    this.pendingRequests = new Map();
    this.requestId = 0;
  }

  async initialize() {
    if (this.isInitialized || this.isInitializing) {
      return;
    }

    this.isInitializing = true;
    safeConsole('log', 'Initializing Xenova AI engine (worker mode)...');

    try {
      const workerPath = path.join(__dirname, 'xenovaWorker.js');
      this.worker = new Worker(workerPath, {
        workerData: {
          autoInitialize: true,
          options: this.options
        }
      });

      this.worker.on('message', (message) => {
        this.handleWorkerMessage(message);
      });

      this.worker.on('error', (error) => {
        safeConsole('error', 'Xenova worker error:', error);
        this.emit('error', error);
      });

      this.worker.on('exit', (code) => {
        safeConsole('log', 'Xenova worker exited, code:', code);
        this.isInitialized = false;
        this.isInitializing = false;
        this.worker = null;
      });

      await this.waitForReady();
    } catch (error) {
      safeConsole('error', 'Xenova AI engine initialization failed', error);
      this.isInitializing = false;
      throw error;
    }
  }

  waitForReady() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Xenova AI engine initialization timed out'));
      }, 300000);

      const onReady = () => {
        clearTimeout(timeout);
        this.off('ready', onReady);
        this.off('error', onError);
        resolve();
      };

      const onError = (error) => {
        clearTimeout(timeout);
        this.off('ready', onReady);
        this.off('error', onError);
        reject(error);
      };

      this.once('ready', onReady);
      this.once('error', onError);
    });
  }

  handleWorkerMessage(message) {
    switch (message.type) {
      case 'log':
        safeConsole('log', '[Xenova]', message.message);
        break;
      case 'ready':
        this.isInitialized = true;
        this.isInitializing = false;
        safeConsole('log', 'Xenova AI engine initialized (worker mode)');
        this.emit('ready');
        break;
      case 'error':
        safeConsole('error', '[Xenova Error]', message.error);
        this.emit('error', new Error(message.error));
        break;
      case 'result': {
        const requestId = message.requestId;
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          this.pendingRequests.delete(requestId);
          if (message.success === false) {
            pending.reject(new Error(message.error || 'Xenova request failed'));
          } else {
            pending.resolve(message);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  async analyzeImage(imagePath, customTags = null) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      const requestId = ++this.requestId;
      this.pendingRequests.set(requestId, { resolve, reject });

      this.worker.postMessage({
        type: 'analyze',
        requestId,
        imagePath,
        tags: customTags
      });
    });
  }

  async embedImage(imagePath) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      const requestId = ++this.requestId;
      this.pendingRequests.set(requestId, { resolve, reject });

      this.worker.postMessage({
        type: 'embed_image',
        requestId,
        imagePath,
      });
    });
  }

  async embedText(text) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      const requestId = ++this.requestId;
      this.pendingRequests.set(requestId, { resolve, reject });

      this.worker.postMessage({
        type: 'embed_text',
        requestId,
        text,
      });
    });
  }

  async batchAnalyzeImages(imagePaths, customTags = null) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const results = {};

    for (const [imageId, imagePath] of Object.entries(imagePaths)) {
      try {
        const analysis = await this.analyzeImage(imagePath, customTags);
        results[imageId] = analysis;
      } catch (error) {
        results[imageId] = {
          success: false,
          error: error.message,
          tags: []
        };
      }
    }

    return results;
  }

  setCustomTags() {
    safeConsole('log', 'setCustomTags is not supported in worker mode yet');
  }

  addCustomTags() {
    safeConsole('log', 'addCustomTags is not supported in worker mode yet');
  }

  getStatus() {
    return {
      initialized: this.isInitialized,
      model: this.options.modelName,
      mode: 'worker',
      embedding: 'chinese-clip',
      threshold: this.options.threshold,
      maxTags: this.options.maxTags
    };
  }

  stop() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
    }
  }
}

module.exports = XenovaAIEngine;
