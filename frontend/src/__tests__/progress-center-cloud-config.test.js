import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProgressCenter from '../components/ProgressCenter';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createElectronApi() {
  return {
    libraryAPI: {
      getStatus: jest.fn().mockResolvedValue({
        success: true,
        active: true,
        libraryId: 'lib_1',
        name: '素材库',
        path: 'D:\\素材库',
        overview: { total: 18, thumbnail_done: 14, ai_tagged: 9, manual_tagged: 0 },
      }),
    },
    queueAPI: {
      getStats: jest.fn().mockResolvedValue({
        success: true,
        stats: {
          isRunning: true,
          thumbnail: { pending: 0, processing: 0, completed: 14, failed: 0 },
          aiTag: { pending: 0, processing: 1, completed: 9, failed: 0 },
          vectorBackfill: { enabled: true, running: false, missing: 6, computed: 2, modelPreloaded: true },
        },
      }),
      onStatsUpdated: jest.fn(() => jest.fn()),
    },
    aiAPI: {
      getCloudReviewConfig: jest.fn().mockResolvedValue({
        success: true,
        enabled: true,
        provider: 'openai_compatible',
        baseURL: 'http://127.0.0.1:11434/v1',
        model: 'gemma4:e2b',
        hasApiKey: false,
      }),
      setCloudReviewConfig: jest.fn().mockResolvedValue({
        success: true,
        enabled: true,
        provider: 'openai_compatible',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        hasApiKey: true,
      }),
    },
  };
}

describe('ProgressCenter cloud review config', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.electronAPI = createElectronApi();
  });

  afterEach(() => {
    act(() => {
      jest.clearAllTimers();
    });
    jest.useRealTimers();
    delete window.electronAPI;
  });

  test('keeps unsaved service and model edits while status polling continues', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    await act(async () => {
      render(<ProgressCenter />);
    });
    await flush();

    const selects = await screen.findAllByRole('combobox');
    const serviceSelect = selects[0];
    const providerSelect = selects[1];
    const modelSelect = selects[2];

    expect(serviceSelect).toHaveValue('ollama_local');
    expect(providerSelect).toHaveValue('openai_compatible');
    expect(modelSelect).toHaveValue('gemma4:e2b');

    await act(async () => {
      await user.selectOptions(serviceSelect, 'openai');
    });
    await flush();

    expect(serviceSelect).toHaveValue('openai');
    expect(providerSelect).toHaveValue('openai_compatible');

    await act(async () => {
      await user.selectOptions(modelSelect, 'gpt-4o-mini');
    });
    await flush();

    expect(modelSelect).toHaveValue('gpt-4o-mini');
    expect(screen.getByDisplayValue('gpt-4o-mini')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(6000);
    });
    await flush();

    expect(serviceSelect).toHaveValue('openai');
    expect(providerSelect).toHaveValue('openai_compatible');
    expect(screen.getByDisplayValue('https://api.openai.com/v1')).toBeInTheDocument();
    expect(modelSelect).toHaveValue('gpt-4o-mini');
    expect(screen.getByDisplayValue('gpt-4o-mini')).toBeInTheDocument();
    expect(window.electronAPI.aiAPI.getCloudReviewConfig).toHaveBeenCalledTimes(1);
  });
});
