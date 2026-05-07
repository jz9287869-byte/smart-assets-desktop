import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  Database,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';

function buildStorageKey(storageScope) {
  return `folderTreeExpanded:${storageScope || 'default'}`;
}

function buildTreeStructure(folders, rootName = '') {
  const tree = [];
  const folderMap = new Map();

  folders.forEach((folder) => {
    const segments = String(folder || '').split(/[/\\]/);
    let currentPath = '';

    segments.forEach((segment, index) => {
      if (!segment) return;
      currentPath += (currentPath ? '/' : '') + segment;

      if (!folderMap.has(currentPath)) {
        const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
        folderMap.set(currentPath, {
          id: currentPath,
          name: segment,
          path: currentPath,
          parentPath,
          children: [],
          isLeaf: index === segments.length - 1,
        });
      }
    });
  });

  folderMap.forEach((node) => {
    if (node.parentPath) {
      const parent = folderMap.get(node.parentPath);
      if (parent) {
        parent.children.push(node);
        parent.isLeaf = false;
      }
    } else if (node.parentPath !== undefined) {
      tree.push(node);
    }
  });

  const sortFolders = (nodes) => nodes
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .map((node) => ({
      ...node,
      children: sortFolders(node.children || []),
    }));

  const sortedTree = sortFolders(tree);
  if (!rootName) return sortedTree;

  return [{
    id: '__library_root__',
    name: rootName,
    path: '',
    parentPath: '',
    children: sortedTree,
    isLeaf: sortedTree.length === 0,
  }];
}

