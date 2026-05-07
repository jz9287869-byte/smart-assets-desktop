import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Clock,
  Database,
  FolderOpen,
  Image,
  Image as ImageIcon,
  Save,
  Settings2,
  Sparkles,
} from 'lucide-react';

function getQueueTotals(queueStats) {
  const pending = Number(queueStats?.pending || 0);
  const processing = Number(queueStats?.processing || 0);
  const completed = Number(queueStats?.completed || 0);
  const failed = Number(queueStats?.failed || 0);
  const total = pending + processing + completed + failed;
  return { pending, processing, completed, failed, total };
}

function getQueueProgress(queueStats) {
  const { completed, failed, total } = getQueueTotals(queueStats);
  if (!total) return '0%';
  return `${(((completed + failed) / total) * 100).toFixed(0)}%`;
}

const PROVIDER_OPTIONS = [
  {
    value: 'openai_compatible',
    label: 'OpenAI 兼容接口',
    hint: '适合 Ollama、vLLM、OpenRouter 以及其他兼容 /chat/completions 的服务。',
  },
  {
    value: 'google_ai',
    label: 'Google AI (Gemma/Gemini)',
    hint: '直接连接 Google AI Developers，适合官方 Gemini / Gemma 云端接口。',
  },
];

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_OPENAI_COMPATIBLE_MODEL = 'gemma3:4b';
const DEFAULT_GOOGLE_AI_BASE_URL = 'https://generativelanguage.googleapis.com';
const CUSTOM_MODEL_VALUE = '__custom__';
const CUSTOM_SERVICE_VALUE = '__custom_service__';

const SERVICE_OPTIONS = [
  {
    value: 'ollama_local',
    label: '本地 Ollama / Gemma',
    provider: 'openai_compatible',
    baseURL: 'http://127.0.0.1:11434/v1',
    hint: '适合本机 Ollama、本地 Gemma 或你自己的本地推理服务。',
  },
  {
    value: 'openai',
    label: 'OpenAI 官方',
    provider: 'openai_compatible',
    baseURL: 'https://api.openai.com/v1',
    hint: '使用 OpenAI 官方接口，适合云端模型调用。',
  },
  {
    value: 'deepseek',
    label: '深度求索 DeepSeek',
    provider: 'openai_compatible',
    baseURL: 'https://api.deepseek.com',
    hint: '使用 DeepSeek 官方接口，适合国内访问场景。',
  },
  {
    value: 'qwen',
    label: '阿里通义千问',
    provider: 'openai_compatible',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    hint: '使用阿里百炼兼容接口，适合通义千问模型。',
  },
  {
    value: 'openrouter',
    label: 'OpenRouter 聚合',
    provider: 'openai_compatible',
    baseURL: 'https://openrouter.ai/api/v1',
    hint: '一个接口切换多家海外模型，适合想灵活换模型时使用。',
  },
  {
    value: 'google_ai',
    label: 'Google AI 官方',
    provider: 'google_ai',
    baseURL: 'https://generativelanguage.googleapis.com',
    hint: '适合 Gemini / Gemma 官方云端接口。',
  },
];

