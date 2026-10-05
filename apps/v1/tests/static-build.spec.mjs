import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { buildStaticSite } from "../scripts/build-static.mjs"

test("static deployment preserves classic scripts and ships local runtime resources", async () => {
	const output = await mkdtemp(join(tmpdir(), "fluvi-static-build-"))
	try {
		await buildStaticSite(output)
		const html = await readFile(join(output, "index.html"), "utf8")
		expect(html).toBe(await readFile(new URL("../index.html", import.meta.url), "utf8"))
		const urls = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)]
			.map((match) => match[1])
			.filter((url) => !/^(?:https?:|#|data:)/.test(url))
		for (const url of urls) {
			expect((await stat(join(output, url))).isFile(), url).toBe(true)
		}
		for (const entry of ["src/python/analizador.py", "assets/images/vehicles"]) {
			await stat(join(output, entry))
		}
	} finally {
		await rm(output, { recursive: true, force: true })
	}
})

test("build refuses to overwrite application sources", async () => {
	await expect(buildStaticSite(fileURLToPath(new URL("../", import.meta.url))))
		.rejects.toThrow("Build output must not contain")
})
