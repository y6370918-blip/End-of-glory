"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")
const protocolView = rules.protocolView || rules.view
const protocolAction = rules.protocolAction || rules.action

function selectEventUnits(state, role, unitIds) {
	for (const id of unitIds) protocolAction(state, role, "select_event_unit", id)
	protocolAction(state, role, "event_units_confirm")
}

function playEvent(id, seed = id) {
	const card = data.cards.find((candidate) => candidate.id === id)
	const role = card.faction === "ap" ? "Allied Powers" : "Central Powers"
	const state = rules.setup(seed)
	state.active = card.faction
	state.state = "action_card"
	state.phase = "行动阶段"
	state.turn = 8
	state.commitment[card.faction] = "total"
	// Keep the fixture below the armistice threshold. At 40 the v46 rules
	// correctly end the game before the event can resolve.
	state.war_status.combined = 30
	state.fronts.russian = 3
	const requiredEvent = data.card_effects[id]?.prerequisites?.requires_event
	if (requiredEvent) state.events[requiredEvent] = true
	state.hands[card.faction] = [id]
	state.decks[card.faction] = []
	rules.action(state, role, "card_event", id)
	let guard = 0
	while (state.state.startsWith("event_")) {
		assert.ok(guard++ < 20, `event ${id} did not finish`)
		const currentRole = state.active === "ap" ? "Allied Powers" : "Central Powers"
		const actions = rules.view(state, currentRole).actions
		if (actions.event_choose?.includes("done")) rules.action(state, currentRole, "event_choose", "done")
		else if (actions.event_space?.length) rules.action(state, currentRole, "event_space", actions.event_space[0])
		else if (actions.event_confirm) rules.action(state, currentRole, "event_confirm")
		else throw new Error(`event ${id} has no continuation`)
	}
	return state
}

test("Conrad applies its printed VP and Russian-front changes with the MO-pool change", () => {
	const state = rules.setup(633)
	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "limited"
	state.hands.ap = [633]
	state.events.ap_意大利参战 = { faction: "ap", duration: "game" }
	state.fronts.russian = 4
	rules.action(state, "Allied Powers", "card_event", 633)
	assert.equal(state.vp, 9)
	assert.equal(state.fronts.russian, 3)
	assert.equal(state.mo.pool.ah.filter((entry) => entry.source_card === 633).length, 3)
})

test("Wilson changes the US-entry track in addition to VP", () => {
	const state = rules.setup(656)
	state.entry_tracks.us = 2
	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "total"
	state.hands.ap = [656]
	state.events[data.cards.find((card) => card.id === 746).event] = { faction: "cp" }
	rules.action(state, "Allied Powers", "card_event", 656)
	assert.equal(state.entry_tracks.us, 1)
	assert.equal(state.vp, 9)
})

test("Clemenceau and unrestricted submarine warfare adjust entry tracks once per war-status phase", () => {
	const state = playEvent(647)
	const status = state.events[data.cards.find((card) => card.id === 647).event]
	assert.equal(status.end_vp, -2)
	assert.equal(state.entry_tracks.armistice, 0)
	rules._test.applyWarStatusEntryTracks(state)
	assert.equal(state.entry_tracks.armistice, 1)
	rules._test.applyWarStatusEntryTracks(state)
	assert.equal(state.entry_tracks.armistice, 1)

	const submarine = playEvent(746)
	submarine.entry_tracks.us = 3
	rules._test.applyWarStatusEntryTracks(submarine)
	assert.equal(submarine.entry_tracks.us, 2)
})

test("AEF creates exactly nine recurring US corps across replacement phases", () => {
	const state = playEvent(646)
	const before = state.reserves.ap.filter((unit) => unit.piece === "component-103").length
	for (let turn = 1; turn <= 4; turn++) {
		state.turn = turn
		rules._test.applyRecurringReinforcements(state)
		rules._test.applyRecurringReinforcements(state)
	}
	const after = state.reserves.ap.filter((unit) => unit.piece === "component-103").length
	assert.equal(after - before, 9)
})

