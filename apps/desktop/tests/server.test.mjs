import assert from "node:assert/strict"
import { mkdtemp, writeFile, mkdir, rm, symlink } from "node:fs/promises"
import { request } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { DESKTOP_PORT, startStaticServer } from "../server.mjs"

test("serves unchanged payload on loopback with browser MIME types and closes cleanly", async () => {
	const root = await mkdtemp(join(tmpdir(), "fluvi desktop ñ "))
	await mkdir(join(root, "src"))
	await writeFile(join(root, "index.html"), "<!doctype html><script src='src/app.js'></script>")
	await writeFile(join(root, "src/app.js"), "window.started = true")
	const server = await startStaticServer({ root, port: 0 })
	try {
		assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/)
		const page = await fetch(`${server.origin}/`)
		assert.match(page.headers.get("content-type"), /^text\/html/)
		assert.equal(await page.text(), "<!doctype html><script src='src/app.js'></script>")
		const script = await fetch(`${server.origin}/src/app.js?v=1`)
		assert.match(script.headers.get("content-type"), /javascript/)
		assert.equal(await script.text(), "window.started = true")
		const head = await fetch(`${server.origin}/src/app.js`, { method: "HEAD" })
		assert.equal(await head.text(), "")
		assert.equal(head.headers.get("content-length"), "21")
	} finally {
		await server.close()
		await rm(root, { recursive: true, force: true })
	}
	await assert.rejects(fetch(server.origin))
})

test("reuses the persistent default origin and fails explicitly instead of falling back when occupied", async () => {
	const root = await mkdtemp(join(tmpdir(), "fluvi-port-"))
	await writeFile(join(root, "index.html"), "FLUVI")
	const server = await startStaticServer({ root })
	try {
		assert.equal(server.origin, `http://127.0.0.1:${DESKTOP_PORT}`)
		await assert.rejects(startStaticServer({ root }), { code: "EADDRINUSE" })
	} finally {
		await server.close()
	}
	const restarted = await startStaticServer({ root })
	assert.equal(restarted.origin, `http://127.0.0.1:${DESKTOP_PORT}`)
	await restarted.close()
	await rm(root, { recursive: true, force: true })
})

function rawRequest(origin, path, headers = {}) {
	return new Promise((resolve, reject) => {
		const req = request(`${origin}/`, { path, headers }, (res) => {
			res.resume()
			res.on("end", () => resolve(res.statusCode))
		})
		req.on("error", reject)
		req.end()
	})
}

test("rejects traversal, symlink escapes, malformed paths, foreign hosts and writes", async () => {
	const parent = await mkdtemp(join(tmpdir(), "fluvi-security-"))
	const root = join(parent, "payload")
	await mkdir(root)
	await writeFile(join(root, "index.html"), "FLUVI")
	await writeFile(join(parent, "secret.txt"), "not public")
	// Directory junctions do not require Windows administrator/Developer Mode.
	await symlink(parent, join(root, "escape"), "junction")
	const server = await startStaticServer({ root, port: 0 })
	try {
		for (const path of [
			"/../secret.txt", "/%2e%2e/secret.txt", "/%2e%2e%2fsecret.txt",
			"/..%5csecret.txt", "/%00", "/%zz", "/escape/secret.txt",
			"//example.com/secret.txt", "http://example.com/",
		]) {
			assert.equal(await rawRequest(server.origin, path), 403, path)
		}
		assert.equal(await rawRequest(server.origin, "/", { Host: "evil.example" }), 403)
		assert.equal((await fetch(`${server.origin}/missing`)).status, 404)
		assert.equal((await fetch(`${server.origin}/`, { method: "POST", body: "write" })).status, 405)
		assert.equal(await (await fetch(server.origin)).text(), "FLUVI")
	} finally {
		await server.close()
		await rm(parent, { recursive: true, force: true })
	}
})
