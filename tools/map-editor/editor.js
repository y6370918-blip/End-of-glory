"use strict"

/* global EogMapEditorDiff */

const EDITOR_PROTOCOL = 4

let source
let original
let mode = "spaces"
let selected = null
let edgeStart = null
let selectedRegion = "all"
let zoom = 0.5
let saving = false
let operationMessage = ""
let operationError = false
let placingSpace = null

const byId = (id) => document.getElementById(id)
const clone = (value) => JSON.parse(JSON.stringify(value))
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const edgeKey = (a, b) => [a, b].sort().join("|")
const spaceById = (id) => source.spaces.find((space) => space.id === id)
const formalSpace = (id) => source.formal.spaces.find((space) => space.id === id)
const edgeByKey = (key) => source.edges.find((edge) => edgeKey(edge.a, edge.b) === key)
const formalEdge = (key) => source.formal.edges.find((edge) => edgeKey(edge.a, edge.b) === key)

function regionRecord(id) {
	return source.mapAudit.region_reviews[id]
}

function auditSpace(id) {
	return source.mapAudit.spaces[id]
}

function auditEdge(keyOrEdge) {
	const key = typeof keyOrEdge === "string" ? keyOrEdge : edgeKey(keyOrEdge.a, keyOrEdge.b)
	return source.mapAudit.edges[key]
}

function resetRegionReviews(regions) {
	for (const region of regions) source.mapAudit.region_reviews[region] = { status: "pending", revision: null }
}

function regionsForEndpoints(a, b) {
	return [...new Set([auditSpace(a)?.region, auditSpace(b)?.region].filter(Boolean))].sort()
}

function syncSpaceProposal(space) {
	const record = auditSpace(space.id)
	const formal = formalSpace(space.id)
	if (same(space, formal)) {
		record.decision = "keep"
		delete record.proposal
	} else {
		record.decision = formal ? "update" : "add"
		record.proposal = formal ? { ui: clone(space.ui) } : clone(space)
	}
	record.status = "pending"
	resetRegionReviews([record.region])
}

function cancelNewSpace(id) {
	if (formalSpace(id)) return
	const connected = source.edges.filter((edge) => edge.a === id || edge.b === id)
	if (connected.length) {
		operationMessage = `先删除 ${connected.length} 条关联连接，再取消新地块。`
		operationError = true
		renderAuditStatus()
		return
	}
	source.spaces = source.spaces.filter((space) => space.id !== id)
	delete source.mapAudit.spaces[id]
	selected = null
	operationMessage = `已取消新地块草稿：${id}`
	operationError = false
	byId("selection").textContent = "点击地图对象进行编辑。"
	render()
}

function beginCreateSpace() {
	if (selectedRegion === "all") {
		operationMessage = "请先选择新地块所属区域。"
		operationError = true
		renderAuditStatus()
		return
	}
	const dialog = byId("space-dialog")
	const form = byId("space-form")
	form.reset()
	form.elements.width.value = 184
	form.elements.height.value = 184
	form.elements.faction.value = "ap"
	form.elements.control.value = "ap"
	dialog.showModal()
}

function prepareSpacePlacement(event) {
	event.preventDefault()
	const form = event.currentTarget
	if (!form.reportValidity()) return
	const id = form.elements.id.value.trim()
	if (spaceById(id) || source.mapAudit.spaces[id]) {
		form.elements.id.setCustomValidity("ID已经存在")
		form.elements.id.reportValidity()
		return
	}
	form.elements.id.setCustomValidity("")
	placingSpace = {
		id,
		name: form.elements.name.value.trim(),
		nation: form.elements.nation.value,
		faction: form.elements.faction.value,
		terrain: form.elements.terrain.value,
		supply: form.elements.supply.checked,
		port: form.elements.port.checked,
		ui: { x: 0, y: 0, w: Number(form.elements.width.value), h: Number(form.elements.height.value) },
		control: form.elements.control.value
	}
	const fort = Number(form.elements.fort.value)
	if (fort) placingSpace.fort = fort
	if (form.elements.large_area.checked) placingSpace.large_area = true
	byId("space-dialog").close()
	byId("placement-layer").hidden = false
	operationMessage = `在地图上点击 ${id} 的中心位置。`
	operationError = false
	renderAuditStatus()
}

