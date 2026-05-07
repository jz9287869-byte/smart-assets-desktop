import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileImage,
  FolderOpen,
  Loader2,
  Ruler,
} from 'lucide-react';

const STEPS = [
  { id: 1, label: '选择文件夹' },
  { id: 2, label: '预览确认' },
  { id: 3, label: '执行导入' },
];

const IMPORT_MODE_OPTIONS = [
  {
    value: 'quick',
    title: '仅导入',
    desc: '只记录图片和路径，不生成缩略图，也不打 AI 标签。',
  },
  {
    value: 'standard',
    title: '仅缩略图',
    desc: '入库后只生成缩略图，不自动打 AI 标签。',
  },
  {
    value: 'full',
    title: '完整导入',
    desc: '入库、生成缩略图，并自动触发 AI 打标。',
  },
];

const INITIAL_PROGRESS = null;

function getImportSummary(stats) {
  const imported = Number(stats?.imported || 0);
  const skipped = Number(stats?.skipped || 0);
  const errors = Number(stats?.errors || 0);

  if (imported === 0 && skipped > 0 && errors === 0) {
    return '这次没有新增图片，所选文件大多已经在资源库里了。';
  }

  if (imported > 0 && skipped > 0) {
    return '这次只导入了新增图片，已存在的文件已自动跳过。';
  }

  if (imported > 0 && errors === 0) {
    return '图片已经加入资源库，可以去图片浏览页查看。';
  }

  if (errors > 0) {
    return '导入已结束，但有部分文件处理失败。';
  }

  return '导入任务已完成。';
}