const MODEL_OPTIONS = {
  openai_compatible: [
    { value: 'gemma3:4b', label: 'Gemma 3 4B (本地/Ollama)', service: 'ollama_local' },
    { value: 'gemma3:12b', label: 'Gemma 3 12B (本地/Ollama)', service: 'ollama_local' },
    { value: 'gemma4:e2b', label: 'Gemma 4 E2B (不支持图像打标)', service: 'ollama_local' },
    { value: 'deepseek-chat', label: 'DeepSeek Chat', service: 'deepseek' },
    { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner', service: 'deepseek' },
    { value: 'qwen-plus', label: 'Qwen Plus', service: 'qwen' },
    { value: 'qwen-max', label: 'Qwen Max', service: 'qwen' },
    { value: 'gpt-4o-mini', label: 'OpenAI GPT-4o mini', service: 'openai' },
    { value: 'gpt-4.1-mini', label: 'OpenAI GPT-4.1 mini', service: 'openai' },
    { value: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet (兼容网关)', service: 'openrouter' },
  ],
  google_ai: [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', service: 'google_ai' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', service: 'google_ai' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', service: 'google_ai' },
    { value: 'gemma-3-27b-it', label: 'Gemma 3 27B IT', service: 'google_ai' },
    { value: 'gemma-3-12b-it', label: 'Gemma 3 12B IT', service: 'google_ai' },
  ],
};

function getModelOptions(provider) {
  return MODEL_OPTIONS[provider] || MODEL_OPTIONS.openai_compatible;
}

function normalizeUrlForMatch(url) {
  return String(url || '').trim().replace(/\/+$/, '').toLowerCase();
}

function getSelectedServiceOption(provider, baseURL) {
  const normalizedProvider = String(provider || '').trim();
  const normalizedBaseURL = normalizeUrlForMatch(baseURL);
  const matched = SERVICE_OPTIONS.find(
    (option) => option.provider === normalizedProvider && normalizeUrlForMatch(option.baseURL) === normalizedBaseURL
  );
  return matched?.value || CUSTOM_SERVICE_VALUE;
}

function getSelectedModelOption(provider, model) {
  const normalized = String(model || '').trim();
  if (!normalized) {
    return '';
  }
  return getModelOptions(provider).some((option) => option.value === normalized)
    ? normalized
    : CUSTOM_MODEL_VALUE;
}

function StatCard({ title, value, icon: Icon, color, bg, pulse = false }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5">
      <div className={`relative rounded-lg p-3 ${bg} ${color}`}>
        <Icon size={22} />
        {pulse ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-ping rounded-full bg-emerald-500" /> : null}
      </div>
      <div>
        <p className="mb-0.5 text-xs text-slate-400">{title}</p>
        <p className="text-xl font-bold text-slate-200">{value}</p>
      </div>
    </div>
  );
}

export default function ProgressCenter() {
  const [stats, setStats] = useState(null);
  const [libraryStatus, setLibraryStatus] = useState(null);
  const [cloudReviewConfig, setCloudReviewConfig] = useState({
    enabled: false,
    provider: 'openai_compatible',
    baseURL: '',
    model: '',
    apiKey: '',
    hasApiKey: false,
  });
  const [isSavingCloudConfig, setIsSavingCloudConfig] = useState(false);
  const [cloudConfigNotice, setCloudConfigNotice] = useState('');
  const [cloudConfigError, setCloudConfigError] = useState('');
  const [apiKeyTouched, setApiKeyTouched] = useState(false);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const [libResult, queueResult, cloudResult] = await Promise.all([
          window.electronAPI?.libraryAPI?.getStatus?.(),
          window.electronAPI?.queueAPI?.getStats?.(),
          window.electronAPI?.aiAPI?.getCloudReviewConfig?.(),
        ]);

        if (libResult?.success) setLibraryStatus(libResult);
        if (queueResult?.success) setStats(queueResult.stats);
        if (cloudResult?.success) {
          setCloudReviewConfig((prev) => ({
            ...prev,
            enabled: !!cloudResult.enabled,
            provider: cloudResult.provider || 'openai_compatible',
            baseURL: cloudResult.baseURL || '',
            model: cloudResult.model || '',
            hasApiKey: !!cloudResult.hasApiKey,
          }));
        }
      } catch (error) {
        console.error('Failed to fetch processing status:', error);
      }
    };

    fetchStatus();
    const interval = window.setInterval(fetchStatus, 3000);
    const cleanup = window.electronAPI?.queueAPI?.onStatsUpdated?.((data) => setStats(data));

    return () => {
      window.clearInterval(interval);
      if (cleanup && typeof cleanup === 'function') cleanup();
    };
  }, []);

  const formatNumber = (num) => (num === undefined || num === null ? '-' : num.toLocaleString());
  const thumbnailTotals = getQueueTotals(stats?.thumbnail);
  const aiTagTotals = getQueueTotals(stats?.aiTag);
  const vectorBackfill = stats?.vectorBackfill || {};
  const overview = libraryStatus?.overview;

  const providerHint = useMemo(
    () => PROVIDER_OPTIONS.find((option) => option.value === cloudReviewConfig.provider)?.hint || '',
    [cloudReviewConfig.provider]
  );

  const placeholderBaseUrl = cloudReviewConfig.provider === 'google_ai'
    ? DEFAULT_GOOGLE_AI_BASE_URL
    : DEFAULT_OPENAI_COMPATIBLE_BASE_URL;

  const placeholderModel = cloudReviewConfig.provider === 'google_ai'
    ? '填写你账号里可用的 Gemini / Gemma 模型 ID'
    : DEFAULT_OPENAI_COMPATIBLE_MODEL;

  const modelOptions = useMemo(
    () => getModelOptions(cloudReviewConfig.provider),
    [cloudReviewConfig.provider]
  );
  const serviceOptions = useMemo(() => SERVICE_OPTIONS, []);
  const selectedServiceOption = useMemo(
    () => getSelectedServiceOption(cloudReviewConfig.provider, cloudReviewConfig.baseURL),
    [cloudReviewConfig.provider, cloudReviewConfig.baseURL]
  );
  const selectedModelOption = useMemo(
    () => getSelectedModelOption(cloudReviewConfig.provider, cloudReviewConfig.model),
    [cloudReviewConfig.provider, cloudReviewConfig.model]
  );

  const handleCloudReviewFieldChange = (field, value) => {
    setCloudConfigNotice('');
    setCloudConfigError('');
    setCloudReviewConfig((prev) => ({
      ...prev,
      [field]: value,
      ...(field === 'provider'
        ? {
            baseURL: value === 'google_ai'
              ? DEFAULT_GOOGLE_AI_BASE_URL
              : (prev.baseURL || DEFAULT_OPENAI_COMPATIBLE_BASE_URL),
            model: value === 'google_ai'
              ? prev.model
              : (prev.model || DEFAULT_OPENAI_COMPATIBLE_MODEL),
          }
        : {}),
    }));
  };

  const handleModelPresetChange = (value) => {
    if (value === CUSTOM_MODEL_VALUE) {
      return;
    }

    const matched = getModelOptions(cloudReviewConfig.provider).find((option) => option.value === value);
    if (!matched) {
      handleCloudReviewFieldChange('model', value);
      return;
    }

    const matchedService = SERVICE_OPTIONS.find((option) => option.value === matched.service);
    setCloudConfigNotice('');
    setCloudConfigError('');
    setCloudReviewConfig((prev) => ({
      ...prev,
      provider: matchedService?.provider || prev.provider,
      baseURL: matchedService?.baseURL || prev.baseURL,
      model: value,
    }));
  };

  const handleServicePresetChange = (value) => {
    if (value === CUSTOM_SERVICE_VALUE) {
      return;
    }
    const matched = SERVICE_OPTIONS.find((option) => option.value === value);
    if (!matched) {
      return;
    }

    const nextOptions = getModelOptions(matched.provider);
    const hasCurrentModel = nextOptions.some((option) => option.value === cloudReviewConfig.model);
    const preferredModel = nextOptions.find((option) => option.service === value)?.value || nextOptions[0]?.value || '';

    setCloudConfigNotice('');
    setCloudConfigError('');
    setCloudReviewConfig((prev) => ({
      ...prev,
      provider: matched.provider,
      baseURL: matched.baseURL,
      model: hasCurrentModel ? prev.model : preferredModel,
    }));
  };

  const saveCloudReviewConfig = async () => {
    setIsSavingCloudConfig(true);
    setCloudConfigNotice('');
    setCloudConfigError('');

    try {
      const payload = {
        enabled: !!cloudReviewConfig.enabled,
        provider: cloudReviewConfig.provider,
        baseURL: cloudReviewConfig.baseURL.trim(),
        model: cloudReviewConfig.model.trim(),
      };

      if (apiKeyTouched) {
        payload.apiKey = cloudReviewConfig.apiKey.trim();
      }

      const result = await window.electronAPI?.aiAPI?.setCloudReviewConfig?.(payload);
      if (!result?.success) {
        throw new Error(result?.error || '保存云端复核配置失败');
      }

      setCloudReviewConfig((prev) => ({
        ...prev,
        enabled: !!result.enabled,
        provider: result.provider || prev.provider,
        baseURL: result.baseURL || '',
        model: result.model || '',
        apiKey: '',
        hasApiKey: !!result.hasApiKey,
      }));
      setApiKeyTouched(false);
      setCloudConfigNotice(
        result.enabled
          ? '云端复核配置已生效，后续 AI 标注会按新的模型设置执行。'
          : '云端复核已关闭，当前回到本地规则处理。'
      );
    } catch (error) {
      console.error('Failed to save cloud review config:', error);
      setCloudConfigError(error.message || '保存云端复核配置失败');
    } finally {
      setIsSavingCloudConfig(false);
    }
  };

  if (!libraryStatus?.active) {
    return (
      <div className="h-full overflow-auto p-8">
        <h1 className="mb-2 text-2xl font-bold text-slate-100">处理中心</h1>
        <p className="mb-8 text-sm text-slate-400">监控后台任务、AI 标注队列与缩略图生成状态。</p>
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <Database size={48} className="mb-4 opacity-20" />
          <p>请先创建或选择一个资源库。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">处理中心</h1>
        <p className="mt-1 text-sm text-slate-400">监控后台任务、AI 标注队列以及缩略图生成状态。</p>
      </div>

      <div className="mb-8 grid grid-cols-4 gap-6">
        <StatCard title="总图片数" value={formatNumber(overview?.total)} icon={ImageIcon} color="text-blue-500" bg="bg-blue-500/10" />
        <StatCard title="已生成缩略图" value={formatNumber(overview?.thumbnail_done)} icon={Image} color="text-green-500" bg="bg-green-500/10" />
        <StatCard title="AI 已标注" value={formatNumber(overview?.ai_tagged)} icon={Sparkles} color="text-violet-500" bg="bg-violet-500/10" />
        <StatCard
          title="引擎状态"
          value={stats?.isRunning ? '运行中' : '已停止'}
          icon={Activity}
          color={stats?.isRunning ? 'text-emerald-500' : 'text-slate-400'}
          bg={stats?.isRunning ? 'bg-emerald-500/10' : 'bg-slate-800/50'}
          pulse={!!stats?.isRunning}
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-6">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Image className="text-blue-500" size={20} />
              <h3 className="text-lg font-semibold text-slate-200">缩略图生成</h3>
            </div>
            <span className={`rounded-md border px-2 py-1 text-xs font-medium ${thumbnailTotals.processing > 0 ? 'border-blue-500/20 bg-blue-500/10 text-blue-400' : 'border-slate-700 bg-slate-800 text-slate-500'}`}>
              {thumbnailTotals.processing > 0 ? 'Processing' : 'Idle'}
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-slate-400">队列进度</span>
                <span className="font-medium text-slate-200">{getQueueProgress(stats?.thumbnail)}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full border border-slate-800 bg-slate-900">
                <div className="h-2 rounded-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-300" style={{ width: getQueueProgress(stats?.thumbnail) }} />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4 border-t border-slate-700/50 pt-4">
              <div><p className="mb-1 text-xs text-slate-500">待处理</p><p className="text-lg font-semibold text-slate-300">{formatNumber(thumbnailTotals.pending)}</p></div>
              <div><p className="mb-1 text-xs text-slate-500">处理中</p><p className="text-lg font-semibold text-blue-500">{formatNumber(thumbnailTotals.processing)}</p></div>
              <div><p className="mb-1 text-xs text-slate-500">已完成</p><p className="text-lg font-semibold text-slate-300">{formatNumber(thumbnailTotals.completed)}</p></div>
              <div><p className="mb-1 text-xs text-slate-500">总计</p><p className="text-lg font-semibold text-slate-300">{formatNumber(thumbnailTotals.total)}</p></div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-6">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="text-green-500" size={20} />
              <h3 className="text-lg font-semibold text-slate-200">AI 标签引擎</h3>
            </div>
            <span className={`rounded-md border px-2 py-1 text-xs font-medium ${aiTagTotals.processing > 0 ? 'border-green-500/20 bg-green-500/10 text-green-400' : 'border-slate-700 bg-slate-800 text-slate-500'}`}>
              {aiTagTotals.processing > 0 ? 'Processing' : 'Idle'}
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-slate-400">队列进度 (chinese-clip-vit-base)</span>
                <span className="font-medium text-slate-200">{getQueueProgress(stats?.aiTag)}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full border border-slate-800 bg-slate-900">
                <div className="h-2 rounded-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-300" style={{ width: getQueueProgress(stats?.aiTag) }} />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4 border-t border-slate-700/50 pt-4">
              <div><p className="mb-1 text-xs text-slate-500">待处理</p><p className="text-lg font-semibold text-slate-300">{formatNumber(aiTagTotals.pending)}</p></div>
              <div><p className="mb-1 text-xs text-slate-500">处理中</p><p className="text-lg font-semibold text-green-500">{formatNumber(aiTagTotals.processing)}</p></div>
              <div><p className="mb-1 text-xs text-slate-500">已完成</p><p className="text-lg font-semibold text-slate-300">{formatNumber(aiTagTotals.completed)}</p></div>
              <div><p className="mb-1 text-xs text-slate-500">失败</p><p className="text-lg font-semibold text-red-400">{formatNumber(aiTagTotals.failed)}</p></div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-700 bg-slate-800/40 p-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="text-cyan-400" size={20} />
            <h3 className="text-lg font-semibold text-slate-200">语义向量预热</h3>
          </div>
          <span className={`rounded-md border px-2 py-1 text-xs font-medium ${
            vectorBackfill.running
              ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300'
              : vectorBackfill.enabled
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                : 'border-slate-700 bg-slate-800 text-slate-500'
          }`}>
            {vectorBackfill.running ? 'Backfilling' : vectorBackfill.enabled ? 'Ready' : 'Disabled'}
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4"><p className="mb-1 text-xs text-slate-500">待补全向量</p><p className="text-xl font-semibold text-slate-200">{formatNumber(vectorBackfill.missing)}</p></div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4"><p className="mb-1 text-xs text-slate-500">本轮已补全</p><p className="text-xl font-semibold text-cyan-300">{formatNumber(vectorBackfill.computed)}</p></div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4"><p className="mb-1 text-xs text-slate-500">模型预热</p><p className={`text-xl font-semibold ${vectorBackfill.modelPreloaded ? 'text-emerald-300' : 'text-slate-300'}`}>{vectorBackfill.modelPreloaded ? '已完成' : '等待中'}</p></div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4"><p className="mb-1 text-xs text-slate-500">最近执行</p><p className="text-sm font-medium text-slate-300">{vectorBackfill.lastRunAt ? new Date(vectorBackfill.lastRunAt).toLocaleString() : '尚未开始'}</p></div>
        </div>

        {vectorBackfill.lastError ? (
          <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            {vectorBackfill.lastError}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-400">
            后台会在空闲时自动补全老图片的语义向量，并提前预热检索模型，降低首次自然语言搜图的等待时间。
          </p>
        )}
      </div>

      <div className="mt-6 rounded-xl border border-slate-700 bg-slate-800/40 p-6">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="text-amber-300" size={20} />
            <h3 className="text-lg font-semibold text-slate-200">Gemma / 云端标签复核</h3>
          </div>
          <span className={`rounded-md border px-2 py-1 text-xs font-medium ${
            cloudReviewConfig.enabled
              ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
              : 'border-slate-700 bg-slate-800 text-slate-500'
          }`}>
            {cloudReviewConfig.enabled ? '已启用' : '未启用'}
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <label className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div className="mb-2 text-xs text-slate-500">服务商</div>
            <select
              value={selectedServiceOption}
              onChange={(event) => handleServicePresetChange(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              {serviceOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              <option value={CUSTOM_SERVICE_VALUE}>自定义</option>
            </select>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              {serviceOptions.find((option) => option.value === selectedServiceOption)?.hint || '可以保留自定义接口地址。'}
            </p>
          </label>

          <label className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div className="mb-2 text-xs text-slate-500">接口类型</div>
            <select
              value={cloudReviewConfig.provider}
              onChange={(event) => handleCloudReviewFieldChange('provider', event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              {PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="mt-2 text-xs leading-5 text-slate-400">{providerHint}</p>
          </label>

          <label className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div className="mb-2 text-xs text-slate-500">模型 ID</div>
            <select
              value={selectedModelOption}
              onChange={(event) => handleModelPresetChange(event.target.value)}
              className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              <option value="">请选择常用模型</option>
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              <option value={CUSTOM_MODEL_VALUE}>自定义模型</option>
            </select>
            <input
              type="text"
              value={cloudReviewConfig.model}
              onChange={(event) => handleCloudReviewFieldChange('model', event.target.value)}
              placeholder={placeholderModel}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-2 text-xs leading-5 text-slate-400">
              选中常用模型时会自动联动到更合适的服务商；如果你有自定义模型名，也可以直接手动填写。
            </p>
          </label>

          <label className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 lg:col-span-2">
            <div className="mb-2 text-xs text-slate-500">接口地址</div>
            <input
              type="text"
              value={cloudReviewConfig.baseURL}
              onChange={(event) => handleCloudReviewFieldChange('baseURL', event.target.value)}
              placeholder={placeholderBaseUrl}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-2 text-xs text-slate-400">
              如果你选择的是官方服务，通常用默认地址即可；如果是自建网关或局域网服务，请填你自己的接口地址。
            </p>
          </label>

          <label className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 lg:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-slate-500">API Key</span>
              <span className={`text-[11px] ${cloudReviewConfig.hasApiKey ? 'text-emerald-300' : 'text-slate-500'}`}>
                {cloudReviewConfig.hasApiKey ? '已保存密钥' : '尚未配置密钥'}
              </span>
            </div>
            <input
              type="password"
              value={cloudReviewConfig.apiKey}
              onChange={(event) => {
                setApiKeyTouched(true);
                handleCloudReviewFieldChange('apiKey', event.target.value);
              }}
              placeholder={cloudReviewConfig.hasApiKey
                ? '留空表示保留当前密钥；清空后保存可删除密钥'
                : (cloudReviewConfig.provider === 'openai_compatible'
                  ? '本地 Ollama / vLLM 可留空；云端服务请填写 API Key'
                  : '请输入 Google AI 的 API Key')}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={cloudReviewConfig.enabled}
              onChange={(event) => handleCloudReviewFieldChange('enabled', event.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-blue-500 focus:ring-blue-500"
            />
            启用 Gemma / 云端复核
          </label>

          <button
            type="button"
            onClick={saveCloudReviewConfig}
            disabled={isSavingCloudConfig}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save size={16} />
            {isSavingCloudConfig ? '保存中...' : '保存并立即生效'}
          </button>
        </div>

        {cloudConfigNotice ? (
          <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {cloudConfigNotice}
          </div>
        ) : null}

        {cloudConfigError ? (
          <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {cloudConfigError}
          </div>
        ) : null}

        <p className="mt-4 text-sm leading-6 text-slate-400">
          当前策略不是让大模型直接替代图像识别主干，而是让它对“人物 / 单人 / 多人 / 纯风景”等高风险维度做二次复核。
          这样既能利用大模型的理解能力，又不会把整套搜图链路改成不稳定的纯 LLM 识别。
        </p>
      </div>

      <div className="mt-6 rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <FolderOpen size={16} />
          <span className="text-slate-500">资源库路径</span>
          <span className="font-mono text-slate-300">{libraryStatus.path}</span>
          <Clock size={14} className="ml-4" />
          <span className="text-slate-500">处理器</span>
          <span className={stats?.isRunning ? 'text-emerald-400' : 'text-slate-400'}>
            {stats?.isRunning ? '运行中' : '已停止'}
          </span>
        </div>
      </div>
    </div>
  );
}
