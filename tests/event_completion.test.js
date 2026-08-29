"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")

const ROLE = { ap: "Allied Powers", cp: "Central Powers" }

function card(id) {
	return data.cards.find((candidate) => candidate.id === id)
}

function prepareEvent(id, seed = id) {
	const eventCard = card(id)
	const state = rules.setup(seed)
	state.turn = 8
	state.action_round = 1
	state.active = eventCard.faction
	state.state = "action_card"
	state.phase = "行动阶段"
	state.commitment[eventCard.faction] = "total"
	state.hands[eventCard.faction] = [id]
	state.decks[eventCard.faction] = []
	state.discard[eventCard.faction] = []
	state.removed[eventCard.faction] = []
	const prerequisite = data.card_effects[id]?.prerequisites?.requires_event
	if (prerequisite) state.events[prerequisite] = { faction: eventCard.faction }
	return state
}

function finishReinforcement(state) {
	while (state.state.startsWith("event_") && state.pending_event?.kind === "reinforcement") {
		const role = ROLE[state.active]
		const actions = rules.view(state, role).actions
		if (actions.event_space?.length)
			rules.action(state, role, "event_space", actions.event_space[0])
		else if (actions.reinforcement_to_reserve)
			rules.action(state, role, "reinforcement_to_reserve")
		else if (actions.event_confirm)
			rules.action(state, role, "event_confirm")
		else throw new Error(`No reinforcement continuation: ${JSON.stringify(actions)}`)
	}
}

test("Sack of Belgium removes Belgian corps from every pool and creates the Belgian army in eliminated", () => {
	const state = prepareEvent(611)
	state.turn = 2
	const belgian = state.units.filter((unit) => unit.nation === "be" && unit.type === "corps").slice(0, 3)
	assert.equal(belgian.length, 3)
	const reserve = belgian[1]
	const eliminated = belgian[2]
	state.units = state.units.filter((unit) => ![reserve.id, eliminated.id].includes(unit.id))
	delete reserve.location
	delete eliminated.location
	state.reserves.ap.push(reserve)
	state.eliminated.ap.push(eliminated)

	rules.action(state, ROLE.ap, "card_event", 611)
	assert.equal(state.pending_event.kind, "sack_belgium")
	const candidates = rules.view(state, ROLE.ap).actions.select_event_unit
	assert.ok(candidates.includes(belgian[0].id))
	assert.ok(candidates.includes(reserve.id))
	assert.ok(candidates.includes(eliminated.id))
	for (const id of [reserve.id, eliminated.id])
		rules.action(state, ROLE.ap, "select_event_unit", id)
	rules.action(state, ROLE.ap, "event_units_confirm")

	assert.ok(state.permanently_removed_units.some((unit) => unit.id === reserve.id))
	assert.ok(state.permanently_removed_units.some((unit) => unit.id === eliminated.id))
	assert.ok(state.eliminated.ap.some((unit) => unit.piece === "component-022"))
	assert.ok(state.units.some((unit) => unit.id === belgian[0].id))
})

test("Piave River Line can exchange an incoming British army for an Italian army", () => {
	const state = prepareEvent(637)
	state.events.entry_it = true
	const source = data.spaces.find(
		(space) => space.nation === "it" && !space.supply && !space.ui?.hidden
	)
	assert.ok(source)
	state.control[source.id] = "ap"
	state.units = state.units.filter((unit) => unit.location !== source.id)
	const italianPiece = data.pieces.find((piece) => piece.nation === "it" && piece.type === "army")
	const italian = {
		id: "piave-italian",
		piece: italianPiece.id,
		faction: "ap",
		nation: "it",
		type: "army",
		location: source.id,
		reduced: false,
		moved: false,
		attacked: false,
		supplied: true,
		limited_supply: false,
	}
	state.units.push(italian)

	rules.action(state, ROLE.ap, "card_event", 637)
	const exchange = rules.view(state, ROLE.ap).actions.event_choose.find(
		(option) => option === `exchange:${italian.id}`
	)
	assert.ok(exchange)
	rules.action(state, ROLE.ap, "event_choose", exchange)
	const returnSpace = rules.view(state, ROLE.ap).actions.event_space.find(
		(space) => space !== source.id
	)
	assert.ok(returnSpace)
	rules.action(state, ROLE.ap, "event_space", returnSpace)
	finishReinforcement(state)

	assert.equal(italian.location, returnSpace)
	assert.ok(
		state.units.some(
			(unit) => unit.piece === "component-170" && unit.location === source.id
		)
	)
	assert.equal(state.sr.remaining, 2)
})

