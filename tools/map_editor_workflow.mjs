/* global structuredClone */

import { createHash } from "node:crypto"
import { edgeKey, MAP_AUDIT_REGIONS } from "./map_audit_manifest.mjs"

const clone = (value) => structuredClone(value)
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

export function sourceRevision({ spaces, edges, ui, manifest }) {
	return createHash("sha256")
		.update(JSON.stringify({ spaces, edges, ui, manifest }))
		.digest("hex")
}

function mergeSpace(space, proposal) {
	return {
		...space,
		ui: { ...(space?.ui || {}), ...(proposal?.ui || {}) }
	}
}

function addedSpace(id, proposal) {
	return { ...clone(proposal), id, ui: clone(proposal.ui) }
}

export function workingMap(formal, manifest) {
	const spaces = new Map(formal.spaces.map((space) => [space.id, clone(space)]))
	for (const [id, record] of Object.entries(manifest.spaces || {})) {
		if (record.decision === "remove") spaces.delete(id)
		else if (record.decision === "add" && record.proposal) spaces.set(id, addedSpace(id, record.proposal))
		else if (record.decision === "update" && record.proposal && spaces.has(id)) spaces.set(id, mergeSpace(spaces.get(id), record.proposal))
	}
	const edges = new Map(formal.edges.map((edge) => [edgeKey(edge.a, edge.b), clone(edge)]))
	for (const [key, record] of Object.entries(manifest.edges || {})) {
		if (record.decision === "remove") edges.delete(key)
		else if (["add", "update"].includes(record.decision) && record.proposal) {
			const [a, b] = key.split("|")
			edges.set(key, { a, b, ...(edges.get(key) || {}), ...clone(record.proposal) })
		}
	}
	return { spaces: [...spaces.values()], edges: [...edges.values()], ui: clone(formal.ui) }
}

export function regionReviewErrors(manifest, regionId) {
	const errors = []
	if (!MAP_AUDIT_REGIONS.some((region) => region.id === regionId)) return [`未知审计区域：${regionId}`]
	for (const [id, record] of Object.entries(manifest.spaces || {})) {
		if (record.region !== regionId) continue
		if (record.decision === "review") errors.push(`地块尚未决定：${id}`)
		if (record.status === "disputed") errors.push(`地块仍有争议：${id}`)
		if (record.status !== "confirmed") errors.push(`地块尚未确认：${id}`)
	}
	for (const [key, record] of Object.entries(manifest.edges || {})) {
		if (!record.regions?.includes(regionId)) continue
		if (record.decision === "review") errors.push(`连接尚未决定：${key}`)
		if (record.status === "disputed") errors.push(`连接仍有争议：${key}`)
		if (!record.confirmed_regions?.includes(regionId)) errors.push(`连接尚未由本区确认：${key}`)
	}
	if (manifest.region_reviews?.[regionId]?.status !== "confirmed") errors.push(`区域尚未执行最终确认：${regionId}`)
	return [...new Set(errors)]
}

export function regionHasChanges(manifest, regionId, formal = null) {
	if (!MAP_AUDIT_REGIONS.some((region) => region.id === regionId)) return false
	const changed = new Set(["add", "update", "remove"])
	const formalSpaces = new Map((formal?.spaces || []).map((space) => [space.id, space]))
	const formalEdges = new Map((formal?.edges || []).map((edge) => [edgeKey(edge.a, edge.b), edge]))
	const spaceChanged = ([id, record]) => {
		if (record.region !== regionId || !changed.has(record.decision)) return false
		if (!formal) return true
		const before = formalSpaces.get(id)
		if (record.decision === "remove") return Boolean(before)
		if (!record.proposal) return true
		const after = record.decision === "add" ? addedSpace(id, record.proposal) : mergeSpace(before, record.proposal)
		return !same(before, after)
	}
	const edgeChanged = ([key, record]) => {
		if (!record.regions?.includes(regionId) || !changed.has(record.decision)) return false
		if (!formal) return true
		const before = formalEdges.get(key)
		if (record.decision === "remove") return Boolean(before)
		if (!record.proposal) return true
		const [a, b] = key.split("|")
		const after = { a, b, ...(before || {}), ...clone(record.proposal) }
		return !same(before, after)
	}
	return Object.entries(manifest.spaces || {}).some(spaceChanged) || Object.entries(manifest.edges || {}).some(edgeChanged)
}

