"use strict"

const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")

test("blue cards and naval event cards are the same card set", () => {
	for (const card of data.cards)
		assert.equal(Boolean(card.naval_card), card.color === "blue", `card ${card.id}`)
})
const root = path.resolve(__dirname, "..")

test("118 cards use stable TTS card ids", () => {
	assert.equal(data.cards.length, 118)
	assert.deepEqual(
		data.cards.filter((card) => card.faction === "ap").map((card) => card.id),
		Array.from({ length: 59 }, (_, index) => 600 + index)
	)
	assert.deepEqual(
		data.cards.filter((card) => card.faction === "cp").map((card) => card.id),
		Array.from({ length: 59 }, (_, index) => 700 + index)
	)
	for (const card of data.cards) {
		assert.ok(card.effect.length > card.title.length, `missing card text: ${card.id}`)
		assert.ok(card.ocr_confidence >= 60, `low OCR confidence: ${card.id}`)
	}
})

test("all cards have explicit validated effect specifications", () => {
	assert.equal(Object.keys(data.card_effects).length, 118)
	for (const card of data.cards) {
		const spec = data.card_effects[card.id]
		assert.equal(spec.card_id, card.id)
		assert.equal(spec.event, card.event)
		if (card.event == null) {
			assert.deepEqual(spec.timing, [])
			assert.deepEqual(spec.operations, [])
		} else {
			assert.ok(spec.timing.length)
			assert.ok(spec.operations.length)
		}
		assert.equal(
			spec.operations.some((operation) => operation.type === "rule"),
			false,
			`generic rule fallback: ${card.id}`
		)
		assert.equal(spec.disposition, card.remove ? "remove" : "discard")
		if (card.combat_card) {
			assert.equal(spec.duration === "combat" || spec.duration === "turn" || spec.duration === "action_round", true)
			assert.ok(spec.combat)
			assert.deepEqual(
				Object.keys(spec.combat.disposition).sort(),
				["after_combat", "retain_on_win", "retained_after_use", "win_draw"].sort(),
				`combat-card disposition: ${card.id}`
			)
			assert.equal(typeof spec.combat.disposition.retain_on_win, "boolean")
			assert.ok([null, "discard", "remove", "transfer"].includes(spec.combat.disposition.after_combat))
			assert.ok([null, "optional", "mandatory"].includes(spec.combat.disposition.win_draw))
			assert.ok(["discard", "remove", "transfer"].includes(spec.combat.disposition.retained_after_use))
		}
	}
})

test("map uses the 6082x6000 source coordinate system at a unified 0.75 display scale", () => {
	assert.deepEqual(data.ui.map, {
		width: 6082,
		height: 6000,
		image: "assets/map.webp",
		image_2x: "assets/map.png"
	})
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
	const html = fs.readFileSync(path.join(root, "play.html"), "utf8")
	assert.match(client, /MAP_DISPLAY_SCALE = 0\.75/)
	assert.doesNotMatch(client, /3041|3000/)
	assert.match(css, /--map-width: 4562px/)
	assert.match(css, /--map-height: 4500px/)
	assert.match(html, /assets\/map\.webp 4562w, assets\/map\.png 6082w/)
	assert.match(html, /data-max-zoom="2"/)
})

test("VP spaces are formal map attributes instead of a separate rules list", () => {
	const vpSpaces = data.spaces.filter((space) => space.vp).map((space) => space.id).sort()
	assert.deepEqual(vpSpaces, [
		"amiens", "antwerp", "bar_le_duc", "beauvais", "brussels", "calais",
		"cambrai", "chateau_thierry", "chaumont", "compiegne", "dijon", "essen",
		"evreux", "gorizia", "koblenz", "lille", "melun", "metz", "mulhouse",
		"nancy", "noyon", "orleans", "ostend", "paris", "reims", "sens",
		"sezanne", "strasbourg", "trent", "treviso", "trieste", "troyes",
		"udine", "venice", "verdun", "verona", "ypres"
	])
	const constants = fs.readFileSync(path.join(root, "modules", "core", "constants.js"), "utf8")
	assert.doesNotMatch(constants, /FRENCH_VP_SPACES/)
})

test("reserve boxes and track markers use source-map coordinates before display scaling", () => {
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	assert.match(client, /function sourceToDisplay\(value\)/)
	assert.match(client, /const layout = eog_data\.ui\?\.tracks\?\.\[track\]/)
	assert.match(client, /x: sourceToDisplay\(slot\[0\]\)/)
	assert.match(client, /y: sourceToDisplay\(slot\[1\]\)/)
	assert.match(client, /x: \[140, 320, 500, 680, 860, 1030\]/)
	assert.match(client, /x: \[5050, 5230, 5410, 5590, 5770, 5950\]/)
	assert.match(client, /sourceToDisplay\(layout\.x\[groupIndex\]\)/)
	assert.match(client, /sourceToDisplay\(frame\.face === "full" \? layout\.fullY : layout\.reducedY\)/)
	assert.doesNotMatch(client, /fullY: 1780|fullY: 595|y: 2548|y: 2914/)
})

