"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const rules = require("../rules.js")
const data = require("../data.js")

const AP_ROLE = "Allied Powers"
const CP_ROLE = "Central Powers"

function landChain() {
	const edges = data.edges.filter(
		(edge) => edge.type === "land" && edge.modes.includes("retreat") && edge.modes.includes("advance")
	)
	const neighbors = new Map()
	for (const edge of edges) {
		if (!neighbors.has(edge.a)) neighbors.set(edge.a, [])
		if (!neighbors.has(edge.b)) neighbors.set(edge.b, [])
		neighbors.get(edge.a).push(edge.b)
		neighbors.get(edge.b).push(edge.a)
	}
	for (const [middle, adjacent] of neighbors)
		if (adjacent.length >= 2) return [adjacent[0], middle, adjacent[1]]
	throw new Error("No three-space land chain")
}

function combatShell(attacker, target, attackers, defenders) {
	return {
		attacker,
		target,
		attackers: attackers.slice(),
		defenders: defenders.slice(),
		pending_side: attacker === "ap" ? "cp" : "ap",
		modifiers: {
			cards: [],
			prohibit_advance: [],
			cancel_advance: [],
			cancel_retreat: [],
			damaged_advance: true
		},
		resolution_events: []
	}
}

function retreatPending(faction, origin, retreaters, attackers, steps) {
	return {
		faction,
		units: retreaters.map((unit) => unit.id),
		selected_units: [],
		steps,
		from: origin,
		remaining: Object.fromEntries(retreaters.map((unit) => [unit.id, steps])),
		paths: Object.fromEntries(retreaters.map((unit) => [unit.id, [origin]])),
		advance_units: attackers.map((unit) => unit.id),
		advanced_ids: [],
		retreat_paths: [],
		advance_max_steps: steps,
		maximum: null,
		advanced: 0
	}
}

function resolvedCombat(attacker, target, attackers, defenders, moveAttackers = []) {
	return {
		...combatShell(attacker, target, attackers, defenders),
		attack_loss: 0,
		defense_loss: 2,
		move_attackers: moveAttackers.slice(),
		action_repair_complete: true,
		card_dispositions_complete: true,
		post_combat_complete: true,
		post_rules_applied: true,
		fort: null,
		same_space_fort: false,
		declaration: { attackers: attackers.slice(), target },
	}
}

test("POG retreat automatically builds the maximal same-space group before showing destinations", () => {
	const state = rules.setup(1401)
	const [source, target, destination] = landChain()
	const attackers = state.units.filter((unit) => unit.faction === "cp" && unit.type === "army").slice(0, 1)
	const retreaters = state.units.filter((unit) => unit.faction === "ap" && unit.type === "corps").slice(0, 2)
	assert.equal(attackers.length, 1)
	assert.equal(retreaters.length, 2)
	state.units = [...attackers, ...retreaters]
	for (const unit of attackers) unit.location = source
	for (const unit of retreaters) unit.location = target
	state.control[source] = "cp"
	state.control[target] = "ap"
	state.control[destination] = "ap"
	state.combat = combatShell("cp", target, attackers.map((unit) => unit.id), retreaters.map((unit) => unit.id))
	state.pending_retreat = retreatPending("ap", target, retreaters, attackers, 1)
	state.active = "ap"
	state.state = "retreat"

	rules._test.advanceDeterministicStates(state)
	assert.deepEqual(state.pending_retreat.selected_units, retreaters.map((unit) => unit.id))
	assert.equal(rules.view(state, AP_ROLE).actions.retreat_destination.includes(destination), true)
	rules.action(state, AP_ROLE, "retreat_destination", destination)
	assert.equal(state.state, "advance_select")
	assert.deepEqual(rules.view(state, CP_ROLE).actions.select_advance_unit, attackers.map((unit) => unit.id))
	rules.action(state, CP_ROLE, "select_advance_unit", attackers[0].id)
	assert.equal(attackers[0].location, target)

	assert.notEqual(state.state, "advance_select")
	assert.equal(state.active, "cp")
	assert.deepEqual(retreaters.map((unit) => unit.location), [destination, destination])
})

