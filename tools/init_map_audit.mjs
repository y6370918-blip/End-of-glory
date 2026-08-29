import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { createAuditManifest, sha256 } from "./map_audit_manifest.mjs"

const root = path.resolve(import.meta.dirname, "..")
const source = path.join(root, "data", "source")
const filename = path.join(source, "map_audit.json")
const [spaces, edges, mapSha256, previous] = await Promise.all([
	readFile(path.join(source, "spaces.json"), "utf8").then(JSON.parse),
	readFile(path.join(source, "edges.json"), "utf8").then(JSON.parse),
	sha256(path.join(root, "assets", "map.png")),
	readFile(filename, "utf8").then(JSON.parse).catch(() => null)
])
const manifest = createAuditManifest({ spaces, edges, mapSha256, previous })
await writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
process.stdout.write(`Initialized map audit: ${spaces.length} spaces, ${edges.length} edges, ${manifest.regions.length} regions.\n`)
