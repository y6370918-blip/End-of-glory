import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const defaultSave = path.join(
	process.env.USERPROFILE || "",
	"Documents",
	"My Games",
	"Tabletop Simulator",
	"Saves",
	"TS_Save_13.json"
)
const savePath = path.resolve(process.argv[2] || defaultSave)
const ttsCache = path.join(
	process.env.USERPROFILE || "",
	"Documents",
	"My Games",
	"Tabletop Simulator",
	"Mods",
	"Images"
)
const generatedDir = path.join(root, "data", "generated")
const recoveredDir = path.join(root, "assets", "source-recovered")

function mkdir(dir) {
	fs.mkdirSync(dir, { recursive: true })
}

function sha256(file) {
	const hash = crypto.createHash("sha256")
	hash.update(fs.readFileSync(file))
	return hash.digest("hex")
}

function walkFiles(dir, out = []) {
	if (!fs.existsSync(dir)) return out
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (["node_modules", ".git", "data", "cards", "pieces"].includes(entry.name) && dir === root) continue
		const file = path.join(dir, entry.name)
		if (entry.isDirectory()) walkFiles(file, out)
		else out.push(file)
	}
	return out
}

function cacheName(url) {
	if (!url) return ""
	return url.replace(/[^a-zA-Z0-9]/g, "") + ".png"
}

function flatten(objects, parent = null, trail = [], out = []) {
	for (let index = 0; index < (objects || []).length; index++) {
		const object = objects[index]
		const objectTrail = [...trail, index]
		out.push({ object, parent, trail: objectTrail })
		flatten(object.ContainedObjects, object, [...objectTrail, "contained"], out)
	}
	return out
}

function imageUrls(object) {
	const result = []
	if (object.CustomImage) {
		result.push(["face", object.CustomImage.ImageURL])
		result.push(["back", object.CustomImage.ImageSecondaryURL])
	}
	for (const [deckKey, deck] of Object.entries(object.CustomDeck || {})) {
		result.push([`deck-${deckKey}-face`, deck.FaceURL])
		result.push([`deck-${deckKey}-back`, deck.BackURL])
	}
	return result.filter(([, url]) => Boolean(url))
}

function round(value, places = 3) {
	const scale = 10 ** places
	return Math.round(Number(value || 0) * scale) / scale
}

function classify(object, parent) {
	if (object.Name === "Card" || object.Name === "Deck") return "card"
	if (object.Name === "Dice" || /dice|骰子/i.test(object.Nickname || "")) return "excluded"
	if (["Bag", "Infinite_Bag"].includes(object.Name)) return "container"
	if (object.Name === "Custom_Board") return "board"
	if (parent && ["Bag", "Infinite_Bag"].includes(parent.Name)) return "inventory"
	const t = object.Transform || {}
	if (t.posX >= -15.5 && t.posX <= 15.9 && t.posZ >= -11.4 && t.posZ <= 19.7) return "historical-setup"
	return "off-map"
}

function clusterSetup(records) {
	const clusters = []
	for (const record of records) {
		const t = record.transform
		let cluster = clusters.find((candidate) => {
			const dx = candidate.world.x - t.x
			const dz = candidate.world.z - t.z
			return Math.hypot(dx, dz) <= 0.36
		})
		if (!cluster) {
			cluster = {
				id: `stack-${String(clusters.length + 1).padStart(3, "0")}`,
				world: { x: t.x, z: t.z },
				objects: []
			}
			clusters.push(cluster)
		}
		cluster.objects.push(record.guid)
		const n = cluster.objects.length
		cluster.world.x = round((cluster.world.x * (n - 1) + t.x) / n)
		cluster.world.z = round((cluster.world.z * (n - 1) + t.z) / n)
	}
	return clusters
}

if (!fs.existsSync(savePath)) throw new Error(`TTS save not found: ${savePath}`)

mkdir(generatedDir)
mkdir(recoveredDir)

const save = JSON.parse(fs.readFileSync(savePath, "utf8"))
const flattened = flatten(save.ObjectStates)

const localByHash = new Map()
const originalSourceRoots = ["国旗", "游戏地图和卡牌和表格", "算子单位图标"]
for (const sourceRoot of originalSourceRoots) {
	for (const file of walkFiles(path.join(root, sourceRoot))) {
	if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(file)) continue
	try {
		const hash = sha256(file)
		if (!localByHash.has(hash)) localByHash.set(hash, path.relative(root, file).replaceAll("\\", "/"))
	} catch {
		// Ignore unreadable source files; the audit reports unresolved TTS URLs below.
	}
	}
}

