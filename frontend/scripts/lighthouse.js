const http = require('http');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');


const buildDir = path.join(__dirname, '..', 'build');
const outDir = path.join(__dirname, '..', 'lighthouse-artifacts');

function serveStatic(rootDir, port) {
  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, `http://localhost:${port}`);
    let filePath = path.join(rootDir, decodeURIComponent(reqUrl.pathname));
    if (filePath.endsWith(path.sep)) filePath = path.join(filePath, 'index.html');

    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200);
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

async function main() {
  if (!fs.existsSync(buildDir)) {
    throw new Error(`Missing build output: ${buildDir}. Run npm run build first.`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const port = 4173;
  const server = await serveStatic(buildDir, port);

  const lighthouse = (await import('lighthouse')).default;
  const chromeLauncher = await import('chrome-launcher');
  console.log(`[lighthouse] serving ${buildDir} on http://localhost:${port}/`);
  console.log('[lighthouse] launching Chrome...');
  const profileDir = path.join(outDir, 'chrome-profile');
  fs.mkdirSync(profileDir, { recursive: true });
  const chrome = await chromeLauncher.launch({
    userDataDir: profileDir,
    chromeFlags: ['--headless=new', '--disable-gpu', `--window-size=1920,1080`]
  });

  try {
    const url = `http://localhost:${port}/`;
    console.log('[lighthouse] running audit...');
    const result = await Promise.race([
      lighthouse(url, { port: chrome.port, output: 'json', logLevel: 'info' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Lighthouse timeout')), 180_000))
    ]);
    const reportJson = result.report;
    const scores = result.lhr.categories;

    fs.writeFileSync(path.join(outDir, 'lighthouse.report.json'), reportJson);

    const summary = {
      performance: scores.performance.score,
      accessibility: scores.accessibility.score,
      best_practices: scores['best-practices'].score,
      seo: scores.seo.score,
      pwa: scores.pwa ? scores.pwa.score : null
    };

    fs.writeFileSync(path.join(outDir, 'lighthouse.summary.json'), JSON.stringify(summary, null, 2));

    const perf = Math.round((summary.performance || 0) * 100);
    console.log('[lighthouse] performance', perf);
    if (perf < 90) {
      throw new Error(`Lighthouse performance score ${perf} < 90. See lighthouse-artifacts for details.`);
    }
  } finally {
    try {
      if (chrome.process && typeof chrome.process.kill === 'function') {
        chrome.process.kill();
      }
    } catch (_) {}
    try {
      process.kill(chrome.pid);
    } catch (_) {}
    try {
      await new Promise((r) => server.close(r));
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