test("movement-attack defenders may retreat although no attacker may advance", () => {
	const [source, target] = landChain()
	const state = rules.setup(1406)
	const attacker = state.units.find((unit) => unit.faction === "cp" && unit.type === "army")
	const defender = state.units.find((unit) => unit.faction === "ap" && unit.type === "corps")
	state.units = [attacker, defender]
	attacker.location = source
	attacker.moved = true
	attacker.attack_eligible = true
	defender.location = target
	state.control[source] = "cp"
	state.control[target] = "ap"
	state.active = "ap"
	state.combat = resolvedCombat("cp", target, [attacker.id], [defender.id], [attacker.id])
	state.state = "combat_losses"
	rules._test.finishCombatLosses(state)
	assert.equal(state.state, "retreat")
	assert.ok(state.pending_retreat)
	assert.deepEqual(state.pending_retreat.advance_units, [])
	assert.equal(rules.view(state, AP_ROLE).actions.decline_retreat, 1)
})

test("a mixed attack retreats defenders but excludes movement attackers from advance", () => {
	const [source, target] = landChain()
	const state = rules.setup(1407)
	const attackers = state.units.filter((unit) => unit.faction === "cp" && unit.type === "army").slice(0, 2)
	const defender = state.units.find((unit) => unit.faction === "ap" && unit.type === "corps")
	state.units = [...attackers, defender]
	for (const unit of attackers) unit.location = source
	attackers[0].moved = true
	attackers[0].attack_eligible = true
	defender.location = target
	state.control[source] = "cp"
	state.control[target] = "ap"
	state.active = "ap"
	state.combat = resolvedCombat("cp", target, attackers.map((unit) => unit.id), [defender.id], [attackers[0].id])
	state.state = "combat_losses"
	rules._test.finishCombatLosses(state)
	assert.equal(state.state, "retreat")
	assert.deepEqual(state.pending_retreat.advance_units, [attackers[1].id])
})

test("an orphaned defending HQ relocates and then resumes the Sedan to Rethel advance", () => {
	const state = rules.setup(1410)
	const attackers = state.units
		.filter((unit) => unit.faction === "cp" && unit.type === "army")
		.slice(0, 2)
	const hq = state.units.find((unit) => unit.faction === "ap" && unit.type === "hq")
	assert.equal(attackers.length, 2)
	assert.ok(hq)
	state.units = [...attackers, hq]
	for (const unit of attackers) {
		unit.location = "sedan"
		unit.reduced = false
	}
	hq.location = "rethel"
	state.control.sedan = "cp"
	state.control.rethel = "ap"
	state.active = "ap"
	state.combat = resolvedCombat("cp", "rethel", attackers.map((unit) => unit.id), ["fr-corps-a", "fr-corps-b"])
	state.combat.origins = Object.fromEntries([
		...attackers.map((unit) => [unit.id, "sedan"]),
		["fr-corps-a", "rethel"],
		["fr-corps-b", "rethel"],
		[hq.id, "rethel"],
	])
	state.state = "combat_losses"

	rules._test.finishCombatLosses(state)
	rules.view(state, AP_ROLE)
	assert.ok(state.state.startsWith("event_"))
	assert.equal(state.pending_event.kind, "hq_relocation")
	assert.equal(state.pending_event.resume, "post_retreat_advance")
	assert.equal(state.pending_retreat.target, "rethel")
	const relocation = rules.view(state, AP_ROLE).actions.event_space[0]
	assert.ok(relocation)
	rules.action(state, AP_ROLE, "event_space", relocation)

	assert.equal(state.state, "advance_select")
	assert.deepEqual(rules.view(state, CP_ROLE).actions.select_advance_unit, attackers.map((unit) => unit.id))
	rules.action(state, CP_ROLE, "select_advance_unit", attackers[0].id)
	assert.equal(attackers[0].location, "rethel")
})

function eliminatedFortDefenderCombat(attacker, target, attackers, lossFactor) {
	return {
		...resolvedCombat(attacker, target, attackers, []),
		fort: { space: target, strength: lossFactor, loss_factor: lossFactor },
		defenders: ["eliminated-defender"],
		defense_loss: lossFactor,
		remaining_loss: 0,
	}
}

