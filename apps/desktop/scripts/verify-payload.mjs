import { cp, readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { payloadDirectory } from "./stage-payload.mjs"

async function inventory(directory) {
	const entries = await readdir(directory, { recursive: true, withFileTypes: true })
	return entries.map((entry) => ({
		path: relative(directory, join(entry.parentPath, entry.name)),
		type: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "unsupported",
	})).sort((a, b) => a.path.localeCompare(b.path))
}

export async function verifyPayload(expected, actual) {
	const reference = await inventory(expected)
	const packaged = await inventory(actual)
	const expectedPaths = new Map(reference.map((entry) => [entry.path, entry.type]))
	const packagedPaths = new Map(packaged.map((entry) => [entry.path, entry.type]))
	for (const entry of [...reference, ...packaged]) {
		if (entry.type === "unsupported" || expectedPaths.get(entry.path) !== packagedPaths.get(entry.path)) {
			throw new Error(`Packaged payload differs: ${entry.path}`)
		}
	}
	for (const entry of reference) {
		if (entry.type === "file") {
			const [before, after] = await Promise.all([
				readFile(join(expected, entry.path)), readFile(join(actual, entry.path)),
			])
			if (!before.equals(after)) throw new Error(`Packaged payload differs: ${entry.path}`)
		}
	}
}

// Copy outside ASAR without electron-builder's default file exclusions (.gitkeep,
// for example). This hook runs before electron-builder makes the portable EXE.
export default async function afterPack(context) {
	const destination = join(context.appOutDir, "resources", "payload")
	await cp(payloadDirectory, destination, { recursive: true })
	await verifyPayload(payloadDirectory, destination)
	console.log("Packaged FLUVI payload verified byte-for-byte")
}
