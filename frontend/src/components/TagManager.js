/* eslint-disable no-restricted-globals */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  Edit3,
  FolderOpen,
  Plus,
  Search,
  Tag,
  Trash2,
} from 'lucide-react';

const SYSTEM_CATEGORIES = [
  { id: 'scene', name: '场景', icon: '🗺️', sortOrder: 1, isSystem: true },
  { id: 'location', name: '地点', icon: '📍', sortOrder: 2, isSystem: true },
  { id: 'people', name: '人物', icon: '🧑', sortOrder: 3, isSystem: true },
  { id: 'color', name: '颜色', icon: '🎨', sortOrder: 4, isSystem: true },
  { id: 'animal', name: '动物', icon: '🦊', sortOrder: 5, isSystem: true },
  { id: 'device', name: '设备', icon: '📷', sortOrder: 6, isSystem: true },
  { id: 'event', name: '活动', icon: '🎪', sortOrder: 7, isSystem: true },
  { id: 'custom', name: '自定义', icon: '✨', sortOrder: 99, isSystem: true },
];

const SYSTEM_CATEGORY_MAP = new Map(SYSTEM_CATEGORIES.map((category) => [category.id, category]));

function buildCategoryList(categoryRows = []) {
  const customCategories = (Array.isArray(categoryRows) ? categoryRows : [])
    .filter((category) => category?.id && !SYSTEM_CATEGORY_MAP.has(category.id))
    .map((category) => ({
      id: category.id,
      name: category.name,
      icon: '✨',
      sortOrder: Number(category.sort_order) || 999,
      isSystem: Boolean(category.is_system),
    }))
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name, 'zh-CN');
    });

  return [...SYSTEM_CATEGORIES, ...customCategories];
}

