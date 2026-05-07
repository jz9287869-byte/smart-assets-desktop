import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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

function createElectronApi() {
  const cleanups = {
    importProgress: jest.fn(),
    statsUpdated: jest.fn(),
    imageAdded: jest.fn(),
    imageDeleted: jest.fn(),
    imageTagged: jest.fn(),
  };

  return {
    __cleanups: cleanups,
    libraryAPI: {
      getStatus: jest.fn().mockResolvedValue({
        success: true,
        active: true,
        libraryId: 'lib_main',
        name: 'Main Library',
        path: 'D:\\Asset Library',
        overview: { total: 18, thumbnail_done: 14, ai_tagged: 9, manual_tagged: 2 },
        stats: {
          isRunning: true,
          thumbnail: { pending: 0, processing: 0, completed: 14, failed: 0 },
          aiTag: { pending: 0, processing: 1, completed: 9, failed: 0 },
          vectorBackfill: { enabled: true, running: false, missing: 6, computed: 2, modelPreloaded: true },
        },
      }),
      list: jest.fn().mockResolvedValue({
        success: true,
        libraries: [
          { id: 'lib_main', name: 'Main Library', path: 'D:\\Asset Library', total: 18, isActive: true },
          { id: 'lib_alt', name: 'Spring Route', path: 'D:\\Spring Route', total: 3, isActive: false },
        ],
      }),
      create: jest.fn().mockResolvedValue({ success: true, library: { id: 'lib_new' } }),
      switch: jest.fn().mockResolvedValue({ success: true }),
      delete: jest.fn().mockResolvedValue({ success: true }),
      getFolderTree: jest.fn().mockResolvedValue({
        success: true,
        tree: ['Spring Route', 'Animals/Horses', 'Cities/Shanghai'],
      }),
      refresh: jest.fn().mockResolvedValue({ success: true, stats: { imported: 1 } }),
    },
    importAPI: {
      selectFolder: jest.fn().mockResolvedValue({ success: true, path: 'D:\\Selected Folder' }),
      selectImportFolder: jest.fn().mockResolvedValue({ success: true, path: 'D:\\Selected Folder' }),
      previewImport: jest.fn().mockResolvedValue({
        success: true,
        preview: { totalFiles: 3, totalSize: 4096, byFormat: { jpg: 2, png: 1 } },
      }),
      startImport: jest.fn().mockResolvedValue({
        success: true,
        stats: { imported: 3, skipped: 0, errors: 0 },
      }),
      onImportProgress: jest.fn(() => cleanups.importProgress),
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
      onStatsUpdated: jest.fn(() => cleanups.statsUpdated),
    },
    imagesAPI: {
      getUntagged: jest.fn().mockResolvedValue({
        success: true,
        images: [
          { id: 41, filename: 'queued.jpg', path: 'D:\\Asset Library\\queued.jpg', thumbnail_path: null, format: 'jpg' },
        ],
      }),
      getDeleted: jest.fn().mockResolvedValue({
        success: true,
        images: [
          { id: 99, filename: 'deleted.jpg', path: 'D:\\Trash\\deleted.jpg', size: 512, tags: 'recycle' },
        ],
      }),
    },
    tagsAPI: {
      list: jest.fn().mockResolvedValue({
        success: true,
        tags: [
          { category_id: 'scene', tag_id: 1, tag_name: 'Grassland', usage_count: 2, linked_count: 2, created_source: 'system' },
          { category_id: 'animal', tag_id: 2, tag_name: 'Horse', usage_count: 1, linked_count: 1, created_source: 'system' },
          { category_id: 'travel', tag_id: 3, tag_name: 'Roadtrip', usage_count: 1, linked_count: 1, created_source: 'manual' },
        ],
      }),
      add: jest.fn().mockResolvedValue({ success: true }),
      delete: jest.fn().mockResolvedValue({ success: true }),
      rename: jest.fn().mockResolvedValue({ success: true }),
    },
    tagCategoriesAPI: {
      list: jest.fn().mockResolvedValue({
        success: true,
        categories: [{ id: 'travel', name: 'Travel', sort_order: 120, is_system: 0 }],
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
          path: 'D:\\Asset Library\\Animals\\horse.jpg',
          current_path: 'D:\\Asset Library\\Animals\\horse.jpg',
          folder: 'Animals',
          size: 1024,
          process_status: 'auto_tagged',
          tags: 'Horse,Grassland',
        },
        {
          id: 2,
          filename: 'city.jpg',
          path: 'D:\\Asset Library\\Cities\\city.jpg',
          current_path: 'D:\\Asset Library\\Cities\\city.jpg',
          folder: 'Cities',
          size: 2048,
          process_status: 'thumbnail',
          tags: 'City,Night',
        },
      ],
    }),
    naturalSearchImages: jest.fn().mockResolvedValue({
      success: true,
      mode: 'strict',
      total: 1,
      candidateCount: 2,
      vectorSearchApplied: true,
      vectorCoverage: { available: 1, total: 1, computed: 0 },
      intent: {
        requiredTags: ['女性', '单人', '草原'],
        implicitTags: ['人物'],
        excludedTags: ['多人'],
        notes: ['已识别 3 个检索条件', '仅显示同时满足全部条件的图片'],
      },
      images: [
        {
          id: 30,
          filename: 'query-result.jpg',
          path: 'D:\\Asset Library\\query-result.jpg',
          current_path: 'D:\\Asset Library\\query-result.jpg',
          folder: 'Search',
          size: 1024,
          process_status: 'auto_tagged',
          tags: '女性,单人,草原',
          natural_search_score: 88,
          natural_search_summary: ['命中条件: 女性 / 单人 / 草原'],
        },
      ],
    }),
    batchAiTagging: jest.fn().mockResolvedValue({ success: true }),
    addTagToImage: jest.fn().mockResolvedValue({ success: true }),
    removeTagFromImage: jest.fn().mockResolvedValue({ success: true }),
    moveToTrash: jest.fn().mockResolvedValue({ success: true }),
    openInFolder: jest.fn().mockResolvedValue({ success: true }),
    copyPathToClipboard: jest.fn().mockResolvedValue({ success: true }),
    getConfig: jest.fn().mockResolvedValue({ trashFolder: 'D:\\Recycle Bin' }),
    updateConfig: jest.fn().mockResolvedValue({ success: true }),
    restoreImages: jest.fn().mockResolvedValue({ success: true }),
    permanentlyDelete: jest.fn().mockResolvedValue({ success: true, archiveDir: 'D:\\Recycle Bin\\2026-03-24删除图片记录' }),
    onImageAdded: jest.fn(() => cleanups.imageAdded),
    onImageDeleted: jest.fn(() => cleanups.imageDeleted),
    onImageTagged: jest.fn(() => cleanups.imageTagged),
  };
}

