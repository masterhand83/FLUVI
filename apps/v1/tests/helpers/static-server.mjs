import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join, normalize, sep } from "node:path"

const MIME_TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
}

function resolveFile(rootDir, requestPath) {
	const decoded = decodeURIComponent(new URL(requestPath, "http://localhost").pathname)
	const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "")
	const filePath = normalize(join(rootDir, relative))
	if (!filePath.startsWith(normalize(rootDir) + sep) && filePath !== normalize(rootDir)) {
		return null
	}
	return filePath
}

export async function startStaticServer(rootDir) {
	const server = createServer(async (req, res) => {
		const filePath = resolveFile(rootDir, req.url ?? "/")
		if (!filePath) {
			res.writeHead(403)
			res.end("Forbidden")
			return
		}
		try {
			const body = await readFile(filePath)
			const type = MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream"
			res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" })
			res.end(body)
		} catch {
			res.writeHead(404)
			res.end("Not found")
		}
	})

	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
	const address = server.address()
	return {
		url: `http://127.0.0.1:${address.port}/index.html`,
		close: () => new Promise((resolve) => server.close(resolve)),
	}
}
