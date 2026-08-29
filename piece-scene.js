"use strict"

;(function (root, factory) {
	const scene = factory()
	if (typeof module === "object" && module.exports) module.exports = scene
	else root.EogPieceScene = scene
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
	const reserveGroupByPiece = Object.freeze({
		"component-032": "fr_foreign",
		"component-044": "ge_wurttemberg",
		"component-048": "ge_wurttemberg",
		"component-042": "ge_prussia",
		"component-043": "ge_prussia",
		"component-046": "ge_bavaria",
		"component-047": "ge_bavaria",
		"component-038": "ge_saxony"
	})

	const reserveGroups = Object.freeze({
		ap: Object.freeze(["fr", "fr_foreign", "br", "it", "be", "us"]),
		cp: Object.freeze(["ge", "ge_wurttemberg", "ge_prussia", "ge_bavaria", "ge_saxony", "ah"])
	})

	function mapStackKey(spaceId) {
		return `map:${spaceId}`
	}

	function reserveStackKey(faction, group, face) {
		return `reserve:${faction}:${group}:${face}`
	}

	function eliminatedStackKey(faction, nation, type, face) {
		return `eliminated:${faction}:${nation}:${type}:${face}`
	}

	function upgradeStackKey(faction, piece) {
		return `upgrade:${faction}:${piece}`
	}

	function stackOrder(unit, pieceById) {
		const type = pieceById[unit.piece]?.type
		const typeOrder = type === "army" ? 0 : type === "corps" ? 2 : type === "hq" ? 4 : 6
		return typeOrder + (unit.reduced ? 0 : 1)
	}

	function compareUnits(a, b, pieceById) {
		return stackOrder(a, pieceById) - stackOrder(b, pieceById) || String(a.id).localeCompare(String(b.id))
	}

	function buildScene(view, targetIndex, data) {
		const pieces = Object.fromEntries((data.pieces || []).map((piece) => [piece.id, piece]))
		const spaces = Object.fromEntries((data.spaces || []).map((space) => [space.id, space]))
		const selected = new Set(view.selection?.selected || [])
		const legalPieces = targetIndex?.pieces || new Map()
		const legalSpaces = targetIndex?.spaces || new Map()
		const units = new Map()
		const stacks = new Map()

		function ensureStack(key, frame) {
			let stack = stacks.get(key)
			if (!stack) {
				stack = { key, unitIds: [], counterKinds: [], legal: false, ...frame }
				stacks.set(key, stack)
			}
			return stack
		}

		for (const unit of view.units || []) {
			const space = spaces[unit.location]
			if (!space || space.ui?.hidden) continue
			const key = mapStackKey(space.id)
			ensureStack(key, { zone: "map", spaceId: space.id, legal: legalSpaces.has(space.id) }).unitIds.push(unit.id)
			const actionKinds = (legalPieces.get(unit.id) || []).map((entry) => entry.action)
			units.set(unit.id, {
				id: unit.id,
				piece: unit.piece,
				reduced: Boolean(unit.reduced),
				supplyStatus: unit.supply_status || (unit.supplied === false ? "none" : "full"),
				supplyEffects: unit.supply_effects || [],
				selected: selected.has(unit.id),
				legal: legalPieces.has(unit.id),
				actionKinds,
				staged: Boolean(unit.staged),
				stackKey: key,
				zone: "map"
			})
		}

		for (const [spaceId, activation] of Object.entries(view.activations || {})) {
			const space = spaces[spaceId]
			if (!space || space.ui?.hidden) continue
			const key = mapStackKey(spaceId)
			const stack = ensureStack(key, { zone: "map", spaceId, legal: legalSpaces.has(spaceId) })
			stack.counterKinds = [activation].filter((kind) =>
				["move", "attack", "construct"].includes(kind)
			)
		}

		for (const faction of ["ap", "cp"])
			for (const unit of view.reserves?.[faction] || []) {
				const template = pieces[unit.piece]
				const groups = reserveGroups[faction]
				const requested = reserveGroupByPiece[unit.piece] || template?.nation
				const group = groups.includes(requested) ? requested : groups.at(-1)
				const face = unit.reduced ? "reduced" : "full"
				const key = reserveStackKey(faction, group, face)
				ensureStack(key, { zone: "reserve", faction, group, face }).unitIds.push(unit.id)
				const actionKinds = (legalPieces.get(unit.id) || []).map((entry) => entry.action)
				units.set(unit.id, {
					id: unit.id,
					piece: unit.piece,
					reduced: Boolean(unit.reduced),
					supplyStatus: null,
					supplyEffects: [],
					selected: selected.has(unit.id),
					legal: legalPieces.has(unit.id),
					actionKinds,
					staged: Boolean(unit.staged),
					stackKey: key,
					zone: "reserve"
				})
			}

		for (const faction of ["ap", "cp"])
			for (const unit of view.eliminated?.[faction] || []) {
				const template = pieces[unit.piece]
				const nation = unit.nation || template?.nation || faction
				const type = unit.type || template?.type || "corps"
				const face = unit.reduced ? "reduced" : "full"
				const key = eliminatedStackKey(faction, nation, type, face)
				ensureStack(key, { zone: "eliminated", faction, nation, type, face }).unitIds.push(unit.id)
				const actionKinds = (legalPieces.get(unit.id) || []).map((entry) => entry.action)
				units.set(unit.id, {
					id: unit.id,
					piece: unit.piece,
					reduced: Boolean(unit.reduced),
					supplyStatus: null,
					supplyEffects: [],
					selected: selected.has(unit.id),
					legal: legalPieces.has(unit.id),
					actionKinds,
					staged: false,
					stackKey: key,
					zone: "eliminated"
				})
			}

		for (const faction of ["ap", "cp"])
			for (const unit of view.upgrade_pool?.[faction] || []) {
				const key = upgradeStackKey(faction, unit.piece)
				ensureStack(key, { zone: "upgrade", faction, piece: unit.piece }).unitIds.push(unit.id)
				const actionKinds = (legalPieces.get(unit.id) || []).map((entry) => entry.action)
				units.set(unit.id, {
					id: unit.id,
					piece: unit.piece,
					reduced: Boolean(unit.reduced),
					supplyStatus: null,
					supplyEffects: [],
					selected: selected.has(unit.id),
					legal: legalPieces.has(unit.id),
					actionKinds,
					staged: false,
					stackKey: key,
					zone: "upgrade"
				})
			}

		const visibleUnits = [
			...view.units || [],
			...view.reserves?.ap || [],
			...view.reserves?.cp || [],
			...view.eliminated?.ap || [],
			...view.eliminated?.cp || [],
			...view.upgrade_pool?.ap || [],
			...view.upgrade_pool?.cp || []
		]
		const visibleById = new Map(visibleUnits.map((unit) => [unit.id, unit]))
		for (const stack of stacks.values())
			stack.unitIds.sort((a, b) => compareUnits(visibleById.get(a), visibleById.get(b), pieces))
		for (const stack of stacks.values()) {
			const kinds = stack.unitIds.flatMap((id) => units.get(id)?.actionKinds || [])
			stack.pieceActionable = kinds.length > 0
			stack.advanceCandidate = kinds.includes("select_advance_unit")
			stack.retreatCandidate = kinds.some((action) =>
				["select_retreat_unit", "select_retreat_one", "select_retreat_two"].includes(action),
			)
		}

		return { units, stacks }
	}

	function equalArrays(a, b) {
		return a.length === b.length && a.every((value, index) => value === b[index])
	}

	function equalUnit(a, b) {
		return Boolean(a && b) &&
			a.piece === b.piece &&
			a.reduced === b.reduced &&
			a.supplyStatus === b.supplyStatus &&
			JSON.stringify(a.supplyEffects || []) === JSON.stringify(b.supplyEffects || []) &&
			a.selected === b.selected &&
				a.legal === b.legal &&
				equalArrays(a.actionKinds || [], b.actionKinds || []) &&
				a.staged === b.staged &&
				a.stackKey === b.stackKey
	}

	function equalStack(a, b) {
		return Boolean(a && b) &&
			a.zone === b.zone &&
			a.spaceId === b.spaceId &&
			a.faction === b.faction &&
			a.group === b.group &&
			a.piece === b.piece &&
			a.nation === b.nation &&
			a.type === b.type &&
			a.face === b.face &&
			a.legal === b.legal &&
			a.pieceActionable === b.pieceActionable &&
			a.advanceCandidate === b.advanceCandidate &&
			a.retreatCandidate === b.retreatCandidate &&
			equalArrays(a.unitIds, b.unitIds) &&
			equalArrays(a.counterKinds, b.counterKinds)
	}

	function diffScenes(previous, next, previousFocus = null, nextFocus = null) {
		if (!previous) return new Set(next.stacks.keys())
		const dirty = new Set()
		const stackKeys = new Set([...previous.stacks.keys(), ...next.stacks.keys()])
		for (const key of stackKeys)
			if (!equalStack(previous.stacks.get(key), next.stacks.get(key))) dirty.add(key)

		const unitIds = new Set([...previous.units.keys(), ...next.units.keys()])
		for (const id of unitIds) {
			const before = previous.units.get(id)
			const after = next.units.get(id)
			if (equalUnit(before, after)) continue
			if (before?.stackKey) dirty.add(before.stackKey)
			if (after?.stackKey) dirty.add(after.stackKey)
		}

		if (previousFocus !== nextFocus) {
			if (previousFocus) dirty.add(previousFocus)
			if (nextFocus) dirty.add(nextFocus)
		}
		return dirty
	}

	return {
		buildScene,
		diffScenes,
		mapStackKey,
		reserveStackKey,
		eliminatedStackKey,
		upgradeStackKey,
		reserveGroupByPiece,
		reserveGroups
	}
})
