$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = $packageJson.version

$workingRoot = 'D:\smart-assets-installer'
$stageDir = Join-Path $workingRoot 'stage'
$outputDir = Join-Path $workingRoot 'output'
$winUnpacked = Join-Path $projectRoot 'dist_final\win-unpacked'
$sevenZip = Join-Path $projectRoot 'node_modules\7zip-bin\win\x64\7za.exe'
$sfxStub = 'D:\tools\7zip-installer\7z.sfx'

$installerBaseName = 'SmartAssets-Setup'
$archivePath = Join-Path $stageDir 'installer-files.7z'
$configPath = Join-Path $stageDir 'config.txt'
$installScriptPath = Join-Path $stageDir 'install.ps1'
$installCmdPath = Join-Path $stageDir 'install.cmd'
$setupExe = Join-Path $outputDir "$installerBaseName-$version.exe"

if (-not (Test-Path $winUnpacked)) {
    throw "Missing win-unpacked directory: $winUnpacked"
}

if (-not (Test-Path $sevenZip)) {
    throw "Missing 7za.exe: $sevenZip"
}

if (-not (Test-Path $sfxStub)) {
    throw "Missing 7-Zip SFX module: $sfxStub"
}

$appExeItem = Get-ChildItem $winUnpacked -Filter *.exe |
    Where-Object { $_.Name -notin @('elevate.exe', 'Uninstall.exe') } |
    Select-Object -First 1

if (-not $appExeItem) {
    throw "Unable to locate main application executable under $winUnpacked"
}

$appExe = $appExeItem.Name
$appName = [System.IO.Path]::GetFileNameWithoutExtension($appExe)

New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
Remove-Item $archivePath -Force -ErrorAction SilentlyContinue
Remove-Item $configPath -Force -ErrorAction SilentlyContinue
Remove-Item $installScriptPath -Force -ErrorAction SilentlyContinue
Remove-Item $installCmdPath -Force -ErrorAction SilentlyContinue
Remove-Item $setupExe -Force -ErrorAction SilentlyContinue

$installScriptTemplate = @'
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appName = "__APP_NAME__"
$appExe = "__APP_EXE__"
$installRoot = Join-Path $env:LOCALAPPDATA "Programs"
$installDir = Join-Path $installRoot $appName
$exePath = Join-Path $installDir $appExe
$startMenuRoot = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$startMenuDir = Join-Path $startMenuRoot $appName
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) ($appName + ".lnk")
$startMenuShortcut = Join-Path $startMenuDir ($appName + ".lnk")
$sevenZip = Join-Path $scriptDir "7za.exe"
$payloadPath = Join-Path $scriptDir "payload.7z"

if (-not (Test-Path $sevenZip)) {
    throw "Missing extractor: $sevenZip"
}

if (-not (Test-Path $payloadPath)) {
    throw "Missing payload archive: $payloadPath"
}

$runningProcesses = Get-Process | Where-Object {
    $_.Path -and $_.Path -ieq $exePath
}
if ($runningProcesses) {
    $runningProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
& $sevenZip x $payloadPath "-o$installDir" -y | Out-Null

New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null
$shell = New-Object -ComObject WScript.Shell

$desktop = $shell.CreateShortcut($desktopShortcut)
$desktop.TargetPath = $exePath
$desktop.WorkingDirectory = $installDir
$desktop.IconLocation = $exePath
$desktop.Save()

$startMenu = $shell.CreateShortcut($startMenuShortcut)
$startMenu.TargetPath = $exePath
$startMenu.WorkingDirectory = $installDir
$startMenu.IconLocation = $exePath
$startMenu.Save()

Write-Host "INSTALL_OK"
'@

[string]$installScript = $installScriptTemplate.Replace('__APP_NAME__', $appName).Replace('__APP_EXE__', $appExe)
[System.IO.File]::WriteAllText($installScriptPath, $installScript, [System.Text.UTF8Encoding]::new($true))

$installCmd = @'
@echo off
cd /d "%~dp0"
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0install.ps1"
exit /b %ERRORLEVEL%
'@
[System.IO.File]::WriteAllText($installCmdPath, $installCmd, [System.Text.Encoding]::ASCII)

& $sevenZip a -t7z (Join-Path $stageDir 'payload.7z') "$winUnpacked\*" -mx=7 | Out-Null

Copy-Item $sevenZip (Join-Path $stageDir '7za.exe') -Force

$config = @'
;!@Install@!UTF-8!
Title="Smart Assets Installer"
RunProgram="install.cmd"
ExtractTitle="Preparing installer files"
ExtractDialogText="Extracting installer files. Please wait..."
GUIMode="2"
OverwriteMode="1"
;!@InstallEnd@!
'@

[System.IO.File]::WriteAllText($configPath, $config, [System.Text.UTF8Encoding]::new($false))

& $sevenZip a -t7z $archivePath `
    (Join-Path $stageDir 'payload.7z') `
    (Join-Path $stageDir '7za.exe') `
    (Join-Path $stageDir 'install.ps1') `
    (Join-Path $stageDir 'install.cmd') `
    -mx=9 | Out-Null

$setupStream = [System.IO.File]::Create($setupExe)
try {
    foreach ($part in @($sfxStub, $configPath, $archivePath)) {
        $bytes = [System.IO.File]::ReadAllBytes($part)
        $setupStream.Write($bytes, 0, $bytes.Length)
    }
}
finally {
    $setupStream.Dispose()
}

if (-not (Test-Path $setupExe)) {
    throw "未生成安装包: $setupExe"
}

Write-Host "INSTALLER_BUILT $setupExe"