function placeNewSpace(event) {
	if (!placingSpace || event.target.closest(".space-object") || event.target.closest(".edge-hit")) return
	event.stopPropagation()
	const rect = byId("board").getBoundingClientRect()
	placingSpace.ui.x = Math.max(placingSpace.ui.w / 2, Math.min(6082 - placingSpace.ui.w / 2, Math.round((event.clientX - rect.left) / zoom)))
	placingSpace.ui.y = Math.max(placingSpace.ui.h / 2, Math.min(6000 - placingSpace.ui.h / 2, Math.round((event.clientY - rect.top) / zoom)))
	const space = placingSpace
	placingSpace = null
	byId("placement-layer").hidden = true
	source.spaces.push(space)
	source.mapAudit.spaces[space.id] = {
		region: selectedRegion,
		status: "pending",
		decision: "add",
		proposal: clone(space),
		note: "",
		evidence: ""
	}
	resetRegionReviews([selectedRegion])
	operationMessage = `已创建地块草稿：${space.id}`
	operationError = false
	inspectSpace(space)
	changedSummary()
}

function ensureEdgeRecord(edge) {
	const key = edgeKey(edge.a, edge.b)
	if (!source.mapAudit.edges[key]) source.mapAudit.edges[key] = {
		regions: regionsForEndpoints(edge.a, edge.b),
		confirmed_regions: [],
		status: "pending",
		decision: "add",
		proposal: clone(edge)
	}
	return source.mapAudit.edges[key]
}

function syncEdgeProposal(edge) {
	const key = edgeKey(edge.a, edge.b)
	const record = ensureEdgeRecord(edge)
	const formal = formalEdge(key)
	if (same(edge, formal)) {
		record.decision = "keep"
		delete record.proposal
	} else {
		record.decision = formal ? "update" : "add"
		record.proposal = clone(edge)
	}
	record.confirmed_regions = []
	record.status = "pending"
	resetRegionReviews(record.regions)
}

function removeEdge(key) {
	const current = edgeByKey(key)
	const record = auditEdge(key) || ensureEdgeRecord(current || formalEdge(key))
	source.edges = source.edges.filter((edge) => edgeKey(edge.a, edge.b) !== key)
	record.decision = "remove"
	record.proposal = clone(current || formalEdge(key))
	record.confirmed_regions = []
	record.status = "pending"
	resetRegionReviews(record.regions)
	selected = { kind: "edge", key }
	render()
	inspectEdge(formalEdge(key) || current)
}

function restoreEdge(key) {
	const formal = formalEdge(key)
	const record = auditEdge(key)
	if (!formal) {
		delete source.mapAudit.edges[key]
		selected = null
		return
	}
	if (!edgeByKey(key)) source.edges.push(clone(formal))
	record.decision = "keep"
	delete record.proposal
	record.confirmed_regions = []
	record.status = "pending"
	resetRegionReviews(record.regions)
}

function readonly(label, value) {
	const row = document.createElement("div")
	row.className = "readonly"
	row.textContent = `${label}：${value ?? "—"}`
	return row
}

function field(label, value, update) {
	const wrapper = document.createElement("label")
	const name = document.createElement("span")
	name.textContent = label
	const input = document.createElement("input")
	input.type = "number"
	input.value = value
	input.addEventListener("change", () => { update(Number(input.value)); render(); changedSummary() })
	wrapper.append(name, input)
	return wrapper
}

function textField(label, value, update) {
	const wrapper = document.createElement("label")
	const name = document.createElement("span")
	name.textContent = label
	const input = document.createElement("input")
	input.value = value
	input.addEventListener("change", () => { update(input.value.trim()); render(); changedSummary() })
	wrapper.append(name, input)
	return wrapper
}

function booleanField(label, value, update) {
	const wrapper = document.createElement("label")
	const name = document.createElement("span")
	name.textContent = label
	const input = document.createElement("input")
	input.type = "checkbox"
	input.checked = value
	input.addEventListener("change", () => { update(input.checked); render(); changedSummary() })
	wrapper.append(name, input)
	return wrapper
}

function choiceField(label, value, choices, update) {
	const wrapper = document.createElement("label")
	const name = document.createElement("span")
	name.textContent = label
	const select = document.createElement("select")
	for (const choice of choices) {
		const option = document.createElement("option")
		option.value = choice
		option.textContent = choice
		option.selected = choice === value
		select.append(option)
	}
	select.addEventListener("change", () => { update(select.value); render(); changedSummary() })
	wrapper.append(name, select)
	return wrapper
}

function riverDirection(edge) {
	if (edge.river === true) return "both"
	if (edge.river_from === edge.a) return "a_to_b"
	if (edge.river_from === edge.b) return "b_to_a"
	return "none"
}

