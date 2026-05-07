import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MainApp from '../components/MainApp';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderAndFlush(ui) {
  await act(async () => {
    render(ui);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function clickAndFlush(user, element) {
  await act(async () => {
    await user.click(element);
  });
  await flush();
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
        overview: { total: 3, thumbnail_done: 2, ai_tagged: 1, manual_tagged: 0 },
        stats: {
          isRunning: true,
          thumbnail: { pending: 0, processing: 0, completed: 2, failed: 0 },
          aiTag: { pending: 0, processing: 0, completed: 1, failed: 0 },
        },
      }),
      list: jest.fn().mockResolvedValue({
        success: true,
        libraries: [{ id: 'lib_1', name: '素材库', path: 'D:\\素材库', total: 3, isActive: true }],
      }),
      switch: jest.fn().mockResolvedValue({ success: true }),
      getFolderTree: jest.fn().mockResolvedValue({
        success: true,
        tree: ['动物', '城市'],
      }),
      refresh: jest.fn().mockResolvedValue({ success: true, stats: { imported: 1 } }),
      create: jest.fn().mockResolvedValue({ success: true }),
      delete: jest.fn().mockResolvedValue({ success: true }),
    },
    importAPI: {
      selectFolder: jest.fn().mockResolvedValue({ success: false, cancelled: true }),
      selectImportFolder: jest.fn().mockResolvedValue({ success: false, cancelled: true }),
      previewImport: jest.fn().mockResolvedValue({ success: true, preview: { totalFiles: 0, byFormat: {} } }),
      startImport: jest.fn().mockResolvedValue({ success: true, stats: {} }),
      onImportProgress: jest.fn(() => jest.fn()),
    },
    queueAPI: {
      getStats: jest.fn().mockResolvedValue({
        success: true,
        stats: {
          isRunning: true,
          thumbnail: { pending: 0, processing: 0, completed: 2, failed: 0 },
          aiTag: { pending: 0, processing: 0, completed: 1, failed: 0 },
        },
      }),
      onStatsUpdated: jest.fn(() => jest.fn()),
    },
    imagesAPI: {
      getUntagged: jest.fn().mockResolvedValue({
        success: true,
        images: [{ id: 1, filename: 'horse.jpg', path: 'D:\\素材库\\动物\\horse.jpg', thumbnail_path: null, format: 'jpg' }],
      }),
      getDeleted: jest.fn().mockResolvedValue({
        success: true,
        images: [{ id: 99, filename: 'deleted.jpg', size: 512, tags: '动物' }],
      }),
    },
    tagsAPI: {
      list: jest.fn().mockResolvedValue({
        success: true,
        tags: [
          { category_id: 'scene', tag_id: 1, tag_name: '草原', usage_count: 2, linked_count: 2, created_source: 'system' },
          { category_id: 'animal', tag_id: 2, tag_name: '马', usage_count: 1, linked_count: 1, created_source: 'system' },
        ],
      }),
      add: jest.fn().mockResolvedValue({ success: true }),
      delete: jest.fn().mockResolvedValue({ success: true }),
      rename: jest.fn().mockResolvedValue({ success: true }),
    },
    tagCategoriesAPI: {
      list: jest.fn().mockResolvedValue({
        success: true,
        categories: [],
      }),
      add: jest.fn().mockResolvedValue({ success: true }),
      delete: jest.fn().mockResolvedValue({ success: true }),
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
        },
      ],
    }),
    naturalSearchImages: jest.fn().mockResolvedValue({
      success: true,
      mode: 'strict',
      total: 1,
      candidateCount: 3,
      intent: {
        requiredTags: ['单人', '女性', '新疆', '草原'],
        implicitTags: ['人物'],
        excludedTags: ['多人'],
        notes: ['已识别 4 个检索条件'],
      },
      images: [
        {
          id: 3,
          filename: 'xinjiang-girl.jpg',
          path: 'D:\\素材库\\新疆\\xinjiang-girl.jpg',
          current_path: 'D:\\素材库\\新疆\\xinjiang-girl.jpg',
          folder: '新疆',
          size: 4096,
          process_status: 'auto_tagged',
          tags: '女性,单人,新疆,草原',
          natural_search_score: 98,
          natural_search_summary: ['命中条件: 单人 / 女性 / 新疆 / 草原'],
        },
      ],
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
  };
}

describe('MainApp navigation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.electronAPI = createElectronApi();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    delete window.electronAPI;
  });

  test('can switch between primary menu pages without crashing', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderAndFlush(<MainApp />);

    const sidebar = screen.getByText(/Smart Assets/i).closest('div[class*="border-b"]')?.parentElement?.parentElement;
    const scope = sidebar ? within(sidebar) : screen;

    const menuTargets = [
      /资源库/i,
      /导入/i,
      /图片浏览/i,
      /自然语言搜图/i,
      /标签管理/i,
      /回收站/i,
    ];

    for (const label of menuTargets) {
      const button = scope.getByRole('button', { name: label });
      await clickAndFlush(user, button);
    }

    expect(screen.getByText(/Smart Assets/i)).toBeInTheDocument();
    expect(screen.getByText(/Electron 28\.1\.0/i)).toBeInTheDocument();
  });
});