test("an army may advance after eliminating a fort's field defenders and establish a siege", () => {
	const state = rules.setup(1408)
	const attacker = state.units.find((unit) => unit.faction === "ap" && unit.type === "army")
	state.units = [attacker]
	attacker.location = "saint_mihiel"
	attacker.reduced = false
	state.control.saint_mihiel = "ap"
	state.control.metz = "cp"
	state.destroyed_forts = []
	state.besieged = []
	state.combat = eliminatedFortDefenderCombat("ap", "metz", [attacker.id], 3)
	state.active = "ap"
	state.state = "combat_losses"

	rules._test.finishCombatLosses(state)
	assert.equal(state.state, "advance_select")
	assert.deepEqual(rules.view(state, AP_ROLE).actions.select_advance_unit, [attacker.id])
	rules.action(state, AP_ROLE, "select_advance_unit", attacker.id)
	assert.equal(attacker.location, "metz")
	assert.deepEqual(state.besieged, ["metz"])
	assert.equal(state.control.metz, "cp")
})

test("corps accumulate into one post-combat advance group before entering an intact fort", () => {
	const state = rules.setup(1409)
	const attackers = state.units.filter((unit) => unit.faction === "ap" && unit.type === "corps").slice(0, 3)
	assert.equal(attackers.length, 3)
	state.units = attackers
	for (const unit of attackers) {
		unit.location = "saint_mihiel"
		unit.reduced = false
	}
	state.control.saint_mihiel = "ap"
	state.control.metz = "cp"
	state.destroyed_forts = []
	state.besieged = []
	state.combat = eliminatedFortDefenderCombat("ap", "metz", attackers.map((unit) => unit.id), 3)
	state.active = "ap"
	state.state = "combat_losses"

	rules._test.finishCombatLosses(state)
	for (const unit of attackers.slice(0, 2)) {
		rules.action(state, AP_ROLE, "select_advance_unit", unit.id)
		assert.equal(state.state, "advance_select")
		assert.equal(unit.location, "saint_mihiel")
	}
	rules.action(state, AP_ROLE, "select_advance_unit", attackers[2].id)
	assert.deepEqual(attackers.map((unit) => unit.location), ["metz", "metz", "metz"])
	assert.deepEqual(state.besieged, ["metz"])
	assert.equal(state.control.metz, "cp")
})

test("retreat overstack damages the retreating unit and then continues its remaining path", () => {
	const state = rules.setup(1402)
	const [origin, middle, destination] = landChain()
	const corps = state.units.filter((unit) => unit.faction === "ap" && unit.type === "corps").slice(0, 7)
	assert.equal(corps.length, 7)
	const retreaters = corps.slice(0, 1)
	const middleOccupants = corps.slice(1, 4)
	const finalOccupants = corps.slice(4, 7)
	state.units = corps
	for (const unit of retreaters) unit.location = origin
	for (const unit of middleOccupants) unit.location = middle
	for (const unit of finalOccupants) unit.location = destination
	state.control[origin] = "ap"
	state.control[middle] = "ap"
	state.control[destination] = "ap"
	state.combat = combatShell("cp", origin, [], retreaters.map((unit) => unit.id))
	state.pending_retreat = retreatPending("ap", origin, retreaters, [], 2)
	state.active = "ap"
	state.state = "retreat"

	rules.action(state, AP_ROLE, "select_retreat_unit", retreaters[0].id)
	rules.action(state, AP_ROLE, "retreat_destination", middle)
	assert.equal(state.state, "retreat_overstack")
	rules.action(state, AP_ROLE, "retreat_loss", retreaters[0].id)
	assert.equal(retreaters[0].reduced, true)
	assert.equal(state.state, "retreat")
	assert.equal(state.pending_retreat.remaining[retreaters[0].id], 1)
	rules.action(state, AP_ROLE, "select_retreat_unit", retreaters[0].id)
	rules.action(state, AP_ROLE, "retreat_destination", destination)
	assert.equal(state.state, "retreat_overstack")
	rules.action(state, AP_ROLE, "retreat_loss", retreaters[0].id)
	assert.equal(state.units.some((unit) => unit.id === retreaters[0].id), false)
	assert.equal(state.units.filter((unit) => unit.location === destination && unit.type === "corps").length, 3)
})

