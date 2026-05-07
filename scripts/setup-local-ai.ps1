[CmdletBinding()]
param(
  [string]$Model = 'gemma4:e2b',
  [string]$OllamaInstallerUrl = 'https://ollama.com/download/OllamaSetup.exe',
  [string]$OllamaModelsPath = '',
  [switch]$SkipInstall,
  [switch]$SkipPull
)

$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Message)
  Write-Host "[local-ai] $Message"
}

function Resolve-OllamaExe {
  $command = Get-Command ollama -ErrorAction SilentlyContinue
  if ($command -and $command.Source -and (Test-Path $command.Source)) {
    return $command.Source
  }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
    (Join-Path $env:ProgramFiles 'Ollama\ollama.exe'),
    'C:\Program Files\Ollama\ollama.exe'
  ) | Where-Object { $_ }

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

function Wait-ForOllamaApi {
  param(
    [int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -Method Get -TimeoutSec 5
      if ($null -ne $response) {
        return $true
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  return $false
}

function Ensure-OllamaInstalled {
  $ollamaExe = Resolve-OllamaExe
  if ($ollamaExe) {
    Write-Step "Found Ollama: $ollamaExe"
    return $ollamaExe
  }

  if ($SkipInstall) {
    throw 'Ollama is not installed and -SkipInstall was specified.'
  }

  $tempInstaller = Join-Path $env:TEMP 'OllamaSetup.exe'
  Write-Step "Downloading Ollama installer from $OllamaInstallerUrl"
  Invoke-WebRequest -Uri $OllamaInstallerUrl -OutFile $tempInstaller

  Write-Step 'Running Ollama installer silently'
  $process = Start-Process -FilePath $tempInstaller -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Ollama installer exited with code $($process.ExitCode)"
  }

  $ollamaExe = Resolve-OllamaExe
  if (-not $ollamaExe) {
    throw 'Ollama installation finished, but ollama.exe could not be found.'
  }

  Write-Step "Ollama installed successfully: $ollamaExe"
  return $ollamaExe
}

function Start-OllamaIfNeeded {
  param([string]$OllamaExe)

  if (Wait-ForOllamaApi -TimeoutSeconds 5) {
    Write-Step 'Ollama API is already available on 127.0.0.1:11434'
    return
  }

  Write-Step 'Starting Ollama'
  Start-Process -FilePath $OllamaExe | Out-Null

  if (-not (Wait-ForOllamaApi -TimeoutSeconds 90)) {
    throw 'Ollama did not become ready within 90 seconds.'
  }

  Write-Step 'Ollama API is ready'
}

function Get-InstalledModels {
  try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -Method Get -TimeoutSec 10
    return @($response.models | ForEach-Object { $_.name })
  } catch {
    return @()
  }
}

function Ensure-ModelPulled {
  param(
    [string]$OllamaExe,
    [string]$ModelName
  )

  $installedModels = Get-InstalledModels
  if ($installedModels -contains $ModelName) {
    Write-Step "Model already exists: $ModelName"
    return
  }

  if ($SkipPull) {
    throw "Model $ModelName is not installed and -SkipPull was specified."
  }

  Write-Step "Pulling model: $ModelName"
  & $OllamaExe pull $ModelName
  if ($LASTEXITCODE -ne 0) {
    throw "ollama pull failed with exit code $LASTEXITCODE"
  }

  $installedModels = Get-InstalledModels
  if ($installedModels -notcontains $ModelName) {
    throw "Model $ModelName was not found after pull completed."
  }

  Write-Step "Model is ready: $ModelName"
}

if ($OllamaModelsPath) {
  Write-Step "Setting OLLAMA_MODELS to $OllamaModelsPath"
  [Environment]::SetEnvironmentVariable('OLLAMA_MODELS', $OllamaModelsPath, 'User')
  $env:OLLAMA_MODELS = $OllamaModelsPath
}

$ollamaExe = Ensure-OllamaInstalled
Start-OllamaIfNeeded -OllamaExe $ollamaExe
Ensure-ModelPulled -OllamaExe $ollamaExe -ModelName $Model

Write-Step 'Local AI runtime is ready.'