function riverDirectionField(edge, edit) {
	const wrapper = document.createElement("label")
	const name = document.createElement("span")
	name.textContent = "跨河方向"
	const select = document.createElement("select")
	const choices = [
		["none", "无"],
		["both", "双向"],
		["a_to_b", `${edge.a} → ${edge.b}`],
		["b_to_a", `${edge.b} → ${edge.a}`]
	]
	for (const [value, label] of choices) {
		const option = document.createElement("option")
		option.value = value
		option.textContent = label
		option.selected = value === riverDirection(edge)
		select.append(option)
	}
	select.addEventListener("change", () => edit((target) => {
		delete target.river
		delete target.river_from
		if (select.value === "both") target.river = true
		if (select.value === "a_to_b") target.river_from = target.a
		if (select.value === "b_to_a") target.river_from = target.b
	}))
	wrapper.append(name, select)
	return wrapper
}

function checks(label, values, choices, update) {
	const wrapper = document.createElement("section")
	const title = document.createElement("strong")
	title.textContent = label
	const list = document.createElement("div")
	list.className = "checks"
	for (const choice of choices) {
		const item = document.createElement("label")
		const input = document.createElement("input")
		input.type = "checkbox"
		input.checked = values.includes(choice)
		input.addEventListener("change", () => update(choice, input.checked))
		item.append(input, edgeOptionLabel(choice))
		list.append(item)
	}
	wrapper.append(title, list)
	return wrapper
}

const EDGE_OPTION_LABELS = Object.freeze({
	move: "移动",
	attack: "进攻",
	supply: "补给",
	sr: "战略转移",
	retreat: "撤退",
	advance: "挺进",
	ap: "协约国",
	cp: "同盟国",
	difficult: "困难道路",
	alpine: "高山道路",
	river: "跨河",
	requires_land_attack_support: "海峡进攻需陆上来源"
})

function edgeOptionLabel(value) {
	return EDGE_OPTION_LABELS[value] || value
}

function auditControls(record, kind) {
	const box = document.createElement("div")
	box.className = `audit-record ${record.status}`
	const status = document.createElement("div")
	const local = kind === "edge" ? `；本区${record.confirmed_regions?.includes(selectedRegion) ? "已" : "未"}确认` : ""
	status.textContent = `审计：${record.status} / ${record.decision}${local}`
	const notes = document.createElement("textarea")
	notes.placeholder = "审核备注"
	notes.value = record.note || ""
	notes.addEventListener("change", () => { record.note = notes.value.trim(); changedSummary() })
	const evidence = document.createElement("textarea")
	evidence.placeholder = "印刷地图证据或裁定说明"
	evidence.value = record.evidence || ""
	evidence.addEventListener("change", () => { record.evidence = evidence.value.trim(); changedSummary() })
	box.append(status, notes, evidence)
	return box
}

function inspectSpace(space) {
	selected = { kind: "space", id: space.id }
	const box = byId("selection")
	const neighbors = source.edges
		.filter((edge) => edge.a === space.id || edge.b === space.id)
		.sort((a, b) => edgeKey(a.a, a.b).localeCompare(edgeKey(b.a, b.b)))
	const neighborBox = document.createElement("div")
	neighborBox.className = "neighbor-list"
	for (const edge of neighbors) {
		const key = edgeKey(edge.a, edge.b)
		const other = edge.a === space.id ? edge.b : edge.a
		const row = document.createElement("div")
		row.className = "neighbor-row"
		const label = document.createElement("span")
		label.textContent = other
		const locate = document.createElement("button")
		locate.className = "small"
		locate.textContent = "连接"
		locate.addEventListener("click", () => { mode = "edges"; setModeButtons(); inspectEdge(edge); render() })
		const remove = document.createElement("button")
		remove.className = "small danger"
		remove.textContent = "删除"
		remove.addEventListener("click", () => removeEdge(key))
		row.append(label, locate, remove)
		neighborBox.append(row)
	}
	const newSpace = !formalSpace(space.id)
	const properties = newSpace ? [
		textField("名称", space.name, (value) => { space.name = value; syncSpaceProposal(space) }),
		choiceField("国籍", space.nation, source.spaceNations, (value) => { space.nation = value; syncSpaceProposal(space) }),
		choiceField("阵营", space.faction, source.spaceFactions, (value) => { space.faction = value; syncSpaceProposal(space) }),
		choiceField("初始控制", space.control, source.spaceFactions, (value) => { space.control = value; syncSpaceProposal(space) }),
		choiceField("地形", space.terrain, source.spaceTerrains, (value) => { space.terrain = value; syncSpaceProposal(space) }),
		choiceField("要塞等级", String(space.fort || 0), ["0", "1", "2", "3"], (value) => {
			if (Number(value)) space.fort = Number(value); else delete space.fort
			syncSpaceProposal(space)
		}),
		booleanField("补给源", space.supply, (value) => { space.supply = value; syncSpaceProposal(space) }),
		booleanField("港口", space.port, (value) => { space.port = value; syncSpaceProposal(space) }),
		booleanField("大型区域", Boolean(space.large_area), (value) => {
			if (value) space.large_area = true; else delete space.large_area
			syncSpaceProposal(space)
		})
	] : [
		readonly("名称", space.name),
		readonly("地形", space.terrain),
		readonly("港口", space.port ? "是" : "否"),
		readonly("补给源", space.supply ? "是" : "否")
	]
	const cancelDraft = document.createElement("button")
	cancelDraft.className = "danger"
	cancelDraft.textContent = "取消新地块草稿"
	cancelDraft.hidden = !newSpace
	cancelDraft.addEventListener("click", () => cancelNewSpace(space.id))
	box.replaceChildren(
		auditControls(auditSpace(space.id), "space"),
		readonly("ID", space.id),
		...properties,
		field("中心X", space.ui.x, (value) => { space.ui.x = value; syncSpaceProposal(space) }),
		field("中心Y", space.ui.y, (value) => { space.ui.y = value; syncSpaceProposal(space) }),
		field("点击宽", space.ui.w, (value) => { space.ui.w = value; syncSpaceProposal(space) }),
		field("点击高", space.ui.h, (value) => { space.ui.h = value; syncSpaceProposal(space) }),
		readonly("当前邻接", neighbors.length),
		neighborBox,
		cancelDraft
	)
	render()
}

