import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Tag,
  Clock,
  FolderOpen,
  Maximize2,
  Copy,
  Trash2,
  X,
  RefreshCw,
  Square,
  CheckSquare,
} from 'lucide-react';
import { getImageUrl, formatFileSize, parseTags } from '../utils/imageUtils';
import FolderTree from './FolderTree';

function getStorageKey(storageScope) {
  return `batch-tagging:selectedImages:${storageScope || 'default'}`;
}

const PAGE_SIZE = 40;

const STATUS_CONFIG = {
  imported: { label: '仅导入', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  thumbnail: { label: '已生成缩略图', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  auto_tagged: { label: 'AI 已标注', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  manual_tagged: { label: '人工标注', color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/30' },
};

function mergeUniqueImages(images) {
  const seen = new Set();
  return images.filter((image) => {
    if (!image || seen.has(image.id)) return false;
    seen.add(image.id);
    return true;
  });
}

function getStableAssetPath(image) {
  return image?.current_path || image?.path || image?.thumbnail_path || '';
}

function getStableImagePreviewUrl(image) {
  try {
    return getImageUrl(image);
  } catch (error) {
    console.error('Failed to build stable preview url:', error);
    return '';
  }
}

export default function ImageBrowser({ showToast, storageScope = 'default' }) {
  const [images, setImages] = useState([]);
  const [batchSelection, setBatchSelection] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState(null);
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [tagInput, setTagInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const [viewerImage, setViewerImage] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [isCleaningPeopleMislabels, setIsCleaningPeopleMislabels] = useState(false);
  const [selectedPreviewUrl, setSelectedPreviewUrl] = useState('');
  const [selectedPreviewPath, setSelectedPreviewPath] = useState('');
  const tagInputRef = useRef(null);
  const loadRequestRef = useRef(0);
  const scheduledRefreshRef = useRef(null);

  const storageKey = useMemo(() => getStorageKey(storageScope), [storageScope]);

  useEffect(() => {
    setSelectedImageId(null);
    setSelectedFolder(null);
    setSearchQuery('');
    setActiveFilter(null);
    setTagInput('');
    setShowViewer(false);
    setViewerImage(null);
    setCurrentPage(0);
    setSelectedPreviewUrl('');
    setSelectedPreviewPath('');
  }, [storageScope]);

  const persistBatchSelection = useCallback((nextSelection) => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(nextSelection));
    } catch (error) {
      console.error('Failed to persist batch selection:', error);
    }
  }, [storageKey]);

  const loadImages = useCallback(async (options = {}) => {
    const { silent = false } = options;
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    if (!silent) {
      setIsLoading(true);
    }
    try {
      const result = await window.electronAPI?.searchImages?.({
        limit: PAGE_SIZE,
        offset: currentPage * PAGE_SIZE,
        keyword: searchQuery || undefined,
        status: activeFilter || undefined,
        folderPath: selectedFolder || undefined,
      });

      if (loadRequestRef.current !== requestId) {
        return;
      }

      if (result?.success) {
        setImages(result.images || []);
      } else if (result?.images) {
        setImages(result.images);
      } else {
        setImages([]);
      }
    } catch (error) {
      if (loadRequestRef.current !== requestId) {
        return;
      }
      console.error('Failed to load images:', error);
      setImages([]);
    } finally {
      if (!silent && loadRequestRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [activeFilter, currentPage, searchQuery, selectedFolder]);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  useEffect(() => {
    const scheduleRefresh = (delay = 250, options = { silent: true }) => {
      if (scheduledRefreshRef.current) {
        window.clearTimeout(scheduledRefreshRef.current);
      }
      scheduledRefreshRef.current = window.setTimeout(() => {
        scheduledRefreshRef.current = null;
        loadImages(options);
      }, delay);
    };

    const patchImageFromEvent = (payload) => {
      const nextImage = payload?.image;
      const imageId = Number(payload?.imageId || nextImage?.id);
      if (!nextImage || !Number.isInteger(imageId) || imageId <= 0) {
        return false;
      }

      let didPatch = false;
      setImages((prev) => prev.map((image) => {
        if (image.id !== imageId) {
          return image;
        }
        didPatch = true;
        return {
          ...image,
          ...nextImage,
        };
      }));
      return didPatch;
    };

    const unsubscribeImageAdded = window.electronAPI?.onImageAdded?.(() => scheduleRefresh(150, { silent: true }));
    const unsubscribeImageDeleted = window.electronAPI?.onImageDeleted?.(() => scheduleRefresh(150, { silent: true }));
    const unsubscribeImageTagged = window.electronAPI?.onImageTagged?.((payload) => {
      const patched = patchImageFromEvent(payload);
      scheduleRefresh(patched ? 600 : 300, { silent: true });
    });

    return () => {
      if (scheduledRefreshRef.current) {
        window.clearTimeout(scheduledRefreshRef.current);
        scheduledRefreshRef.current = null;
      }
      unsubscribeImageAdded?.();
      unsubscribeImageDeleted?.();
      unsubscribeImageTagged?.();
    };
  }, [loadImages]);

  useEffect(() => {
    setCurrentPage(0);
  }, [searchQuery, activeFilter, selectedFolder]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setBatchSelection(Array.isArray(parsed) ? parsed : []);
    } catch (error) {
      console.error('Failed to restore batch selection:', error);
      setBatchSelection([]);
    }
  }, [storageKey]);

  const selectedImage = images.find((img) => img.id === selectedImageId) || null;

  useEffect(() => {
    if (!selectedImage) {
      if (!selectedImageId) {
        setSelectedPreviewPath('');
        setSelectedPreviewUrl('');
      }
      return;
    }

    const nextPreviewPath = getStableAssetPath(selectedImage);
    if (!nextPreviewPath) {
      setSelectedPreviewPath('');
      setSelectedPreviewUrl('');
      return;
    }

    if (nextPreviewPath !== selectedPreviewPath) {
      setSelectedPreviewPath(nextPreviewPath);
      setSelectedPreviewUrl(getStableImagePreviewUrl(selectedImage));
    }
  }, [selectedImage, selectedImageId, selectedPreviewPath]);

  const updateLocalImageTags = useCallback((imageId, updater) => {
    setImages((prev) => prev.map((image) => {
      if (image.id !== imageId) {
        return image;
      }

      const currentTags = parseTags(image);
      const nextTags = updater(currentTags);
      return {
        ...image,
        tags: nextTags.join(','),
        process_status: 'manual_tagged',
      };
    }));
  }, []);

  const syncBatchSelection = useCallback((updater) => {
    setBatchSelection((prev) => {
      const nextSelection = mergeUniqueImages(typeof updater === 'function' ? updater(prev) : updater);
      persistBatchSelection(nextSelection);
      return nextSelection;
    });
  }, [persistBatchSelection]);

  const toggleBatchSelection = useCallback((image) => {
    syncBatchSelection((prev) => (
      prev.some((item) => item.id === image.id)
        ? prev.filter((item) => item.id !== image.id)
        : [...prev, image]
    ));
  }, [syncBatchSelection]);

  const pushBatchSelection = useCallback((imagesToAdd = batchSelection, options = {}) => {
    if (!imagesToAdd.length) return;

    const { replace = true } = options;
    const nextSelection = replace
      ? mergeUniqueImages(imagesToAdd)
      : mergeUniqueImages([...batchSelection, ...imagesToAdd]);

    setBatchSelection(nextSelection);
    persistBatchSelection(nextSelection);
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'batch-tagging' } }));
  }, [batchSelection, persistBatchSelection]);

  const toggleVisibleSelection = useCallback(() => {
    if (!images.length) return;

    const visibleIds = new Set(images.map((image) => image.id));
    const allVisibleSelected = images.every((image) => batchSelection.some((item) => item.id === image.id));

    if (allVisibleSelected) {
      syncBatchSelection((prev) => prev.filter((item) => !visibleIds.has(item.id)));
      return;
    }

    syncBatchSelection((prev) => mergeUniqueImages([...prev, ...images]));
  }, [batchSelection, images, syncBatchSelection]);

  const handleAddTag = async () => {
    if (!tagInput.trim() || !selectedImageId) return;

    try {
      const nextTag = tagInput.trim();
      const result = await window.electronAPI?.addTagToImage?.(selectedImageId, nextTag);
      if (!result?.success) {
        throw new Error(result?.error || '添加标签失败');
      }
      updateLocalImageTags(selectedImageId, (currentTags) => (
        currentTags.includes(nextTag) ? currentTags : [...currentTags, nextTag]
      ));
      loadImages({ silent: true });
      showToast?.(`已添加标签：${nextTag}`);
      setTagInput('');
      tagInputRef.current?.focus();
    } catch (error) {
      console.error('Failed to add tag:', error);
      showToast?.('添加标签失败');
    }
  };

  const handleRemoveTag = async (tagName) => {
    if (!selectedImageId) return;

    try {
      const result = await window.electronAPI?.removeTagFromImage?.(selectedImageId, tagName);
      if (!result?.success) {
        throw new Error(result?.error || '移除标签失败');
      }
      updateLocalImageTags(selectedImageId, (currentTags) => currentTags.filter((tag) => tag !== tagName));
      loadImages({ silent: true });
      showToast?.(`已移除标签：${tagName}`);
      tagInputRef.current?.focus();
    } catch (error) {
      console.error('Failed to remove tag:', error);
      showToast?.('移除标签失败');
    }
  };

  const openInFolder = async (image) => {
    try {
      await window.electronAPI?.openInFolder?.(image.path);
    } catch (error) {
      console.error('Failed to open folder:', error);
    }
  };

  const copyPath = async (image) => {
    try {
      await window.electronAPI?.copyPathToClipboard?.(image.path);
      showToast?.('文件路径已复制');
    } catch (error) {
      console.error('Failed to copy path:', error);
    }
  };

  const deleteImage = async (imageId) => {
    try {
      await window.electronAPI?.moveToTrash?.([imageId]);
      if (selectedImageId === imageId) {
        setSelectedImageId(null);
      }
      syncBatchSelection((prev) => prev.filter((item) => item.id !== imageId));
      await loadImages();
      showToast?.('已移至回收站');
    } catch (error) {
      console.error('Failed to move image to trash:', error);
      showToast?.('移至回收站失败');
    }
  };

  const refreshCurrentLibrary = async () => {
    try {
      setIsLoading(true);
      const result = await window.electronAPI?.libraryAPI?.refresh?.();
      if (result?.success) {
        await loadImages();
        const importedCount = result?.stats?.imported ?? result?.stats?.changes ?? 0;
        showToast?.(importedCount > 0 ? `已刷新资源库，发现 ${importedCount} 张新图片` : '已刷新资源库');
      } else {
        showToast?.(result?.error || '刷新资源库失败');
      }
    } catch (error) {
      console.error('Failed to refresh library:', error);
      showToast?.('刷新资源库失败');
    } finally {
      setIsLoading(false);
    }
  };

  const cleanupPeopleMislabels = async () => {
    try {
      setIsCleaningPeopleMislabels(true);
      const result = await window.electronAPI?.libraryAPI?.cleanupPeopleMislabels?.();
      if (!result?.success) {
        throw new Error(result?.error || '清理人物误标失败');
      }

      if ((result?.queued || 0) > 0) {
        showToast?.(`已加入复核队列 ${result.queued} 张，人物误标会按新规则自动清理`);
      } else if ((result?.candidates || 0) > 0) {
        showToast?.(`已找到 ${result.candidates} 张候选图片，但它们已在处理中`);
      } else {
        showToast?.(result?.message || '当前资源库没有可复核的人物误标候选图片');
      }

      await loadImages({ silent: true });
    } catch (error) {
      console.error('Failed to cleanup people mislabels:', error);
      showToast?.('清理人物误标失败');
    } finally {
      setIsCleaningPeopleMislabels(false);
    }
  };

  const openImageViewer = (image) => {
    setViewerImage(image);
    setShowViewer(true);
  };

  const filteredImages = useMemo(() => images, [images]);
  const allVisibleSelected = filteredImages.length > 0 && filteredImages.every((image) => (
    batchSelection.some((item) => item.id === image.id)
  ));
  const viewerIndex = viewerImage ? filteredImages.findIndex((img) => img.id === viewerImage.id) : -1;

  return (
    <div className="flex h-full overflow-hidden">
      <FolderTree
        selectedFolder={selectedFolder}
        onFolderSelect={setSelectedFolder}
        showToast={showToast}
        storageScope={storageScope}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="z-10 flex h-16 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/80 px-6 backdrop-blur-md">
          <div className="flex flex-1 items-center gap-4">
            <div className="group relative w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-blue-500" size={18} />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && setCurrentPage(0)}
                placeholder="搜索图片名称、标签..."
                className="w-full rounded-lg border border-slate-700 bg-slate-800/50 py-2 pl-10 pr-4 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:bg-slate-800 focus:outline-none"
              />
            </div>

            <div className="mx-2 h-6 w-px bg-slate-800"></div>

            <div className="flex items-center gap-2">
              {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveFilter(activeFilter === key ? null : key)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                    activeFilter === key
                      ? `${config.bg} ${config.color} ${config.border} ring-2 ring-blue-500`
                      : 'border-transparent bg-transparent text-slate-400 hover:border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  {config.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm text-slate-500">
            <button type="button" onClick={toggleVisibleSelection} disabled={filteredImages.length === 0} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${allVisibleSelected ? 'border-blue-500/40 bg-blue-500/10 text-blue-300' : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:border-blue-500/40 hover:text-blue-300'}`}>
              {allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />}
              全选当前页
            </button>

            <button type="button" onClick={refreshCurrentLibrary} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-blue-500/40 hover:text-blue-300">
              <RefreshCw size={14} />
              刷新图片
            </button>

            <button
              type="button"
              onClick={cleanupPeopleMislabels}
              disabled={isCleaningPeopleMislabels}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-amber-500/40 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={14} className={isCleaningPeopleMislabels ? 'animate-spin' : ''} />
              {isCleaningPeopleMislabels ? '清理中' : '清理人物误标'}
            </button>

            <button type="button" onClick={() => pushBatchSelection()} disabled={batchSelection.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800/60 disabled:text-slate-500">
              <Tag size={14} />
              加入批量标签{batchSelection.length > 0 ? ` (${batchSelection.length})` : ''}
            </button>

            <span>找到 {filteredImages.length} 张图片</span>
          </div>
        </div>

        <div className="scrollbar-hide flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex h-full flex-col items-center justify-center text-slate-500">
              <div className="mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-blue-500"></div>
              <p>正在加载图片...</p>
            </div>
          ) : filteredImages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-slate-500">
              <Search size={48} className="mb-4 opacity-20" />
              <p>当前条件下没有找到图片</p>
            </div>
          ) : (
            <div className={`grid gap-6 ${selectedImage ? 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'}`}>
              {filteredImages.map((img) => {
                const tags = parseTags(img);
                const statusCfg = STATUS_CONFIG[img.process_status] || STATUS_CONFIG.imported;
                const previewUrl = getImageUrl(img);
                const checked = batchSelection.some((item) => item.id === img.id);

                return (
                  <div key={img.id} onClick={() => {
                    setSelectedImageId(img.id);
                    setSelectedPreviewPath(getStableAssetPath(img));
                    setSelectedPreviewUrl(getStableImagePreviewUrl(img));
                  }} className={`group relative cursor-pointer overflow-hidden rounded-xl border bg-slate-800 transition-all duration-300 ${selectedImage?.id === img.id ? 'border-blue-500 shadow-lg shadow-blue-900/20 ring-1 ring-blue-500' : 'border-slate-700/50 hover:border-blue-500/50 hover:shadow-xl hover:shadow-blue-900/10'}`}>
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-900">
                      {previewUrl ? (
                        <img src={previewUrl} alt={img.filename} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-500">
                          <Clock size={24} />
                          <span className="text-xs">处理中</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/20 to-transparent opacity-60 transition-opacity group-hover:opacity-80"></div>
                      <div className="absolute right-3 top-3">
                        <span className={`rounded-md border px-2 py-1 text-[10px] font-medium shadow-sm backdrop-blur-md ${statusCfg.bg} ${statusCfg.color} ${statusCfg.border}`}>{statusCfg.label}</span>
                      </div>
                      <div className="absolute left-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
                        <button type="button" className="rounded-md border border-slate-700/50 bg-slate-900/60 p-1.5 text-white backdrop-blur-sm hover:bg-blue-600" onClick={(event) => { event.stopPropagation(); openImageViewer(img); }}>
                          <Maximize2 size={14} />
                        </button>
                      </div>
                      <div className="absolute bottom-3 left-3">
                        <button type="button" onClick={(event) => { event.stopPropagation(); toggleBatchSelection(img); }} className="flex items-center gap-1 rounded-md border border-slate-700/60 bg-slate-950/70 px-2 py-1 text-[10px] text-slate-200 backdrop-blur-sm transition-colors hover:border-blue-500/40 hover:text-blue-300">
                          {checked ? <CheckSquare size={12} /> : <Square size={12} />}
                          {checked ? '已加入' : '加入批量'}
                        </button>
                      </div>
                    </div>

                    <div className="p-4">
                      <h3 className="truncate text-sm font-medium text-slate-200" title={img.filename}>{img.filename}</h3>
                      <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                        <span>{formatFileSize(img.size)}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {tags.length > 0 ? (
                          <>
                            {tags.slice(0, 2).map((tag) => (
                              <span key={tag} className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-400">{tag}</span>
                            ))}
                            {tags.length > 2 && (
                              <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-500">+{tags.length - 2}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-[11px] text-slate-600">暂无标签</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-8 flex items-center justify-center gap-4">
            <button type="button" onClick={() => setCurrentPage((page) => Math.max(0, page - 1))} disabled={currentPage === 0} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 transition-colors hover:border-blue-500/40 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-40">上一页</button>
            <span className="text-sm text-slate-500">第 {currentPage + 1} 页</span>
            <button type="button" onClick={() => setCurrentPage((page) => page + 1)} disabled={filteredImages.length < PAGE_SIZE} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 transition-colors hover:border-blue-500/40 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-40">下一页</button>
          </div>
        </div>
      </div>

      {selectedImage && (
        <aside className="w-80 shrink-0 border-l border-slate-800 bg-slate-900/60 p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-100">图片详情</h2>
            <button type="button" onClick={() => setSelectedImageId(null)} className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300">
              <X size={18} />
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800/60">
            <div className="aspect-[4/3] bg-slate-950">
              {selectedPreviewUrl ? (
                <img src={selectedPreviewUrl} alt={selectedImage.filename} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-slate-500">
                  <Clock size={32} />
                </div>
              )}
            </div>
            <div className="p-4">
              <h3 className="break-all text-sm font-medium text-slate-200">{selectedImage.filename}</h3>
              <p className="mt-1 text-xs text-slate-500">{formatFileSize(selectedImage.size)} · {selectedImage.folder || '-'}</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => openImageViewer(selectedImage)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-blue-500/40 hover:text-blue-300">
              <Maximize2 size={14} />
              查看大图
            </button>
            <button type="button" onClick={() => openInFolder(selectedImage)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-blue-500/40 hover:text-blue-300">
              <FolderOpen size={14} />
              打开目录
            </button>
          </div>

          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-300">标签管理</h3>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] ${selectedImage.process_status === 'auto_tagged' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
                {selectedImage.process_status === 'auto_tagged' ? 'AI 已标注' : '未完成 AI 标注'}
              </span>
            </div>

            <div className="flex gap-2">
              <input
                ref={tagInputRef}
                type="text"
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && handleAddTag()}
                placeholder="输入标签后回车添加"
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {parseTags(selectedImage).length > 0 ? (
                parseTags(selectedImage).map((tag) => (
                  <button key={tag} type="button" onClick={() => handleRemoveTag(tag)} className="inline-flex items-center gap-1 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-300 transition-colors hover:bg-red-500/10 hover:text-red-300">
                    {tag}
                    <X size={12} />
                  </button>
                ))
              ) : (
                <p className="text-xs text-slate-500">当前没有标签</p>
              )}
            </div>
          </div>

          <div className="mt-6 space-y-2">
            <button type="button" onClick={() => copyPath(selectedImage)} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-blue-500/40 hover:text-blue-300">
              <Copy size={14} />
              复制文件路径
            </button>
            <button type="button" onClick={() => pushBatchSelection([selectedImage])} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-300 transition-colors hover:bg-blue-500/20">
              <Tag size={14} />
              加入批量标签
            </button>
            <button type="button" onClick={() => deleteImage(selectedImage.id)} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300 transition-colors hover:bg-red-500/20">
              <Trash2 size={14} />
              移至回收站
            </button>
          </div>
        </aside>
      )}

      {showViewer && viewerImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 p-8">
          <button type="button" onClick={() => setShowViewer(false)} className="absolute right-6 top-6 rounded-full border border-slate-700 bg-slate-900/70 p-3 text-slate-300 transition-colors hover:border-blue-500/40 hover:text-blue-300">
            <X size={18} />
          </button>

          {viewerIndex > 0 && (
            <button type="button" onClick={() => setViewerImage(filteredImages[viewerIndex - 1])} className="absolute left-6 rounded-full border border-slate-700 bg-slate-900/70 p-3 text-slate-300 transition-colors hover:border-blue-500/40 hover:text-blue-300">
              {'<'}
            </button>
          )}

          <div className="max-h-full max-w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            <img src={getImageUrl(viewerImage)} alt={viewerImage.filename} className="max-h-[85vh] max-w-[85vw] object-contain" />
          </div>

          {viewerIndex >= 0 && viewerIndex < filteredImages.length - 1 && (
            <button type="button" onClick={() => setViewerImage(filteredImages[viewerIndex + 1])} className="absolute right-6 rounded-full border border-slate-700 bg-slate-900/70 p-3 text-slate-300 transition-colors hover:border-blue-500/40 hover:text-blue-300">
              {'>'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