const assetByUrl = new Map()
const unresolved = []
for (const { object } of flattened) {
	for (const [, url] of imageUrls(object)) {
		if (assetByUrl.has(url)) continue
		const cached = path.join(ttsCache, cacheName(url))
		if (!fs.existsSync(cached)) {
			assetByUrl.set(url, { url, status: "missing-cache" })
			unresolved.push(url)
			continue
		}
		const hash = sha256(cached)
		let relative = localByHash.get(hash)
		let status = "matched"
		if (!relative) {
			const target = path.join(recoveredDir, `${hash.slice(0, 16)}.png`)
			if (!fs.existsSync(target)) fs.copyFileSync(cached, target)
			relative = path.relative(root, target).replaceAll("\\", "/")
			localByHash.set(hash, relative)
			status = "recovered"
		}
		assetByUrl.set(url, { url, hash, path: relative, status })
	}
}

const records = flattened.map(({ object, parent, trail }) => {
	const transform = object.Transform || {}
	const images = Object.fromEntries(
		imageUrls(object).map(([side, url]) => [side, assetByUrl.get(url) || { url, status: "unresolved" }])
	)
	return {
		guid: object.GUID || null,
		path: trail.join("/"),
		parent_guid: parent?.GUID || null,
		name: object.Name || null,
		nickname: object.Nickname || "",
		description: object.Description || "",
		card_id: Number.isInteger(object.CardID) ? object.CardID : null,
		quantity: object.Number || 1,
		classification: classify(object, parent),
		transform: {
			x: round(transform.posX),
			y: round(transform.posY),
			z: round(transform.posZ),
			rot_y: round(transform.rotY),
			scale_x: round(transform.scaleX),
			scale_z: round(transform.scaleZ)
		},
		images
	}
})

const setupRecords = records.filter((record) => record.classification === "historical-setup")
const componentGroups = new Map()
for (const record of records) {
	if (!["Custom_Tile", "Custom_Token", "Custom_Model"].includes(record.name)) continue
	if (record.classification === "excluded") continue
	const face = record.images.face?.hash || record.images.face?.url || "none"
	const back = record.images.back?.hash || record.images.back?.url || face
	const key = `${face}:${back}`
	if (!componentGroups.has(key)) {
		componentGroups.set(key, {
			id: `component-${String(componentGroups.size + 1).padStart(3, "0")}`,
			face: record.images.face || null,
			back: record.images.back || null,
			count: 0,
			guids: []
		})
	}
	const group = componentGroups.get(key)
	group.count += 1
	group.guids.push(record.guid)
}

const deckCards = records
	.filter((record) => record.card_id >= 600 && record.card_id <= 758)
	.map((record) => record.card_id)
const cardIds = [...new Set(deckCards)].sort((a, b) => a - b)
const expectedCardIds = [
	...Array.from({ length: 59 }, (_, i) => 600 + i),
	...Array.from({ length: 59 }, (_, i) => 700 + i)
]

const byKind = {}
for (const record of records) byKind[record.name] = (byKind[record.name] || 0) + 1

const audit = {
	schema: 1,
	source: savePath,
	save_name: save.SaveName,
	game_mode: save.GameMode,
	top_level_count: save.ObjectStates.length,
	recursive_count: records.length,
	expected_recursive_count: 728,
	by_kind: Object.fromEntries(Object.entries(byKind).sort((a, b) => a[0].localeCompare(b[0]))),
	asset_summary: {
		urls: assetByUrl.size,
		matched: [...assetByUrl.values()].filter((asset) => asset.status === "matched").length,
		recovered: [...assetByUrl.values()].filter((asset) => asset.status === "recovered").length,
		missing_cache: unresolved.length
	},
	cards: {
		expected: expectedCardIds,
		found: cardIds,
		missing: expectedCardIds.filter((id) => !cardIds.includes(id)),
		unexpected: cardIds.filter((id) => !expectedCardIds.includes(id))
	},
	excluded_component_policy: ["Dice", "Dice Calculator", "HandTrigger", "PlayerPawn", "3DText"]
}

const setup = {
	schema: 1,
	board: records.find((record) => record.classification === "board") || null,
	objects: setupRecords,
	stacks: clusterSetup(setupRecords)
}

fs.writeFileSync(path.join(generatedDir, "tts-audit.json"), JSON.stringify(audit, null, 2) + "\n")
fs.writeFileSync(
	path.join(generatedDir, "tts-components.json"),
	JSON.stringify({ schema: 1, components: [...componentGroups.values()] }, null, 2) + "\n"
)
fs.writeFileSync(path.join(generatedDir, "tts-setup.json"), JSON.stringify(setup, null, 2) + "\n")
fs.writeFileSync(
	path.join(generatedDir, "tts-objects.json"),
	JSON.stringify({ schema: 1, objects: records }, null, 2) + "\n"
)

console.log(
	JSON.stringify(
		{
			recursive_objects: records.length,
			component_types: componentGroups.size,
			setup_objects: setupRecords.length,
			setup_stacks: setup.stacks.length,
			card_ids: cardIds.length,
			recovered_assets: audit.asset_summary.recovered,
			missing_cache: audit.asset_summary.missing_cache
		},
		null,
		2
	)
)
