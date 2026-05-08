import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TrashView from '../components/TrashView';
import TagManager from '../components/TagManager';
import ImageBrowser from '../components/ImageBrowser';
import BatchTaggingTool from '../components/BatchTaggingTool';
import ImportWizard from '../components/ImportWizard';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderAndFlush(ui) {
  let result;
  await act(async () => {
    result = render(ui);
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
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

function createElectronApi(overrides = {}) {
  return {
    libraryAPI: {
      getStatus: jest.fn().mockResolvedValue({
        success: true,
        active: true,
        libraryId: 'default',
        name: '素材库',
        path: 'D:\\素材库',
        overview: { total: 2 },
        stats: { isRunning: true },
      }),
      getFolderTree: jest.fn().mockResolvedValue({
        success: true,
        tree: ['动物', '城市'],
      }),
      refresh: jest.fn().mockResolvedValue({
        success: true,
        stats: { imported: 1 },
      }),
      cleanupPeopleMislabels: jest.fn().mockResolvedValue({
        success: true,
        candidates: 2,
        queued: 2,
      }),
      ...overrides.libraryAPI,
    },
    importAPI: {
      selectFolder: jest.fn().mockResolvedValue({
        success: true,
        path: 'D:\\新回收站',
      }),
      selectImportFolder: jest.fn().mockResolvedValue({
        success: true,
        path: 'D:\\春天路线',
      }),
      previewImport: jest.fn().mockResolvedValue({
        success: true,
        preview: {
          totalFiles: 3,
          totalSize: 340697,
          byFormat: { jpg: 2, jpeg: 1 },
        },
      }),
      startImport: jest.fn().mockResolvedValue({
        success: true,
        stats: { imported: 3, skipped: 0, errors: 0 },
      }),
      onImportProgress: jest.fn(() => jest.fn()),
      ...overrides.importAPI,
    },
    imagesAPI: {
      getDeleted: jest.fn().mockResolvedValue({
        success: true,
        images: [{ id: 91, filename: 'deleted.jpg', size: 512, tags: '动物' }],
      }),
      getUntagged: jest.fn().mockResolvedValue({
        success: true,
        images: [],
      }),
      getUntaggedIds: jest.fn().mockResolvedValue({
        success: true,
        ids: [],
      }),
      ...overrides.imagesAPI,
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
      ...overrides.searchImages,
    }),
    tagsAPI: {
      list: jest.fn().mockResolvedValue({
        success: true,
        tags: [],
      }),
      delete: jest.fn().mockResolvedValue({ success: true }),
      add: jest.fn().mockResolvedValue({ success: true }),
      rename: jest.fn().mockResolvedValue({ success: true }),
      ...overrides.tagsAPI,
    },
    tagCategoriesAPI: {
      list: jest.fn().mockResolvedValue({
        success: true,
        categories: [{ id: 'travel', name: '旅行灵感', sort_order: 120, is_system: 0 }],
      }),
      delete: jest.fn().mockResolvedValue({ success: true }),
      add: jest.fn().mockResolvedValue({ success: true }),
      ...overrides.tagCategoriesAPI,
    },
    updateConfig: jest.fn().mockResolvedValue({ success: true }),
    getConfig: jest.fn().mockResolvedValue({ trashFolder: 'D:\\旧回收站' }),
    restoreImages: jest.fn().mockResolvedValue({ success: true }),
    permanentlyDelete: jest.fn().mockResolvedValue({ success: true }),
    moveToTrash: jest.fn().mockResolvedValue({ success: true }),
    openInFolder: jest.fn().mockResolvedValue({ success: true }),
    copyPathToClipboard: jest.fn().mockResolvedValue({ success: true }),
    addTagToImage: jest.fn().mockResolvedValue({ success: true }),
    removeTagFromImage: jest.fn().mockResolvedValue({ success: true }),
    onImageAdded: jest.fn(),
    onImageDeleted: jest.fn(),
    onImageTagged: jest.fn(),
    ...overrides,
  };
}

describe('Feature workflows', () => {
  const originalAlert = window.alert;
  const originalConfirm = window.confirm;

  beforeEach(() => {
    window.alert = jest.fn();
    window.confirm = jest.fn(() => true);
    sessionStorage.clear();
  });

  afterEach(() => {
    window.alert = originalAlert;
    window.confirm = originalConfirm;
    delete window.electronAPI;
  });

  test('trash view can choose and save trash folder path', async () => {
    const api = createElectronApi();
    window.electronAPI = api;
    const user = userEvent.setup();

    await renderAndFlush(<TrashView showToast={jest.fn()} />);

    await clickAndFlush(user, screen.getByRole('button', { name: /选择目录/i }));
    await screen.findByDisplayValue('D:\\新回收站');
    await clickAndFlush(user, screen.getByRole('button', { name: /保存路径/i }));

    await waitFor(() => {
      expect(api.importAPI.selectFolder).toHaveBeenCalled();
      expect(api.updateConfig).toHaveBeenCalledWith({ trashFolder: 'D:\\新回收站' });
    });
  });

  test('tag manager keeps fixed categories and supports deleting custom category', async () => {
    const api = createElectronApi();
    window.electronAPI = api;

    const { container } = await renderAndFlush(<TagManager showToast={jest.fn()} />);

    await waitFor(() => {
      expect(api.tagCategoriesAPI.list).toHaveBeenCalled();
      expect(api.tagsAPI.list).toHaveBeenCalled();
    });

    for (const label of ['场景', '地点', '人物', '颜色', '动物', '设备', '活动', '自定义', '旅行灵感']) {
      const matches = await screen.findAllByText(new RegExp(label));
      expect(matches.length).toBeGreaterThan(0);
    }

    const deleteButton = container.querySelector('button[title*="旅行灵感"]');
    expect(deleteButton).not.toBeNull();

    await act(async () => {
      deleteButton.click();
    });
    await flush();

    await waitFor(() => {
      expect(api.tagCategoriesAPI.delete).toHaveBeenCalledWith({ categoryId: 'travel' });
    });
  });

  test('tag manager shows full system presets while keeping extra non-system tags manageable', async () => {
    const api = createElectronApi({
      tagsAPI: {
        list: jest.fn().mockResolvedValue({
          success: true,
          tags: [
            { category_id: 'scene', tag_id: 1, tag_name: 'Used System', linked_count: 2, created_source: 'system' },
            { category_id: 'scene', tag_id: 2, tag_name: 'Unused System', linked_count: 0, usage_count: 0, created_source: 'system' },
            { category_id: 'scene', tag_id: 3, tag_name: 'Extra AI', linked_count: 0, usage_count: 0, created_source: 'ai' },
          ],
        }),
      },
    });
    window.electronAPI = api;

    await renderAndFlush(<TagManager showToast={jest.fn()} />);

    expect(await screen.findByText('Used System')).toBeInTheDocument();
    expect(screen.getByText('Unused System')).toBeInTheDocument();
    expect(screen.getByText('Extra AI')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除标签 Extra AI' })).toBeInTheDocument();
  });

  test('image browser can refresh library and move selected image to trash', async () => {
    const api = createElectronApi();
    window.electronAPI = api;
    const user = userEvent.setup();

    await renderAndFlush(<ImageBrowser showToast={jest.fn()} storageScope="default" />);

    await clickAndFlush(user, screen.getByRole('button', { name: /刷新图片/i }));
    await waitFor(() => {
      expect(api.libraryAPI.refresh).toHaveBeenCalled();
    });

    await clickAndFlush(user, await screen.findByText(/horse\.jpg/i));
    await clickAndFlush(user, screen.getByRole('button', { name: /移至回收站/i }));

    await waitFor(() => {
      expect(api.moveToTrash).toHaveBeenCalledWith([1]);
    });
  });

  test('image browser can queue cleanup for people mislabels', async () => {
    const api = createElectronApi();
    window.electronAPI = api;
    const user = userEvent.setup();

    await renderAndFlush(<ImageBrowser showToast={jest.fn()} storageScope="default" />);

    await clickAndFlush(user, screen.getByRole('button', { name: /清理人物误标/i }));

    await waitFor(() => {
      expect(api.libraryAPI.cleanupPeopleMislabels).toHaveBeenCalled();
    });
  });

  test('batch tagging clear selection clears queued images from session', async () => {
    const api = createElectronApi();
    window.electronAPI = api;
    sessionStorage.setItem(
      'batch-tagging:selectedImages:default',
      JSON.stringify([{ id: 7, filename: 'queued.jpg', size: 256, path: 'D:\\素材库\\queued.jpg' }])
    );

    const user = userEvent.setup();
    await renderAndFlush(<BatchTaggingTool showToast={jest.fn()} storageScope="default" />);

    expect(await screen.findByText(/当前选中 1 张图片/i)).toBeInTheDocument();
    await clickAndFlush(user, screen.getByRole('button', { name: /清空选择/i }));

    await waitFor(() => {
      expect(screen.getByText(/当前选中 0 张图片/i)).toBeInTheDocument();
      expect(sessionStorage.getItem('batch-tagging:selectedImages:default')).toBe('[]');
    });
  });

  test('batch tagging reselects queued images after navigation replaces a stale selection', async () => {
    const api = createElectronApi({
      imagesAPI: {
        getUntagged: jest.fn().mockResolvedValue({
          success: true,
          images: [],
        }),
      },
    });
    window.electronAPI = api;

    sessionStorage.setItem(
      'batch-tagging:selectedImages:default',
      JSON.stringify([{ id: 7, filename: 'old.jpg', size: 256, path: 'D:\\old.jpg' }])
    );

    await renderAndFlush(<BatchTaggingTool showToast={jest.fn()} storageScope="default" />);
    expect(await screen.findByText(/当前选中 1 张图片/i)).toBeInTheDocument();

    sessionStorage.setItem(
      'batch-tagging:selectedImages:default',
      JSON.stringify([{ id: 9, filename: 'new.jpg', size: 256, path: 'D:\\new.jpg' }])
    );

    await act(async () => {
      window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'batch-tagging' } }));
    });
    await flush();

    await waitFor(() => {
      expect(screen.getByText(/当前选中 1 张图片/i)).toBeInTheDocument();
      expect(screen.getByText(/new\.jpg/i)).toBeInTheDocument();
    });
  });

  test('batch tagging can select untagged images across all pages', async () => {
    const api = createElectronApi({
      imagesAPI: {
        getUntagged: jest.fn().mockResolvedValue({
          success: true,
          images: [{ id: 12, filename: 'page-one.jpg', size: 256, path: 'D:\\page-one.jpg' }],
        }),
        getUntaggedIds: jest.fn().mockResolvedValue({
          success: true,
          ids: [12, 13, 14],
        }),
      },
    });
    window.electronAPI = api;
    const user = userEvent.setup();

    await renderAndFlush(<BatchTaggingTool showToast={jest.fn()} storageScope="default" />);

    await clickAndFlush(user, screen.getByRole('button', { name: /全选所有页/i }));

    await waitFor(() => {
      expect(api.imagesAPI.getUntaggedIds).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/当前选中 3 张图片/i)).toBeInTheDocument();
      expect(screen.getByText(/应用到 3 张图片/i)).toBeInTheDocument();
    });
  });

  test('batch tagging shows an in-page queue message after AI extraction starts', async () => {
    const api = createElectronApi({
      imagesAPI: {
        getUntagged: jest.fn().mockResolvedValue({
          success: true,
          images: [{ id: 12, filename: 'queued-ai.jpg', size: 256, path: 'D:\\queued-ai.jpg' }],
        }),
      },
      batchAiTagging: jest.fn().mockResolvedValue({ success: true }),
    });
    window.electronAPI = api;
    sessionStorage.setItem(
      'batch-tagging:selectedImages:default',
      JSON.stringify([{ id: 12, filename: 'queued-ai.jpg', size: 256, path: 'D:\\queued-ai.jpg' }])
    );
    const user = userEvent.setup();

    await renderAndFlush(<BatchTaggingTool showToast={jest.fn()} storageScope="default" />);

    await clickAndFlush(user, screen.getByRole('button', { name: /AI 一键提取/i }));

    await waitFor(() => {
      expect(api.batchAiTagging).toHaveBeenCalledWith([12]);
      expect(screen.getByText(/已将 1 张图片加入 AI 标注队列，正在后台处理中。/i)).toBeInTheDocument();
    });
  });

  test('image browser reloads when image-tagged event arrives', async () => {
    let onImageTagged;
    const api = createElectronApi({
      onImageTagged: jest.fn((callback) => {
        onImageTagged = callback;
        return jest.fn();
      }),
    });
    window.electronAPI = api;

    await renderAndFlush(<ImageBrowser showToast={jest.fn()} storageScope="default" />);

    await waitFor(() => {
      expect(api.searchImages).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      onImageTagged?.({ imageId: 1, source: 'ai' });
    });
    await flush();

    await waitFor(() => {
      expect(api.searchImages).toHaveBeenCalledTimes(2);
    });
  });

  test('image browser keeps selected preview stable while tag refresh reloads data', async () => {
    let onImageTagged;
    const imagePath = 'D:\\素材库\\horse.jpg';
    const api = createElectronApi({
      searchImages: jest.fn()
        .mockResolvedValueOnce({
          success: true,
          images: [{
            id: 1,
            filename: 'horse.jpg',
            path: imagePath,
            current_path: imagePath,
            folder: '动物',
            size: 1024,
            process_status: 'auto_tagged',
            tags: '马,草原',
            signed_image_url: 'signed://first',
          }],
        })
        .mockResolvedValueOnce({
          success: true,
          images: [{
            id: 1,
            filename: 'horse.jpg',
            path: imagePath,
            current_path: imagePath,
            folder: '动物',
            size: 1024,
            process_status: 'auto_tagged',
            tags: '马,草原,旅行',
            signed_image_url: 'signed://second',
          }],
        }),
      onImageTagged: jest.fn((callback) => {
        onImageTagged = callback;
        return jest.fn();
      }),
    });
    window.electronAPI = api;
    const user = userEvent.setup();

    await renderAndFlush(<ImageBrowser showToast={jest.fn()} storageScope="default" />);
    await clickAndFlush(user, await screen.findByText('horse.jpg'));

    const getDetailImage = () => screen.getAllByAltText('horse.jpg').find((img) => img.closest('aside'));

    await waitFor(() => {
      expect(getDetailImage()).toBeTruthy();
      expect(getDetailImage().getAttribute('src')).toBe('signed://first');
    });

    await act(async () => {
      onImageTagged?.({ imageId: 1, source: 'ai' });
    });
    await flush();

    await waitFor(() => {
      expect(api.searchImages).toHaveBeenCalledTimes(2);
      expect(getDetailImage().getAttribute('src')).toBe('signed://first');
      expect(getDetailImage().getAttribute('src')).not.toContain('signed://second');
    });
  });

  test('import wizard supports preview and import submission', async () => {
    const api = createElectronApi();
    window.electronAPI = api;
    const user = userEvent.setup();
    const onComplete = jest.fn();

    await renderAndFlush(<ImportWizard onClose={jest.fn()} onComplete={onComplete} />);

    await clickAndFlush(user, screen.getByRole('button', { name: /选择文件夹/i }));
    await screen.findByText(/D:\\春天路线/i);
    await clickAndFlush(user, screen.getByRole('button', { name: /下一步/i }));

    expect(await screen.findByText(/导入预览/i)).toBeInTheDocument();
    expect(await screen.findByText(/图片文件/i)).toBeInTheDocument();

    await clickAndFlush(user, screen.getByLabelText(/完整导入/i));
    await clickAndFlush(user, screen.getByRole('button', { name: /开始导入/i }));

    await waitFor(() => {
      expect(api.importAPI.startImport).toHaveBeenCalledWith({
        folderPath: 'D:\\春天路线',
        mode: 'full',
      });
      expect(onComplete).toHaveBeenCalledWith({ imported: 3, skipped: 0, errors: 0 });
    });
  });

  test('import wizard cancel clears folder selection instead of leaving page', async () => {
    const api = createElectronApi();
    window.electronAPI = api;
    const user = userEvent.setup();

    await renderAndFlush(<ImportWizard onClose={jest.fn()} onComplete={jest.fn()} />);

    await clickAndFlush(user, screen.getByRole('button', { name: /选择文件夹/i }));
    expect(await screen.findByText(/D:\\春天路线/i)).toBeInTheDocument();

    await clickAndFlush(user, screen.getByRole('button', { name: /^取消$/i }));

    expect(screen.getByText(/还没有选择文件夹/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下一步/i })).toBeDisabled();
  });
});
