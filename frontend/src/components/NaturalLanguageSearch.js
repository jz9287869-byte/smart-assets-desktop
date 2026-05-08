import React, { useCallback, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderOpen,
  Loader2,
  MapPin,
  Search,
  Sparkles,
  Tag,
  User,
} from 'lucide-react';
import { formatFileSize, getImageUrl, parseTags } from '../utils/imageUtils';

const EXAMPLE_PROMPTS = [
  '找一张单人女生，新疆草原的照片',
  '搜索伊犁文件夹里的草原照片',
  '搜索关键词：西湖景区 路牌',
  '想找纯风景的雪山照片',
];

const MODE_LABELS = {
  strict: '严格匹配',
  keyword: '关键词回退',
};

const PAGE_SIZE = 24;

function IntentSection({ icon: Icon, title, items = [], accentClass, emptyText }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className={`mb-3 flex items-center gap-2 text-sm font-medium ${accentClass}`}>
        <Icon size={16} />
        <span>{title}</span>
      </div>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={`${title}-${item}`}
              className="rounded-full border border-slate-700 bg-slate-950/80 px-3 py-1 text-xs text-slate-200"
            >
              {item}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-xs text-slate-500">{emptyText}</div>
      )}
    </div>
  );
}

function SearchResultCard({ image, onOpenInFolder, onCopyPath }) {
  const tags = useMemo(() => parseTags(image), [image]);
  const previewUrl = getImageUrl(image);
  const summaries = Array.isArray(image?.natural_search_summary) ? image.natural_search_summary : [];

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-950">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={image.filename}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-600">
            <Search size={24} />
          </div>
        )}
        <div className="absolute left-3 top-3 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
          匹配分 {Math.max(0, Math.round(Number(image?.natural_search_score || 0)))}
        </div>
      </div>

      <div className="space-y-3 p-3">
        <div>
          <div className="truncate text-sm font-semibold text-slate-100">{image.filename}</div>
          <div className="mt-1 truncate text-[11px] text-slate-500">{image.folder || image.path}</div>
        </div>

        {summaries.length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
            {summaries.slice(0, 2).map((summary) => (
              <div key={`${image.id}-${summary}`} className="text-[11px] leading-5 text-slate-300">
                {summary}
              </div>
            ))}
          </div>
        )}

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 6).map((tag) => (
              <span
                key={`${image.id}-${tag}`}
                className="rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] text-slate-300"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>{formatFileSize(image.size)}</span>
          <span>{image.process_status || 'unknown'}</span>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onOpenInFolder(image)}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-2 text-[11px] font-medium text-slate-200 transition-colors hover:border-blue-500/40 hover:text-blue-300"
          >
            <FolderOpen size={13} />
            打开位置
          </button>
          <button
            type="button"
            onClick={() => onCopyPath(image)}
            className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-2 text-slate-200 transition-colors hover:border-blue-500/40 hover:text-blue-300"
            aria-label={`复制路径-${image.filename}`}
          >
            <Copy size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NaturalLanguageSearch({ showToast }) {
  const [query, setQuery] = useState('');
  const [folderName, setFolderName] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState({
    images: [],
    intent: null,
    mode: 'strict',
    total: 0,
    candidateCount: 0,
    vectorSearchApplied: false,
    vectorCoverage: { available: 0, total: 0, computed: 0 },
  });

  const executeSearch = useCallback(async (page = 1) => {
    const trimmedQuery = String(query || '').trim();
    const trimmedFolderName = String(folderName || '').trim();
    const nextPage = Math.max(1, Number(page) || 1);

    if (!trimmedFolderName) {
      showToast?.('请输入文件夹目录名称，例如：伊犁');
      return;
    }

    setHasSearched(true);
    setIsSearching(true);
    setCurrentPage(nextPage);

    try {
      const result = await window.electronAPI?.naturalSearchImages?.({
        query: trimmedQuery,
        folderName: trimmedFolderName,
        limit: PAGE_SIZE,
        offset: (nextPage - 1) * PAGE_SIZE,
      });

      if (!result?.success) {
        throw new Error(result?.error || '自然语言搜图失败');
      }

      setSearchResult({
        images: result.images || [],
        intent: result.intent || null,
        mode: result.mode || 'strict',
        total: Number(result.total || 0),
        candidateCount: Number(result.candidateCount || 0),
        vectorSearchApplied: !!result.vectorSearchApplied,
        vectorCoverage: result.vectorCoverage || { available: 0, total: 0, computed: 0 },
      });
    } catch (error) {
      console.error('Natural language search failed:', error);
      showToast?.(error.message || '自然语言搜图失败');
      setSearchResult({
        images: [],
        intent: null,
        mode: 'strict',
        total: 0,
        candidateCount: 0,
        vectorSearchApplied: false,
        vectorCoverage: { available: 0, total: 0, computed: 0 },
      });
    } finally {
      setIsSearching(false);
    }
  }, [folderName, query, showToast]);

  const handleExampleFill = useCallback((example) => {
    setQuery(example);
  }, []);

  const handleOpenInFolder = useCallback(async (image) => {
    try {
      await window.electronAPI?.openInFolder?.(image?.current_path || image?.path);
    } catch (error) {
      console.error('Failed to open image folder:', error);
      showToast?.('打开文件位置失败');
    }
  }, [showToast]);

  const handleCopyPath = useCallback(async (image) => {
    try {
      const filePath = image?.current_path || image?.path;
      if (!filePath) {
        throw new Error('路径不存在');
      }
      await window.electronAPI?.copyPathToClipboard?.(filePath);
      showToast?.('已复制图片路径');
    } catch (error) {
      console.error('Failed to copy image path:', error);
      showToast?.('复制路径失败');
    }
  }, [showToast]);

  const resultModeLabel = MODE_LABELS[searchResult.mode] || MODE_LABELS.strict;
  const totalPages = Math.max(1, Math.ceil(Number(searchResult.total || 0) / PAGE_SIZE));
  const canGoPrev = currentPage > 1 && !isSearching;
  const canGoNext = currentPage < totalPages && !isSearching;

  const goToPage = useCallback((page) => {
    if (page < 1 || page > totalPages || page === currentPage || isSearching) {
      return;
    }
    executeSearch(page);
  }, [currentPage, executeSearch, isSearching, totalPages]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-6 py-5">
      <div className="mb-5 shrink-0">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-300">
          <Sparkles size={14} />
          自然语言搜图
        </div>
        <h1 className="text-2xl font-bold text-slate-50">按完整条件筛出真正匹配的图片</h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">
          先在左侧输入检索描述，再点击“开始搜图”执行。系统只展示同时满足全部条件的结果，不再自动放宽到相近图片。
        </p>
      </div>

      <div className="grid min-h-0 flex-1 items-start gap-6 pb-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-4">
          <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950/60 p-5 shadow-2xl shadow-slate-950/10">
            <div className="mb-3 text-sm font-semibold text-slate-100">输入检索条件</div>
            <p className="mb-4 text-xs leading-5 text-slate-400">
              可输入标签条件、文件夹名称、关键词，例如：搜索伊犁文件夹里的草原照片
            </p>

            <label className="mb-3 block">
              <span className="mb-2 block text-xs font-semibold text-slate-200">
                文件夹目录名称 <span className="text-red-300">*</span>
              </span>
              <div className="relative">
                <FolderOpen className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input
                  value={folderName}
                  onChange={(event) => {
                    setFolderName(event.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="例如：伊犁"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 py-3 pl-11 pr-4 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </label>

            <div className="relative">
              <Search className="absolute left-4 top-4 text-slate-500" size={18} />
              <textarea
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setCurrentPage(1);
                }}
                rows={6}
                placeholder="例如：搜索伊犁文件夹里的草原照片，或输入西湖景区 路牌"
                className="min-h-[180px] w-full rounded-2xl border border-slate-700 bg-slate-950/80 py-4 pl-11 pr-4 text-sm leading-6 text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => executeSearch(1)}
              disabled={isSearching}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/30 transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSearching ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
              {isSearching ? '搜索中' : '开始搜图'}
            </button>

            <div className="mt-4 flex flex-wrap gap-2">
              {EXAMPLE_PROMPTS.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => handleExampleFill(example)}
                  className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-blue-500/40 hover:text-blue-300"
                >
                  {example}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3 text-xs leading-6 text-emerald-200">
              搜索只在点击“开始搜图”后执行，示例词只负责填入输入框。
            </div>
          </div>

          <IntentSection
            icon={Tag}
            title="必须满足"
            items={searchResult.intent?.requiredTags || []}
            accentClass="text-emerald-300"
            emptyText="等待识别检索条件"
          />
          <IntentSection
            icon={User}
            title="辅助理解"
            items={searchResult.intent?.implicitTags || []}
            accentClass="text-blue-300"
            emptyText="没有辅助条件"
          />
          <IntentSection
            icon={Search}
            title="关键词 / 文件夹"
            items={searchResult.intent?.keywordHints || []}
            accentClass="text-cyan-300"
            emptyText="没有额外关键词"
          />
          <IntentSection
            icon={MapPin}
            title="自动排除"
            items={searchResult.intent?.excludedTags || []}
            accentClass="text-amber-300"
            emptyText="没有排除条件"
          />

          {Array.isArray(searchResult.intent?.notes) && searchResult.intent.notes.length > 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm leading-6 text-slate-400">
              {searchResult.intent.notes.map((note) => (
                <div key={note}>{note}</div>
              ))}
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="mb-4 shrink-0 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
              <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300">
                {resultModeLabel}
              </span>
              <span>第 {currentPage}/{totalPages} 页，返回 {searchResult.images.length} 张 / 共 {searchResult.total} 张</span>
              <span>候选集 {searchResult.candidateCount}</span>
              {searchResult.vectorSearchApplied && (
                <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs text-blue-300">
                  语义排序 {searchResult.vectorCoverage.available}/{searchResult.vectorCoverage.total}
                </span>
              )}
            </div>
            {hasSearched && searchResult.total > PAGE_SIZE ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={!canGoPrev}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 transition-colors hover:border-blue-500/40 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="上一页"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={!canGoNext}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 transition-colors hover:border-blue-500/40 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="下一页"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            ) : (
              <div className="text-xs text-slate-500">
                右侧固定三列展示，优先看小图筛选
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isSearching ? (
              <div className="flex h-full flex-col items-center justify-center text-slate-500">
                <Loader2 size={28} className="mb-4 animate-spin" />
                <p>正在按全部条件筛选图片...</p>
              </div>
            ) : !hasSearched ? (
              <div className="flex h-full flex-col items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/30 text-center text-slate-500">
                <Sparkles size={36} className="mb-4 opacity-40" />
                <p className="text-base text-slate-300">先填写条件，再点击“开始搜图”</p>
                <p className="mt-2 max-w-xl text-sm leading-6">
                  左侧输入框不会自动执行搜索，适合先整理条件，再一次性开始检索。
                </p>
              </div>
            ) : searchResult.images.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/30 text-center text-slate-500">
                <Sparkles size={36} className="mb-4 opacity-40" />
                <p className="text-base text-slate-300">没有找到同时满足全部条件的图片</p>
                <p className="mt-2 max-w-xl text-sm leading-6">
                  可以补充更准确的 AI 标签后再搜，或者适当减少条件数量。
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-4 pb-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {searchResult.images.map((image) => (
                    <SearchResultCard
                      key={image.id}
                      image={image}
                      onOpenInFolder={handleOpenInFolder}
                      onCopyPath={handleCopyPath}
                    />
                  ))}
                </div>
                {searchResult.total > PAGE_SIZE ? (
                  <div className="sticky bottom-0 mt-4 flex items-center justify-center gap-3 border-t border-slate-800 bg-slate-900/95 py-3">
                    <button
                      type="button"
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={!canGoPrev}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-blue-500/40 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft size={14} />
                      上一页
                    </button>
                    <span className="text-xs text-slate-400">
                      第 {currentPage} / {totalPages} 页
                    </span>
                    <button
                      type="button"
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={!canGoNext}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-blue-500/40 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      下一页
                      <ChevronRight size={14} />
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