test("Cadorna and Domestic Politicians deploy their printed Italian reinforcements", () => {
	const cadorna = playEvent(627)
	const cadornaArmies = cadorna.units.filter(
		(unit) => unit.piece === "component-016" && Number(unit.id.slice(1)) >= 1000
	)
	assert.equal(cadornaArmies.length, 3)
	assert.ok(cadornaArmies.every((unit) => unit.reduced))
	assert.equal(
		cadorna.units.filter((unit) => unit.piece === "component-015" && Number(unit.id.slice(1)) >= 1000).length,
		3
	)
	assert.equal(cadorna.units.filter((unit) => unit.piece === "component-009").length, 1)
	assert.equal(
		data.card_effects[627].operations
			.find((operation) => operation.type === "reinforcement")
			.units.find((unit) => unit.piece === "component-009").unique,
		true
	)

	const politicians = playEvent(630)
	assert.ok(
		politicians.units.some((unit) => unit.piece === "component-016" && unit.reduced)
	)
	assert.ok(
		politicians.units.some((unit) => unit.piece === "component-015" && unit.reduced)
	)
})

test("late Italian entry restores four armies and grants printed Italian-theater bonus OP", () => {
	const state = rules.setup(625)
	state.turn = 6
	state.commitment.ap = "limited"
	const reduced = state.entry_reserve.it.filter(
		(unit) => unit.faction === "ap" && unit.nation === "it" && unit.type === "army"
	).slice(0, 4)
	assert.equal(reduced.length, 4)
	for (const unit of reduced) unit.reduced = true
	state.active = "ap"
	state.state = "action_card"
	state.hands.ap = [625]
	rules.action(state, "Allied Powers", "card_event", 625)
	assert.equal(state.pending_event.kind, "italy_entry_restore")
	selectEventUnits(state, "Allied Powers", reduced.map((unit) => unit.id))
	assert.ok(reduced.every((unit) => !unit.reduced))

	state.active = "ap"
	state.state = "action_card"
	state.hands.ap = [633]
	rules.action(state, "Allied Powers", "card_ops", 633)
	assert.equal(state.ops.italian_bonus, 2)
	state.ops.remaining = 0
	const italianSpace = rules.view(state, "Allied Powers").actions.activate_move.find(
		(space) => data.spaces.find((candidate) => candidate.id === space)?.nation === "it"
	)
	assert.ok(italianSpace)
	rules.action(state, "Allied Powers", "activate_move", italianSpace)
	assert.ok(state.ops.italian_bonus < 2)
	assert.equal(state.ops.remaining, 0)
})

test("623 Lloyd George and 626 Churchill unlock only their printed British MO", () => {
	const before = rules.setup(623)
	assert.equal(rules._test.moBagDefinitions(before, "br").some((mo) => mo.id === "br-5"), false)
	assert.equal(rules._test.moBagDefinitions(before, "br").some((mo) => mo.id === "br-6"), false)

	before.turn = 8
	before.active = "ap"
	before.state = "action_card"
	before.commitment.ap = "total"
	before.events[data.cards.find((card) => card.id === 703).event] = true
	before.events.entry_tu = true
	before.hands.ap = [623]
	const expected = JSON.parse(JSON.stringify(before))
	rules._test.moveFront(expected, "turkish", 2, "Lloyd George test")
	expected.vp -= 1
	const rp = before.rp.ap.br
	rules.action(before, "Allied Powers", "card_event", 623)
	assert.equal(before.vp, expected.vp)
	assert.equal(before.rp.ap.br, rp + 2)
	assert.equal(before.fronts.turkish, expected.fronts.turkish)
	assert.equal(rules._test.moBagDefinitions(before, "br").some((mo) => mo.id === "br-5"), true)
	assert.equal(rules._test.moBagDefinitions(before, "br").some((mo) => mo.id === "br-6"), false)

	before.active = "ap"
	before.state = "action_card"
	before.hands.ap = [626]
	rules.action(before, "Allied Powers", "card_event", 626)
	assert.ok(rules.view(before, "Allied Powers").actions.event_choose.includes("front_only"))
	rules.action(before, "Allied Powers", "event_choose", "front_only")
	assert.equal(rules._test.moBagDefinitions(before, "br").some((mo) => mo.id === "br-6"), true)
})

