const fs = require('fs');
const path = require('path');

async function run() {
  const testsDir = __dirname;
  const testFiles = fs.readdirSync(testsDir)
    .filter((file) => file.endsWith('.test.js'))
    .sort();

  if (testFiles.length === 0) {
    console.log('No backend tests found.');
    return;
  }

  let passed = 0;

  for (const file of testFiles) {
    const filePath = path.join(testsDir, file);
    const testModule = require(filePath);
    const testFn = typeof testModule === 'function'
      ? testModule
      : testModule && typeof testModule.run === 'function'
        ? testModule.run
        : null;

    if (!testFn) {
      throw new Error(`Test file must export a function or { run }: ${file}`);
    }

    await testFn();
    passed += 1;
    console.log(`PASS ${file}`);
  }

  console.log(`Backend tests passed: ${passed}/${testFiles.length}`);
}

run().catch((error) => {
  console.error('Backend tests failed.');
  console.error(error);
  process.exitCode = 1;
});
