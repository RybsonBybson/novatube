/*
 * NovaTube installer hooks (Tauri NSIS).
 *
 * Asks whether NovaTube should be added to the user PATH and keeps that answer
 * stable across automatic updates:
 *
 *   - interactive install: a Yes/No prompt is shown once the files are in place;
 *   - passive/silent run:  the stored answer is re-applied without any prompt.
 *     The updater always launches the installer with `/P /UPDATE`, and a
 *     message box there would block the update forever;
 *   - uninstall:           the entry is removed again.
 *
 * The user PATH (`HKCU\Environment`) is edited directly so the value keeps its
 * REG_EXPAND_SZ type, and `WM_SETTINGCHANGE` is broadcast so terminals that are
 * already open pick the change up.
 *
 * Note: a custom page cannot be used here. Tauri's installer template only
 * exposes the PRE/POST INSTALL/UNINSTALL hooks, and a page declared from this
 * file (which is included before the built-in ones) would be shown before the
 * welcome screen.
 */

!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "StrFunc.nsh"

; StrFunc needs its helpers declared at global scope, and only defines each one
; once. `/IfNDef` keeps this file safe regardless of what the main script did.
!define /IfNDef __GLOBAL__
!insertmacro STRFUNC_USING StrTok
!insertmacro STRFUNC_USING UnStrTok

; Name of the PATH registry value. Only the local hook test overrides it, to
; work against a scratch value instead of the real PATH.
!ifndef NOVA_PATH_VALUE
  !define NOVA_PATH_VALUE "Path"
!endif

; Remembers the answer across updates.
!define NOVA_FLAG_KEY "Software\NovaTube"
!define NOVA_FLAG_VALUE "AddToPath"

!define NOVA_PROMPT "Add NovaTube to the PATH?$\r$\n$\r$\nThis lets you run the novatube command, and the Python wrapper, from any terminal window.$\r$\n$\r$\nYou can change this later by running the installer again."

Var NovaPathWanted
Var NovaPathNoPages

/* ============================== PATH handling ============================== */

; Tell running shells that the environment changed.
Function NovaPathNotify
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=3000
FunctionEnd

; Append $INSTDIR to the user PATH unless an equal entry is already there.
; Comparison is case-insensitive, so a manually edited entry is recognised.
Function NovaPathAdd
  ReadRegStr $0 HKCU "Environment" "${NOVA_PATH_VALUE}"
  StrCpy $1 ""
  StrCpy $2 0

  novapath_add_scan:
    ${StrTok} $3 $0 ";" $2 "1"
    StrCmp $3 "" novapath_add_append
    StrCmp $3 $INSTDIR novapath_add_present
    ${If} $1 == ""
      StrCpy $1 "$3"
    ${Else}
      StrCpy $1 "$1;$3"
    ${EndIf}
    IntOp $2 $2 + 1
    Goto novapath_add_scan

  novapath_add_present:
    Return

  novapath_add_append:
    ${If} $1 == ""
      StrCpy $1 "$INSTDIR"
    ${Else}
      StrCpy $1 "$1;$INSTDIR"
    ${EndIf}
    WriteRegExpandStr HKCU "Environment" "${NOVA_PATH_VALUE}" "$1"
    Call NovaPathNotify
FunctionEnd

; Drop every entry equal to $INSTDIR from the user PATH.
Function NovaPathRemove
  ReadRegStr $0 HKCU "Environment" "${NOVA_PATH_VALUE}"
  StrCpy $1 ""
  StrCpy $2 0

  novapath_remove_scan:
    ${StrTok} $3 $0 ";" $2 "1"
    StrCmp $3 "" novapath_remove_done
    StrCmp $3 $INSTDIR novapath_remove_next
    ${If} $1 == ""
      StrCpy $1 "$3"
    ${Else}
      StrCpy $1 "$1;$3"
    ${EndIf}
  novapath_remove_next:
    IntOp $2 $2 + 1
    Goto novapath_remove_scan

  novapath_remove_done:
    ; Untouched (nothing matched) means there is nothing to write back.
    StrCmp $1 $0 novapath_remove_end
    WriteRegExpandStr HKCU "Environment" "${NOVA_PATH_VALUE}" "$1"
    Call NovaPathNotify
  novapath_remove_end:
