; Uses electron-builder's NSIS include macros. Keep extraction private to each
; launcher process, including a second launch refused by Electron's profile lock.
!include "common.nsh"
!include "extractAppPackage.nsh"
CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}

Function .onInit
  SetSilent silent
  !insertmacro check64BitAndSetRegView
FunctionEnd

Section
  InitPluginsDir
  StrCmp $PLUGINSDIR "" 0 +2
    Abort
  StrCpy $INSTDIR "$PLUGINSDIR\app"
  SetOutPath $INSTDIR
  !ifdef APP_DIR_64
    File /r "${APP_DIR_64}\*.*"
  !else
    !insertmacro extractEmbeddedAppPackage
  !endif
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  ${StdUtils.GetAllParameters} $R0 0
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" $R0' $0
  SetErrorLevel $0
  SetOutPath $EXEDIR
  RMDir /r "$PLUGINSDIR\app"
SectionEnd
