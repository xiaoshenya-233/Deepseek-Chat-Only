; Custom NSIS hooks for Deepseek Chat Only.
;
; Electron spawns several child processes that share the executable name (main /
; renderer / GPU / utility). electron-builder only kills by image name and gives up
; with "无法关闭" when a security product blocks it, so customInit runs in .onInit
; (before CHECK_APP_RUNNING) and kills every matching process with /T.
;
; 数据目录 `$INSTDIR\data`（对话、图片原件、API Key、窗口状态）不属于安装清单。
; electron-builder 的卸载器默认 `RMDir /r $INSTDIR`，因此：
;   - 覆盖安装：用 customRemoveFiles 只清应用文件，**data 原地保留**，不迁移、不弹窗；
;   - 真正的卸载：customUnInit 先把 data 复制到 %APPDATA%\DeepseekChatOnly，再整目录删除；
;   - 从旧版本（钩子还是破坏性删除的那版）升级时，customInit 先把 data 快照到安装目录
;     旁边的 `DeepseekChatOnly-data`，应用启动后静默恢复并自动清掉这份快照。

!define DSC_SNAPSHOT "$INSTDIR\..\DeepseekChatOnly-data"

; 覆盖安装前的快照：只用于跨版本过渡（旧卸载器会删 data），带标记文件让应用识别。
; 如果数据目录里已有 `.dsc-safe-uninstall`（当前版本已带「原地保留」钩子），直接跳过，省掉 195MB 复制。
!macro customInstallPrep
  IfFileExists "$INSTDIR\data\*.*" 0 dscPrepDone
  IfFileExists "$INSTDIR\data\.dsc-safe-uninstall" 0 dscPrepCopy
    DetailPrint "Installed build already preserves chat data, skipping snapshot."
    Goto dscPrepDone
  dscPrepCopy:
    DetailPrint "Backing up existing chat data before upgrade ..."
    nsExec::ExecToLog 'robocopy "$INSTDIR\data" "$INSTDIR\..\DeepseekChatOnly-data" /E /NFL /NDL /NJH /NJS /R:1 /W:1'
    Pop $0
    DetailPrint "snapshot robocopy exit code: $0"
    ${If} $0 > 7
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONEXCLAMATION "现有聊天数据快照失败。$\r$\n为避免丢失，请先手动复制：$\r$\n$INSTDIR\data"
      ${EndIf}
    ${Else}
      FileOpen $1 "$INSTDIR\..\DeepseekChatOnly-data\.dsc-upgrade-snapshot" w
      FileWrite $1 "Deepseek Chat Only upgrade snapshot$\r$\n"
      FileClose $1
    ${EndIf}
  dscPrepDone:
!macroend

!macro customInit
  DetailPrint "Closing running DeepseekChatOnly processes..."
  nsExec::ExecToLog 'taskkill /IM "DeepseekChatOnly.exe" /F /T'
  Pop $0
  Sleep 1200
  nsExec::ExecToLog 'taskkill /IM "DeepseekChatOnly.exe" /F /T'
  Pop $0
  Sleep 800
  !insertmacro customInstallPrep
!macroend

; 覆盖安装：逐个删除 $INSTDIR 下除 data 之外的条目；真正卸载：照常整目录删除。
!macro customRemoveFiles
  ${if} ${isUpdated}
    DetailPrint "Updating in place, keeping chat data ..."
    FindFirst $R2 $R3 "$INSTDIR\*.*"
    dscRemoveLoop:
      StrCmp $R3 "" dscRemoveDone
      StrCmp $R3 "." dscRemoveNext
      StrCmp $R3 ".." dscRemoveNext
      StrCmp $R3 "data" dscRemoveNext
      IfFileExists "$INSTDIR\$R3\*.*" 0 dscRemoveFile
        RMDir /r "$INSTDIR\$R3"
        Goto dscRemoveNext
      dscRemoveFile:
        Delete "$INSTDIR\$R3"
      dscRemoveNext:
      FindNext $R2 $R3
      Goto dscRemoveLoop
    dscRemoveDone:
      FindClose $R2
  ${else}
    RMDir /r $INSTDIR
  ${endif}
!macroend

; 真正的卸载（不是覆盖安装）才把数据复制到 %APPDATA%，只复制、不移动、不删除源。
!macro customUnInit
  DetailPrint "Closing running DeepseekChatOnly processes before uninstall..."
  nsExec::ExecToLog 'taskkill /IM "DeepseekChatOnly.exe" /F /T'
  Pop $0
  Sleep 1500

  ${ifNot} ${isUpdated}
    IfFileExists "$INSTDIR\data\*.*" 0 dscDataDone
      DetailPrint "Copying chat data to $APPDATA\DeepseekChatOnly ..."
      CreateDirectory "$APPDATA\DeepseekChatOnly"
      nsExec::ExecToLog 'robocopy "$INSTDIR\data" "$APPDATA\DeepseekChatOnly" /E /NFL /NDL /NJH /NJS /R:2 /W:2'
      Pop $0
      DetailPrint "robocopy exit code: $0"
    dscDataDone:
  ${endif}
!macroend