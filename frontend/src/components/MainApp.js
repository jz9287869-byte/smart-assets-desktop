import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cpu,
  Database,
  Download,
  HardDrive,
  Image as ImageIcon,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Zap,
} from 'lucide-react';

import BatchTaggingTool from './BatchTaggingTool';
import ImageBrowser from './ImageBrowser';
import ImportWizard from './ImportWizard';
import LibraryManager from './LibraryManager';
import NaturalLanguageSearch from './NaturalLanguageSearch';
import ProgressCenter from './ProgressCenter';
import TagManager from './TagManager';
import TrashView from './TrashView';

const SidebarItem = ({ icon: Icon, label, isActive, onClick, badge }) => (
  <button
    type="button"
    onClick={onClick}
    style={{ WebkitAppRegion: 'no-drag' }}
    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-all duration-200 group ${
      isActive
        ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
        : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
    }`}
  >
    <div className="flex items-center gap-3">
      <Icon size={18} className={isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'} />
      <span className="font-medium text-sm">{label}</span>
    </div>
    {badge ? (
      <span
        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
          isActive ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-400 group-hover:bg-slate-700'
        }`}
      >
        {badge}
      </span>
    ) : null}
  </button>
);

const Toast = ({ message, isVisible }) => (
  <div
    className={`fixed bottom-12 right-12 z-50 flex items-center gap-2 bg-emerald-600 text-white px-5 py-3 rounded-lg shadow-xl shadow-emerald-900/20 transform transition-all duration-300 ${
      isVisible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0 pointer-events-none'
    }`}
  >
    <CheckCircle2 size={18} />
    <span className="text-sm font-medium">{message}</span>
  </div>
);

class ContentErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Menu view render failed:', {
      view: this.props.viewId,
      error,
      errorInfo,
    });
  }

  componentDidUpdate(prevProps) {
    if (prevProps.viewId !== this.props.viewId && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-xl w-full rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-left shadow-xl shadow-red-950/10">
          <div className="text-sm font-semibold text-red-300 mb-2">页面加载失败</div>
          <div className="text-slate-200 text-lg mb-2">当前菜单: {this.props.viewLabel}</div>
          <p className="text-sm text-slate-400 mb-4">
            当前页面发生运行时错误。应用壳不会白屏，你可以继续切换菜单，我会把错误信息留在这里方便排查。
          </p>
          <pre className="text-xs text-red-200 bg-slate-950/60 border border-slate-800 rounded-lg p-4 overflow-auto whitespace-pre-wrap">
            {this.state.error?.stack || this.state.error?.message || '未知错误'}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-4 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
          >
            重试当前页面
          </button>
        </div>
      </div>
    );
  }
}