function inspectEdge(input) {
	if (!input) return
	const key = edgeKey(input.a, input.b)
	selected = { kind: "edge", key }
	const current = edgeByKey(key)
	const edge = current || clone(input)
	const record = auditEdge(key) || ensureEdgeRecord(edge)
	const edit = (update) => {
		let target = edgeByKey(key)
		if (!target) { target = clone(edge); source.edges.push(target) }
		update(target)
		syncEdgeProposal(target)
		inspectEdge(target)
	}
	const modeChecks = checks("连接模式", edge.modes, source.modes, (value, enabled) => edit((target) => {
		target.modes = enabled ? [...new Set([...target.modes, value])] : target.modes.filter((entry) => entry !== value)
	}))
	const factionChecks = checks("可用阵营", edge.factions, ["ap", "cp"], (value, enabled) => edit((target) => {
		target.factions = enabled ? [...new Set([...target.factions, value])] : target.factions.filter((entry) => entry !== value)
	}))
	const flagChecks = checks("特殊属性", (source.edgeFlags || []).filter((flag) => edge[flag]), source.edgeFlags || [], (value, enabled) => edit((target) => {
		if (enabled) target[value] = true
		else delete target[value]
	}))
	const remove = document.createElement("button")
	remove.className = "danger"
	remove.textContent = current ? "删除这条连接" : "连接已删除；恢复正式连接"
	remove.addEventListener("click", () => {
		if (current) removeEdge(key)
		else { restoreEdge(key); render(); inspectEdge(edgeByKey(key)) }
	})
	byId("selection").replaceChildren(
		auditControls(record, "edge"),
		readonly("连接", `${edge.a} ↔ ${edge.b}`),
		readonly("涉及区域", record.regions.join("、")),
		choiceField("连接类型", edge.type, source.edgeTypes, (value) => edit((target) => {
			target.type = value
		})),
		modeChecks,
		factionChecks,
		riverDirectionField(edge, edit),
		flagChecks,
		remove
	)
	render()
}

function changedSummary() {
	if (!source || !original) return
	const filter = byId("diff-filter").value
	const changes = EogMapEditorDiff.fieldDiff(original, source, filter)
	byId("diff").textContent = changes.map((entry) => `${entry.path}: ${JSON.stringify(entry.before)} → ${JSON.stringify(entry.after)}`).join("\n") || "尚无修改"
}

function saveableChangeCount(regionId = null) {
	const changedSpaces = Object.entries(source.mapAudit.spaces).filter(([id, record]) => {
		if (regionId && record.region !== regionId) return false
		if (!["add", "update", "remove"].includes(record.decision)) return false
		const current = spaceById(id), formal = formalSpace(id)
		return record.decision === "remove" ? Boolean(formal) : !same(current, formal)
	}).length
	const changedEdges = Object.entries(source.mapAudit.edges).filter(([key, record]) => {
		if (regionId && !record.regions.includes(regionId)) return false
		if (!["add", "update", "remove"].includes(record.decision)) return false
		const current = edgeByKey(key), formal = formalEdge(key)
		return record.decision === "remove" ? Boolean(formal) : !same(current, formal)
	}).length
	return changedSpaces + changedEdges
}

