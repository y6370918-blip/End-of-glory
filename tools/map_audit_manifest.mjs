import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

export const MAP_AUDIT_REGIONS = Object.freeze([
	{ id: "01_northwest", name: "英国、海峡、比利时与法国北部" },
	{ id: "02_france_central", name: "法国西部与中部" },
	{ id: "03_northeast", name: "阿登、洛林、德国西部与阿尔萨斯" },
	{ id: "04_france_south", name: "法国南部、勃艮第与汝拉" },
	{ id: "05_italy", name: "意大利与奥匈边境战场" }
])

export const MAP_AUDIT_STATUSES = Object.freeze(["pending", "confirmed", "disputed"])
export const MAP_AUDIT_DECISIONS = Object.freeze(["review", "keep", "update", "add", "remove"])
const clone = (value) => JSON.parse(JSON.stringify(value))

export function edgeKey(a, b) {
	return [a, b].sort().join("|")
}

export function regionForSpace(space) {
	const { x, y } = space.ui || {}
	if (x >= 3000 && y >= 4000) return "05_italy"
	if (x >= 3000 && y < 4000) return "03_northeast"
	if (x < 3000 && y >= 2800) return "04_france_south"
	if (x < 3000 && y < 1700) return "01_northwest"
	return "02_france_central"
}

function cleanSpaceRecord(record, region) {
	let proposal
	if (record?.decision === "add" && record?.proposal) proposal = clone(record.proposal)
	else if (record?.proposal) {
		proposal = {}
		if (record.proposal.ui) proposal.ui = clone(record.proposal.ui)
		if (Object.hasOwn(record.proposal, "vp")) proposal.vp = Boolean(record.proposal.vp)
		if (!Object.keys(proposal).length) proposal = undefined
	}
	const decision = record?.decision === "update" && !proposal
		? "review"
		: MAP_AUDIT_DECISIONS.includes(record?.decision) ? record.decision : "review"
	return {
		region,
		status: MAP_AUDIT_STATUSES.includes(record?.status) ? record.status : "pending",
		decision,
		...(proposal ? { proposal } : {}),
		...(record?.note ? { note: record.note } : {}),
		...(record?.evidence ? { evidence: record.evidence } : {})
	}
}

function cleanEdgeRecord(record, regions) {
	const confirmed = Array.isArray(record?.confirmed_regions)
		? record.confirmed_regions.filter((region) => regions.includes(region))
		: record?.status === "confirmed" ? [...regions] : []
	return {
		regions,
		confirmed_regions: [...new Set(confirmed)].sort(),
		status: MAP_AUDIT_STATUSES.includes(record?.status) ? record.status : "pending",
		decision: MAP_AUDIT_DECISIONS.includes(record?.decision) ? record.decision : "review",
		...(record?.proposal !== undefined ? { proposal: record.proposal } : {}),
		...(record?.note ? { note: record.note } : {}),
		...(record?.evidence ? { evidence: record.evidence } : {})
	}
}

