import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, normalize } from "node:path"

const root = normalize(join(import.meta.dirname, ".."))
const publicRoot = normalize(join(root, ".."))
const port = Number(process.argv[2] || 8765)
const mime = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webp": "image/webp"
}

createServer(async (request, response) => {
	const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname)
	const relative = pathname === "/" ? "about.html" : pathname.replace(/^\/+/, "")
	const shared = /^(common|fonts|images)\//.test(relative)
	const base = shared ? publicRoot : root
	const filename = normalize(join(base, relative))
	if (!filename.startsWith(base)) {
		response.writeHead(403).end("Forbidden")
		return
	}
	try {
		const info = await stat(filename)
		if (!info.isFile()) throw new Error("Not a file")
		response.writeHead(200, {
			"Cache-Control": "no-store",
			"Content-Type": mime[extname(filename).toLowerCase()] || "application/octet-stream"
		})
		createReadStream(filename).pipe(response)
	} catch {
		response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found")
	}
}).listen(port, "127.0.0.1", () => {
	process.stdout.write(`End of Glory preview: http://127.0.0.1:${port}\n`)
})
