@echo off
setlocal

cd /d "%~dp0"

set "START_MODE=prod"
set "RESTART_FIRST=1"

:parse_args
if "%~1"=="" goto after_args
if /I "%~1"=="--dev" (
  set "START_MODE=dev"
  shift
  goto parse_args
)
if /I "%~1"=="--restart" (
  set "RESTART_FIRST=1"
  shift
  goto parse_args
)
shift
goto parse_args

:after_args

echo.
echo ==============================
echo   Smart Assets Quick Start
echo ==============================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo Please install Node.js 18+ and reopen this script.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] Installing dependencies for first run...
  call npm.cmd install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [WARN] Electron runtime is incomplete. Repairing local Electron install...
  if exist "node_modules\electron\install.js" (
    call node node_modules\electron\install.js
  ) else (
    call npm.cmd install
  )
  if errorlevel 1 (
    echo [ERROR] Electron runtime repair failed.
    pause
    exit /b 1
  )
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [ERROR] Electron runtime is still missing after repair.
  echo Please check antivirus/quarantine settings for electron.exe and try again.
  pause
  exit /b 1
)

if "%RESTART_FIRST%"=="1" (
  echo [INFO] Closing existing Smart Assets windows...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$repo=(Resolve-Path '.').Path; " ^
    "$targets=Get-CimInstance Win32_Process | Where-Object { " ^
    "$_.ExecutablePath -and ( " ^
    "$_.ExecutablePath -like ($repo + '\\*') -or " ^
    "$_.ExecutablePath -like '*\\smart-image-library\\*' " ^
    ") " ^
    "}; " ^
    "$targets | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }"
  timeout /t 1 /nobreak >nul
)

if /I "%START_MODE%"=="prod" (
  echo [INFO] Checking renderer production build...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$repoRoot = (Resolve-Path '.').Path; " ^
    "$srcRoots = @(" ^
    "  (Join-Path $repoRoot 'frontend\\src')," ^
    "  (Join-Path $repoRoot 'frontend\\public')" ^
    "); " ^
    "$extraFiles = @(" ^
    "  (Join-Path $repoRoot 'frontend\\package.json')," ^
    "  (Join-Path $repoRoot 'frontend\\tailwind.config.js')," ^
    "  (Join-Path $repoRoot 'frontend\\postcss.config.js')" ^
    "); " ^
    "$buildIndex = Join-Path (Resolve-Path '.').Path 'frontend\\build\\index.html'; " ^
    "$needsBuild = -not (Test-Path $buildIndex); " ^
    "if (-not $needsBuild) { " ^
    "  $latestSrc = @(); " ^
    "  foreach ($root in $srcRoots) { if (Test-Path $root) { $latestSrc += Get-ChildItem -Path $root -Recurse -File } } " ^
    "  foreach ($file in $extraFiles) { if (Test-Path $file) { $latestSrc += Get-Item $file } } " ^
    "  $latestSrc = $latestSrc | Sort-Object LastWriteTime -Descending | Select-Object -First 1; " ^
    "  $buildTime = (Get-Item $buildIndex).LastWriteTime; " ^
    "  if ($latestSrc -and $latestSrc.LastWriteTime -gt $buildTime) { $needsBuild = $true } " ^
    "} " ^
    "if ($needsBuild) { exit 10 } else { exit 0 }"
  if errorlevel 10 (
    echo [INFO] Renderer build is missing or stale. Rebuilding UI...
    pushd frontend
    call npm.cmd run build
    if errorlevel 1 (
      popd
      echo [ERROR] Renderer build failed.
      pause
      exit /b 1
    )
    popd
  ) else (
    echo [INFO] Renderer build is up to date.
  )
)

if /I "%START_MODE%"=="dev" (
  echo [INFO] Starting in development mode...
  call npm.cmd run dev
) else (
  echo [INFO] Starting in production mode...
  call npm.cmd start
)

if errorlevel 1 (
  echo.
  echo [ERROR] Launch failed.
  pause
  exit /b 1
)

exit /b 0
