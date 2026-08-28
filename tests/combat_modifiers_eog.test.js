"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")

function makeUnit(id, pieceId, location) {
	const piece = data.pieces.find((candidate) => candidate.id === pieceId)
	return {
		id,
		piece: piece.id,
		faction: piece.faction,
		nation: piece.nation,
		type: piece.type,
		location,
		reduced: false,
		moved: false,
		attacked: false,
		supplied: true,
		limited_supply: false,
		fort_limited_supply: false,
		attack_eligible: true
	}
}

function flankGeometry() {
	const byId = Object.fromEntries(data.spaces.map((space) => [space.id, space]))
	const land = (a, b) =>
		data.edges.some(
			(edge) =>
				edge.type === "land" &&
				((edge.a === a && edge.b === b) || (edge.a === b && edge.b === a))
		)
	for (const target of data.spaces.filter(
		(space) => space.terrain === "clear" && !space.fort && !["it", "ah"].includes(space.nation)
	)) {
		const origins = target.connections.filter(
			(origin) =>
				land(origin, target.id) &&
				byId[origin] &&
				!["it", "ah"].includes(byId[origin].nation)
		)
		if (origins.length >= 2) return { target: target.id, origins: origins.slice(0, 2) }
	}
	throw new Error("No flank-test geometry")
}

function combatState(seed, attackers, defender) {
	const state = rules.setup(seed)
	state.turn = 4
	state.active = "cp"
	state.units = [...attackers, defender]
	state.combat_window = {
		attacker: "cp",
		defender: "ap",
		side: "cp",
		cards: []
	}
	state.trenches = {}
	state.fortifications = {}
	state.destroyed_forts = data.spaces.filter((space) => space.fort).map((space) => space.id)
	return state
}

test("flank attacks allocate every origin and failure grants the defender +1 DRM", () => {
	const { target, origins } = flankGeometry()
	const attackers = [
		makeUnit("flank-a", "component-034", origins[0]),
		makeUnit("flank-b", "component-034", origins[1])
	]
	const defender = makeUnit("flank-defender", "component-028", target)
	const state = combatState(5101, attackers, defender)
	const declaration = {
		attackers: attackers.map((unit) => unit.id),
		target,
		flank: true,
		flank_final: 1
	}

	rules._test.resolveCombat(state, declaration)
	assert.equal(state.combat.modifiers.flank.final_drm, 1)
	assert.equal(state.combat.modifiers.flank.drm, 1)
	if (state.combat.modifiers.flank.success)
		assert.equal(state.combat.modifiers.attack_drm, 1)
	else assert.equal(state.combat.modifiers.defense_drm, 1)
})

test("the server rejects malformed or single-origin flank allocations", () => {
	const { target, origins } = flankGeometry()
	const first = makeUnit("invalid-flank-a", "component-034", origins[0])
	const second = makeUnit("invalid-flank-b", "component-034", origins[0])
	const defender = makeUnit("invalid-flank-defender", "component-028", target)
	const state = combatState(5102, [first, second], defender)
	state.ops = { activated_units: { [origins[0]]: [first.id, second.id] } }
	state.activations = { [origins[0]]: "attack" }

	assert.throws(
		() =>
			rules._test.validateAttackDeclaration(state, {
				attackers: [first.id, second.id],
				target,
				flank: true,
				flank_final: 1
			}),
		/Illegal flank/
	)
	assert.throws(
		() =>
			rules._test.validateAttackDeclaration(state, {
				attackers: [first.id, second.id],
				target,
				flank: false,
				flank_final: 0
			}),
		/cannot allocate/
	)
})

test("cavalry and mountain superiority grant the printed side-specific DRM", () => {
	const { target, origins } = flankGeometry()
	const mountain = makeUnit("mountain-attacker", "component-020", "bozen")
	const normalDefender = makeUnit("normal-defender", "component-028", "lienz")
	const mountainState = combatState(5103, [mountain], normalDefender)
	mountainState.events.entry_it = true
	rules._test.resolveCombat(mountainState, {
		attackers: [mountain.id],
		target: "lienz",
		flank: false
	})
	assert.equal(mountainState.combat_modifiers.attack_drm, 1)

	mountain.location = origins[0]
	normalDefender.location = target
	const clearState = combatState(5113, [mountain], normalDefender)
	rules._test.resolveCombat(clearState, {
		attackers: [mountain.id],
		target,
		flank: false
	})
	assert.equal(clearState.combat_modifiers.attack_drm, 0)

	const normalAttacker = makeUnit("normal-attacker", "component-034", origins[0])
	const cavalryDefender = makeUnit("cavalry-defender", "component-031", target)
	const cavalryState = combatState(5104, [normalAttacker], cavalryDefender)
	rules._test.resolveCombat(cavalryState, {
		attackers: [normalAttacker.id],
		target,
		flank: false
	})
	assert.equal(cavalryState.combat_modifiers.defense_drm, 1)
})