export function prepareRegionSave(manifest, regionId) {
	const next = clone(manifest)
	const changed = new Set(["add", "update", "remove"])
	for (const record of Object.values(next.spaces || {})) {
		if (record.region !== regionId || !changed.has(record.decision)) continue
		record.status = "confirmed"
	}
	for (const record of Object.values(next.edges || {})) {
		if (!record.regions?.includes(regionId) || !changed.has(record.decision)) continue
		record.confirmed_regions = [...record.regions]
		record.status = "confirmed"
	}
	next.revision += 1
	next.region_reviews[regionId] = { status: "pending", revision: next.revision }
	return next
}

export function changedRegions(manifest, formal) {
	return MAP_AUDIT_REGIONS
		.map((region) => region.id)
		.filter((regionId) => regionHasChanges(manifest, regionId, formal))
}

export function prepareMultiRegionSave(manifest, regionIds, formal) {
	const next = clone(manifest)
	const affected = new Set(regionIds)
	const formalSpaces = new Map((formal?.spaces || []).map((space) => [space.id, space]))
	const formalEdges = new Map((formal?.edges || []).map((edge) => [edgeKey(edge.a, edge.b), edge]))
	for (const [id, record] of Object.entries(next.spaces || {})) {
		if (!affected.has(record.region) || !["add", "update", "remove"].includes(record.decision)) continue
		const before = formalSpaces.get(id)
		const after = record.decision === "add" ? addedSpace(id, record.proposal) : mergeSpace(before, record.proposal)
		if (record.decision === "remove" ? Boolean(before) : !same(before, after)) record.status = "confirmed"
	}
	for (const [key, record] of Object.entries(next.edges || {})) {
		if (!record.regions?.some((region) => affected.has(region)) || !["add", "update", "remove"].includes(record.decision)) continue
		const before = formalEdges.get(key)
		const [a, b] = key.split("|")
		const after = { a, b, ...(before || {}), ...clone(record.proposal || {}) }
		const changed = record.decision === "remove" ? Boolean(before) : !same(before, after)
		if (!changed) continue
		record.confirmed_regions = [...record.regions]
		record.status = "confirmed"
	}
	next.revision += 1
	for (const regionId of affected) next.region_reviews[regionId] = { status: "pending", revision: next.revision }
	return next
}

export function auditMultiRegionScopeErrors(current, incoming, regionIds) {
	const errors = []
	void regionIds
	const validRegions = new Set(MAP_AUDIT_REGIONS.map((region) => region.id))
	if (!same(current.map, incoming.map)) errors.push("地图资源绑定不得由编辑器修改")
	if (!same(current.regions, incoming.regions)) errors.push("区域目录不得由编辑器修改")
	if (current.revision !== incoming.revision) errors.push("审计修订号已过期")
	for (const [id, record] of Object.entries(incoming.spaces || {})) {
		const before = current.spaces?.[id]
		const changed = !same(record, before)
		if (!validRegions.has(record.region)) errors.push(`地块所属区域无效：${id}`)
		if (before && record.region !== before.region) errors.push(`地块所属区域不得修改：${id}`)
		if (!before && (record.decision !== "add" || !record.proposal)) errors.push(`新地块必须作为add提议：${id}`)
		if (record.decision === "remove") errors.push(`编辑器不得删除地块：${id}`)
		if (before && changed && record.proposal && Object.keys(record.proposal).some((key) => key !== "ui")) errors.push(`现有地块只能修改点击框：${id}`)
		if (!before && record.proposal?.id !== id) errors.push(`新地块提议ID不一致：${id}`)
	}
	for (const id of Object.keys(current.spaces || {}))
		if (!incoming.spaces?.[id]) errors.push(`不得绕过审计删除地块：${id}`)
	for (const [key, record] of Object.entries(incoming.edges || {})) {
		const before = current.edges?.[key]
		if (same(record, before)) continue
		if (!record.regions?.length || !record.regions.every((region) => validRegions.has(region))) errors.push(`连接区域无效：${key}`)
	}
	for (const key of Object.keys(current.edges || {}))
		if (!incoming.edges?.[key]) errors.push(`不得绕过审计删除连接记录：${key}`)
	return [...new Set(errors)]
}

