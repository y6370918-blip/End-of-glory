"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")

const AP = "Allied Powers"
const CP = "Central Powers"

function replacementState(faction = "ap") {
	const state = rules.setup(42001)
	state.turn = 6
	state.commitment[faction] = "limited"
	state.state = "replacement"
	state.phase = "补员/升级"
	state.active = faction
	state.replacement_active = faction
	for (const key of Object.keys(state.rp[faction])) state.rp[faction][key] = 0
	return state
}

function addUnit(state, { id, piece, location = "paris", reduced = false, zone = "map" }) {
	const definition = data.pieces.find((candidate) => candidate.id === piece)
	const unit = {
		id,
		piece,
		faction: definition.faction,
		nation: definition.nation,
		type: definition.type,
		reduced,
	}
	if (zone === "map") {
		unit.location = location
		unit.supplied = true
		unit.fort_limited_supply = false
		state.units.push(unit)
	} else {
		state[zone][definition.faction].push(unit)
	}
	return unit
}

function upgradeOffered(state, role, id) {
	const actions = rules.view(state, role).actions
	return Boolean(actions.spend_upgrade?.includes(id)) ||
		Boolean(actions.spend_option?.some((token) => token.startsWith(`upgrade:${id}:`)))
}

test("v42 hides veteran pools during Mobilization and fills the printed Limited War base", () => {
	const state = rules.setup(42002)
	assert.deepEqual(rules.view(state, AP).upgrade_pool, { ap: [], cp: [] })
	state.commitment.ap = "limited"
	state.commitment.cp = "limited"
	rules._test.populateVeteranUpgradePool(state, "ap")
	rules._test.populateVeteranUpgradePool(state, "cp")
	const count = (faction, piece) =>
		state.upgrade_pool[faction].filter((unit) => unit.piece === piece).length
	assert.equal(count("ap", "component-105"), 3)
	assert.equal(count("ap", "component-104"), 4)
	assert.equal(count("ap", "component-091"), 2)
	assert.equal(count("ap", "component-092"), 4)
	assert.equal(count("cp", "component-108"), 5)
	assert.equal(count("cp", "component-107"), 7)
})

test("v42 rejects reserve, Belgian, BEF, German East and Indian veteran sources", () => {
	const ap = replacementState("ap")
	ap.rp.ap.br = 4
	ap.rp.ap.fr = 4
	ap.rp.ap.us = 4
	const rejectedAp = [
		addUnit(ap, { id: "belgian", piece: "component-023" }),
		addUnit(ap, { id: "bef-army", piece: "component-097", location: "london" }),
		addUnit(ap, { id: "bef-corps", piece: "component-098", location: "london" }),
		addUnit(ap, { id: "indian", piece: "component-089", location: "london" }),
		addUnit(ap, { id: "indian-cavalry", piece: "component-090", location: "london" }),
		addUnit(ap, { id: "reserve-french", piece: "component-028", zone: "reserves" }),
	]
	for (const unit of rejectedAp)
		assert.equal(upgradeOffered(ap, AP, unit.id), false, unit.id)
	const british = addUnit(ap, { id: "ordinary-british", piece: "component-094", location: "london" })
	assert.equal(upgradeOffered(ap, AP, british.id), true)

	const cp = replacementState("cp")
	cp.rp.cp.ge = 4
	const eastArmy = addUnit(cp, { id: "east-army", piece: "component-110", location: "essen" })
	const eastCorps = addUnit(cp, { id: "east-corps", piece: "component-109", location: "essen" })
	assert.equal(upgradeOffered(cp, CP, eastArmy.id), false)
	assert.equal(upgradeOffered(cp, CP, eastCorps.id), false)
	const german = addUnit(cp, { id: "ordinary-german", piece: "component-034", location: "essen" })
	assert.equal(upgradeOffered(cp, CP, german.id), true)
})

test("v42 map LCU upgrades at its space or a national supply source and preserves identity and face", () => {
	const state = replacementState("ap")
	state.rp.ap.fr = 3
	const first = addUnit(state, {
		id: "map-fr-army-1",
		piece: "component-026",
		location: "paris",
		reduced: true,
	})
	const poolBefore = state.upgrade_pool.ap.filter((unit) => unit.piece === "component-105").length
	rules.action(state, AP, "spend_upgrade", first.id)
	const placement = rules.view(state, AP)
	assert.equal(placement.prompt, "补员：选择老兵替换位置。")
	assert.equal(placement.actions.event_space.includes("paris"), true)
	assert.equal(placement.actions.event_space.includes("orleans"), true)
	rules.action(state, AP, "event_space", "orleans")
	const veteran = state.units.find((unit) => unit.id === first.id)
	assert.equal(veteran.piece, "component-105")
	assert.equal(veteran.location, "orleans")
	assert.equal(veteran.reduced, true)
	assert.equal(state.rp.ap.fr, 3)
	assert.equal(state.upgrade_pool.ap.filter((unit) => unit.piece === "component-105").length, poolBefore - 1)
	const removed = state.permanently_removed_units.find((unit) =>
		unit.removed_by === "veteran_upgrade" && unit.piece === "component-026")
	assert.ok(removed)
	assert.notEqual(removed.id, veteran.id)
	assert.equal(removed.location, undefined)

	const second = addUnit(state, { id: "map-fr-army-2", piece: "component-026", location: "paris" })
	rules.action(state, AP, "spend_upgrade", second.id)
	rules.action(state, AP, "event_space", "paris")
	assert.equal(state.rp.ap.fr, 2)
})

