"use strict"

/* global eog_data, view, send_action, send_query, send_message, roles, toggle_zoom, localStorage, Blob, URL, EogActionProtocol, EogPieceScene, EogClientUi */

const ui = {
	selectedCard: null,
	focusedStackKey: null,
	mouseFocus: false,
	counterVisibility: 0,
	supplyOverlayFaction: null,
	supplyOverlaySpaces: new Set(),
	windowZ: 20000,
	trackTurn: null
}

let targetIndex = { spaces: new Map(), pieces: new Map(), cards: new Map(), options: new Map() }
let currentPieceScene = null
let renderedFocusKey = null
let unitById = new Map()
const pieceElements = new Map()
const stackElements = new Map()
const activationElements = new Map()
const controlElements = new Map()
const markerElements = new Map()
const cardElements = new Map()
const moElements = new Map()

const MAP_DISPLAY_SCALE = 0.75
const MAP_SOURCE_WIDTH = eog_data.ui?.map?.width || 6082
const MAP_SOURCE_HEIGHT = eog_data.ui?.map?.height || 6000
const MAP_DISPLAY_WIDTH = Math.round(MAP_SOURCE_WIDTH * MAP_DISPLAY_SCALE)
const MAP_DISPLAY_HEIGHT = Math.round(MAP_SOURCE_HEIGHT * MAP_DISPLAY_SCALE)
document.documentElement.style.setProperty("--map-width", `${MAP_DISPLAY_WIDTH}px`)
document.documentElement.style.setProperty("--map-height", `${MAP_DISPLAY_HEIGHT}px`)

const counterMetrics = Object.freeze({
	lcu: 113,
	scu: 90,
	hq: 90,
	smallMarker: 90,
	standardMarker: 113,
	stackStep: 14,
	tightStackStep: 5,
	focusGap: 8,
	focusPadding: 11,
	focusMargin: 75
})

document.documentElement.style.setProperty("--counter-standard", `${counterMetrics.standardMarker}px`)
document.documentElement.style.setProperty("--counter-small", `${counterMetrics.smallMarker}px`)

const byId = (id) => document.getElementById(id)
const spaceById = Object.fromEntries(eog_data.spaces.map((space) => [space.id, space]))
const pieceById = Object.fromEntries(eog_data.pieces.map((piece) => [piece.id, piece]))
const cardById = Object.fromEntries(eog_data.cards.map((card) => [card.id, card]))
const moById = Object.fromEntries(Object.values(eog_data.mo || {}).flat().map((mo) => [mo.id, mo]))
const pieceAssetByName = Object.fromEntries((eog_data.assets?.pieces || []).map((asset) => [asset.name, asset.image]))
const activationMarkerImages = Object.freeze({
	move: pieceAssetByName.Move,
	attack: pieceAssetByName.Attack,
	construct: pieceAssetByName.Entrench
})
const controlMarkerImages = Object.freeze({ ap: pieceAssetByName["AP控制标"], cp: pieceAssetByName["CP控制标"] })
const trenchMarkerImages = Object.freeze({
	ap: Object.freeze({ 1: pieceAssetByName["AP一级战壕"], 2: pieceAssetByName["AP二级战壕"] }),
	cp: Object.freeze({ 1: pieceAssetByName["CP一级战壕"], 2: pieceAssetByName["CP二级战壕"] })
})
const fortificationMarkerImages = Object.freeze({
	ap: Object.freeze({ front: pieceAssetByName["AP掘壕"], back: pieceAssetByName["AP掘壕b"] }),
	cp: Object.freeze({ front: pieceAssetByName["CP掘壕"], back: pieceAssetByName["CP掘壕b"] })
})
const trackMarkerImages = Object.freeze({
	turn: pieceAssetByName.Turn,
	vp: pieceAssetByName.VP,
	war_ap: pieceAssetByName.APWS,
	war_cp: pieceAssetByName.CPWS,
	war_combined: pieceAssetByName.CBWS,
	entry_us: pieceAssetByName["美国参战"],
	entry_armistice: pieceAssetByName["停战协议"],
	naval: pieceAssetByName["U艇"],
	front_russian: pieceAssetByName["俄国战线"],
	front_turkish: pieceAssetByName["土耳其战线"],
	rp_ge: pieceAssetByName.GERP,
	rp_fr: pieceAssetByName.FRRP,
	rp_it: pieceAssetByName.ITRP,
	rp_east: pieceAssetByName.EASTRP,
	rp_br: pieceAssetByName.BRRP,
	rp_a: pieceAssetByName.ARP,
	rp_ah: pieceAssetByName.AHRP,
	rp_us: pieceAssetByName.USRP
})
const terrainLabel = {
	clear: "平地",
	forest: "森林",
	swamp: "沼泽",
	mountain: "山地",
	alpine: "高山",
	fort: "要塞"
}
function roleLabel(role) {
	if (role === "Allied Powers") return "协约国"
	if (role === "Central Powers") return "同盟国"
	return role
}

function factionCode(role) {
	if (role === "ap" || role === "Allied Powers") return "ap"
	if (role === "cp" || role === "Central Powers") return "cp"
	return null
}

function actionValue(name) {
	return view?.actions?.[name]
}

function actionIncludes(name, value) {
	const legal = actionValue(name)
	return Array.isArray(legal) && legal.includes(value)
}

function perform(name, arg) {
	if (arg !== undefined && arg !== null && !["string", "number"].includes(typeof arg)) return
	if (!EogActionProtocol.allows(view?.actions, name, arg)) return
	hideActivationMenu()
	if (arg === undefined || arg === null) send_action(name)
	else send_action(name, arg)
}

function sourceToDisplay(value) {
	return value * MAP_DISPLAY_SCALE
}

function mapPosition(space) {
	return {
		left: `${sourceToDisplay(space.ui.x)}px`,
		top: `${sourceToDisplay(space.ui.y)}px`
	}
}

function mapSize(space, selectable = false) {
	const minimumWidth = selectable ? 108 : 58
	const minimumHeight = selectable ? 96 : 50
	return {
		width: `${Math.max(minimumWidth, sourceToDisplay(space.ui.w) + (selectable ? 28 : 0))}px`,
		height: `${Math.max(minimumHeight, sourceToDisplay(space.ui.h) + (selectable ? 28 : 0))}px`
	}
}

function legalSpaces() {
	return new Set(targetIndex.spaces.keys())
}

function renderSpaces() {
	const layer = byId("space-layer")
	const legal = legalSpaces()
	const warnings = new Set(view.supply_warnings?.spaces || [])
	layer.replaceChildren()
	for (const space of eog_data.spaces) {
		if (space.ui?.hidden) continue
		const button = document.createElement("button")
		const selectable = legal.has(space.id)
		const hints = view.action_hints?.spaces?.[space.id] || []
		const blocked = !selectable && hints.length > 0
		const important = hints.some((entry) => entry.importance === "important")
		const attackTarget = view.pending_attack?.target === space.id
		const supplyOverlay = ui.supplyOverlaySpaces.has(space.id) ? ` supply-overlay-${ui.supplyOverlayFaction}` : ""
		button.className = `space${selectable ? " legal" : ""}${blocked ? important ? " blocked important" : " blocked" : ""}${attackTarget ? " attack-target" : ""}${warnings.has(space.id) ? " supply-warning" : ""}${supplyOverlay}`
		EogClientUi.decorateTarget(button, { legal: selectable, hints })
		Object.assign(button.style, mapPosition(space), mapSize(space, selectable))
		button.title = `${space.name} · ${terrainLabel[space.terrain] || space.terrain}${hints.length ? `\n${hints.map((entry) => entry.label).join("\n")}` : ""}`
		button.dataset.space = space.id
		button.addEventListener("click", (event) => onSpace(space.id, event))
		layer.append(button)
	}
}

function showActionHints(hints, event, titleText) {
	if (!hints?.length) return false
	const menu = byId("activation-popup")
	if (!menu) return false
	const title = document.createElement("strong")
	title.textContent = titleText
	const list = document.createElement("ul")
	list.className = "action-hint-list"
	for (const entry of hints) {
		const item = document.createElement("li")
		item.textContent = entry.label
		item.dataset.code = entry.code
		list.append(item)
	}
	menu.replaceChildren(title, list)
	menu.hidden = false
	const anchor = event?.currentTarget?.getBoundingClientRect?.()
	const x = Number.isFinite(event?.clientX) ? event.clientX : anchor?.left + anchor?.width / 2
	const y = Number.isFinite(event?.clientY) ? event.clientY : anchor?.top + anchor?.height / 2
	positionTransientMenu(menu, x, y, 48)
	return true
}

function hideActivationMenu() {
	const menu = byId("activation-popup")
	if (menu) menu.hidden = true
}

function hideCardMenu() {
	const menu = byId("card-popup")
	if (menu) menu.hidden = true
}

function visibleViewportBounds() {
	const viewport = window.visualViewport
	return {
		left: viewport?.offsetLeft || 0,
		top: viewport?.offsetTop || 0,
		width: viewport?.width || window.innerWidth,
		height: viewport?.height || window.innerHeight
	}
}

function positionTransientMenu(menu, x, y, minimumTop = 5) {
	const viewport = visibleViewportBounds()
	const gap = 6
	const width = Math.min(menu.offsetWidth, viewport.width - gap * 2)
	const height = Math.min(menu.offsetHeight, viewport.height - gap * 2)
	const left = Math.max(viewport.left + gap, Math.min((x || viewport.left) - width / 2, viewport.left + viewport.width - width - gap))
	const top = Math.max(viewport.top + minimumTop, Math.min((y || viewport.top + minimumTop) - 12, viewport.top + viewport.height - height - gap))
	Object.assign(menu.style, { left: `${left}px`, top: `${top}px` })
}

function closeTransientMenus() {
	hideActivationMenu()
	hideCardMenu()
}

function effectiveCard(card) {
	const values = view.card_values?.[card?.id]
	return card && values ? { ...card, ...values } : card
}

function cardMenuItems(card) {
	const definitions = view.state === "naval_choice"
		? [
			["naval_event", "🎴︎  事件"],
			["naval_fleet", "⚓︎  舰队"]
		]
		: view.state === "action_card"
			? [
				["card_event", "🎴︎  事件"],
				["card_ops", "🔀︎  行动点"],
				["card_sr", "🚂︎  战略转移"],
				["card_rp", "🏭︎  补员"]
			]
			: []
	return definitions.map(([action, label]) => {
		const dynamic = view.action_labels?.[action]?.[String(card.id)]
		return {
			action,
			arg: card.id,
			label: dynamic && action === "naval_event" ? `🎴︎  ${dynamic}` : label,
			enabled: actionIncludes(action, card.id)
		}
	})
}

function showCardMenu(event, card) {
	const menu = byId("card-popup")
	const items = cardMenuItems(card)
	if (!menu || !items.length) return false
	EogClientUi.renderActionMenu(menu, {
		title: card.title,
		items,
		onSelect(action, arg) {
			hideCardMenu()
			perform(action, arg)
		}
	})
	menu.hidden = false
	positionTransientMenu(menu, event.clientX, event.clientY)
	event.stopPropagation()
	return true
}

function showTargetMenu(entries, event, titleText) {
	const menu = byId("activation-popup")
	if (!menu || !entries?.length) return false
	const title = document.createElement("strong")
	title.textContent = titleText
	menu.replaceChildren(title)
	for (const entry of entries) {
		const item = document.createElement("button")
		item.type = "button"
		item.textContent = EogActionProtocol.labelFor(entry.action, entry.arg, view.action_labels)
		item.addEventListener("click", () => perform(entry.action, entry.arg))
		menu.append(item)
	}
	menu.hidden = false
	const anchor = event?.currentTarget?.getBoundingClientRect?.()
	const x = Number.isFinite(event?.clientX) ? event.clientX : anchor?.left + anchor?.width / 2
	const y = Number.isFinite(event?.clientY) ? event.clientY : anchor?.top + anchor?.height / 2
	positionTransientMenu(menu, x, y, 48)
	return true
}

function onSpace(space, event) {
	const entries = targetIndex.spaces.get(space) || []
	if (entries.length === 1) return perform(entries[0].action, entries[0].arg)
	if (entries.length > 1) return showTargetMenu(entries, event, spaceById[space]?.name || space)
	const hints = view.action_hints?.spaces?.[space] || []
	if (hints.length) return showActionHints(hints, event, spaceById[space]?.name || space)
	focusStack(EogPieceScene.mapStackKey(space))
}

