import { createServer } from "node:http"
import { readFile, realpath, stat } from "node:fs/promises"
import { extname, resolve, sep } from "node:path"

// Deliberately stable: changing this origin would hide existing localStorage.
export const DESKTOP_PORT = 47831

const contentTypes = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".py": "text/plain; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".wasm": "application/wasm",
}

function decodePayloadPath(url) {
	try {
		const pathname = decodeURIComponent(url.split("?")[0])
		if (!pathname.startsWith("/") || pathname.startsWith("//") ||
			/[\\\0]/.test(pathname) || pathname.split("/").includes("..")) return null
		return pathname
	} catch {
		return null
	}
}

async function servePayloadFile(payload, pathname, method, response) {
	const file = resolve(payload, pathname === "/" ? "index.html" : `.${pathname}`)
	const canonical = await realpath(file)
	if (!canonical.startsWith(`${payload}${sep}`)) {
		response.writeHead(403).end()
		return
	}
	if (!(await stat(canonical)).isFile()) {
		response.writeHead(404).end()
		return
	}
	const data = await readFile(canonical)
	response.writeHead(200, {
		"Content-Type": contentTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
		"Content-Length": data.length,
		"X-Content-Type-Options": "nosniff",
		"Cache-Control": "no-store",
	})
	response.end(method === "HEAD" ? undefined : data)
}

export async function startStaticServer({ root, port = DESKTOP_PORT }) {
	const payload = await realpath(root)
	await stat(resolve(payload, "index.html"))
	const server = createServer(async (request, response) => {
		try {
			const deny = () => response.writeHead(403).end()
			if (request.headers.host !== `127.0.0.1:${server.address().port}`) {
				deny()
				return
			}
			if (!["GET", "HEAD"].includes(request.method)) {
				response.writeHead(405, { Allow: "GET, HEAD" }).end()
				return
			}
			const pathname = decodePayloadPath(request.url)
			if (pathname === null) {
				deny()
				return
			}
			await servePayloadFile(payload, pathname, request.method, response)
		} catch {
			response.writeHead(404).end()
		}
	})
	await new Promise((resolveReady, reject) => {
		server.once("error", reject)
		server.listen(port, "127.0.0.1", resolveReady)
	})
	return {
		origin: `http://127.0.0.1:${server.address().port}`,
		close: () => new Promise((resolveClosed, reject) => {
			server.close((error) => error ? reject(error) : resolveClosed())
			server.closeAllConnections()
		}),
	}
}
