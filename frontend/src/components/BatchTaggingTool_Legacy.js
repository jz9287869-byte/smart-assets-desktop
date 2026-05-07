import React, { useState, useEffect, useCallback } from 'react';
import { 
  Tag, Check, X, Grid, List, Sparkles, 
  Loader2, Save, Plus, Bot
} from 'lucide-react';
import { getThumbnailUrl } from '../utils/imageUtils';
import VirtualImageGrid from './VirtualImageGrid';

export default function BatchTaggingTool({ showToast }) {
  const [images, setImages] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [tagsToAdd, setTagsToAdd] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);

  const PAGE_SIZE = 20;

  const loadImages = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI?.imagesAPI?.getUntagged({ limit: PAGE_SIZE, offset: currentPage * PAGE_SIZE });
      if (result?.success) {
        setImages(result.images || []);
      } else {
        setImages([]);
        console.error('加载图片失败:', result?.error);
      }
    } catch (error) { 
      console.error('加载图片失败:', error);
      setImages([]);
    }
    finally { setIsLoading(false); }
  }, [currentPage]);

  useEffect(() => { loadImages(); }, [loadImages]);

  const selectedImages = images.filter(img => selectedIds.includes(img.id));

  const pushToQueue = (tagName) => {
    if (tagName && !tagsToAdd.includes(tagName)) setTagsToAdd([...tagsToAdd, tagName]);
  };

  const handleAiAnalysis = async () => {
    if (selectedIds.length === 0) return;
    setIsAiProcessing(true);
    try {
      await window.electronAPI?.batchAiTagging?.(selectedIds);
      showToast?.(`AI标签已提交，正在处理 ${selectedIds.length} 张图片`);
      loadImages();
    } catch (error) { console.error('AI标签失败:', error); }
    finally { setIsAiProcessing(false); }
  };

  const handleApplyTags = async () => {
    if (tagsToAdd.length === 0 || selectedIds.length === 0) return;
    try {
      // 批量应用标签
      const tagsToApply = [...tagsToAdd];
      const imagesToTag = [...selectedIds];
      
      for (const imageId of imagesToTag) {
        for (const tagName of tagsToApply) {
          await window.electronAPI?.addTagToImage(imageId, tagName);
        }
      }
      
      showToast?.(`成功将 ${tagsToApply.length} 个标签应用到 ${imagesToTag.length} 张图片`);
      
      // 等待所有操作完成后再清空状态（避免竞态条件）
      setTagsToAdd([]);
      setSelectedIds([]);
      
      // 重新加载列表
      await new Promise(resolve => setTimeout(resolve, 100));
      loadImages();
    } catch (error) { 
      console.error('应用标签失败:', error);
      showToast?.('应用标签失败，请查看控制台');
    }
  };

  const removeFromSelection = (id) => {
    setSelectedIds(prev => prev.filter(i => i !== id));
  };

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col bg-slate-900/20">
        <div className="h-14 border-b border-slate-800 bg-slate-900/60 backdrop-blur-md flex items-center justify-between px-6 shrink-0">
          <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Check size={18} className="text-blue-500" />
            当前选中 {selectedImages.length} 张图片
          </h2>
          <button onClick={() => setSelectedIds([])} className="text-xs text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-md border border-slate-700 transition-colors">
            清除选择
          </button>
        </div>
        <div className="flex-1 p-6 overflow-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <div className="w-10 h-10 border-3 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-4"></div>
              <p>加载中...</p>
            </div>
          ) : selectedImages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-500">
              <div className="text-center">
                <Tag size={48} className="mx-auto mb-4 opacity-20" />
                <p className="mb-2">请在图片浏览中选择需要打标签的图片</p>
                <p className="text-sm text-slate-600">或在此页面浏览未打标签的图片</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {images.map(img => (
                <div key={img.id} onClick={() => {
                  setSelectedIds(prev => prev.includes(img.id) ? prev.filter(i => i !== img.id) : [...prev, img.id]);
                }} className={`relative rounded-lg overflow-hidden border-2 group bg-slate-800 cursor-pointer transition-all duration-200 ${selectedIds.includes(img.id) ? 'border-blue-500 shadow-lg shadow-blue-900/10' : 'border-slate-700/50 hover:border-slate-600'}`}>
                  <div className="aspect-[4/3] overflow-hidden bg-slate-900">
                    {img.thumbnail_path ? (
                      <img src={getThumbnailUrl(img)} alt={img.filename} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-500"><span className="text-xs">{img.format?.toUpperCase() || 'IMG'}</span></div>
                    )}
                  </div>
                  <div className="absolute top-2 right-2">
                    {selectedIds.includes(img.id) && (
                      <div className="bg-blue-500 text-white p-1 rounded-md shadow-sm"><Check size={14} strokeWidth={3} /></div>
                    )}
                  </div>
                  <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                    <button onClick={(e) => { e.stopPropagation(); removeFromSelection(img.id); }} className="p-2 bg-red-500 text-white rounded-full hover:bg-red-600 hover:scale-110 transition-all shadow-lg">
                      <X size={16} />
                    </button>
                  </div>
                  {isAiProcessing && selectedIds.includes(img.id) && (
                    <div className="absolute inset-0 bg-blue-500/20 backdrop-blur-[2px] z-10 overflow-hidden flex items-center justify-center">
                      <div className="w-[150%] h-[2px] bg-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.8)] absolute top-0" style={{ animation: 'scan 1.5s ease-in-out infinite' }}></div>
                    </div>
                  )}
                  <div className="p-2">
                    <p className="text-xs text-slate-300 truncate">{img.filename}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 分页 */}
          <div className="flex items-center justify-center gap-4 py-4">
            <button disabled={currentPage === 0} onClick={() => setCurrentPage(p => p - 1)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-slate-200 text-sm border border-slate-700">上一页</button>
            <span className="text-sm text-slate-400">第 {currentPage + 1} 页</span>
            <button disabled={images.length < PAGE_SIZE} onClick={() => setCurrentPage(p => p + 1)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-slate-200 text-sm border border-slate-700">下一页</button>
          </div>
        </div>
      </div>

      {/* 右侧标签面板 */}
      <div className="w-[320px] bg-[#1e293b] border-l border-slate-800 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-800/50">
          <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Tag size={16} className="text-blue-400" />
            批量添加标签
          </h3>
          
          <button onClick={handleAiAnalysis} disabled={isAiProcessing || selectedImages.length === 0}
            className={`w-full mb-5 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all ${
              isAiProcessing || selectedImages.length === 0 ? 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed' : 'bg-gradient-to-r from-emerald-600/20 to-teal-600/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-600/30 hover:border-emerald-500/50 shadow-lg shadow-emerald-900/10'
            }`}>
            {isAiProcessing ? <><Loader2 size={16} className="animate-spin" /> 正在提取...</> : <><Bot size={16} /> AI 一键智能提取</>}
          </button>

          <div className="relative group">
            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500" size={16} />
            <input type="text" value={tagInput} onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { pushToQueue(tagInput.trim()); setTagInput(''); }}}
              placeholder="手动输入标签并回车..." 
              className="w-full bg-slate-900/50 border border-slate-700 text-slate-200 text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-blue-500 focus:bg-slate-900 transition-colors placeholder:text-slate-600" />
          </div>
        </div>
        
        <div className="flex-1 p-6 overflow-auto">
          <h4 className="text-[11px] font-bold text-slate-500 mb-3 uppercase tracking-wider">快捷推荐</h4>
          <div className="flex flex-wrap gap-2 mb-8">
            {['自然', '极简', '高画质', '素材', '背景'].map(t => (
              <button key={t} onClick={() => pushToQueue(t)} className="px-2.5 py-1 rounded border border-slate-700 bg-slate-800 text-slate-300 text-xs hover:border-blue-500 hover:text-blue-400 transition-colors flex items-center gap-1">
                <Plus size={12} /> {t}
              </button>
            ))}
          </div>

          <h4 className="text-[11px] font-bold text-slate-500 mb-3 uppercase tracking-wider">待应用队列 ({tagsToAdd.length})</h4>
          <div className="space-y-2">
            {tagsToAdd.map(t => (
              <div key={t} className="flex items-center justify-between px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 text-sm" style={{ animation: 'slideInRight 0.2s ease-out' }}>
                <span className="flex items-center gap-2 font-medium"><Tag size={14} /> {t}</span>
                <button onClick={() => setTagsToAdd(tagsToAdd.filter(tag => tag !== t))} className="text-blue-400/50 hover:text-red-400 hover:bg-red-500/10 p-1 rounded transition-colors">
                  <X size={14} />
                </button>
              </div>
            ))}
            {tagsToAdd.length === 0 && (
              <div className="text-center py-8 text-sm text-slate-500 border border-dashed border-slate-700 rounded-lg">尚未添加标签</div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-slate-800 bg-[#1e293b]">
          <button onClick={handleApplyTags} disabled={tagsToAdd.length === 0 || selectedImages.length === 0}
            className={`w-full py-3 rounded-lg text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 active:scale-95 ${
              tagsToAdd.length === 0 || selectedImages.length === 0 ? 'bg-slate-700 cursor-not-allowed text-slate-400' : 'bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/20'
            }`}>
            <Save size={16} />
            应用到 {selectedImages.length} 张图片
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
