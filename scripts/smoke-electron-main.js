const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const outDir = process.env.SMOKE_OUT_DIR || path.join(process.cwd(), 'smoke-artifacts');
const htmlPath = path.join(__dirname, '..', 'frontend', 'build', 'index.html');

app.setName('SmartImageLibrarySmoke');
app.setPath('userData', path.join(outDir, 'userData'));

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

const viewports = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '375x667', width: 375, height: 667 },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(win, predicateJs, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await win.webContents.executeJavaScript(predicateJs, true);
      if (ok) {
        return;
      }
    } catch (_) {}
    await sleep(100);
  }
  throw new Error('Timeout waiting for UI readiness');
}

async function capture(win, filename) {
  const image = await win.webContents.capturePage();
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, filename), image.toPNG());
}

async function clickMenuByText(win, label) {
  const escaped = JSON.stringify(label);
  const clicked = await win.webContents.executeJavaScript(
    `
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const target = buttons.find((button) => button.innerText && button.innerText.includes(${escaped}));
        if (!target) return false;
        target.click();
        return true;
      })()
    `,
    true
  );

  if (!clicked) {
    throw new Error(`Unable to find menu button: ${label}`);
  }
}

async function runViewport(vp) {
  console.log(`[smoke] viewport ${vp.name} ${vp.width}x${vp.height}`);
  const win = new BrowserWindow({
    width: vp.width,
    height: vp.height,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  try {
    await win.loadURL(pathToFileURL(htmlPath).toString());
    await waitFor(
      win,
      "Boolean(document.body && document.body.innerText && document.body.innerText.includes('Smart Assets'))"
    );
    await waitFor(
      win,
      "Boolean(document.body && document.body.innerText && document.body.innerText.includes('图片浏览'))"
    );

    await sleep(300);
    await capture(win, `${vp.name}-home.png`);

    await clickMenuByText(win, '图片浏览');
    await sleep(400);
    await capture(win, `${vp.name}-browser.png`);

    await clickMenuByText(win, '自然语言搜图');
    await sleep(400);
    await capture(win, `${vp.name}-natural-search.png`);

    await clickMenuByText(win, '标签管理');
    await sleep(400);
    await capture(win, `${vp.name}-tags.png`);

    await clickMenuByText(win, '处理中心');
    await sleep(400);
    await capture(win, `${vp.name}-progress.png`);
  } finally {
    win.destroy();
  }
}

app.whenReady().then(async () => {
  if (!fs.existsSync(htmlPath)) {
    console.error('Missing build output:', htmlPath);
    app.exit(1);
    return;
  }

  try {
    for (const vp of viewports) {
      await runViewport(vp);
    }
    app.exit(0);
  } catch (error) {
    console.error('[smoke] fatal', error);
    app.exit(1);
  }
});