test("the private hand uses the PUG panel list and readable adaptive cards", () => {
	const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
	const html = fs.readFileSync(path.join(root, "play.html"), "utf8")
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	assert.match(css, /\.panel-list\s*\{[^}]*width: var\(--map-width\)/s)
	assert.match(css, /\.card-row:not\(:empty\)\s*\{[^}]*min-height: calc\(var\(--card-height\) \+ 8px\)/s)
	assert.match(css, /\.card-thumb\s*\{[^}]*flex: 0 0 var\(--card-width\)[^}]*width: var\(--card-width\)[^}]*height: var\(--card-height\)/s)
	assert.match(client, /Math\.min\(1\.2, Math\.max\(0\.72, effectiveMapScale\)\)/)
	assert.doesNotMatch(css, /\.card-thumb\s*\{[^}]*width: 128px/s)
	assert.match(html, /<section id="hand-panel" class="panel">\s*<div class="panel-head">手牌<\/div>\s*<div id="cards" class="panel-body card-row"><\/div>/s)
	assert.doesNotMatch(html, /id="deck-count"|id="show-discard"|私人手牌/)
})

test("the private MO tray follows the hand and uses stable full-size counters", () => {
	const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
	const html = fs.readFileSync(path.join(root, "play.html"), "utf8")
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	assert.match(
		html,
		/<section id="hand-panel"[\s\S]*?<\/section>[\s\S]*?<section id="mo-panel"[^>]*hidden[^>]*>[\s\S]*?<div id="mo-list" class="panel-body"><\/div>/
	)
	assert.match(css, /#mo-panel\[hidden\]\s*\{[^}]*display: none/s)
	assert.match(css, /\.mo-counter\s*\{[^}]*width: var\(--counter-standard\)[^}]*height: var\(--counter-standard\)/s)
	assert.match(client, /const moElements = new Map\(\)/)
	assert.match(client, /function ensureMoElement\(id\)/)
	assert.match(client, /moElements\.get\(id\)/)
	assert.match(client, /perform\(entry\.action, entry\.option\)/)
	assert.match(client, /const noneOption = `mo:\$\{nation\}:none`/)
	assert.match(client, /perform\(moAction, noneOption\)/)
})

test("all card and piece assets exist", () => {
	for (const card of data.cards) {
		assert.ok(fs.existsSync(path.join(root, "assets", card.image)), card.image)
		assert.ok(fs.existsSync(path.join(root, "assets", card.image_2x)), card.image_2x)
	}
	for (const piece of data.pieces) {
		if (piece.image) assert.ok(fs.existsSync(path.join(root, "assets", piece.image)), piece.image)
		if (piece.image_back) assert.ok(fs.existsSync(path.join(root, "assets", piece.image_back)), piece.image_back)
	}
})

test("every combat unit uses audited printed front and reduced values", () => {
	const audited = JSON.parse(fs.readFileSync(path.join(root, "data", "source", "piece_values.json"), "utf8"))
	const combatPieces = data.pieces.filter((piece) => ["army", "corps"].includes(piece.type))
	assert.equal(Object.keys(audited).length, combatPieces.length)
	for (const piece of combatPieces) {
		const values = audited[piece.id]
		assert.ok(values, piece.id)
		assert.equal(piece.type, values.type)
		assert.deepEqual([piece.combat, piece.loss, piece.movement], values.full, piece.id)
		assert.deepEqual(
			[piece.reduced_combat, piece.reduced_loss, piece.reduced_movement],
			values.reduced,
			`${piece.id} reduced`
		)
		assert.ok(piece.image_back)
	}
	const germanRecruit = data.pieces.find((piece) => piece.id === "component-033")
	assert.deepEqual(
		[germanRecruit.combat, germanRecruit.loss, germanRecruit.movement],
		[4, 2, 3]
	)
	for (const [id, nation, source] of [
		["component-169", "fr", "法国意大利LCU.png"],
		["component-170", "br", "英国意大利LCU.png"],
		["component-167", "ge", "德国意大利新兵.png"],
	]) {
		const piece = data.pieces.find((candidate) => candidate.id === id)
		assert.ok(piece, id)
		assert.equal(piece.nation, nation)
		assert.equal(piece.type, "army")
		assert.match(piece.source, new RegExp(source.replace(".", "\\.")))
		assert.deepEqual([piece.combat, piece.loss, piece.movement], [4, 2, 4])
		assert.deepEqual(
			[piece.reduced_combat, piece.reduced_loss, piece.reduced_movement],
			[3, 2, 4],
		)
	}
	for (const id of ["component-166", "component-167"])
		assert.deepEqual(
			data.pieces.find((piece) => piece.id === id).combined_nations,
			["ge", "ah"],
		)
})