export function auditScopeErrors(current, incoming, regionId) {
	const errors = []
	const invalidatedRegions = new Set()
	for (const [key, record] of Object.entries(incoming.edges || {})) {
		const before = current.edges?.[key]
		if (!same(record, before) && record.regions?.includes(regionId))
			for (const region of record.regions) invalidatedRegions.add(region)
	}
	if (!same(current.map, incoming.map)) errors.push("地图资源绑定不得由编辑器修改")
	if (!same(current.regions, incoming.regions)) errors.push("区域目录不得由编辑器修改")
	if (current.revision !== incoming.revision) errors.push("审计修订号已过期")
	for (const [id, record] of Object.entries(incoming.spaces || {})) {
		const before = current.spaces?.[id]
		const changed = !same(record, before)
		if (before && record.region !== before.region) errors.push(`地块所属区域不得修改：${id}`)
		if (!before && (record.region !== regionId || record.decision !== "add" || !record.proposal)) errors.push(`新地块必须作为本区add提议：${id}`)
		if (record.decision === "remove") errors.push(`编辑器不得删除地块：${id}`)
		if (before && changed && record.proposal && Object.keys(record.proposal).some((key) => key !== "ui")) errors.push(`现有地块只能修改点击框：${id}`)
		if (!before && record.proposal?.id !== id) errors.push(`新地块提议ID不一致：${id}`)
		if (record.region !== regionId && !same(record, before)) errors.push(`修改超出当前区域：${id}`)
	}
	for (const id of Object.keys(current.spaces || {}))
		if (!incoming.spaces?.[id]) errors.push(`不得绕过审计删除地块：${id}`)
	for (const [key, record] of Object.entries(incoming.edges || {})) {
		const before = current.edges?.[key]
		if (!record.regions?.includes(regionId) && !same(record, before)) errors.push(`修改超出当前区域：${key}`)
	}
	for (const [key, record] of Object.entries(current.edges || {}))
		if (!incoming.edges?.[key] && !record.regions?.includes(regionId)) errors.push(`不得绕过审计删除连接记录：${key}`)
	for (const region of MAP_AUDIT_REGIONS) {
		if (region.id === regionId || same(current.region_reviews?.[region.id], incoming.region_reviews?.[region.id])) continue
		const review = incoming.region_reviews?.[region.id]
		const isCrossRegionInvalidation = invalidatedRegions.has(region.id) && review?.status === "pending" && review?.revision == null
		if (!isCrossRegionInvalidation) errors.push(`修改了其他区域状态：${region.id}`)
	}
	return errors
}

export function commitConfirmedProposals(formal, manifest) {
	const spaces = new Map(formal.spaces.map((space) => [space.id, clone(space)]))
	for (const [id, record] of Object.entries(manifest.spaces || {})) {
		if (record.status !== "confirmed") continue
		if (record.decision === "remove") spaces.delete(id)
		else if (record.decision === "add" && record.proposal) spaces.set(id, addedSpace(id, record.proposal))
		else if (record.decision === "update" && record.proposal && spaces.has(id)) spaces.set(id, mergeSpace(spaces.get(id), record.proposal))
	}
	const edges = new Map(formal.edges.map((edge) => [edgeKey(edge.a, edge.b), clone(edge)]))
	for (const [key, record] of Object.entries(manifest.edges || {})) {
		const fullyConfirmed = record.regions?.every((region) => record.confirmed_regions?.includes(region))
		if (record.status !== "confirmed" || !fullyConfirmed) continue
		if (record.decision === "remove") edges.delete(key)
		else if (["add", "update"].includes(record.decision) && record.proposal) {
			const [a, b] = key.split("|")
			edges.set(key, { a, b, ...(edges.get(key) || {}), ...clone(record.proposal) })
		}
	}
	return { spaces: [...spaces.values()], edges: [...edges.values()], ui: clone(formal.ui) }
}

export function advanceAuditRevision(manifest, regionId) {
	const next = clone(manifest)
	next.revision += 1
	next.region_reviews[regionId] = { status: "confirmed", revision: next.revision }
	return next
}

export function draftMatchesWorking(value, formal, manifest) {
	const expected = workingMap(formal, manifest)
	return same(value.spaces, expected.spaces) && same(value.edges, expected.edges) && same(value.ui, expected.ui)
}

