# Gemma4 Local Usage Quick Reference

This doc is synced with `D:\Apps\Ollama\GEMMA4_USAGE.md`.

## One-click start

```bat
D:\Apps\Ollama\start-ollama-gemma4.cmd
```

The script will:
- start Ollama service,
- ensure `gemma4:e2b` is available,
- verify the local endpoint.

## Project settings

- Model: `gemma4:e2b`
- Base URL: `http://127.0.0.1:11434/v1`

## Verification commands

```powershell
D:\Apps\Ollama\ollama.exe --version
D:\Apps\Ollama\ollama.exe list
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:11434/api/tags
```

## OpenAI-compatible endpoint

`POST http://127.0.0.1:11434/v1/chat/completions`

```bash
curl http://127.0.0.1:11434/v1/chat/completions ^
  -H "Content-Type: application/json" ^
  -d "{\"model\":\"gemma4:e2b\",\"messages\":[{\"role\":\"user\",\"content\":\"Return up to 5 precise image tags.\"}]}"
```