test("a replacement SCU inherits an eliminated LCU retreat path across save and reload", () => {
	let state = rules.setup(1410)
	const [origin, middle, destination] = landChain()
	const armyPiece = data.pieces.find((piece) => piece.id === "component-026")
	const corpsPiece = data.pieces.find((piece) => piece.id === "component-028")
	assert.ok(armyPiece)
	assert.ok(corpsPiece)
	const [army, ...occupants] = state.units.filter((unit) => unit.faction === "ap" && unit.type === "corps").slice(0, 4)
	assert.equal(occupants.length, 3)
	Object.assign(army, { piece: armyPiece.id, faction: "ap", nation: "fr", type: "army", location: origin, reduced: true, supplied: true })
	for (const unit of occupants) unit.location = middle
	const replacement = { id: "retreat-replacement", piece: corpsPiece.id, reduced: false, tts_guid: null }
	state.units = [army, ...occupants]
	state.reserves.ap = [replacement]
	state.reserves.cp = []
	state.control[origin] = "ap"
	state.control[middle] = "ap"
	state.control[destination] = "ap"
	state.combat = combatShell("cp", origin, [], [army.id])
	state.pending_retreat = retreatPending("ap", origin, [army], [], 2)
	state.active = "ap"
	state.state = "retreat"

	rules.action(state, AP_ROLE, "select_retreat_unit", army.id)
	rules.action(state, AP_ROLE, "retreat_destination", middle)
	state = JSON.parse(JSON.stringify(state))
	rules.action(state, AP_ROLE, "retreat_loss", army.id)
	state = JSON.parse(JSON.stringify(state))
	const scu = state.units.find((unit) => unit.id === replacement.id)
	assert.ok(scu)
	assert.equal(scu.location, middle)
	assert.equal(scu.reduced, false)
	assert.equal(state.pending_retreat.remaining[scu.id], 1)
	assert.deepEqual(state.pending_retreat.paths[scu.id], [origin, middle])
	assert.equal(state.pending_retreat.units.includes(army.id), false)
	assert.equal(state.pending_retreat.units.includes(scu.id), true)
	assert.equal(state.state, "retreat")
	rules.action(state, AP_ROLE, "select_retreat_unit", scu.id)
	rules.action(state, AP_ROLE, "retreat_destination", destination)
	assert.equal(state.units.find((unit) => unit.id === scu.id).location, destination)
})

test("version 29 retreat groups migrate without undoing completed retreat steps", () => {
	const state = rules.setup(1404)
	const [origin, middle] = landChain()
	const unit = state.units.find((candidate) => candidate.faction === "ap" && candidate.type === "corps")
	assert.ok(unit)
	state.version = 29
	state.units = [unit]
	unit.location = middle
	state.control[origin] = "ap"
	state.control[middle] = "ap"
	state.combat = combatShell("cp", origin, [], [unit.id])
	state.pending_retreat = retreatPending("ap", origin, [unit], [], 2)
	state.pending_retreat.remaining[unit.id] = 1
	state.pending_retreat.paths[unit.id] = [origin, middle]
	state.pending_retreat.selected_units = [unit.id]
	state.pending_retreat.group = {
		units: [unit.id],
		path: [origin, middle],
		total_steps: 2,
		remaining_steps: 1
	}
	state.state = "retreat_move"
	state.active = "ap"

	rules.view(state, AP_ROLE)
	assert.equal(state.version, 46)
	assert.equal(state.state, "retreat")
	assert.equal(unit.location, middle)
	assert.equal(state.pending_retreat.remaining[unit.id], 1)
	assert.deepEqual(state.pending_retreat.paths[unit.id], [origin, middle])
	assert.deepEqual(state.pending_retreat.selected_units, [unit.id])
	assert.equal("selected_unit" in state.pending_retreat, false)
	assert.equal("group" in state.pending_retreat, false)
})

