"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")

function clearMo(state) {
	for (const nation of ["fr", "br", "it", "us", "ge", "ah"]) {
		state.mo.current[nation] = []
		state.mo.completed[nation] = []
		state.mo.progress[nation] = {}
		state.mo.drm_used[nation] = {}
		state.mo.targets[nation] = {}
	}
}

function installMo(state, nation, id, completed = false) {
	state.mo.current[nation] = [id]
	state.mo.completed[nation] = completed ? [id] : []
	state.mo.progress[nation] = { [id]: 0 }
	state.mo.drm_used[nation] = { [id]: 0 }
	state.mo.targets[nation] = { [id]: [] }
}

test("the printed TTS MO bags contain exactly the 31 numbered backs", () => {
	const all = Object.values(data.mo).flat()
	assert.equal(all.length, 31)
	assert.deepEqual(
		Object.fromEntries(Object.entries(data.mo).map(([nation, markers]) => [nation, markers.length])),
		{ fr: 7, br: 8, it: 3, us: 2, ge: 8, ah: 3 }
	)
	assert.equal(all.some((marker) => marker.code === "B"), false)
	assert.ok(all.every((marker) => marker.name && marker.image_source))
})

test("printed attack MO bonuses use positive DRM and conditional targets", () => {
	const state = rules.setup(2201)
	clearMo(state)
	installMo(state, "fr", "fr-6")
	const attacker = {
		id: "fr-army",
		faction: "ap",
		nation: "fr",
		type: "army",
		location: "sedan"
	}
	state.units = [attacker]
	state.activations = { sedan: "attack" }
	let effect = rules._test.moAttackEffect(
		state,
		"fr",
		[attacker],
		{ attackers: [attacker.id], target: "rethel" }
	)
	assert.deepEqual(effect, { id: "fr-6", drm: 1, column: 0, table: null })

	installMo(state, "fr", "fr-11")
	attacker.location = "epinal"
	state.activations = { epinal: "attack" }
	effect = rules._test.moAttackEffect(
		state,
		"fr",
		[attacker],
		{ attackers: [attacker.id], target: "belfort" }
	)
	assert.equal(effect.id, "fr-11")
	effect = rules._test.moAttackEffect(
		state,
		"fr",
		[{ ...attacker, location: "sedan" }],
		{ attackers: [attacker.id], target: "rethel" }
	)
	assert.equal(effect, null)
})

test("no-offensive German MO applies its passive attack DRM", () => {
	const state = rules.setup(2202)
	clearMo(state)
	installMo(state, "ge", "ge-6", true)
	state.mo.revealed = ["ge-6"]
	const attacker = {
		id: "ge-army",
		faction: "cp",
		nation: "ge",
		type: "army",
		location: "sedan"
	}
	const defender = {
		id: "fr-army",
		faction: "ap",
		nation: "fr",
		type: "army",
		location: "rethel"
	}
	state.active = "cp"
	const modifiers = rules._test.combatModifiers(
		state,
		{ attackers: [attacker.id], target: "rethel", flank: false },
		[attacker],
		[defender]
	)
	assert.equal(modifiers.attack_drm, 1)
})

test("German front MO discounts and completes the mandatory Russian investment", () => {
	const state = rules.setup(2203)
	state.events["cp_坦能堡的英雄"] = true
	clearMo(state)
	installMo(state, "ge", "ge-10")
	state.state = "replacement"
	state.phase = "补员/升级"
	state.active = "cp"
	state.replacement_active = "cp"
	state.rp.cp = { east: 3.5, ge: 0, ah: 0 }

	assert.equal(rules._test.frontInvestmentSpec(state, "russian", "cp").cost, 3.5)
	rules.action(state, "Central Powers", "spend_front", "russian")
	while (state.pending_event?.kind === "front_investment") {
		const choice = rules
			.view(state, "Central Powers")
			.actions.event_choose.find((entry) => entry.startsWith("pay:"))
		assert.ok(choice)
		rules.action(state, "Central Powers", "event_choose", choice)
	}
	assert.equal(state.fronts.russian, 1)
	assert.deepEqual(state.mo.completed.ge, ["ge-10"])
})

test("mandatory front MO blocks other replacements and offers non-lethal RP losses", () => {
	const state = rules.setup(2204)
	state.events["cp_土耳其参战"] = true
	state.events["ap_丘吉尔"] = true
	state.events.entry_tu = true
	clearMo(state)
	installMo(state, "br", "br-6")
	state.state = "replacement"
	state.phase = "补员/升级"
	state.active = "ap"
	state.replacement_active = "ap"
	state.rp.ap = { br: 0, fr: 0, it: 0, us: 0 }
	const view = rules.view(state, "Allied Powers")
	assert.equal("finish" in view.actions, false)
	assert.equal(view.actions.spend_flip?.length || 0, 0)
	assert.ok(view.actions.mo_front_loss.length > 0)
	const id = view.actions.mo_front_loss[0]
	rules.action(state, "Allied Powers", "mo_front_loss", id)
	const unit =
		state.units.find((candidate) => candidate.id === id) ||
		state.reserves.ap.find((candidate) => candidate.id === id)
	assert.equal(unit.reduced, true)
})
