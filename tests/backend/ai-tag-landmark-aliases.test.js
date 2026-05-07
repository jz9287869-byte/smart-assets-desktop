const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { LibraryDatabase } = require('../../electron/main/libraryDatabase');
const { ProcessingWorker } = require('../../electron/main/processingWorker');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function run() {
  const libraryPath = makeTempDir('smart-lib-ai-aliases-');
  const db = new LibraryDatabase('lib_ai_landmark_aliases', libraryPath);
  await db.initialize();

  try {
    const worker = new ProcessingWorker(db, { aiTagConcurrency: 0, thumbnailConcurrency: 0 });

    const cases = [
      ['Tiananmen Square', '天安门'],
      ['Gate of Heavenly Peace', '天安门'],
      ['天安门广场', '天安门'],
      ['Forbidden City', '故宫'],
      ['紫禁城', '故宫'],
      ['The Bund', '外滩'],
      ['Oriental Pearl Tower', '东方明珠'],
      ['Potala Palace', '布达拉宫'],
      ['Hongya Cave', '洪崖洞'],
      ['West Lake', '西湖'],
      ['Dianchi Lake', '滇池'],
      ['Jokhang Temple', '大昭寺'],
    ];

    for (const [input, expected] of cases) {
      assert.strictEqual(
        worker.normalizeTagName(input),
        expected,
        `alias should normalize "${input}" to "${expected}"`
      );
    }
  } finally {
    db.close();
  }
}

module.exports = run;