test("v42 eliminated LCU remains eliminated while an eliminated SCU may enter reserve", () => {
	const armyState = replacementState("ap")
	armyState.rp.ap.fr = 3
	const army = addUnit(armyState, {
		id: "eliminated-fr-army",
		piece: "component-026",
		reduced: true,
		zone: "eliminated",
	})
	rules.action(armyState, AP, "spend_upgrade", army.id)
	assert.equal(armyState.state, "replacement")
	assert.equal(armyState.eliminated.ap.find((unit) => unit.id === army.id)?.piece, "component-105")
	assert.equal(armyState.eliminated.ap.find((unit) => unit.id === army.id)?.reduced, true)

	const corpsState = replacementState("ap")
	corpsState.rp.ap.fr = 3
	const corps = addUnit(corpsState, {
		id: "eliminated-fr-corps",
		piece: "component-028",
		zone: "eliminated",
	})
	rules.action(corpsState, AP, "spend_upgrade", corps.id)
	const actions = rules.view(corpsState, AP).actions
	assert.equal(actions.replacement_to_reserve, 1)
	assert.equal(actions.replacement_to_eliminated, 1)
	rules.action(corpsState, AP, "replacement_to_reserve")
	assert.equal(corpsState.reserves.ap.find((unit) => unit.id === corps.id)?.piece, "component-104")
	assert.equal(corpsState.eliminated.ap.some((unit) => unit.id === corps.id), false)
})

test("v42 immediate RP upgrades are paid and do not consume the formal free upgrade", () => {
	const state = replacementState("ap")
	state.rp.ap.fr = 2
	const unit = addUnit(state, { id: "immediate-fr-corps", piece: "component-028" })
	state.state = "event"
	state.phase = "行动阶段"
	state.pending_event = {
		kind: "immediate_rp",
		card: 601,
		owner: "ap",
		chooser: "ap",
		remaining: { fr: 1 },
		mode: "spend",
	}
	assert.equal(upgradeOffered(state, AP, unit.id), true)
	rules.action(state, AP, "spend_upgrade", unit.id)
	rules.action(state, AP, "event_space", "paris")
	assert.equal(state.rp.ap.fr, 1.5)
	assert.equal(state.pending_event.remaining.fr, 0.5)
	assert.equal(state.usage_limits[`veteran_upgrade:${state.turn}:fr:corps`] || 0, 0)

	state.pending_event = null
	state.state = "replacement"
	state.phase = "补员/升级"
	const formal = addUnit(state, { id: "formal-fr-corps", piece: "component-028" })
	rules.action(state, AP, "spend_upgrade", formal.id)
	rules.action(state, AP, "event_space", "paris")
	assert.equal(state.rp.ap.fr, 1.5)
})

test("v42 German War Industry adds one formal free SCU upgrade only", () => {
	const state = replacementState("cp")
	state.rp.cp.ge = 2
	state.events[data.cards.find((card) => card.id === 724).event] = {
		faction: "cp",
		free_upgrade: { nation: "ge", type: "corps", count: 1 },
	}
	for (let index = 1; index <= 3; index += 1) {
		const unit = addUnit(state, {
			id: `war-industry-corps-${index}`,
			piece: "component-034",
			location: "essen",
		})
		rules.action(state, CP, "spend_upgrade", unit.id)
		rules.action(state, CP, "event_space", "essen")
	}
	assert.equal(state.rp.cp.ge, 1.5)
	assert.equal(state.usage_limits[`veteran_upgrade:${state.turn}:ge:corps`], 3)
})

test("v42 cancels an obsolete reserve-source upgrade without spending RP or a veteran", () => {
	const state = replacementState("ap")
	state.version = 41
	state.usage_limits["veteran_pool:ap"] = 1
	state.rp.ap.fr = 2
	const reserve = addUnit(state, {
		id: "legacy-reserve-source",
		piece: "component-028",
		zone: "reserves",
	})
	const poolBefore = state.upgrade_pool.ap.length
	state.state = "event"
	state.pending_event = {
		kind: "veteran_upgrade",
		owner: "ap",
		faction: "ap",
		unit: reserve.id,
		source_zone: "reserve",
		key: "fr",
	}
	rules.view(state, AP)
	assert.equal(state.version, 42)
	assert.equal(state.state, "replacement")
	assert.equal(state.pending_event, null)
	assert.equal(state.reserves.ap.some((unit) => unit.id === reserve.id), true)
	assert.equal(state.upgrade_pool.ap.length, poolBefore)
	assert.equal(state.rp.ap.fr, 2)
})