function renderControls() {
	const layer = byId("control-layer")
	const activeKeys = new Set()
	for (const space of eog_data.spaces) {
		if (space.ui?.hidden) continue
		const faction = view.control?.[space.id]
		if (!faction || faction === space.faction) continue
		const key = `control:${space.id}`
		activeKeys.add(key)
		let marker = controlElements.get(key)
		if (!marker) {
			marker = document.createElement("span")
			marker.append(document.createElement("img"))
			controlElements.set(key, marker)
		}
		marker.className = `control ${faction}`
		const image = marker.querySelector("img")
		const source = `assets/${controlMarkerImages[faction]}`
		if (image.getAttribute("src") !== source) image.src = source
		image.alt = faction === "ap" ? "协约国控制" : "同盟国控制"
		marker.title = `${space.name}：${image.alt}`
		marker.setAttribute("aria-label", marker.title)
		Object.assign(marker.style, mapPosition(space))
		if (marker.parentNode !== layer) layer.append(marker)
	}
	for (const [key, marker] of controlElements)
		if (!activeKeys.has(key)) {
			marker.remove()
			controlElements.delete(key)
		}
}

const rpTrackMarkers = [
	{ id: "ge", label: "GE:RP", image: trackMarkerImages.rp_ge, value: () => view.rp?.cp?.ge || 0 },
	{ id: "fr", label: "FR:RP", image: trackMarkerImages.rp_fr, value: () => view.rp?.ap?.fr || 0 },
	{ id: "it", label: "IT:RP", image: trackMarkerImages.rp_it, value: () => view.rp?.ap?.it || 0 },
	{ id: "east", label: "EAST:RP", image: trackMarkerImages.rp_east, value: () => view.rp?.cp?.east || 0 },
	{ id: "br", label: "BR:RP", image: trackMarkerImages.rp_br, value: () => view.rp?.ap?.br || 0 },
	{
		id: "a",
		label: "A:RP",
		image: trackMarkerImages.rp_a,
		value: () => view.rp?.ap?.a ?? (view.events?.entry_us ? 0 : view.rp?.ap?.us || 0)
	},
	{ id: "ah", label: "AH:RP", image: trackMarkerImages.rp_ah, value: () => view.rp?.cp?.ah || 0 },
	{
		id: "us",
		label: "US:RP",
		image: trackMarkerImages.rp_us,
		value: () => (view.events?.entry_us ? view.rp?.ap?.us || 0 : 0)
	}
]

function trackPosition(track, value, fractional = false) {
	const layout = eog_data.ui?.tracks?.[track]
	if (!layout?.slots?.length) return null
	const numeric = Number(value) || 0
	const clamped = Math.max(layout.min, Math.min(layout.max, numeric))
	const slotValue = fractional ? Math.floor(clamped + 1e-9) : Math.round(clamped)
	const slot = layout.slots[slotValue - layout.min]
	if (!slot) return null
	return {
		x: sourceToDisplay(slot[0]),
		y: sourceToDisplay(slot[1]),
		slot: slotValue,
		value: clamped
	}
}

function reconcileImageMarkers(layer, elements, frames) {
	const activeKeys = new Set()
	for (const frame of frames) {
		if (!frame.image || !Number.isFinite(frame.x) || !Number.isFinite(frame.y)) continue
		activeKeys.add(frame.key)
		let marker = elements.get(frame.key)
		if (!marker) {
			marker = document.createElement("span")
			marker.append(document.createElement("img"))
			elements.set(frame.key, marker)
		}
		marker.className = frame.className || "marker image-marker"
		marker.style.left = `${frame.x}px`
		marker.style.top = `${frame.y}px`
		marker.style.zIndex = String(frame.zIndex || 160)
		marker.style.setProperty("--marker-rotation", `${frame.rotation || 0}deg`)
		marker.title = frame.title || frame.label
		marker.setAttribute("aria-label", marker.title)
		marker.dataset.value = frame.value == null ? "" : String(frame.value)
		const image = marker.querySelector("img")
		const source = `assets/${frame.image}`
		if (image.getAttribute("src") !== source) image.src = source
		image.alt = frame.label || marker.title
		if (marker.parentNode !== layer) layer.append(marker)
	}
	for (const [key, marker] of elements)
		if (!activeKeys.has(key)) {
			marker.remove()
			elements.delete(key)
		}
}

function generalTrackFrames() {
	const definitions = [
		{ id: "vp", label: "VP", image: trackMarkerImages.vp, value: view.vp || 0 },
		{ id: "war-ap", label: "AP战争状态", image: trackMarkerImages.war_ap, value: view.war_status?.ap || 0 },
		{ id: "war-cp", label: "CP战争状态", image: trackMarkerImages.war_cp, value: view.war_status?.cp || 0 },
		{
			id: "war-combined",
			label: "综合战争状态",
			image: trackMarkerImages.war_combined,
			value: view.war_status?.combined || 0
		},
		{ id: "entry-us", label: "美国参战", image: trackMarkerImages.entry_us, value: view.entry_tracks?.us || 0 },
		{
			id: "entry-armistice",
			label: "停战协议",
			image: trackMarkerImages.entry_armistice,
			value: view.entry_tracks?.armistice || 0
		},
		...rpTrackMarkers.map((definition) => ({ ...definition, value: definition.value(), rp: true }))
	]
	const entries = definitions
		.map((definition) => ({
			...definition,
			position: trackPosition("general", definition.value, Boolean(definition.rp))
		}))
		.filter((entry) => entry.position)
	const stacks = new Map()
	for (const entry of entries) {
		const peers = stacks.get(entry.position.slot) || []
		peers.push(entry)
		stacks.set(entry.position.slot, peers)
	}
	return entries.map((entry) => {
		const peers = stacks.get(entry.position.slot)
		const index = peers.indexOf(entry)
		const offset = index - (peers.length - 1) / 2
		const step = peers.length > 5 ? counterMetrics.tightStackStep : counterMetrics.stackStep
		const half = entry.rp && Math.abs(entry.position.value - entry.position.slot) > 1e-9
		return {
			key: `track:general:${entry.id}`,
			className: `marker image-marker track-marker${entry.rp ? " rp-track-marker" : ""}`,
			label: entry.label,
			title: `${entry.label}：${entry.position.value}`,
			image: entry.image,
			value: entry.position.value,
			x: entry.position.x + offset * step,
			y: entry.position.y - offset * step,
			rotation: half ? 45 : 0,
			zIndex: 260 + index
		}
	})
}

function singleTrackFrame(key, track, value, image, label) {
	const position = trackPosition(track, value)
	if (!position) return null
	return {
		key: `track:${key}`,
		className: "marker image-marker track-marker",
		label,
		title: `${label}：${position.value}`,
		image,
		value: position.value,
		x: position.x,
		y: position.y,
		zIndex: 250
	}
}

function bottomStackMarkerPosition(spaceId, depth = 1) {
	const space = spaceById[spaceId]
	if (!space) return null
	const hasUnits = (view.units || []).some((unit) => unit.location === spaceId)
	const offset = hasUnits ? Math.max(1, depth) * counterMetrics.stackStep : 0
	return {
		x: sourceToDisplay(space.ui.x) - offset,
		y: sourceToDisplay(space.ui.y) + offset
	}
}

function fortificationFrame(spaceId, points) {
	const space = spaceById[spaceId]
	if (!space || space.ui?.hidden) return null
	const position = bottomStackMarkerPosition(spaceId, 1)
	const value = Math.max(1, Math.min(6, Number(points) || 1))
	const faction = view.control?.[spaceId] || space.faction || view.active
	const face = value <= 3 ? "front" : "back"
	const faceValue = value <= 3 ? value : value - 3
	const rotation = faceValue === 1 ? 90 : faceValue === 3 ? -90 : 0
	return {
		key: `fortification:${spaceId}`,
		className: "marker image-marker fortification-marker",
		label: `${faction === "ap" ? "协约国" : "同盟国"}防御工事${value}`,
		title: `${space.name}：${faction === "ap" ? "协约国" : "同盟国"}防御工事 ${value}`,
		image: fortificationMarkerImages[faction]?.[face],
		value,
		x: position.x,
		y: position.y,
		rotation,
		zIndex: 150
	}
}

function renderMarkers() {
	const layer = byId("marker-layer")
	const frames = []
	for (const [spaceId, level] of Object.entries(view.trenches || {})) {
		const space = spaceById[spaceId]
		if (!space || space.ui?.hidden) continue
		const faction = view.control?.[spaceId] || space.faction || view.active
		const value = Math.min(2, Number(level) || 1)
		const depth = (view.fortifications?.[spaceId] || 0) > 0 ? 2 : 1
		const position = bottomStackMarkerPosition(spaceId, depth)
		frames.push({
			key: `trench:${spaceId}`,
			className: "marker image-marker trench-marker",
			label: `${faction === "ap" ? "协约国" : "同盟国"}${value}级战壕`,
			title: `${space.name}：${faction === "ap" ? "协约国" : "同盟国"}${value}级战壕`,
			image: trenchMarkerImages[faction]?.[value],
			value,
			x: position.x,
			y: position.y,
			zIndex: 149
		})
	}
	for (const [spaceId, points] of Object.entries(view.fortifications || {})) {
		const frame = fortificationFrame(spaceId, points)
		if (frame) frames.push(frame)
	}
	const destroyed = new Set(view.destroyed_forts || [])
	const fortStates = new Set([...(view.besieged || []), ...destroyed])
	for (const spaceId of fortStates) {
		const space = spaceById[spaceId]
		if (!space || space.ui?.hidden) continue
		const isDestroyed = destroyed.has(spaceId)
		const label = isDestroyed ? "摧毁" : "围攻"
		frames.push({
			key: `fort-state:${spaceId}`,
			className: "marker image-marker fort-state-marker",
			label,
			title: `${space.name}：要塞${label}`,
			image: pieceAssetByName[label],
			x: sourceToDisplay(space.ui.x),
			y: sourceToDisplay(space.ui.y),
			zIndex: 145
		})
	}
	const special = [
		...(view.markers?.somme ? [{ ...view.markers.somme, label: "索姆河", asset: "索姆河" }] : []),
		...(view.markers?.killing_ground
			? [{ ...view.markers.killing_ground, label: `处刑地 ${view.markers.killing_ground.cost}RP`, asset: "处刑地" }]
			: []),
		...(view.markers?.hindenburg || []).map((space) => ({ space, label: "兴登堡", asset: "兴登堡防线" })),
		...(view.markers?.salients || []).map((entry) => ({ ...entry, label: "突出部", asset: "突出部" }))
	]
	for (const entry of special) {
		const space = spaceById[entry.space]
		if (!space || space.ui?.hidden) continue
		frames.push({
			key: `event:${entry.asset}:${entry.space}`,
			className: "marker image-marker event-marker",
			label: entry.label,
			title: `${space.name}：${entry.label}`,
			image: pieceAssetByName[entry.asset],
			x: sourceToDisplay(space.ui.x) - counterMetrics.standardMarker * 0.45,
			y: sourceToDisplay(space.ui.y) + counterMetrics.standardMarker * 0.4,
			zIndex: 170
		})
	}
	frames.push(...generalTrackFrames())
	frames.push(
		singleTrackFrame("turn", "turn", view.turn || 1, trackMarkerImages.turn, "回合"),
		singleTrackFrame("naval", "naval", view.naval?.track || 0, trackMarkerImages.naval, "U艇"),
		singleTrackFrame(
			"front-russian",
			"russian_front",
			view.fronts?.russian || 0,
			trackMarkerImages.front_russian,
			"俄国战线"
		),
		view.fronts_active?.turkish
			? singleTrackFrame(
					"front-turkish",
					"turkish_front",
					view.fronts?.turkish || 0,
					trackMarkerImages.front_turkish,
					"土耳其战线"
				)
			: null
	)
	reconcileImageMarkers(layer, markerElements, frames.filter(Boolean))
}

const reserveBoxLayouts = {
	ap: {
		label: "协约国预备区",
		groups: ["fr", "fr_foreign", "br", "it", "be", "us"],
		x: [140, 320, 500, 680, 860, 1030],
		fullY: 3560,
		reducedY: 3730
	},
	cp: {
		label: "同盟国预备区",
		groups: ["ge", "ge_wurttemberg", "ge_prussia", "ge_bavaria", "ge_saxony", "ah"],
		x: [5050, 5230, 5410, 5590, 5770, 5950],
		fullY: 1190,
		reducedY: 1380
	}
}

const eliminatedBoxLayouts = eog_data.ui?.pools?.eliminated || {
	ap: { label: "协约国消灭区", nations: ["fr", "br", "it", "us", "be"], x: [5100, 5280, 5460, 5640, 5820], rows: { "army:full": 3470, "army:reduced": 3615, "corps:full": 3760, "corps:reduced": 3905, "hq:full": 4050, "hq:reduced": 4050 } },
	cp: { label: "同盟国消灭区", nations: ["ge", "ah"], x: [5310, 5700], rows: { "army:full": 2580, "army:reduced": 2730, "corps:full": 2880, "corps:reduced": 3030, "hq:full": 3160, "hq:reduced": 3160 } }
}
const upgradeBoxLayouts = eog_data.ui?.pools?.upgrade || {
	ap: { label: "协约国升级区", pieces: { "component-105": [140, 2580], "component-104": [280, 2580], "component-091": [430, 2580], "component-092": [570, 2580] } },
	cp: { label: "同盟国升级区", pieces: { "component-108": [5500, 1900], "component-107": [5840, 1900] } }
}

