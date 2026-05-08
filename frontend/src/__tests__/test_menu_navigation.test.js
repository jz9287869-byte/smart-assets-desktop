import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MainApp from '../components/MainApp';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  try {
    act(() => {
      jest.advanceTimersByTime(0);
    });
  } catch (error) {
    // ignore when fake timers are not active
  }
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

async function typeAndFlush(user, element, value) {
  await act(async () => {
    await user.type(element, value);
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
        overview: { total: 18, thumbnail_done: 14, ai_tagged: 9, manual_tagged: 0 },
        stats: {
          isRunning: true,
          thumbnail: { pending: 0, processing: 0, completed: 14, failed: 0 },
          aiTag: { pending: 0, processing: 1, completed: 9, failed: 0 },
          vectorBackfill: { enabled: true, running: false, missing: 6, computed: 2, modelPreloaded: true },
        },
      }),
      list: jest.fn().mockResolvedValue({
        success: true,
        libraries: [{ id: 'lib_1', name: '素材库', path: 'D:\\素材库', total: 18, isActive: true }],
      }),
      switch: jest.fn().mockResolvedValue({ success: true }),
      create: jest.fn().mockResolvedValue({ success: true }),
      delete: jest.fn().mockResolvedValue({ success: true }),
      getFolderTree: jest.fn().mockResolvedValue({
        success: true,
        tree: ['动物', '城市/上海', '城市/北京'],
      }),
      refresh: jest.fn().mockResolvedValue({ success: true, stats: { imported: 1 } }),
    },
    importAPI: {
      selectImportFolder: jest.fn().mockResolvedValue({ success: false, cancelled: true }),
      selectFolder: jest.fn().mockResolvedValue({ success: false, cancelled: true }),
      previewImport: jest.fn().mockResolvedValue({
        success: true,
        preview: { totalFiles: 0, totalSize: 0, byFormat: {} },
      }),
      startImport: jest.fn().mockResolvedValue({
        success: true,
        stats: { imported: 0, skipped: 0, errors: 0 },
      }),
      onImportProgress: jest.fn(() => jest.fn()),
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
    imagesAPI: {
      getUntagged: jest.fn().mockResolvedValue({
        success: true,
        images: [{ id: 1, filename: 'horse.jpg', path: 'D:\\素材库\\动物\\horse.jpg', format: 'jpg' }],
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
      list: jest.fn().mockResolvedValue({ success: true, categories: [] }),
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
      ],
    }),
    naturalSearchImages: jest.fn().mockResolvedValue({
      success: true,
      mode: 'strict',
      total: 1,
      candidateCount: 4,
      vectorSearchApplied: true,
      vectorCoverage: { available: 1, total: 1, computed: 0 },
      intent: {
        requiredTags: ['单人', '女性', '新疆', '草原'],
        implicitTags: ['人物'],
        excludedTags: ['多人'],
        notes: ['已识别 4 个检索条件', '仅显示同时满足全部条件的图片'],
      },
      images: [
        {
          id: 88,
          filename: 'grassland-girl.jpg',
          path: 'D:\\素材库\\新疆\\grassland-girl.jpg',
          current_path: 'D:\\素材库\\新疆\\grassland-girl.jpg',
          folder: '新疆',
          size: 2048,
          process_status: 'auto_tagged',
          tags: '女性,单人,新疆,草原',
          natural_search_score: 96,
          natural_search_summary: ['命中条件: 单人 / 女性 / 新疆 / 草原'],
        },
      ],
    }),
    batchAiTagging: jest.fn().mockResolvedValue({ success: true }),
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

describe('menu navigation smoke', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sessionStorage.clear();
    localStorage.clear();
    window.electronAPI = createElectronApi();
  });

  afterEach(() => {
    act(() => {
      jest.clearAllTimers();
    });
    jest.useRealTimers();
    delete window.electronAPI;
  });

  test('rapidly switches across all eight main menus without crashing or losing app shell', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderAndFlush(<MainApp />);

    const sidebar = screen.getByText(/Smart Assets/i).closest('div[class*="border-b"]')?.parentElement?.parentElement;
    const menuButtons = within(sidebar).getAllByRole('button').slice(0, 8);
    expect(menuButtons).toHaveLength(8);

    for (let round = 0; round < 3; round += 1) {
      for (const button of menuButtons) {
        await clickAndFlush(user, button);
        act(() => {
          jest.advanceTimersByTime(45);
        });
      }
    }

    expect(screen.getByText(/Smart Assets/i)).toBeInTheDocument();
    expect(screen.getByText(/Electron 28\.1\.0/i)).toBeInTheDocument();
    expect(screen.queryByText(/页面加载失败/i)).not.toBeInTheDocument();
  });

  test('image browser batch selection survives menu switching and does not duplicate on return', async () => {
    sessionStorage.setItem(
      'batch-tagging:selectedImages:lib_1',
      JSON.stringify([{ id: 1, filename: 'horse.jpg', path: 'D:\\素材库\\动物\\horse.jpg' }])
    );

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderAndFlush(<MainApp />);

    const sidebar = screen.getByText(/Smart Assets/i).closest('div[class*="border-b"]')?.parentElement?.parentElement;
    const menuButtons = within(sidebar).getAllByRole('button').slice(0, 8);

    await clickAndFlush(user, menuButtons[2]);
    await clickAndFlush(user, menuButtons[6]);
    await clickAndFlush(user, menuButtons[2]);
    await clickAndFlush(user, menuButtons[4]);

    const selectedTitle = await screen.findByText(/当前选中 1 张图片/i);
    expect(selectedTitle).toBeInTheDocument();

    const cards = screen.getAllByText(/horse\.jpg/i);
    expect(cards.length).toBe(1);
  });

  test('natural language page requires clicking the search button before submitting', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderAndFlush(<MainApp />);

    const sidebar = screen.getByText(/Smart Assets/i).closest('div[class*="border-b"]')?.parentElement?.parentElement;
    const scope = within(sidebar);

    await clickAndFlush(user, scope.getByRole('button', { name: /自然语言搜图/i }));
    await typeAndFlush(user, screen.getAllByRole('textbox')[0], '新疆');
    await clickAndFlush(user, screen.getByRole('button', { name: /找一张单人女生/i }));

    expect(window.electronAPI.naturalSearchImages).not.toHaveBeenCalled();

    await clickAndFlush(user, screen.getByRole('button', { name: /开始搜图/i }));

    expect(window.electronAPI.naturalSearchImages).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.stringContaining('单人女生'),
      folderName: '新疆',
      limit: 24,
      offset: 0,
    }));
    expect(await screen.findByText(/grassland-girl\.jpg/i)).toBeInTheDocument();
    expect(screen.getByText(/命中条件/i)).toBeInTheDocument();
  });
});
