const fs = require('fs');
const os = require('os');
const path = require('path');

const { LibraryDatabase } = require('../electron/main/libraryDatabase');
const { ProcessingWorker } = require('../electron/main/processingWorker');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);

function printUsage() {
  console.log([
    'Usage:',
    '  node scripts/evaluate-aux-tags.js --dir <image-directory> [--output <report.json>] [--limit <n>]',
    '  node scripts/evaluate-aux-tags.js --list <paths.txt> [--output <report.json>] [--limit <n>]',
    '',
    'Examples:',
    '  node scripts/evaluate-aux-tags.js --dir "D:\\鍥惧簱鏍锋湰" --output aux-eval.json',
    '  node scripts/evaluate-aux-tags.js --list sample-paths.txt --limit 50',
  ].join('\n'));
}

function parseArgs(argv) {
  const args = { dir: null, list: null, output: null, limit: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dir') {
      args.dir = argv[index + 1] || null;
      index += 1;
    } else if (token === '--list') {
      args.list = argv[index + 1] || null;
      index += 1;
    } else if (token === '--output') {
      args.output = argv[index + 1] || null;
      index += 1;
    } else if (token === '--limit') {
      const value = Number.parseInt(argv[index + 1], 10);
      args.limit = Number.isFinite(value) && value > 0 ? value : null;
      index += 1;
    } else if (token === '--help' || token === '-h') {
      args.help = true;
    }
  }
  return args;
}

function collectImagesFromDir(rootDir) {
  const results = [];
  const pending = [rootDir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  }
  return results.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function collectImagesFromList(listPath) {
  return fs.readFileSync(listPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => IMAGE_EXTENSIONS.has(path.extname(line).toLowerCase()));
}

function toCsvCell(value) {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function reportToCsv(rows) {
  const headers = [
    'path',
    'weather_label',
    'weather_confidence',
    'weather_margin',
    'people_label',
    'face_count',
    'body_count',
    'final_tags',
    'scene_tags',
    'people_tags',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push([
      row.path,
      row.weather?.label || '',
      row.weather?.confidence ?? '',
      row.weather?.margin ?? '',
      row.peopleAnalysis?.label || '',
      row.peopleAnalysis?.face_count ?? '',
      row.peopleAnalysis?.body_count ?? '',
      row.finalTags,
      row.sceneTags,
      row.peopleTags,
    ].map(toCsvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function createWorker() {
  const libraryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-assets-aux-eval-'));
  const db = new LibraryDatabase(`lib_aux_eval_${Date.now()}`, libraryPath);
  await db.initialize();
  const worker = new ProcessingWorker(db, {
    aiTagConcurrency: 0,
    thumbnailConcurrency: 0,
    usePythonEngine: true,
  });
  await worker.initializeAIEngine();
  return { db, worker };
}

function normalizeAnalysis(worker, imagePath, result) {
  const normalizedTags = (result?.tags || [])
    .map((tag) => {
      if (typeof tag === 'string') {
        return { name: tag, confidence: 0.8, source: 'ai', category: null };
      }
      if (tag && typeof tag === 'object' && tag.name) {
        return {
          name: tag.name,
          confidence: typeof tag.confidence === 'number' ? tag.confidence : 0.8,
          source: tag.source || 'ai',
          category: tag.category || null,
        };
      }
      return null;
    })
    .filter(Boolean);

  const semanticTags = normalizedTags.filter((tag) => !worker.isColorTag(tag));
  const task = {
    path: imagePath,
    filename: path.basename(imagePath),
    folder: path.basename(path.dirname(imagePath)),
  };
  const enrichedTags = worker.enrichAITags(semanticTags, task);
  const finalTags = worker.mergeDerivedAITags(
    enrichedTags,
    worker.buildAuxiliaryDimensionTags(result, enrichedTags)
  );

  return {
    path: imagePath,
    weather: result?.weather || null,
    peopleAnalysis: result?.people_analysis || result?.peopleAnalysis || null,
    finalTags: finalTags.map((tag) => tag.name),
    sceneTags: finalTags.filter((tag) => tag.category === 'scene').map((tag) => tag.name),
    peopleTags: finalTags.filter((tag) => tag.category === 'people').map((tag) => tag.name),
    rawTags: normalizedTags.map((tag) => ({
      name: tag.name,
      confidence: tag.confidence,
      category: tag.category || worker.resolveSemanticTagCategory(tag),
      source: tag.source,
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.dir && !args.list)) {
    printUsage();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const imagePaths = args.dir
    ? collectImagesFromDir(path.resolve(args.dir))
    : collectImagesFromList(path.resolve(args.list));
  const limitedPaths = args.limit ? imagePaths.slice(0, args.limit) : imagePaths;

  if (limitedPaths.length === 0) {
    throw new Error('No image files found for evaluation.');
  }

  const { db, worker } = await createWorker();
  try {
    const rows = [];
    for (const imagePath of limitedPaths) {
      console.log(`[aux-eval] analyzing ${imagePath}`);
      let result = null;
      if (worker.pythonEngineManager) {
        result = await worker.pythonEngineManager.analyzeImage(imagePath);
      } else if (worker.aiEngine) {
        result = await worker.aiEngine.analyzeImage(imagePath);
      } else {
        throw new Error('No AI engine available for auxiliary tag evaluation.');
      }
      rows.push(normalizeAnalysis(worker, imagePath, result));
    }

    const report = {
      generatedAt: new Date().toISOString(),
      imageCount: rows.length,
      rows,
    };

    const outputPath = args.output
      ? path.resolve(args.output)
      : path.resolve(process.cwd(), 'aux-tag-evaluation-report.json');
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(outputPath.replace(/\.json$/i, '.csv'), reportToCsv(rows), 'utf8');

    console.log(`[aux-eval] report saved: ${outputPath}`);
    console.log(`[aux-eval] csv saved: ${outputPath.replace(/\\.json$/i, '.csv')}`);
    console.log(`[aux-eval] analyzed ${rows.length} images`);
  } finally {
    if (worker.pythonEngineManager) {
      await worker.pythonEngineManager.stop();
    }
    db.close();
  }
}

main().catch((error) => {
  console.error('[aux-eval] failed');
  console.error(error);
  process.exitCode = 1;
});