FunctionEnd

; `$NovaPathNoPages` is 1 when the run shows no pages at all: `/S` (silent) or
; `/P` (passive, what the updater uses). `$PassiveMode` cannot be used here:
; the main script declares it after this file is included.
Function NovaPathDetectMode
  StrCpy $NovaPathNoPages 0
  ${If} ${Silent}
    StrCpy $NovaPathNoPages 1
    Return
  ${EndIf}
  ${GetOptions} $CMDLINE "/P" $0
  ${IfNot} ${Errors}
    StrCpy $NovaPathNoPages 1
  ${EndIf}
FunctionEnd

; Ask the user. The stored answer picks the default button, so re-installing
; shows the same choice that was made last time.
Function NovaPathAsk
  StrCpy $NovaPathWanted ""
  ReadRegDWORD $NovaPathWanted HKCU "${NOVA_FLAG_KEY}" "${NOVA_FLAG_VALUE}"

  StrCpy $1 0

!ifdef NOVA_PATH_TEST_ANSWER
  ; Test hook: pretend the user clicked the given button.
  StrCpy $1 ${NOVA_PATH_TEST_ANSWER}
!else
  ${If} $NovaPathWanted == 0
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "${NOVA_PROMPT}" IDYES novapath_ask_yes
  ${Else}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "${NOVA_PROMPT}" IDYES novapath_ask_yes
  ${EndIf}
  Goto novapath_ask_done
  novapath_ask_yes:
    StrCpy $1 1
  novapath_ask_done:
!endif

  StrCpy $NovaPathWanted $1
  WriteRegDWORD HKCU "${NOVA_FLAG_KEY}" "${NOVA_FLAG_VALUE}" $NovaPathWanted
  ${If} $NovaPathWanted == 1
    Call NovaPathAdd
  ${Else}
    Call NovaPathRemove
  ${EndIf}
FunctionEnd

/* =============================== the hooks ================================ */

!macro NSIS_HOOK_POSTINSTALL
  Call NovaPathDetectMode
  ${If} $NovaPathNoPages == 1
    ; No prompt during a silent or passive install. A missing answer leaves the
    ; environment untouched, so a scripted `/S` install never surprises anyone.
    StrCpy $NovaPathWanted ""
    ReadRegDWORD $NovaPathWanted HKCU "${NOVA_FLAG_KEY}" "${NOVA_FLAG_VALUE}"
    ${If} $NovaPathWanted == 1
      Call NovaPathAdd
    ${ElseIf} $NovaPathWanted == 0
      Call NovaPathRemove
    ${EndIf}
  ${Else}
    Call NovaPathAsk
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; An in-place update keeps the entry; a real uninstall drops it.
  ${If} $UpdateMode <> 1
    Call un.NovaPathRemove
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "${NOVA_FLAG_KEY}" "${NOVA_FLAG_VALUE}"
    DeleteRegKey /ifempty HKCU "${NOVA_FLAG_KEY}"
  ${EndIf}
!macroend

/* ============================ uninstall helpers =========================== */

Function un.NovaPathNotify
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=3000
FunctionEnd

Function un.NovaPathRemove
  ReadRegStr $0 HKCU "Environment" "${NOVA_PATH_VALUE}"
  StrCpy $1 ""
  StrCpy $2 0

  un_novapath_remove_scan:
    ${UnStrTok} $3 $0 ";" $2 "1"
    StrCmp $3 "" un_novapath_remove_done
    StrCmp $3 $INSTDIR un_novapath_remove_next
    ${If} $1 == ""
      StrCpy $1 "$3"
    ${Else}
      StrCpy $1 "$1;$3"
    ${EndIf}
  un_novapath_remove_next:
    IntOp $2 $2 + 1
    Goto un_novapath_remove_scan

  un_novapath_remove_done:
    StrCmp $1 $0 un_novapath_remove_end
    WriteRegExpandStr HKCU "Environment" "${NOVA_PATH_VALUE}" "$1"
    Call un.NovaPathNotify
  un_novapath_remove_end:
FunctionEnd