function edgeVisible(edge) {
	if (selectedRegion === "all") return true
	return (auditEdge(edge)?.regions || regionsForEndpoints(edge.a, edge.b)).includes(selectedRegion)
}

function edgeClass(edge) {
	const classes = []
	if (edge.difficult) classes.push("edge-difficult")
	if (edge.alpine) classes.push("edge-alpine")
	if (edge.river || edge.river_from) classes.push("edge-river")
	if (edge.factions?.length === 1 && edge.factions[0] === "ap") classes.push("edge-ap-only")
	if (edge.factions?.length === 1 && edge.factions[0] === "cp") classes.push("edge-cp-only")
	if (!edge.modes?.includes("attack")) classes.push("edge-no-attack")
	if (edge.requires_land_attack_support) classes.push("edge-channel")
	return classes.join(" ")
}

function line(svg, edge, className, clickable = false) {
	const a = spaceById(edge.a)?.ui || formalSpace(edge.a)?.ui
	const b = spaceById(edge.b)?.ui || formalSpace(edge.b)?.ui
	if (!a || !b) return
	const value = document.createElementNS("http://www.w3.org/2000/svg", "line")
	value.setAttribute("x1", a.x); value.setAttribute("y1", a.y); value.setAttribute("x2", b.x); value.setAttribute("y2", b.y)
	value.setAttribute("class", className)
	if (edge.river_from) {
		const markerId = `${svg.id}-river-arrow`
		if (!svg.querySelector(`#${markerId}`)) {
			const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs")
			const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker")
			marker.setAttribute("id", markerId)
			marker.setAttribute("viewBox", "0 0 12 12")
			marker.setAttribute("refX", "10")
			marker.setAttribute("refY", "6")
			marker.setAttribute("markerWidth", "34")
			marker.setAttribute("markerHeight", "34")
			marker.setAttribute("orient", "auto-start-reverse")
			marker.setAttribute("markerUnits", "userSpaceOnUse")
			const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path")
			arrow.setAttribute("d", "M 0 0 L 12 6 L 0 12 z")
			arrow.setAttribute("fill", "#28b8ef")
			marker.append(arrow); defs.append(marker); svg.prepend(defs)
		}
		value.setAttribute(edge.river_from === edge.a ? "marker-end" : "marker-start", `url(#${markerId})`)
	}
	if (clickable) value.addEventListener("click", (event) => { event.stopPropagation(); inspectEdge(edge) })
	svg.append(value)
}

function spaceVisible(space) {
	return selectedRegion === "all" || auditSpace(space.id)?.region === selectedRegion || (mode === "edges" && source.edges.some((edge) => edgeVisible(edge) && [edge.a, edge.b].includes(space.id)))
}

function dragSpace(element, space) {
	element.addEventListener("pointerdown", (event) => {
		if (mode !== "spaces" || event.target !== element && !event.target.classList.contains("space-id")) return
		event.stopPropagation()
		element.setPointerCapture(event.pointerId)
		const start = { clientX: event.clientX, clientY: event.clientY, x: space.ui.x, y: space.ui.y }
		let moved = false
		const move = (next) => {
			const dx = (next.clientX - start.clientX) / zoom, dy = (next.clientY - start.clientY) / zoom
			moved ||= Math.abs(dx) > 2 || Math.abs(dy) > 2
			space.ui.x = Math.round(start.x + dx); space.ui.y = Math.round(start.y + dy)
			element.style.left = `${space.ui.x}px`; element.style.top = `${space.ui.y}px`
		}
		const finish = () => {
			element.removeEventListener("pointermove", move)
			if (moved) { syncSpaceProposal(space); changedSummary(); render(); inspectSpace(space) }
		}
		element.addEventListener("pointermove", move)
		element.addEventListener("pointerup", finish, { once: true })
	})
}

function resizeHandle(object, space, direction) {
	const handle = document.createElement("span")
	handle.className = `resize-handle resize-${direction}`
	handle.addEventListener("pointerdown", (event) => {
		event.stopPropagation(); event.preventDefault(); handle.setPointerCapture(event.pointerId)
		const start = { clientX: event.clientX, clientY: event.clientY, ...space.ui }
		const move = (next) => {
			const dx = (next.clientX - start.clientX) / zoom, dy = (next.clientY - start.clientY) / zoom
			let left = start.x - start.w / 2, right = start.x + start.w / 2, top = start.y - start.h / 2, bottom = start.y + start.h / 2
			if (direction.includes("w")) left = Math.min(right - 20, left + dx)
			if (direction.includes("e")) right = Math.max(left + 20, right + dx)
			if (direction.includes("n")) top = Math.min(bottom - 20, top + dy)
			if (direction.includes("s")) bottom = Math.max(top + 20, bottom + dy)
			space.ui.x = Math.round((left + right) / 2); space.ui.y = Math.round((top + bottom) / 2)
			space.ui.w = Math.round(right - left); space.ui.h = Math.round(bottom - top)
			Object.assign(object.style, { left: `${space.ui.x}px`, top: `${space.ui.y}px`, width: `${space.ui.w}px`, height: `${space.ui.h}px` })
		}
		handle.addEventListener("pointermove", move)
		handle.addEventListener("pointerup", () => {
			handle.removeEventListener("pointermove", move); syncSpaceProposal(space); render(); inspectSpace(space); changedSummary()
		}, { once: true })
	})
	object.append(handle)
}

