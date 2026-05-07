$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$winUnpacked = Join-Path $projectRoot 'dist_final\win-unpacked'
if (-not (Test-Path $winUnpacked)) {
    throw "未找到 win-unpacked 目录: $winUnpacked"
}

$workingRoot = 'D:\smart-assets-installer'
$stageDir = Join-Path $workingRoot 'stage'
$outputDir = Join-Path $workingRoot 'output'
$payloadPath = Join-Path $stageDir 'payload.7z'
$sevenZip = Join-Path $projectRoot 'node_modules\7zip-bin\win\x64\7za.exe'
$appName = '智能素材管理系统'
$appExe = '智能素材管理系统.exe'
$installerBaseName = 'SmartAssets-Setup'
$version = (Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$setupExe = Join-Path $outputDir "$installerBaseName-$version.exe"
$sedPath = Join-Path $stageDir 'installer.sed'
$installScriptPath = Join-Path $stageDir 'install.ps1'

New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
Remove-Item $payloadPath -Force -ErrorAction SilentlyContinue
Remove-Item $setupExe -Force -ErrorAction SilentlyContinue

& $sevenZip a -t7z $payloadPath "$winUnpacked\*" -mx=7 | Out-Null

$installScript = @"
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appName = '$appName'
$appExe = '$appExe'
$installRoot = Join-Path `$env:LOCALAPPDATA 'Programs'
$installDir = Join-Path $installRoot $appName
$exePath = Join-Path $installDir $appExe
$startMenuDir = Join-Path `$env:APPDATA 'Microsoft\Windows\Start Menu\Programs\' + $appName
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) ($appName + '.lnk')
$startMenuShortcut = Join-Path $startMenuDir ($appName + '.lnk')

Get-Process | Where-Object { `$_.Path -eq $exePath } | Stop-Process -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
& (Join-Path $scriptDir '7za.exe') x (Join-Path $scriptDir 'payload.7z') "-o$installDir" -y | Out-Null

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

Write-Host 'INSTALL_OK'
"@
[System.IO.File]::WriteAllText($installScriptPath, $installScript, [System.Text.UTF8Encoding]::new($true))

$stageDirEscaped = $stageDir.Replace('\', '\\')
$setupExeEscaped = $setupExe.Replace('\', '\\')
$installCmd = "powershell.exe -ExecutionPolicy Bypass -File install.ps1"

$sedLines = @(
    '[Version]'
    'Class=IEXPRESS'
    'SEDVersion=3'
    '[Options]'
    'PackagePurpose=InstallApp'
    'ShowInstallProgramWindow=0'
    'HideExtractAnimation=1'
    'UseLongFileName=1'
    'InsideCompressed=0'
    'CAB_FixedSize=0'
    'CAB_ResvCodeSigning=0'
    'RebootMode=N'
    'InstallPrompt='
    'DisplayLicense='
    'FinishMessage=Installation completed.'
    "TargetName=$setupExeEscaped"
    'FriendlyName=Smart Assets Installer'
    "AppLaunched=$installCmd"
    'PostInstallCmd=<None>'
    "AdminQuietInstCmd=$installCmd"
    "UserQuietInstCmd=$installCmd"
    'SourceFiles=SourceFiles'
    '[Strings]'
    'FILE0=payload.7z'
    'FILE1=7za.exe'
    'FILE2=install.ps1'
    '[SourceFiles]'
    "SourceFiles0=$stageDirEscaped"
    '[SourceFiles0]'
    '%FILE0%='
    '%FILE1%='
    '%FILE2%='
)
[System.IO.File]::WriteAllText($sedPath, ($sedLines -join "`r`n"), [System.Text.Encoding]::ASCII)

$iexpress = Join-Path $env:WINDIR 'System32\iexpress.exe'
& $iexpress /N $sedPath | Out-Null

if (-not (Test-Path $setupExe)) {
    throw "IExpress 未生成安装包: $setupExe"
}

Write-Host "INSTALLER_BUILT $setupExe"
