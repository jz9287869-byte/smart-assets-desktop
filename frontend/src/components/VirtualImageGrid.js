import React from 'react';

/**
 * 虚拟化图片网格组件（暂时禁用）
 * TODO: 修复 react-window 兼容性问题
 */
export default function VirtualImageGrid({ 
  images, 
  selectedIds, 
  onSelectImage, 
  onToggleSelect,
  showToast,
  STATUS_CONFIG,
  onDblClick 
}) {
  // 临时使用基础网格替代
  return (
    <div className={`grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`}>
      {images.map(img => (
        <div
          key={img.id}
          onClick={() => onSelectImage?.(img.id)}
          className={`relative bg-slate-800 rounded-xl border cursor-pointer transition-all p-2 ${
            selectedIds.includes(img.id)
              ? 'border-blue-500 shadow-lg shadow-blue-900/20'
              : 'border-slate-700/50 hover:border-blue-500/50'
          }`}
        >
          <div className="aspect-[4/3] bg-slate-900 rounded-lg mb-2">
            <img 
              src={img.thumbnail_path || `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='75'%3E%3Crect fill='%23404040' width='100' height='75'/%3E%3C/svg%3E`}
              alt={img.filename}
              className="w-full h-full object-cover rounded-lg"
            />
          </div>
          <p className="text-xs text-slate-300 truncate">{img.filename}</p>
        </div>
      ))}
    </div>
  );
}
