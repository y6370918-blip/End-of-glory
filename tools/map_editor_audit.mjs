export const EDITOR_MODES = Object.freeze(["move", "attack", "supply", "sr", "retreat", "advance"])
export const EDITOR_EDGE_TYPES = Object.freeze(["land"])
export const EDITOR_EDGE_FLAGS = Object.freeze(["difficult", "alpine", "requires_land_attack_support"])
export const EDITOR_TERRAINS = Object.freeze(["clear", "forest", "fort", "mountain", "swamp", "alpine"])
export const EDITOR_NATIONS = Object.freeze(["ah", "be", "br", "fr", "ge", "it", "lu"])
export const EDITOR_FACTIONS = Object.freeze(["ap", "cp"])

export function auditSpaceDefinition(space) {
	const errors = []
	const id = space?.id || "?"
	if (typeof space?.id !== "string" || !/^[a-z][a-z0-9_]*$/.test(space.id)) errors.push(`地区ID无效：${id}`)
	if (typeof space?.name !== "string" || !space.name.trim()) errors.push(`${id} 缺少名称`)
	if (!EDITOR_NATIONS.includes(space?.nation)) errors.push(`${id} 国籍无效`)
	if (!EDITOR_FACTIONS.includes(space?.faction)) errors.push(`${id} 阵营无效`)
	if (!EDITOR_FACTIONS.includes(space?.control)) errors.push(`${id} 初始控制无效`)
	if (!EDITOR_TERRAINS.includes(space?.terrain)) errors.push(`${id} 地形无效`)
	if (typeof space?.supply !== "boolean") errors.push(`${id} supply必须为布尔值`)
	if (typeof space?.port !== "boolean") errors.push(`${id} port必须为布尔值`)
	if (space?.fort != null && (!Number.isInteger(space.fort) || space.fort < 1 || space.fort > 3)) errors.push(`${id} 要塞等级必须为1–3`)
	if (space?.large_area != null && typeof space.large_area !== "boolean") errors.push(`${id} large_area必须为布尔值`)
	for (const property of Object.keys(space || {}))
		if (!["id", "name", "nation", "faction", "terrain", "supply", "port", "ui", "fort", "large_area", "control"].includes(property))
			errors.push(`${id} 未知地块属性：${property}`)
	for (const key of ["x", "y", "w", "h"])
		if (!Number.isFinite(space?.ui?.[key])) errors.push(`${id} 缺少 ui.${key}`)
	if (space?.ui && (space.ui.w <= 0 || space.ui.h <= 0)) errors.push(`${id} 点击框尺寸必须大于0`)
	if (space?.ui && (space.ui.x - space.ui.w / 2 < 0 || space.ui.x + space.ui.w / 2 > 6082 || space.ui.y - space.ui.h / 2 < 0 || space.ui.y + space.ui.h / 2 > 6000))
		errors.push(`${id} 点击框超出6082×6000地图`)
	return errors
}

export function auditMapSource(spaces, edges, ui) {
	const errors = []
	const ids = new Set()
	for (const space of spaces) {
		if (!space?.id || ids.has(space.id)) errors.push(`重复或无效地区ID：${space?.id}`)
		ids.add(space.id)
		errors.push(...auditSpaceDefinition(space))
	}
	const edgeKeys = new Set()
	for (const edge of edges) {
		if (!ids.has(edge.a) || !ids.has(edge.b)) errors.push(`连接端点无效：${edge.a}-${edge.b}`)
		if (edge.a === edge.b) errors.push(`连接不能指向自身：${edge.a}`)
		const key = [edge.a, edge.b].sort().join("|")
		if (edgeKeys.has(key)) errors.push(`重复连接：${edge.a}-${edge.b}`)
		edgeKeys.add(key)
		if (!EDITOR_EDGE_TYPES.includes(edge.type)) errors.push(`连接类型无效：${edge.a}-${edge.b}`)
		if (!Array.isArray(edge.modes) || edge.modes.some((mode) => !EDITOR_MODES.includes(mode)))
			errors.push(`连接模式无效：${edge.a}-${edge.b}`)
		else if (new Set(edge.modes).size !== edge.modes.length) errors.push(`连接模式重复：${edge.a}-${edge.b}`)
		if (!Array.isArray(edge.factions) || edge.factions.some((faction) => !["ap", "cp"].includes(faction)))
			errors.push(`连接阵营无效：${edge.a}-${edge.b}`)
		else if (new Set(edge.factions).size !== edge.factions.length) errors.push(`连接阵营重复：${edge.a}-${edge.b}`)
		for (const flag of EDITOR_EDGE_FLAGS)
			if (edge[flag] != null && typeof edge[flag] !== "boolean") errors.push(`连接属性 ${flag} 必须为布尔值：${edge.a}-${edge.b}`)
		if (edge.river != null && typeof edge.river !== "boolean") errors.push(`连接属性 river 必须为布尔值：${edge.a}-${edge.b}`)
		if (edge.river_from != null && ![edge.a, edge.b].includes(edge.river_from))
			errors.push(`跨河起点必须是连接端点：${edge.a}-${edge.b}`)
		if (edge.river === true && edge.river_from != null)
			errors.push(`连接不能同时设置双向跨河和单向跨河：${edge.a}-${edge.b}`)
		for (const property of Object.keys(edge))
			if (!["a", "b", "type", "modes", "factions", "river", "river_from", ...EDITOR_EDGE_FLAGS].includes(property)) errors.push(`未知连接属性 ${property}：${edge.a}-${edge.b}`)
	}
	for (const [track, spec] of Object.entries(ui?.tracks || {}))
		for (const [index, slot] of (spec.slots || []).entries())
			if (!Array.isArray(slot) || slot.length !== 2 || slot[0] < 0 || slot[0] > 6082 || slot[1] < 0 || slot[1] > 6000)
				errors.push(`轨道 ${track} 槽位 ${index} 越界`)
	return { ok: errors.length === 0, errors, counts: { spaces: spaces.length, edges: edges.length, tracks: Object.keys(ui?.tracks || {}).length } }
}