let replacementReserveTarget = null
let replacementEliminatedTarget = null

function updateReplacementReserveTarget() {
	const enabled = view.actions?.replacement_to_reserve === 1
	if (!enabled) {
		replacementReserveTarget?.remove()
		replacementReserveTarget = null
		return
	}
	const faction = view.pending_event?.faction || view.active
	const layout = reserveBoxLayouts[faction]
	if (!layout) return
	if (!replacementReserveTarget) {
		replacementReserveTarget = document.createElement("button")
		replacementReserveTarget.type = "button"
		replacementReserveTarget.className = "pool-target replacement-reserve-target"
		replacementReserveTarget.addEventListener("click", (event) => {
			event.stopPropagation()
			perform("replacement_to_reserve")
		})
		byId("piece-layer").append(replacementReserveTarget)
	}
	const minimumX = Math.min(...layout.x) - 85
	const maximumX = Math.max(...layout.x) + 85
	const minimumY = Math.min(layout.fullY, layout.reducedY) - 80
	const maximumY = Math.max(layout.fullY, layout.reducedY) + 80
	replacementReserveTarget.style.left = `${sourceToDisplay(minimumX)}px`
	replacementReserveTarget.style.top = `${sourceToDisplay(minimumY)}px`
	replacementReserveTarget.style.width = `${sourceToDisplay(maximumX - minimumX)}px`
	replacementReserveTarget.style.height = `${sourceToDisplay(maximumY - minimumY)}px`
	replacementReserveTarget.title = view.pending_event?.kind === "veteran_upgrade"
		? `${layout.label}：替换后放入预备区`
		: `${layout.label}：重建SCU到预备区`
	replacementReserveTarget.setAttribute("aria-label", replacementReserveTarget.title)
}

function updateReplacementEliminatedTarget() {
	const enabled = view.actions?.replacement_to_eliminated === 1
	if (!enabled) {
		replacementEliminatedTarget?.remove()
		replacementEliminatedTarget = null
		return
	}
	const faction = view.pending_event?.faction || view.active
	const layout = eliminatedBoxLayouts[faction]
	if (!layout) return
	if (!replacementEliminatedTarget) {
		replacementEliminatedTarget = document.createElement("button")
		replacementEliminatedTarget.type = "button"
		replacementEliminatedTarget.className = "pool-target replacement-eliminated-target"
		replacementEliminatedTarget.addEventListener("click", (event) => {
			event.stopPropagation()
			perform("replacement_to_eliminated")
		})
		byId("piece-layer").append(replacementEliminatedTarget)
	}
	const rows = Object.values(layout.rows)
	const minimumX = Math.min(...layout.x) - 85
	const maximumX = Math.max(...layout.x) + 85
	const minimumY = Math.min(...rows) - 80
	const maximumY = Math.max(...rows) + 80
	replacementEliminatedTarget.style.left = `${sourceToDisplay(minimumX)}px`
	replacementEliminatedTarget.style.top = `${sourceToDisplay(minimumY)}px`
	replacementEliminatedTarget.style.width = `${sourceToDisplay(maximumX - minimumX)}px`
	replacementEliminatedTarget.style.height = `${sourceToDisplay(maximumY - minimumY)}px`
	replacementEliminatedTarget.title = `${layout.label}：替换后留在消灭区`
	replacementEliminatedTarget.setAttribute("aria-label", replacementEliminatedTarget.title)
}

function collectUnitIndex() {
	const pools = [
		...(view.units || []),
		...(view.reserves?.ap || []),
		...(view.reserves?.cp || []),
		...(view.upgrade_pool?.ap || []),
		...(view.upgrade_pool?.cp || []),
		...(view.eliminated?.ap || []),
		...(view.eliminated?.cp || []),
		...(view.permanently_removed_units || [])
	]
	unitById = new Map(pools.filter((unit) => unit && typeof unit === "object" && unit.id != null).map((unit) => [unit.id, unit]))
}

function ensurePieceElement(id) {
	let button = pieceElements.get(id)
	if (button) return button
	button = document.createElement("button")
	button.type = "button"
	button.dataset.unit = id
	const image = document.createElement("img")
	image.className = "piece-face"
	const fallback = document.createElement("span")
	fallback.className = "piece-fallback"
	button.append(image, fallback)
	button.addEventListener("click", (event) => {
		event.stopPropagation()
		onUnit(id, event)
	})
	pieceElements.set(id, button)
	return button
}

function updatePieceElement(id, frame, contextLabel) {
	const unit = unitById.get(id)
	const template = pieceById[frame.piece]
	const button = ensurePieceElement(id)
	const sizeClass = template?.type === "army" ? " lcu" : template?.type === "corps" ? " scu" : template?.type === "hq" ? " hq" : ""
	const actionKinds = frame.actionKinds || []
	const advanceCandidate = actionKinds.includes("select_advance_unit")
	const retreatCandidate = actionKinds.some((action) =>
		["select_retreat_unit", "select_retreat_one", "select_retreat_two"].includes(action),
	)
	const advanceSelected = frame.selected && (view.state === "advance_select" || view.state === "advance_destination")
	const retreatSelected = frame.selected && view.state === "retreat"
	const hints = view.action_hints?.pieces?.[id] || []
	const supplyClass = frame.zone === "map" ? ` supply-${frame.supplyStatus || "full"}` : ""
	EogClientUi.patchStableElement(button, {
		className: `piece${sizeClass}${frame.reduced ? " reduced" : ""}${supplyClass}${hints.length && !frame.legal ? " blocked" : ""}${frame.legal ? " legal" : ""}${frame.selected ? " selected" : ""}${advanceCandidate ? " advance-candidate" : ""}${retreatCandidate ? " retreat-candidate" : ""}${advanceSelected ? " advance-selected" : ""}${retreatSelected ? " retreat-selected" : ""}${frame.staged ? " staged" : ""}`,
		dataset: { reduced: frame.reduced ? "1" : "0", supply: frame.zone === "map" ? frame.supplyStatus || "full" : "" }
	})
	const image = button.querySelector(".piece-face")
	const fallback = button.querySelector(".piece-fallback")
	const face = frame.reduced && template?.image_back ? template.image_back : template?.image
	if (face) {
		const source = `assets/${face}`
		EogClientUi.patchStableElement(image, { src: source })
		image.alt = template?.name || id
		image.hidden = false
		fallback.hidden = true
	} else {
		image.hidden = true
		fallback.hidden = false
		fallback.textContent = unit?.nation?.toUpperCase() || "?"
	}
	const values =
		template?.type === "hq"
			? `进攻 +${template.attack_drm || 0} / 防御 +${template.defense_drm || 0} / 移动 ${template.movement}`
			: `${frame.reduced ? template?.reduced_combat : template?.combat}-${frame.reduced ? template?.reduced_loss : template?.loss}-${frame.reduced ? template?.reduced_movement : template?.movement}`
	const supplyLabels = {
		full: "补给充足",
		limited: "有限补给：激活费用及战斗能力受限",
		fort_limited: "孤立要塞有限补给：离开后必须停止或恢复补给",
		none: "完全断补：不能补员，移动、进攻和战略调动受限"
	}
	const supplyEffects = (frame.supplyEffects || []).map((entry) => `补给影响：${entry.label}`)
	const supplyText = frame.zone === "map" ? ` · ${supplyLabels[frame.supplyStatus] || supplyLabels.full}` : ""
	button.title = `${template?.name || id} · ${contextLabel} · ${values}${frame.reduced ? "（减员）" : ""}${supplyText}${frame.staged ? " · 增援待确认" : ""}${supplyEffects.length ? `\n${supplyEffects.join("\n")}` : ""}${hints.length ? `\n${hints.map((entry) => entry.label).join("\n")}` : ""}`
	button.setAttribute("aria-label", button.title)
	return button
}

function ensureStackElement(key) {
	let stack = stackElements.get(key)
	if (stack) return stack
	stack = document.createElement("div")
	stack.dataset.stackKey = key
	stack.addEventListener("pointerenter", () => {
		if (ui.mouseFocus && stack.dataset.stacked === "true") focusStack(key)
	})
	stackElements.set(key, stack)
	return stack
}

function ensureActivationElement(spaceId, kind) {
	const key = `${spaceId}:${kind}`
	let counter = activationElements.get(key)
	if (counter) return counter
	counter = document.createElement("button")
	counter.type = "button"
	counter.dataset.space = spaceId
	counter.dataset.activation = kind
	const image = document.createElement("img")
	counter.append(image)
	counter.addEventListener("click", (event) => {
		event.stopPropagation()
		if (actionIncludes("resolve_stack", spaceId)) return perform("resolve_stack", spaceId)
		focusStack(EogPieceScene.mapStackKey(spaceId))
	})
	activationElements.set(key, counter)
	return counter
}

function updateActivationElement(spaceId, kind) {
	const counter = ensureActivationElement(spaceId, kind)
	const space = spaceById[spaceId]
	const legal = actionIncludes("resolve_stack", spaceId)
	counter.className = `activation-counter ${kind}${legal ? " legal" : ""}`
	const label = kind === "move" ? "移动激活" : kind === "attack" ? "进攻激活" : "修筑激活"
	counter.title = `${space.name}：${label}（点击选择地块或展开堆叠）`
	counter.setAttribute("aria-label", counter.title)
	const image = counter.querySelector("img")
	const imageName = activationMarkerImages[kind]
	const source = `assets/${imageName}`
	if (image.getAttribute("src") !== source) image.src = source
	image.alt = label
	return counter
}

function memberSize(element) {
	if (element.classList.contains("lcu")) return counterMetrics.lcu
	if (element.classList.contains("hq")) return counterMetrics.hq
	if (element.classList.contains("scu")) return counterMetrics.scu
	return counterMetrics.smallMarker
}

function setFocusBounds(stack, members) {
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const element of members) {
		const size = memberSize(element)
		const x = Number.parseFloat(element.style.left) || 0
		const y = Number.parseFloat(element.style.top) || 0
		minX = Math.min(minX, x - size / 2)
		minY = Math.min(minY, y - size / 2)
		maxX = Math.max(maxX, x + size / 2)
		maxY = Math.max(maxY, y + size / 2)
	}
	const padding = counterMetrics.focusPadding
	stack.style.setProperty("--focus-left", `${minX - padding}px`)
	stack.style.setProperty("--focus-top", `${minY - padding}px`)
	stack.style.setProperty("--focus-width", `${maxX - minX + padding * 2}px`)
	stack.style.setProperty("--focus-height", `${maxY - minY + padding * 2}px`)
}

function layoutCollapsedStack(members) {
	const step = members.length > 5 ? counterMetrics.tightStackStep : counterMetrics.stackStep
	const depth = members.length > 5 ? 1 : 3
	for (const [index, element] of members.entries()) {
		element.style.left = `${index * step}px`
		element.style.top = `${-index * step}px`
		element.style.zIndex = String(1 + index * depth)
	}
}

function layoutFocusedMapStack(frame, stack, members) {
	const baseY = sourceToDisplay(spaceById[frame.spaceId].ui.y)
	const totalHeight =
		members.reduce((sum, element) => sum + memberSize(element), 0) +
		Math.max(0, members.length - 1) * counterMetrics.focusGap
	const direction = baseY - totalHeight < counterMetrics.focusMargin ? 1 : -1
	let cursor = 0
	for (const [index, element] of members.entries()) {
		if (index)
			cursor += direction *
				((memberSize(members[index - 1]) + memberSize(element)) / 2 + counterMetrics.focusGap)
		element.style.left = "0px"
		element.style.top = `${cursor}px`
		element.style.zIndex = String(10 + index)
	}
	setFocusBounds(stack, members)
}

function layoutFocusedReserveStack(frame, stack, members) {
	const layout = frame.zone === "eliminated"
		? eliminatedBoxLayouts[frame.faction]
		: frame.zone === "upgrade"
			? upgradeBoxLayouts[frame.faction]
			: reserveBoxLayouts[frame.faction]
	const groups = frame.zone === "eliminated"
		? layout.nations
		: frame.zone === "upgrade"
			? Object.keys(layout.pieces)
			: layout.groups
	const groupIndex = groups.indexOf(frame.zone === "eliminated" ? frame.nation : frame.zone === "upgrade" ? frame.piece : frame.group)
	const direction = groupIndex < groups.length / 2 ? 1 : -1
	let cursor = 0
	for (const [index, element] of members.entries()) {
		if (index)
			cursor += direction *
				((memberSize(members[index - 1]) + memberSize(element)) / 2 + counterMetrics.focusGap)
		element.style.left = `${cursor}px`
		element.style.top = "0px"
		element.style.zIndex = String(10 + index)
	}
	setFocusBounds(stack, members)
}

