import { expect, it } from "vitest";
import { windowsCommandLine } from "./windows-restricted-token.js";

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
