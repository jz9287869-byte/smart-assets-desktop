!macro customInit
  StrCpy $INSTDIR "$LOCALAPPDATA\智能素材管理系统"
!macroend

!macro customInstall
  DetailPrint "Bootstrapping local AI runtime (Ollama + gemma4:e2b)..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\setup\setup-local-ai.ps1" -Model "gemma4:e2b"'
  Pop $0
  StrCmp $0 "0" done
    DetailPrint "Local AI bootstrap finished with code $0. You can rerun setup-local-ai.cmd after installation."
  done:
!macroend
