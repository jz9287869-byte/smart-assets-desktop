const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('electronAPI', {
  // ==================== V2.0 核心 API ====================
  
  // 资源库管理
  libraryAPI: {
    list: () => ipcRenderer.invoke('library:list'),
    create: (data) => ipcRenderer.invoke('library:create', data),
    switch: (data) => ipcRenderer.invoke('library:switch', data),
    rename: (data) => ipcRenderer.invoke('library:rename', data),
    delete: (data) => ipcRenderer.invoke('library:delete', data),
    deleteFolder: (data) => ipcRenderer.invoke('library:delete-folder', data),
    refresh: () => ipcRenderer.invoke('library:refresh'),
    cleanupPeopleMislabels: () => ipcRenderer.invoke('library:cleanup-people-mislabels'),
    getStatus: () => ipcRenderer.invoke('library:status'),
    getLibraryStatus: () => ipcRenderer.invoke('library:status'),
    getFolderTree: () => ipcRenderer.invoke('library:folder-tree')
  },

  // 导入功能
  importAPI: {
    selectImportFolder: () => ipcRenderer.invoke('import:select-folder'),
    selectFolder: () => ipcRenderer.invoke('import:select-folder'),
    previewImport: (data) => ipcRenderer.invoke('import:preview', data),
    preview: (data) => ipcRenderer.invoke('import:preview', data),
    startImport: (data) => ipcRenderer.invoke('import:start', data),
    start: (data) => ipcRenderer.invoke('import:start', data),
    getHistory: () => ipcRenderer.invoke('import:history'),
    onProgress: (callback) => subscribe('import:progress', callback),
    onImportProgress: (callback) => subscribe('import:progress', callback)
  },

  // 队列控制
  queueAPI: {
    getStats: () => ipcRenderer.invoke('queue:stats'),
    control: (data) => ipcRenderer.invoke('queue:control', data),
    onStatsUpdated: (callback) => subscribe('processing-stats', callback)
  },

  // 图片浏览
  imagesAPI: {
    list: (options) => ipcRenderer.invoke('images:list', options),
    listImages: (options) => ipcRenderer.invoke('images:list', options),
    naturalSearch: (options) => ipcRenderer.invoke('images:natural-search', options),
    getUntagged: (data) => ipcRenderer.invoke('images:untagged', data),
    getUntaggedIds: () => ipcRenderer.invoke('images:untagged-ids'),
    getDeleted: (data) => ipcRenderer.invoke('images:deleted', data)
  },

  // 标签管理
  tagsAPI: {
    list: () => ipcRenderer.invoke('tags:list'),
    add: (data) => ipcRenderer.invoke('tags:add', data),
    assign: (data) => ipcRenderer.invoke('tags:assign', data),
    delete: (data) => ipcRenderer.invoke('tags:delete', data),
    rename: (data) => ipcRenderer.invoke('tags:rename', data),
    update: (data) => ipcRenderer.invoke('tags:update', data)
  },

  // 标签分类
  tagCategoriesAPI: {
    list: () => ipcRenderer.invoke('tag_categories:list'),
    add: (data) => ipcRenderer.invoke('tag_categories:add', data),
    delete: (data) => ipcRenderer.invoke('tag_categories:delete', data)
  },

  // AI 引擎
  aiAPI: {
    getStatus: () => ipcRenderer.invoke('get-ai-status'),
    initialize: () => ipcRenderer.invoke('ai:initialize'),
    analyze: (data) => ipcRenderer.invoke('ai:analyze', data),
    restartPythonEngine: () => ipcRenderer.invoke('restart-python-engine'),
    getPythonEngineConfig: () => ipcRenderer.invoke('config:get-python-engine'),
    setPythonEngineConfig: (enabled) => ipcRenderer.invoke('config:set-python-engine', enabled),
    getCloudReviewConfig: () => ipcRenderer.invoke('config:get-cloud-review'),
    setCloudReviewConfig: (payload) => ipcRenderer.invoke('config:set-cloud-review', payload)
  },

  // ==================== 常用工具 API ====================
  
  // 配置
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (config) => ipcRenderer.invoke('update-config', config),
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // 图片操作
  searchImages: (query) => ipcRenderer.invoke('search-images', query),
  naturalSearchImages: (query) => ipcRenderer.invoke('search-images-natural', query),
  getFolders: () => ipcRenderer.invoke('get-folders'),
  getTags: () => ipcRenderer.invoke('get-tags'),
  getStats: () => ipcRenderer.invoke('get-stats'),
  moveToTrash: (ids) => ipcRenderer.invoke('move-to-trash', ids),
  permanentlyDelete: (ids) => ipcRenderer.invoke('permanently-delete', ids),
  restoreFromTrash: (batchId) => ipcRenderer.invoke('restore-from-trash', batchId),
  restoreImages: (ids) => ipcRenderer.invoke('restore-images', ids),
  deleteFromTrash: (batchId) => ipcRenderer.invoke('delete-from-trash', batchId),
  getTrashBatches: () => ipcRenderer.invoke('get-trash-batches'),
  
  // 文件操作
  openInFolder: (path) => ipcRenderer.invoke('open-in-folder', path),
  openImageNative: (path) => ipcRenderer.invoke('open-image-native', path),
  copyImageToClipboard: (path) => ipcRenderer.invoke('copy-image-to-clipboard', path),
  copyPathToClipboard: (text) => ipcRenderer.invoke('copy-path-to-clipboard', text),

  // 标签操作
  addTagToImage: (imageId, tagName) => ipcRenderer.invoke('add-tag-to-image', imageId, tagName),
  removeTagFromImage: (imageId, tagName) => ipcRenderer.invoke('remove-tag-from-image', imageId, tagName),
  addManualTags: (imageId, tags) => ipcRenderer.invoke('add-manual-tags', imageId, tags),

  // AI 标注
  triggerAITagging: (imageId) => ipcRenderer.invoke('trigger-ai-tagging', imageId),
  batchAITagging: (imageIds) => ipcRenderer.invoke('batch-ai-tagging', imageIds),
  triggerAiTagging: (imageId) => ipcRenderer.invoke('trigger-ai-tagging', imageId),
  batchAiTagging: (imageIds) => ipcRenderer.invoke('batch-ai-tagging', imageIds),

  // 缩略图
  regenerateThumbnails: (imageIds) => ipcRenderer.invoke('regenerate-thumbnails', imageIds),

  // 签名URL
  getSignedUrl: (payload) => ipcRenderer.invoke('get-signed-url', payload),

  // 事件监听
  onImageAdded: (callback) => subscribe('image-added', callback),
  onImageDeleted: (callback) => subscribe('image-deleted', callback),
  onFileDeleted: (callback) => subscribe('file-deleted', callback),
  onImageTagged: (callback) => subscribe('image-tagged', callback),
  onTaggingProgress: (callback) => subscribe('tagging-progress', callback),
  onThumbnailProgress: (callback) => subscribe('thumbnail-progress', callback),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

console.log('✅ 预加载脚本已加载（V2.0 + Xenova AI）');
