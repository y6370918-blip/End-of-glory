"use strict"

/* global view */

window.replay_query = function () {
	return {
		turn: view.turn,
		action_round: view.action_round,
		phase: view.phase,
		active: view.active,
		vp: view.vp
	}
}