test("RTT title fragments and cover assets follow the server contract", () => {
	for (const file of ["cover.1x.jpg", "cover.2x.jpg", "thumbnail.jpg"])
		assert.ok(fs.existsSync(path.join(root, file)), file)

	for (const file of ["about.html", "create.html"]) {
		const fragment = fs.readFileSync(path.join(root, file), "utf8")
		assert.doesNotMatch(fragment, /<!doctype|<html|<head|<body/i, `${file} must be an HTML fragment`)
	}

	const create = fs.readFileSync(path.join(root, "create.html"), "utf8")
	assert.match(create, /\/end-of-glory\/cover\.1x\.jpg/)
})

test("RTT play page exposes the common client DOM contract", () => {
	const play = fs.readFileSync(path.join(root, "play.html"), "utf8")
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	for (const required of [
		'id="toolbar"',
		"<details>",
		"<menu>",
		'id="roles"',
		'id="turn_info"',
		'id="log"',
		'id="mapwrap"',
		'id="map"',
		'<footer id="status">'
	])
		assert.ok(play.includes(required), `missing RTT play element: ${required}`)
	assert.doesNotMatch(play, /<header[^>]+id="status"/)
	assert.doesNotMatch(play, /id="actions"|id="prompt"/)
	assert.match(client, /localStorage\.getItem\(fitKey\).*toggle_zoom\(\)/s)
	assert.match(client, /function renderRoles\(\)/)
	assert.match(client, /value === 1[\s\S]*EogActionProtocol\.labelFor\(action, undefined, view\.action_labels\)/)
})

test("RTT client dispatches every legal action through the shared protocol", () => {
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	assert.match(client, /EogActionProtocol\.indexTargets\(view\.actions \|\| \{\}\)/)
	assert.match(client, /EogActionProtocol\.allows\(view\?\.actions, name, arg\)/)
	assert.match(client, /send_action\(name, arg\)/)
	assert.doesNotMatch(client, /send_action\([^,]+,\s*\{/)
})

test("occupied legal spaces and pieces use the protocol target index", () => {
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	assert.match(client, /targetIndex\.spaces\.get\(space\) \|\| \[\]/)
	assert.match(client, /targetIndex\.pieces\.get\(id\) \|\| \[\]/)
	assert.match(client, /frame\.legal \? " space-legal" : ""/)
})

test("map activation uses a PUG-style local menu and counter size classes", () => {
	const play = fs.readFileSync(path.join(root, "play.html"), "utf8")
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	const scene = fs.readFileSync(path.join(root, "piece-scene.js"), "utf8")
	const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
	assert.match(play, /id="activation-popup"/)
	assert.match(client, /function showTargetMenu\(entries, event, titleText\)/)
	assert.match(client, /labelFor\(entry\.action, entry\.arg, view\.action_labels\)/)
	assert.doesNotMatch(client, /activate_both:/)
	assert.match(client, /template\?\.type === "army" \? " lcu"/)
	assert.match(client, /template\?\.type === "corps" \? " scu"/)
	assert.match(play, /<body class="bevel">/)
	assert.match(css, /\.piece\.lcu\s*\{[^}]*--counter-standard, 113px[^}]*--counter-standard, 113px/s)
	assert.match(css, /\.piece\.scu\s*\{[^}]*--counter-small, 90px[^}]*--counter-small, 90px/s)
	assert.match(css, /\.piece\.hq\s*\{[^}]*--counter-small, 90px[^}]*--counter-small, 90px/s)
	assert.match(client, /lcu: 113,[\s\S]*scu: 90,[\s\S]*hq: 90,[\s\S]*standardMarker: 113/)
	assert.match(css, /\.piece\s*\{[^}]*transform: translate\(-50%, -50%\)/s)
	assert.match(client, /const minimumWidth = selectable \? 108 : 58/)
	assert.match(client, /mapSize\(space, selectable\)/)
	assert.match(css, /\.space\.legal\s*\{[^}]*border: 4px solid yellow;[^}]*box-shadow: 0 0 3px black, inset 0 0 3px black;/s)
	assert.match(scene, /type === "army" \? 0 : type === "corps" \? 2/)
	assert.match(scene, /stack\.unitIds\.sort/)
	assert.match(client, /members\.length > 5 \? counterMetrics\.tightStackStep : counterMetrics\.stackStep/)
	assert.match(client, /stackStep: 14/)
	assert.match(client, /tightStackStep: 5/)
	assert.match(client, /focusGap: 8/)
	assert.match(client, /focusPadding: 11/)
	assert.match(css, /\.piece\s*\{[^}]*border: 0;[^}]*border-radius: 6px;[^}]*box-shadow: 1px 1px 4px #000;/s)
	assert.match(css, /\.piece img\s*\{[^}]*object-fit: contain;/s)
	assert.match(client, /frame\.reduced && template\?\.image_back \? template\.image_back : template\?\.image/)
})