function stackMemberCount(frame) {
	return frame ? frame.unitIds.length + frame.counterKinds.length : 0
}

function updateStack(key, frame) {
	const stack = stackElements.get(key)
	if (!frame) {
		if (stack?.parentNode) stack.remove()
		return
	}
	const element = ensureStackElement(key)
	const focused = ui.focusedStackKey === key && stackMemberCount(frame) > 1
	element.className = `piece-stack${frame.zone === "reserve" ? " reserve-stack" : ""}${frame.zone === "eliminated" ? " eliminated-stack" : ""}${frame.zone === "upgrade" ? " upgrade-stack" : ""}${frame.legal ? " space-legal" : ""}${frame.advanceCandidate ? " advance-candidate-stack" : ""}${frame.retreatCandidate ? " retreat-candidate-stack" : ""}${focused ? " expanded" : ""}`
	element.dataset.count = String(frame.unitIds.length)
	element.dataset.stacked = String(stackMemberCount(frame) > 1)
	let contextLabel
	if (frame.zone === "map") {
		const space = spaceById[frame.spaceId]
		Object.assign(element.style, mapPosition(space))
		contextLabel = space.name
	} else if (frame.zone === "reserve") {
		const layout = reserveBoxLayouts[frame.faction]
		const groupIndex = layout.groups.indexOf(frame.group)
		element.dataset.faction = frame.faction
		element.dataset.reserveGroup = frame.group
		element.dataset.reserveFace = frame.face
		element.style.left = `${sourceToDisplay(layout.x[groupIndex])}px`
		element.style.top = `${sourceToDisplay(frame.face === "full" ? layout.fullY : layout.reducedY)}px`
		contextLabel = layout.label
	} else if (frame.zone === "eliminated") {
		const layout = eliminatedBoxLayouts[frame.faction]
		const nationIndex = Math.max(0, layout.nations.indexOf(frame.nation))
		const row = layout.rows[`${frame.type}:${frame.face}`] ?? layout.rows[`corps:${frame.face}`]
		element.dataset.faction = frame.faction
		element.dataset.eliminatedNation = frame.nation
		element.dataset.eliminatedType = frame.type
		element.dataset.eliminatedFace = frame.face
		element.style.left = `${sourceToDisplay(layout.x[nationIndex])}px`
		element.style.top = `${sourceToDisplay(row)}px`
		contextLabel = layout.label
	} else {
		const layout = upgradeBoxLayouts[frame.faction]
		const position = layout.pieces[frame.piece]
		element.dataset.faction = frame.faction
		element.dataset.upgradePiece = frame.piece
		element.style.left = `${sourceToDisplay(position[0])}px`
		element.style.top = `${sourceToDisplay(position[1])}px`
		contextLabel = layout.label
	}
	const members = [
		...frame.unitIds.map((id) => updatePieceElement(id, currentPieceScene.units.get(id), contextLabel)),
		...frame.counterKinds.map((kind) => updateActivationElement(frame.spaceId, kind))
	]
	const desired = new Set(members)
	for (const child of [...element.children]) if (!desired.has(child)) child.remove()
	for (const member of members) element.append(member)
	if (focused) {
		if (frame.zone === "map") layoutFocusedMapStack(frame, element, members)
		else layoutFocusedReserveStack(frame, element, members)
	} else layoutCollapsedStack(members)
	const layer = byId("piece-layer")
	if (element.parentNode !== layer) layer.append(element)
}

function updatePieceScene() {
	collectUnitIndex()
	const nextScene = EogPieceScene.buildScene(view, targetIndex, eog_data)
	if (ui.focusedStackKey && stackMemberCount(nextScene.stacks.get(ui.focusedStackKey)) <= 1)
		ui.focusedStackKey = null
	const dirty = EogPieceScene.diffScenes(currentPieceScene, nextScene, renderedFocusKey, ui.focusedStackKey)
	const beforeMove = new Map()
	for (const key of dirty)
		for (const id of currentPieceScene?.stacks.get(key)?.unitIds || []) {
			const element = pieceElements.get(id)
			if (element?.isConnected)
				beforeMove.set(element, { parent: element.parentNode, rect: element.getBoundingClientRect() })
		}
	currentPieceScene = nextScene
	for (const key of dirty) updateStack(key, nextScene.stacks.get(key))
	for (const [element, before] of beforeMove) {
		if (!element.isConnected || element.parentNode === before.parent || typeof element.animate !== "function") continue
		const after = element.getBoundingClientRect()
		const x = before.rect.left - after.left
		const y = before.rect.top - after.top
		if (Math.abs(x) < 1 && Math.abs(y) < 1) continue
		element.animate([{ translate: `${x}px ${y}px` }, { translate: "0px 0px" }], {
			duration: 220,
			easing: "ease-out"
		})
	}
	renderedFocusKey = ui.focusedStackKey
	updateReplacementReserveTarget()
	updateReplacementEliminatedTarget()
}

function focusStack(key) {
	if (!key || stackMemberCount(currentPieceScene?.stacks.get(key)) <= 1) return false
	ui.focusedStackKey = key
	updatePieceScene()
	return true
}

function blurStack() {
	if (!ui.focusedStackKey) return
	ui.focusedStackKey = null
	updatePieceScene()
}

function dispatchTargetEntries(entries, event, title) {
	return EogClientUi.dispatchTarget(entries, perform, (items) => showTargetMenu(items, event, title))
}

function onUnit(id, event) {
	const unit = unitById.get(id)
	const frame = currentPieceScene?.units.get(id)
	if (!unit || !frame) return
	const stack = currentPieceScene.stacks.get(frame.stackKey)
	const spaceEntries = unit.location ? targetIndex.spaces.get(unit.location) || [] : []
	const pieceEntries = targetIndex.pieces.get(id) || []
	const focused = ui.focusedStackKey === frame.stackKey
	if (!focused && stackMemberCount(stack) > 1) {
		if (spaceEntries.length) return dispatchTargetEntries(spaceEntries, event, spaceById[unit.location]?.name || unit.location)
		focusStack(frame.stackKey)
		return
	}
	if (dispatchTargetEntries([...pieceEntries, ...spaceEntries], event, eventUnitLabel(id))) return
	showActionHints(view.action_hints?.pieces?.[id] || [], event, eventUnitLabel(id))
}

function button(label, action, arg, className = "") {
	const element = document.createElement("button")
	element.textContent = label
	element.className = `action ${className}`.trim()
	element.addEventListener("click", () => perform(action, arg))
	return element
}

function eventUnitLabel(id) {
	const pools = [
		...(view.units || []),
		...(view.reserves?.ap || []),
		...(view.reserves?.cp || []),
		...(view.upgrade_pool?.ap || []),
		...(view.upgrade_pool?.cp || []),
		...(view.eliminated?.ap || []),
		...(view.eliminated?.cp || [])
	]
	const unit = pools.find((candidate) => candidate.id === id)
	const piece = unit && pieceById[unit.piece]
	return piece?.name || id
}

function renderActions() {
	const container = byId("actions")
	container.replaceChildren()
	const actions = view.actions || {}
	for (const [action, value] of Object.entries(actions))
		if (value === 1 && EogActionProtocol.surfaceFor(action) === "top")
			container.append(
				button(
					EogActionProtocol.labelFor(action, undefined, view.action_labels),
					action,
					undefined,
					["done", "stop", "finish", "event_units_confirm", "confirm_mo", "confirm_mo_penalty_loss"].includes(action) ? "primary" : ""
				)
			)

	for (const entries of targetIndex.options.values())
		for (const { action, arg } of entries) {
			const moSkip = ["select_attack_mo", "select_defense_mo"].includes(action) && String(arg).endsWith(":none")
			if (EogActionProtocol.surfaceFor(action) !== "top" && !moSkip) continue
			let label = EogActionProtocol.labelFor(action, arg, view.action_labels)
			if (moSkip) label = `${label}（继续）`
			if (action === "choose_flank_final") label = `最终战斗修正来源：${arg}`
			container.append(button(label, action, arg, moSkip ? "" : "primary"))
		}

	for (const entries of targetIndex.cards.values())
		for (const { action, arg } of entries) {
			if (EogActionProtocol.surfaceFor(action) !== "top") continue
			let label = EogActionProtocol.labelFor(action, arg, view.action_labels)
			if (action === "retain_combat_card") label = `保留：${cardById[arg]?.title || arg}`
			if (action === "discard_combat_card_for_draw") label = `弃置并抽牌：${cardById[arg]?.title || arg}`
			container.append(button(label, action, arg, action === "retain_combat_card" ? "primary" : ""))
		}

	if (!container.children.length && !Object.keys(actions).length) container.textContent = "等待对手行动。"
}

function renderHand() {
	const hand = byId("hand")
	hand.replaceChildren()
	const faction = Array.isArray(view.hands?.ap) ? "ap" : Array.isArray(view.hands?.cp) ? "cp" : null
	const opening = view.opening_cards || []
	const own = opening.length ? opening : faction ? view.hands[faction] : []
	byId("hand-title").textContent = opening.length ? "开局选牌" : "手牌"
	for (const id of own) {
		const card = effectiveCard(cardById[id])
		const element = gameCardElement(id)
		element.className = `card-thumb ${faction || card.faction}`
		element.classList.toggle("legal", targetIndex.cards.has(id))
		element.title = `${card.title} · ${card.ops} OPS / ${card.sr} SR`
		hand.append(element)
	}
}

function currentMoEntry(id) {
	return (view.mo?.own || []).find((entry) => entry.id === id) ||
		(view.mo?.revealed || []).find((entry) => entry.id === id) ||
		(view.mo?.active_effects || []).find((entry) => entry.id === id) ||
		(view.mo?.history || []).map((entry) => entry.mo).find((entry) => entry?.id === id) ||
		moById[id] || null
}

function ensureMoElement(id) {
	let element = moElements.get(id)
	if (element) return element
	element = document.createElement("button")
	element.type = "button"
	element.className = "mo-counter"
	element.dataset.mo = id
	const face = document.createElement("img")
	face.className = "mo-counter-face"
	const fallback = document.createElement("span")
	fallback.className = "mo-counter-fallback"
	const progress = document.createElement("span")
	progress.className = "mo-counter-progress"
	element.append(face, fallback, progress)
	element.addEventListener("click", () => {
		const entry = currentMoEntry(id)
		if (entry?.legal && entry.option && entry.action) perform(entry.action, entry.option)
	})
	moElements.set(id, element)
	return element
}

function renderMoPanel() {
	const panel = byId("mo-panel")
	const list = byId("mo-list")
	const own = view.mo?.own || []
	panel.hidden = own.length === 0
	if (!own.length) {
		list.replaceChildren()
		return
	}
	const groups = []
	for (const nation of [...new Set(own.map((entry) => entry.nation))]) {
		const group = document.createElement("section")
		group.className = `mo-group nation-${nation}`
		const label = document.createElement("strong")
		label.textContent = nationNames[nation] || nation.toUpperCase()
		const counters = document.createElement("div")
		counters.className = "mo-group-counters"
		for (const entry of own.filter((candidate) => candidate.nation === nation)) {
			const element = ensureMoElement(entry.id)
			const image = element.querySelector(".mo-counter-face")
			const fallback = element.querySelector(".mo-counter-fallback")
			const progress = element.querySelector(".mo-counter-progress")
			if (entry.image) {
				image.src = `assets/${entry.image}`
				image.alt = entry.name
				image.hidden = false
				fallback.hidden = true
			} else {
				image.hidden = true
				fallback.hidden = false
				fallback.textContent = `${entry.source_card ? `#${entry.source_card}\n` : ""}${entry.name}`
			}
			progress.textContent = `${entry.progress}/${entry.required}${entry.committed ? " · 已承诺" : ""}${entry.revealed ? " · 已公开" : ""}`
			element.title = `${entry.name}（${entry.progress}/${entry.required}）${entry.committed ? " · 已承诺" : ""}${entry.revealed ? " · 已公开" : ""}`
			element.classList.toggle("legal", Boolean(entry.legal))
			element.classList.toggle("selected", Boolean(entry.selected))
			counters.append(element)
		}
		const noneOption = `mo:${nation}:none`
		const moAction = actionIncludes("select_defense_mo", noneOption)
			? "select_defense_mo"
			: actionIncludes("select_attack_mo", noneOption)
				? "select_attack_mo"
				: null
		if (moAction) {
			const skip = document.createElement("button")
			skip.type = "button"
			skip.className = "mo-none-option"
			skip.textContent = EogActionProtocol.labelFor(
				moAction,
				noneOption,
				view.action_labels
			)
			skip.addEventListener("click", () => perform(moAction, noneOption))
			counters.append(skip)
		}
		group.append(label, counters)
		groups.push(group)
	}
	list.replaceChildren(...groups)
}