function getSidebarButtons() {
  const sidebar = screen.getByText(/Smart Assets/i).closest('div[class*="border-b"]')?.parentElement?.parentElement;
  return within(sidebar).getAllByRole('button').slice(0, 8);
}

describe('Eight-menu regression', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sessionStorage.clear();
    localStorage.clear();
    window.alert = jest.fn();
    window.confirm = jest.fn(() => true);
    window.electronAPI = createElectronApi();
  });

  afterEach(() => {
    act(() => {
      jest.clearAllTimers();
    });
    jest.useRealTimers();
    delete window.electronAPI;
  });

  test('mounts all eight menu modules and reaches each module shell successfully', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderAndFlush(<MainApp />);

    const menuButtons = getSidebarButtons();
    expect(menuButtons).toHaveLength(8);

    await clickAndFlush(user, menuButtons[0]);
    expect((await screen.findAllByText(/Main Library/i)).length).toBeGreaterThan(0);

    await clickAndFlush(user, menuButtons[1]);
    expect(await screen.findByText(/导入图片/i)).toBeInTheDocument();

    await clickAndFlush(user, menuButtons[2]);
    expect(await screen.findByText(/horse\.jpg/i)).toBeInTheDocument();

    await clickAndFlush(user, menuButtons[3]);
    expect(await screen.findByText(/按完整条件筛出真正匹配的图片/i)).toBeInTheDocument();

    sessionStorage.setItem(
      'batch-tagging:selectedImages:lib_main',
      JSON.stringify([{ id: 41, filename: 'queued.jpg', path: 'D:\\Asset Library\\queued.jpg' }])
    );
    act(() => {
      window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'batch-tagging' } }));
    });
    await flush();
    expect(await screen.findByText(/queued\.jpg/i)).toBeInTheDocument();

    await clickAndFlush(user, menuButtons[5]);
    expect(await screen.findByText(/Travel/i)).toBeInTheDocument();

    await clickAndFlush(user, menuButtons[6]);
    expect(await screen.findByText(/deleted\.jpg/i)).toBeInTheDocument();

    await clickAndFlush(user, menuButtons[7]);
    expect(await screen.findByText(/语义向量预热/i)).toBeInTheDocument();
    expect(screen.getByText(/Gemma \/ 云端标签复核/i)).toBeInTheDocument();

    expect(screen.getByText(/Smart Assets/i)).toBeInTheDocument();
    expect(screen.getByText(/Electron 28\.1\.0/i)).toBeInTheDocument();
  });

  test('keeps image-browser selection stable across menu switching and batch tagging', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    sessionStorage.setItem(
      'batch-tagging:selectedImages:lib_main',
      JSON.stringify([{ id: 1, filename: 'horse.jpg', path: 'D:\\Asset Library\\Animals\\horse.jpg' }])
    );

    await renderAndFlush(<MainApp />);

    const menuButtons = getSidebarButtons();
    await clickAndFlush(user, menuButtons[2]);
    await clickAndFlush(user, menuButtons[6]);
    await clickAndFlush(user, menuButtons[2]);
    await clickAndFlush(user, menuButtons[4]);

    expect(await screen.findByText(/horse\.jpg/i)).toBeInTheDocument();
    expect(screen.getAllByText(/horse\.jpg/i)).toHaveLength(1);
  });

  test('aggressive menu switching does not crash and keeps app shell mounted', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderAndFlush(<MainApp />);

    const menuButtons = getSidebarButtons();

    for (let round = 0; round < 4; round += 1) {
      for (const button of menuButtons) {
        await clickAndFlush(user, button);
        act(() => {
          jest.advanceTimersByTime(40);
        });
      }
    }

    expect(screen.getByText(/Smart Assets/i)).toBeInTheDocument();
    expect(screen.queryByText(/页面加载失败/i)).not.toBeInTheDocument();
  });

  test('unmounting menus cleans core subscriptions and polling listeners', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderAndFlush(<MainApp />);

    const menuButtons = getSidebarButtons();

    await clickAndFlush(user, menuButtons[1]);
    await clickAndFlush(user, menuButtons[2]);
    await clickAndFlush(user, menuButtons[3]);
    await clickAndFlush(user, menuButtons[4]);
    await clickAndFlush(user, menuButtons[5]);
    await clickAndFlush(user, menuButtons[6]);
    await clickAndFlush(user, menuButtons[7]);
    await clickAndFlush(user, menuButtons[0]);

    await waitFor(() => {
      expect(window.electronAPI.importAPI.onImportProgress).toHaveBeenCalled();
      expect(window.electronAPI.queueAPI.onStatsUpdated).toHaveBeenCalled();
      expect(window.electronAPI.onImageAdded).toHaveBeenCalled();
      expect(window.electronAPI.onImageDeleted).toHaveBeenCalled();
      expect(window.electronAPI.onImageTagged).toHaveBeenCalled();
      expect(window.electronAPI.__cleanups.importProgress).toHaveBeenCalled();
      expect(window.electronAPI.__cleanups.statsUpdated).toHaveBeenCalled();
      expect(window.electronAPI.__cleanups.imageAdded).toHaveBeenCalled();
      expect(window.electronAPI.__cleanups.imageDeleted).toHaveBeenCalled();
      expect(window.electronAPI.__cleanups.imageTagged).toHaveBeenCalled();
    });
  });
});