export default function FolderTree({ selectedFolder, onFolderSelect, showToast, storageScope = 'default' }) {
  const [folderTree, setFolderTree] = useState([]);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [libraryRootName, setLibraryRootName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const loadRequestRef = useRef(0);
  const refreshTimerRef = useRef(null);

  const expandedStorageKey = useMemo(() => buildStorageKey(storageScope), [storageScope]);

  useEffect(() => {
    const saved = localStorage.getItem(expandedStorageKey);
    if (!saved) {
      setExpandedFolders(new Set());
      return;
    }

    try {
      setExpandedFolders(new Set(JSON.parse(saved)));
    } catch (error) {
      console.error('Failed to restore folder tree state:', error);
      setExpandedFolders(new Set());
    }
  }, [expandedStorageKey]);

  useEffect(() => {
    localStorage.setItem(expandedStorageKey, JSON.stringify([...expandedFolders]));
  }, [expandedFolders, expandedStorageKey]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        event.preventDefault();
        setShowSearch(true);
      }

      if (event.key === 'Escape' && showSearch) {
        setShowSearch(false);
        setSearchQuery('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSearch]);

  const loadFolderTree = useCallback(async (options = {}) => {
    const { silent = false } = options;
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;

    if (!silent) {
      setIsLoading(true);
    }

    try {
      const [result, status] = await Promise.all([
        window.electronAPI?.libraryAPI?.getFolderTree?.(),
        window.electronAPI?.libraryAPI?.getStatus?.(),
      ]);

      if (loadRequestRef.current !== requestId) {
        return;
      }

      const rootName = status?.name
        || (status?.path
          ? status.path.split(/[/\\]/).filter(Boolean).pop()
          : '');

      setLibraryRootName(rootName || '');
      if (result?.success || result?.tree) {
        setFolderTree(buildTreeStructure(result.tree || [], rootName || ''));
      } else {
        setFolderTree([]);
      }
    } catch (error) {
      if (loadRequestRef.current !== requestId) {
        return;
      }

      console.error('Failed to load folder tree:', error);
      showToast?.('加载文件结构失败');
      setFolderTree([]);
    } finally {
      if (!silent && loadRequestRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [showToast]);

  useEffect(() => {
    loadFolderTree();
  }, [loadFolderTree]);

  useEffect(() => {
    const scheduleRefresh = (delay = 180) => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        loadFolderTree({ silent: true });
      }, delay);
    };

    const unsubscribeImageAdded = window.electronAPI?.onImageAdded?.(() => scheduleRefresh());
    const unsubscribeImageDeleted = window.electronAPI?.onImageDeleted?.(() => scheduleRefresh());

    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      unsubscribeImageAdded?.();
      unsubscribeImageDeleted?.();
    };
  }, [loadFolderTree]);

  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return folderTree;

    const lowerQuery = searchQuery.toLowerCase();
    const filterNodes = (nodes) => nodes
      .map((node) => {
        const matches = node.name.toLowerCase().includes(lowerQuery)
          || node.path.toLowerCase().includes(lowerQuery);
        const children = filterNodes(node.children || []);
        if (!matches && children.length === 0) {
          return null;
        }
        return {
          ...node,
          children,
        };
      })
      .filter(Boolean);

    return filterNodes(folderTree);
  }, [folderTree, searchQuery]);

  const getAllNodeIds = useCallback((nodes) => {
    const ids = [];
    const walk = (node) => {
      if (node.children?.length) {
        ids.push(node.id);
        node.children.forEach(walk);
      }
    };

    nodes.forEach(walk);
    return ids;
  }, []);

  const expandAll = useCallback(() => {
    setExpandedFolders(new Set(getAllNodeIds(filteredTree)));
  }, [filteredTree, getAllNodeIds]);

  const collapseAll = useCallback(() => {
    setExpandedFolders(new Set());
  }, []);

  const toggleFolder = useCallback((folderId) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleDeleteFolder = useCallback(async (folderPath) => {
    const normalizedPath = String(folderPath || '').trim();
    if (!normalizedPath) return;

    const deleteLibraryOnly = window.confirm(
      `删除文件夹“${normalizedPath}”时，是否只从资源库中移除？\n\n点击“确定”：仅从资源库删除，不移动磁盘文件。\n点击“取消”：继续选择“移到回收站”或放弃。`
    );

    let deleteMode = 'detach';
    if (!deleteLibraryOnly) {
      const moveToTrash = window.confirm(
        `是否将文件夹“${normalizedPath}”及其子目录中的图片移到回收站？\n\n点击“确定”：移到回收站。\n点击“取消”：放弃删除。`
      );
      if (!moveToTrash) return;
      deleteMode = 'trash';
    }

    try {
      const result = await window.electronAPI?.libraryAPI?.deleteFolder?.({
        folderPath: normalizedPath,
        deleteMode,
      });
      if (!result?.success) {
        showToast?.(result?.error || '删除目录失败');
        return;
      }

      if (selectedFolder === normalizedPath || selectedFolder?.startsWith(`${normalizedPath}/`)) {
        onFolderSelect?.('');
      }

      await loadFolderTree({ silent: true });
      if (result.mode === 'detach') {
        showToast?.(`已从资源库移除文件夹：${result.deletedCount || 0} 张图片`);
      } else {
        showToast?.(`已将目录移入回收站：${result.deletedCount || 0} 张图片`);
      }
    } catch (error) {
      console.error('Failed to delete folder:', error);
      showToast?.('删除目录失败');
    }
  }, [loadFolderTree, onFolderSelect, selectedFolder, showToast]);

  const FolderNode = ({ node, level = 0 }) => {
    const isExpanded = expandedFolders.has(node.id);
    const hasChildren = node.children?.length > 0;
    const normalizedPath = node.id === '__library_root__' ? '' : (node.path || node.id);
    const isSelected = selectedFolder === normalizedPath || selectedFolder === node.id;
    const canDelete = node.id !== '__library_root__' && normalizedPath;

    return (
      <div key={node.id}>
        <div
          onClick={() => {
            if (hasChildren) {
              toggleFolder(node.id);
            }
            onFolderSelect?.(normalizedPath);
          }}
          className={`group flex cursor-pointer items-center gap-1 rounded-lg px-3 py-2 transition-all ${
            isSelected
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
          style={{ paddingLeft: `${12 + level * 16}px` }}
          title={normalizedPath || libraryRootName}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                toggleFolder(node.id);
              }}
              className="flex items-center justify-center p-0 transition-transform"
            >
              {isExpanded ? (
                <ChevronDown size={16} className={isSelected ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'} />
              ) : (
                <ChevronRight size={16} className={isSelected ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'} />
              )}
            </button>
          ) : (
            <div className="w-4" />
          )}

          <div className="flex min-w-0 flex-1 items-center gap-2">
            {isExpanded ? (
              <FolderOpen size={14} className={isSelected ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'} />
            ) : (
              <Folder size={14} className={isSelected ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'} />
            )}
            <span className="truncate text-sm">{node.name}</span>
          </div>

          {canDelete ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleDeleteFolder(normalizedPath);
              }}
              className={`rounded p-1 opacity-0 transition-all group-hover:opacity-100 ${
                isSelected
                  ? 'text-white/80 hover:bg-white/10 hover:text-white'
                  : 'text-slate-500 hover:bg-red-500/10 hover:text-red-400'
              }`}
              title={`删除目录 ${normalizedPath}`}
            >
              <Trash2 size={13} />
            </button>
          ) : null}
        </div>

        {isExpanded && hasChildren ? (
          <div>
            {node.children.map((child) => (
              <FolderNode key={child.id} node={child} level={level + 1} />
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-slate-800 bg-slate-900/40">
      <div className="flex flex-col gap-2 border-b border-slate-800/50 p-4">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-slate-400" />
          <h3 className="flex-1 text-xs font-bold uppercase tracking-wider text-slate-400">文件结构</h3>
          <button
            type="button"
            onClick={() => loadFolderTree()}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            title="刷新"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {showSearch ? (
          <div className="relative">
            <input
              type="text"
              placeholder="搜索文件夹...（Esc 关闭）"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              autoFocus
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
            <button
              type="button"
              onClick={() => {
                setShowSearch(false);
                setSearchQuery('');
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X size={14} />
            </button>
          </div>
        ) : null}

        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setShowSearch((prev) => !prev)}
            className="flex flex-1 items-center justify-center gap-1 rounded bg-slate-800/50 px-2 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
            title="搜索（Ctrl+F）"
          >
            <Search size={12} />
            <span className="hidden sm:inline">搜索</span>
          </button>
          <button
            type="button"
            onClick={expandAll}
            className="flex flex-1 items-center justify-center gap-1 rounded bg-slate-800/50 px-2 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
            title="全部展开"
          >
            <ChevronsDown size={12} />
            <span className="hidden sm:inline">展开</span>
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="flex flex-1 items-center justify-center gap-1 rounded bg-slate-800/50 px-2 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
            title="全部收起"
          >
            <ChevronRight size={12} style={{ transform: 'scaleX(2)' }} />
            <span className="hidden sm:inline">收起</span>
          </button>
        </div>
      </div>

      <div className="scrollbar-hide flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-slate-500">
            <div className="text-center">
              <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-slate-700 border-t-blue-500" />
              <p className="text-xs">加载中...</p>
            </div>
          </div>
        ) : filteredTree.length === 0 ? (
          <div className="flex h-full items-center justify-center text-slate-500">
            <div className="p-4 text-center">
              <Folder size={24} className="mx-auto mb-2 opacity-20" />
              <p className="text-xs">{searchQuery ? '没有匹配的文件夹' : '暂无文件夹'}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-0.5 p-2">
            {filteredTree.map((folder) => (
              <FolderNode key={folder.id} node={folder} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
