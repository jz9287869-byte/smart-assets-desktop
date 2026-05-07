$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$installer = Get-ChildItem (Join-Path $projectRoot 'dist_final') -Filter '*-Setup-1.0.0.exe' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
$target = 'D:\SmartAssetsInstallTest'
if (-not $installer) {
    throw 'Missing built NSIS installer.'
}

Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue

Start-Process -FilePath $installer.FullName -ArgumentList '/S',('/D=' + $target) -Wait
Start-Sleep -Seconds 2

if (-not (Test-Path $target)) {
    throw "Install target missing: $target"
}

$mainExe = Get-ChildItem $target -Filter *.exe |
    Where-Object { $_.Name -notlike 'Uninstall*' } |
    Select-Object -First 1

if (-not $mainExe) {
    throw "Main executable missing after install under: $target"
}

Write-Host "NSIS_INSTALL_OK $target"
Write-Host "MAIN_EXE_OK $($mainExe.FullName)"
