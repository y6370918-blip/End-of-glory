import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const source = path.join(root, "data", "source")
const manifestFile = path.join(source, "map_audit.json")
const [manifest, spaces] = await Promise.all([
	readFile(manifestFile, "utf8").then(JSON.parse),
	readFile(path.join(source, "spaces.json"), "utf8").then(JSON.parse)
])
const region = "01_northwest"
const proposals = {
	ostend: { terrain: "swamp" },
	veurne: { port: true },
	calais: { fort: 2, ui: { x: 1300, y: 620, w: 236, h: 240 } },
	antwerp: { fort: 1, ui: { x: 2795, y: 456, w: 236, h: 240 } },
	brussels: { ui: { x: 2768, y: 813, w: 184, h: 184 } },
	lille: { ui: { x: 1925, y: 994, w: 236, h: 240 } },
	maubeuge: { ui: { x: 2491, y: 1368, w: 236, h: 240 } },
	cambrai: { ui: { x: 2098, y: 1464, w: 184, h: 184 } },
	amiens: { fort: 2, ui: { x: 1404, y: 1521, w: 236, h: 240 } }
}
for (const space of spaces) {
	const record = manifest.spaces[space.id]
	if (record?.region !== region) continue
	record.status = "pending"
	record.decision = proposals[space.id] ? "update" : "keep"
	if (proposals[space.id]) record.proposal = proposals[space.id]
	else delete record.proposal
}
for (const record of Object.values(manifest.edges)) {
	if (!record.regions?.includes(region)) continue
	record.status = "pending"
	record.decision = "keep"
	record.confirmed_regions = (record.confirmed_regions || []).filter((value) => value !== region)
	delete record.proposal
}
manifest.region_reviews[region] = { status: "pending", revision: null }
await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
process.stdout.write(`Recorded region 01 proposals: ${Object.keys(proposals).length} space updates; connections remain pending user confirmation.\n`)