function showCard(card) {
	card = effectiveCard(card)
	const detail = byId("card-detail")
	const uses = [
		["discard_combat_card", "弃置战斗牌"],
		["combat_card", "战斗牌"]
	]
		.filter(([action]) => actionIncludes(action, card.id))
		.map(([action, label]) => `<button data-card-action="${action}">${label}</button>`)
		.join("")
	detail.innerHTML = `
		<div class="card-detail-grid">
			<img src="assets/${card.image_2x}" alt="${card.title}">
			<div>
				<p class="eyebrow">${card.commitment.toUpperCase()}</p>
				<h2>${card.title}</h2>
				<p>${card.effect}</p>
				<p>${card.ops} OPS · ${card.sr} SR · ${card.remove ? "事件后移除" : "事件后弃置"}</p>
				<div class="card-actions">${uses || "<p>当前不能使用这张牌。</p>"}</div>
			</div>
		</div>`
	for (const element of detail.querySelectorAll("[data-card-action]"))
		element.addEventListener("click", () => {
			byId("card-dialog").close()
			perform(element.dataset.cardAction, card.id)
		})
	byId("card-dialog").showModal()
}

function dieElement(faction, value) {
	const die = document.createElement("span")
	const face = Number(value)
	die.className = `die ${factionCode(faction) || ""} d${face}`.trim()
	die.textContent = String(value)
	die.title = `骰点 ${value}`
	die.setAttribute("role", "img")
	die.setAttribute("aria-label", `骰点 ${value}`)
	return die
}

function gameCardElement(id) {
	let element = cardElements.get(id)
	if (element) return element
	const card = cardById[id]
	element = document.createElement("button")
	element.dataset.card = id
	element.title = card?.title || id
	const image = document.createElement("img")
	image.src = `assets/${card.image}`
	image.srcset = `assets/${card.image} 1x, assets/${card.image_2x} 2x`
	image.alt = card.title
	element.append(image)
	element.addEventListener("click", (event) => {
		if (actionIncludes("select_opening_card", id)) return perform("select_opening_card", id)
		if (actionIncludes("combat_card", id)) perform("combat_card", id)
		else if (showCardMenu(event, cardById[id])) return
		else showCard(cardById[id])
	})
	cardElements.set(id, element)
	return element
}

function renderCombatCards() {
	const cards = view.combat_cards || { played: { ap: [], cp: [] }, hidden_counts: {}, available: [], retained: { ap: [], cp: [] }, active: [] }
	const handFaction = Array.isArray(view.hands?.ap) ? "ap" : Array.isArray(view.hands?.cp) ? "cp" : null
	const played = byId("combat-cards-played")
	const available = byId("combat-cards-available")
	const retained = byId("combat-cards-retained")
	const retainedZone = byId("combat-cards-retained-zone")
	played.replaceChildren()
	available.replaceChildren()
	retained.replaceChildren()
	const mounted = new Set()
	for (const faction of ["ap", "cp"])
		for (const id of cards.played?.[faction] || []) {
			const element = gameCardElement(id)
			element.className = `combat-card ${faction}`
			played.append(element)
			mounted.add(id)
		}
	for (const faction of ["ap", "cp"])
		for (let index = 0; index < (cards.hidden_counts?.[faction] || 0); index++) {
			const back = document.createElement("div")
			back.className = `combat-card-back ${faction}`
			back.textContent = `${faction.toUpperCase()} 战斗牌`
			played.append(back)
		}
	for (const id of cards.available || []) {
		if (mounted.has(id)) continue
		const element = gameCardElement(id)
		element.className = `combat-card ${handFaction || cardById[id]?.faction || ""} legal`
		available.append(element)
		mounted.add(id)
	}
	for (const faction of ["ap", "cp"])
		for (const id of cards.retained?.[faction] || []) {
			if (mounted.has(id)) continue
			const element = gameCardElement(id)
			element.className = `combat-card ${faction}`
			retained.append(element)
			mounted.add(id)
		}
	for (const entry of cards.active || []) {
		if (mounted.has(entry.id)) continue
		const element = gameCardElement(entry.id)
		element.className = `combat-card ${entry.faction || cardById[entry.id]?.faction || ""}`
		element.title = `${cardById[entry.id]?.title || entry.id} · 持续至 ${entry.expires}`
		retained.append(element)
		mounted.add(entry.id)
	}
	retainedZone.hidden = retained.childElementCount === 0
	const hasCards =
		played.childElementCount > 0 ||
		available.childElementCount > 0 ||
		retained.childElementCount > 0
	byId("combat-zone").hidden = !hasCards
}

const infoWindowKinds = Object.freeze({
	score: "overview-window",
	ap_cards: "ap-cards-window",
	cp_cards: "cp-cards-window",
	reinforcements: "unit-pools-window",
	track: "track-window"
})

const factionNames = Object.freeze({ ap: "协约国", cp: "同盟国" })
const nationNames = Object.freeze({
	fr: "法国", br: "英国", it: "意大利", us: "美国", be: "比利时",
	ge: "德国", ah: "奥匈", east: "东线", a: "共同", pr: "普鲁士", ba: "巴伐利亚", sa: "萨克森", wu: "符腾堡"
})

function preferenceKey(suffix) {
	return `${window.params?.title_id || "end-of-glory"}/${suffix}`
}

function bringInfoWindowToFront(windowElement) {
	ui.windowZ += 1
	windowElement.style.zIndex = String(ui.windowZ)
}

function clampInfoWindow(windowElement) {
	if (window.innerWidth <= 800 || windowElement.hidden) return
	const margin = 8
	const rect = windowElement.getBoundingClientRect()
	const width = Math.min(rect.width, window.innerWidth - margin * 2)
	const height = Math.min(rect.height, window.innerHeight - margin * 2)
	const left = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin)
	const top = Math.min(Math.max(rect.top, margin), window.innerHeight - height - margin)
	Object.assign(windowElement.style, { width: `${width}px`, height: `${height}px`, left: `${left}px`, top: `${top}px` })
}

function saveInfoWindowLayout(windowElement) {
	if (window.innerWidth <= 800) return
	const rect = windowElement.getBoundingClientRect()
	localStorage.setItem(preferenceKey(`window-v2/${windowElement.id}`), JSON.stringify({
		left: rect.left,
		top: rect.top,
		width: rect.width,
		height: rect.height
	}))
}

function restoreInfoWindowLayout(windowElement, index) {
	if (window.innerWidth <= 800) return
	let saved = null
	try { saved = JSON.parse(localStorage.getItem(preferenceKey(`window-v2/${windowElement.id}`))) } catch { saved = null }
	const cardWindow = windowElement.classList.contains("info-window-card")
	const defaults = {
		left: 36 + index * 42,
		top: 68 + index * 34,
		width: cardWindow ? 350 : windowElement.classList.contains("info-window-wide") ? 980 : 660,
		height: cardWindow ? 520 : 600
	}
	const layout = saved && [saved.left, saved.top, saved.width, saved.height].every(Number.isFinite) ? saved : defaults
	Object.assign(windowElement.style, {
		left: `${layout.left}px`, top: `${layout.top}px`, width: `${layout.width}px`, height: `${layout.height}px`
	})
}

