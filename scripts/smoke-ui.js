const { spawn } = require('child_process');
const path = require('path');

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: false,
      ...options,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function main() {
  const root = path.join(__dirname, '..');
  const frontendDir = path.join(root, 'frontend');
  const smokeMain = path.join(root, 'scripts', 'smoke-electron-main.js');
  const outDir = path.join(root, 'smoke-artifacts');

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const electronExe = process.platform === 'win32'
    ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(root, 'node_modules', '.bin', 'electron');

  await run(npmCmd, ['run', 'build'], { cwd: frontendDir });
  await run(electronExe, [smokeMain], {
    cwd: root,
    env: { ...process.env, SMOKE_OUT_DIR: outDir },
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
