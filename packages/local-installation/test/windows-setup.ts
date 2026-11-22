import { inject } from "vitest";
import type {} from "./windows-global-setup.js";

const { temporary, modules } = inject("windowsFixtures");
process.env.TMP = temporary;
process.env.TEMP = temporary;
process.env.PSModulePath = modules;