function startInfoWindowPointer(event, windowElement, mode) {
	if (window.innerWidth <= 800 || event.button !== 0) return
	if (event.target.closest("button")) return
	event.preventDefault()
	bringInfoWindowToFront(windowElement)
	const rect = windowElement.getBoundingClientRect()
	const startX = event.clientX
	const startY = event.clientY
	const move = (moveEvent) => {
		const dx = moveEvent.clientX - startX
		const dy = moveEvent.clientY - startY
		if (mode === "move") {
			windowElement.style.left = `${rect.left + dx}px`
			windowElement.style.top = `${rect.top + dy}px`
		} else {
			let left = rect.left
			let top = rect.top
			let width = rect.width
			let height = rect.height
			if (mode.includes("e")) width += dx
			if (mode.includes("s")) height += dy
			if (mode.includes("w")) { width -= dx; left += dx }
			if (mode.includes("n")) { height -= dy; top += dy }
			width = Math.max(420, Math.min(width, window.innerWidth - 16))
			height = Math.max(280, Math.min(height, window.innerHeight - 16))
			if (mode.includes("w")) left = rect.right - width
			if (mode.includes("n")) top = rect.bottom - height
			Object.assign(windowElement.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` })
		}
		clampInfoWindow(windowElement)
	}
	const stop = () => {
		document.removeEventListener("pointermove", move)
		document.removeEventListener("pointerup", stop)
		saveInfoWindowLayout(windowElement)
	}
	document.addEventListener("pointermove", move)
	document.addEventListener("pointerup", stop)
}

function initializeInfoWindows() {
	Object.values(infoWindowKinds).forEach((id, index) => {
		const windowElement = byId(id)
		restoreInfoWindowLayout(windowElement, index)
		windowElement.addEventListener("pointerdown", () => bringInfoWindowToFront(windowElement))
		windowElement.querySelector(".info-window-header").addEventListener("pointerdown", (event) => startInfoWindowPointer(event, windowElement, "move"))
		windowElement.querySelector(".info-window-close").addEventListener("click", () => { windowElement.hidden = true })
		for (const corner of ["nw", "ne", "sw", "se"]) {
			const handle = document.createElement("span")
			handle.className = `info-window-resize ${corner}`
			handle.addEventListener("pointerdown", (event) => startInfoWindowPointer(event, windowElement, corner))
			windowElement.append(handle)
		}
	})
	window.addEventListener("resize", () => Object.values(infoWindowKinds).forEach((id) => clampInfoWindow(byId(id))))
}

function infoSection(title, className = "") {
	const section = document.createElement("section")
	section.className = `info-section ${className}`.trim()
	const heading = document.createElement("h3")
	heading.textContent = title
	section.append(heading)
	return section
}

function infoStat(label, value, className = "") {
	const row = document.createElement("div")
	row.className = `info-stat ${className}`.trim()
	const name = document.createElement("span")
	name.textContent = label
	const result = document.createElement("strong")
	result.textContent = String(value ?? "—")
	row.append(name, result)
	return row
}

function visibleHandCount(faction) {
	const hand = view.hands?.[faction]
	return Array.isArray(hand) ? hand.length : Number(hand || 0)
}

function renderOverviewInfo() {
	const detail = byId("overview-detail")
	const state = infoSection("当前局势", "info-summary-grid")
	state.append(
		infoStat("回合", view.turn), infoStat("行动轮", view.action_round || "—"),
		infoStat("行动方", roleLabel(view.active)), infoStat("阶段", view.phase),
		infoStat("VP", view.vp), infoStat("当前指令", view.prompt || "—", "info-stat-wide")
	)
	const war = infoSection("战争状态与承诺", "info-summary-grid")
	war.append(
		infoStat("AP战争状态", view.war_status?.ap || 0), infoStat("CP战争状态", view.war_status?.cp || 0),
		infoStat("综合战争状态", view.war_status?.combined || 0),
		infoStat("AP承诺", view.commitment?.ap || "—"), infoStat("CP承诺", view.commitment?.cp || "—")
	)
	const mo = infoSection("强制进攻")
	const moList = document.createElement("div")
	moList.className = "info-list"
	for (const entry of view.mo?.own || [])
		moList.append(infoStat(
			`${nationNames[entry.nation] || entry.nation.toUpperCase()} · ${entry.name}`,
			`${entry.progress}/${entry.required}${entry.revealed ? " · 已公开" : ""}`,
			"warning"
		))
	for (const [nation, count] of Object.entries(view.mo?.opponent_counts || {}))
		if (count) moList.append(infoStat(`${nationNames[nation] || nation.toUpperCase()} · 未公开MO`, count))
	for (const entry of view.mo?.revealed || [])
		if (!(view.mo?.own || []).some((own) => own.id === entry.id))
			moList.append(infoStat(`${nationNames[entry.nation] || entry.nation.toUpperCase()} · ${entry.name}`, `${entry.progress}/${entry.required} · 已公开`, "warning"))
	for (const entry of view.mo?.active_effects || [])
		moList.append(infoStat(
			`${nationNames[entry.nation] || entry.nation.toUpperCase()} · ${entry.name}`,
			entry.kind === "prohibition" ? "禁止效果生效" : "被动效果生效",
			"warning"
		))
	if (!moList.children.length) moList.textContent = "当前没有强制进攻。"
	mo.append(moList)
	const moHistory = infoSection("强制进攻公开记录")
	const moHistoryList = document.createElement("div")
	moHistoryList.className = "info-list"
	const historyByTurn = new Map()
	for (const entry of view.mo?.history || []) {
		if (!historyByTurn.has(entry.turn)) historyByTurn.set(entry.turn, [])
		historyByTurn.get(entry.turn).push(entry)
	}
	for (const turn of [...historyByTurn.keys()].sort((a, b) => b - a)) {
		const fold = document.createElement("details")
		fold.open = turn === view.turn
		const summary = document.createElement("summary")
		summary.textContent = `回合 ${turn}`
		const entries = document.createElement("div")
		entries.className = "info-list"
		for (const entry of historyByTurn.get(turn)) {
		const outcomes = {
			completed: "完成",
			waived: "免除",
			penalized: "受罚结算",
			none: "无强制进攻",
			passive: "被动效果",
			exhausted: "支付手段耗尽"
		}
		entries.append(infoStat(
			`T${entry.turn} · ${nationNames[entry.nation] || entry.nation.toUpperCase()} · ${entry.mo?.name || entry.id}`,
			outcomes[entry.outcome] || entry.outcome,
			entry.outcome === "completed" ? "complete" : "warning"
		))
		}
		fold.append(summary, entries)
		moHistoryList.append(fold)
	}
	if (!moHistoryList.children.length) moHistoryList.textContent = "暂无公开记录。"
	moHistory.append(moHistoryList)
	const resources = infoSection("补员、战线与参战轨", "info-summary-grid")
	for (const [faction, values] of Object.entries(view.rp || {}))
		for (const [nation, value] of Object.entries(values || {}))
			resources.append(infoStat(`${faction.toUpperCase()} ${nationNames[nation] || nation.toUpperCase()} RP`, value))
	resources.append(
		infoStat("俄国战线", view.fronts?.russian || 0), infoStat("俄国战线储存", view.front_storage?.russian || 0),
		...(view.fronts_active?.turkish
			? [infoStat("土耳其战线", view.fronts?.turkish || 0), infoStat("土耳其战线储存", view.front_storage?.turkish || 0)]
			: []),
		infoStat("U艇轨", view.naval?.track || 0), infoStat("美国参战", view.entry_tracks?.us || 0),
		infoStat("停战协议", view.entry_tracks?.armistice || 0)
	)
	const cards = infoSection("卡牌", "info-summary-grid")
	for (const faction of ["ap", "cp"])
		cards.append(
			infoStat(`${faction.toUpperCase()}手牌`, visibleHandCount(faction)),
			infoStat(`${faction.toUpperCase()}牌库`, view.deck_count?.[faction] || 0),
			infoStat(`${faction.toUpperCase()}保留战斗牌`, view.combat_cards?.retained?.[faction]?.length || 0)
		)
	const events = infoSection("持续事件、计划与警告")
	const eventList = document.createElement("div")
	eventList.className = "info-list"
	for (const event of Object.keys(view.events || {})) {
		const card = eog_data.cards.find((candidate) => candidate.event === event)
		eventList.append(infoStat(card?.title || event, view.events[event]?.duration || "生效中"))
	}
	for (const scheduled of view.scheduled_events || [])
		eventList.append(infoStat(cardById[scheduled.source_card]?.title || scheduled.kind, `预定T${scheduled.due_turn}`))
	if (view.supply_warnings?.spaces?.length)
		eventList.append(infoStat("补给警告", view.supply_warnings.spaces.map((id) => spaceById[id]?.name || id).join("、"), "warning"))
	if (view.rollback_proposal) eventList.append(infoStat("回滚提议", view.rollback_proposal.label, "warning"))
	if (!eventList.children.length) eventList.textContent = "当前没有持续事件、计划事件或警告。"
	events.append(eventList)
	const recent = infoSection("最近记录")
	const recentLog = document.createElement("div")
	recentLog.className = "info-recent-log"
	const logEntries = Array.isArray(view.log) ? view.log.slice(-5) : []
	for (const entry of logEntries) recentLog.append(onLog(entry))
	if (!recentLog.children.length) recentLog.textContent = "暂无记录。"
	recent.append(recentLog)
	detail.replaceChildren(state, war, mo, moHistory, resources, cards, events, recent)
}

function ensureCardTooltip() {
	let tooltip = byId("info-card-tooltip")
	if (tooltip) return tooltip
	tooltip = document.createElement("div")
	tooltip.id = "info-card-tooltip"
	tooltip.hidden = true
	document.body.append(tooltip)
	return tooltip
}

function formatInfoCardLabel(card) {
	if (!card) return "未知卡牌"
	card = effectiveCard(card)
	const marker = card.printed_marker ? ` (${card.printed_marker})` : ""
	const remove = card.remove ? "*" : ""
	const combat = card.combat_card ? " CC" : ""
	return `[${card.ops}/${card.sr}] ${card.title}${remove}${marker}${combat}`
}

function infoCardLink(id) {
	const card = cardById[id]
	const item = document.createElement("button")
	item.type = "button"
	item.className = `info-card-link ${card?.faction || ""}`
	item.textContent = card ? formatInfoCardLabel(card) : `未知卡牌 #${id}`
	item.addEventListener("click", () => showCard(card))
	item.addEventListener("pointerenter", () => {
		const tooltip = ensureCardTooltip()
		const image = document.createElement("img")
		image.src = `assets/${card?.image_2x || card?.image}`
		image.alt = card?.title || String(id)
		tooltip.replaceChildren(image)
		tooltip.hidden = false
	})
	item.addEventListener("pointerleave", () => { ensureCardTooltip().hidden = true })
	return item
}

function appendCardCatalogGroup(catalog, title, ids, hidden = false) {
	const cards = hidden ? [] : [...(ids || [])].sort((a, b) => (cardById[a]?.number || a) - (cardById[b]?.number || b))
	const heading = document.createElement("dt")
	heading.textContent = `${title} (${hidden ? Number(ids || 0) : cards.length})`
	catalog.append(heading)
	if (hidden) {
		const entry = document.createElement("dd")
		entry.className = "info-card-hidden"
		entry.textContent = "内容对当前观察者隐藏"
		catalog.append(entry)
		return
	}
	for (const id of cards) {
		const entry = document.createElement("dd")
		entry.append(infoCardLink(id))
		catalog.append(entry)
	}
}

function renderCardInfo(faction) {
	const detail = byId(`${faction}-cards-detail`)
	const hand = view.hands?.[faction]
	const catalog = document.createElement("dl")
	catalog.className = `info-card-catalog ${faction}`
	appendCardCatalogGroup(catalog, "手牌", Array.isArray(hand) ? hand : Number(hand || 0), !Array.isArray(hand))
	appendCardCatalogGroup(catalog, "牌库", view.deck_cards?.[faction] || [])
	appendCardCatalogGroup(catalog, "弃牌堆", view.discard?.[faction] || [])
	appendCardCatalogGroup(catalog, "移出游戏", view.removed?.[faction] || [])
	appendCardCatalogGroup(catalog, "保留战斗牌", view.combat_cards?.retained?.[faction] || [])
	appendCardCatalogGroup(catalog, "持续生效", (view.combat_cards?.active || []).filter((entry) => entry.faction === faction).map((entry) => entry.id))
	detail.replaceChildren(catalog)
}

function showUnitInfo(unit, context) {
	const piece = pieceById[unit.piece]
	const detail = byId("unit-detail")
	const image = document.createElement("img")
	image.className = `unit-detail-face ${piece?.type === "army" ? "lcu" : "small"}`
	image.src = `assets/${unit.reduced && piece?.image_back ? piece.image_back : piece?.image}`
	image.alt = piece?.name || unit.id
	const text = document.createElement("div")
	text.append(
		infoStat("单位", piece?.name || unit.id), infoStat("区域", context),
		infoStat("阵营", factionNames[unit.faction || piece?.faction] || unit.faction || piece?.faction),
		infoStat("国籍", nationNames[unit.nation || piece?.nation] || unit.nation || piece?.nation),
		infoStat("状态", unit.reduced ? "减员" : "满编")
	)
	detail.replaceChildren(image, text)
	byId("unit-dialog").showModal()
}

function infoPiece(unit, context) {
	const piece = pieceById[unit.piece]
	const button = document.createElement("button")
	button.type = "button"
	button.className = `info-piece ${piece?.type === "army" ? "lcu" : "small"}`
	const image = document.createElement("img")
	image.src = `assets/${unit.reduced && piece?.image_back ? piece.image_back : piece?.image}`
	image.alt = piece?.name || unit.id
	button.title = `${piece?.name || unit.id} · ${context}${unit.due_turn != null ? ` · T${unit.due_turn}返回` : ""}`
	button.append(image)
	button.addEventListener("click", () => {
		const frame = currentPieceScene?.units.get(unit.id)
		if (frame) return activateLogReference("unit", unit.id)
		showUnitInfo(unit, context)
	})
	return button
}

function appendUnitPool(container, faction, title, units) {
	const section = infoSection(`${faction.toUpperCase()} · ${title}`, "unit-pool-section")
	const groups = new Map()
	for (const unit of units || []) {
		const key = unit.nation || pieceById[unit.piece]?.nation || "other"
		if (!groups.has(key)) groups.set(key, [])
		groups.get(key).push(unit)
	}
	for (const [nation, entries] of groups) {
		const group = document.createElement("div")
		group.className = "unit-pool-group"
		const label = document.createElement("strong")
		label.textContent = nationNames[nation] || nation.toUpperCase()
		const pieces = document.createElement("div")
		pieces.className = "unit-pool-pieces"
		entries.sort((a, b) => (pieceById[b.piece]?.type || "").localeCompare(pieceById[a.piece]?.type || "") || (pieceById[a.piece]?.name || "").localeCompare(pieceById[b.piece]?.name || ""))
		for (const unit of entries) pieces.append(infoPiece(unit, title))
		group.append(label, pieces)
		section.append(group)
	}
	if (!(units || []).length) section.append("无")
	container.append(section)
}

function renderUnitPoolsInfo() {
	const detail = byId("unit-pools-detail")
	detail.replaceChildren()
	for (const faction of ["ap", "cp"]) {
		appendUnitPool(detail, faction, "预备区", view.reserves?.[faction] || [])
		appendUnitPool(detail, faction, "升级池", view.upgrade_pool?.[faction] || [])
		appendUnitPool(detail, faction, "消灭单位", view.eliminated?.[faction] || [])
		appendUnitPool(detail, faction, "永久移除", (view.permanently_removed_units || []).filter((unit) => (unit.faction || pieceById[unit.piece]?.faction) === faction))
		appendUnitPool(detail, faction, "HQ回合轨", view.hq_turn_track?.[faction] || [])
	}
}

function actionTypeLabel(type) {
	return { ops: "OPS", one_op: "1 OP", sr: "SR", rp: "RP", event: "EVENT" }[type] || String(type || "—").toUpperCase()
}

const trackSnapshotByTurn = new Map()
let trackSnapshotProbe = null
let trackLatestSnapshotCount = null
let trackLatestTurn = 1

function replayPosition() {
	const match = String(view?.prompt || "").match(/Replay\s+(\d+)\s*\/\s*(\d+)/i)
	return match ? { snap: Number(match[1]), count: Number(match[2]) } : null
}

function snapshotNavigationAvailable() {
	return typeof window.request_snap === "function" && Boolean(byId("replay_panel")?.isConnected)
}

function resolveTrackSnapshotProbe() {
	const replay = replayPosition()
	if (!trackSnapshotProbe || !replay || replay.snap !== trackSnapshotProbe.snap) return
	const probe = trackSnapshotProbe
	trackSnapshotProbe = null
	trackLatestSnapshotCount = replay.count
	probe.resolve({ snap: replay.snap, count: replay.count, turn: Number(view.turn) || 1 })
}

function requestTrackSnapshot(snap) {
	if (!snapshotNavigationAvailable() || !Number.isInteger(snap) || snap < 1) return Promise.resolve(null)
	return new Promise((resolve) => {
		trackSnapshotProbe = { snap, resolve }
		window.request_snap(snap, () => {
			if (trackSnapshotProbe?.snap !== snap) return
			trackSnapshotProbe = null
			resolve(null)
		})
		window.setTimeout(() => {
			if (trackSnapshotProbe?.snap !== snap) return
			trackSnapshotProbe = null
			resolve(null)
		}, 5000)
	})
}

async function goToTrackTurn(targetTurn) {
	targetTurn = Math.max(1, Math.min(trackLatestTurn, Number(targetTurn) || 1))
	ui.trackTurn = targetTurn
	if (!snapshotNavigationAvailable()) { renderTrackInfo(); return }
	const cached = trackSnapshotByTurn.get(targetTurn)
	if (cached) { await requestTrackSnapshot(cached); ui.trackTurn = targetTurn; renderTrackInfo(); return }
	let replay = replayPosition()
	if (!replay) {
		const first = await requestTrackSnapshot(1)
		if (!first) { renderTrackInfo(); return }
		replay = { snap: first.snap, count: first.count }
	}
	let low = 1
	let high = replay.count
	let best = 1
	while (low <= high) {
		const middle = Math.floor((low + high) / 2)
		const result = await requestTrackSnapshot(middle)
		if (!result) break
		if (result.turn <= targetTurn) {
			best = middle
			low = middle + 1
		} else high = middle - 1
	}
	trackSnapshotByTurn.set(targetTurn, best)
	await requestTrackSnapshot(best)
	ui.trackTurn = targetTurn
	renderTrackInfo()
}

async function returnToLatestSnapshot() {
	const replay = replayPosition()
	const count = replay?.count || trackLatestSnapshotCount
	if (!count) return
	await requestTrackSnapshot(count)
	ui.trackTurn = Number(view.turn) || trackLatestTurn
	renderTrackInfo()
}

function trackTurnBounds() {
	const turns = (view.action_history || []).map((entry) => Number(entry.turn)).filter(Number.isFinite)
	return { min: Math.min(1, ...turns), max: Math.max(trackLatestTurn, Number(view.turn) || 1, ...turns) }
}

function renderTrackInfo() {
	const detail = byId("track-detail")
	const bounds = trackTurnBounds()
	const selectedTurn = Math.max(bounds.min, Math.min(bounds.max, Number(ui.trackTurn) || Number(view.turn) || 1))
	ui.trackTurn = selectedTurn
	const toolbar = document.createElement("div")
	toolbar.className = "track-toolbar"
	const previous = document.createElement("button")
	previous.type = "button"
	previous.textContent = "‹"
	previous.disabled = !snapshotNavigationAvailable() || selectedTurn <= bounds.min
	previous.addEventListener("click", () => goToTrackTurn(selectedTurn - 1))
	const select = document.createElement("select")
	for (let turn = bounds.min; turn <= bounds.max; turn += 1) {
		const option = document.createElement("option")
		option.value = String(turn)
		option.textContent = `回合 ${turn}`
		option.selected = turn === selectedTurn
		select.append(option)
	}
	select.addEventListener("change", () => goToTrackTurn(Number(select.value)))
	select.disabled = !snapshotNavigationAvailable()
	const next = document.createElement("button")
	next.type = "button"
	next.textContent = "›"
	next.disabled = !snapshotNavigationAvailable() || selectedTurn >= bounds.max
	next.addEventListener("click", () => goToTrackTurn(selectedTurn + 1))
	const latest = document.createElement("button")
	latest.type = "button"
	latest.textContent = "返回最新局面"
	latest.disabled = !snapshotNavigationAvailable() || (!replayPosition() && !trackLatestSnapshotCount)
	latest.addEventListener("click", returnToLatestSnapshot)
	toolbar.append(previous, select, next, latest)
	const summary = document.createElement("div")
	summary.className = "track-summary"
	summary.append(
		infoStat("行动方", roleLabel(view.active)), infoStat("AR", view.action_round || "—"),
		infoStat("阶段", view.phase), infoStat("日志位置", Array.isArray(view.log) ? view.log.length : view.log)
	)
	const grid = document.createElement("div")
	grid.className = "track-grid"
	for (const faction of ["cp", "ap"]) {
		const label = document.createElement("strong")
		label.className = `track-faction ${faction}`
		label.textContent = faction.toUpperCase()
		grid.append(label)
		for (let round = 1; round <= (eog_data.title?.action_rounds || 6); round += 1) {
			const entry = (view.action_history || []).find((candidate) => candidate.turn === selectedTurn && candidate.round === round && candidate.faction === faction)
			const slot = document.createElement("button")
			slot.type = "button"
			slot.className = `track-slot ${faction}${selectedTurn === view.turn && round === view.action_round && roleLabel(view.active) === factionNames[faction] ? " current" : ""}`
			if (entry) {
				const card = cardById[entry.card]
				slot.innerHTML = `<strong>${actionTypeLabel(entry.type)}</strong><span>${card ? `${entry.card} · ${card.title}` : "1 OP"}</span>`
				if (card) slot.addEventListener("click", () => showCard(card))
			} else slot.innerHTML = `<strong>AR${round}</strong><span>无结构化记录</span>`
			grid.append(slot)
		}
	}
	const log = document.createElement("div")
	log.className = "track-log"
	for (const entry of Array.isArray(view.log) ? view.log : []) {
		const element = onLog(entry)
		if (/^T\d+ 行动轮/.test(String(entry))) element.classList.add("turn-heading")
		log.append(element)
	}
	detail.replaceChildren(toolbar, summary, grid, log)
}

function renderOpenInfoWindows() {
	if (!byId("overview-window").hidden) renderOverviewInfo()
	if (!byId("ap-cards-window").hidden) renderCardInfo("ap")
	if (!byId("cp-cards-window").hidden) renderCardInfo("cp")
	if (!byId("unit-pools-window").hidden) renderUnitPoolsInfo()
	if (!byId("track-window").hidden) renderTrackInfo()
}

function showInfo(kind) {
	if (kind === "discard") {
		showInfo(Array.isArray(view.hands?.ap) ? "ap_cards" : "cp_cards")
		return
	}
	const id = infoWindowKinds[kind]
	if (!id) return
	if (byId("info-menu")) byId("info-menu").open = false
	const windowElement = byId(id)
	windowElement.hidden = false
	clampInfoWindow(windowElement)
	bringInfoWindowToFront(windowElement)
	if (kind === "score") renderOverviewInfo()
	else if (kind === "ap_cards") renderCardInfo("ap")
	else if (kind === "cp_cards") renderCardInfo("cp")
	else if (kind === "reinforcements") renderUnitPoolsInfo()
	else if (kind === "track") { ui.trackTurn = Number(view.turn) || 1; renderTrackInfo() }
}

function setCounterStyle(style) {
	const normalized = style === "flat" ? "flat" : "bevel"
	document.body.classList.toggle("flat", normalized === "flat")
	document.body.classList.toggle("bevel", normalized === "bevel")
	localStorage.setItem(`${window.params?.title_id || "end-of-glory"}/style`, normalized)
	byId("style-bevel-item")?.classList.toggle("checked", normalized === "bevel")
	byId("style-flat-item")?.classList.toggle("checked", normalized === "flat")
}

function setMouseFocus(enabled = !ui.mouseFocus) {
	ui.mouseFocus = Boolean(enabled)
	localStorage.setItem(`${window.params?.title_id || "end-of-glory"}/mouse-focus`, ui.mouseFocus ? "1" : "0")
	byId("mouse-focus-item")?.classList.toggle("checked", ui.mouseFocus)
}

function toggleCounters() {
	ui.counterVisibility = (ui.counterVisibility + 1) % 3
	const map = byId("map")
	map.classList.toggle("hide-pieces", ui.counterVisibility >= 1)
	map.classList.toggle("hide-markers", ui.counterVisibility >= 2)
	const labels = ["全部棋子与标记可见", "已隐藏单位", "已隐藏单位与标记"]
	byId("piece-button").title = `${labels[ui.counterVisibility]}（点击切换）`
}

function requestSupplyOverlay(faction) {
	if (ui.supplyOverlayFaction === faction) {
		ui.supplyOverlayFaction = null
		ui.supplyOverlaySpaces = new Set()
		renderSpaces()
		return
	}
	ui.pendingSupplyFaction = faction
	send_query("supply")
}

function onReply(query, payload) {
	if (query !== "supply" || !payload) return
	const faction = ui.pendingSupplyFaction || "ap"
	ui.supplyOverlayFaction = faction
	ui.supplyOverlaySpaces = new Set(payload[faction] || [])
	ui.pendingSupplyFaction = null
	renderSpaces()
}

function rollbackChangeLines(changes) {
	if (!changes) return []
	const lines = []
	for (const unit of changes.units || []) {
		const before = unit.before
		const after = unit.after
		if (!before) lines.push(`单位 ${unit.id}：进入 ${after.pool}${after.location ? `（${after.location}）` : ""}`)
		else if (!after) lines.push(`单位 ${unit.id}：从 ${before.pool} 移除`)
		else if (before.pool !== after.pool || before.location !== after.location)
			lines.push(`单位 ${unit.id}：${before.pool}${before.location ? `/${before.location}` : ""} → ${after.pool}${after.location ? `/${after.location}` : ""}`)
		else if (before.reduced !== after.reduced)
			lines.push(`单位 ${unit.id}：${before.reduced ? "减员" : "满员"} → ${after.reduced ? "减员" : "满员"}`)
		else if (before.moved !== after.moved || before.attacked !== after.attacked)
			lines.push(`单位 ${unit.id}：使用状态改变`)
	}
	for (const group of [changes.resources, changes.board, changes.activations, changes.flow])
		for (const entry of group || []) lines.push(`${entry.key}：${JSON.stringify(entry.before)} → ${JSON.stringify(entry.after)}`)
	for (const [faction, cards] of Object.entries(changes.cards || {})) {
		const hand = cards.hand
		lines.push(`${faction.toUpperCase()} 手牌：${hand.before_count ?? hand.before?.length ?? 0} → ${hand.after_count ?? hand.after?.length ?? 0}；牌库 ${cards.deck.before_count} → ${cards.deck.after_count}`)
	}
	return lines
}

function openRollbackDialog() {
	const legal = actionValue("propose_rollback")
	if (!Array.isArray(legal) || !legal.length) return
	const groupSelect = byId("rollback-group")
	const select = byId("rollback-checkpoint")
	const checkpoints = legal
		.map((index) => view.rollback?.find((entry) => entry.index === index))
		.filter(Boolean)
	const groups = [...new Map(checkpoints.map((entry) => [entry.group || `T${entry.turn}:AR${entry.round || 0}`, entry])).entries()]
	groupSelect.replaceChildren()
	for (const [group, entry] of groups) {
		const option = document.createElement("option")
		option.value = group
		option.textContent = `第 ${entry.turn} 回合 · 行动轮 ${entry.round || 0}`
		groupSelect.append(option)
	}
	const populate = () => {
		select.replaceChildren()
		for (const checkpoint of checkpoints.filter((entry) => (entry.group || `T${entry.turn}:AR${entry.round || 0}`) === groupSelect.value)) {
			const option = document.createElement("option")
			option.value = String(checkpoint.index)
			option.textContent = `${checkpoint.label} · ${checkpoint.kind}`
			select.append(option)
		}
		update()
	}
	const update = () => {
		const checkpoint = view.rollback?.find((entry) => entry.index === Number(select.value))
		const detail = byId("rollback-detail")
		if (!checkpoint) {
			detail.textContent = "没有可用检查点。"
			return
		}
		const summary = document.createElement("p")
		summary.textContent = `将请求对手同意回滚到“${checkpoint.label}”。以下 ${checkpoint.removed_logs?.length || 0} 条公开记录会被撤销。`
		const changeList = document.createElement("ul")
		changeList.className = "rollback-change-preview"
		const changeLines = rollbackChangeLines(checkpoint.changes)
		for (const line of changeLines.slice(0, 30)) {
			const item = document.createElement("li")
			item.textContent = line
			changeList.append(item)
		}
		if (changeLines.length > 30) {
			const item = document.createElement("li")
			item.textContent = `另有 ${changeLines.length - 30} 项状态变化省略。`
			changeList.append(item)
		}
		const list = document.createElement("ol")
		list.className = "rollback-log-preview"
		for (const line of checkpoint.removed_logs || []) {
			const item = document.createElement("li")
			appendLogText(item, line)
			list.append(item)
		}
		if (checkpoint.omitted_logs) {
			const item = document.createElement("li")
			item.textContent = `另有 ${checkpoint.omitted_logs} 条较早记录省略。`
			list.prepend(item)
		}
		detail.replaceChildren(summary, changeList, list)
	}
	groupSelect.onchange = populate
	select.onchange = update
	populate()
	byId("rollback-dialog").showModal()
}

function buildBugReport(note) {
	return [
		"End of Glory bug report",
		`time=${new Date().toISOString()}`,
		`role=${window.params?.role || "Observer"}`,
		`state=${view.state}`,
		`turn=${view.turn}`,
		`action_round=${view.action_round}`,
		`active=${view.active}`,
		`note=${note}`,
		`actions=${JSON.stringify(view.actions || {})}`,
		`recent_log=${JSON.stringify((view.log || []).slice(-20))}`
	].join("\n")
}

function submitBugReport(event) {
	event.preventDefault()
	const note = byId("bug-report-note").value.trim()
	const report = buildBugReport(note)
	const blob = new Blob([report], { type: "text/plain;charset=utf-8" })
	const url = URL.createObjectURL(blob)
	const link = document.createElement("a")
	link.href = url
	link.download = `end-of-glory-bug-${Date.now()}.txt`
	link.click()
	URL.revokeObjectURL(url)
	if (byId("bug-report-send-chat").checked && typeof send_message === "function")
		send_message("chat", `问题报告：${note || "未填写说明"}`)
	byId("bug-report-dialog").close()
}

function setMenuDisabled(id, disabled) {
	byId(id)?.classList.toggle("disabled", Boolean(disabled))
}

function renderToolbarState() {
	setMenuDisabled("flag-supply-warnings", actionValue("flag_supply_warnings") !== 1)
	setMenuDisabled("propose-rollback", !Array.isArray(actionValue("propose_rollback")))
	byId("flag-supply-warnings")?.classList.toggle("checked", Boolean(view.supply_warnings?.spaces?.length))
}

function renderStatus() {
	const turnInfo = byId("turn_info")
	const summary = document.createElement("button")
	summary.type = "button"
	summary.className = "sidebar-summary"
	summary.textContent = `回合 ${view.turn} · 行动轮 ${view.action_round || "—"}\nVP ${view.vp} · 战争状态 ${view.war_status.ap}/${view.war_status.cp}`
	summary.addEventListener("click", () => showInfo("score"))
	const notices = document.createElement("div")
	notices.className = "sidebar-notices"
	const currentMo = (view.mo?.own || []).length + Object.values(view.mo?.opponent_counts || {}).reduce((sum, count) => sum + Number(count || 0), 0)
	if (currentMo) notices.append(infoStat("MO待完成", currentMo, "warning"))
	if (view.supply_warnings?.spaces?.length) notices.append(infoStat("补给警告", view.supply_warnings.spaces.length, "warning"))
	if (view.rollback_proposal) notices.append(infoStat("回滚待审查", view.rollback_proposal.label, "warning"))
	turnInfo.replaceChildren(summary, notices)
	byId("status").textContent =
		`T${view.turn} · AR ${view.action_round || "—"} · VP ${view.vp}`
}

function renderRoles() {
	if (typeof roles === "undefined" || !Array.isArray(roles)) return
	for (const role of roles) {
		const faction = role.role === "Allied Powers" ? "ap" : role.role === "Central Powers" ? "cp" : null
		if (!faction) continue
		const hand = view.hands?.[faction]
		const handCount = Array.isArray(hand) ? hand.length : Number(hand || 0)
		const rpTotal = Object.values(view.rp?.[faction] || {}).reduce(
			(sum, value) => sum + Number(value || 0),
			0
		)
		role.element.classList.add(`${faction}-role`)
		role.name.querySelector("span").textContent = faction === "ap" ? "协约国" : "同盟国"
		role.stat.textContent = `手牌 ${handCount} · 牌库 ${view.deck_count?.[faction] ?? "—"}`
		role.stat.classList.add("role-stat-link")
		role.stat.title = `查看${factionNames[faction]}卡牌信息`
		role.stat.tabIndex = 0
		role.stat.setAttribute("role", "button")
		role.stat.onclick = () => showInfo(`${faction}_cards`)
		role.stat.onkeydown = (event) => {
			if (event.key !== "Enter" && event.key !== " ") return
			event.preventDefault()
			showInfo(`${faction}_cards`)
		}
		const info = role.element.querySelector(".role_info")
		if (info) info.textContent = `补员 ${rpTotal} · 战争状态 ${view.war_status?.[faction] ?? 0}`
	}
}

function highlightLogReference(kind, value, enabled) {
	let element = null
	if (kind === "space") element = [...document.querySelectorAll(".space")].find((space) => space.dataset.space === value)
	if (kind === "unit") element = pieceElements.get(value)
	if (kind === "mo") element = moElements.get(value)
	if (element) element.classList.toggle("log-highlight", enabled)
}

function activateLogReference(kind, value) {
	if (window.innerWidth <= 800) {
		const sidebar = document.querySelector("body > aside")
		if (sidebar) sidebar.hidden = true
	}
	if (kind === "card") return showCard(cardById[Number(value)])
	if (kind === "mo") {
		showInfo("score")
		return
	}
	if (kind === "unit") {
		const frame = currentPieceScene?.units.get(value)
		if (frame) focusStack(frame.stackKey)
		const element = pieceElements.get(value)
		if (element) element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" })
		return
	}
	if (kind === "space") {
		const element = [...document.querySelectorAll(".space")].find((space) => space.dataset.space === value)
		if (element) element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" })
	}
}

function appendLogText(element, text) {
	const pattern = /\[\[(space|unit|card|die|mo):([^\]]+)\]\]/g
	let start = 0
	for (const match of text.matchAll(pattern)) {
		element.append(document.createTextNode(text.slice(start, match.index)))
		const kind = match[1]
		const value = match[2]
		const token = document.createElement(kind === "die" ? "span" : "button")
		token.className = `log-ref log-${kind}`
		if (kind === "space") token.textContent = spaceById[value]?.name || value
		else if (kind === "unit") {
			token.textContent = eventUnitLabel(value)
			const faction = unitById.get(value)?.faction || (view.units || []).find((unit) => unit.id === value)?.faction
			if (faction) token.classList.add(`${faction}-unit`)
		}
		else if (kind === "card") {
			const card = cardById[Number(value)]
			token.textContent = card?.title || value
			if (card?.faction) token.classList.add(`${card.faction}-card`)
		}
		else if (kind === "mo") token.textContent = currentMoEntry(value)?.name || value
		else {
			const [faction, die] = value.split(":")
			token.className = dieElement(faction, die).className
			token.textContent = die
			token.title = `骰点 ${die}`
			token.setAttribute("role", "img")
			token.setAttribute("aria-label", `骰点 ${die}`)
		}
		if (kind !== "die") {
			token.type = "button"
			token.addEventListener("pointerenter", () => highlightLogReference(kind, value, true))
			token.addEventListener("pointerleave", () => highlightLogReference(kind, value, false))
			token.addEventListener("click", () => activateLogReference(kind, value))
		}
		element.append(token)
		start = match.index + match[0].length
	}
	element.append(document.createTextNode(text.slice(start)))
}

let logGroupFaction = null
let logGroupIndex = 0

function resetLogGroup() {
	logGroupFaction = null
	logGroupIndex = 0
}

function onLog(text, index = 0) {
	const element = document.createElement("div")
	let content = String(text || "")
	if (Number.isInteger(index) && index < logGroupIndex) resetLogGroup()

	if (content.startsWith(">>")) {
		element.className = "i detail align"
		content = content.slice(2).trimStart()
	} else if (content.startsWith(">")) {
		element.className = "i detail"
		content = content.slice(1).trimStart()
	}

	if (content.startsWith("*") && !content.startsWith("**")) {
		content = content.slice(1).trimStart()
		element.classList.add("bold")
	}

	if (content.startsWith("!")) {
		content = `❗ ${content.slice(1)}`
	} else if (content.startsWith("#ap")) {
		content = content.slice(3).trimStart()
		element.className = "h4"
		logGroupFaction = "ap"
		logGroupIndex = Number.isInteger(index) ? index : 0
	} else if (content.startsWith("#cp")) {
		content = content.slice(3).trimStart()
		element.className = "h4"
		logGroupFaction = "cp"
		logGroupIndex = Number.isInteger(index) ? index : 0
	} else if (content.startsWith(".h1")) {
		resetLogGroup()
		element.className = "h1"
		content = content.slice(3).trimStart()
	} else if (content.startsWith(".h2")) {
		resetLogGroup()
		element.className = "h2"
		content = content.slice(3).trimStart()
	} else if (content.startsWith(".h3ap")) {
		resetLogGroup()
		element.className = "h3 ap"
		content = content.slice(6).trimStart()
	} else if (content.startsWith(".h3cp")) {
		resetLogGroup()
		element.className = "h3 cp"
		content = content.slice(6).trimStart()
	} else if (content.startsWith(".h3")) {
		resetLogGroup()
		element.className = "h3"
		content = content.slice(3).trimStart()
	}

	if (!content) resetLogGroup()
	if (logGroupFaction) element.classList.add("group", logGroupFaction)
	appendLogText(element, content)
	return element
}

function onUpdate() {
	if (!window.view) return
	const activeFaction = factionCode(view.active)
	document.body.classList.toggle("active-ap", activeFaction === "ap")
	document.body.classList.toggle("active-cp", activeFaction === "cp")
	resolveTrackSnapshotProbe()
	if (!replayPosition()) trackLatestTurn = Math.max(trackLatestTurn, Number(view.turn) || 1)
	hideActivationMenu()
	hideCardMenu()
	targetIndex = EogActionProtocol.indexTargets(view.actions || {})
	renderStatus()
	renderRoles()
	renderSpaces()
	renderControls()
	renderMarkers()
	updatePieceScene()
	renderActions()
	renderHand()
	renderMoPanel()
	renderCombatCards()
	renderToolbarState()
	renderOpenInfoWindows()
}

window.on_update = onUpdate
window.on_log = onLog
window.on_reply = onReply

document.addEventListener("DOMContentLoaded", () => {
	const fitKey = `${window.params?.title_id || "end-of-glory"}/map-fit`
	if (window.innerWidth > 800 && !localStorage.getItem(fitKey)) toggle_zoom()
	const toolbar = byId("toolbar")
	const mainMenu = toolbar.querySelector(":scope > details:not([id])")
	const ordered = [
		mainMenu,
		byId("chat_button"),
		byId("log_button"),
		byId("zoom_button"),
		byId("stack-menu"),
		byId("info-menu"),
		byId("supply-menu"),
		byId("track-button"),
		byId("piece-button")
	]
	for (const element of ordered) if (element) toolbar.append(element)
	if (byId("chat_button")) {
		byId("chat_button").title = "聊天"
		byId("chat_button").setAttribute("aria-label", "聊天")
	}
	if (byId("zoom_button")) {
		byId("zoom_button").title = "地图缩放"
		byId("zoom_button").setAttribute("aria-label", "地图缩放")
	}
	if (byId("log_button")) {
		byId("log_button").title = "日志"
		byId("log_button").setAttribute("aria-label", "日志")
	}

	const preferenceKey = window.params?.title_id || "end-of-glory"
	initializeInfoWindows()
	setCounterStyle(localStorage.getItem(`${preferenceKey}/style`) || "bevel")
	setMouseFocus(localStorage.getItem(`${preferenceKey}/mouse-focus`) === "1")
	byId("show-score").addEventListener("click", () => showInfo("score"))
	byId("show-ap-cards").addEventListener("click", () => showInfo("ap_cards"))
	byId("show-cp-cards").addEventListener("click", () => showInfo("cp_cards"))
	byId("show-reinforcements").addEventListener("click", () => showInfo("reinforcements"))
	byId("mouse-focus-item").addEventListener("click", () => setMouseFocus())
	byId("style-bevel-item").addEventListener("click", () => setCounterStyle("bevel"))
	byId("style-flat-item").addEventListener("click", () => setCounterStyle("flat"))
	byId("flag-supply-warnings").addEventListener("click", () => {
		if (actionValue("flag_supply_warnings") === 1) perform("flag_supply_warnings")
	})
	byId("propose-rollback").addEventListener("click", openRollbackDialog)
	byId("report-bug").addEventListener("click", () => byId("bug-report-dialog").showModal())
	byId("show-ap-supply").addEventListener("click", () => requestSupplyOverlay("ap"))
	byId("show-cp-supply").addEventListener("click", () => requestSupplyOverlay("cp"))
	byId("track-button").addEventListener("click", () => showInfo("track"))
	byId("piece-button").addEventListener("click", toggleCounters)
	byId("rollback-form").addEventListener("submit", (event) => {
		event.preventDefault()
		const index = Number(byId("rollback-checkpoint").value)
		byId("rollback-dialog").close()
		perform("propose_rollback", index)
	})
	byId("bug-report-form").addEventListener("submit", submitBugReport)
	for (const close of document.querySelectorAll("[data-close]"))
		close.addEventListener("click", () => close.closest("dialog").close())
	document.addEventListener("pointerdown", (event) => {
		if (!event.target.closest("#activation-popup, .space, .piece")) hideActivationMenu()
		if (!event.target.closest("#card-popup, .card-thumb")) hideCardMenu()
		if (!event.target.closest("#activation-popup, .piece-stack")) blurStack()
	})
	byId("card-popup").addEventListener("mouseleave", hideCardMenu)
	byId("activation-popup").addEventListener("pointerdown", (event) => event.stopPropagation())
	byId("card-popup").addEventListener("pointerdown", (event) => event.stopPropagation())
	window.visualViewport?.addEventListener("resize", closeTransientMenus)
	window.visualViewport?.addEventListener("scroll", closeTransientMenus)
	window.addEventListener("orientationchange", closeTransientMenus)
	onUpdate()
})