export default function ImportWizard({ onClose, onComplete }) {
  const [step, setStep] = useState(1);
  const [folderPath, setFolderPath] = useState('');
  const [preview, setPreview] = useState(null);
  const [importMode, setImportMode] = useState('quick');
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(INITIAL_PROGRESS);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const handleProgress = (data) => setProgress(data);
    const cleanup = window.electronAPI?.importAPI?.onImportProgress?.(handleProgress);
    return () => cleanup?.();
  }, []);

  const formatSize = useMemo(
    () => (bytes) => {
      if (!bytes) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let value = bytes;
      let unitIndex = 0;
      while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
      }
      return `${value.toFixed(value >= 100 ? 0 : 2)} ${units[unitIndex]}`;
    },
    []
  );

  const resetSelection = () => {
    setStep(1);
    setFolderPath('');
    setPreview(null);
    setImportMode('quick');
    setProgress(INITIAL_PROGRESS);
    setResult(null);
    setIsLoading(false);
  };

  const handleSelectFolder = async () => {
    try {
      const response = await window.electronAPI?.importAPI?.selectImportFolder?.();
      if (response?.success && !response?.cancelled && response?.path) {
        setFolderPath(response.path);
        setPreview(null);
        setProgress(INITIAL_PROGRESS);
        setResult(null);
        setStep(1);
      }
    } catch (error) {
      console.error('Failed to select import folder:', error);
      alert(`选择文件夹失败：${error.message}`);
    }
  };

  const handlePreview = async () => {
    if (!folderPath) return;

    setIsLoading(true);
    try {
      const response = await window.electronAPI?.importAPI?.previewImport?.({ folderPath });
      if (!response?.success || !response?.preview) {
        throw new Error(response?.error || '未能读取文件夹内容');
      }
      setPreview(response.preview);
      setStep(2);
    } catch (error) {
      console.error('Failed to preview import:', error);
      alert(`预览失败：${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    if (!folderPath) return;

    setIsLoading(true);
    setStep(3);
    setResult(null);
    setProgress({
      stage: 'scanning',
      percentage: 5,
      message: '正在准备导入任务...',
    });

    try {
      const response = await window.electronAPI?.importAPI?.startImport?.({
        folderPath,
        mode: importMode,
      });

      if (!response?.success) {
        throw new Error(response?.error || '导入失败');
      }

      const stats = {
        imported: Number(response.stats?.imported || 0),
        skipped: Number(response.stats?.skipped || 0),
        errors: Number(response.stats?.errors || 0),
      };

      setProgress({
        stage: 'completed',
        percentage: 100,
        message: getImportSummary(stats),
      });
      setResult(stats);
      onComplete?.(stats);
    } catch (error) {
      console.error('Failed to start import:', error);
      setProgress({
        stage: 'error',
        percentage: 100,
        message: `导入失败：${error.message}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSecondaryAction = () => {
    if (step === 3) {
      onClose?.();
      return;
    }

    if (step === 2) {
      setStep(1);
      return;
    }

    resetSelection();
  };

  const renderStepOne = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-slate-100">选择要导入的文件夹</h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          系统会扫描文件夹中的图片并导入到当前资源库，不会移动原始文件。
        </p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <button
          type="button"
          onClick={handleSelectFolder}
          className="inline-flex items-center gap-3 rounded-lg border border-dashed border-slate-600 bg-slate-800 px-5 py-4 text-sm font-medium text-slate-200 transition-colors hover:border-blue-500 hover:bg-slate-700"
        >
          <FolderOpen size={20} />
          {folderPath ? '重新选择文件夹' : '选择文件夹'}
        </button>

        <div className="mt-4 break-all rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-400">
          {folderPath || '还没有选择文件夹'}
        </div>
      </div>
    </div>
  );

  const renderStepTwo = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-slate-100">导入预览</h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          确认图片数量、体积和导入模式，然后开始导入。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 text-center">
          <FileImage className="mx-auto mb-3 text-blue-400" size={28} />
          <div className="text-4xl font-bold text-slate-100">{preview?.totalFiles || 0}</div>
          <div className="mt-2 text-sm text-slate-500">图片文件</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 text-center">
          <Ruler className="mx-auto mb-3 text-slate-300" size={28} />
          <div className="text-4xl font-bold text-slate-100">{formatSize(preview?.totalSize || 0)}</div>
          <div className="mt-2 text-sm text-slate-500">总大小</div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h4 className="mb-3 text-sm font-semibold text-slate-300">文件格式分布</h4>
        <div className="flex flex-wrap gap-2">
          {Object.entries(preview?.byFormat || {}).map(([format, count]) => (
            <div
              key={format}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300"
            >
              <span className="font-medium">{format.toUpperCase()}</span>
              <span className="ml-2 text-slate-500">{count} 个</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h4 className="mb-3 text-sm font-semibold text-slate-300">导入模式</h4>
        <div className="space-y-3">
          {IMPORT_MODE_OPTIONS.map((item) => (
            <label
              key={item.value}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-4 transition-colors ${
                importMode === item.value
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
              }`}
            >
              <input
                type="radio"
                name="import-mode"
                value={item.value}
                checked={importMode === item.value}
                onChange={(event) => setImportMode(event.target.value)}
                className="mt-1"
              />
              <div>
                <div className="font-medium text-slate-100">{item.title}</div>
                <div className="mt-1 text-sm text-slate-400">{item.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  const renderStepThree = () => (
    <div className="space-y-6 text-center">
      <div>
        <h3 className="text-lg font-semibold text-slate-100">执行导入</h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          导入任务已经开始，这里会显示新增、跳过和错误数量。
        </p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8">
        <div className="flex items-center justify-center gap-3 text-lg text-slate-200">
          {progress?.stage === 'error' ? (
            <AlertCircle className="text-red-400" size={22} />
          ) : progress?.stage === 'completed' ? (
            <CheckCircle2 className="text-emerald-400" size={22} />
          ) : (
            <Loader2 className="animate-spin text-blue-400" size={22} />
          )}
          <span>
            {progress?.stage === 'error'
              ? '导入失败'
              : progress?.stage === 'completed'
                ? '导入完成'
                : '正在处理'}
          </span>
        </div>

        {progress?.percentage !== undefined && (
          <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
        )}

        <p className="mt-4 text-sm text-slate-400">
          {progress?.message || '正在准备导入任务...'}
        </p>
      </div>

      {result && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-left">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3">
              <div className="text-xs text-slate-500">新增导入</div>
              <div className="mt-1 text-2xl font-semibold text-slate-100">{result.imported}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3">
              <div className="text-xs text-slate-500">已跳过</div>
              <div className="mt-1 text-2xl font-semibold text-slate-100">{result.skipped}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3">
              <div className="text-xs text-slate-500">错误数量</div>
              <div className="mt-1 text-2xl font-semibold text-slate-100">{result.errors}</div>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-300">{getImportSummary(result)}</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-800/70 shadow-2xl">
      <div className="shrink-0 border-b border-slate-800 px-6 py-6">
        <div className="flex items-center justify-center gap-4 md:gap-8">
          {STEPS.map((item, index) => (
            <React.Fragment key={item.id}>
              <div className="flex flex-col items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold ${
                    step >= item.id
                      ? 'border-blue-500 bg-blue-500 text-white'
                      : 'border-slate-700 bg-slate-800 text-slate-500'
                  }`}
                >
                  {item.id}
                </div>
                <span className={`text-sm ${step >= item.id ? 'text-blue-400' : 'text-slate-500'}`}>
                  {item.label}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div className={`h-px w-16 ${step > item.id ? 'bg-blue-500' : 'bg-slate-700'}`} />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {step === 1 && renderStepOne()}
        {step === 2 && renderStepTwo()}
        {step === 3 && renderStepThree()}
      </div>

      <div className="sticky bottom-0 z-10 shrink-0 border-t border-slate-800 bg-slate-900/95 px-6 py-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleSecondaryAction}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
          >
            {step === 3 ? '完成' : step === 2 ? '上一步' : '取消'}
          </button>

          <div className="flex items-center gap-3">
            {step === 1 && (
              <button
                type="button"
                onClick={handlePreview}
                disabled={!folderPath || isLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                下一步
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                onClick={handleImport}
                disabled={!folderPath || isLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                开始导入
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