export function reconcileDraftManifest(formal, current, incoming, draft) {
	const errors = []
	const next = clone(current)
	if (!same(formal.ui, draft.ui)) errors.push("轨道与界面数据不得在地块编辑器中修改")
	const formalSpaces = new Map(formal.spaces.map((space) => [space.id, space]))
	const draftSpaces = new Map((draft.spaces || []).map((space) => [space.id, space]))
	const regionIds = new Set(MAP_AUDIT_REGIONS.map((region) => region.id))
	const metadata = (record, fallback) => ({
		...(fallback || {}),
		...(record?.note ? { note: record.note } : {}),
		...(record?.evidence ? { evidence: record.evidence } : {})
	})

	for (const [id, space] of formalSpaces) {
		const draftSpace = draftSpaces.get(id)
		if (!draftSpace) { errors.push(`不得删除现有地块：${id}`); continue }
		const { ui: formalUi, ...formalRules } = space
		const { ui: draftUi, ...draftRules } = draftSpace
		if (!same(formalRules, draftRules)) errors.push(`现有地块只能修改点击框：${id}`)
		if (same(formalUi, draftUi)) {
			next.spaces[id] = metadata(incoming.spaces?.[id], current.spaces?.[id])
			continue
		}
		const region = current.spaces?.[id]?.region
		next.spaces[id] = metadata(incoming.spaces?.[id], {
			...current.spaces?.[id], region, status: "pending", decision: "update", proposal: { ui: clone(draftUi) }
		})
		next.spaces[id].region = region
		next.spaces[id].status = "pending"
		next.spaces[id].decision = "update"
		next.spaces[id].proposal = { ui: clone(draftUi) }
	}
	for (const [id, space] of draftSpaces) {
		if (formalSpaces.has(id)) continue
		const region = incoming.spaces?.[id]?.region
		if (!regionIds.has(region)) { errors.push(`新增地块缺少有效所属区域：${id}`); continue }
		next.spaces[id] = metadata(incoming.spaces?.[id], {
			region, status: "pending", decision: "add", proposal: clone(space)
		})
		next.spaces[id].region = region
		next.spaces[id].status = "pending"
		next.spaces[id].decision = "add"
		next.spaces[id].proposal = clone(space)
	}
	for (const id of Object.keys(next.spaces))
		if (!draftSpaces.has(id) && !formalSpaces.has(id)) delete next.spaces[id]

	const formalEdges = new Map(formal.edges.map((edge) => [edgeKey(edge.a, edge.b), edge]))
	const draftEdges = new Map((draft.edges || []).map((edge) => [edgeKey(edge.a, edge.b), edge]))
	const allEdgeKeys = new Set([...formalEdges.keys(), ...draftEdges.keys()])
	for (const key of allEdgeKeys) {
		const formalEdge = formalEdges.get(key)
		const draftEdge = draftEdges.get(key)
		if (formalEdge && draftEdge && same(formalEdge, draftEdge)) {
			next.edges[key] = metadata(incoming.edges?.[key], current.edges?.[key])
			continue
		}
		const [a, b] = key.split("|")
		const regions = [...new Set([next.spaces[a]?.region, next.spaces[b]?.region].filter(Boolean))].sort()
		if (regions.length === 0 || !next.spaces[a] || !next.spaces[b]) { errors.push(`连接端点无效：${key}`); continue }
		const decision = draftEdge ? (formalEdge ? "update" : "add") : "remove"
		next.edges[key] = metadata(incoming.edges?.[key], {
			regions, confirmed_regions: [], status: "pending", decision
		})
		next.edges[key].regions = regions
		next.edges[key].confirmed_regions = []
		next.edges[key].status = "pending"
		next.edges[key].decision = decision
		if (draftEdge) next.edges[key].proposal = clone(draftEdge)
		else delete next.edges[key].proposal
	}
	for (const [key, record] of Object.entries(next.edges))
		if (!allEdgeKeys.has(key) && record.decision === "add") delete next.edges[key]

	next.map = clone(current.map)
	next.regions = clone(current.regions)
	next.revision = current.revision
	for (const regionId of changedRegions(next, formal))
		next.region_reviews[regionId] = { status: "pending", revision: null }
	return { manifest: next, errors: [...new Set(errors)] }
}
