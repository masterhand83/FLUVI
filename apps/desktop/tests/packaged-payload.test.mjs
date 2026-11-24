import assert from "node:assert/strict"
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { stagePayload } from "../scripts/stage-payload.mjs"
import { verifyPayload } from "../scripts/verify-payload.mjs"

test("packaging verification rejects omitted, rewritten, or extra payload resources", async () => {
	const parent = await mkdtemp(join(tmpdir(), "fluvi-package-"))
	const expected = join(parent, "static")
	const actual = join(parent, "resources", "payload")
	try {
		await stagePayload(expected)
		await cp(expected, actual, { recursive: true })
		await verifyPayload(expected, actual)
		await writeFile(join(actual, "index.html"), "rewritten desktop HTML")
		await assert.rejects(verifyPayload(expected, actual), /index.html/)
		await cp(join(expected, "index.html"), join(actual, "index.html"))
		await rm(join(actual, "src/python/analizador.py"))
		await assert.rejects(verifyPayload(expected, actual), /analizador.py/)
		await cp(join(expected, "src/python/analizador.py"), join(actual, "src/python/analizador.py"))
		await writeFile(join(actual, "secret.txt"), "checkout data")
		await assert.rejects(verifyPayload(expected, actual), /secret.txt/)
	} finally {
		await rm(parent, { recursive: true, force: true })
	}
})