for (const version of [29, 30, 31, 32, 33, 34])
	test(`version ${version} in-flight retreat reloads as v38 without losing its completed path`, () => {
		const state = rules.setup(1450 + version)
		const [origin, middle] = landChain()
		const unit = state.units.find((candidate) => candidate.faction === "ap" && candidate.type === "corps")
		state.version = version
		state.units = [unit]
		unit.location = middle
		state.control[origin] = "ap"
		state.control[middle] = "ap"
		state.combat = combatShell("cp", origin, [], [unit.id])
		state.pending_retreat = retreatPending("ap", origin, [unit], [], 2)
		state.pending_retreat.remaining[unit.id] = 1
		state.pending_retreat.paths[unit.id] = [origin, middle]
		state.pending_retreat.selected_unit = unit.id
		state.state = version < 30 ? "retreat_move" : "retreat"
		state.active = "ap"
		const reloaded = JSON.parse(JSON.stringify(state))
		rules.view(reloaded, AP_ROLE)
		assert.equal(reloaded.version, 46)
		assert.equal(reloaded.state, "retreat")
		assert.equal(reloaded.units[0].location, middle)
		assert.equal(reloaded.pending_retreat.remaining[unit.id], 1)
		assert.deepEqual(reloaded.pending_retreat.paths[unit.id], [origin, middle])
		rules._test.assertCardConservation(reloaded)
	})

test("each retreat step creates an independent undo point", () => {
	const state = rules.setup(1405)
	const [origin, destination] = landChain()
	const unit = state.units.find((candidate) => candidate.faction === "ap" && candidate.type === "corps")
	assert.ok(unit)
	state.units = [unit]
	unit.location = origin
	state.control[origin] = "ap"
	state.control[destination] = "ap"
	state.combat = combatShell("cp", origin, [], [unit.id])
	state.pending_retreat = retreatPending("ap", origin, [unit], [], 2)
	state.active = "ap"
	state.state = "retreat"
	const undoCount = state.undo.length

	rules.action(state, AP_ROLE, "select_retreat_unit", unit.id)
	rules.action(state, AP_ROLE, "retreat_destination", destination)
	assert.equal(unit.location, destination)
	assert.equal(state.undo.length, undoCount + 1)
	rules.action(state, AP_ROLE, "undo")
	const restored = state.units.find((candidate) => candidate.id === unit.id)
	assert.equal(restored.location, origin)
	assert.equal(state.state, "retreat")
	assert.deepEqual(state.pending_retreat.selected_units, [unit.id])
	assert.equal("selected_unit" in state.pending_retreat, false)
	assert.equal(state.pending_retreat.remaining[unit.id], 2)
})

test("a two-space POG advance enters the battle space then follows a real retreat path", () => {
	const state = rules.setup(1403)
	const [source, target, destination] = landChain()
	const attacker = state.units.find((unit) => unit.faction === "cp" && unit.type === "army" && !unit.reduced)
	assert.ok(attacker)
	state.units = [attacker]
	attacker.location = source
	state.control[source] = "cp"
	state.control[target] = "ap"
	state.control[destination] = "ap"
	state.combat = combatShell("cp", target, [attacker.id], [])
	state.pending_retreat = {
		units: [attacker.id],
		advance_units: [attacker.id],
		selected_advance_units: [],
		advanced_ids: [],
		target,
		retreat_paths: [[target, destination]],
		advance_max_steps: 2,
		maximum: null,
		advanced: 0
	}
	state.active = "cp"
	state.state = "advance_select"

	rules.action(state, CP_ROLE, "select_advance_unit", attacker.id)
	let advanceActions = rules.view(state, CP_ROLE).actions
	assert.equal(advanceActions.confirm_advance, undefined)
	assert.equal(attacker.location, target)
	assert.equal(state.state, "advance_select")
	advanceActions = rules.view(state, CP_ROLE).actions
	assert.equal(advanceActions.confirm_advance, undefined)
	assert.deepEqual(advanceActions.advance_destination, [destination])
	rules.action(state, CP_ROLE, "advance_destination", destination)
	assert.equal(attacker.location, destination)
})
