import { cp, mkdir, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = fileURLToPath(new URL("../", import.meta.url))

// Preserve classic-script scope, HTML load order, and runtime asset URLs.
export async function buildStaticSite(outDir = resolve(rootDir, "dist")) {
	const output = resolve(outDir)
	if (output === rootDir || rootDir.startsWith(`${output}/`) ||
		(output.startsWith(`${rootDir}/`) && output !== resolve(rootDir, "dist"))) {
		throw new Error("Build output must not contain the application source directory")
	}
	await rm(output, { recursive: true, force: true })
	await mkdir(output, { recursive: true })
	for (const entry of ["index.html", "src", "assets"]) {
		await cp(resolve(rootDir, entry), resolve(output, entry), { recursive: true })
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await buildStaticSite()
	console.log("Static site built in apps/v1/dist")
}
