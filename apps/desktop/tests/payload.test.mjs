import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { stagePayload } from "../scripts/stage-payload.mjs"

test("desktop payload preserves every static application byte without shipping checkout files", async () => {
	const parent = await mkdtemp(join(tmpdir(), "fluvi-payload-"))
	const output = join(parent, "payload")
	const source = new URL("../../v1/", import.meta.url)
	try {
		await stagePayload(output)
		assert.deepEqual((await readdir(output)).sort(), ["assets", "index.html", "src"])
		for (const entry of ["index.html", "src", "assets"]) {
			const paths = entry === "index.html" ? [entry] :
				(await readdir(new URL(entry, source), { recursive: true, withFileTypes: true }))
					.filter((file) => file.isFile())
					.map((file) => relative(fileURLToPath(source), join(file.parentPath, file.name)))
			for (const path of paths) {
				assert.deepEqual(await readFile(join(output, path)), await readFile(join(fileURLToPath(source), path)), path)
			}
		}
	} finally {
		await rm(parent, { recursive: true, force: true })
	}
})
