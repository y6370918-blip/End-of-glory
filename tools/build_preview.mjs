import { createRequire } from "node:module"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const require = createRequire(import.meta.url)
const rules = require("../rules.js")
const data = require("../data.js")
const root = join(import.meta.dirname, "..")
const scenario = process.argv[2] || "default"
const suffix = scenario === "default" ? "" : `.${scenario}`
const state = rules.setup(1914)
let previewRole = "Central Powers"
if (scenario === "action-card") {
	const id = 600
	for (const pool of [state.decks.ap, state.discard.ap, state.removed.ap]) {
		const index = pool.indexOf(id)
		if (index >= 0) pool.splice(index, 1)
	}
	state.hands.ap = [id]
	state.turn = 3
	state.phase = "行动阶段"
	state.state = "action_card"
	state.active = "ap"
	previewRole = "Allied Powers"
}
if (scenario === "movement") {
	const unit = state.units.find(
		(candidate) =>
			candidate.faction === "cp" &&
			candidate.type === "army" &&
			(data.pieces.find((piece) => piece.id === candidate.piece)?.movement || 0) >= 2
	)
	state.turn = 4
	state.active = "cp"
	state.state = "ops_move"
	state.units = [unit]
	unit.location = "mainz"
	unit.moved = false
	unit.attacked = false
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, "cp"]))
	state.activations = { mainz: "move" }
	state.ops = {
		card: null,
		total: 1,
		remaining: 0,
		activated: ["mainz"],
		moving: null,
		forced_attacks: [],
		preactivation_sr_used: [],
		preactivation_sr_units: [],
		entrench_attempted: [],
		pending_siege: null,
		activated_units: { mainz: [unit.id] },
		movement: null,
		execution_phase: "move"
	}
	rules.action(state, "Central Powers", "select_move_unit", unit.id)
}
if (scenario === "transit") {
	const unit = state.units.find(
		(candidate) =>
			candidate.location === "marfeuilles" &&
			candidate.faction === "cp" &&
			candidate.type === "corps" &&
			(data.pieces.find((piece) => piece.id === candidate.piece)?.movement || 0) === 5
	)
	state.turn = 1
	state.active = "cp"
	state.state = "ops_move"
	state.activations = { marfeuilles: "move" }
	state.ops = {
		card: null,
		total: 1,
		remaining: 0,
		activated: ["marfeuilles"],
		moving: null,
		forced_attacks: [],
		preactivation_sr_used: [],
		preactivation_sr_units: [],
		entrench_attempted: [],
		pending_siege: null,
		activated_units: { marfeuilles: [unit.id] },
		movement: null,
		execution_origin: "marfeuilles",
		execution_phase: "move",
		unresolved_stacks: ["marfeuilles"]
	}
	rules.action(state, "Central Powers", "select_move_unit", unit.id)
}
if (scenario === "stacks") {
	const spaces = ["aachen", "koblenz", "metz"].filter((space) =>
		state.units.some((unit) => unit.faction === "cp" && unit.location === space)
	)
	state.turn = 3
	state.active = "cp"
	state.state = "ops_choose_stack"
	state.activations = Object.fromEntries(spaces.map((space) => [space, "move"]))
	state.ops = {
		card: null,
		total: spaces.length,
		remaining: 0,
		activated: spaces.slice(),
		moving: null,
		forced_attacks: [],
		preactivation_sr_used: [],
		preactivation_sr_units: [],
		entrench_attempted: [],
		pending_siege: null,
		activated_units: Object.fromEntries(
			spaces.map((space) => [
				space,
				state.units.filter((unit) => unit.faction === "cp" && unit.location === space).map((unit) => unit.id)
			])
		),
		unresolved_stacks: spaces.slice()
	}
}
if (scenario === "markers") {
	state.turn = 3
	state.active = "cp"
	state.state = "ops_choose_stack"
	state.control.ghent = "cp"
	state.trenches = { antwerp: 1, brussels: 2 }
	state.fortifications = { brussels: 2 }
	state.markers = {
		somme: { space: "mons", source_card: 658, turn: state.turn },
		killing_ground: { space: "liege", cost: 2, source_card: 720 },
		hindenburg: ["bitburg"],
		salients: [{ space: "namur", source_card: 0 }]
	}
	state.activations = { antwerp: "move", brussels: "attack", aachen: "construct" }
	state.ops = {
		card: null,
		total: 3,
		remaining: 0,
		activated: ["antwerp", "brussels", "aachen"],
		moving: null,
		forced_attacks: [],
		preactivation_sr_used: [],
		preactivation_sr_units: [],
		entrench_attempted: [],
		pending_siege: null,
		activated_units: {
			antwerp: state.units.filter((unit) => unit.location === "antwerp").map((unit) => unit.id),
			brussels: state.units.filter((unit) => unit.location === "brussels").map((unit) => unit.id),
			aachen: state.units.filter((unit) => unit.location === "aachen").map((unit) => unit.id)
		},
		unresolved_stacks: ["antwerp", "brussels", "aachen"]
	}
}
if (scenario === "rp") {
	state.rp.ap = { br: 3.5, fr: 7, it: 12, a: 18.5, us: 24 }
	state.rp.cp = { ge: 5, ah: 15, east: 21.5 }
	state.events.entry_us = { turn: 10, faction: "ap", persistent: true }
}
if (["attack", "attack-confirm", "combat-choice", "combat", "combat-result"].includes(scenario)) {
	const attacker = state.units.find((unit) => unit.nation === "ge" && unit.type === "army")
	const defender = state.units.find((unit) => unit.faction === "ap" && unit.type === "army")
	state.turn = 4
	state.active = "cp"
	state.state = "ops_attack"
	state.units = [attacker, defender]
	attacker.location = "luxembourg"
	attacker.attacked = false
	defender.location = "arlon"
	defender.attacked = false
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, space.faction]))
	state.control.luxembourg = "cp"
	state.control.arlon = "ap"
	state.activations = { luxembourg: "attack" }
	state.ops = {
		card: null,
		total: 1,
		remaining: 0,
		activated: ["luxembourg"],
		forced_attacks: [],
		required_attackers: {},
		preactivation_sr_used: [],
		preactivation_sr_units: [],
		entrench_attempted: [],
		pending_siege: null,
		activated_units: { luxembourg: [attacker.id] },
		attack_selection: [attacker.id],
		execution_phase: "attack"
	}
	if (["combat-choice", "combat", "combat-result"].includes(scenario)) {
		const relocateCard = (faction, id, destination) => {
			for (const pool of [state.hands[faction], state.decks[faction], state.discard[faction], state.removed[faction]]) {
				const index = pool.indexOf(id)
				if (index >= 0) pool.splice(index, 1)
			}
			destination.push(id)
		}
		state.retained_combat_cards = { ap: [], cp: [] }
		relocateCard("cp", 702, state.hands.cp)
		relocateCard("ap", 621, state.hands.ap)
		relocateCard("ap", 622, state.retained_combat_cards.ap)
	}
	if (["attack-confirm", "combat-choice", "combat", "combat-result"].includes(scenario))
		rules.action(state, "Central Powers", "declare_attack", "arlon")
	if (["combat-choice", "combat", "combat-result"].includes(scenario)) {
		if (scenario !== "combat-choice") {
			rules.action(state, "Central Powers", "combat_card", 702)
			rules.action(state, "Central Powers", "pass")
			if (scenario === "combat-result") rules.action(state, "Allied Powers", "pass")
			previewRole = "Allied Powers"
		}
	}
}
const view = rules.view(state, previewRole)