function render() {
	if (!source) return
	const objects = byId("objects"), oldObjects = byId("old-objects"), edges = byId("edges"), oldEdges = byId("old-edges")
	objects.replaceChildren(); oldObjects.replaceChildren(); edges.replaceChildren(); oldEdges.replaceChildren()
	const draftEdges = new Map(source.edges.map((edge) => [edgeKey(edge.a, edge.b), edge]))
	if (byId("layer-current").checked) for (const edge of source.formal.edges.filter(edgeVisible)) {
		const draft = draftEdges.get(edgeKey(edge.a, edge.b))
		line(oldEdges, edge, `formal-edge ${edgeClass(edge)} ${!draft ? "removed" : same(edge, draft) ? "" : "changed"}`)
	}
	for (const edge of source.edges.filter(edgeVisible)) {
		const formal = formalEdge(edgeKey(edge.a, edge.b))
		const changed = !same(edge, formal)
		if ((changed && byId("layer-proposed").checked) || selected?.kind === "edge" && selected.key === edgeKey(edge.a, edge.b))
			line(edges, edge, `edge-visible ${changed ? "" : "unchanged"} ${edgeClass(edge)}${selected?.key === edgeKey(edge.a, edge.b) ? " selected" : ""}`)
		if (mode === "edges") line(edges, edge, "edge-hit", true)
	}
	if (mode === "edges") for (const edge of source.formal.edges.filter((entry) => edgeVisible(entry) && !draftEdges.has(edgeKey(entry.a, entry.b)))) line(edges, edge, "edge-hit", true)

	for (const space of source.spaces.filter(spaceVisible)) {
		const formal = formalSpace(space.id)
		if (formal && !same(formal, space) && byId("layer-proposed").checked) {
			const old = document.createElement("div")
			old.className = "old-space-object"
			Object.assign(old.style, { left: `${formal.ui.x}px`, top: `${formal.ui.y}px`, width: `${formal.ui.w}px`, height: `${formal.ui.h}px` })
			oldObjects.append(old)
		}
		const record = auditSpace(space.id)
		const object = document.createElement("button")
		object.className = `space-object ${record.status}${selected?.kind === "space" && selected.id === space.id ? " selected" : ""}`
		Object.assign(object.style, { left: `${space.ui.x}px`, top: `${space.ui.y}px`, width: `${space.ui.w}px`, height: `${space.ui.h}px` })
		const name = document.createElement("span")
		name.textContent = space.name
		const id = document.createElement("span")
		id.className = "space-id"; id.textContent = space.id
		object.append(name, id)
		if (selected?.kind === "space" && selected.id === space.id && mode === "spaces")
			for (const direction of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) resizeHandle(object, space, direction)
		object.addEventListener("click", (event) => {
			event.stopPropagation()
			if (mode === "spaces") inspectSpace(space)
			else if (!edgeStart) { edgeStart = space.id; byId("selection").textContent = `已选择端点 ${space.id}，点击第二个地块。` }
			else if (edgeStart !== space.id) {
				const key = edgeKey(edgeStart, space.id)
				let edge = edgeByKey(key)
				if (!edge) {
					edge = { a: edgeStart, b: space.id, type: "land", modes: [...source.modes], factions: ["ap", "cp"] }
					source.edges.push(edge); syncEdgeProposal(edge)
				}
				edgeStart = null; inspectEdge(edge)
			}
		})
		dragSpace(object, space)
		objects.append(object)
	}
	byId("board").classList.toggle("hide-names", !byId("layer-names").checked)
	byId("board").classList.toggle("hide-boxes", !byId("layer-boxes").checked)
	byId("map-image").style.display = byId("layer-map").checked ? "block" : "none"
	changedSummary(); renderAuditStatus()
}

