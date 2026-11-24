import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { stagePayload } from "./stage-payload.mjs"

// This is the supported release toolchain. No untested Wine/cross-build promise.
if (process.platform !== "win32" || process.arch !== "x64") {
	throw new Error("Build the portable release on Windows x64 with Node.js 24 and pnpm 11. See docs/v1/desktop.md.")
}
await stagePayload()
const cli = fileURLToPath(new URL("../node_modules/electron-builder/cli.js", import.meta.url))
const result = spawnSync(process.execPath, [cli, "--win", "portable", "--x64"], {
	cwd: fileURLToPath(new URL("../", import.meta.url)),
	stdio: "inherit",
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
