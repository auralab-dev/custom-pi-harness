import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

/**
 * Thin loader only: all filesystem/tool enforcement is implemented by the
 * public pi-playpen package. Playpen's global config lives under ~/.pi, so we
 * temporarily give its module import a per-run HOME. The real HOME is restored
 * before the extension starts, preserving git/toolchain behavior for the run.
 */
export default async function scopedPlaypen(pi: ExtensionAPI) {
  const scopedHome = process.env.PI_HARNESS_PLAYPEN_HOME?.trim();
  const playpenEntry = process.env.PI_HARNESS_PLAYPEN_ENTRY?.trim();

  if (!scopedHome) {
    throw new Error("PI_HARNESS_PLAYPEN_HOME is required");
  }
  if (!playpenEntry) {
    throw new Error("PI_HARNESS_PLAYPEN_ENTRY is required");
  }

  const previousHome = process.env.HOME;
  let playpenModule: { default?: (api: ExtensionAPI) => unknown };
  try {
    process.env.HOME = scopedHome;
    const jiti = createJiti(import.meta.url, { interopDefault: false });
    playpenModule = (await jiti.import(playpenEntry)) as {
      default?: (api: ExtensionAPI) => unknown;
    };
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }

  if (typeof playpenModule.default !== "function") {
    throw new Error(`pi-playpen has no default extension export: ${playpenEntry}`);
  }

  return await playpenModule.default(pi);
}