export function createAuditManifest({ spaces, edges, mapSha256, previous = null }) {
	const oldSpaces = previous?.spaces || {}
	const oldEdges = previous?.edges || {}
	const regionBySpace = Object.fromEntries(spaces.map((space) => [space.id, oldSpaces[space.id]?.region || regionForSpace(space)]))
	const manifestSpaces = {}
	for (const space of spaces) manifestSpaces[space.id] = cleanSpaceRecord(oldSpaces[space.id], regionBySpace[space.id])
	for (const [id, record] of Object.entries(oldSpaces)) {
		if (manifestSpaces[id] || record.decision !== "add" || !record.proposal) continue
		regionBySpace[id] = record.region
		manifestSpaces[id] = cleanSpaceRecord(record, record.region)
	}
	const manifestEdges = {}
	for (const edge of edges) {
		const key = edgeKey(edge.a, edge.b)
		const regions = [...new Set([regionBySpace[edge.a], regionBySpace[edge.b]])].sort()
		manifestEdges[key] = cleanEdgeRecord(oldEdges[key], regions)
	}
	for (const [key, record] of Object.entries(oldEdges)) {
		if (manifestEdges[key] || !["add", "remove"].includes(record.decision)) continue
		const regions = record.regions || [...new Set(key.split("|").map((id) => regionBySpace[id]).filter(Boolean))].sort()
		manifestEdges[key] = cleanEdgeRecord(record, regions)
	}
	const previousReviews = previous?.region_reviews || {}
	const regionReviews = Object.fromEntries(MAP_AUDIT_REGIONS.map((region) => [region.id, {
		status: previousReviews[region.id]?.status === "confirmed" ? "confirmed" : "pending",
		revision: Number.isInteger(previousReviews[region.id]?.revision) ? previousReviews[region.id].revision : null
	}]))
	return {
		schema: 2,
		revision: Number.isInteger(previous?.revision) ? previous.revision : 0,
		map: { path: "assets/map.png", sha256: mapSha256.toLowerCase(), width: 6082, height: 6000 },
		regions: MAP_AUDIT_REGIONS,
		region_reviews: regionReviews,
		spaces: manifestSpaces,
		edges: manifestEdges
	}
}