test("624 Somme target, activation cost, and combat modifiers use AP attack connections", () => {
	const edge = data.edges.find((candidate) =>
		(candidate.type || "land") === "land" &&
		(candidate.modes || []).includes("attack") &&
		(candidate.factions || []).includes("ap") &&
		!candidate.alpine && !candidate.river &&
		[candidate.a, candidate.b].some((id) =>
			["fr", "be", "ge"].includes(data.spaces.find((space) => space.id === id)?.nation) &&
			data.spaces.find((space) => space.id === id)?.terrain === "clear"
		) &&
		!data.spaces.find((space) => space.id === candidate.a)?.ui?.hidden &&
		!data.spaces.find((space) => space.id === candidate.b)?.ui?.hidden
	)
	assert.ok(edge)
	const target = [edge.a, edge.b].find((id) =>
		["fr", "be", "ge"].includes(data.spaces.find((space) => space.id === id)?.nation) &&
		data.spaces.find((space) => space.id === id)?.terrain === "clear"
	)
	const origin = edge.a === target ? edge.b : edge.a
	const state = rules.setup(624)
	for (const nation of Object.keys(state.mo.current)) {
		state.mo.current[nation] = []
		state.mo.completed[nation] = []
		state.mo.progress[nation] = {}
		state.mo.drm_used[nation] = {}
	}
	const fr = data.pieces.find((piece) => piece.nation === "fr" && piece.type === "army")
	const br = data.pieces.find((piece) => piece.nation === "br" && piece.type === "army")
	const ge = data.pieces.find((piece) => piece.nation === "ge" && piece.type === "army")
	state.units = [
		{ id: "somme-fr", piece: fr.id, faction: "ap", nation: "fr", type: "army", location: origin, reduced: false, supplied: true },
		{ id: "somme-br", piece: br.id, faction: "ap", nation: "br", type: "army", location: origin, reduced: false, supplied: true },
		{ id: "somme-ge", piece: ge.id, faction: "cp", nation: "ge", type: "army", location: target, reduced: false, supplied: true },
	]
	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "limited"
	state.hands.ap = [624]
	rules.action(state, "Allied Powers", "card_event", 624)
	assert.equal(rules.view(state, "Allied Powers").actions.event_space.includes(target), true)
	rules.action(state, "Allied Powers", "event_space", target)
	rules.action(state, "Allied Powers", "event_confirm")
	assert.equal(state.markers.somme.space, target)
	state.active = "ap"
	assert.equal(rules._test.activationCost(state, origin, "attack", ["somme-fr", "somme-br"]), 1)
	state.combat_window = { attacker: "ap" }
	const modifiers = rules._test.combatModifiers(
		state,
		{ attackers: ["somme-fr", "somme-br"], target },
		state.units.slice(0, 2),
		[state.units[2]]
	)
	assert.equal(modifiers.attack_drm, 1)
	assert.equal(modifiers.attack_column, 1)
})

test("French Offensive Doctrine creates two AP forced attacks with the printed column penalty", () => {
	const state = setupGame(705)
	state.turn = 3
	state.active = "cp"
	state.state = "action_card"
	state.commitment.cp = "mobilization"
	state.hands.cp = [705]
	rules.action(state, "Central Powers", "card_event", 705)
	let actions = rules.view(state, "Central Powers").actions
	const spaces = actions.event_space.slice(0, 2)
	for (const space of spaces) rules.action(state, "Central Powers", "event_space", space)
	rules.action(state, "Central Powers", "event_confirm")
	assert.equal(state.active, "ap")
	assert.deepEqual(state.ops.forced_attacks.slice().sort(), spaces.slice().sort())
	assert.ok(spaces.every((space) => state.activations[space] === "attack"))

	const attackView = protocolView(state, "Allied Powers")
	actions = attackView.actions
	assert.equal(state.state, "ops_attack")
	const origin = state.units.find((unit) => unit.id === attackView.selection.selected[0]).location
	const target = actions.declare_attack.find((candidate) =>
		data.spaces.find((space) => space.id === origin).connections.includes(candidate)
	)
	// This test isolates the doctrine's printed column shift. Attacking and
	// defensive MO selection are covered separately and would pause combat.
	for (const nation of ["fr", "br", "it", "us", "ge", "ah", "tu"])
		state.mo.current[nation] = []
	assert.ok(attackView.selection.selected.length > 0)
	protocolAction(state, "Allied Powers", "declare_attack", target)
	rules.action(state, "Allied Powers", "pass")
	rules.action(state, "Central Powers", "pass")
	const printedMapShifts = state.combat.modifiers.modifier_sources
		.filter((source) => source.kind === "column")
		.reduce((total, source) => total + source.amount, 0)
	assert.equal(state.combat.modifiers.attack_column - printedMapShifts, -1)
})

