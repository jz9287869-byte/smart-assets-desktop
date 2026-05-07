$ErrorActionPreference = 'Stop'

$setup = 'D:\smart-assets-installer\output\SmartAssets-Setup-1.0.0.exe'
$projectRoot = Split-Path -Parent $PSScriptRoot
$winUnpacked = Join-Path $projectRoot 'dist_final\win-unpacked'
$appExeItem = Get-ChildItem $winUnpacked -Filter *.exe |
    Where-Object { $_.Name -notin @('elevate.exe', 'Uninstall.exe') } |
    Select-Object -First 1

if (-not $appExeItem) {
    throw "Missing main executable under $winUnpacked"
}

$appExe = $appExeItem.Name
$appName = [System.IO.Path]::GetFileNameWithoutExtension($appExe)
$installDir = Join-Path $env:LOCALAPPDATA ("Programs\" + $appName)
$exePath = Join-Path $installDir $appExe
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) ($appName + '.lnk')
$startMenuShortcut = Join-Path (Join-Path $env:APPDATA ("Microsoft\Windows\Start Menu\Programs\" + $appName)) ($appName + '.lnk')

if (-not (Test-Path $setup)) {
    throw "Missing installer: $setup"
}

Remove-Item $installDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $desktopShortcut -Force -ErrorAction SilentlyContinue
Remove-Item $startMenuShortcut -Force -ErrorAction SilentlyContinue

Start-Process -FilePath $setup -Wait
Start-Sleep -Seconds 3

if (-not (Test-Path $installDir)) {
    throw "Install directory not created: $installDir"
}

if (-not (Test-Path $exePath)) {
    throw "Main executable not found: $exePath"
}

$desktopExists = Test-Path $desktopShortcut
$startMenuExists = Test-Path $startMenuShortcut

Write-Host "INSTALL_DIR_OK $installDir"
Write-Host "MAIN_EXE_OK $exePath"
Write-Host "DESKTOP_SHORTCUT=$desktopExists"
Write-Host "START_MENU_SHORTCUT=$startMenuExists"
