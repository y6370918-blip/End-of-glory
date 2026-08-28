import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const readJson = async (name) => JSON.parse(await readFile(join(root, "data", "source", name), "utf8"))
const setup = await readJson("setup.json")
const forceManualSetup = process.argv.includes("--force-manual-setup")
if (setup.historical?.setup_source === "rules.js") {
	throw new Error("Historical setup is defined in rules.js; this legacy TTS location tool cannot overwrite it.")
}
if (setup.historical?.setup_source === "manual" && !forceManualSetup) {
	throw new Error(
		"Refusing to overwrite manual setup. Pass --force-manual-setup to recalculate it from TTS coordinates."
	)
}
const [spaces, pieces, ui] = await Promise.all([
	readJson("spaces.json"),
	readJson("pieces.json"),
	readJson("ui.json")
])
const pieceById = Object.fromEntries(pieces.map((piece) => [piece.id, piece]))
const spacesForFaction = {
	ap: spaces.filter((space) => space.faction === "ap" && !space.ui?.hidden),
	cp: spaces.filter((space) => space.faction === "cp" && !space.ui?.hidden)
}
const occupancy = Object.fromEntries(spaces.map((space) => [space.id, 0]))

for (const object of setup.historical.objects) {
	const piece = pieceById[object.component]
	if (object.zone !== "map" || !piece || !["army", "corps", "hq"].includes(piece.type)) continue
	const faction = piece.faction || (["ge", "ah"].includes(piece.nation) ? "cp" : "ap")
	let candidates = spacesForFaction[faction]
	const national = candidates.filter((space) => space.nation === piece.nation)
	if (national.length) candidates = national
	const transformed = {
		x: ((Number(object.world.x) + 15.5) / 31.5) * ui.map.width,
		y: ((19.5 - Number(object.world.z)) / 30.7) * ui.map.height
	}
	const location = candidates.reduce((best, space) => {
		const distance = Math.hypot(space.ui.x - transformed.x, space.ui.y - transformed.y) + occupancy[space.id] * 150
		return !best || distance < best.distance ? { id: space.id, distance } : best
	}, null)?.id
	if (!location) throw new Error(`No map location for ${object.guid}`)
	object.location = location
	occupancy[location] += 1
}

setup.historical.setup_source = "tts-derived"
setup.historical.location_source = "tts-coordinate-match"
await writeFile(join(root, "data", "source", "setup.json"), `${JSON.stringify(setup, null, 2)}\n`)
console.log(`Frozen ${Object.values(occupancy).reduce((sum, count) => sum + count, 0)} map-unit locations.`)
