; ============================================================
; build/installer.nsh — Lapras NSIS 自定义安装脚本
; 在 electron-builder.yml 中通过 nsis.include 引用
; ============================================================

!pragma warning disable 6010
!pragma warning disable 6001

; --- 1. 安装完成页：开机自动启动 Lapras 复选框 ---

!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif

  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Launch Lapras on startup"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION EnableOpenAtLogin
  !insertmacro MUI_PAGE_FINISH
!macroend

Function EnableOpenAtLogin
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Lapras" '"$INSTDIR\Lapras.exe"'
FunctionEnd

; --- 2. 卸载时询问是否清除用户数据 ---

Var DeleteUserData

!macro customUnInit
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you also want to delete Lapras user data?$\r$\n$\r$\nThis includes API keys, play history, music preferences, profiles, and onboarding status.$\r$\nChoose No to keep this data for the next installation." \
    /SD IDNO \
    IDYES setDelete IDNO skipDelete

  setDelete:
    StrCpy $DeleteUserData "1"
    Goto doneUnInit

  skipDelete:
    StrCpy $DeleteUserData "0"

  doneUnInit:
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Lapras"
  Delete "$SMSTARTUP\Lapras.lnk"

  ${if} $DeleteUserData == "1"
    RMDir /r "$APPDATA\Lapras"
    RMDir /r "$APPDATA\lapras-desktop"
    RMDir /r "$LOCALAPPDATA\Lapras-updater"
    RMDir /r "$LOCALAPPDATA\lapras-desktop-updater"
  ${endif}
!macroend
