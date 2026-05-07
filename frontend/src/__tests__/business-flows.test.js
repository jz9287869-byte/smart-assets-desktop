import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImageBrowser from '../components/ImageBrowser';
import TagManager from '../components/TagManager';
import ImportWizard from '../components/ImportWizard';
import FolderTree from '../components/FolderTree';

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

async function clearAndFlush(user, element) {
  await act(async () => {
    await user.clear(element);
  });
  await flush();
}

function buildImage(id, overrides = {}) {
  return {
    id,
    filename: `image-${id}.jpg`,
    path: `D:\\素材库\\路线${id}\\image-${id}.jpg`,
    current_path: `D:\\素材库\\路线${id}\\image-${id}.jpg`,
    folder: `春天路线/子目录${id}`,
    size: 1024 + id,
    process_status: 'imported',
    tags: '',
    ...overrides,
  };
}

function createElectronApi(overrides = {}) {
  const pageOne = Array.from({ length: 40 }, (_, index) => (
    buildImage(index + 1, {
      filename: `page-1-${index + 1}.jpg`,
      path: `D:\\素材库\\春天路线\\page-1-${index + 1}.jpg`,
      current_path: `D:\\素材库\\春天路线\\page-1-${index + 1}.jpg`,
      folder: '春天路线/动物',
      process_status: 'auto_tagged',
      tags: '马,草原',
    })
  ));
  const pageTwo = Array.from({ length: 5 }, (_, index) => (
    buildImage(index + 101, {
      filename: `page-2-${index + 1}.jpg`,
      path: `D:\\素材库\\春天路线\\page-2-${index + 1}.jpg`,
      current_path: `D:\\素材库\\春天路线\\page-2-${index + 1}.jpg`,
      folder: '春天路线/城市',
      process_status: 'thumbnail',
      tags: '城市,夜景',
    })
  ));

  return {
    libraryAPI: {
      getStatus: jest.fn().mockResolvedValue({
        success: true,
        active: true,
        libraryId: 'lib_business',
        name: '素材库',
        path: 'D:\\素材库',
      }),
      getFolderTree: jest.fn().mockResolvedValue({
        success: true,
        tree: ['春天路线', '春天路线/动物', '春天路线/城市'],
      }),
      refresh: jest.fn().mockResolvedValue({
        success: true,
        stats: { imported: 2 },
      }),
      deleteFolder: jest.fn().mockResolvedValue({
        success: true,
        deletedCount: 3,
      }),
      ...overrides.libraryAPI,
    },
    searchImages: jest.fn().mockImplementation(async ({ keyword, status, folderPath, offset = 0, limit = 40 }) => {
      let resultSet = offset >= 40 ? pageTwo : pageOne.slice(0, limit);

      resultSet = resultSet.filter((image) => {
        const keywordMatch = !keyword || image.filename.includes(keyword) || image.tags.includes(keyword);
        const statusMatch = !status || image.process_status === status;
        const folderMatch = !folderPath || image.folder.includes(folderPath);
        return keywordMatch && statusMatch && folderMatch;
      });

      return { success: true, images: resultSet };
    }),
    tagsAPI: {
      list: jest.fn()
        .mockResolvedValueOnce({
          success: true,
          tags: [
            { category_id: 'scene', tag_id: 1, tag_name: '草原', linked_count: 2, created_source: 'system' },
            { category_id: 'scene', tag_id: 2, tag_name: '旅行灵感', linked_count: 1, created_source: 'manual' },
          ],
        })
        .mockResolvedValue({
          success: true,
          tags: [
            { category_id: 'scene', tag_id: 1, tag_name: '草原', linked_count: 2, created_source: 'system' },
            { category_id: 'scene', tag_id: 2, tag_name: '旅行灵感', linked_count: 1, created_source: 'manual' },
          ],
        }),
      add: jest.fn().mockResolvedValue({ success: true }),
      rename: jest.fn().mockResolvedValue({ success: true }),
      delete: jest.fn().mockResolvedValue({ success: true }),
      ...overrides.tagsAPI,
    },
    tagCategoriesAPI: {
      list: jest.fn().mockResolvedValue({
        success: true,
        categories: [{ id: 'travel', name: '旅行灵感', sort_order: 120, is_system: 0 }],
      }),
      add: jest.fn().mockResolvedValue({ success: true }),
      delete: jest.fn().mockResolvedValue({ success: true }),
      ...overrides.tagCategoriesAPI,
    },
    importAPI: {
      selectImportFolder: jest.fn().mockResolvedValue({ success: true, path: 'D:\\春天路线' }),
      previewImport: jest.fn().mockResolvedValue({
        success: true,
        preview: {
          totalFiles: 4,
          totalSize: 40960,
          byFormat: { jpg: 3, png: 1 },
        },
      }),
      startImport: jest.fn().mockResolvedValue({
        success: true,
        stats: { imported: 4, skipped: 0, errors: 0 },
      }),
      onImportProgress: jest.fn(() => jest.fn()),
      ...overrides.importAPI,
    },
    onImageAdded: jest.fn(),
    onImageDeleted: jest.fn(),
    onImageTagged: jest.fn(),
    addTagToImage: jest.fn().mockResolvedValue({ success: true }),
    removeTagFromImage: jest.fn().mockResolvedValue({ success: true }),
    openInFolder: jest.fn().mockResolvedValue({ success: true }),
    copyPathToClipboard: jest.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

describe('Business flows', () => {
  const originalAlert = window.alert;
  const originalConfirm = window.confirm;

  beforeEach(() => {
    window.alert = jest.fn();
    window.confirm = jest.fn(() => true);
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    window.alert = originalAlert;
    window.confirm = originalConfirm;
    delete window.electronAPI;
  });

  test('image browser supports keyword, status and folder filtering together', async () => {
    window.electronAPI = createElectronApi();
    const user = userEvent.setup();

    await renderAndFlush(<ImageBrowser showToast={jest.fn()} storageScope="lib_business" />);

    await typeAndFlush(user, screen.getByPlaceholderText(/搜索图片名称、标签/i), '马');
    await clickAndFlush(user, screen.getByRole('button', { name: /AI 已标注/i }));
    await clickAndFlush(user, screen.getByRole('button', { name: /展开/i }));
    await clickAndFlush(user, screen.getByText(/^动物$/i));

    expect(await screen.findByText(/page-1-1\.jpg/i)).toBeInTheDocument();
    expect(screen.queryByText(/page-2-1\.jpg/i)).not.toBeInTheDocument();
  });

  test('image browser detail panel supports add/remove tag and file actions', async () => {
    window.electronAPI = createElectronApi({
      searchImages: jest.fn().mockResolvedValue({
        success: true,
        images: [
          buildImage(1, {
            filename: 'horse.jpg',
            path: 'D:\\素材库\\动物\\horse.jpg',
            current_path: 'D:\\素材库\\动物\\horse.jpg',
            folder: '春天路线/动物',
            process_status: 'auto_tagged',
            tags: '马,草原',
          }),
        ],
      }),
    });
    const user = userEvent.setup();

    await renderAndFlush(<ImageBrowser showToast={jest.fn()} storageScope="lib_business" />);

    await clickAndFlush(user, await screen.findByText(/horse\.jpg/i));
    expect(await screen.findByText(/图片详情/i)).toBeInTheDocument();

    const tagInput = screen.getByPlaceholderText(/输入标签后回车添加/i);
    await typeAndFlush(user, tagInput, '旅行海报{enter}');

    await waitFor(() => {
      expect(window.electronAPI.addTagToImage).toHaveBeenCalledWith(1, '旅行海报');
    });

    await clickAndFlush(user, screen.getByRole('button', { name: /打开目录/i }));
    await clickAndFlush(user, screen.getByRole('button', { name: /复制文件路径/i }));

    await waitFor(() => {
      expect(window.electronAPI.openInFolder).toHaveBeenCalledWith('D:\\素材库\\动物\\horse.jpg');
      expect(window.electronAPI.copyPathToClipboard).toHaveBeenCalledWith('D:\\素材库\\动物\\horse.jpg');
    });

    await clickAndFlush(user, screen.getByRole('button', { name: /^马/i }));

    await waitFor(() => {
      expect(window.electronAPI.removeTagFromImage).toHaveBeenCalledWith(1, '马');
    });
  });

  test('image browser pagination requests the next page and resets after library switch', async () => {
    const searchImages = jest.fn().mockImplementation(async ({ offset = 0 }) => {
      if (offset >= 40) {
        return {
          success: true,
          images: [buildImage(201, { filename: 'second-page.jpg', folder: '春天路线/城市' })],
        };
      }

      return {
        success: true,
        images: Array.from({ length: 40 }, (_, index) => (
          buildImage(index + 1, {
            filename: `page-1-${index + 1}.jpg`,
            folder: '春天路线/动物',
            process_status: 'auto_tagged',
            tags: '马,草原',
          })
        )),
      };
    });

    window.electronAPI = createElectronApi({ searchImages });
    const user = userEvent.setup();
    const { rerender } = await renderAndFlush(<ImageBrowser showToast={jest.fn()} storageScope="library_a" />);

    expect(await screen.findByText(/page-1-1\.jpg/i)).toBeInTheDocument();
    expect(searchImages).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }));

    await clickAndFlush(user, screen.getByRole('button', { name: /下一页/i }));

    expect(await screen.findByText(/second-page\.jpg/i)).toBeInTheDocument();
    expect(searchImages).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 40 }));

    await clickAndFlush(user, screen.getByText(/second-page\.jpg/i));
    expect(await screen.findByText(/图片详情/i)).toBeInTheDocument();

    await act(async () => {
      rerender(<ImageBrowser showToast={jest.fn()} storageScope="library_b" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(searchImages).toHaveBeenLastCalledWith(expect.objectContaining({
        offset: 0,
        keyword: undefined,
        status: undefined,
        folderPath: undefined,
      }));
    });
    expect(screen.queryByText(/second-page\.jpg/i)).not.toBeInTheDocument();
  });

  test('image detail panel pushes the current image into batch tagging queue', async () => {
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');
    window.electronAPI = createElectronApi({
      searchImages: jest.fn().mockResolvedValue({
        success: true,
        images: [
          buildImage(31, {
            filename: 'detail-batch.jpg',
            path: 'D:\\素材库\\春天路线\\detail-batch.jpg',
            current_path: 'D:\\素材库\\春天路线\\detail-batch.jpg',
            folder: '春天路线/动物',
            process_status: 'auto_tagged',
            tags: '马,草原',
          }),
        ],
      }),
    });
    const user = userEvent.setup();

    await renderAndFlush(<ImageBrowser showToast={jest.fn()} storageScope="lib_business" />);

    await clickAndFlush(user, await screen.findByText(/detail-batch\.jpg/i));
    const detailPanel = screen.getByText(/图片详情/i).closest('aside');
    await clickAndFlush(user, within(detailPanel).getByRole('button', { name: /加入批量标签/i }));

    const queued = JSON.parse(sessionStorage.getItem('batch-tagging:selectedImages:lib_business'));
    expect(queued).toHaveLength(1);
    expect(queued[0]).toEqual(expect.objectContaining({
      id: 31,
      filename: 'detail-batch.jpg',
    }));
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'app:navigate',
    }));

    dispatchSpy.mockRestore();
  });

  test('tag manager supports create rename and delete for custom tags', async () => {
    window.electronAPI = createElectronApi();
    const user = userEvent.setup();

    await renderAndFlush(<TagManager showToast={jest.fn()} />);

    await clickAndFlush(user, screen.getByRole('button', { name: /新建标签/i }));
    await typeAndFlush(user, screen.getByPlaceholderText(/输入标签名称后回车保存/i), '新路线{enter}');

    await waitFor(() => {
      expect(window.electronAPI.tagsAPI.add).toHaveBeenCalledWith({
        categoryId: 'scene',
        name: '新路线',
      });
    });

    const tableBody = document.querySelector('tbody');
    const row = within(tableBody).getByText(/^旅行灵感$/i).closest('tr');
    await clickAndFlush(user, within(row).getAllByRole('button')[0]);
    const renameInput = row.querySelector('input');
    await clearAndFlush(user, renameInput);
    await typeAndFlush(user, renameInput, '旅行大片{enter}');

    await waitFor(() => {
      expect(window.electronAPI.tagsAPI.rename).toHaveBeenCalledWith({
        tagId: 2,
        name: '旅行大片',
      });
    });

    await clickAndFlush(user, within(row).getAllByRole('button')[1]);
    await waitFor(() => {
      expect(window.electronAPI.tagsAPI.delete).toHaveBeenCalledWith({ tagId: 2 });
    });
  });

  test('import wizard respects selected mode and completion callback', async () => {
    window.electronAPI = createElectronApi();
    const user = userEvent.setup();
    const onComplete = jest.fn();

    await renderAndFlush(<ImportWizard onClose={jest.fn()} onComplete={onComplete} />);

    await clickAndFlush(user, screen.getByRole('button', { name: /选择文件夹/i }));
    await screen.findByText(/D:\\春天路线/i);
    await clickAndFlush(user, screen.getByRole('button', { name: /下一步/i }));

    await clickAndFlush(user, screen.getByText(/仅缩略图/i).closest('label'));
    await clickAndFlush(user, screen.getByRole('button', { name: /开始导入/i }));

    await waitFor(() => {
      expect(window.electronAPI.importAPI.startImport).toHaveBeenCalledWith({
        folderPath: 'D:\\春天路线',
        mode: 'standard',
      });
      expect(onComplete).toHaveBeenCalledWith({ imported: 4, skipped: 0, errors: 0 });
    });
  });

  test('folder tree expanded state is isolated by storage scope', async () => {
    window.electronAPI = createElectronApi();
    const user = userEvent.setup();

    const { unmount } = await renderAndFlush(
      <FolderTree
        selectedFolder=""
        onFolderSelect={jest.fn()}
        showToast={jest.fn()}
        storageScope="library_a"
      />
    );

    await clickAndFlush(user, screen.getByText(/^素材库$/i));

    const scopeA = JSON.parse(localStorage.getItem('folderTreeExpanded:library_a'));
    expect(scopeA).toContain('__library_root__');

    unmount();

    await renderAndFlush(
      <FolderTree
        selectedFolder=""
        onFolderSelect={jest.fn()}
        showToast={jest.fn()}
        storageScope="library_b"
      />
    );

    expect(localStorage.getItem('folderTreeExpanded:library_b')).toBe('[]');
  });

  test('folder tree supports removing a folder from the library only', async () => {
    const api = createElectronApi();
    window.electronAPI = api;
    const user = userEvent.setup();
    const onFolderSelect = jest.fn();
    window.confirm = jest.fn(() => true);

    await renderAndFlush(
      <FolderTree
        selectedFolder="鏄ュぉ璺嚎/鍔ㄧ墿"
        onFolderSelect={onFolderSelect}
        showToast={jest.fn()}
        storageScope="library_delete"
      />
    );

    await clickAndFlush(user, screen.getByText(/^素材库$/i));
    await clickAndFlush(user, screen.getByText(/春天路线/i));
    await clickAndFlush(user, screen.getByTitle(/删除目录 .*动物/i));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(api.libraryAPI.deleteFolder).toHaveBeenCalledWith({
        folderPath: '春天路线/动物',
        deleteMode: 'detach',
      });
      expect(onFolderSelect).toHaveBeenCalledWith('');
    });
  });

  test('folder tree supports moving a folder to trash after choosing trash mode', async () => {
    const api = createElectronApi();
    window.electronAPI = api;
    const user = userEvent.setup();
    window.confirm = jest.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    await renderAndFlush(
      <FolderTree
        selectedFolder=""
        onFolderSelect={jest.fn()}
        showToast={jest.fn()}
        storageScope="library_delete_trash"
      />
    );
    await clickAndFlush(user, screen.getByText(/^\u7d20\u6750\u5e93$/i));
    await clickAndFlush(user, screen.getByText(/\u6625\u5929\u8def\u7ebf/i));
    await clickAndFlush(user, screen.getByTitle(/\u5220\u9664\u76ee\u5f55 .*\u52a8\u7269/i));

    expect(window.confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(api.libraryAPI.deleteFolder).toHaveBeenCalledWith({
        folderPath: '春天路线/动物',
        deleteMode: 'trash',
      });
    });
  });

  test('folder tree restores expanded directories when the same library scope remounts', async () => {
    window.electronAPI = createElectronApi();
    const user = userEvent.setup();

    const { unmount } = await renderAndFlush(
      <FolderTree
        selectedFolder=""
        onFolderSelect={jest.fn()}
        showToast={jest.fn()}
        storageScope="library_restore"
      />
    );

    await clickAndFlush(user, screen.getByText(/^素材库$/i));
    await clickAndFlush(user, screen.getByText(/^春天路线$/i));

    unmount();

    await renderAndFlush(
      <FolderTree
        selectedFolder=""
        onFolderSelect={jest.fn()}
        showToast={jest.fn()}
        storageScope="library_restore"
      />
    );

    expect(screen.getByText(/动物/i)).toBeInTheDocument();
    expect(screen.getByText(/城市/i)).toBeInTheDocument();
  });
});
