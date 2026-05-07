/* eslint-disable no-restricted-globals */
import React, { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Trash2, Image as ImageIcon, FolderOpen, Save } from 'lucide-react';
import { getImageUrl, formatFileSize, parseTags } from '../utils/imageUtils';

export default function TrashView({ showToast }) {
  const [images, setImages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [trashFolder, setTrashFolder] = useState('');
  const [draftTrashFolder, setDraftTrashFolder] = useState('');
  const [isSavingPath, setIsSavingPath] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const config = await window.electronAPI?.getConfig?.();
      const folder = config?.trashFolder || '';
      setTrashFolder(folder);
      setDraftTrashFolder(folder);
    } catch (error) {
      console.error('Failed to load trash config:', error);
    }
  }, []);

  const loadImages = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI?.imagesAPI?.getDeleted?.({ limit: 100, offset: 0 });
      if (result?.success) {
        setImages(result.images || []);
      } else {
        setImages([]);
      }
    } catch (error) {
      console.error('Failed to load deleted images:', error);
      setImages([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadImages();
  }, [loadConfig, loadImages]);

  const handleChooseTrashFolder = async () => {
    try {
      const result = await window.electronAPI?.importAPI?.selectFolder?.();
      if (result?.success && result?.path) {
        setDraftTrashFolder(result.path);
      }
    } catch (error) {
      console.error('Failed to choose trash folder:', error);
      alert(`选择回收站路径失败：${error.message}`);
    }
  };

  const handleSaveTrashFolder = async () => {
    if (!draftTrashFolder.trim()) {
      alert('请先选择回收站路径');
      return;
    }

    setIsSavingPath(true);
    try {
      await window.electronAPI?.updateConfig?.({ trashFolder: draftTrashFolder.trim() });
      setTrashFolder(draftTrashFolder.trim());
      alert(`回收站路径已更新为：\n${draftTrashFolder.trim()}`);
      showToast?.('回收站路径已保存');
    } catch (error) {
      console.error('Failed to save trash folder:', error);
      alert(`保存回收站路径失败：${error.message}`);
      showToast?.('回收站路径保存失败');
    } finally {
      setIsSavingPath(false);
    }
  };

  const handleRestore = async (image) => {
    if (!image?.id) return;
    if (!confirm(`确定恢复图片“${image.filename}”吗？`)) return;

    try {
      const result = await window.electronAPI?.restoreImages?.([image.id]);
      if (!result?.success) {
        throw new Error(result?.error || '恢复图片失败');
      }
      alert(`已恢复图片：${image.filename}`);
      showToast?.('已恢复图片');
      loadImages();
    } catch (error) {
      console.error('Failed to restore image:', error);
      alert(`恢复图片失败：${error.message}`);
      showToast?.('恢复图片失败');
    }
  };

  const handleDelete = async (image) => {
    if (!image?.id) return;
    if (
      !confirm(
        `确定将图片“${image.filename}”归档到每日删除记录吗？\n\n该操作不会物理删除文件，系统会把图片归档到类似“2026-03-24删除图片记录”的日期文件夹，后续如需彻底清理，请到对应文件夹手动删除。`
      )
    ) {
      return;
    }

    try {
      const result = await window.electronAPI?.permanentlyDelete?.([image.id]);
      if (!result?.success) {
        throw new Error(result?.error || '归档删除失败');
      }

      const archiveDir = result?.archiveDir || '按日期生成的删除记录文件夹';
      alert(`图片已归档：${image.filename}\n\n归档目录：${archiveDir}\n请按需前往该目录手动删除文件。`);
      showToast?.('图片已归档到每日删除记录');
      loadImages();
    } catch (error) {
      console.error('Failed to archive deleted image:', error);
      alert(`归档删除失败：${error.message}`);
      showToast?.('归档删除失败');
    }
  };

  return (
    <div className="h-full overflow-auto p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">回收站</h1>
        <p className="mt-1 text-sm text-slate-400">
          这里显示已移出资源库、但仍可恢复的图片记录。点击“归档”后，文件会进入按日期生成的删除记录文件夹，不会直接物理删除。
        </p>
      </div>

      <div className="mb-8 rounded-2xl border border-slate-700 bg-slate-900/40 p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">回收站配置路径</h2>
            <p className="mt-1 text-xs text-slate-500">
              后续移入回收站的图片会放到这里。归档删除时，系统会直接在这里创建类似“2026-03-24删除图片记录”的日期文件夹，并写入当天记录文件。
            </p>
          </div>
          <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-400">
            当前：{trashFolder || '未设置'}
          </span>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row">
          <input
            type="text"
            value={draftTrashFolder}
            onChange={(event) => setDraftTrashFolder(event.target.value)}
            placeholder="请选择回收站目录"
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleChooseTrashFolder}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-200 transition-colors hover:bg-slate-700"
          >
            <FolderOpen size={16} />
            选择目录
          </button>
          <button
            type="button"
            onClick={handleSaveTrashFolder}
            disabled={isSavingPath}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={16} />
            {isSavingPath ? '保存中...' : '保存路径'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-slate-500">加载中...</div>
      ) : images.length === 0 ? (
        <div className="flex h-[40vh] items-center justify-center text-slate-500">
          <div className="text-center">
            <Trash2 size={40} className="mx-auto mb-4 opacity-30" />
            <p>回收站当前为空</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {images.map((img) => {
            const previewUrl = getImageUrl(img);
            const tags = parseTags(img);
            return (
              <div key={img.id} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800/40">
                <div className="aspect-[4/3] bg-slate-900">
                  {previewUrl ? (
                    <img src={previewUrl} alt={img.filename} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-500">
                      <ImageIcon size={24} />
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="truncate text-sm font-medium text-slate-200">{img.filename}</div>
                  <div className="mt-1 text-xs text-slate-500">{formatFileSize(img.size)}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-400"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => handleRestore(img)}
                      className="flex-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-2 text-xs text-emerald-400 transition-colors hover:bg-emerald-500/20"
                    >
                      <span className="inline-flex items-center gap-1">
                        <RotateCcw size={12} />
                        恢复
                      </span>
                    </button>
                    <button
                      onClick={() => handleDelete(img)}
                      className="flex-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-2 text-xs text-red-400 transition-colors hover:bg-red-500/20"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Trash2 size={12} />
                        归档
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