test("Convoy and British reserves permanently prohibit their opposing events", () => {
	const convoy = rules.setup(643)
	convoy.events[card(643).event] = { faction: "ap", duration: "game" }
	convoy.commitment.cp = "total"
	assert.equal(rules._test.eventLegal(convoy, card(723)), false)

	const reserves = rules.setup(645)
	reserves.events[card(645).event] = { faction: "ap", duration: "instant" }
	reserves.commitment.cp = "total"
	assert.equal(rules._test.eventLegal(reserves, card(731)), false)
})

test("Lenin immediate RP can repair a unit and preserves the unused point", () => {
	const state = prepareEvent(754)
	const unit = state.units.find(
		(candidate) => candidate.faction === "cp" && candidate.nation === "ge" && candidate.type === "army"
	)
	assert.ok(unit)
	unit.reduced = true
	state.rp.cp.ge = 0
	rules.action(state, ROLE.cp, "card_event", 754)
	rules.action(state, ROLE.cp, "event_choose", "ge_rp")
	assert.equal(state.pending_event.kind, "immediate_rp")
	assert.equal(state.pending_event.remaining.ge, 2)
	assert.ok(rules.view(state, ROLE.cp).actions.spend_flip.includes(unit.id))
	rules.action(state, ROLE.cp, "spend_flip", unit.id)
	assert.equal(unit.reduced, false)
	assert.equal(state.pending_event.remaining.ge, 1)
	assert.equal(state.rp.cp.ge, 1)
	rules.action(state, ROLE.cp, "event_choose", "done")
	assert.equal(state.pending_event, null)
	assert.equal(state.rp.cp.ge, 1)
})

test("Bulgaria grants both temporary RP pools and German War Industry grants its total-war RP once", () => {
	const bulgaria = prepareEvent(725)
	bulgaria.rp.cp.ge = 0
	bulgaria.rp.cp.ah = 0
	rules.action(bulgaria, ROLE.cp, "card_event", 725)
	assert.deepEqual(bulgaria.pending_event.remaining, { ge: 4, ah: 2 })
	assert.equal(bulgaria.rp.cp.ge, 4)
	assert.equal(bulgaria.rp.cp.ah, 2)
	rules.action(bulgaria, ROLE.cp, "event_choose", "done")

	const industry = prepareEvent(724)
	industry.rp.cp.ge = 0
	rules.action(industry, ROLE.cp, "card_event", 724)
	assert.equal(industry.rp.cp.ge, 1)
	assert.equal(industry.events[card(724).event].replacement_bonus.ge, 1)
})

test("Killing Ground starts with two SR, then places a zero-fire fort marker", () => {
	const state = prepareEvent(720)
	rules.action(state, ROLE.cp, "card_event", 720)
	assert.equal(state.state, "sr")
	assert.equal(state.sr.remaining, 2)
	assert.ok(state.sr.resume_event)
	rules.action(state, ROLE.cp, "finish")
	assert.equal(state.pending_event.operation.key, "killing_ground")
	const fort = rules.view(state, ROLE.cp).actions.event_space[0]
	assert.ok(fort)
	rules.action(state, ROLE.cp, "event_space", fort)
	rules.action(state, ROLE.cp, "event_confirm")
	assert.equal(state.markers.killing_ground.space, fort)
	assert.equal(rules._test.intactFort(state, fort) > 0, true)
})