test("Falkenhayn deploys its HQ and opens a +1 DRM action-round operation", () => {
	const state = playEvent(711)
	assert.equal(state.state, "ops_activate")
	assert.ok(state.ops)
	assert.equal(state.events[data.cards.find((card) => card.id === 711).event].expires, "action_round")
	assert.ok(state.units.some((unit) => unit.piece === "component-004"))
})

test("Eastern Army reinforcements pay one Russian-front step unless the treaty is active", () => {
	const paid = playEvent(747)
	assert.equal(paid.fronts.russian, 2)

	const treatyEvent = data.cards.find((card) => card.id === 745).event
	const free = rules.setup(749)
	free.turn = 8
	free.commitment.cp = "total"
	free.war_status.combined = 30
	free.fronts.russian = 4
	free.events[treatyEvent] = {
		faction: "cp",
		duration: "game",
		rule: data.card_effects[745].operations.find((operation) => operation.type === "rule_modifier")
	}
	free.active = "cp"
	free.state = "action_card"
	free.hands.cp = [749]
	rules.action(free, "Central Powers", "card_event", 749)
	rules.action(free, "Central Powers", "event_confirm")
	assert.equal(free.fronts.russian, 4)
})

test("Brest-Litovsk locks the Russian front and reduces its maintenance cost", () => {
	const state = rules.setup(745)
	const treaty = data.cards.find((card) => card.id === 745)
	state.events[treaty.event] = {
		faction: "cp",
		duration: "game",
		rule: data.card_effects[745].operations.find((operation) => operation.type === "rule_modifier")
	}
	state.fronts.russian = 8
	state.fronts.turkish = 9
	state.rp.cp.east = 10
	state.rp.ap.br = 10
	assert.equal(rules._test.beginFrontMaintenance(state), true)
	const easternMaintenance = state.pending_event.obligations.find(
		(obligation) => obligation.track === "russian" && obligation.pool === "east"
	)
	assert.equal(easternMaintenance.remaining, 0)
	assert.equal(state.rp.cp.east, 8)

	state.pending_event = null
	state.active = "cp"
	state.state = "replacement"
	assert.equal(rules.view(state, "Central Powers").actions.spend?.fronts?.includes("russian") || false, false)
})

test("Bulgaria schedules both AP remove-or-VP decisions as server events", () => {
	const state = playEvent(725)
	assert.equal(
		state.scheduled_events.filter((entry) => entry.kind === "bulgaria_choice").length,
		2
	)
	state.turn = 9
	assert.equal(rules._test.beginScheduledReturns(state), true)
	let actions = protocolView(state, "Allied Powers").actions
	assert.ok(actions.event_choose.includes("remove"))
	rules.action(state, "Allied Powers", "event_choose", "remove")
	actions = protocolView(state, "Allied Powers").actions
	const removed = actions.select_event_unit[0]
	selectEventUnits(state, "Allied Powers", [removed])
	assert.ok(state.permanently_removed_units.some((unit) => unit.id === removed))

	state.turn = 10
	assert.equal(rules._test.beginScheduledReturns(state), true)
	const beforeVp = state.vp
	rules.action(state, "Allied Powers", "event_choose", "vp")
	assert.equal(state.vp, beforeVp + 1)
	assert.equal(
		state.scheduled_events.filter((entry) => entry.kind === "bulgaria_choice").length,
		0
	)
})

test("604/605 Kitchener volunteers apply only the first shared war-status bonus and a BEF step loss", () => {
	const state = rules.setup(604)
	state.units.push({
		id: "test-bef",
		piece: "component-097",
		faction: "ap",
		nation: "br",
		type: "army",
		location: "london",
		reduced: false,
		moved: false,
		attacked: false,
		supplied: true,
		limited_supply: false
	})
	state.turn = 8
	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "total"
	state.hands.ap = [604]
	rules.action(state, "Allied Powers", "card_event", 604)
	while (state.pending_event?.kind === "reinforcement") {
		const actions = rules.view(state, "Allied Powers").actions
		if (actions.event_space?.length)
			rules.action(state, "Allied Powers", "event_space", actions.event_space[0])
		else rules.action(state, "Allied Powers", "event_confirm")
	}
	const bef = state.units.find((unit) => unit.piece === "component-097")
	assert.ok(bef)
	assert.equal(bef.reduced, true)
	assert.equal(state.war_status.ap, 1)
	assert.equal(state.war_status.combined, 1)

	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "total"
	state.hands.ap = [605]
	rules.action(state, "Allied Powers", "card_event", 605)
	while (state.pending_event?.kind === "reinforcement") {
		const actions = rules.view(state, "Allied Powers").actions
		if (actions.event_space?.length)
			rules.action(state, "Allied Powers", "event_space", actions.event_space[0])
		else rules.action(state, "Allied Powers", "event_confirm")
	}
	assert.equal(state.war_status.ap, 1)
	assert.equal(state.war_status.combined, 1)
})

