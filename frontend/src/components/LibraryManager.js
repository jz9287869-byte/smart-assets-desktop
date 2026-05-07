import React, { useCallback, useEffect, useState } from 'react';
import {
  Database,
  Edit3,
  FolderPlus,
  Loader,
  Plus,
  Trash2,
} from 'lucide-react';

export default function LibraryManager({ onLibraryChange, showToast }) {
  const [libraries, setLibraries] = useState([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingLibraryId, setDeletingLibraryId] = useState(null);
  const [newLibraryName, setNewLibraryName] = useState('');
  const [editingLibrary, setEditingLibrary] = useState(null);

  const loadLibraries = useCallback(async () => {
    try {
      const result = await window.electronAPI?.libraryAPI?.list?.();
      if (result?.success) {
        setLibraries(result.libraries || []);
      }

      await window.electronAPI?.libraryAPI?.getStatus?.();
    } catch (error) {
      console.error('Failed to load libraries:', error);
      showToast?.('资源库加载失败');
    }
  }, [showToast]);

  useEffect(() => {
    loadLibraries();
  }, [loadLibraries]);

  const closeDialog = () => {
    setShowCreateDialog(false);
    setNewLibraryName('');
    setEditingLibrary(null);
    setIsLoading(false);
  };

  const openCreateDialog = () => {
    setEditingLibrary(null);
    setNewLibraryName('');
    setShowCreateDialog(true);
  };

  const openRenameDialog = (library) => {
    setEditingLibrary(library);
    setNewLibraryName(library?.name || '');
    setShowCreateDialog(true);
  };

  const handleSubmitLibrary = async () => {
    const name = newLibraryName.trim();
    if (!name) return;

    setIsLoading(true);
    try {
      const result = editingLibrary
        ? await window.electronAPI?.libraryAPI?.rename?.({ libraryId: editingLibrary.id, name })
        : await window.electronAPI?.libraryAPI?.create?.({ name });
      if (result?.success) {
        closeDialog();
        await loadLibraries();
        onLibraryChange?.(result.library);
        showToast?.(editingLibrary ? '资源库名称已更新' : '资源库创建成功，现在可以去导入页选择文件夹');
      } else {
        showToast?.(result?.error || (editingLibrary ? '资源库重命名失败' : '资源库创建失败'));
      }
    } catch (error) {
      console.error(editingLibrary ? 'Failed to rename library:' : 'Failed to create library:', error);
      showToast?.(editingLibrary ? '资源库重命名失败' : '资源库创建失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwitchLibrary = async (libraryId) => {
    try {
      const result = await window.electronAPI?.libraryAPI?.switch?.({ libraryId });
      if (result?.success) {
        await loadLibraries();
        onLibraryChange?.();
        showToast?.('已切换资源库');
      } else {
        showToast?.(result?.error || '切换资源库失败');
      }
    } catch (error) {
      console.error('Failed to switch library:', error);
      showToast?.('切换资源库失败');
    }
  };

  const handleDeleteLibrary = async (library) => {
    const confirmed = window.confirm(
      `确定删除资源库“${library.name}”吗？\n\n这只会删除资源库记录，不会删除原始图片文件。`
    );
    if (!confirmed) return;

    setDeletingLibraryId(library.id);
    try {
      const result = await window.electronAPI?.libraryAPI?.delete?.({ libraryId: library.id });
      if (result?.success) {
        await loadLibraries();
        onLibraryChange?.();
        showToast?.(`已删除资源库：${library.name}`);
      } else {
        showToast?.(result?.error || '删除资源库失败');
      }
    } catch (error) {
      console.error('Failed to delete library:', error);
      showToast?.('删除资源库失败');
    } finally {
      setDeletingLibraryId(null);
    }
  };

  return (
    <div className="h-full overflow-auto p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">资源库管理</h1>
          <p className="mt-1 text-sm text-slate-400">
            资源库只负责保存图片记录和标签数据，导入目录在导入页单独选择。
          </p>
        </div>

        <button
          onClick={openCreateDialog}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-900/20 transition-colors hover:bg-blue-500"
        >
          <Plus size={16} />
          新建资源库
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {libraries.map((library) => (
          <div
            key={library.id}
            onClick={() => !library.isActive && handleSwitchLibrary(library.id)}
            className={`relative cursor-pointer rounded-2xl border p-6 transition-all duration-300 ${
              library.isActive
                ? 'border-blue-500 bg-slate-800/80 shadow-xl shadow-blue-900/10 ring-1 ring-blue-500/50'
                : 'border-slate-700 bg-slate-800/40 hover:border-slate-600 hover:bg-slate-800'
            }`}
          >
            {library.isActive && (
              <div className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                当前使用
              </div>
            )}

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openRenameDialog(library);
              }}
              className="absolute bottom-4 right-24 flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/70 px-2.5 py-1.5 text-slate-400 transition-colors hover:border-blue-500/40 hover:bg-blue-500/10 hover:text-blue-300"
              title="修改名称"
            >
              <Edit3 size={14} />
              <span className="text-xs">改名</span>
            </button>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleDeleteLibrary(library);
              }}
              disabled={deletingLibraryId === library.id}
              className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/70 px-2.5 py-1.5 text-slate-400 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
              title="删除资源库"
            >
              {deletingLibraryId === library.id ? <Loader size={14} className="animate-spin" /> : <Trash2 size={14} />}
              <span className="text-xs">{deletingLibraryId === library.id ? '删除中' : '删除'}</span>
            </button>

            <div className="mb-4 flex items-center gap-4">
              <div
                className={`rounded-xl p-3 ${
                  library.isActive ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-700/50 text-slate-400'
                }`}
              >
                <Database size={24} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-200">{library.name}</h3>
                <p className="mt-1 text-xs text-slate-500">目录在导入页绑定，可导入多个来源文件夹</p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-slate-800/50 bg-slate-900/50 p-3">
                <p className="mb-1 text-xs text-slate-500">图片总数</p>
                <p className="text-lg font-bold text-slate-200">{(library.total || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-slate-800/50 bg-slate-900/50 p-3">
                <p className="mb-1 text-xs text-slate-500">来源目录</p>
                <p className="text-lg font-bold text-slate-200">{(library.sourceCount || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-slate-800/50 bg-slate-900/50 p-3">
                <p className="mb-1 text-xs text-slate-500">状态</p>
                <p className={`text-sm font-medium ${library.isActive ? 'text-blue-400' : 'text-slate-400'}`}>
                  {library.isActive ? '已连接' : '点击切换'}
                </p>
              </div>
            </div>
          </div>
        ))}

        {libraries.length === 0 && (
          <div
            onClick={openCreateDialog}
            className="flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-slate-700 p-6 transition-all hover:border-blue-500 hover:bg-slate-800/30"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-800">
              <FolderPlus size={28} className="text-slate-500" />
            </div>
            <div className="text-center">
              <h3 className="mb-1 text-base font-medium text-slate-300">创建第一个资源库</h3>
              <p className="text-sm text-slate-500">先创建资源库名称，再去导入页添加图片来源目录。</p>
            </div>
          </div>
        )}
      </div>

      {showCreateDialog && (
        <div className="dialog-overlay" onClick={closeDialog}>
          <div className="dialog" onClick={(event) => event.stopPropagation()}>
            <h3 className="mb-1 text-lg font-semibold text-slate-100">{editingLibrary ? '修改资源库名称' : '新建资源库'}</h3>
            <p className="mb-6 text-sm text-slate-400">
              {editingLibrary
                ? '这里只修改资源库名称，不会影响图片数据、标签数据和已绑定的导入来源。'
                : '这里只创建资源库本身，不绑定任何目录。创建完成后，再到导入页选择一个或多个文件夹导入。'}
            </p>

            <div className="form-group">
              <label className="mb-2 block text-sm font-medium text-slate-300">资源库名称</label>
              <input
                type="text"
                placeholder="例如：旅行风景素材库"
                value={newLibraryName}
                onChange={(event) => setNewLibraryName(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                autoFocus
              />
            </div>

            <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm leading-6 text-slate-400">
              {editingLibrary
                ? '改名后会立即在资源库列表、侧边栏和状态区域生效。'
                : '创建后可在“导入”页反复选择不同目录，统一导入到这个资源库里。'}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                className="rounded-lg border border-slate-700 px-5 py-2.5 text-sm text-slate-300 transition-colors hover:bg-slate-800"
                onClick={closeDialog}
              >
                取消
              </button>
              <button
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm text-white shadow-lg shadow-blue-900/20 transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleSubmitLibrary}
                disabled={!newLibraryName.trim() || isLoading}
              >
                {isLoading ? <Loader className="animate-spin" size={16} /> : (editingLibrary ? '保存名称' : '创建资源库')}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .dialog-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(4px);
          z-index: 1000;
        }

        .dialog {
          width: 100%;
          max-width: 520px;
          padding: 24px;
          border: 1px solid #334155;
          border-radius: 16px;
          background: #1e293b;
          box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
        }
      `}</style>
    </div>
  );
}
