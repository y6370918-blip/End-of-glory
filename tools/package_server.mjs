import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const distRoot = path.resolve(root, "dist")
const target = path.resolve(distRoot, "end-of-glory")
if (!target.startsWith(`${distRoot}${path.sep}`)) throw new Error("Unsafe deployment target")

const runtimeEntries = [
	"about.html",
	"action-protocol.js",
	"cards.html",
	"charts.html",
	"client-ui.js",
	"connection-data.js",
	"cover.1x.jpg",
	"cover.2x.jpg",
	"create.html",
	"data.js",
	"modules",
	"package.json",
	"piece-scene.js",
	"play.css",
	"play.html",
	"play.js",
	"replay.js",
	"rules.html",
	"rules.js",
	"thumbnail.jpg",
	"title.sql",
]

const runtimeAssetEntries = [
	"cards",
	"pieces",
	"cover.webp",
	"crt.webp",
	"map.png",
	"map.webp",
]

function copyEntry(source, destination) {
	const stat = fs.statSync(source)
	if (!stat.isDirectory()) {
		fs.mkdirSync(path.dirname(destination), { recursive: true })
		fs.copyFileSync(source, destination)
		return
	}
	fs.mkdirSync(destination, { recursive: true })
	for (const entry of fs.readdirSync(source))
		copyEntry(path.join(source, entry), path.join(destination, entry))
}

fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(target, { recursive: true })
for (const entry of runtimeEntries) {
	const source = path.join(root, entry)
	if (!fs.existsSync(source)) throw new Error(`Missing runtime entry: ${entry}`)
	copyEntry(source, path.join(target, entry))
}
for (const entry of runtimeAssetEntries) {
	const source = path.join(root, "assets", entry)
	if (!fs.existsSync(source)) throw new Error(`Missing runtime asset: assets/${entry}`)
	copyEntry(source, path.join(target, "assets", entry))
}

const files = []
function collect(directory) {
	for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
		const filename = path.join(directory, item.name)
		if (item.isDirectory()) collect(filename)
		else {
			const relative = path.relative(target, filename).replaceAll("\\", "/")
			files.push({
				path: relative,
				bytes: fs.statSync(filename).size,
				sha256: crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex"),
			})
		}
	}
}
collect(target)
files.sort((a, b) => a.path.localeCompare(b.path))
fs.writeFileSync(path.join(target, "DEPLOYMENT.json"), `${JSON.stringify({ schema: 1, files }, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ target, files: files.length })}\n`)