test("605 Kitchener volunteers places a full BEF corps when every BEF army is already eliminated", () => {
	const state = rules.setup(605)
	state.eliminated.ap.push({
		id: "test-eliminated-bef-army",
		piece: "component-097",
		faction: "ap",
		nation: "br",
		type: "army",
		reduced: true
	})
	const before = state.reserves.ap.filter((unit) => unit.piece === "component-098").length
	state.turn = 8
	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "total"
	state.hands.ap = [605]
	rules.action(state, "Allied Powers", "card_event", 605)
	while (state.pending_event?.kind === "reinforcement") {
		const actions = rules.view(state, "Allied Powers").actions
		if (actions.event_space?.length)
			rules.action(state, "Allied Powers", "event_space", actions.event_space[0])
		else
			rules.action(state, "Allied Powers", "event_confirm")
	}
	const replacements = state.reserves.ap.filter((unit) => unit.piece === "component-098")
	assert.equal(replacements.length, before + 1)
	assert.equal(replacements.at(-1).reduced, false)
})

test("French veteran reinforcements rebuild two eliminated French units on their reduced side", () => {
	const state = rules.setup(615)
	const eliminated = state.units
		.filter((unit) => unit.faction === "ap" && unit.nation === "fr" && ["army", "corps"].includes(unit.type))
		.slice(0, 2)
	for (const unit of eliminated) {
		state.units.splice(state.units.findIndex((candidate) => candidate.id === unit.id), 1)
		delete unit.location
		state.eliminated.ap.push(unit)
	}
	state.turn = 8
	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "total"
	state.hands.ap = [615]
	rules.action(state, "Allied Powers", "card_event", 615)
	while (state.pending_event?.kind === "reinforcement") {
		const actions = rules.view(state, "Allied Powers").actions
		if (actions.event_space?.length)
			rules.action(state, "Allied Powers", "event_space", actions.event_space[0])
		else rules.action(state, "Allied Powers", "event_confirm")
	}
	assert.equal(state.pending_event.kind, "reinforcement_rebuild")
	selectEventUnits(state, "Allied Powers", eliminated.map((unit) => unit.id))
	while (state.pending_event?.kind === "reinforcement_rebuild") {
		const actions = rules.view(state, "Allied Powers").actions
		if (actions.event_space?.length)
			rules.action(state, "Allied Powers", "event_space", actions.event_space[0])
		else if (actions.reinforcement_to_reserve)
			rules.action(state, "Allied Powers", "reinforcement_to_reserve")
		else {
			rules.action(state, "Allied Powers", "event_confirm")
			break
		}
	}
	assert.ok(eliminated.every((unit) =>
		(state.units.includes(unit) || state.reserves.ap.includes(unit)) && unit.reduced))
})

test("1917 AEF replacements can be deployed to server-validated AP ports", () => {
	const state = playEvent(646)
	const existing = new Set(state.units.map((unit) => unit.id))
	state.turn = 9
	assert.equal(rules._test.applyRecurringReinforcements(state), true)
	assert.equal(state.pending_event.kind, "aef_replacements")
	rules.action(state, "Allied Powers", "event_choose", "ports")
	while (state.pending_event) {
		const actions = rules.view(state, "Allied Powers").actions
		if (actions.event_space?.length)
			rules.action(state, "Allied Powers", "event_space", actions.event_space[0])
		else rules.action(state, "Allied Powers", "event_confirm")
	}
	const ports = new Set(data.spaces.filter((space) => space.port).map((space) => space.id))
	const deployed = state.units.filter(
		(unit) => unit.piece === "component-103" && !existing.has(unit.id)
	)
	assert.equal(deployed.length, 3)
	assert.ok(deployed.every((unit) => ports.has(unit.location)))
})

