"use strict"

const rules = require("../rules.js")

function finishOpening(state, { augustGuns = false } = {}) {
	if (state.state === "opening_ap_card") {
		const view = rules.view(state, "Allied Powers")
		rules.action(state, "Allied Powers", "select_opening_card", view.actions.select_opening_card[0])
	}
	if (state.state === "opening_cp_august_guns") {
		if (augustGuns) rules.action(state, "Central Powers", "select_opening_card", 701)
		else rules.action(state, "Central Powers", "skip_august_guns")
	}
	return state
}

function setupGame(seed, scenario, options) {
	return finishOpening(rules.setup(seed, scenario, options))
}

module.exports = { finishOpening, setupGame }
