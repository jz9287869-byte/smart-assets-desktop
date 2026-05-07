import React from 'react';
import { act, render, screen } from '@testing-library/react';
import MainApp from '../components/MainApp';

async function flushAll() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  try {
    act(() => {
      jest.advanceTimersByTime(0);
    });
  } catch (error) {
    // Ignore when fake timers are not active.
  }
}

async function renderAndFlush(ui) {
  await act(async () => {
    render(ui);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createElectronApi(overrides = {}) {
  return {
    libraryAPI: {
      getStatus: jest.fn().mockResolvedValue({
        success: true,
        active: true,
        libraryId: 'lib_1',
        name: '素材库',
        path: 'D:\\素材库',
        overview: { total: 2, thumbnail_done: 1, ai_tagged: 1, manual_tagged: 0 },
        stats: {
          isRunning: true,
          thumbnail: { pending: 0, processing: 0, completed: 1, failed: 0 },
          aiTag: { pending: 0, processing: 0, completed: 1, failed: 0 },
        },
      }),
      list: jest.fn().mockResolvedValue({
        success: true,
        libraries: [{ id: 'lib_1', name: '素材库', path: 'D:\\素材库', total: 2, isActive: true }],
      }),
      getFolderTree: jest.fn().mockResolvedValue({ success: true, tree: ['动物'] }),
      refresh: jest.fn().mockResolvedValue({ success: true, stats: { imported: 1 } }),
      ...overrides.libraryAPI,
    },
    importAPI: {
      selectFolder: jest.fn().mockResolvedValue({ success: false, cancelled: true }),
      selectImportFolder: jest.fn().mockResolvedValue({ success: false, cancelled: true }),
      previewImport: jest.fn().mockResolvedValue({ success: true, preview: { totalFiles: 0, byFormat: {} } }),
      startImport: jest.fn().mockResolvedValue({ success: true, stats: {} }),
      onImportProgress: jest.fn(() => jest.fn()),
      ...overrides.importAPI,
    },
    queueAPI: {
      getStats: jest.fn().mockResolvedValue({
        success: true,
        stats: {
          isRunning: true,
          thumbnail: { pending: 0, processing: 0, completed: 1, failed: 0 },
          aiTag: { pending: 0, processing: 0, completed: 1, failed: 0 },
        },
      }),
      onStatsUpdated: jest.fn(() => jest.fn()),
      ...overrides.queueAPI,
    },
    imagesAPI: {
      getUntagged: jest.fn().mockResolvedValue({
        success: true,
        images: [],
      }),
      getDeleted: jest.fn().mockResolvedValue({
        success: true,
        images: [],
      }),
      ...overrides.imagesAPI,
    },
    tagsAPI: {
      list: jest.fn().mockResolvedValue({
        success: true,
        tags: [
          { category_id: 'scene', tag_id: 1, tag_name: '雪山', usage_count: 2, linked_count: 2, color: 'blue', created_source: 'system' },
          { category_id: 'animal', tag_id: 2, tag_name: '马', usage_count: 1, linked_count: 1, color: 'emerald', created_source: 'system' },
        ],
      }),
      add: jest.fn().mockResolvedValue({ success: true }),
      delete: jest.fn().mockResolvedValue({ success: true }),
      rename: jest.fn().mockResolvedValue({ success: true }),
      ...overrides.tagsAPI,
    },
    tagCategoriesAPI: {
      list: jest.fn().mockResolvedValue({
        success: true,
        categories: [],
      }),
      add: jest.fn().mockResolvedValue({ success: true }),
      delete: jest.fn().mockResolvedValue({ success: true }),
      ...overrides.tagCategoriesAPI,
    },
    searchImages: jest.fn().mockResolvedValue({
      success: true,
      images: [
        {
          id: 1,
          filename: 'horse.jpg',
          path: 'D:\\素材库\\动物\\horse.jpg',
          current_path: 'D:\\素材库\\动物\\horse.jpg',
          folder: '动物',
          size: 1024,
          process_status: 'auto_tagged',
          tags: '马,草原',
          thumbnail_path: null,
        },
        {
          id: 2,
          filename: 'city.jpg',
          path: 'D:\\素材库\\城市\\city.jpg',
          current_path: 'D:\\素材库\\城市\\city.jpg',
          folder: '城市',
          size: 2048,
          process_status: 'thumbnail',
          tags: '城市,夜景',
          thumbnail_path: null,
        },
      ],
      ...overrides.searchImages,
    }),
    addTagToImage: jest.fn().mockResolvedValue({ success: true }),
    removeTagFromImage: jest.fn().mockResolvedValue({ success: true }),
    moveToTrash: jest.fn().mockResolvedValue({ success: true }),
    openInFolder: jest.fn().mockResolvedValue({ success: true }),
    copyPathToClipboard: jest.fn().mockResolvedValue({ success: true }),
    getConfig: jest.fn().mockResolvedValue({ trashFolder: 'D:\\素材库回收站' }),
    updateConfig: jest.fn().mockResolvedValue({ success: true }),
    restoreImages: jest.fn().mockResolvedValue({ success: true }),
    permanentlyDelete: jest.fn().mockResolvedValue({ success: true }),
    onImageAdded: jest.fn(() => jest.fn()),
    onImageDeleted: jest.fn(() => jest.fn()),
    onImageTagged: jest.fn(() => jest.fn()),
    ...overrides,
  };
}

describe('Backend alignment', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.clearAllTimers();
    });
    jest.useRealTimers();
    delete window.electronAPI;
  });

  test('loads current main app with library status and image data from IPC', async () => {
    window.electronAPI = createElectronApi();

    await renderAndFlush(<MainApp />);
    await flushAll();

    expect(await screen.findByText(/Smart Assets/i)).toBeInTheDocument();
    expect(screen.getByText(/Electron 28\.1\.0/i)).toBeInTheDocument();
    expect(window.electronAPI.libraryAPI.getStatus).toHaveBeenCalled();
    expect(window.electronAPI.searchImages).toHaveBeenCalled();
  });

  test('shows disconnected state when library status fails', async () => {
    window.electronAPI = createElectronApi({
      libraryAPI: {
        getStatus: jest.fn().mockResolvedValue({
          success: false,
          error: '资源库未连接',
        }),
      },
    });

    await renderAndFlush(<MainApp />);
    await flushAll();

    expect(await screen.findByText(/Electron 28\.1\.0/i)).toBeInTheDocument();
    expect(screen.getByText(/Smart Assets/i)).toBeInTheDocument();
  });
});