test("Bulgaria offers its once-per-turn Turkish-front rollback after both replacement sides", () => {
	const state = playEvent(725)
	state.events.entry_tu = true
	state.turn = 9
	state.state = "replacement"
	state.phase = "补员/升级"
	state.active = "ap"
	state.replacement_active = "ap"
	state.fronts.turkish = 4
	state.turn_flags.turkish_front_advanced = 9
	state.rp.cp.ge = 3
	for (const nation of Object.keys(state.mo.current)) {
		state.mo.current[nation] = []
		state.mo.completed[nation] = []
	}
	rules.action(state, "Allied Powers", "finish")
	assert.equal(state.active, "cp")
	rules.action(state, "Central Powers", "finish")
	assert.equal(state.state, "replacement_discard_confirm")
	rules.action(state, "Central Powers", "confirm_discard_replacement_rp")
	assert.equal(state.pending_event.kind, "bulgaria_front_response")
	rules.action(state, "Central Powers", "event_choose", "use")
	assert.equal(state.fronts.turkish, 3)
	// The response spends 1 GE RP, then closes the replacement phase; the
	// remaining replacement points expire before the draw phase begins.
	assert.equal(state.rp.cp.ge, 0)
	assert.equal(state.usage_limits["bulgaria_front:9"], 1)
})

test("American reinforcement cards carry their printed OPS combat modifier", () => {
	const state = rules.setup(649)
	state.turn = 9
	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "total"
	state.hands.ap = [649]
	rules.action(state, "Allied Powers", "card_ops", 649)
	assert.deepEqual(state.ops.combat_effect, {
		attack_column: 1,
		ignore_trench_with_nation: "us"
	})
})

test("the US defense-win MO opens an optional immediate stack counterattack", () => {
	const state = rules.setup(650)
	const spaces = Object.fromEntries(data.spaces.map((space) => [space.id, space]))
	const attacker = state.units.find(
		(unit) =>
			unit.faction === "cp" &&
			state.units.some(
				(defender) =>
					defender.faction === "ap" &&
					spaces[unit.location]?.connections.includes(defender.location)
			)
	)
	const defender = state.units.find(
		(unit) =>
			unit.faction === "ap" &&
			spaces[attacker.location].connections.includes(unit.location)
	)
	defender.nation = "us"
	defender.piece = "component-102"
	defender.type = "army"
	const mo = "650:mo:us_defense_win:1"
	state.mo.pool.us = [{ id: mo, nation: "us", attacks: 0, requirement: "defense_win_counterattack" }]
	state.mo.current.us = [mo]
	state.mo.completed.us = []
	state.mo.progress.us = { [mo]: 0 }
	state.active = "cp"
	state.state = "combat_losses"
	state.ops = { remaining: 0, activated: [attacker.location], forced_attacks: [] }
	state.activations = { [attacker.location]: "attack" }
	state.combat = {
		attacker: "cp",
		attackers: [attacker.id],
		defenders: [defender.id],
		target: defender.location,
		attack_loss: 2,
		defense_loss: 0,
		defense_mo_assignments: { us: mo },
		modifiers: { cards: [] }
	}
	rules._test.applyCombatOutcomeEffects(state, state.combat)
	rules._test.finishCombatSequence(state)
	assert.equal(state.pending_event.kind, "mo_counterattack")
	rules.action(state, "Allied Powers", "event_choose", "use")
	rules.action(state, "Allied Powers", "finish")
	rules.action(state, "Allied Powers", "resolve_stack", defender.location)
	const counterattack = protocolView(state, "Allied Powers")
	assert.ok(counterattack.actions.declare_attack.includes(attacker.location))
	assert.ok(counterattack.selection.required.includes(defender.id))
})

