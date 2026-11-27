import { expect, it } from "vitest";
import {
  WITHOUT_ADMINISTRATORS_SCRIPT,
  windowsCommandLine,
} from "./windows-restricted-token.js";

it("quotes only the arguments the C runtime would split or lose", () => {
  expect(
    windowsCommandLine("C:\\pg\\bin\\postgres.exe", ["-p", "15432", "-k", ""]),
  ).toBe('C:\\pg\\bin\\postgres.exe -p 15432 -k ""');
  expect(
    windowsCommandLine("C:\\Program Files\\pg\\postgres.exe", [
      "-D",
      "C:\\Users\\Nora\\Nouveau dossier é\\data\\",
      'say "hi"',
      'a\\"b',
      "trailing\\",
    ]),
  ).toBe(
    '"C:\\Program Files\\pg\\postgres.exe" -D "C:\\Users\\Nora\\Nouveau dossier é\\data\\\\" "say \\"hi\\"" "a\\\\\\"b" trailing\\',
  );
});

it("restricts CreateProcessAsUserW inheritance to stdio handles via PROC_THREAD_ATTRIBUTE_HANDLE_LIST", () => {
  expect(WITHOUT_ADMINISTRATORS_SCRIPT).toContain("struct StartupInfoEx");
  expect(WITHOUT_ADMINISTRATORS_SCRIPT).toContain(
    "InitializeProcThreadAttributeList",
  );
  expect(WITHOUT_ADMINISTRATORS_SCRIPT).toContain("UpdateProcThreadAttribute");
  expect(WITHOUT_ADMINISTRATORS_SCRIPT).toContain("0x00020002");
  expect(WITHOUT_ADMINISTRATORS_SCRIPT).toContain("0x00080000");
  expect(WITHOUT_ADMINISTRATORS_SCRIPT).toContain(
    "DeleteProcThreadAttributeList",
  );
  expect(WITHOUT_ADMINISTRATORS_SCRIPT).toContain("CollectStdHandles");
});