await writeFile(
	join(root, `.preview_state${suffix}.js`),
	`window.view = ${JSON.stringify(view)};
window.params = { title_id: "end-of-glory" };
window.roles = [];
window.toggle_zoom = function () {};
window.send_action = function (action, arg) {
	document.getElementById("status").textContent =
		"视觉预览不会写入服务器：" + action + (arg === undefined ? "" : " " + JSON.stringify(arg));
};

document.addEventListener("DOMContentLoaded", function () {
	const header = document.querySelector("header");
	const main = document.querySelector("main");
	const panZoomMain = document.createElement("div");
	panZoomMain.id = "pan_zoom_main";
	panZoomMain.dataset.scale = "1";
	panZoomMain.style.transformOrigin = "0 0";
	while (main.firstChild) panZoomMain.append(main.firstChild);
	const panZoomWrap = document.createElement("div");
	panZoomWrap.id = "pan_zoom_wrap";
	panZoomWrap.append(panZoomMain);
	main.append(panZoomWrap);
	const toolbar = document.getElementById("toolbar");
	const mainMenu = toolbar.querySelector(":scope > details");
	const chatButton = document.createElement("button");
	chatButton.id = "chat_button";
	chatButton.innerHTML = '<img src="/images/chat-bubble.svg" alt="">';
	const logButton = document.createElement("button");
	logButton.id = "log_button";
	logButton.innerHTML = '<img src="/images/scroll-quill.svg" alt="">';
	logButton.addEventListener("click", function () {
		document.querySelector("aside").hidden = !document.querySelector("aside").hidden;
	});
	mainMenu.after(chatButton, logButton);
	if (window.innerWidth <= 800) document.querySelector("aside").hidden = true;
	const actions = document.createElement("div");
	actions.id = "actions";
	const prompt = document.createElement("div");
	prompt.id = "prompt";
	prompt.textContent = window.view.prompt;
	header.append(actions, prompt);

	for (const definition of [
		["Allied Powers", "协约国"],
		["Central Powers", "同盟国"]
	]) {
		const element = document.getElementById("role_" + definition[0].replace(/\\W/g, "_"));
		element.querySelector(".role_user").textContent = "视觉预览";
		window.roles.push({
			role: definition[0],
			element,
			name: element.querySelector(".role_name"),
			stat: element.querySelector(".role_stat")
		});
	}
	for (const [index, entry] of (window.view.log || []).entries()) {
		const line = typeof window.on_log === "function"
			? window.on_log(entry, index)
			: document.createTextNode(entry);
		document.getElementById("log").append(line);
	}
});
`,
	"utf8"
)

const source = await readFile(join(root, "play.html"), "utf8")
const preview = source
	.replace('<script defer src="/common/client.js"></script>', `<script defer src=".preview_state${suffix}.js"></script>`)
	.replace("<title>荣耀终结</title>", "<title>荣耀终结 - 视觉预览</title>")
await writeFile(join(root, `.preview${suffix}.html`), preview, "utf8")

process.stdout.write(`Generated .preview${suffix}.html and .preview_state${suffix}.js\n`)
