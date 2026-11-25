; Per-user installer for Linger on Windows. package.py passes VERSION,
; NUMERIC_VERSION (VERSION without a prerelease suffix, for the X.X.X.X field),
; STAGE (the app folder) and OUTPUT. No administrator rights are needed. There is
; no folder page: the uninstaller removes all of the folder. An install goes where
; the last one went, else to the default folder, unless /D= names another.
Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

Name "LingerX"
OutFile "${OUTPUT}"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\LingerX"
InstallDir "$LOCALAPPDATA\Programs\LingerX"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
!define APP_ID "dev.oldwinter.lingerx.desktop"
!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
RequestExecutionLevel user
; Use zlib without datablock deduplication: single-threaded LZMA spends
; minutes re-compressing bundled archives, and datablock optimization scans
; quadratically across the thousands of files in computer-tools.
SetCompressor zlib
SetDatablockOptimize off

VIProductVersion "${NUMERIC_VERSION}.0"
VIAddVersionKey "ProductName" "LingerX"
VIAddVersionKey "FileDescription" "LingerX Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "LingerX"
VIAddVersionKey "LegalCopyright" "LingerX"

!define MUI_ICON "${STAGE}\resources\linger.ico"
!define MUI_UNICON "${STAGE}\resources\linger.ico"
; The app's self-update runs this setup with /update /relaunch after it quit
; (updater.ts): the progress page alone, which closes when done (the finish
; page's MUI sets SetAutoClose true), then LingerX starts. Unlike /S, the
; questions below stay visible. /S still installs without any window.
Var Updating
Var Relaunch
; Set once the install starts replacing files: the earlier app can no longer
; start after a failure.
Var Replacing
!define MUI_FINISHPAGE_RUN "$INSTDIR\LingerX.exe"
!define MUI_PAGE_CUSTOMFUNCTION_SHOW ShowProgress
!insertmacro MUI_PAGE_INSTFILES
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipWhenUpdating
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/update" $1
  IfErrors +2
  StrCpy $Updating 1
  ClearErrors
  ${GetOptions} $0 "/relaunch" $1
  IfErrors +2
  StrCpy $Relaunch 1
FunctionEnd

Function ShowProgress
  StrCmp $Updating 1 0 done
  !insertmacro MUI_HEADER_TEXT "Updating LingerX" "Updating LingerX to ${VERSION}..."
  done:
FunctionEnd

Function SkipWhenUpdating
  StrCmp $Updating 1 0 +2
  Abort
FunctionEnd

; A running LingerX holds its files open. Its services, run on LingerX.exe, are
; stopped again on Retry, in case it started them before it quit.
!macro CLOSE_LINGER UN
Function ${UN}CloseLinger
  retry:
  ClearErrors
  IfFileExists "$INSTDIR\LingerX.exe" 0 done
  Delete "$INSTDIR\LingerX.exe"
  IfErrors 0 done
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "LingerX is running. Quit it from its icon in the notification area, then select Retry." IDRETRY again
  Abort
  again:
  Call ${UN}StopLinger
  Goto retry
  done:
FunctionEnd
!macroend
!insertmacro CLOSE_LINGER ""
!insertmacro CLOSE_LINGER "un."

; Uninstalling, and installing over an earlier release, stops what LingerX
; runs, so nothing keeps running or holds a file (the services run on
; LingerX.exe as their Node): a running LingerX quits (index.ts), then an
; installer script, run by the app's own Node, stops the installation manager
; and the services of the local installation (TeamHub, web, node-services,
; LiveKit, PostgreSQL). The script ends on its own after a time limit. An
; install goes on whatever it reports, and LingerX starts the services again.
; An uninstall that cannot stop them asks to retry; cancelled (or silent), it
; fails with exit code 1 and removes nothing, so it can be run again. Data
; stays either way.
!define INSTALLER_SCRIPT "$INSTDIR\resources\app\dist\installer\installer.js"
!define STOP_MARKER "$INSTDIR\resources\stops-services"
; $R0 is the installer script that stops the services.
!macro STOP_LINGER UN
Function ${UN}StopLinger
  IfFileExists "$INSTDIR\LingerX.exe" 0 done
  IfFileExists "${STOP_MARKER}" 0 stop
  ; Without a running LingerX this exits at once.
  ExecWait '"$INSTDIR\LingerX.exe" --quit'
  stop:
  IfFileExists "$R0" 0 stopped
  DetailPrint "Stopping LingerX on this computer..."
  System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1")'
  nsExec::ExecToLog '"$INSTDIR\LingerX.exe" "$R0" --instance desktop --stop'
  Pop $0
  System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", n)'
  StrCmp $0 "0" stopped
  DetailPrint "Some of LingerX's services may still be running."
!if "${UN}" == "un."
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "LingerX couldn't stop all of its services. Close LingerX and try again." /SD IDCANCEL IDRETRY stop
  SetErrorLevel 1
  Abort
!endif
  stopped:
  ; Only a release that was asked to quit is waited for; a running earlier
  ; one never exits on its own and CloseLinger asks at once.
  IfFileExists "${STOP_MARKER}" 0 done
  ; The app takes a moment to quit; CloseLinger asks after that.
  StrCpy $1 0
  wait:
  ClearErrors
  Delete "$INSTDIR\LingerX.exe"
  IfErrors 0 done
  IntOp $1 $1 + 1
  IntCmp $1 20 done
  Sleep 500
  Goto wait
  done:
FunctionEnd
!macroend
!insertmacro STOP_LINGER ""
!insertmacro STOP_LINGER "un."

; An earlier release's services are stopped by this release's script, run
; by that release's LingerX.exe.
Function StopEarlierLinger
  IfFileExists "$INSTDIR\LingerX.exe" 0 done
  InitPluginsDir
  File "/oname=$PLUGINSDIR\stop.mjs" "${STAGE}\resources\app\dist\installer\installer.js"
  ; The temporary script reads distribution.json beside itself. Use the
  ; installed release's pins, since those are the tools it started.
  IfFileExists "$INSTDIR\resources\app\dist\installer\distribution.json" 0 +2
  CopyFiles /SILENT "$INSTDIR\resources\app\dist\installer\distribution.json" "$PLUGINSDIR"
  StrCpy $R0 "$PLUGINSDIR\stop.mjs"
  Call StopLinger
  done:
FunctionEnd

Section "LingerX"
  SetOutPath "$INSTDIR"
  Call StopEarlierLinger
  Call CloseLinger
  ; An update replaces the whole app folder.
  StrCpy $Replacing 1
  RMDir /r "$INSTDIR\resources"
  File /r "${STAGE}\*"
  FileOpen $0 "${STOP_MARKER}" w
  FileClose $0
  WriteUninstaller "$INSTDIR\Uninstall LingerX.exe"
  ; The app writes its notification id into this shortcut (index.ts).
  CreateShortcut "$SMPROGRAMS\LingerX.lnk" "$INSTDIR\LingerX.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "LingerX"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "LingerX"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\LingerX.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall LingerX.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

; Neither a silent install nor an update shows the finish page to start
; LingerX from.
Function .onInstSuccess
  StrCmp $Relaunch 1 0 done
  Exec '"$INSTDIR\LingerX.exe"'
  done:
FunctionEnd

; Runs after Cancel on a question, or Abort on a file that could not be
; written, once the person closes the window. An update that stopped before
; replacing files starts the earlier app again, which offers the update again;
; otherwise only this setup can bring LingerX back.
Function .onInstFailed
  StrCmp $Updating 1 0 done
  StrCmp $Replacing 1 rerun
  IfFileExists "$INSTDIR\LingerX.exe" 0 rerun
  MessageBox MB_OK|MB_ICONEXCLAMATION "LingerX was not updated. It will start again and offer the update again." /SD IDOK
  StrCmp $Relaunch 1 0 done
  Exec '"$INSTDIR\LingerX.exe"'
  Goto done
  rerun:
  MessageBox MB_OK|MB_ICONEXCLAMATION "LingerX was not updated and cannot start until it is. Run this setup again to finish the update:$\r$\n$EXEPATH" /SD IDOK
  done:
FunctionEnd

Section "Uninstall"
  ; Settings, sign-in and logs stay in %APPDATA%\LingerX, and the local
  ; installation (%USERPROFILE%\.lingerx) with its data.
  StrCpy $R0 "${INSTALLER_SCRIPT}"
  Call un.StopLinger
  Call un.CloseLinger
  Delete "$SMPROGRAMS\LingerX.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  ; "Open at login", named after the app id (index.ts).
  DeleteRegValue HKCU "${RUN_KEY}" "${APP_ID}"
SectionEnd