test("Hindenburg Line withdraws one German stack, lays a trench, and places two removable markers", () => {
	const state = prepareEvent(736)
	const allied = state.units.filter((unit) => unit.faction === "ap")
	const german = state.units.find((unit) => unit.nation === "ge" && unit.type === "army")
	const austrian = state.units.filter((unit) => unit.nation === "ah" && unit.type === "corps").slice(0, 2)
	german.location = "metz"
	austrian[0].location = "rethel"
	austrian[1].location = "epernay"
	state.units = [...allied, german, ...austrian]
	state.control.rethel = "cp"
	state.control.epernay = "cp"

	rules.action(state, ROLE.cp, "card_event", 736)
	rules.action(state, ROLE.cp, "event_space", "metz")
	const retreat = rules.view(state, ROLE.cp).actions.event_space[0]
	rules.action(state, ROLE.cp, "event_space", retreat)
	state.trenches[retreat] = 1
	assert.equal(rules.view(state, ROLE.cp).actions.event_confirm, 1)
	rules.action(state, ROLE.cp, "event_confirm")
	const markers = []
	for (let index = 0; index < 2; index++) {
		const marker = rules.view(state, ROLE.cp).actions.event_space[0]
		markers.push(marker)
		rules.action(state, ROLE.cp, "event_space", marker)
	}
	rules.action(state, ROLE.cp, "event_confirm")

	assert.equal(state.trenches[retreat], 2)
	assert.deepEqual(state.markers.hindenburg.slice().sort(), markers.slice().sort())
	assert.ok(state.mo.pool.ge.some((entry) => entry.source_card === 736 && entry.drm === 1))
	rules._test.captureSpace(state, markers[0], "ap")
	assert.deepEqual(state.markers.hindenburg, [markers[1]])
})

test("Below map reinforcements and their rebuild destinations stay in the Italian theater", () => {
	const state = prepareEvent(735)
	state.events.entry_it = true
	for (const space of data.spaces.filter((candidate) => candidate.nation === "it"))
		state.control[space.id] = "cp"
	rules.action(state, ROLE.cp, "card_event", 735)
	assert.ok(
		rules.view(state, ROLE.cp).actions.event_space.every(
			(space) => data.spaces.find((candidate) => candidate.id === space)?.nation === "it"
		)
	)
	finishReinforcement(state)
	const restricted = state.units.find(
		(unit) => unit.reinforcement_card === 735 && ["army", "hq"].includes(unit.type)
	)
	assert.ok(restricted)
	state.units.splice(state.units.indexOf(restricted), 1)
	delete restricted.location
	state.eliminated.cp.push(restricted)
	state.pending_event = null
	state.sr = null
	state.state = "replacement"
	state.phase = "补员/升级"
	state.active = "cp"
	state.replacement_active = "cp"
	state.rp.cp.ge = 5
	const actions = rules.view(state, ROLE.cp).actions
	assert.ok(actions.spend_rebuild.includes(restricted.id))
	rules.action(state, ROLE.cp, "spend_rebuild", restricted.id)
	assert.equal(state.pending_event.kind, "replacement_rebuild")
	const destinations = rules.view(state, ROLE.cp).actions.event_space
	assert.ok(destinations.length)
	assert.equal(
		destinations.every((space) => ["tyrol", "carnicola"].includes(space)),
		true,
	)
	rules.action(state, ROLE.cp, "event_space", destinations[0])
	const rebuilt = state.units.find((unit) => unit.id === restricted.id)
	assert.ok(rebuilt)
	assert.ok(["tyrol", "carnicola"].includes(rebuilt.location))
})

test("legacy Piave and Below reinforcement instances adopt their dedicated counters", () => {
	const state = rules.setup(735637)
	state.units.push(
		{ id: "old-br-it", piece: "component-093", reinforcement_card: 637, faction: "ap", nation: "br", type: "army", location: "venice" },
		{ id: "old-fr-it", piece: "component-026", reinforcement_card: 637, faction: "ap", nation: "fr", type: "army", location: "udine" },
		{ id: "old-ge-it", piece: "component-033", reinforcement_card: 735, faction: "cp", nation: "ge", type: "army", location: "bozen" },
	)
	rules.view(state, ROLE.ap)
	assert.equal(state.units.find((unit) => unit.id === "old-br-it").piece, "component-170")
	assert.equal(state.units.find((unit) => unit.id === "old-fr-it").piece, "component-169")
	assert.equal(state.units.find((unit) => unit.id === "old-ge-it").piece, "component-167")
})
