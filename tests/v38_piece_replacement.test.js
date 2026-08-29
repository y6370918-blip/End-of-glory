"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

const ROLE = { ap: "Allied Powers", cp: "Central Powers" }
const piece = (id) => data.pieces.find((entry) => entry.id === id)

function unit(id, pieceId, location, reduced = true) {
	const spec = piece(pieceId)
	return {
		id, piece: pieceId, location, reduced,
		faction: spec.faction, nation: spec.nation, type: spec.type,
		moved: false, attacked: false, supplied: true, fort_limited_supply: false,
	}
}

function replacementState(seed, faction, units) {
	const state = setupGame(seed)
	state.units = units
	state.active = faction
	state.replacement_active = faction
	state.state = "replacement"
	state.phase = "补员/升级"
	for (const key of Object.keys(state.rp[faction])) state.rp[faction][key] = 20
	return state
}

test("v38 cavalry, Indian, BEF, and German eastern pieces have explicit triangle rules", () => {
	const cavalry = data.pieces.filter((entry) =>
		["army", "corps"].includes(entry.type) && entry.cavalry)
	assert.ok(cavalry.length > 0)
	for (const entry of cavalry) {
		assert.equal(entry.accepts_replacement_points, true, entry.name)
		assert.equal(entry.permanent_on_elimination, true, entry.name)
	}
	for (const id of ["component-089", "component-097", "component-098", "component-109", "component-110"]) {
		assert.equal(piece(id).accepts_replacement_points, false, piece(id).name)
		assert.equal(piece(id).permanent_on_elimination, true, piece(id).name)
	}
	assert.equal(piece("component-090").accepts_replacement_points, true)
})

test("v38 Indian cavalry may receive RP while Indian infantry, BEF, and eastern units may not", () => {
	const indianCavalry = unit("indian-cavalry", "component-090", "london")
	const indianInfantry = unit("indian-infantry", "component-089", "london")
	const bef = unit("bef", "component-097", "london")
	const ap = replacementState(38001, "ap", [indianCavalry, indianInfantry, bef])
	const apView = rules.view(ap, ROLE.ap).actions
	const apFlips = apView.spend_flip || []
	assert.equal((apView.spend_option || []).some((token) => token.startsWith(`flip:${indianCavalry.id}:`)), true)
	assert.equal(apFlips.includes(indianInfantry.id), false)
	assert.equal(apFlips.includes(bef.id), false)

	const eastern = unit("eastern", "component-110", "aachen")
	const cp = replacementState(38002, "cp", [eastern])
	assert.equal((rules.view(cp, ROLE.cp).actions.spend_flip || []).includes(eastern.id), false)
})

test("v38 a supplied cavalry LCU is permanently removed but still places its reserve SCU", () => {
	const state = setupGame(38003)
	const army = unit("cavalry-army", "component-017", "udine")
	const corps = unit("cavalry-corps", "component-019", null, false)
	delete corps.location
	state.units = [army]
	state.reserves.ap = [corps]
	state.eliminated.ap = []
	state.permanently_removed_units = []
	state.state = "combat_losses"
	state.combat = {
		attacker: "cp",
		attackers: [],
		defenders: [army.id],
		pending_side: "ap",
		mo_assignments: {},
		resolution_events: [],
	}

	rules._test.reduceCombatUnit(state, army.id)
	assert.equal(state.permanently_removed_units.some((entry) => entry.id === army.id), true)
	assert.equal(state.eliminated.ap.some((entry) => entry.id === army.id), false)
	const replacement = state.units.find((entry) => entry.id === corps.id)
	assert.ok(replacement)
	assert.equal(replacement.location, "udine")
	assert.equal(replacement.reduced, false)
})

test("v38 supplied BEF and German eastern LCUs also place their corresponding SCU", () => {
	for (const [seed, armyPiece, corpsPiece, faction, space, attacker] of [
		[38005, "component-097", "component-098", "ap", "london", "cp"],
		[38006, "component-110", "component-109", "cp", "aachen", "ap"],
	]) {
		const state = setupGame(seed)
		const army = unit(`army-${seed}`, armyPiece, space)
		const corps = unit(`corps-${seed}`, corpsPiece, null, false)
		delete corps.location
		state.units = [army]
		state.reserves[faction] = [corps]
		state.eliminated[faction] = []
		state.permanently_removed_units = []
		state.state = "combat_losses"
		state.combat = {
			attacker,
			attackers: faction === attacker ? [army.id] : [],
			defenders: faction === attacker ? [] : [army.id],
			pending_side: faction,
			mo_assignments: {},
			resolution_events: [],
		}
		rules._test.reduceCombatUnit(state, army.id)
		assert.equal(state.permanently_removed_units.some((entry) => entry.id === army.id), true)
		assert.equal(state.eliminated[faction].some((entry) => entry.id === army.id), false)
		assert.equal(state.units.find((entry) => entry.id === corps.id)?.location, space)
	}
})

test("v38 migration moves already-eliminated triangle units to the permanent pool", () => {
	const state = setupGame(38004)
	const cavalry = unit("old-cavalry", "component-031", null)
	delete cavalry.location
	state.eliminated.ap.push(cavalry)
	state.version = 37
	rules.view(state, ROLE.ap)
	assert.equal(state.version, 46)
	assert.equal(state.eliminated.ap.some((entry) => entry.id === cavalry.id), false)
	assert.equal(state.permanently_removed_units.some((entry) => entry.id === cavalry.id), true)
})
