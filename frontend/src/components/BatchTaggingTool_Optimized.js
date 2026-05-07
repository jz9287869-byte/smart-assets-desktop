import React, { useState, useEffect, useCallback } from 'react';
import { 
  Tag, Check, X, Grid, List, Sparkles, 
  Loader2, Save, Plus, Bot, AlertCircle
} from 'lucide-react';
import { getThumbnailUrl } from '../utils/imageUtils';
import VirtualImageGrid from './VirtualImageGrid';

const STATUS_CONFIG = {
  imported: { label: '仅导入', color: 'text-amber-500' },
  thumbnail: { label: '已生成缩略图', color: 'text-blue-500' },
  auto_tagged: { label: 'AI 已标记', color: 'text-green-500' },
  manual_tagged: { label: '人工标记', color: 'text-purple-500' },
};

export default function BatchTaggingTool({ showToast }) {
  const [images, setImages] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [tagsToAdd, setTagsToAdd] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [useVirtualization, setUseVirtualization] = useState(true); // 大列表自动启用虚拟化

  const PAGE_SIZE = 100; // 虚拟列表下每页加载更多

  // 加载未标签化的图片
  const loadImages = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI?.imagesAPI?.getUntagged({ 
        limit: PAGE_SIZE, 
        offset: currentPage * PAGE_SIZE 
      });
      
      if (result?.success) {
        if (currentPage === 0) {
          setImages(result.images || []);
        } else {
          // 分页加载时追加
          setImages(prev => [...prev, ...(result.images || [])]);
        }
        
        // 判断是否有下一页
        setHasNextPage((result.images?.length || 0) >= PAGE_SIZE);
        setTotalCount(result.total || (currentPage * PAGE_SIZE) + (result.images?.length || 0));
        
        // 如果图片超过 500 张，自动启用虚拟化
        if (images.length + (result.images?.length || 0) > 500) {
          setUseVirtualization(true);
        }
      } else {
        setImages([]);
        console.error('加载图片失败:', result?.error);
        showToast?.('加载图片失败');
      }
    } catch (error) { 
      console.error('加载图片失败:', error);
      setImages([]);
      showToast?.('加载图片失败');
    }
    finally { setIsLoading(false); }
  }, [currentPage]);

  useEffect(() => { loadImages(); }, [loadImages]);

  const selectedImages = images.filter(img => selectedIds.includes(img.id));

  const pushToQueue = useCallback((tagName) => {
    if (tagName && !tagsToAdd.includes(tagName)) {
      setTagsToAdd([...tagsToAdd, tagName]);
      setTagInput('');
    }
  }, [tagsToAdd]);

  const handleAiAnalysis = useCallback(async () => {
    if (selectedIds.length === 0) {
      showToast?.('请先选择需要分析的图片');
      return;
    }
    
    setIsAiProcessing(true);
    try {
      await window.electronAPI?.batchAiTagging?.(selectedIds);
      showToast?.(`AI标签已提交，正在处理 ${selectedIds.length} 张图片`);
      
      // 延迟后重新加载
      setTimeout(() => loadImages(), 2000);
    } catch (error) { 
      console.error('AI标签失败:', error);
      showToast?.('AI 分析失败，请查看控制台');
    }
    finally { setIsAiProcessing(false); }
  }, [selectedIds, loadImages]);

  const handleApplyTags = useCallback(async () => {
    if (tagsToAdd.length === 0 || selectedIds.length === 0) {
      showToast?.('请选择图片并添加标签');
      return;
    }
    
    try {
      const tagsToApply = [...tagsToAdd];
      const imagesToTag = [...selectedIds];
      
      for (const imageId of imagesToTag) {
        for (const tagName of tagsToApply) {
          await window.electronAPI?.addTagToImage(imageId, tagName);
        }
      }
      
      showToast?.(`成功将 ${tagsToApply.length} 个标签应用到 ${imagesToTag.length} 张图片`);
      
      setTagsToAdd([]);
      setSelectedIds([]);
      
      // 重新加载列表
      await new Promise(resolve => setTimeout(resolve, 100));
      loadImages();
    } catch (error) { 
      console.error('应用标签失败:', error);
      showToast?.('应用标签失败，请查看控制台');
    }
  }, [tagsToAdd, selectedIds, loadImages]);

  const handleToggleSelect = useCallback((id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.length === images.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(images.map(img => img.id));
    }
  }, [selectedIds, images]);

  return (
    <div className="flex h-full">
      {/* 虚拟化图片区域 */}
      {useVirtualization && images.length > 100 ? (
        <VirtualImageGrid
          images={images}
          selectedIds={selectedIds}
          onSelectImage={(id) => setSelectedIds(prev => 
            prev.includes(id) ? prev : [...prev, id]
          )}
          onToggleSelect={handleToggleSelect}
          showToast={showToast}
          STATUS_CONFIG={STATUS_CONFIG}
          onDblClick={(img) => {
            // 双击可打开图片查看器
            console.log('双击打开:', img);
          }}
        />
      ) : (
        // 普通网格（小列表）
        <div className="flex-1 flex flex-col bg-slate-900/20 overflow-hidden">
          <div className="h-14 border-b border-slate-800 bg-slate-900/60 backdrop-blur-md flex items-center justify-between px-6 shrink-0">
            <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Check size={18} className="text-blue-500" />
              当前选中 {selectedImages.length} 张图片
            </h2>
            <div className="flex items-center gap-2">
              <button 
                onClick={handleSelectAll}
                className="text-xs text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-md border border-slate-700 transition-colors"
              >
                {selectedIds.length === images.length ? '取消全选' : '全选'}
              </button>
              <button 
                onClick={() => setSelectedIds([])}
                className="text-xs text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-md border border-slate-700 transition-colors"
              >
                清除选择
              </button>
            </div>
          </div>
          
          <div className="flex-1 p-6 overflow-auto">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500">
                <div className="w-10 h-10 border-3 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-4"></div>
                <p>加载中...</p>
              </div>
            ) : images.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-500">
                <div className="text-center">
                  <Tag size={48} className="mx-auto mb-4 opacity-20" />
                  <p className="mb-2">暂无未标签化的图片</p>
                  <p className="text-sm text-slate-600">请导入或处理图片</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {images.map(img => (
                  <div 
                    key={img.id} 
                    onClick={() => setSelectedIds(prev => 
                      prev.includes(img.id) ? prev.filter(i => i !== img.id) : [...prev, img.id]
                    )}
                    className={`relative rounded-lg overflow-hidden border-2 group bg-slate-800 cursor-pointer transition-all duration-200 ${
                      selectedIds.includes(img.id) 
                        ? 'border-blue-500 shadow-lg shadow-blue-900/10' 
                        : 'border-slate-700/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="aspect-[4/3] overflow-hidden bg-slate-900">
                      {img.thumbnail_path ? (
                        <img src={getThumbnailUrl(img)} alt={img.filename} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-500">
                          <span className="text-xs">{img.format?.toUpperCase() || 'IMG'}</span>
                        </div>
                      )}
                    </div>
                    <div className="absolute top-2 right-2">
                      {selectedIds.includes(img.id) && (
                        <div className="bg-blue-500 text-white p-1 rounded-md shadow-sm">
                          <Check size={14} strokeWidth={3} />
                        </div>
                      )}
                    </div>
                    <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleSelect(img.id); }}
                        className="p-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 hover:scale-110 transition-all shadow-lg"
                      >
                        <Check size={16} />
                      </button>
                    </div>
                    <div className="p-2">
                      <p className="text-xs text-slate-300 truncate">{img.filename}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 分页 */}
            {hasNextPage && (
              <div className="flex items-center justify-center gap-4 py-6 mt-4">
                <button 
                  onClick={() => setCurrentPage(p => p - 1)} 
                  disabled={currentPage === 0}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-slate-200 text-sm border border-slate-700"
                >
                  上一页
                </button>
                <span className="flex items-center gap-2 text-sm text-slate-400">
                  第 {currentPage + 1} 页，共加载 {images.length} / {totalCount} 张
                </span>
                <button 
                  onClick={() => setCurrentPage(p => p + 1)}
                  disabled={!hasNextPage}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-slate-200 text-sm border border-slate-700"
                >
                  下一页
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 右侧标签面板 */}
      <div className="w-[320px] bg-[#1e293b] border-l border-slate-800 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-800/50">
          <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Tag size={16} className="text-blue-400" />
            批量打标签
          </h3>
          
          <button 
            onClick={handleAiAnalysis} 
            disabled={isAiProcessing || selectedIds.length === 0}
            className={`w-full mb-5 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all ${
              isAiProcessing || selectedIds.length === 0 
                ? 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed' 
                : 'bg-gradient-to-r from-emerald-600/20 to-teal-600/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-600/30 hover:border-emerald-500/50 shadow-lg shadow-emerald-900/10'
            }`}
          >
            {isAiProcessing ? (
              <>
                <Loader2 size={16} className="animate-spin" /> 
                正在提取...
              </>
            ) : (
              <>
                <Bot size={16} /> 
                AI 一键智能提取
              </>
            )}
          </button>

          <div className="relative group">
            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500" size={16} />
            <input 
              type="text" 
              value={tagInput} 
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { pushToQueue(tagInput.trim()); } }}
              placeholder="手动输入标签并回车..." 
              className="w-full bg-slate-900/50 border border-slate-700 text-slate-200 text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-blue-500 focus:bg-slate-900 transition-colors placeholder:text-slate-600"
            />
          </div>
        </div>
        
        <div className="flex-1 p-6 overflow-auto">
          <h4 className="text-[11px] font-bold text-slate-500 mb-3 uppercase tracking-wider">快捷推荐</h4>
          <div className="flex flex-wrap gap-2 mb-8">
            {['自然', '极简', '高画质', '素材', '背景'].map(t => (
              <button 
                key={t} 
                onClick={() => pushToQueue(t)}
                className="px-2.5 py-1 rounded border border-slate-700 bg-slate-800 text-slate-300 text-xs hover:border-blue-500 hover:text-blue-400 transition-colors flex items-center gap-1"
              >
                <Plus size={12} /> {t}
              </button>
            ))}
          </div>

          <h4 className="text-[11px] font-bold text-slate-500 mb-3 uppercase tracking-wider">
            待应用队列 ({tagsToAdd.length})
          </h4>
          <div className="space-y-2">
            {tagsToAdd.map(t => (
              <div 
                key={t} 
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 text-sm"
              >
                <span className="flex items-center gap-2 font-medium">
                  <Tag size={14} /> {t}
                </span>
                <button 
                  onClick={() => setTagsToAdd(tagsToAdd.filter(tag => tag !== t))}
                  className="text-blue-400/50 hover:text-red-400 hover:bg-red-500/10 p-1 rounded transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {tagsToAdd.length === 0 && (
              <div className="text-center py-8 text-sm text-slate-500 border border-dashed border-slate-700 rounded-lg">
                尚未添加标签
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-slate-800 bg-[#1e293b]">
          <button 
            onClick={handleApplyTags} 
            disabled={tagsToAdd.length === 0 || selectedIds.length === 0}
            className={`w-full py-3 rounded-lg text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 active:scale-95 ${
              tagsToAdd.length === 0 || selectedIds.length === 0 
                ? 'bg-slate-700 cursor-not-allowed text-slate-400' 
                : 'bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/20'
            }`}
          >
            <Save size={16} />
            应用到 {selectedIds.length} 张图片
          </button>
        </div>
      </div>

      <style>{`
        @keyframes scan {
          0% { top: -10%; }
          50% { top: 110%; }
          100% { top: -10%; }
        }
      `}</style>
    </div>
  );
}
