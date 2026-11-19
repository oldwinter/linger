import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

// makensis runs only in the Windows packaging; these check how its script
// stops Linger before files are replaced or removed.
const script = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../packaging/win/installer.nsi",
  ),
  "utf8",
);
const block = (start: string, end: string) => {
  const from = script.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  return script.slice(from, script.indexOf(end, from));
};
const order = (text: string, ...steps: string[]) => {
  const at = steps.map((step) => text.indexOf(step));
  expect(at.every((index) => index >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
};

it("stops an earlier release before an install replaces its files", () => {
  order(
    block('Section "Linger"', "SectionEnd"),
    "Call StopEarlierLinger",
    "Call CloseLinger",
    'RMDir /r "$INSTDIR\\resources"',
    'File /r "${STAGE}\\*"',
    'FileOpen $0 "${STOP_MARKER}" w',
  );
});

it("stops Linger before the uninstall removes it", () => {
  order(
    block('Section "Uninstall"', "SectionEnd"),
    'StrCpy $R0 "${INSTALLER_SCRIPT}"',
    "Call un.StopLinger",
    "Call un.CloseLinger",
    'RMDir /r "$INSTDIR"',
  );
});

it("asks only a release that knows --quit to quit, then runs the stop", () => {
  const stop = block("Function ${UN}StopLinger", "FunctionEnd");
  order(
    stop,
    'IfFileExists "${STOP_MARKER}" 0 stop',
    "--quit",
    "stop:",
    "--instance desktop --stop",
  );
});

it("waits for the app to exit only when it was asked to quit", () => {
  const stop = block("Function ${UN}StopLinger", "FunctionEnd");
  order(
    stop,
    "--instance desktop --stop",
    "stopped:",
    'IfFileExists "${STOP_MARKER}" 0 done',
    "Sleep 500",
    "done:",
  );
});

it("stops every earlier release with this release's script", () => {
  const earlier = block("Function StopEarlierLinger", "FunctionEnd");
  // An earlier release's own script may leave its services running.
  expect(earlier).not.toContain("STOP_MARKER");
  order(
    earlier,
    'IfFileExists "$INSTDIR\\Linger.exe" 0 done',
    "${STAGE}\\resources\\app\\dist\\installer\\installer.js",
    'StrCpy $R0 "$PLUGINSDIR\\stop.mjs"',
    "Call StopLinger",
  );
  expect(script).toContain(
    '!define INSTALLER_SCRIPT "$INSTDIR\\resources\\app\\dist\\installer\\installer.js"',
  );
});

it("stops the services again when Retry follows a running Linger", () => {
  order(
    block("Function ${UN}CloseLinger", "FunctionEnd"),
    "IDRETRY again",
    "again:",
    "Call ${UN}StopLinger",
    "Goto retry",
  );
});

it("reads /update and /relaunch from the command line", () => {
  order(
    block("Function .onInit", "FunctionEnd"),
    "${GetParameters} $0",
    '${GetOptions} $0 "/update" $1',
    "StrCpy $Updating 1",
    '${GetOptions} $0 "/relaunch" $1',
    "StrCpy $Relaunch 1",
  );
  expect(script).toContain('!include "FileFunc.nsh"');
});

it("starts Linger after an install only when asked to relaunch", () => {
  order(
    block("Function .onInstSuccess", "FunctionEnd"),
    "StrCmp $Relaunch 1 0 done",
    "Exec '\"$INSTDIR\\Linger.exe\"'",
    "done:",
  );
});

it("shows an update only its progress page", () => {
  order(
    script,
    "!define MUI_PAGE_CUSTOMFUNCTION_SHOW ShowProgress",
    "!insertmacro MUI_PAGE_INSTFILES",
    "!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipWhenUpdating",
    "!insertmacro MUI_PAGE_FINISH",
  );
  expect(script.match(/!insertmacro MUI_PAGE_/g)).toHaveLength(2);
  order(
    block("Function SkipWhenUpdating", "FunctionEnd"),
    "$Updating",
    "Abort",
  );
  order(
    block("Function ShowProgress", "FunctionEnd"),
    "$Updating",
    "Updating Linger to ${VERSION}",
  );
  // A custom folder from /D= stays where it is.
  expect(script).toContain(
    'InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"',
  );
});

it("starts the earlier app after a failed update only if no file was replaced", () => {
  order(
    block('Section "Linger"', "SectionEnd"),
    "Call RemoveLegacyInstall",
    "StrCpy $Replacing 1",
    'RMDir /r "$INSTDIR\\resources"',
  );
  const failed = block("Function .onInstFailed", "FunctionEnd");
  order(
    failed,
    "StrCmp $Updating 1 0 done",
    "StrCmp $Replacing 1 rerun",
    'IfFileExists "$INSTDIR\\Linger.exe" 0 rerun',
    "StrCmp $Relaunch 1 0 done",
    "Exec '\"$INSTDIR\\Linger.exe\"'",
    "rerun:",
    "Run this setup again",
    "$EXEPATH",
    "done:",
  );
});
