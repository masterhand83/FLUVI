import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { stagePayload } from "./stage-payload.mjs"

export function releaseArguments(target, platform = process.platform, arch = process.arch) {
	switch (target) {
		case "win":
			if (platform !== "win32" || arch !== "x64") {
				throw new Error("Build the Windows release on Windows x64. See docs/v1/desktop.md.")
			}
			return ["--win", "portable", "--x64"]
		case "linux":
			if (platform !== "linux" || arch !== "x64") {
				throw new Error("Build the Ubuntu release on Linux x64. See docs/v1/desktop.md.")
			}
			return ["--linux", "AppImage", "deb", "--x64"]
		case "mac":
			if (platform !== "darwin" || !["x64", "arm64"].includes(arch)) {
				throw new Error("Build the macOS release on macOS with native x64 or arm64 Node.js. See docs/v1/desktop.md.")
			}
			return ["--mac", "dmg", "zip", `--${arch}`]
		default:
			throw new Error(`Unknown release target: ${target}. Use win, linux, or mac.`)
	}
}

export async function packageRelease(target) {
	const args = releaseArguments(target)
	await stagePayload()
	const cli = fileURLToPath(new URL("../node_modules/electron-builder/cli.js", import.meta.url))
	const result = spawnSync(process.execPath, [cli, ...args], {
		cwd: fileURLToPath(new URL("../", import.meta.url)),
		stdio: "inherit",
	})
	if (result.error) throw result.error
	process.exitCode = result.status ?? 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await packageRelease(process.argv[2])
}