export default function TagManager({ showToast }) {
  const [categories, setCategories] = useState([]);
  const [activeCat, setActiveCat] = useState('scene');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [isAddingCat, setIsAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const loadRequestRef = useRef(0);
  const refreshTimerRef = useRef(null);

  const loadTags = useCallback(async () => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;

    try {
      const [tagResult, categoryResult] = await Promise.all([
        window.electronAPI?.tagsAPI?.list?.(),
        window.electronAPI?.tagCategoriesAPI?.list?.(),
      ]);

      if (loadRequestRef.current !== requestId) {
        return;
      }

      const sourceCategories = buildCategoryList(categoryResult?.categories || []);
      const grouped = sourceCategories.map((category) => ({
        ...category,
        tags: (tagResult?.tags || [])
          .filter((tag) => tag.tag_id && tag.category_id === category.id)
          .map((tag) => ({
            id: tag.tag_id,
            name: tag.tag_name,
            count: tag.linked_count ?? tag.usage_count ?? 0,
            createdSource: tag.created_source || 'system',
            canDelete: (tag.created_source || 'system') !== 'system',
          })),
      }));

      setCategories(grouped);
      if (!grouped.some((category) => category.id === activeCat)) {
        setActiveCat(grouped[0]?.id || 'scene');
      }
    } catch (error) {
      console.error('Failed to load tags:', error);
      showToast?.('标签数据加载失败');
    }
  }, [activeCat, showToast]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        loadTags();
      }, 500);
    };

    const unsubscribe = window.electronAPI?.onImageTagged?.(() => scheduleRefresh());
    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      unsubscribe?.();
    };
  }, [loadTags]);

  const handleDelete = async (id) => {
    if (!confirm('确定要删除这个标签吗？')) return;

    try {
      const result = await window.electronAPI?.tagsAPI?.delete?.({ tagId: id });
      if (!result?.success || result?.deleted === false) {
        throw new Error(result?.error || '删除标签失败');
      }
      await loadTags();
      showToast?.('标签已删除');
    } catch (error) {
      console.error('Failed to delete tag:', error);
      showToast?.(error.message || '删除标签失败');
    }
  };

  const handleDeleteCategory = async (category) => {
    if (!category || category.isSystem) return;
    if (!confirm(`确定要删除分类“${category.name}”吗？\n\n该分类下的标签也会一起删除。`)) return;

    try {
      const result = await window.electronAPI?.tagCategoriesAPI?.delete?.({ categoryId: category.id });
      if (!result?.success) {
        throw new Error(result?.error || '删除分类失败');
      }
      await loadTags();
      setActiveCat('scene');
      showToast?.('分类已删除');
    } catch (error) {
      console.error('Failed to delete category:', error);
      showToast?.(error.message || '删除分类失败');
    }
  };

  const startEdit = (tag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
  };

  const saveEdit = async () => {
    if (!editName.trim()) return;

    try {
      const result = await window.electronAPI?.tagsAPI?.rename?.({
        tagId: editingId,
        name: editName.trim(),
      });
      if (!result?.success) {
        throw new Error(result?.error || '重命名标签失败');
      }
      setEditingId(null);
      setEditName('');
      await loadTags();
      showToast?.('标签名称已更新');
    } catch (error) {
      console.error('Failed to rename tag:', error);
      showToast?.(error.message || '重命名标签失败');
    }
  };

  const saveNewTag = async () => {
    if (!newName.trim() || !activeCat) return;

    try {
      const result = await window.electronAPI?.tagsAPI?.add?.({
        categoryId: activeCat,
        name: newName.trim(),
      });
      if (!result?.success) {
        throw new Error(result?.error || '创建标签失败');
      }
      setIsAdding(false);
      setNewName('');
      await loadTags();
      showToast?.('新标签已创建');
    } catch (error) {
      console.error('Failed to create tag:', error);
      showToast?.(error.message || '创建标签失败');
    }
  };

  const saveNewCategory = async () => {
    const trimmedName = newCatName.trim();
    if (!trimmedName) return;

    const newId = `cat_${typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().split('-')[0]
      : Math.random().toString(36).slice(2, 10)}`;

    try {
      const result = await window.electronAPI?.tagCategoriesAPI?.add?.({ id: newId, name: trimmedName });
      if (!result?.success) {
        throw new Error(result?.error || '创建分类失败');
      }
      setIsAddingCat(false);
      setNewCatName('');
      await loadTags();
      setActiveCat(newId);
      showToast?.('分类已创建');
    } catch (error) {
      console.error('Failed to create category:', error);
      showToast?.(error.message || '创建分类失败');
    }
  };

  const currentCategory = categories.find((category) => category.id === activeCat) || null;
  const currentTags = useMemo(() => {
    const tags = currentCategory?.tags || [];
    if (!searchQuery.trim()) return tags;
    return tags.filter((tag) => tag.name.toLowerCase().includes(searchQuery.trim().toLowerCase()));
  }, [currentCategory, searchQuery]);

  return (
    <div className="flex h-full">
      <div className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900/40 p-4">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">标签分类</h2>
          <button
            type="button"
            onClick={() => setIsAddingCat(true)}
            className="rounded-md border border-transparent p-1.5 text-slate-400 transition-colors hover:border-blue-500/20 hover:bg-blue-500/10 hover:text-blue-400"
            title="新建分类"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="scrollbar-hide space-y-1.5 overflow-y-auto pb-4">
          {categories.map((category) => (
            <div key={category.id} className="group flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveCat(category.id)}
                className={`flex min-w-0 flex-1 items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-all ${
                  activeCat === category.id
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <div className="flex min-w-0 items-center gap-3 overflow-hidden">
                  <span className="shrink-0 text-base">{category.icon}</span>
                  <span className="truncate">{category.name}</span>
                </div>

                <div className="flex shrink-0 items-center">
                  <span className={`mr-1 text-xs ${activeCat === category.id ? 'text-blue-200' : 'text-slate-600'}`}>
                    {category.tags.length}
                  </span>
                  <ChevronRight
                    size={14}
                    className={activeCat === category.id ? 'text-blue-200 opacity-100' : 'opacity-0 transition-opacity group-hover:opacity-100'}
                  />
                </div>
              </button>

              {!category.isSystem ? (
                <button
                  type="button"
                  onClick={() => handleDeleteCategory(category)}
                  className="rounded-md p-2 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                  title={`删除分类 ${category.name}`}
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
            </div>
          ))}

          {isAddingCat ? (
            <div className="flex items-center gap-3 rounded-lg border border-blue-500 bg-slate-800/80 px-3 py-2.5 ring-1 ring-blue-500/30">
              <span className="shrink-0 text-base">✨</span>
              <input
                autoFocus
                type="text"
                value={newCatName}
                onChange={(event) => setNewCatName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveNewCategory();
                  if (event.key === 'Escape') {
                    setIsAddingCat(false);
                    setNewCatName('');
                  }
                }}
                placeholder="输入分类名称..."
                className="w-full bg-transparent text-sm text-slate-200 focus:outline-none"
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        {!activeCat ? (
          <div className="flex h-full flex-col items-center justify-center text-slate-500">
            <FolderOpen size={48} className="mb-4 opacity-20" />
            <p>请先在左侧选择或新建一个标签分类</p>
          </div>
        ) : (
          <>
            <div className="mb-8 flex items-center justify-between">
              <div className="group relative w-80">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-blue-500"
                  size={16}
                />
                <input
                  type="text"
                  placeholder="在当前分类搜索标签..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 py-2 pl-9 pr-4 text-sm text-slate-200 focus:border-blue-500 focus:bg-slate-800 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => setIsAdding(true)}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-900/20 transition-colors hover:bg-blue-500"
              >
                <Plus size={16} />
                新建标签
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-700/50 bg-slate-800/30 shadow-sm">
              <table className="w-full text-left text-sm text-slate-400">
                <thead className="border-b border-slate-700/50 bg-slate-900/60 font-medium text-slate-300">
                  <tr>
                    <th className="w-1/2 px-6 py-4">标签名称</th>
                    <th className="w-1/4 px-6 py-4">关联图片数</th>
                    <th className="px-6 py-4 text-right">操作</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-700/50">
                  {isAdding ? (
                    <tr className="bg-slate-800/80">
                      <td className="px-6 py-4 align-top">
                        <input
                          autoFocus
                          type="text"
                          value={newName}
                          onChange={(event) => setNewName(event.target.value)}
                          onKeyDown={(event) => event.key === 'Enter' && saveNewTag()}
                          placeholder="输入标签名称后回车保存"
                          className="w-full rounded border border-blue-500 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:outline-none"
                        />
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-500">0</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setIsAdding(false);
                            setNewName('');
                          }}
                          className="text-slate-500 transition-colors hover:text-slate-300"
                        >
                          取消
                        </button>
                      </td>
                    </tr>
                  ) : null}

                  {currentTags.map((tag) => (
                    <tr key={tag.id} className="group transition-colors hover:bg-slate-800/80">
                      <td className="flex items-center gap-3 px-6 py-4 font-medium text-slate-200">
                        <div className="shrink-0 rounded border border-slate-700 bg-slate-800 p-1.5">
                          <Tag size={14} className="text-slate-400" />
                        </div>
                        {editingId === tag.id ? (
                          <input
                            autoFocus
                            type="text"
                            value={editName}
                            onChange={(event) => setEditName(event.target.value)}
                            onBlur={saveEdit}
                            onKeyDown={(event) => event.key === 'Enter' && saveEdit()}
                            className="w-full rounded border border-blue-500 bg-slate-900 px-3 py-1 text-sm text-slate-200 focus:outline-none"
                          />
                        ) : (
                          <span className="truncate">{tag.name}</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 font-mono text-slate-300">
                          {tag.count}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => startEdit(tag)}
                            className="rounded-md p-2 text-slate-400 transition-colors hover:bg-blue-500/10 hover:text-blue-400"
                            title={`编辑标签 ${tag.name}`}
                            aria-label={`编辑标签 ${tag.name}`}
                          >
                            <Edit3 size={16} />
                          </button>
                          {tag.canDelete ? (
                            <button
                              type="button"
                              onClick={() => handleDelete(tag.id)}
                              className="rounded-md p-2 text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
                              title={`删除标签 ${tag.name}`}
                              aria-label={`删除标签 ${tag.name}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}

                  {currentTags.length === 0 && !isAdding ? (
                    <tr>
                      <td colSpan="3" className="px-6 py-16 text-center text-slate-500">
                        <Tag size={32} className="mx-auto mb-3 opacity-20" />
                        当前分类下还没有标签
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