test("late-war persistent tracks, mutiny RP, and the second Russian-front push are enforced", () => {
	const max = playEvent(750)
	max.entry_tracks.armistice = 3
	rules._test.applyWarStatusEntryTracks(max)
	assert.equal(max.entry_tracks.armistice, 2)
	max.turn += 1
	max.events[data.cards.find((card) => card.id === 745).event] = { faction: "cp", duration: "game" }
	rules._test.applyWarStatusEntryTracks(max)
	assert.equal(max.entry_tracks.armistice, 2)

	const mutiny = rules.setup(743)
	mutiny.turn = 10
	mutiny.commitment.cp = "total"
	mutiny.rp.ap.fr = 5
	mutiny.active = "cp"
	mutiny.state = "action_card"
	mutiny.hands.cp = [743]
	rules.action(mutiny, "Central Powers", "card_event", 743)
	assert.equal(mutiny.rp.ap.fr, 3)

	const eastern = rules.setup(737)
	eastern.events[data.cards.find((card) => card.id === 718).event] = { faction: "cp", duration: "game" }
	eastern.turn = 10
	eastern.commitment.cp = "total"
	eastern.active = "cp"
	eastern.state = "action_card"
	eastern.hands.cp = [737]
	rules.action(eastern, "Central Powers", "card_event", 737)
	eastern.state = "replacement"
	eastern.active = "cp"
	eastern.rp.cp.east = 10
	eastern.usage_limits["front:10:cp:russian"] = 1
	const before = eastern.rp.cp.east
	assert.ok(protocolView(eastern, "Central Powers").actions.spend_front.includes("russian"))
	protocolAction(eastern, "Central Powers", "spend_front", "russian")
	while (eastern.pending_event?.kind === "front_investment")
		rules.action(eastern, "Central Powers", "event_choose", "pay:east")
	assert.equal(eastern.rp.cp.east, before - 5.5)
})

test("Trentino event OPS are attack-only in Italy and receive no Italian-entry bonus", () => {
	const state = rules.setup(730)
	state.turn = 8
	state.commitment.cp = "total"
	state.events[data.cards.find((card) => card.id === 633).event] = { faction: "ap", duration: "instant" }
	state.events[data.cards.find((card) => card.id === 625).event] = {
		faction: "ap",
		duration: "instant",
		rule: data.card_effects[625].operations.find((operation) => operation.type === "rule_modifier")
	}
	state.active = "cp"
	state.state = "action_card"
	state.hands.cp = [730]
	rules.action(state, "Central Powers", "card_event", 730)
	const actions = rules.view(state, "Central Powers").actions
	assert.equal(state.ops.italian_bonus, 0)
	assert.deepEqual(actions.activate_move || [], [])
	assert.ok(
		(actions.activate_attack || []).every(
			(space) => data.spaces.find((candidate) => candidate.id === space).nation === "it"
		)
	)
})

test("Cambrai can commit one legal AP combat card directly from the discard pile", () => {
	const state = playEvent(638)
	const spaces = Object.fromEntries(data.spaces.map((space) => [space.id, space]))
	const attacker = state.units.find(
		(unit) =>
			unit.faction === "ap" &&
			state.units.some(
				(defender) =>
					defender.faction === "cp" &&
					spaces[unit.location]?.connections.includes(defender.location)
			)
	)
	const defender = state.units.find(
		(unit) =>
			unit.faction === "cp" &&
			spaces[attacker.location].connections.includes(unit.location)
	)
	state.active = "ap"
	state.state = "ops_activate"
	state.activations = { [attacker.location]: "attack" }
	state.ops = { remaining: 0, activated: [attacker.location], forced_attacks: [] }
	state.hands.ap = []
	state.discard.ap = [621]
	for (const nation of ["ge", "ah", "tu"]) state.mo.current[nation] = []
	rules._test.beginCombat(state, {
		attackers: [attacker.id],
		target: defender.location,
		flank: false
	})
	assert.ok(rules.view(state, "Allied Powers").actions.combat_card.includes(621))
	rules.action(state, "Allied Powers", "combat_card", 621)
	assert.equal(state.combat_modifiers.cards.some((entry) => entry.id === 621), true)
})

test("Somme expiry permanently removes Haig HQ", () => {
	const state = playEvent(624)
	state.units.push({
		id: "test-haig",
		piece: "component-007",
		faction: "ap",
		nation: "br",
		type: "hq",
		location: "london",
		reduced: false,
		moved: false,
		attacked: false,
		supplied: true,
		limited_supply: false
	})
	rules._test.clearCombatEvents(state, "action_round")
	assert.equal(state.units.some((unit) => unit.id === "test-haig"), false)
	assert.ok(state.permanently_removed_units.some((unit) => unit.id === "test-haig"))
})