test("difficult connections use the normal one-OP attack activation without a surcharge", () => {
	const attacker = makeUnit("difficult-attacker", "component-034", "arras")
	const defender = makeUnit("difficult-defender", "component-028", "amiens")
	const state = combatState(5105, [attacker], defender)
	state.ops = { remaining: 1, activated_units: { arras: [attacker.id] } }
	state.activations = { arras: "attack" }
	state.combat_window = null
	assert.equal(rules._test.activationCost(state, "arras", "attack", [attacker.id]), 1)

	rules._test.beginCombat(state, {
		attackers: [attacker.id],
		target: "amiens",
		flank: false
	})
	assert.equal(state.ops.remaining, 1)
	assert.equal(state.combat_window.declaration.difficult_cost, undefined)
})

test("attacks across an Alpine connection use the corps fire table and cannot flank", () => {
	const attacker = makeUnit("alpine-attacker", "component-033", "bozen")
	const defender = makeUnit("alpine-defender", "component-026", "lienz")
	const state = combatState(5106, [attacker], defender)
	state.events.entry_it = true
	rules._test.resolveCombat(state, {
		attackers: [attacker.id],
		target: "lienz",
		flank: false
	})
	assert.equal(state.combat.modifiers.attack_table, "corps")
})

test("a directional river shifts only attacks made from its recorded bank", () => {
	const edge = rules._test.connectionBetween("sedan", "rethel")
	assert.ok(edge)
	const previousRiver = edge.river
	const previousFrom = edge.river_from
	delete edge.river
	edge.river_from = "sedan"
	try {
		const attacker = makeUnit("river-attacker", "component-033", "sedan")
		const defender = makeUnit("river-defender", "component-026", "rethel")
		const state = combatState(5108, [attacker], defender)
		rules._test.resolveCombat(state, {
			attackers: [attacker.id],
			target: "rethel",
			flank: false
		})
		assert.equal(state.combat_modifiers.crosses_river, true)
		assert.equal(state.combat_modifiers.attack_column, -1)

		const reverseAttacker = makeUnit("reverse-river-attacker", "component-033", "rethel")
		const reverseDefender = makeUnit("reverse-river-defender", "component-026", "sedan")
		const reverse = combatState(5109, [reverseAttacker], reverseDefender)
		rules._test.resolveCombat(reverse, {
			attackers: [reverseAttacker.id],
			target: "sedan",
			flank: false
		})
		assert.equal(reverse.combat_modifiers.crosses_river, false)
	} finally {
		if (previousRiver === undefined) delete edge.river
		else edge.river = previousRiver
		if (previousFrom === undefined) delete edge.river_from
		else edge.river_from = previousFrom
	}
})

test("a movement-activation attack shifts one column left", () => {
	const edge = data.edges.find(
		(candidate) =>
			candidate.type === "land" &&
			candidate.modes.includes("attack") &&
			candidate.factions.includes("cp")
	)
	assert.ok(edge)
	const normal = makeUnit("normal-attack", "component-034", edge.a)
	const moved = makeUnit("moved-attack", "component-034", edge.a)
	moved.moved = true
	const normalDefender = makeUnit("normal-target", "component-028", edge.b)
	const movedDefender = makeUnit("moved-target", "component-028", edge.b)
	const normalState = combatState(5110, [normal], normalDefender)
	const movedState = combatState(5110, [moved], movedDefender)
	rules._test.resolveCombat(normalState, { attackers: [normal.id], target: edge.b, flank: false })
	rules._test.resolveCombat(movedState, { attackers: [moved.id], target: edge.b, flank: false })
	assert.equal(
		movedState.combat_modifiers.attack_column,
		normalState.combat_modifiers.attack_column - 1,
	)
	assert.equal(
		movedState.combat_modifiers.modifier_sources.some((entry) => entry.label === "移动后进攻" && entry.amount === -1),
		true,
	)
})

test("generic yellow-card combat effects do not apply on the Italian front", () => {
	const attacker = makeUnit("yellow-attacker", "component-033", "bozen")
	const defender = makeUnit("yellow-defender", "component-026", "lienz")
	const state = combatState(5107, [attacker], defender)
	state.mo.current.ge = []
	state.mo.completed.ge = []
	state.events[data.cards.find((card) => card.id === 711).event] = {
		faction: "cp",
		duration: "action_round",
		expires: "action_round"
	}
	const italian = rules._test.combatModifiers(
		state,
		{ attackers: [attacker.id], target: "lienz", flank: false },
		[attacker],
		[defender]
	)
	assert.equal(italian.attack_drm, 0)

	attacker.location = "sedan"
	defender.location = "rethel"
	const western = rules._test.combatModifiers(
		state,
		{ attackers: [attacker.id], target: "rethel", flank: false },
		[attacker],
		[defender]
	)
	assert.equal(western.attack_drm, 1)
})