export default function MainApp() {
  const [currentView, setCurrentView] = useState('browser');
  const [libraryStatus, setLibraryStatus] = useState(null);
  const [toastMsg, setToastMsg] = useState({ text: '', visible: false });
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const statusRequestRef = useRef(0);

  const navItems = useMemo(() => ([
    { id: 'library', name: '资源库', icon: HardDrive },
    { id: 'import', name: '导入', icon: Download },
    { id: 'browser', name: '图片浏览', icon: ImageIcon },
    { id: 'natural-search', name: '自然语言搜图', icon: Search },
    { id: 'batch-tagging', name: '批量标签', icon: Zap },
    { id: 'tags', name: '标签管理', icon: Tag },
    { id: 'trash', name: '回收站', icon: Trash2 },
    { id: 'progress', name: '处理中心', icon: Activity, badge: libraryStatus?.stats?.isRunning ? '运行中' : null },
  ]), [libraryStatus?.stats?.isRunning]);

  const currentNavItem = navItems.find((item) => item.id === currentView);
  const currentViewLabel = currentNavItem?.name || currentView;

  const showToast = useCallback((message) => {
    setToastMsg({ text: message, visible: true });
    window.setTimeout(() => {
      setToastMsg((prev) => ({ ...prev, visible: false }));
    }, 3000);
  }, []);

  const checkLibraryStatus = useCallback(async (options = {}) => {
    const { silent = false } = options;
    const requestId = statusRequestRef.current + 1;
    statusRequestRef.current = requestId;

    try {
      if (!silent && !hasLoadedOnce) {
        setIsLoading(true);
      }

      const result = await window.electronAPI?.libraryAPI?.getStatus?.();
      if (statusRequestRef.current !== requestId) {
        return;
      }

      if (result?.success) {
        setLibraryStatus(result);
      } else {
        console.error('Library status check failed:', result?.error);
        setLibraryStatus({ active: false, error: result?.error || '状态检查失败' });
        if (currentView !== 'library') {
          showToast('资源库连接已断开，请重新选择');
        }
      }
    } catch (error) {
      if (statusRequestRef.current !== requestId) {
        return;
      }

      console.error('Library status request crashed:', error);
      setLibraryStatus({ active: false, error: '系统异常，请稍后重试' });
      if (currentView !== 'library') {
        showToast('系统异常，请稍后重试');
      }
    } finally {
      if (!silent && !hasLoadedOnce) {
        setIsLoading(false);
      }
      if (!hasLoadedOnce) {
        setHasLoadedOnce(true);
      }
    }
  }, [currentView, hasLoadedOnce, showToast]);

  useEffect(() => {
    checkLibraryStatus();
    const interval = window.setInterval(() => {
      checkLibraryStatus({ silent: true });
    }, 30000);
    return () => window.clearInterval(interval);
  }, [checkLibraryStatus]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.queueAPI?.onStatsUpdated?.((stats) => {
      setLibraryStatus((prev) => (
        prev
          ? {
              ...prev,
              stats,
            }
          : prev
      ));
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const handleNavigate = (event) => {
      const nextView = event?.detail?.view;
      if (nextView) {
        setCurrentView(nextView);
      }
    };

    window.addEventListener('app:navigate', handleNavigate);
    return () => window.removeEventListener('app:navigate', handleNavigate);
  }, []);

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="w-10 h-10 border-3 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-4 mx-auto" />
            <p className="text-slate-400">加载中...</p>
          </div>
        </div>
      );
    }

    switch (currentView) {
      case 'library':
        return <LibraryManager onLibraryChange={() => checkLibraryStatus()} showToast={showToast} />;
      case 'import':
        return (
          <div className="flex h-full min-h-0 flex-col overflow-hidden px-6 py-5">
            <div className="shrink-0 pb-4">
              <h2>导入图片</h2>
              <p>将文件夹中的图片批量导入到当前资源库</p>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ImportWizard
                onClose={() => {
                  checkLibraryStatus();
                  setCurrentView('browser');
                }}
                onComplete={() => {
                  checkLibraryStatus();
                }}
              />
            </div>
          </div>
        );
      case 'browser':
        return <ImageBrowser showToast={showToast} storageScope={libraryStatus?.libraryId || 'default'} />;
      case 'natural-search':
        return <NaturalLanguageSearch showToast={showToast} />;
      case 'batch-tagging':
        return <BatchTaggingTool showToast={showToast} storageScope={libraryStatus?.libraryId || 'default'} />;
      case 'tags':
        return <TagManager showToast={showToast} />;
      case 'trash':
        return <TrashView showToast={showToast} />;
      case 'progress':
        return <ProgressCenter />;
      default:
        return <LibraryManager onLibraryChange={() => checkLibraryStatus()} showToast={showToast} />;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#0f172a] text-slate-200 font-sans selection:bg-blue-500/30 overflow-hidden relative">
      <Toast message={toastMsg.text} isVisible={toastMsg.visible} />

      <div
        className="h-10 bg-[#0f172a] border-b border-slate-800 flex items-center justify-between px-4 select-none"
        style={{ WebkitAppRegion: 'drag' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
          <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50" />
        </div>
        <div className="text-xs font-medium text-slate-500 tracking-wider">智能素材管理系统 V2</div>
        <div className="w-16" />
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-[240px] bg-[#1e293b] border-r border-slate-800 flex flex-col shrink-0" style={{ WebkitAppRegion: 'no-drag' }}>
          <div className="p-6 flex items-center gap-3 border-b border-slate-800/50">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-900/20">
              <Sparkles className="text-white" size={16} />
            </div>
            <div>
              <h2 className="font-bold text-slate-100 text-sm">Smart Assets</h2>
              <p className="text-[10px] text-slate-400">V2.0 Professional</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
            <div className="text-xs font-semibold text-slate-500 px-3 mb-2 uppercase tracking-wider">主菜单</div>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <SidebarItem
                  key={item.id}
                  icon={Icon}
                  label={item.name}
                  badge={item.badge}
                  isActive={currentView === item.id}
                  onClick={() => setCurrentView(item.id)}
                />
              );
            })}
          </div>

          <div className="p-4 border-t border-slate-800/50 bg-slate-900/30">
            {libraryStatus?.active ? (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center border border-blue-500/30">
                  <Database size={14} className="text-blue-400" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className="text-[10px] text-slate-500">当前资源库</p>
                  <p className="text-xs font-medium text-slate-200 truncate">
                    {libraryStatus.name || '未命名资源库'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-sm text-slate-500">
                <Activity size={14} />
                <span>未选择资源库</span>
              </div>
            )}
          </div>
        </div>

        <main className="relative flex-1 min-h-0 overflow-hidden bg-[#0f172a]" style={{ WebkitAppRegion: 'no-drag' }}>
          <ContentErrorBoundary viewId={currentView} viewLabel={currentViewLabel}>
            {renderContent()}
          </ContentErrorBoundary>
        </main>
      </div>

      <div className="h-7 bg-[#1e293b] border-t border-slate-800 flex items-center justify-between px-4 text-[10px] text-slate-500 shrink-0">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 size={12} className="text-green-500" />
            {libraryStatus?.active ? '资源库已连接' : '未连接资源库'}
          </span>
          <span className="flex items-center gap-1.5">
            <Cpu size={12} className="text-blue-500" />
            {libraryStatus?.stats?.isRunning ? '引擎运行中' : '引擎就绪'}
          </span>
          {libraryStatus?.overview ? (
            <span>{libraryStatus.overview.total?.toLocaleString() || 0} 张图片</span>
          ) : null}
        </div>
        <div>Electron 28.1.0 · React 18.2.0 · Tailwind 3.4</div>
      </div>
    </div>
  );
}