function renderAuditStatus() {
	if (!source) return
	const counts = source.mapAuditReport?.counts || {}
	let detail = `待确认区域 ${counts.pending_regions ?? "?"}；地块 ${counts.pending_spaces ?? "?"}；连接 ${counts.pending_edges ?? "?"}`
	const totalChanged = saveableChangeCount()
	if (selectedRegion !== "all") {
		const spaces = Object.values(source.mapAudit.spaces).filter((record) => record.region === selectedRegion)
		const edges = Object.values(source.mapAudit.edges).filter((record) => record.regions.includes(selectedRegion))
		const confirmedSpaces = spaces.filter((record) => record.status === "confirmed").length
		const confirmedEdges = edges.filter((record) => record.confirmed_regions.includes(selectedRegion)).length
		detail += `\n本区地块 ${confirmedSpaces}/${spaces.length}；连接 ${confirmedEdges}/${edges.length}；区域状态 ${regionRecord(selectedRegion).status}`
		detail += `\n本区修改 ${saveableChangeCount(selectedRegion)} 项。`
	}
	detail += `\n全部可保存修改 ${totalChanged} 项。`
	byId("save").disabled = saving || totalChanged === 0
	byId("save").title = totalChanged ? "原子提交全部区域修改并重绘核验图" : "没有修改"
	if (operationMessage) detail += `\n${operationMessage}`
	byId("audit-status").textContent = detail
	byId("audit-status").classList.toggle("error", operationError)
	byId("audit-status").classList.toggle("success", Boolean(operationMessage) && !operationError)
}

function setZoom(value, center = null) {
	const viewport = byId("viewport")
	const old = zoom
	zoom = Math.max(0.2, Math.min(2, value))
	byId("zoom").value = Math.round(zoom * 100)
	byId("zoom-value").value = `${Math.round(zoom * 100)}%`
	byId("board").style.transform = `scale(${zoom})`
	byId("board-shell").style.width = `${6082 * zoom}px`; byId("board-shell").style.height = `${6000 * zoom}px`
	if (center) {
		viewport.scrollLeft = center.x * zoom - center.viewportX
		viewport.scrollTop = center.y * zoom - center.viewportY
	} else if (old !== zoom) {
		viewport.scrollLeft *= zoom / old; viewport.scrollTop *= zoom / old
	}
}

function fitRegion() {
	const viewport = byId("viewport")
	const spaces = source.spaces.filter((space) => selectedRegion === "all" || auditSpace(space.id).region === selectedRegion)
	if (!spaces.length) return
	const margin = 180
	const left = Math.max(0, Math.min(...spaces.map((space) => space.ui.x - space.ui.w / 2)) - margin)
	const top = Math.max(0, Math.min(...spaces.map((space) => space.ui.y - space.ui.h / 2)) - margin)
	const right = Math.min(6082, Math.max(...spaces.map((space) => space.ui.x + space.ui.w / 2)) + margin)
	const bottom = Math.min(6000, Math.max(...spaces.map((space) => space.ui.y + space.ui.h / 2)) + margin)
	const value = Math.min((viewport.clientWidth - 30) / (right - left), (viewport.clientHeight - 30) / (bottom - top), 2)
	setZoom(value)
	viewport.scrollLeft = left * zoom; viewport.scrollTop = top * zoom
}

function setModeButtons() {
	document.querySelectorAll("nav button").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode))
}

async function load() {
	const payload = await globalThis.fetch("/api/source").then((response) => response.json())
	if (payload.editorProtocol !== EDITOR_PROTOCOL) {
		operationMessage = "编辑器服务器仍是旧版本。请在终端停止它，重新运行 npm run editor:map，然后刷新页面。"
		operationError = true
		byId("audit-status").textContent = operationMessage
		byId("audit-status").classList.add("error")
		for (const id of ["create-space", "audit", "save"]) byId(id).disabled = true
		byId("selection").textContent = "服务器版本不一致，当前页面禁止编辑。"
		return
	}
	source = payload
	source.spaceNations ||= [...new Set(source.spaces.map((space) => space.nation).filter(Boolean))]
	source.spaceFactions ||= ["ap", "cp"]
	source.spaceTerrains ||= [...new Set(source.spaces.map((space) => space.terrain).filter(Boolean))]
	original = { spaces: clone(payload.formal.spaces), edges: clone(payload.formal.edges), ui: clone(payload.formal.ui), mapAudit: clone(payload.mapAudit) }
	const filter = byId("region-filter")
	const option = (label, value) => {
		const element = document.createElement("option")
		element.textContent = label; element.value = value
		return element
	}
	filter.replaceChildren(option("全图", "all"))
	for (const region of source.mapAudit.regions) filter.append(option(region.name, region.id))
	filter.value = selectedRegion
	const form = byId("space-form")
	const fillChoices = (name, values) => {
		const select = form.elements[name]
		select.replaceChildren(...values.map((value) => option(value, value)))
	}
	fillChoices("nation", source.spaceNations)
	fillChoices("faction", source.spaceFactions)
	fillChoices("control", source.spaceFactions)
	fillChoices("terrain", source.spaceTerrains)
	selected = null; edgeStart = null
	byId("selection").textContent = "点击地图对象进行编辑。"
	render(); fitRegion()
}

