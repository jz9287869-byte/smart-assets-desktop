import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, Loader2, Plus, Save, Tag, X } from 'lucide-react';
import { getImageUrl, getThumbnailUrl } from '../utils/imageUtils';

function getStorageKey(storageScope) {
  return `batch-tagging:selectedImages:${storageScope || 'default'}`;
}

function dedupeImages(images) {
  const seen = new Set();
  return images.filter((image) => {
    if (!image || seen.has(image.id)) return false;
    seen.add(image.id);
    return true;
  });
}

function areIdArraysEqual(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export default function BatchTaggingTool({ showToast, storageScope = 'default' }) {
  const [images, setImages] = useState([]);
  const [queuedImages, setQueuedImages] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [tagsToAdd, setTagsToAdd] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [recentAiQueuedCount, setRecentAiQueuedCount] = useState(0);
  const [showUntaggedPool, setShowUntaggedPool] = useState(false);
  const loadRequestRef = useRef(0);
  const refreshTimerRef = useRef(null);

  const PAGE_SIZE = 20;
  const storageKey = useMemo(() => getStorageKey(storageScope), [storageScope]);

  const persistQueue = useCallback((nextImages) => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(nextImages));
    } catch (error) {
      console.error('Failed to persist batch images:', error);
    }
  }, [storageKey]);

  const loadQueuedImages = useCallback(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      const nextImages = dedupeImages(Array.isArray(parsed) ? parsed : []);
      setQueuedImages(nextImages);
    } catch (error) {
      console.error('Failed to load queued images:', error);
      setQueuedImages([]);
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
      const result = await window.electronAPI?.imagesAPI?.getUntagged?.({
        limit: PAGE_SIZE,
        offset: currentPage * PAGE_SIZE,
      });

      if (loadRequestRef.current !== requestId) {
        return;
      }

      if (result?.success) {
        setImages(result.images || []);
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
  }, [currentPage]);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  useEffect(() => {
    loadQueuedImages();
  }, [loadQueuedImages]);

  useEffect(() => {
    const scheduleRefresh = (delay = 400) => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        loadQueuedImages();
        if (queuedImages.length === 0 || showUntaggedPool) {
          loadImages({ silent: true });
        }
      }, delay);
    };

    const unsubscribeImageAdded = window.electronAPI?.onImageAdded?.(() => scheduleRefresh(180));
    const unsubscribeImageTagged = window.electronAPI?.onImageTagged?.(() => scheduleRefresh(700));

    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      unsubscribeImageAdded?.();
      unsubscribeImageTagged?.();
    };
  }, [loadImages, loadQueuedImages, queuedImages.length, showUntaggedPool]);

  useEffect(() => {
    const handleNavigate = () => {
      loadQueuedImages();
    };

    window.addEventListener('app:navigate', handleNavigate);
    return () => window.removeEventListener('app:navigate', handleNavigate);
  }, [loadQueuedImages]);

  const displayImages = useMemo(() => {
    if (queuedImages.length > 0 && !showUntaggedPool) {
      return queuedImages;
    }
    return dedupeImages([...queuedImages, ...images]);
  }, [images, queuedImages, showUntaggedPool]);

  const selectedImages = useMemo(
    () => displayImages.filter((image) => selectedIds.includes(image.id)),
    [displayImages, selectedIds]
  );

  useEffect(() => {
    const displayIds = new Set(displayImages.map((image) => image.id));
    const queuedIds = queuedImages
      .map((image) => image.id)
      .filter((id) => displayIds.has(id));

    setSelectedIds((prev) => {
      const validSelectedIds = prev.filter((id) => displayIds.has(id));
      if (validSelectedIds.length === 0 && queuedIds.length > 0) {
        return areIdArraysEqual(prev, queuedIds) ? prev : queuedIds;
      }
      return areIdArraysEqual(prev, validSelectedIds) ? prev : validSelectedIds;
    });
  }, [displayImages, queuedImages]);

  useEffect(() => {
    if (!recentAiQueuedCount) return undefined;
    const timer = window.setTimeout(() => {
      setRecentAiQueuedCount(0);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [recentAiQueuedCount]);

  useEffect(() => {
    if (queuedImages.length > 0) {
      setShowUntaggedPool(false);
    }
  }, [queuedImages.length]);

  const toggleSelection = (image) => {
    setSelectedIds((prev) => (
      prev.includes(image.id)
        ? prev.filter((id) => id !== image.id)
        : [...prev, image.id]
    ));
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setQueuedImages([]);
    persistQueue([]);
    setRecentAiQueuedCount(0);
  };

  const pushTag = (tagName) => {
    if (!tagName || tagsToAdd.includes(tagName)) return;
    setTagsToAdd((prev) => [...prev, tagName]);
  };

  const removeQueuedImage = (imageId) => {
    const nextImages = queuedImages.filter((image) => image.id !== imageId);
    setQueuedImages(nextImages);
    persistQueue(nextImages);
    setSelectedIds((prev) => prev.filter((id) => id !== imageId));
  };

  const handleAiAnalysis = async () => {
    if (selectedIds.length === 0) return;
    setIsAiProcessing(true);
    try {
      const batchAiHandler =
        window.electronAPI?.batchAiTagging
        || window.electronAPI?.batchAITagging;
      const singleAiHandler =
        window.electronAPI?.triggerAiTagging
        || window.electronAPI?.triggerAITagging;

      if (typeof batchAiHandler !== 'function' && typeof singleAiHandler !== 'function') {
        throw new Error('AI 标注接口未就绪，请重启应用后重试');
      }

      let result = null;
      let batchError = null;

      if (typeof batchAiHandler === 'function') {
        result = await batchAiHandler(selectedIds);
        if (!result?.success) {
          batchError = result?.error || '批量 AI 标注启动失败';
        }
      }

      if ((!result?.success || !result?.totalQueued) && typeof singleAiHandler === 'function') {
        let totalQueued = 0;
        const errors = [];

        for (const imageId of selectedIds) {
          const singleResult = await singleAiHandler(imageId);
          if (singleResult?.success && singleResult?.totalQueued) {
            totalQueued += singleResult.totalQueued;
          } else if (singleResult?.error) {
            errors.push(`图片 ${imageId}: ${singleResult.error}`);
          }
        }

        if (totalQueued > 0) {
          result = { success: true, totalQueued };
        } else {
          const fallbackError = errors[0] || batchError || '没有可加入 AI 队列的图片';
          throw new Error(fallbackError);
        }
      } else if (!result?.success) {
        throw new Error(batchError || 'AI tagging failed');
      }

      const remainingQueued = queuedImages.filter((image) => !selectedIds.includes(image.id));
      const processedIds = [...selectedIds];
      setQueuedImages(remainingQueued);
      persistQueue(remainingQueued);
      setSelectedIds([]);
      setImages((prev) => prev.filter((image) => !processedIds.includes(image.id)));
      setRecentAiQueuedCount(result.totalQueued || processedIds.length);
      await loadImages({ silent: true });
      showToast?.(`已加入 AI 标注队列：${result.totalQueued || processedIds.length} 张图片`);
    } catch (error) {
      console.error('Failed to trigger AI tagging:', error);
      showToast?.(`AI 标注启动失败：${error.message || '未知错误'}`);
    } finally {
      setIsAiProcessing(false);
    }
  };

  const handleApplyTags = async () => {
    if (tagsToAdd.length === 0 || selectedIds.length === 0) return;

    try {
      for (const imageId of selectedIds) {
        for (const tagName of tagsToAdd) {
          const result = await window.electronAPI?.addTagToImage(imageId, tagName);
          if (!result?.success) {
            throw new Error(result?.error || 'Failed to apply tag');
          }
        }
      }

      const processedIds = [...selectedIds];
      const remainingQueued = queuedImages.filter((image) => !processedIds.includes(image.id));
      setQueuedImages(remainingQueued);
      persistQueue(remainingQueued);
      setImages((prev) => prev.filter((image) => !processedIds.includes(image.id)));
      setTagsToAdd([]);
      setSelectedIds([]);
      await loadImages({ silent: true });
      showToast?.(`已为 ${processedIds.length} 张图片应用 ${tagsToAdd.length} 个标签`);
    } catch (error) {
      console.error('Failed to apply tags:', error);
      showToast?.('标签应用失败');
    }
  };

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col bg-slate-900/20">
        <div className="flex h-14 items-center justify-between border-b border-slate-800 bg-slate-900/60 px-6 backdrop-blur-md">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <Check size={18} className="text-blue-500" />
            当前选中 {selectedImages.length} 张图片
          </h2>
          <div className="flex items-center gap-2">
            {queuedImages.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowUntaggedPool((prev) => !prev)}
                className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-700 hover:text-slate-100"
              >
                {showUntaggedPool ? '仅看已选图片' : '继续补选未标注'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
            >
              清空选择
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {recentAiQueuedCount > 0 ? (
            <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              已将 {recentAiQueuedCount} 张图片加入 AI 标注队列，正在后台处理中。
            </div>
          ) : null}

          {queuedImages.length > 0 && !showUntaggedPool ? (
            <div className="mb-4 rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
              当前仅显示你从图片浏览加入的图片。如果需要继续补选未标注图片，可以点击右上角“继续补选未标注”。
            </div>
          ) : null}

          {isLoading ? (
            <div className="flex h-full items-center justify-center text-slate-500">加载中...</div>
          ) : displayImages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-slate-500">
              <div className="text-center">
                <Tag size={48} className="mx-auto mb-4 opacity-20" />
                <p className="mb-2">请先在图片浏览页勾选图片，再加入批量标签</p>
                <p className="text-sm text-slate-600">这里也会显示当前未打标签的图片，方便继续选择</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {displayImages.map((image) => {
                const selected = selectedIds.includes(image.id);
                const previewUrl = getThumbnailUrl(image) || getImageUrl(image);
                const isQueuedImage = queuedImages.some((item) => item.id === image.id);
                return (
                  <div
                    key={image.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleSelection(image)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleSelection(image);
                      }
                    }}
                    className={`group relative overflow-hidden rounded-lg border-2 bg-slate-800 text-left transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      selected ? 'border-blue-500 shadow-lg shadow-blue-900/10' : 'border-slate-700/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="aspect-[4/3] overflow-hidden bg-slate-900">
                      {previewUrl ? (
                        <img src={previewUrl} alt={image.filename} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-slate-500">
                          {image.format?.toUpperCase() || 'IMG'}
                        </div>
                      )}
                    </div>

                    <div className="absolute left-2 top-2 rounded-md bg-slate-950/80 px-2 py-1 text-[10px] text-slate-200">
                      {selected ? '已选中' : '点击选择'}
                    </div>

                    {isQueuedImage ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeQueuedImage(image.id);
                        }}
                        className="absolute right-2 top-2 rounded-full bg-red-500 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <X size={12} />
                      </button>
                    ) : null}

                    {isAiProcessing && selected ? (
                      <div className="absolute inset-0 bg-blue-500/15" />
                    ) : null}

                    <div className="p-3">
                      <div className="truncate text-xs text-slate-200">{image.filename}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!isLoading && displayImages.length > 0 ? (
            <div className="flex items-center justify-center gap-4 py-4">
              <button
                type="button"
                disabled={currentPage === 0}
                onClick={() => setCurrentPage((page) => page - 1)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
              >
                上一页
              </button>
              <span className="text-sm text-slate-400">第 {currentPage + 1} 页</span>
              <button
                type="button"
                disabled={images.length < PAGE_SIZE}
                onClick={() => setCurrentPage((page) => page + 1)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
              >
                下一页
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex w-[320px] shrink-0 flex-col border-l border-slate-800 bg-[#1e293b]">
        <div className="border-b border-slate-800/50 p-6">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Tag size={16} className="text-blue-400" />
            批量添加标签
          </h3>

          <button
            type="button"
            onClick={handleAiAnalysis}
            disabled={isAiProcessing || selectedImages.length === 0}
            className={`mb-5 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all ${
              isAiProcessing || selectedImages.length === 0
                ? 'cursor-not-allowed border border-slate-700 bg-slate-800 text-slate-400'
                : 'border border-emerald-500/30 bg-gradient-to-r from-emerald-600/20 to-teal-600/20 text-emerald-400'
            }`}
          >
            {isAiProcessing ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                处理中...
              </>
            ) : (
              <>
                <Bot size={16} />
                AI 一键提取
              </>
            )}
          </button>

          <div className="relative">
            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input
              type="text"
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  pushTag(tagInput.trim());
                  setTagInput('');
                }
              }}
              placeholder="手动输入标签后回车..."
              className="w-full rounded-lg border border-slate-700 bg-slate-900/50 py-2.5 pl-9 pr-4 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:bg-slate-900 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">快捷推荐</h4>
          <div className="mb-8 flex flex-wrap gap-2">
            {['自然', '极简', '高画质', '素材', '背景'].map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => pushTag(tag)}
                className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-blue-500 hover:text-blue-400"
              >
                <Plus size={12} />
                {tag}
              </button>
            ))}
          </div>

          <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">待应用队列 ({tagsToAdd.length})</h4>
          <div className="space-y-2">
            {tagsToAdd.map((tag) => (
              <div key={tag} className="flex items-center justify-between rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-400">
                <span className="flex items-center gap-2 font-medium">
                  <Tag size={14} />
                  {tag}
                </span>
                <button
                  type="button"
                  onClick={() => setTagsToAdd((prev) => prev.filter((item) => item !== tag))}
                  className="rounded p-1 text-blue-400/50 transition-colors hover:bg-red-500/10 hover:text-red-400"
                >
                  <X size={14} />
                </button>
              </div>
            ))}

            {tagsToAdd.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-700 py-8 text-center text-sm text-slate-500">
                尚未添加标签
              </div>
            ) : null}
          </div>
        </div>

        <div className="border-t border-slate-800 bg-[#1e293b] p-6">
          <button
            type="button"
            onClick={handleApplyTags}
            disabled={tagsToAdd.length === 0 || selectedImages.length === 0}
            className={`flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold text-white transition-all ${
              tagsToAdd.length === 0 || selectedImages.length === 0
                ? 'cursor-not-allowed bg-slate-700 text-slate-400'
                : 'bg-blue-600 shadow-lg shadow-blue-900/20 hover:bg-blue-500'
            }`}
          >
            <Save size={16} />
            应用到 {selectedImages.length} 张图片
          </button>
        </div>
      </div>
    </div>
  );
}