export function auditManifest(manifest, spaces, edges, mapSha256, { requireConfirmed = false } = {}) {
	const errors = []
	const warnings = []
	const regionIds = new Set(MAP_AUDIT_REGIONS.map((region) => region.id))
	const spaceIds = new Set(spaces.map((space) => space.id))
	const currentEdges = new Set(edges.map((edge) => edgeKey(edge.a, edge.b)))
	if (manifest?.schema !== 2) errors.push("地图审计清单版本必须为2")
	if (!Number.isInteger(manifest?.revision) || manifest.revision < 0) errors.push("地图审计修订号无效")
	if (manifest?.map?.sha256 !== mapSha256.toLowerCase()) errors.push("审计清单绑定的地图SHA-256与assets/map.png不一致")
	if (manifest?.map?.width !== 6082 || manifest?.map?.height !== 6000) errors.push("地图审计尺寸必须为6082×6000")
	for (const region of MAP_AUDIT_REGIONS) {
		const review = manifest?.region_reviews?.[region.id]
		if (!review || !["pending", "confirmed"].includes(review.status)) errors.push(`区域审计状态无效：${region.id}`)
		if (review?.revision != null && !Number.isInteger(review.revision)) errors.push(`区域审计修订号无效：${region.id}`)
		if (requireConfirmed && review?.status !== "confirmed") errors.push(`区域尚未确认：${region.id}`)
	}
	for (const space of spaces) {
		const record = manifest?.spaces?.[space.id]
		if (!record) { errors.push(`地块缺少审计记录：${space.id}`); continue }
		if (!regionIds.has(record.region)) errors.push(`地块区域无效：${space.id}`)
		if (!MAP_AUDIT_STATUSES.includes(record.status)) errors.push(`地块状态无效：${space.id}`)
		if (!MAP_AUDIT_DECISIONS.includes(record.decision)) errors.push(`地块决策无效：${space.id}`)
		if (record.decision === "review" && record.status === "confirmed") errors.push(`地块未作决定却被确认：${space.id}`)
		if (requireConfirmed && record.status !== "confirmed") errors.push(`地块尚未确认：${space.id}`)
	}
	for (const [id, record] of Object.entries(manifest?.spaces || {})) {
		if (!spaceIds.has(id) && !regionIds.has(record.region)) errors.push(`新增地块区域无效：${id}`)
		if (!spaceIds.has(id) && !MAP_AUDIT_STATUSES.includes(record.status)) errors.push(`新增地块状态无效：${id}`)
		if (!spaceIds.has(id) && !MAP_AUDIT_DECISIONS.includes(record.decision)) errors.push(`新增地块决策无效：${id}`)
		if (!spaceIds.has(id) && record.decision !== "add") warnings.push(`清单包含非正式地块：${id}`)
		if (!spaceIds.has(id) && record.decision === "add" && (!record.proposal || record.proposal.id !== id)) errors.push(`新增地块提议无效：${id}`)
		if (!spaceIds.has(id) && requireConfirmed && record.status !== "confirmed") errors.push(`新增地块尚未确认：${id}`)
	}
	for (const edge of edges) {
		const key = edgeKey(edge.a, edge.b)
		const record = manifest?.edges?.[key]
		if (!record) { errors.push(`连接缺少审计记录：${key}`); continue }
		const expectedRegions = [...new Set([manifest.spaces[edge.a]?.region, manifest.spaces[edge.b]?.region])].sort()
		if (JSON.stringify(record.regions) !== JSON.stringify(expectedRegions)) errors.push(`连接区域不一致：${key}`)
	}
	for (const [key, record] of Object.entries(manifest?.edges || {})) {
		if (!Array.isArray(record.regions) || !record.regions.length || record.regions.some((region) => !regionIds.has(region))) errors.push(`连接区域无效：${key}`)
		const [a, b] = key.split("|")
		const expectedRegions = [...new Set([manifest?.spaces?.[a]?.region, manifest?.spaces?.[b]?.region].filter(Boolean))].sort()
		if (JSON.stringify(record.regions) !== JSON.stringify(expectedRegions)) errors.push(`连接区域与端点不一致：${key}`)
		if (!Array.isArray(record.confirmed_regions) || record.confirmed_regions.some((region) => !record.regions.includes(region))) errors.push(`连接确认区域无效：${key}`)
		if (!MAP_AUDIT_STATUSES.includes(record.status)) errors.push(`连接状态无效：${key}`)
		if (!MAP_AUDIT_DECISIONS.includes(record.decision)) errors.push(`连接决策无效：${key}`)
		const fullyConfirmed = record.regions.every((region) => record.confirmed_regions.includes(region))
		if (record.status === "confirmed" && (!fullyConfirmed || record.decision === "review")) errors.push(`连接确认状态不一致：${key}`)
		if (["add", "update"].includes(record.decision) && (!record.proposal || edgeKey(record.proposal.a, record.proposal.b) !== key)) errors.push(`连接提议端点无效：${key}`)
		if (requireConfirmed && (!fullyConfirmed || record.status !== "confirmed")) errors.push(`连接尚未确认：${key}`)
		if (!currentEdges.has(key) && !["add", "remove"].includes(record.decision)) warnings.push(`清单包含非正式连接且未标记add/remove：${key}`)
	}
	const pendingSpaces = Object.values(manifest?.spaces || {}).filter((record) => record.status !== "confirmed").length
	const pendingEdges = Object.values(manifest?.edges || {}).filter((record) => record.status !== "confirmed").length
	const pendingRegions = Object.values(manifest?.region_reviews || {}).filter((record) => record.status !== "confirmed").length
	return { ok: errors.length === 0, errors, warnings, counts: { spaces: spaces.length, edges: edges.length, pending_spaces: pendingSpaces, pending_edges: pendingEdges, pending_regions: pendingRegions } }
}

export async function sha256(filename) {
	return createHash("sha256").update(await readFile(filename)).digest("hex")
}

export async function loadMapAudit(root) {
	const source = path.join(root, "data", "source")
	const [spaces, edges, manifest, mapSha256] = await Promise.all([
		readFile(path.join(source, "spaces.json"), "utf8").then(JSON.parse),
		readFile(path.join(source, "edges.json"), "utf8").then(JSON.parse),
		readFile(path.join(source, "map_audit.json"), "utf8").then(JSON.parse),
		sha256(path.join(root, "assets", "map.png"))
	])
	return { spaces, edges, manifest, mapSha256 }
}
