@echo off
setlocal

cd /d "%~dp0"

set "SCRIPT_PATH=%~dp0scripts\setup-local-ai.ps1"
if not exist "%SCRIPT_PATH%" (
  set "SCRIPT_PATH=%~dp0resources\setup\setup-local-ai.ps1"
)

if not exist "%SCRIPT_PATH%" (
  echo [ERROR] setup-local-ai.ps1 was not found.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   Smart Assets Local AI Bootstrap
echo ============================================
echo.
echo This will install or repair Ollama and pull gemma4:e2b.
echo The first run may take a while because the model is large.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_PATH%" %*
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  echo [OK] Local AI runtime is ready.
) else (
  echo [ERROR] Local AI bootstrap failed with code %EXIT_CODE%.
)

pause
exit /b %EXIT_CODE%