async function audit(save = false) {
	saving = save; operationError = false
	operationMessage = save ? "正在原子保存全部区域修改并生成核验图……" : "正在审计草稿……"
	renderAuditStatus()
	try {
		const response = await globalThis.fetch(save ? "/api/save" : "/api/audit", {
			method: save ? "PUT" : "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...source, baseRevision: source.baseRevision, region: selectedRegion })
		})
		const report = await response.json()
		byId("report").textContent = JSON.stringify(report, null, 2)
		if (save && report.ok) {
			source = report
			original = { spaces: clone(report.formal.spaces), edges: clone(report.formal.edges), ui: clone(report.formal.ui), mapAudit: clone(report.mapAudit) }
			selected = null; byId("selection").textContent = "全部修改已保存。"
			operationMessage = report.render?.ok ? "保存成功，tmp/map-audit 已更新。" : "保存成功，但核验图生成失败；请查看审计结果。"
			operationError = !report.render?.ok
		} else if (save) {
			const detail = report.errors?.filter(Boolean).join("\n") || "审计未通过"
			operationMessage = `保存失败：${detail}`
			operationError = true
		} else {
			operationMessage = report.ok ? "草稿审计通过。" : `草稿审计失败：${report.errors?.[0] || "未知错误"}`
			operationError = !report.ok
		}
	} catch (error) {
		operationMessage = `${save ? "保存" : "审计"}失败：${error.message}`
		operationError = true
	} finally {
		saving = false
		render()
	}
}

function installPanAndZoom() {
	const viewport = byId("viewport")
	viewport.addEventListener("pointerdown", (event) => {
		if (placingSpace || event.button !== 0 || event.target.closest("button, input, select, textarea, .edge-hit")) return
		viewport.classList.add("panning"); viewport.setPointerCapture(event.pointerId)
		const start = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }
		const move = (next) => { viewport.scrollLeft = start.left - (next.clientX - start.x); viewport.scrollTop = start.top - (next.clientY - start.y) }
		viewport.addEventListener("pointermove", move)
		viewport.addEventListener("pointerup", () => { viewport.removeEventListener("pointermove", move); viewport.classList.remove("panning") }, { once: true })
	})
	viewport.addEventListener("wheel", (event) => {
		if (!event.ctrlKey) return
		event.preventDefault()
		const rect = viewport.getBoundingClientRect()
		const viewportX = event.clientX - rect.left, viewportY = event.clientY - rect.top
		const x = (viewport.scrollLeft + viewportX) / zoom, y = (viewport.scrollTop + viewportY) / zoom
		setZoom(zoom * (event.deltaY < 0 ? 1.1 : 0.9), { x, y, viewportX, viewportY })
	}, { passive: false })
}

document.addEventListener("DOMContentLoaded", () => {
	for (const button of document.querySelectorAll("nav button")) button.addEventListener("click", () => {
		mode = button.dataset.mode; selected = null; edgeStart = null; setModeButtons()
		byId("selection").textContent = mode === "edges" ? "依次点击两个地块，或直接点击连线。" : "点击地块进行编辑。"
		render()
	})
	byId("reload").addEventListener("click", load)
	byId("create-space").addEventListener("click", beginCreateSpace)
	byId("cancel-create-space").addEventListener("click", () => byId("space-dialog").close())
	byId("space-form").addEventListener("submit", prepareSpacePlacement)
	byId("placement-layer").addEventListener("click", placeNewSpace)
	byId("audit").addEventListener("click", () => audit(false))
	byId("save").addEventListener("click", () => audit(true))
	byId("fit-region").addEventListener("click", fitRegion)
	byId("diff-filter").addEventListener("change", changedSummary)
	byId("region-filter").addEventListener("change", (event) => { selectedRegion = event.target.value; selected = null; edgeStart = null; render(); fitRegion() })
	byId("zoom").addEventListener("input", (event) => setZoom(Number(event.target.value) / 100))
	byId("map-opacity").addEventListener("input", (event) => { byId("map-image").style.opacity = Number(event.target.value) / 100 })
	for (const id of ["layer-map", "layer-boxes", "layer-names", "layer-current", "layer-proposed"]) byId(id).addEventListener("change", render)
	installPanAndZoom()
	load()
})