test("hand cards use the PUG action menu instead of top action buttons or detail actions", () => {
	const play = fs.readFileSync(path.join(root, "play.html"), "utf8")
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
	assert.match(play, /id="card-popup"/)
	assert.match(client, /function showCardMenu\(event, card\)/)
	assert.match(client, /\["naval_event", "🎴︎ {2}事件"\]/)
	assert.match(client, /\["naval_fleet", "⚓︎ {2}舰队"\]/)
	assert.match(client, /\["card_ops", "🔀︎ {2}行动点"\]/)
	assert.match(client, /\["card_sr", "🚂︎ {2}战略转移"\]/)
	assert.match(client, /\["card_rp", "🏭︎ {2}补员"\]/)
	assert.match(client, /targetIndex\.cards\.has\(id\)/)
	assert.match(css, /\.card-popup li\.disabled/)
	const detail = client.slice(client.indexOf("function showCard(card)"), client.indexOf("function combatStat"))
	assert.doesNotMatch(detail, /card_event|card_ops|card_sr|card_rp|naval_event|naval_fleet/)
})

test("move and attack activations render their printed counters on the map", () => {
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
	assert.match(client, /move: pieceAssetByName\.Move/)
	assert.match(client, /attack: pieceAssetByName\.Attack/)
	assert.match(client, /construct: pieceAssetByName\.Entrench/)
	assert.match(client, /counter\.className = `activation-counter \$\{kind\}/)
	assert.match(client, /const imageName = activationMarkerImages\[kind\]/)
	assert.match(client, /if \(actionIncludes\("resolve_stack", spaceId\)\) return perform\("resolve_stack", spaceId\)/)
	assert.match(client, /focusStack\(EogPieceScene\.mapStackKey\(spaceId\)\)/)
	assert.match(css, /\.activation-counter\s*\{[^}]*--counter-small, 90px[^}]*--counter-small, 90px/s)
	assert.match(css, /\.activation-counter img\s*\{[^}]*object-fit: contain;/s)
	assert.match(css, /\.piece-stack\.expanded \.activation-counter/)
})

test("printed map markers use PUG counter sizes and existing artwork", () => {
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
	assert.match(client, /controlMarkerImages = Object\.freeze/)
	assert.match(client, /trenchMarkerImages = Object\.freeze/)
	assert.match(client, /fortificationMarkerImages = Object\.freeze/)
	for (const name of ["索姆河", "处刑地", "兴登堡防线", "突出部"])
		assert.match(client, new RegExp(`asset: "${name}"`))
	assert.match(css, /\.control,[\s\S]*?\.marker\s*\{[^}]*--counter-standard, 113px[^}]*--counter-standard, 113px/s)
	assert.match(css, /\.track-marker\s*\{/)
	assert.doesNotMatch(client, /marker\.textContent = `工\$\{points\}`/)
	assert.match(client, /faceValue === 1 \? 90 : faceValue === 3 \? -90 : 0/)
	assert.match(client, /pieceAssetByName\[label\]/)
})

test("printed reserve boxes render the server reserve pools as interactive counter stacks", () => {
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
	assert.match(client, /const reserveBoxLayouts = \{/)
	assert.match(client, /element\.dataset\.reserveGroup = frame\.group/)
	assert.match(client, /layoutFocusedReserveStack\(frame, element, members\)/)
	assert.match(client, /EogPieceScene\.buildScene\(view, targetIndex, eog_data\)/)
	assert.match(css, /\.piece-stack\.reserve-stack\s*\{[^}]*z-index: 240/s)
})

test("printed upgrade boxes render real stable counters and off-map placement targets", () => {
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
	assert.deepEqual(Object.keys(data.ui.pools.upgrade.ap.pieces).sort(), [
		"component-091",
		"component-092",
		"component-104",
		"component-105",
	])
	assert.deepEqual(Object.keys(data.ui.pools.upgrade.cp.pieces).sort(), [
		"component-107",
		"component-108",
	])
	assert.match(client, /const upgradeBoxLayouts = eog_data\.ui\?\.pools\?\.upgrade/)
	assert.match(client, /element\.dataset\.upgradePiece = frame\.piece/)
	assert.match(client, /perform\("replacement_to_eliminated"\)/)
	assert.match(css, /\.piece-stack\.upgrade-stack\s*\{[^}]*z-index: 240/s)
})

test("PUG toolbar exposes chat and log plus the EOG utility menus", () => {
	const play = fs.readFileSync(path.join(root, "play.html"), "utf8")
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
	for (const id of ["stack-menu", "info-menu", "supply-menu", "piece-button"])
		assert.match(play, new RegExp(`id="${id}"`))
	assert.doesNotMatch(play, /id="track-button"/)
	assert.equal((play.match(/id="chat_button"/g) || []).length, 0)
	assert.match(client, /byId\("chat_button"\)\.title = "聊天"/)
	assert.match(client, /window\.on_reply = onReply/)
	assert.match(client, /send_query\("supply"\)/)
	assert.match(client, /perform\("propose_rollback", index\)/)
	assert.match(client, /EogActionProtocol\.surfaceFor\(action\) === "top"/)
	assert.doesNotMatch(client, /pending-attack-summary/)
	assert.doesNotMatch(css, /\.pending-attack-summary/)
	assert.doesNotMatch(css, /body\.eog #log_button\s*\{[^}]*display:\s*none/s)
	assert.match(client, /byId\("log_button"\)\.title = "日志"/)
	assert.match(client, /mainMenu,\s*byId\("stack-menu"\),\s*byId\("chat_button"\),\s*byId\("log_button"\)/s)
})

test("mobile map loads the compact WebP without changing the desktop source set", () => {
	const play = fs.readFileSync(path.join(root, "play.html"), "utf8")
	assert.match(play, /<source media="\(max-width: 800px\)" srcset="assets\/map\.webp" type="image\/webp"\s*\/>/)
	assert.match(play, /id="map-image"[^>]*srcset="assets\/map\.webp 4562w, assets\/map\.png 6082w"/)
})

test("game information uses PUG dialogs and printed map pools without mirrored counters", () => {
	const play = fs.readFileSync(path.join(root, "play.html"), "utf8")
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
	for (const id of ["score", "ap_card_dialog", "cp_card_dialog", "ap_discard_dialog", "cp_discard_dialog"])
		assert.match(play, new RegExp(`id="${id}"[^>]*class="dialog`))
	assert.doesNotMatch(play, /overview-window|unit-pools-window|track-window|info-window/)
	assert.match(client, /function renderOverviewInfo\(\)/)
	assert.match(client, /function renderCardInfo\(faction, discardOnly = false\)/)
	assert.match(client, /function locateUnitPools\(faction\)/)
	assert.doesNotMatch(client, /function renderUnitPoolsInfo|function renderTrackInfo|initializeInfoWindows/)
	assert.match(client, /const hand = view\.hands\?\.\[faction\]/)
	assert.match(client, /appendCardCatalogGroup\(catalog, "手牌", Array\.isArray\(hand\) \? hand : Number\(hand \|\| 0\), !Array\.isArray\(hand\)\)/)
	assert.match(client, /const prefixes = \[`reserve:\$\{faction\}:`, `eliminated:\$\{faction\}:`, `upgrade:\$\{faction\}:`\]/)
	assert.doesNotMatch(client, /infoPiece|unit-pool-pieces/)
	assert.doesNotMatch(css, /\.info-piece|\.unit-pool-pieces/)
})

test("faction card information uses the compact PUG catalog and fixed card preview", () => {
	const play = fs.readFileSync(path.join(root, "play.html"), "utf8")
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
	for (const id of ["ap_card_dialog", "cp_card_dialog"])
		assert.match(play, new RegExp(`id="${id}"[^>]*class="dialog card-list-dialog`))
	assert.match(client, /function formatInfoCardLabel\(card\)/)
	assert.match(client, /`\[\$\{card\.ops\}\/\$\{card\.sr\}\]/)
	assert.match(client, /catalog\.className = `info-card-catalog/)
	assert.match(client, /appendCardCatalogGroup\(catalog, "牌库", view\.deck_cards\?\.\[faction\] \|\| \[\]\)/)
	assert.match(client, /内容对当前观察者隐藏/)
	assert.match(css, /\.dialog\s*\{[^}]*width: min\(760px, calc\(100vw - 32px\)\)/s)
	assert.match(css, /#info-card-tooltip\s*\{[^}]*right: 260px;/s)
})

test("action history remains server data but the duplicate track window is removed", () => {
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	const rules = fs.readFileSync(path.join(root, "rules.js"), "utf8")
	const view = fs.readFileSync(path.join(root, "modules", "view.js"), "utf8")
	assert.match(rules, /action_history: \[\]/)
	assert.match(view, /action_history: api\.clone\(state\.action_history\)/)
	assert.doesNotMatch(client, /track-grid|window\.request_snap|goToTrackTurn|renderTrackInfo/)
	assert.doesNotMatch(fs.readFileSync(path.join(root, "play.html"), "utf8"), /track-button|track-window/)
})

test("piece DOM is stable and only dirty stacks are updated", () => {
	const play = fs.readFileSync(path.join(root, "play.html"), "utf8")
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
	assert.match(play, /<script defer src="piece-scene\.js"><\/script>/)
	assert.match(client, /const pieceElements = new Map\(\)/)
	assert.match(client, /const stackElements = new Map\(\)/)
	assert.match(client, /EogPieceScene\.diffScenes\(/)
	assert.match(client, /for \(const key of dirty\) updateStack\(/)
	assert.match(client, /if \(!focused && stackMemberCount\(stack\) > 1\)/)
	assert.match(client, /if \(spaceEntries\.length\) return dispatchTargetEntries\(spaceEntries/)
	assert.match(client, /focusStack\(frame\.stackKey\)/)
	assert.match(client, /if \(ui\.focusedStackKey && stackMemberCount\(nextScene\.stacks\.get\(ui\.focusedStackKey\)\) <= 1\)/)
	assert.doesNotMatch(css, /\.piece-stack:hover \.piece/)
	assert.doesNotMatch(client, /byId\("piece-layer"\)[\s\S]{0,120}replaceChildren\(/)
})

test("combat log references render as plain text without button boxes", () => {
	const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
	const referenceRule = [...css.matchAll(/\.log-ref\s*\{[\s\S]*?\}/g)]
		.map((match) => match[0])
		.find((rule) => /appearance:\s*none/.test(rule)) || ""
	assert.match(referenceRule, /border:\s*0/)
	assert.match(referenceRule, /outline:\s*0/)
	assert.match(referenceRule, /box-shadow:\s*none/)
	assert.match(referenceRule, /appearance:\s*none/)
	assert.doesNotMatch(css, /button\.log-ref\s*\{[^}]*text-decoration-style:\s*dotted/s)
})

test("all eight printed RP markers follow the general track", () => {
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
	for (const name of ["rp_ge", "rp_fr", "rp_it", "rp_east", "rp_br", "rp_a", "rp_ah", "rp_us"])
		assert.match(client, new RegExp(`trackMarkerImages\\.${name}`))
	assert.match(client, /function trackPosition\(track, value, fractional = false\)/)
	assert.match(client, /trackPosition\("general", definition\.value, Boolean\(definition\.rp\)\)/)
	assert.match(client, /rotation: half \? 45 : 0/)
	assert.match(css, /rotate\(var\(--marker-rotation, 0deg\)\)/)
})

test("all general marker artwork except CPauto has an explicit board role", () => {
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	const markerDirectory = path.join(root, "算子单位图标", "游戏通用标记")
	const names = fs.readdirSync(markerDirectory).filter((name) => name.endsWith(".png")).map((name) => path.parse(name).name)
	assert.doesNotMatch(client, /pieceAssetByName\.CPauto|pieceAssetByName\["CPauto"\]/)
	for (const name of names.filter((name) => name !== "CPauto"))
		assert.ok(client.includes(name), `general marker has no client role: ${name}`)
})

test("track layouts use explicit 6082 by 6000 source-coordinate slots", () => {
	const ui = JSON.parse(fs.readFileSync(path.join(root, "data", "source", "ui.json"), "utf8"))
	assert.deepEqual(ui.map, { width: 6082, height: 6000, image: "assets/map.webp", image_2x: "assets/map.png" })
	for (const [track, expected] of [["turn", 15], ["general", 41], ["naval", 19], ["russian_front", 10], ["turkish_front", 10]]) {
		assert.equal(ui.tracks[track].slots.length, expected, `${track} slot count`)
		for (const [x, y] of ui.tracks[track].slots) {
			assert.ok(x >= 0 && x <= ui.map.width, `${track} x coordinate`)
			assert.ok(y >= 0 && y <= ui.map.height, `${track} y coordinate`)
		}
	}
	assert.deepEqual(ui.tracks.naval.slots[0], [855, 650], "naval -9 uses the red branch endpoint")
	assert.deepEqual(ui.tracks.naval.slots[8], [1215, 330], "naval -1 uses the red branch")
	assert.deepEqual(ui.tracks.naval.slots[9], [1485, 256], "naval zero uses the printed red zero slot")
	assert.deepEqual(ui.tracks.naval.slots[10], [1370, 225], "naval +1 starts the black branch")
})

test("control and marker layers reconcile stable elements without whole-layer replacement", () => {
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	assert.match(client, /const controlElements = new Map\(\)/)
	assert.match(client, /const markerElements = new Map\(\)/)
	assert.match(client, /function reconcileImageMarkers\(layer, elements, frames\)/)
	assert.doesNotMatch(client, /byId\("marker-layer"\)[\s\S]{0,100}replaceChildren\(/)
	assert.doesNotMatch(client, /byId\("control-layer"\)[\s\S]{0,100}replaceChildren\(/)
})

test("Belfort units use the full printed fort centre instead of a split colour band", () => {
	const belfort = data.spaces.find((space) => space.id === "belfort")
	assert.deepEqual(
		{ x: belfort.ui.x, y: belfort.ui.y, w: belfort.ui.w, h: belfort.ui.h },
		{ x: 3945, y: 3694, w: 184, h: 218 }
	)
})

test("audited map centres match the printed Strasbourg, Dover, French, and Italian spaces", () => {
	const spaces = new Map(data.spaces.map((space) => [space.id, space.ui]))
	const expected = {
		strasbourg: [4503, 2848, 236, 240],
		dover: [965, 330, 184, 184],
		verdun: [3124, 2414, 236, 240],
		saint_mihiel: [3418, 2514, 184, 184],
		sezanne: [2288, 2760, 184, 184],
		dordives: [1710, 3282, 184, 184],
		neufchateau: [3274, 3164, 236, 240],
		vittel: [3426, 3446, 184, 184],
		vesoul: [3534, 3666, 184, 184],
		marfeuilles: [3970, 2550, 184, 184],
		sarrebourg: [4226, 2622, 184, 184],
		epinal: [3853, 3359, 236, 240],
		langres: [3092, 3601, 184, 232],
		dole: [3308, 3979, 184, 184],
		besancon: [3637, 3939, 184, 184],
		caporetto: [5643, 4564, 204, 202],
		gorizia: [5748, 4847, 216, 220],
		pasubio: [3505, 5185, 184, 184],
		asiago: [4008, 4959, 184, 184],
		vittorio: [4427, 4827, 184, 184],
		pordenone: [4888, 4822, 188, 184],
		brescia: [3275, 5439, 184, 184],
		treviso: [4608, 5128, 180, 180],
		veneto: [4299, 5223, 184, 184]
	}
	for (const [id, geometry] of Object.entries(expected)) {
		const ui = spaces.get(id)
		assert.ok(ui, id)
		assert.deepEqual([ui.x, ui.y, ui.w, ui.h], geometry, id)
	}
})

test("Belgian coastal city layouts match their printed boxes", () => {
	const spaces = new Map(data.spaces.map((space) => [space.id, space.ui]))
	assert.deepEqual(spaces.get("ostend"), { x: 1958, y: 406, w: 184, h: 184 })
	assert.deepEqual(spaces.get("bruges"), { x: 2266, y: 450, w: 184, h: 184 })
	assert.deepEqual(spaces.get("ghent"), { x: 2520, y: 611, w: 184, h: 184 })
	assert.deepEqual(spaces.get("antwerp"), { x: 2795, y: 454, w: 236, h: 240 })
	assert.deepEqual(spaces.get("brussels"), { x: 2768, y: 813, w: 184, h: 184 })
})

test("Ostend uses its printed swamp terrain", () => {
	assert.equal(data.spaces.find((space) => space.id === "ostend").terrain, "swamp")
})

test("non-map placeholder cities are absent and supply sources use printed map spaces", () => {
	const obsolete = [
		"lyon", "marseilles", "frankfurt", "mannheim", "stuttgart", "bremen", "hamburg", "kiel",
		"kassel", "berlin", "munich", "turin", "genoa", "innsbruck", "vienna"
	]
	for (const id of obsolete) assert.equal(data.spaces.some((space) => space.id === id), false, id)
	assert.deepEqual(data.spaces.filter((space) => space.supply).map((space) => space.id).sort(), [
		"carnicola", "chaumont", "essen", "koblenz", "le_havre", "london", "milan", "orleans",
		"paris", "southern_italy", "tyrol"
	])
	const play = fs.readFileSync(path.join(root, "play.html"), "utf8")
	assert.doesNotMatch(play, /id="dashboard"/)
	assert.doesNotMatch(play, /id="offmap-panel"/)
})

test("combat cards use the PUG panel list with a separate active-card panel", () => {
	const play = fs.readFileSync(path.join(root, "play.html"), "utf8")
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
	assert.match(play, /id="cc-list" hidden/)
	assert.match(play, /id="active_card_zone" class="panel" hidden/)
	assert.match(client, /retainedZone\.hidden = retained\.childElementCount === 0/)
	assert.match(css, /#cc-list\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s)
	assert.match(css, /\.card-row:empty::before\s*\{[^}]*content: attr\(data-empty-label\)/s)
	assert.match(css, /\.combat-card\s*\{[^}]*width: var\(--card-width\);[^}]*height: var\(--card-height\);/s)
})

test("Marfeuilles separates Metz from Sarrebourg in the printed map graph", () => {
	const edgeKeys = new Set(data.edges.map((edge) => [edge.a, edge.b].sort().join("|")))
	assert.ok(data.spaces.some((space) => space.id === "marfeuilles" && space.name === "Marfeuilles"))
	assert.ok(edgeKeys.has("marfeuilles|metz"))
	assert.ok(edgeKeys.has("marfeuilles|sarrebourg"))
	assert.equal(edgeKeys.has("metz|sarrebourg"), false)
})

test("audited map graph removes visual-proximity shortcuts and restores printed intermediate spaces", () => {
	const edgeKeys = new Set(data.edges.map((edge) => [edge.a, edge.b].sort().join("|")))
	for (const edge of [
		["bastogne", "hillesheim"], ["bastogne", "florennes"],
		["aachen", "essen"], ["amiens", "paris"], ["sedan", "koblenz"],
		["milan", "verona"], ["verona", "venice"], ["pordenone", "veneto"]
	]) assert.equal(edgeKeys.has(edge.sort().join("|")), false, edge.join(" -> "))
	for (const edge of [
		["bastogne", "arlon"], ["bastogne", "liege"], ["bastogne", "namur"],
		["bastogne", "sedan"],
		["aachen", "liege"], ["essen", "cologne"], ["arlon", "sedan"], ["arlon", "luxembourg"],
		["verdun", "saint_mihiel"], ["saint_mihiel", "toul"],
		["epernay", "sezanne"], ["sezanne", "vitry"],
		["orleans", "dordives"], ["dordives", "sens"],
		["vittel", "vesoul"], ["vesoul", "belfort"]
	]) assert.ok(edgeKeys.has(edge.sort().join("|")), edge.join(" -> "))
})

test("visible printed spaces never share an exact centre", () => {
	const seen = new Map()
	for (const space of data.spaces.filter((candidate) => !candidate.ui?.hidden)) {
		const key = `${space.ui.x},${space.ui.y}`
		assert.equal(seen.has(key), false, `${space.id} duplicates ${seen.get(key)} at ${key}`)
		seen.set(key, space.id)
	}
})

test("Historical units are explicitly placed by the scenario in rules.js", () => {
	assert.equal(data.setup, undefined)
	const rules = fs.readFileSync(path.join(root, "rules.js"), "utf8")
	const scenario = rules.slice(rules.indexOf("function set_up_historical_scenario"), rules.indexOf("function createState"))
	assert.match(scenario, /const setup_piece/)
	assert.match(scenario, /setup_piece\([^\n]+"Lomevillie"/)
	assert.doesNotMatch(scenario, /object\.world|tts_guid|Math\.hypot|data\.setup/)
	assert.doesNotMatch(rules, /data\.setup/)
})

test("rules.js setup is isolated from normal builds and guarded against TTS regeneration", () => {
	const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
	assert.doesNotMatch(packageJson.scripts.build, /import:tts/)
	const seed = fs.readFileSync(path.join(root, "tools", "seed_source_data.mjs"), "utf8")
	assert.match(seed, /Historical setup is authoritative in rules\.js/)
	assert.doesNotMatch(seed, /write\("setup\.json"|force-manual-setup/)
	assert.equal(fs.existsSync(path.join(root, "tools", "freeze_setup_locations.mjs")), false)
	assert.equal(fs.existsSync(path.join(root, "tools", "render_setup_audit.py")), false)
})

test("participant visual preview supplies the RTT globals generated by the common client", () => {
	const preview = fs.readFileSync(path.join(root, "tools", "build_preview.mjs"), "utf8")
	for (const global of ["window.view", "window.params", "window.roles", "window.toggle_zoom", "window.send_action"])
		assert.match(preview, new RegExp(global.replace(".", "\\.")))
	assert.match(preview, /actions\.id = "actions"/)
	assert.match(preview, /prompt\.id = "prompt"/)
})

test("map graph is bidirectional and contains no orphan edge", () => {
	assert.equal(fs.existsSync(path.join(root, "data", "source", "edge_rules.json")), false)
	const spaces = new Map(data.spaces.map((space) => [space.id, space]))
	for (const edge of data.edges) {
		assert.ok(spaces.has(edge.a), edge.a)
		assert.ok(spaces.has(edge.b), edge.b)
		assert.equal(Object.hasOwn(edge, "difficult"), false, `${edge.a} -> ${edge.b} retains difficult`)
		assert.ok(spaces.get(edge.a).connections.includes(edge.b), `${edge.a} -> ${edge.b}`)
		assert.ok(spaces.get(edge.b).connections.includes(edge.a), `${edge.b} -> ${edge.a}`)
	}
	for (const space of data.spaces.filter((candidate) => !candidate.ui?.hidden))
		assert.ok(space.connections.length > 0, `isolated visible space: ${space.id}`)
})

test("mandatory offensive bags are complete and uniquely keyed", () => {
	const all = Object.values(data.mo).flat()
	assert.equal(all.length, 31)
	assert.equal(all.some((mo) => mo.code === "B"), false)
	assert.equal(new Set(all.map((mo) => mo.id)).size, all.length)
	for (const nation of ["fr", "br", "it", "us", "ge", "ah"]) assert.ok(Array.isArray(data.mo[nation]))
})

test("compiled game data excludes TTS saves and object coordinates", () => {
	assert.equal(data.tts, undefined)
	const compiled = fs.readFileSync(path.join(root, "data.js"), "utf8")
	assert.doesNotMatch(compiled, /TS_Save_13|"guid"|"world"/)
})

test("CRT tables match the source workbook dimensions", () => {
	assert.equal(data.crt.corps.columns.length, 9)
	assert.equal(data.crt.corps.rows.length, 6)
	assert.equal(data.crt.army.columns.length, 12)
	assert.equal(data.crt.army.rows.length, 6)
	assert.deepEqual(data.crt.army.rows[5], [2, 2, 2, 3, 4, 4, 5, 5, 6, 6, 6, 6])
})
