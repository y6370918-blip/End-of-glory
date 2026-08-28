import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sourceDir = path.join(root, "data", "source")
fs.mkdirSync(sourceDir, { recursive: true })
const ocrFile = path.join(root, "data", "generated", "card_ocr.json")
const ocrById = fs.existsSync(ocrFile)
	? new Map(JSON.parse(fs.readFileSync(ocrFile, "utf8")).map((record) => [record.id, record]))
	: new Map()
const cardTextCorrections = new Map([
	[623, "土耳其战线+2，-1VP。\n本回合+2BR:RP。\n增强“皮亚韦河防线”。"],
	[643, "禁止/撤销“U艇攻势”。\n-1VP。\n每个海军阶段，AP额外获得1点海军点数。若在海军阶段事件本牌，获得4点海军点数。"],
	[644, "允许“罗马尼亚参战”。\n俄国战线-2。"],
	[654, "进攻意大利战场的要塞时，要塞火力-1（包括战斗结算摧毁要塞）。"],
	[
		731,
		"本次AP进攻，若仅存在英国/印度/英联邦/比利时战斗单位，以SCU火力表开火；否则若存在上述单位，左移一列。战斗结束后弃置本牌。"
	],
	[
		737,
		"允许“皇帝攻势”“兴登堡防线”。\n在德国MO池加入“无/德国进攻+1 DRM×2”。\n俄国战线+1。每回合仅需完成一个德国MO（仍抽取2个；可都完成）。\n每回合可以额外花费5.5点EAST:RP再推动一格俄国战线。"
	],
	[754, "俄国战线+1，或者获得2点GE:RP立刻使用。"]
])

function write(name, value) {
	if (["spaces.json", "edges.json"].includes(name)) {
		console.log(`Preserved manually audited ${name}; seed_source_data.mjs cannot overwrite map data.`)
		return
	}
	fs.writeFileSync(path.join(sourceDir, name), JSON.stringify(value, null, 2) + "\n")
}

const apTitles = [
	"[1] 战争援助",
	"抽调地区军/轮换兵役制",
	"战略撤退",
	"[2] 英国增援-远征军",
	"[1/0] 英国增援-基钦纳志愿军",
	"[1/0] 英国增援-基钦纳志愿军",
	"[1] 皇家海军封锁",
	"法国增援-预备军",
	"战壕与防御工事",
	"马恩河奇迹",
	"伊普尔阻击",
	"[1] 洗劫比利时",
	"伊瑟河决堤",
	"征服德国殖民地",
	"小毛奇",
	"[1/0] 法国增援-毛茸茸的胡茬",
	"[1/0] 法国增援-外籍军团",
	"英国增援-英联邦军团",
	"英国增援-征召军",
	"英国增援-老友军",
	"第二次香槟攻势",
	"空中优势",
	"徐进弹幕",
	"劳合乔治",
	"[1] 索姆河战役",
	"[2] 意大利参战",
	"[1] 丘吉尔",
	"[1] 卡多尔纳",
	"[1] 阿图瓦攻势",
	"坑道攻击",
	"国内政客掣肘",
	"他们无法通过",
	"陆上军舰",
	"康拉德/锈蚀宝剑",
	"[1/0] 全体投入战斗",
	"大流感",
	"[1] 艾伦比",
	"皮亚韦河防线",
	"康布雷战役",
	"阿尔卑斯山地军",
	"皇家坦克军",
	"阿尔曼多·迪亚兹",
	"[1] 希腊参战",
	"[1] 护航",
	"[1] 勃鲁西洛夫攻势",
	"英国增援-后备军",
	"美国远征军",
	"[1] 克里孟梭",
	"[1] 罗马尼亚参战",
	"美国增援-潘兴",
	"美国增援-地狱战士",
	"容克军官",
	"女性劳工",
	"[1] 萨洛尼卡",
	"戈里齐亚！",
	"欧洲病夫/阿拉伯起义",
	"威尔逊",
	"胜利或崩溃",
	"大撤退"
]

const cpTitles = [
	"向大海进军",
	"[1] 八月炮火",
	"德国巨炮",
	"[1] 土耳其参战",
	"[1] 议会妥协-城堡和平",
	"法军进攻学说",
	"[1] 坦能堡的英雄",
	"施里芬计划",
	"战壕与防御工事",
	"目标巴黎！",
	"鲁普雷希特",
	"[1] 法金汉",
	"圣诞节停火",
	"[1] 德军最高统帅部",
	"1914精神",
	"德国增援-预备军",
	"[1] 齐柏林飞艇",
	"德国增援-贝格",
	"[1] 沙皇接管指挥权",
	"黑格",
	"[1/0] 处刑地",
	"福克灾难",
	"战壕机枪",
	"[1] U艇攻势",
	"[1] 德国战争工业",
	"[1] 保加利亚参战",
	"非洲战争",
	"[1] 戈尔利采-塔尔努夫攻势",
	"加里波利/灾难性进攻",
	"毒气",
	"特伦蒂诺奇袭",
	"英国炮弹短缺",
	"博罗耶维奇",
	"塞尔维亚的毁灭",
	"格奈森瑙行动",
	"德国增援-冯贝洛",
	"[1] 兴登堡防线",
	"[1] 兴登堡-鲁登道夫",
	"重回马恩/兰斯战役",
	"尼维尔",
	"[1/0] 米夏埃尔行动",
	"布吕赫穆勒",
	"狩猎中队",
	"[1] 法军兵变",
	"[1/0] 乔其纱行动",
	"布列斯特-立托夫斯克条约",
	"[1] 无限制潜艇战",
	"德国增援-东线军队",
	"[1/0] 布吕歇尔行动",
	"德国增援-东线军队",
	"[1] 麦克斯亲王",
	"意大利声明中立",
	"白羽毛运动/两个世界",
	"弗兰德斯的泥泞",
	"列宁返回俄国",
	"[1] 日德兰海战",
	"逃亡与反战",
	"奥匈帝国德式突击队",
	"凯末尔"
]

const apOps = [
	3, 2, 3, 4, 4, 4, 4, 3, 3, 3, 2, 4, 2, 3, 3, 3, 3, 2, 3, 3, 4, 2, 2, 5, 4, 5, 4, 3, 4, 3, 3, 2,
	4, 4, 5, 3, 3, 4, 3, 2, 4, 3, 3, 4, 4, 3, 4, 3, 4, 5, 5, 2, 2, 4, 2, 3, 2, 2, 3
]
const apSr = [
	4, 2, 4, 4, 4, 4, 4, 4, 4, 4, 2, 4, 2, 4, 4, 4, 4, 2, 4, 4, 4, 2, 2, 5, 4, 5, 4, 4, 4, 4, 4, 2,
	4, 4, 5, 4, 4, 4, 4, 2, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 2, 4, 4, 2, 4, 2, 2, 4
]
const cpOps = [
	3, 3, 2, 4, 4, 3, 4, 3, 3, 2, 3, 4, 2, 4, 4, 3, 4, 3, 4, 3, 4, 3, 2, 3, 5, 5, 3, 4, 4, 2, 3, 3,
	3, 4, 3, 3, 4, 5, 4, 2, 4, 3, 3, 4, 4, 5, 5, 3, 4, 4, 3, 2, 2, 2, 2, 4, 3, 2, 3
]
const cpSr = [
	4, 4, 2, 4, 4, 4, 4, 4, 4, 2, 4, 4, 2, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 4, 5, 5, 4, 4, 4, 2, 4, 4,
	4, 4, 4, 4, 4, 5, 4, 2, 4, 4, 4, 4, 4, 5, 5, 4, 4, 4, 4, 2, 2, 2, 2, 4, 4, 2, 4
]

const blueAp = new Set([603, 606, 613, 617, 623, 626, 633, 636, 641, 643, 646, 649, 653, 656])
const redAp = new Set([602, 609, 610, 612, 620, 621, 622, 629, 631, 654, 658])
const yellowAp = new Set([600, 601, 608, 624, 628, 630, 634, 640, 642, 644, 650, 652, 657])
const blueCp = new Set([703, 706, 713, 716, 723, 726, 728, 736, 746, 750, 755])
const redCp = new Set([702, 709, 710, 712, 714, 721, 722, 729, 731, 732, 739, 741, 742, 743, 753, 757])
const yellowCp = new Set([700, 707, 708, 711, 718, 720, 724, 725, 730, 734, 737, 738, 740, 744, 748, 756])

function slug(text) {
	return text
		.replace(/\[[^\]]+\]/g, "")
		.trim()
		.normalize("NFKD")
		.replace(/[^\p{Letter}\p{Number}]+/gu, "_")
		.replace(/^_+|_+$/g, "")
}

function colorFor(id, sets) {
	if (sets.blue.has(id)) return "blue"
	if (sets.red.has(id)) return "red"
	if (sets.yellow.has(id)) return "yellow"
	return "white"
}

function commitment(faction, index) {
	if (index <= 14) return "mobilization"
	if (faction === "ap") return index <= 33 ? "limited" : "total"
	return index <= 39 ? "limited" : "total"
}

function extractCardEffect(record, title) {
	if (!record?.text) return title
	const lines = record.text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !/^(?:MB|TW|IW|LIW)\b/i.test(line))
	const titleKey = title.replace(/[^\p{Script=Han}]/gu, "").slice(0, 4)
	let start = titleKey ? lines.findIndex((line) => line.replace(/[^\p{Script=Han}]/gu, "").includes(titleKey)) + 1 : 0
	if (start <= 0) start = Math.max(0, lines.findIndex((line) => /[\p{Script=Han}]/u.test(line) && line.length >= 6))
	return lines.slice(start).join("\n").trim() || title
}

function cardRecord(faction, index, title, ops, sr, sets) {
	const id = (faction === "ap" ? 600 : 700) + index
	const color = colorFor(id, sets)
	const marker = title.match(/^\[([^\]]+)\]/)?.[1] || null
	const cleanTitle = title.replace(/^\[[^\]]+\]\s*/, "")
	const ocr = ocrById.get(id)
	const rp =
		faction === "ap"
			? { br: ops, fr: ops, it: Math.max(1, ops - 1), us: Math.max(1, ops - 2) }
			: { ge: ops, ah: Math.max(1, ops - 1), east: Math.max(1, ops - 1) }
	return {
		id,
		number: index + 1,
		faction,
		title: cleanTitle,
		printed_marker: marker,
		commitment: commitment(faction, index),
		ops,
		sr,
		rp: id === 652 ? { br: 3, fr: 3, it: 2, us: 1 } : rp,
		color,
		combat_card: color === "red",
		naval_card: color === "blue",
		// Regional Rotation explicitly changes to a repeatable later-use effect.
		// Its yellow treatment is a persistent reminder, not an event-removal instruction.
		remove: id === 601 ? false : color === "yellow" || marker === "2",
		event: `${faction}_${slug(cleanTitle) || index + 1}`,
		condition: marker === "0" || marker === "1/0" ? "optional-or-conditional" : "always",
		effect: cardTextCorrections.get(id) || extractCardEffect(ocr, cleanTitle),
		ocr_confidence: ocr?.confidence ?? null,
		ocr_text: ocr?.text ?? null,
		image: `cards/${faction}/${id}.webp`,
		image_2x: `cards/${faction}/${id}@2x.webp`
	}
}

const cards = [
	...apTitles.map((title, i) =>
		cardRecord("ap", i, title, apOps[i], apSr[i], { blue: blueAp, red: redAp, yellow: yellowAp })
	),
	...cpTitles.map((title, i) =>
		cardRecord("cp", i, title, cpOps[i], cpSr[i], { blue: blueCp, red: redCp, yellow: yellowCp })
	)
]
write("cards.json", cards)

const crt = {
	corps: {
		columns: [0, 1, 2, 3, 4, 5, 6, 7, 8],
		rows: [
			[0, 0, 0, 0, 0, 1, 1, 1, 1],
			[0, 0, 0, 0, 1, 1, 1, 1, 2],
			[0, 0, 0, 1, 1, 1, 1, 2, 2],
			[0, 0, 1, 1, 1, 1, 2, 2, 2],
			[0, 1, 1, 1, 1, 2, 2, 2, 3],
			[1, 1, 1, 1, 2, 2, 2, 3, 3]
		]
	},
	army: {
		columns: [1, 2, 3, 4, 5, 6, 8, 10, 13, 16, 20, 24],
		rows: [
			[0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5],
			[0, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5],
			[1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6],
			[1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6],
			[1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6],
			[2, 2, 2, 3, 4, 4, 5, 5, 6, 6, 6, 6]
		]
	},
	flank: {
		success: [4, 5, 6],
		modifiers: { cavalry: 1, selected_adjacent: 1, forest: -1, river: -1 }
	},
	modifiers: {
		cavalry_superiority: 1,
		headquarters: [0, 1],
		fortification_attacker: -1,
		mountain_defender: 1
	}
}
write("crt.json", crt)

// MO filenames are only stable identifiers; their printed backs contain distinct
// conditions and must not be inferred from the numeric suffix. Keep the manually
// audited structured definitions instead of recreating generic markers.
const moFile = path.join(sourceDir, "mo.json")
if (!fs.existsSync(moFile))
	throw new Error("data/source/mo.json is required; MO effects must be manually audited")
const mo = JSON.parse(fs.readFileSync(moFile, "utf8"))
write("mo.json", mo)

const spaces = [
	["london", "London", "br", "ap", "clear", true, true, 680, 485],
	["calais", "Calais", "fr", "ap", "swamp", false, true, 950, 630],
	["ostend", "Ostend", "be", "ap", "clear", false, true, 1120, 520],
	["antwerp", "Antwerp", "be", "ap", "clear", false, true, 1310, 490],
	["brussels", "Brussels", "be", "ap", "clear", false, false, 1290, 650],
	["liege", "Liege", "be", "ap", "fort", false, false, 1490, 690],
	["amiens", "Amiens", "fr", "ap", "clear", false, false, 920, 930],
	["cambrai", "Cambrai", "fr", "ap", "clear", false, false, 1130, 940],
	["paris", "Paris", "fr", "ap", "fort", true, false, 760, 1230],
	["reims", "Reims", "fr", "ap", "clear", false, false, 1100, 1190],
	["sedan", "Sedan", "fr", "ap", "forest", false, false, 1390, 1010],
	["verdun", "Verdun", "fr", "ap", "fort", false, false, 1350, 1280],
	["bar_le_duc", "Bar-le-Duc", "fr", "ap", "clear", false, false, 1180, 1420],
	["nancy", "Nancy", "fr", "ap", "fort", false, false, 1460, 1500],
	["belfort", "Belfort", "fr", "ap", "mountain", false, false, 1500, 1840],
	["lyon", "Lyon", "fr", "ap", "clear", false, false, 910, 2070],
	["marseilles", "Marseilles", "fr", "ap", "clear", true, true, 850, 2460],
	["aachen", "Aachen", "ge", "cp", "clear", false, false, 1660, 730],
	["koblenz", "Koblenz", "ge", "cp", "clear", false, false, 1680, 1030],
	["metz", "Metz", "ge", "cp", "fort", false, false, 1570, 1280],
	["strasbourg", "Strasbourg", "ge", "cp", "fort", false, false, 1700, 1580],
	["essen", "Essen", "ge", "cp", "clear", false, false, 1870, 600],
	["frankfurt", "Frankfurt", "ge", "cp", "clear", false, false, 1950, 1080],
	["mannheim", "Mannheim", "ge", "cp", "clear", false, false, 1900, 1390],
	["stuttgart", "Stuttgart", "ge", "cp", "clear", false, false, 1940, 1690],
	["bremen", "Bremen", "ge", "cp", "clear", false, true, 2230, 530],
	["hamburg", "Hamburg", "ge", "cp", "clear", false, true, 2470, 430],
	["kiel", "Kiel", "ge", "cp", "clear", false, true, 2700, 350],
	["kassel", "Kassel", "ge", "cp", "clear", false, false, 2200, 970],
	["berlin", "Berlin", "ge", "cp", "fort", true, false, 2800, 810],
	["munich", "Munich", "ge", "cp", "clear", false, false, 2200, 1750],
	["turin", "Turin", "it", "ap", "mountain", false, false, 3620, 4250],
	["milan", "Milan", "it", "ap", "clear", true, false, 3890, 4490],
	["genoa", "Genoa", "it", "ap", "clear", false, true, 3750, 4700],
	["verona", "Verona", "it", "ap", "clear", false, false, 4230, 4360],
	["venice", "Venice", "it", "ap", "swamp", false, true, 4520, 4460],
	["udine", "Udine", "it", "ap", "clear", false, false, 4930, 4280],
	["trent", "Trent", "ah", "cp", "alpine", false, false, 4380, 4040],
	["innsbruck", "Innsbruck", "ah", "cp", "mountain", false, false, 4570, 3810],
	["trieste", "Trieste", "ah", "cp", "mountain", false, true, 5140, 4410],
	["villach", "Villach", "ah", "cp", "alpine", false, false, 4970, 3970],
	["vienna", "Vienna", "ah", "cp", "clear", true, false, 5490, 3770]
].map(([id, name, nation, faction, terrain, supply, port, x, y]) => ({
	id,
	name,
	nation,
	faction,
	terrain,
	supply,
	port,
	ui: { x, y, w: 130, h: 100 }
}))

const rawEdges = [
	["calais", "ostend"],
	["calais", "amiens"],
	["ostend", "antwerp"],
	["ostend", "brussels"],
	["antwerp", "brussels"],
	["brussels", "liege"],
	["brussels", "cambrai"],
	["liege", "aachen"],
	["liege", "sedan"],
	["amiens", "cambrai"],
	["amiens", "paris"],
	["cambrai", "reims"],
	["cambrai", "sedan"],
	["paris", "reims"],
	["reims", "sedan"],
	["reims", "verdun"],
	["reims", "bar_le_duc"],
	["sedan", "verdun"],
	["sedan", "metz"],
	["sedan", "koblenz"],
	["verdun", "metz"],
	["verdun", "nancy"],
	["verdun", "bar_le_duc"],
	["bar_le_duc", "nancy"],
	["nancy", "metz"],
	["nancy", "strasbourg"],
	["nancy", "belfort"],
	["belfort", "strasbourg"],
	["belfort", "lyon"],
	["lyon", "marseilles"],
	["lyon", "turin"],
	["aachen", "koblenz"],
	["aachen", "essen"],
	["koblenz", "metz"],
	["koblenz", "frankfurt"],
	["metz", "strasbourg"],
	["strasbourg", "mannheim"],
	["mannheim", "frankfurt"],
	["mannheim", "stuttgart"],
	["essen", "bremen"],
	["essen", "kassel"],
	["bremen", "hamburg"],
	["bremen", "kassel"],
	["hamburg", "kiel"],
	["kassel", "frankfurt"],
	["kassel", "berlin"],
	["stuttgart", "munich"],
	["munich", "innsbruck"],
	["turin", "milan"],
	["turin", "genoa"],
	["milan", "genoa"],
	["milan", "verona"],
	["verona", "venice"],
	["verona", "trent"],
	["venice", "trent"],
	["venice", "udine"],
	["udine", "trieste"],
	["udine", "villach"],
	["trent", "innsbruck"],
	["innsbruck", "villach"],
	["villach", "trieste"],
	["villach", "vienna"],
	["trieste", "vienna"]
]

const coordinateCorrections = {
	london: [410, 204],
	calais: [1300, 620],
	ostend: [2264, 448],
	antwerp: [2795, 456],
	brussels: [2768, 813],
	liege: [3465, 1076],
	amiens: [1404, 1521],
	cambrai: [2098, 1464],
	paris: [1500, 2628],
	reims: [2526, 2188],
	sedan: [3025, 1775],
	verdun: [3124, 2414],
	bar_le_duc: [3013, 2740],
	nancy: [3684, 2865],
	// Belfort's star is split into two blue components by its terrain photograph.
	// Use the centre of the complete printed space, not either colour component.
	belfort: [3945, 3694],
	aachen: [3826, 900],
	koblenz: [4572, 1410],
	metz: [3711, 2292],
	strasbourg: [4503, 2848],
	essen: [4364, 168],
	milan: [3344, 5793],
	verona: [3601, 5498],
	venice: [4709, 5421],
	udine: [5324, 4777],
	trent: [3787, 4555],
	innsbruck: [4004, 4238],
	trieste: [5666, 5149],
	villach: [5654, 4304]
}
for (const space of spaces) {
	const point = coordinateCorrections[space.id]
	if (point) [space.ui.x, space.ui.y] = point
}

function addSpace(id, name, nation, faction, terrain, x, y, extra = {}) {
	if (spaces.some((space) => space.id === id)) return
	spaces.push({
		id,
		name,
		nation,
		faction,
		terrain,
		supply: false,
		port: false,
		ui: { x, y, w: 184, h: 184 },
		...extra
	})
}

const westernSpaces = [
	["dover", "Dover", "br", "ap", "clear", 965, 330, { port: true }],
	["boulogne", "Boulogne", "fr", "ap", "clear", 1113, 792, { port: true }],
	["saint_omer", "Saint-Omer", "fr", "ap", "clear", 1446, 861],
	["montreuil", "Montreuil", "fr", "ap", "clear", 1167, 1056],
	["ypres", "Ypres", "be", "ap", "swamp", 1760, 850],
	["veurne", "Veurne", "be", "ap", "swamp", 1649, 507],
	["bruges", "Bruges", "be", "ap", "clear", 2518, 610],
	["ghent", "Ghent", "be", "ap", "clear", 2740, 650],
	["kortrijk", "Kortrijk", "be", "ap", "swamp", 2023, 670],
	["tournai", "Tournai", "be", "ap", "clear", 2214, 926],
	["leuven", "Leuven", "be", "ap", "clear", 3069, 778],
	["hasselt", "Hasselt", "be", "ap", "clear", 3344, 722],
	["lille", "Lille", "fr", "ap", "fort", 1925, 994, { fort: 2 }],
	["neuve_chapelle", "Neuve Chapelle", "fr", "ap", "swamp", 1587, 1125],
	["valenciennes", "Valenciennes", "fr", "ap", "clear", 2297, 1210],
	["mons", "Mons", "be", "ap", "clear", 2594, 1090],
	["charleroi", "Charleroi", "be", "ap", "clear", 2894, 1170],
	["namur", "Namur", "be", "ap", "fort", 3192, 1178, { fort: 2 }],
	["abbeville", "Abbeville", "fr", "ap", "clear", 1107, 1328],
	["arras", "Arras", "fr", "ap", "clear", 1805, 1320],
	["maubeuge", "Maubeuge", "fr", "ap", "fort", 2491, 1368, { fort: 1 }],
	["florennes", "Florennes", "be", "ap", "clear", 2942, 1462],
	["bastogne", "Bastogne", "be", "ap", "forest", 3290, 1450],
	["arlon", "Arlon", "be", "ap", "clear", 3401, 1757],
	["dieppe", "Dieppe", "fr", "ap", "clear", 701, 1523, { port: true }],
	["peronne", "Peronne", "fr", "ap", "clear", 1842, 1594],
	["roye", "Roye", "fr", "ap", "clear", 1574, 1717],
	["saint_quentin", "Saint-Quentin", "fr", "ap", "clear", 2114, 1750],
	["vervins", "Vervins", "fr", "ap", "clear", 2494, 1654],
	["mezieres", "Mezieres", "fr", "ap", "clear", 2737, 1723],
	["le_havre", "Le Havre", "fr", "ap", "clear", 292, 1835, { port: true, supply: true, large_area: true }],
	["rouen", "Rouen", "fr", "ap", "clear", 880, 1906],
	["beauvais", "Beauvais", "fr", "ap", "clear", 1220, 1948],
	["noyon", "Noyon", "fr", "ap", "clear", 1760, 1890],
	["laon", "Laon", "fr", "ap", "fort", 2320, 1960, { fort: 1 }],
	["rethel", "Rethel", "fr", "ap", "clear", 2742, 2002],
	["creil", "Creil", "fr", "ap", "clear", 1514, 2008],
	["vouziers", "Vouziers", "fr", "ap", "forest", 3001, 2185],
	["ardennes", "Ardennes", "fr", "ap", "forest", 3274, 2185],
	["soissons", "Soissons", "fr", "ap", "clear", 2054, 2110],
	["compiegne", "Compiegne", "fr", "ap", "clear", 1786, 2220],
	["chantilly", "Chantilly", "fr", "ap", "clear", 1530, 2300],
	["argenteuil", "Argenteuil", "fr", "ap", "clear", 1255, 2325],
	["evreux", "Evreux", "fr", "ap", "clear", 824, 2388],
	["meaux", "Meaux", "fr", "ap", "clear", 1768, 2557],
	["chateau_thierry", "Chateau-Thierry", "fr", "ap", "clear", 2094, 2468],
	["epernay", "Epernay", "fr", "ap", "clear", 2378, 2478],
	["champagne", "Champagne", "fr", "ap", "swamp", 2705, 2468],
	["saint_mihiel", "Saint-Mihiel", "fr", "ap", "clear", 3418, 2514],
	["boulogne_billancourt", "Boulogne-Billancourt", "fr", "ap", "clear", 1234, 2642],
	["vitry", "Vitry-le-Francois", "fr", "ap", "clear", 2762, 2764],
	["sezanne", "Sezanne", "fr", "ap", "swamp", 2288, 2760],
	["toul", "Toul", "fr", "ap", "fort", 3373, 2804, { fort: 2 }],
	["chartres", "Chartres", "fr", "ap", "clear", 921, 2874],
	["dourdan", "Dourdan", "fr", "ap", "clear", 1450, 2991],
	["melun", "Melun", "fr", "ap", "clear", 1724, 2905],
	["provins", "Provins", "fr", "ap", "clear", 1990, 2906],
	["nogent", "Nogent", "fr", "ap", "clear", 2246, 3034],
	["joinville", "Joinville", "fr", "ap", "clear", 2942, 3038],
	["charmes", "Charmes", "fr", "ap", "clear", 3870, 3069],
	["lomevillie", "Lomevillie", "fr", "ap", "clear", 4114, 3006],
	["troyes", "Troyes", "fr", "ap", "clear", 2492, 3156],
	["mirecourt", "Mirecourt", "fr", "ap", "clear", 3590, 3185],
	["sens", "Sens", "fr", "ap", "clear", 1976, 3226],
	["orleans", "Orleans", "fr", "ap", "clear", 1236, 3308, { supply: true }],
	["dordives", "Dordives", "fr", "ap", "clear", 1710, 3282],
	["chaumont", "Chaumont", "fr", "ap", "fort", 2888, 3314, { fort: 1 }],
	["neufchateau", "Neufchateau", "fr", "ap", "fort", 3274, 3164, { fort: 2 }],
	["auxerre", "Auxerre", "fr", "ap", "clear", 2166, 3553],
	["vierzon", "Vierzon", "fr", "ap", "clear", 1267, 3582],
	["bourges", "Bourges", "fr", "ap", "clear", 1530, 3630],
	["nevers", "Nevers", "fr", "ap", "clear", 1854, 3650],
	["avallon", "Avallon", "fr", "ap", "clear", 2432, 3658],
	["chatillon", "Chatillon", "fr", "ap", "clear", 2706, 3594],
	["vittel", "Vittel", "fr", "ap", "clear", 3426, 3446],
	["vesoul", "Vesoul", "fr", "ap", "clear", 3534, 3666],
	["dijon", "Dijon", "fr", "ap", "fort", 2904, 3880, { fort: 1 }],
	["dole", "Dole", "fr", "ap", "clear", 3637, 3939],
	["besancon", "Besancon", "fr", "ap", "clear", 3308, 3979],
	["dusseldorf", "Dusseldorf", "ge", "cp", "clear", 4046, 506],
	["cologne", "Cologne", "ge", "cp", "clear", 4367, 729],
	["schirches", "Schirches", "ge", "cp", "clear", 4160, 1016],
	["bonn", "Bonn", "ge", "cp", "clear", 4526, 1061],
	["hillesheim", "Hillesheim", "ge", "cp", "forest", 3700, 1250],
	["mayen", "Mayen", "ge", "cp", "clear", 4194, 1348],
	["bitburg", "Bitburg", "ge", "cp", "clear", 3931, 1525],
	["wiltz", "Wiltz", "lu", "cp", "clear", 3670, 1622],
	["mainz", "Mainz", "ge", "cp", "clear", 4882, 1650],
	["trier", "Trier", "ge", "cp", "clear", 4083, 1798],
	["luxembourg", "Luxembourg", "lu", "cp", "clear", 3655, 1905],
	["bad_kreuznach", "Bad Kreuznach", "ge", "cp", "clear", 4662, 1946],
	["saarbrucken", "Saarbrucken", "ge", "cp", "clear", 4280, 2174],
	["marfeuilles", "Marfeuilles", "ge", "cp", "clear", 3970, 2550],
	["sarrebourg", "Sarrebourg", "ge", "cp", "clear", 4226, 2622],
	["colmar", "Colmar", "ge", "cp", "mountain", 4454, 3203],
	["freiburg", "Freiburg", "ge", "cp", "mountain", 4840, 3262],
	["st_die", "St. Die", "fr", "ap", "mountain", 4148, 3223],
	["epinal", "Epinal", "fr", "ap", "mountain", 4153, 3359],
	["mulhouse", "Mulhouse", "ge", "cp", "mountain", 4300, 3650],
	["langres", "Langres", "fr", "ap", "mountain", 3092, 3673]
]
for (const definition of westernSpaces) addSpace(...definition)

const italySpaces = [
	["tyrol", "Tyrol", "ah", "cp", "alpine", 4004, 4238, { large_area: true, supply: true }],
	["bozen", "Bozen", "ah", "cp", "alpine", 4350, 4294],
	["lienz", "Lienz", "ah", "cp", "alpine", 4976, 4145],
	["spittal", "Spittal", "ah", "cp", "alpine", 5404, 4174],
	["carnicola", "Carnicola", "ah", "cp", "alpine", 5914, 4203, { large_area: true, supply: true }],
	["radmannsdorf", "Radmannsdorf", "ah", "cp", "mountain", 5900, 4528],
	["pergine", "Pergine", "ah", "cp", "alpine", 4168, 4652],
	["rovereto", "Rovereto", "ah", "cp", "alpine", 3694, 4915],
	["belluno", "Belluno", "it", "ap", "mountain", 4752, 4531],
	["tolmezzo", "Tolmezzo", "it", "ap", "mountain", 5201, 4448],
	["caporetto", "Caporetto", "ah", "cp", "mountain", 5732, 4841, { fort: 2 }],
	["gorizia", "Gorizia", "ah", "cp", "mountain", 5940, 4940, { fort: 2 }],
	["adelsberg", "Adelsberg", "ah", "cp", "mountain", 5904, 5144],
	["pasubio", "Pasubio", "it", "ap", "mountain", 4008, 4959],
	["asiago", "Asiago", "it", "ap", "alpine", 4427, 4827],
	["vittorio", "Vittorio", "it", "ap", "mountain", 4888, 4822],
	["pordenone", "Pordenone", "it", "ap", "clear", 5201, 5000],
	["portogruaro", "Portogruaro", "it", "ap", "clear", 5053, 5250, { port: true }],
	["palmanova", "Palmanova", "it", "ap", "clear", 5336, 5118],
	["brescia", "Brescia", "it", "ap", "clear", 3505, 5185],
	["vicenza", "Vicenza", "it", "ap", "clear", 4006, 5421],
	["treviso", "Treviso", "it", "ap", "clear", 4299, 5223, { fort: 2 }],
	["veneto", "Veneto", "it", "ap", "clear", 4608, 5128],
	["padova", "Padova", "it", "ap", "clear", 4322, 5602],
	["mantova", "Mantova", "it", "ap", "clear", 3722, 5806],
	["bologna", "Bologna", "it", "ap", "clear", 4044, 5828],
	["southern_italy", "Southern Italy", "it", "ap", "clear", 4695, 5793, {
		large_area: true,
		supply: true,
		port: true
	}]
]
for (const definition of italySpaces) addSpace(...definition)

function addEdge(a, b, type = "land", properties = {}) {
	if (!spaces.some((space) => space.id === a) || !spaces.some((space) => space.id === b)) return
	if (!rawEdges.some((edge) => (edge[0] === a && edge[1] === b) || (edge[0] === b && edge[1] === a)))
		rawEdges.push([a, b, type, properties])
}

const channelRoad = {
	modes: ["move", "attack", "supply", "sr", "retreat", "advance"],
	factions: ["ap"],
	requires_land_attack_support: true
}

const detailedEdges = [
	["london", "dover"],
	["dover", "calais", "land", channelRoad],
	["dover", "boulogne", "land", channelRoad],
	["brighton", "dieppe", "land", channelRoad],
	["brighton", "le_havre", "land", channelRoad],
	["calais", "veurne"],
	["calais", "boulogne"],
	["calais", "saint_omer"],
	["veurne", "ostend"],
	["veurne", "ypres"],
	["ostend", "bruges"],
	["ostend", "kortrijk"],
	["bruges", "ghent"],
	["ghent", "antwerp"],
	["ghent", "brussels"],
	["ghent", "leuven"],
	["antwerp", "leuven"],
	["antwerp", "hasselt"],
	["ypres", "kortrijk"],
	["ypres", "saint_omer"],
	["ypres", "lille"],
	["ypres", "neuve_chapelle"],
	["kortrijk", "tournai"],
	["kortrijk", "lille"],
	["tournai", "brussels"],
	["tournai", "mons"],
	["tournai", "valenciennes"],
	["tournai", "lille"],
	["brussels", "leuven"],
	["brussels", "mons"],
	["leuven", "hasselt"],
	["leuven", "liege"],
	["hasselt", "liege"],
	["hasselt", "aachen"],
	["boulogne", "saint_omer"],
	["boulogne", "montreuil"],
	["saint_omer", "neuve_chapelle"],
	["montreuil", "abbeville"],
	["montreuil", "neuve_chapelle"],
	["neuve_chapelle", "lille"],
	["neuve_chapelle", "arras"],
	["lille", "valenciennes"],
	["lille", "arras"],
	["valenciennes", "mons"],
	["valenciennes", "maubeuge"],
	["valenciennes", "cambrai"],
	["mons", "charleroi"],
	["mons", "maubeuge"],
	["charleroi", "namur"],
	["charleroi", "florennes"],
	["charleroi", "maubeuge"],
	["namur", "liege"],
	["namur", "florennes"],
	["namur", "bastogne"],
	["liege", "bastogne"],
	["liege", "hillesheim"],
	["abbeville", "dieppe"],
	["abbeville", "amiens"],
	["abbeville", "montreuil"],
	["arras", "amiens"],
	["arras", "peronne"],
	["arras", "cambrai"],
	["maubeuge", "cambrai"],
	["maubeuge", "vervins"],
	["maubeuge", "florennes"],
	["florennes", "mezieres"],
	["florennes", "sedan"],
	["florennes", "bastogne"],
	["bastogne", "arlon"],
	["bastogne", "hillesheim"],
	["dieppe", "rouen"],
	["le_havre", "dieppe"],
	["le_havre", "rouen"],
	["amiens", "peronne"],
	["amiens", "roye"],
	["amiens", "beauvais"],
	["peronne", "cambrai"],
	["peronne", "saint_quentin"],
	["peronne", "roye"],
	["cambrai", "saint_quentin"],
	["cambrai", "vervins"],
	["vervins", "saint_quentin"],
	["vervins", "laon"],
	["vervins", "mezieres"],
	["mezieres", "rethel"],
	["mezieres", "sedan"],
	["sedan", "rethel"],
	["rouen", "beauvais"],
	["rouen", "evreux"],
	["beauvais", "noyon"],
	["beauvais", "creil"],
	["noyon", "roye"],
	["noyon", "saint_quentin"],
	["noyon", "soissons"],
	["noyon", "compiegne"],
	["saint_quentin", "laon"],
	["laon", "soissons"],
	["laon", "rethel"],
	["rethel", "reims"],
	["rethel", "vouziers"],
	["soissons", "compiegne"],
	["soissons", "chateau_thierry"],
	["soissons", "reims"],
	["compiegne", "chantilly"],
	["compiegne", "meaux"],
	["chantilly", "argenteuil"],
	["chantilly", "meaux"],
	["argenteuil", "paris"],
	["argenteuil", "evreux"],
	["evreux", "chartres"],
	["paris", "boulogne_billancourt"],
	["paris", "meaux"],
	["paris", "melun"],
	["boulogne_billancourt", "dourdan"],
	["meaux", "chateau_thierry"],
	["meaux", "melun"],
	["chateau_thierry", "epernay"],
	["chateau_thierry", "reims"],
	["epernay", "reims"],
	["epernay", "champagne"],
	["epernay", "vitry"],
	["champagne", "reims"],
	["champagne", "verdun"],
	["champagne", "vitry"],
	["reims", "vouziers"],
	["vouziers", "ardennes"],
	["vouziers", "verdun"],
	["ardennes", "verdun"],
	["ardennes", "luxembourg"],
	["chartres", "dourdan"],
	["dourdan", "orleans"],
	["dourdan", "melun"],
	["melun", "provins"],
	["melun", "sens"],
	["provins", "nogent"],
	["provins", "troyes"],
	["nogent", "troyes"],
	["vitry", "bar_le_duc"],
	["vitry", "joinville"],
	["bar_le_duc", "joinville"],
	["bar_le_duc", "toul"],
	["toul", "nancy"],
	["toul", "neufchateau"],
	["nancy", "charmes"],
	["nancy", "lomevillie"],
	["charmes", "mirecourt"],
	["charmes", "lomevillie"],
	["joinville", "chaumont"],
	["joinville", "neufchateau"],
	["troyes", "chaumont"],
	["troyes", "chatillon"],
	["sens", "auxerre"],
	["sens", "orleans"],
	["orleans", "vierzon"],
	["vierzon", "bourges"],
	["bourges", "nevers"],
	["nevers", "auxerre"],
	["auxerre", "avallon"],
	["avallon", "chatillon"],
	["chatillon", "chaumont"],
	["chaumont", "neufchateau"],
	["chaumont", "langres"],
	["neufchateau", "vittel"],
	["mirecourt", "vittel"],
	["vittel", "epinal"],
	["epinal", "st_die"],
	["epinal", "belfort"],
	["st_die", "colmar"],
	["colmar", "mulhouse"],
	["mulhouse", "belfort"],
	["freiburg", "colmar"],
	["freiburg", "mulhouse"],
	["langres", "dijon"],
	["langres", "belfort"],
	["dijon", "dole"],
	["dole", "besancon"],
	["besancon", "belfort"],
	["essen", "dusseldorf"],
	["dusseldorf", "cologne"],
	["dusseldorf", "aachen"],
	["cologne", "bonn"],
	["cologne", "schirches"],
	["schirches", "aachen"],
	["schirches", "bonn"],
	["bonn", "koblenz"],
	["aachen", "hillesheim"],
	["hillesheim", "mayen"],
	["hillesheim", "bitburg"],
	["mayen", "koblenz"],
	["mayen", "bitburg"],
	["bitburg", "trier"],
	["bitburg", "wiltz"],
	["wiltz", "luxembourg"],
	["wiltz", "arlon"],
	["koblenz", "mainz"],
	["koblenz", "bad_kreuznach"],
	["koblenz", "trier"],
	["mainz", "bad_kreuznach"],
	["trier", "bad_kreuznach"],
	["trier", "saarbrucken"],
	["trier", "luxembourg"],
	["bad_kreuznach", "saarbrucken"],
	["luxembourg", "metz"],
	["luxembourg", "saarbrucken"],
	["saarbrucken", "metz"],
	["saarbrucken", "sarrebourg"],
	["metz", "marfeuilles"],
	["marfeuilles", "sarrebourg"],
	["sarrebourg", "strasbourg"],
	["strasbourg", "colmar"],
	["innsbruck", "bozen"],
	["tyrol", "bozen"],
	["tyrol", "trent"],
	["innsbruck", "trent"],
	["bozen", "lienz"],
	["bozen", "trent"],
	["lienz", "spittal"],
	["lienz", "villach"],
	["spittal", "villach"],
	["spittal", "carnicola"],
	["carnicola", "radmannsdorf"],
	["radmannsdorf", "villach"],
	["radmannsdorf", "adelsberg"],
	["trent", "pergine"],
	["trent", "rovereto"],
	["pergine", "asiago"],
	["pergine", "belluno"],
	["rovereto", "pasubio"],
	["rovereto", "verona"],
	["belluno", "tolmezzo"],
	["belluno", "vittorio"],
	["belluno", "asiago"],
	["tolmezzo", "villach"],
	["tolmezzo", "caporetto"],
	["tolmezzo", "udine"],
	["villach", "caporetto"],
	["caporetto", "gorizia"],
	["caporetto", "udine"],
	["gorizia", "trieste"],
	["gorizia", "palmanova"],
	["gorizia", "udine"],
	["trieste", "adelsberg"],
	["trieste", "portogruaro"],
	["pasubio", "brescia"],
	["pasubio", "verona"],
	["asiago", "vicenza"],
	["asiago", "vittorio"],
	["vittorio", "treviso"],
	["vittorio", "pordenone"],
	["pordenone", "udine"],
	["pordenone", "portogruaro"],
	["udine", "palmanova"],
	["palmanova", "portogruaro"],
	["palmanova", "trieste"],
	["brescia", "milan"],
	["brescia", "verona"],
	["verona", "mantova"],
	["verona", "vicenza"],
	["vicenza", "treviso"],
	["vicenza", "padova"],
	["treviso", "veneto"],
	["treviso", "venice"],
	["veneto", "pordenone"],
	["veneto", "portogruaro"],
	["veneto", "venice"],
	["portogruaro", "venice"],
	["milan", "mantova"],
	["mantova", "bologna"],
	["mantova", "padova"],
	["padova", "venice"],
	["padova", "bologna"],
	["bologna", "southern_italy"]
]
// The early coarse graph above used long regional shortcuts. Rebuild the final
// graph exclusively from the printed map audit below.
rawEdges.length = 0
for (const edge of detailedEdges) addEdge(...edge)

const auditedFalseEdges = new Set([
	["bastogne", "hillesheim"], ["bastogne", "florennes"],
	["hasselt", "aachen"], ["ghent", "leuven"], ["antwerp", "leuven"],
	["leuven", "liege"], ["boulogne_billancourt", "dourdan"],
	["chartres", "dourdan"], ["epernay", "vitry"], ["provins", "troyes"],
	["sens", "orleans"], ["langres", "belfort"], ["ostend", "kortrijk"],
	["rovereto", "verona"], ["pordenone", "veneto"]
].map(([a, b]) => [a, b].sort().join("|")))
for (let index = rawEdges.length - 1; index >= 0; index--)
	if (auditedFalseEdges.has([rawEdges[index][0], rawEdges[index][1]].sort().join("|"))) rawEdges.splice(index, 1)

const auditedEdgeAdditions = [
	["antwerp", "brussels"], ["liege", "aachen"], ["verdun", "metz"],
	["verdun", "bar_le_duc"], ["bruges", "kortrijk"], ["ghent", "kortrijk"],
	["bruges", "antwerp"], ["veurne", "kortrijk"], ["essen", "cologne"],
	["arlon", "sedan"], ["arlon", "luxembourg"], ["bastogne", "sedan"], ["argenteuil", "beauvais"],
	["argenteuil", "boulogne_billancourt"], ["boulogne_billancourt", "evreux"],
	["boulogne_billancourt", "chartres"], ["creil", "chantilly"],
	["chantilly", "paris"], ["dourdan", "paris"], ["chartres", "orleans"],
	["creil", "roye"], ["avallon", "dijon"], ["chatillon", "langres"],
	["joinville", "troyes"], ["joinville", "toul"], ["mirecourt", "nancy"],
	["mirecourt", "neufchateau"], ["langres", "vittel"], ["langres", "vesoul"],
	["vittel", "vesoul"], ["vesoul", "belfort"], ["vesoul", "dole"],
	["vesoul", "besancon"], ["freiburg", "strasbourg"],
	["lomevillie", "sarrebourg"], ["lomevillie", "strasbourg"],
	["lomevillie", "st_die"], ["marfeuilles", "nancy"],
	["saarbrucken", "strasbourg"], ["koblenz", "saarbrucken"],
	["metz", "trier"], ["metz", "saint_mihiel"], ["verdun", "saint_mihiel"],
	["saint_mihiel", "toul"], ["epernay", "sezanne"], ["provins", "sezanne"],
	["sezanne", "vitry"], ["sezanne", "nogent"], ["orleans", "dordives"],
	["dordives", "sens"], ["bozen", "pergine"], ["lienz", "belluno"],
	["pergine", "rovereto"], ["rovereto", "asiago"],
	["caporetto", "radmannsdorf"], ["gorizia", "adelsberg"],
	["treviso", "pordenone"], ["treviso", "portogruaro"],
	["asiago", "veneto"], ["vittorio", "veneto"], ["veneto", "vicenza"],
	["mulhouse", "st_die"]
]
for (const edge of auditedEdgeAdditions) addEdge(...edge)

const auditedDifficultEdges = new Set([
	["antwerp", "brussels"], ["antwerp", "hasselt"], ["arras", "amiens"],
	["champagne", "reims"], ["vouziers", "ardennes"], ["ardennes", "verdun"],
	["ardennes", "luxembourg"], ["vittel", "epinal"], ["epinal", "belfort"],
	["st_die", "colmar"], ["colmar", "mulhouse"], ["mulhouse", "belfort"],
	["mulhouse", "st_die"]
].map(([a, b]) => [a, b].sort().join("|")))

const auditedSpaceGeometry = {
	london: { w: 316, h: 316 },
	strasbourg: { w: 236, h: 240 },
	verdun: { w: 236, h: 240 },
	neufchateau: { w: 236, h: 240 }
}
const auditedMapCentres = {
	hillesheim: { x: 3825, y: 1285 },
	mulhouse: { x: 4304, y: 3528, h: 192 },
	epinal: { x: 3853, y: 3359, w: 236, h: 240 },
	langres: { x: 3092, y: 3601, h: 232 },
	dole: { x: 3308, y: 3979 },
	besancon: { x: 3637, y: 3939 },
	caporetto: { x: 5643, y: 4564, w: 204, h: 202 },
	gorizia: { x: 5732, y: 4841, w: 296, h: 266 },
	pasubio: { x: 3505, y: 5185 },
	asiago: { x: 4008, y: 4959 },
	vittorio: { x: 4427, y: 4827 },
	pordenone: { x: 4888, y: 4822, w: 188 },
	brescia: { x: 3275, y: 5439 },
	treviso: { x: 4608, y: 5128, w: 180, h: 180 },
	veneto: { x: 4299, y: 5223 }
}
for (const space of spaces)
	if (auditedSpaceGeometry[space.id]) Object.assign(space.ui, auditedSpaceGeometry[space.id])
for (const space of spaces)
	if (auditedMapCentres[space.id]) Object.assign(space.ui, auditedMapCentres[space.id])
const obsoleteSpaceIds = new Set([
	"lyon", "marseilles", "frankfurt", "mannheim", "stuttgart", "bremen", "hamburg", "kiel",
	"kassel", "berlin", "munich", "turin", "genoa", "vienna", "innsbruck"
])
const printedSupplySources = new Set([
	"london", "le_havre", "paris", "orleans", "chaumont", "essen", "koblenz",
	"tyrol", "carnicola", "milan", "southern_italy"
])
for (let index = spaces.length - 1; index >= 0; index--)
	if (obsoleteSpaceIds.has(spaces[index].id)) spaces.splice(index, 1)
for (let index = rawEdges.length - 1; index >= 0; index--)
	if (obsoleteSpaceIds.has(rawEdges[index][0]) || obsoleteSpaceIds.has(rawEdges[index][1])) rawEdges.splice(index, 1)
for (const space of spaces) {
	delete space.ui.hidden
	space.supply = printedSupplySources.has(space.id)
}

write(
	"spaces.json",
	spaces.map((space) => ({ ...space, control: space.faction }))
)
write(
	"edges.json",
	rawEdges.map(([a, b, type = "land", properties = {}]) => ({
		a,
		b,
		type,
		modes: properties.modes || ["move", "attack", "supply", "sr", "retreat", "advance"],
		factions: properties.factions || ["ap", "cp"],
		...(properties.requires_land_attack_support ? { requires_land_attack_support: true } : {}),
		...(auditedDifficultEdges.has([a, b].sort().join("|")) ? { difficult: true } : {})
	}))
)

const assetManifest = JSON.parse(fs.readFileSync(path.join(root, "data", "generated", "asset-manifest.json"), "utf8"))
const components = JSON.parse(fs.readFileSync(path.join(root, "data", "generated", "tts-components.json"), "utf8"))
const assetByHash = Object.fromEntries(assetManifest.pieces.map((piece) => [piece.sha256, piece]))
const leaderNations = {
	G法金汉: "ge",
	G普鲁雷希特: "ge",
	G德斯佩雷: "fr",
	G弗伦奇: "br",
	G尼维尔: "fr",
	G卡尔多纳: "it",
	G博罗耶维奇: "ah",
	G克卢克: "ge",
	G罗森贝格: "ah",
	G福煦: "fr",
	G皇储威廉: "ge",
	G潘兴: "us",
	G迪亚兹: "it",
	G贝当: "fr",
	G胡蒂尔: "ge",
	G阿尔贝特: "be",
	G霞飞: "fr",
	普卢默HQ: "br",
	冯贝洛: "ge",
	G黑格: "br"
}
const pieces = components.components.map((component) => {
	const asset = assetByHash[component.face?.hash] || assetByHash[component.back?.hash]
	const source = asset?.source || ""
	let nation =
		source.includes("德国") || source.includes("普鲁士") || source.includes("巴伐利亚")
			? "ge"
			: source.includes("奥匈")
				? "ah"
				: source.includes("法国")
					? "fr"
					: source.includes("英国") || source.includes("英联邦") || source.includes("印度")
						? "br"
						: source.includes("意大利")
							? "it"
							: source.includes("美国")
								? "us"
								: source.includes("比利时")
									? "be"
									: "marker"
	const type = /HQ|将领/.test(source)
		? "hq"
		: /LCU|战斗单位.*(?<!scu)b?\.png$/i.test(source)
			? "army"
			: /scu/i.test(source)
				? "corps"
				: "marker"
	if (type === "hq") nation = leaderNations[asset?.name] || nation
	return {
		id: component.id,
		name: asset?.name || component.id,
		nation,
		faction: ["ge", "ah"].includes(nation) ? "cp" : nation === "marker" ? null : "ap",
		type,
		veteran: /老兵/.test(source),
		cavalry: /骑兵/.test(source),
		mountain: /山地/.test(source),
		combat: type === "army" ? 3 : type === "corps" ? 1 : 0,
		loss: type === "army" ? 3 : type === "corps" ? 1 : 0,
		movement: /骑兵/.test(source) ? 5 : type === "army" || type === "corps" ? 4 : 0,
		reduced_combat: type === "army" ? 2 : 1,
		reduced_loss: type === "army" ? 2 : 1,
		image: asset?.image || null,
		source,
		tts_count: component.count,
		face_hash: component.face?.hash || null,
		back_hash: component.back?.hash || null
	}
})
const pieceCorrections = {
	"component-035": {
		name: "\u5fb7\u56fd\u9a91\u5175scu",
		type: "corps",
		combat: 2,
		loss: 1,
		movement: 5,
		reduced_combat: 0,
		reduced_loss: 1
	},
	"component-043": {
		name: "\u666e\u9c81\u58eb\u9a91\u5175scu",
		type: "corps",
		combat: 2,
		loss: 1,
		movement: 5,
		reduced_combat: 1,
		reduced_loss: 1
	},
	"component-085": {
		name: "G\u9c81\u666e\u96f7\u5e0c\u7279"
	}
}
for (const piece of pieces) Object.assign(piece, pieceCorrections[piece.id] || {})
write("pieces.json", pieces)

const setupPath = path.join(sourceDir, "setup.json")
const existingSetup = fs.existsSync(setupPath) ? JSON.parse(fs.readFileSync(setupPath, "utf8")) : null
const forceManualSetup = process.argv.includes("--force-manual-setup")
if (forceManualSetup || existingSetup?.historical?.setup_source !== "rules.js")
	throw new Error("Historical setup is authoritative in rules.js and cannot be generated or inferred from TTS data")
if (existingSetup?.historical?.setup_source === "rules.js") {
	console.log("Preserved rules.js Historical setup; TTS setup objects are not part of the game data.")
} else if (existingSetup?.historical?.setup_source === "manual" && !forceManualSetup) {
	console.log("Preserved manual data/source/setup.json; pass --force-manual-setup to regenerate it from TTS.")
} else {
const ttsSetup = JSON.parse(fs.readFileSync(path.join(root, "data", "generated", "tts-setup.json"), "utf8"))
function setupZone(object, component) {
	const piece = pieces.find((candidate) => candidate.id === component)
	if (!piece || !["army", "corps", "hq"].includes(piece.type)) return "track"
	const { x, z } = object.world
	if (x <= -12 && z >= 4) return "ap_upgrade"
	if (x <= -12) return "ap_reserve"
	if (x >= 13 && z >= 7) return "cp_upgrade"
	if (x >= 10 && z >= 12) return "cp_reserve"
	return "map"
}
const setupObjects = ttsSetup.objects.map((object) => {
	const component =
		components.components.find(
			(candidate) =>
				candidate.face?.hash === object.images.face?.hash &&
				(candidate.back?.hash || candidate.face?.hash) ===
					(object.images.back?.hash || object.images.face?.hash)
		)?.id || null
	const mapped = {
		guid: object.guid,
		component,
		world: { x: object.transform.x, y: object.transform.y, z: object.transform.z },
		reduced: object.transform.rot_y < 90 || object.transform.rot_y > 270
	}
	mapped.zone = setupZone(mapped, component)
	return mapped
})
const setupOccupancy = Object.fromEntries(spaces.map((space) => [space.id, 0]))
for (const object of setupObjects) {
	const piece = pieces.find((candidate) => candidate.id === object.component)
	if (object.zone !== "map" || !piece || !["army", "corps", "hq"].includes(piece.type)) continue
	const faction = piece.faction || (["ge", "ah"].includes(piece.nation) ? "cp" : "ap")
	let candidates = spaces.filter((space) => space.faction === faction && !space.ui?.hidden)
	const national = candidates.filter((space) => space.nation === piece.nation)
	if (national.length) candidates = national
	const transformed = {
		x: ((Number(object.world.x) + 15.5) / 31.5) * 6082,
		y: ((19.5 - Number(object.world.z)) / 30.7) * 6000
	}
	object.location = candidates.reduce((best, space) => {
		const distance = Math.hypot(space.ui.x - transformed.x, space.ui.y - transformed.y) + setupOccupancy[space.id] * 150
		return !best || distance < best.distance ? { id: space.id, distance } : best
	}, null)?.id
	if (!object.location) throw new Error(`No setup location for ${object.guid}`)
	setupOccupancy[object.location] += 1
}
write("setup.json", {
	historical: {
		setup_source: "tts-derived",
		tts_reference: "TS_Save_13.json",
		location_source: "tts-coordinate-match",
		objects: setupObjects,
		stacks: ttsSetup.stacks
	}
})
}

write("ui.json", {
	map: { width: 6082, height: 6000, image: "assets/map.webp", image_2x: "assets/map.png" },
	tracks: {
		turn: { min: 1, max: 15 },
		action_round: { min: 1, max: 6 },
		vp: { min: 0, max: 40 },
		naval: { min: -9, max: 9 },
		war_status: { min: 0, max: 40 },
		russian_front: { min: 0, max: 9 },
		turkish_front: { min: 0, max: 9 }
	}
})

const events = {
	ap_战争援助: { kind: "persistent", rp_exchange: [["br", "fr"], ["fr", "br"]] },
	ap_抽调地区军_轮换兵役制: { first_rp: { fr: 2 }, later_rp: { fr: 1 } },
	ap_美国远征军: { kind: "entry", nation: "us", war_status: 2 },
	ap_皇家海军封锁: { kind: "persistent", naval: 1, winter_vp: -1 },
	ap_护航: { kind: "persistent", cancel: "cp_U艇攻势", naval: 4, vp: -1 },
	ap_洗劫比利时: { vp: -1, min_turn: 2 },
	ap_征服德国殖民地: { vp: -1 },
	ap_劳合乔治: { vp: -1, rp: { br: 2 }, fronts: { turkish: 2 } },
	ap_意大利参战: { kind: "entry", nation: "it", war_status: 2, vp: -2 },
	ap_希腊参战: { vp: -1, conditional_fronts: { event: "ap_萨洛尼卡", turkish: 1 } },
	ap_罗马尼亚参战: {
		vp: -1,
		fronts: { russian: -1 },
		requires_any_event: ["ap_勃鲁西洛夫攻势"],
		allow_if_front_at_most: { russian: 3 }
	},
	ap_威尔逊: { vp: -1, entry_shift: { us: -1 } },
	ap_勃鲁西洛夫攻势: { fronts: { russian: -2 } },
	cp_土耳其参战: { kind: "entry", nation: "tu", war_status: 1, vp: -1, fronts: { turkish: 1 } },
	cp_U艇攻势: { kind: "persistent", naval_each_turn: 1 },
	cp_保加利亚参战: { kind: "persistent", rp: { ge: 4, ah: 2 }, fronts: { russian: 1 } },
	cp_布列斯特_立托夫斯克条约: {
		kind: "persistent",
		min_front: { russian: 8 },
		lock_front: "russian",
		end_vp: 2
	},
	cp_无限制潜艇战: {
		kind: "persistent",
		naval: 5,
		war_status: 1,
		fronts: { turkish: -1 },
		recurring_rp_loss: { ap: { us: 1, br: 1 } }
	},
	cp_德国战争工业: {
		kind: "persistent",
		replacement_bonus: { ge: 1 },
		free_upgrade: { nation: "ge", type: "corps", count: 1 }
	},
	cp_兴登堡防线: { kind: "persistent", trench_bonus: 1 },
	cp_兴登堡_鲁登道夫: { kind: "persistent", fronts: { russian: 1 }, mo_required: { ge: 1 } },
	cp_法军兵变: { kind: "persistent", prohibit: "fr_attack_without_mo" },
	cp_麦克斯亲王: { kind: "persistent", end_vp: 1 },
	cp_意大利声明中立: { rp: { ah: 2 }, requires_event: "entry_it" }
}
write("events.json", events)

const combatEffects = {
	602: { tables: { attacker: "corps", defender: "corps" }, retreat_choice: [1, 2], advance_limit: 1, damaged_advance: true },
	609: { cancel_attack: true, counterattack: true, first_fire: "ap", prohibit_combat_cards: true, result_vp: { win: -1, tie: -1 } },
	610: { attack_column: 1, defense_column: 1, prohibit_advance: "both", fortification_after: "both" },
	612: { attack_drm: -1, target_nation: "be", prohibit_advance_if: "river" },
	620: { duration: "action_round", attack_column: 1, western_front_only: true, repair_after: 2 },
	621: { attack_drm: 1, draw_on_win: true },
	622: { defense_drm: -1, draw_on_win: true },
	624: {
		duration: "action_round",
		attack_drm: 1,
		western_front_only: true,
		somme_marker: true,
		ignore_nationality_at_marker: true,
		marker_attack_column: 1,
		remove_piece_at_expiry: "component-007"
	},
	628: { duration: "action_round", attack_column: 1, restore_attackers_before: 2 },
	629: { clear_fortification: true, ignore_trench: true },
	631: { after_defense: true, cancel_retreat: "ap", cancel_advance: "cp", convert_fr_steps_to_rp: 2, draw_on_non_loss: true },
	632: { duration: "combat", clear_fortification: true, extra_enemy_loss: 1, draw_on_non_loss: true },
	634: {
		duration: "action_round",
		min_turn_for_effect: 12,
		extra_enemy_loss: 1,
		ignore_trench: true,
		clear_fortification: true,
		prohibit_damaged_retreat_cancel: true
	},
	638: { duration: "action_round", attack_drm: 1, ignore_activation_nationality: true },
	639: { duration: "combat", italian_front_only: true, force_table: "army", draw_on_win: true },
	640: { duration: "combat", ignore_trench: true },
	641: {
		duration: "combat",
		italian_front_only: true,
		ignore_activation_nationality: true,
		ignore_trench_unless_ge_ah_army: true,
		ignore_terrain_unless_ge_ah_army: true
	},
	654: { italian_fort_fire_drm: -1 },
	658: { duration: "turn", lock_front: "russian", requires_commitment: "total" },
	702: { defense_drm: -1, draw_on_win: true, destroy_belgian_fort: true, french_fort_fire_drm: -1 },
	705: { duration: "action_round", applies_to: "ap", attack_column: -1 },
	709: { attack_drm_if_defender_nation: "fr", damaged_advance: true },
	710: { first_fire: "cp", adjacent_hq_required: true },
	711: { duration: "action_round", attack_drm: 1 },
	712: { cancel_attack: true, cancel_mo_attacks: true, return_other_combat_cards: true },
	714: { choice: ["restore_before", "repair_after"], restore_side: "cp", repair_rp: 2 },
	719: { duration: "combat", first_fire: "cp", prohibit_advance: "ap" },
	721: { cancel_event: "ap_空中优势", attack_drm: 1, clear_fortification: true },
	722: { defense_column: 1, requires_trench: true, prohibit_advance: "ap", draw_on_win: true },
	729: { ignore_fortification: true, ignore_trench: true },
	730: { duration: "action_round", italian_front_only: true, ignore_natural_terrain: true },
	731: { british_attack_corps_table: true, british_mixed_column: -1 },
	732: { italian_front_only: true, force_table: "army", attack_column: 1, defense_column: 1, draw_on_win: true },
	734: {
		duration: "action_round",
		western_front_only: true,
		ignore_trench: true,
		prohibit_damaged_retreat_cancel_if_margin: 2
	},
	738: {
		duration: "action_round",
		western_front_only: true,
		only_french_defenders: true,
		ignore_trench: true,
		minimum_retreat: 1,
		vp_if_no_army_advance: -1
	},
	739: { french_attack_column: -1, forced_french_attacks_after: 2, forced_attack_loss_floor: 1 },
	740: {
		duration: "action_round",
		western_front_only: true,
		defender_loss_adjust: -1,
		ignore_natural_terrain: true,
		ignore_fortification: true,
		ignore_trench: true,
		salient_on_advance: true
	},
	741: { first_fire: "cp", draw_on_win: true },
	742: { attack_drm: 1, draw_on_win: true },
	743: { duration: "turn", rp: { fr: -2 } },
	744: {
		duration: "action_round",
		western_front_only: true,
		defender_loss_adjust: -1,
		ignore_fortification: true,
		ignore_trench: true,
		salient_on_advance: true
	},
	748: {
		duration: "action_round",
		western_front_only: true,
		ignore_trench: true,
		salient_on_advance: true
	},
	753: { attack_column: -1, terrain: ["swamp"], prohibit_advance: "ap", draw_on_non_loss: true },
	757: { italian_front_only: true, attacker_nation: "ah", defender_nation: "it", ignore_terrain_column: true, conditional_ignore_fieldworks: true }
}

const eventChoices = {
	600: [
		{ id: "br_to_fr", label: "BR:RP 转为 FR:RP", timing: "replacement", amount: { min: 1, max: 2 } },
		{ id: "fr_to_br", label: "FR:RP 转为 BR:RP", timing: "replacement", amount: { min: 1, max: 2 } },
		{ id: "us_to_fr", label: "US:RP 转为 FR:RP", timing: "replacement", amount: { min: 1, max: 2 }, requires_event: "entry_us" },
		{ id: "fr_to_us", label: "FR:RP 转为 US:RP", timing: "replacement", amount: { min: 1, max: 2 }, requires_event: "entry_us" }
	],
	613: [
		{
			id: "remove_lcu",
			label: "永久移除 1 个英国/英联邦 LCU",
			select: {
				kind: "units",
				count: 1,
				faction: "ap",
				nations: ["br", "ca"],
				types: ["army"],
				exclude: ["bef"],
				zones: ["map", "ap_reserve"]
			}
		},
		{
			id: "remove_scu",
			label: "永久移除 3 个英国/英联邦/印度 SCU",
			select: {
				kind: "units",
				count: 3,
				faction: "ap",
				nations: ["br", "ca", "in"],
				types: ["corps"],
				exclude: ["bef"],
				zones: ["map", "ap_reserve"]
			}
		}
	],
	626: [
		{ id: "front_only", label: "仅推进土耳其战线" },
		{
			id: "bombard_straits",
			label: "永久移除升级区 2 个英国老兵 SCU，VP -1",
			select: {
				kind: "units",
				count: 2,
				faction: "ap",
				nations: ["br"],
				types: ["corps"],
				veteran: true,
				zones: ["ap_upgrade"]
			},
			effects: [{ type: "vp", amount: -1 }]
		}
	],
	653: [
		{
			id: "remove_corps",
			label: "永久移除 2 个法国 SCU 与 2 个英国/英联邦 SCU，VP -1",
			select: {
				kind: "units",
				count: 4,
				faction: "ap",
				types: ["corps"],
				zones: ["map", "ap_reserve"],
				groups: [
					{ nations: ["fr"], count: 2 },
					{ nations: ["br", "ca"], count: 2 }
				]
			},
			effects: [{ type: "vp", amount: -1 }]
		},
		{ id: "skip_removal", label: "不永久移除单位" }
	],
	726: [
		{
			id: "remove_lcu",
			label: "永久移除 1 个英国/英联邦 LCU",
			chooser: "ap",
			select: {
				kind: "units",
				count: 1,
				faction: "ap",
				nations: ["br", "ca"],
				types: ["army"],
				exclude: ["bef"],
				zones: ["map", "ap_reserve"]
			}
		},
		{
			id: "remove_scu",
			label: "永久移除 3 个英国/英联邦/印度 SCU",
			chooser: "ap",
			select: {
				kind: "units",
				count: 3,
				faction: "ap",
				nations: ["br", "ca", "in"],
				types: ["corps"],
				exclude: ["bef"],
				zones: ["map", "ap_reserve"]
			}
		}
	],
	714: [
		{ id: "restore_before", label: "战斗前恢复所有参战 CP 单位" },
		{ id: "repair_after", label: "战斗后获得 2 RP 并修复参战单位" }
	],
	754: [
		{ id: "russian_front", label: "俄国战线 +1", effects: [{ type: "front", track: "russian", amount: 1 }] },
		{ id: "ge_rp", label: "获得 2 GE:RP", effects: [{ type: "rp", faction: "cp", nation: "ge", amount: 2 }] }
	],
	756: [
		{
			id: "lcu",
			label: "减损 2 个意大利 LCU",
			timing: "cadorna_immediate",
			select: {
				kind: "units",
				count: 2,
				faction: "ap",
				nations: ["it"],
				types: ["army"],
				zones: ["map"]
			}
		},
		{
			id: "scu",
			label: "消灭 2 个意大利 SCU",
			timing: "cadorna_immediate",
			select: {
				kind: "units",
				count: 2,
				faction: "ap",
				nations: ["it"],
				types: ["corps"],
				zones: ["map"]
			}
		}
	]
}

const prerequisiteOverrides = {
	608: { min_turn: 3 },
	614: { min_turn: 4 },
	630: { forbids_event: cards.find((card) => card.id === 627).event },
	645: {},
	647: { min_combined_war_status: 28, max_turn: 11 },
	649: { requires_event: cards.find((card) => card.id === 646).event },
	650: { requires_event: cards.find((card) => card.id === 646).event },
	657: {
		min_turn_or_event_count: {
			turn: 12,
			count: 2,
			events: [740, 744, 748].map((id) => cards.find((card) => card.id === id).event)
		}
	},
	700: { max_turn: 3 },
	701: { max_turn: 2, action_round: 1 },
	705: { max_turn: 3 },
	706: { maximum_commitment: "mobilization" },
	708: { min_turn: 3 },
	711: { min_turn: 2 },
	718: { min_front: { russian: 4 } },
	730: { requires_event: cards.find((card) => card.id === 633).event },
	734: { requires_event: cards.find((card) => card.id === 737).event },
	738: { requires_event: cards.find((card) => card.id === 737).event },
	740: { requires_event: cards.find((card) => card.id === 737).event },
	744: { requires_event: cards.find((card) => card.id === 737).event },
	748: { requires_event: cards.find((card) => card.id === 737).event }
}

const reinforcementManifests = {
	603: {
		placement: "ap_port_or_supply",
		units: [
			{ piece: "component-097", count: 2, to: "map" },
			{ piece: "component-007", count: 1, to: "map" },
			{ piece: "component-005", count: 1, to: "map" },
			{ piece: "component-090", count: 2, to: "reserve" },
			{ piece: "component-089", count: 2, to: "reserve" },
			{ piece: "component-095", count: 1, to: "reserve" },
			{ piece: "component-098", count: 2, to: "reserve" }
		]
	},
	604: {
		placement: "ap_port_or_supply",
		units: [
			{ piece: "component-093", count: 2, to: "map" },
			{ piece: "component-094", count: 2, to: "reserve" },
			{ piece: "component-089", count: 1, to: "reserve" },
			{ piece: "component-095", count: 2, to: "reserve" }
		]
	},
	605: {
		placement: "ap_port_or_supply",
		units: [
			{ piece: "component-093", count: 2, to: "map" },
			{ piece: "component-094", count: 2, to: "reserve" },
			{ piece: "component-089", count: 1, to: "reserve" },
			{ piece: "component-095", count: 2, to: "reserve" }
		]
	},
	627: {
		placement: "italian_front",
		reduced_armies_unless_event: cards.find((card) => card.id === 625).event,
		units: [
			{ piece: "component-016", count: 3, to: "map" },
			{ piece: "component-015", count: 3, to: "map" },
			{ piece: "component-009", count: 1, to: "map" }
		]
	},
	630: {
		placement: "italian_front",
		units: [
			{ piece: "component-016", count: 1, to: "map", reduced: true },
			{ piece: "component-015", count: 1, to: "map", reduced: true },
			{ piece: "component-009", count: 1, to: "map" }
		]
	},
	607: {
		placement: "within_sources",
		sources: ["paris", "nancy"],
		max_distance: 2,
		units: [
			{ piece: "component-002", count: 1, to: "map" },
			{ piece: "component-028", count: 4, to: "map" }
		],
		free_sr: { nation: "fr", type: "army", count: 2, destinations: "reinforcement_spaces" }
	},
	615: {
		placement: "national_supply",
		rebuild: { faction: "ap", nation: "fr", count: 2, reduced: true, to: "reserve" },
		units: [
			{ piece: "component-105", count: 2, to: "map" },
			{ piece: "component-006", count: 1, to: "map" },
			{ piece: "component-105", count: 1, to: "upgrade" },
			{ piece: "component-104", count: 2, to: "upgrade" }
		]
	},
	616: {
		placement: "national_supply",
		rebuild: { faction: "ap", nation: "fr", count: 2, reduced: true, to: "reserve" },
		units: [
			{ piece: "component-105", count: 2, to: "map" },
			{ piece: "component-011", count: 1, to: "map" },
			{ piece: "component-105", count: 1, to: "upgrade" },
			{ piece: "component-104", count: 2, to: "upgrade" }
		]
	},
	617: {
		placement: "ap_port_or_supply",
		units: [
			{ piece: "component-099", count: 2, to: "map" },
			{ piece: "component-100", count: 3, to: "reserve" },
			{ piece: "component-101", count: 2, to: "reserve" },
			{ piece: "component-091", count: 1, to: "upgrade" },
			{ piece: "component-092", count: 1, to: "upgrade" }
		]
	},
	618: {
		placement: "ap_port_or_supply",
		units: [
			{ piece: "component-093", count: 2, to: "map" },
			{ piece: "component-092", count: 1, to: "reserve" },
			{ piece: "component-094", count: 1, to: "reserve" },
			{ piece: "component-095", count: 2, to: "reserve" },
			{ piece: "component-089", count: 1, to: "reserve" },
			{ piece: "component-091", count: 1, to: "upgrade" },
			{ piece: "component-092", count: 1, to: "upgrade" }
		]
	},
	619: {
		placement: "ap_port_or_supply",
		units: [
			{ piece: "component-093", count: 2, to: "map" },
			{ piece: "component-092", count: 1, to: "reserve" },
			{ piece: "component-094", count: 1, to: "reserve" },
			{ piece: "component-095", count: 2, to: "reserve" },
			{ piece: "component-089", count: 1, to: "reserve" },
			{ piece: "component-091", count: 1, to: "upgrade" },
			{ piece: "component-092", count: 1, to: "upgrade" }
		]
	},
	637: {
		placement: "italian_front",
		conditional_full: { occupied_nation: "it", event_card: 623 },
		units: [
			{ piece: "component-093", count: 1, to: "map", reduced: true },
			{ piece: "component-026", count: 1, to: "map", reduced: true },
			{ piece: "component-016", count: 2, to: "map" },
			{ piece: "component-015", count: 2, to: "reserve" }
		],
		sr_points: 2
	},
	645: {
		placement: "ap_port_or_supply",
		units: [
			{ piece: "component-093", count: 2, to: "map" },
			{ piece: "component-099", count: 1, to: "map" },
			{ piece: "component-094", count: 2, to: "reserve" },
			{ piece: "component-100", count: 2, to: "reserve" },
			{ piece: "component-091", count: 1, to: "upgrade" },
			{ piece: "component-092", count: 1, to: "upgrade" }
		]
	},
	646: {
		placement: "ap_port_or_supply",
		units: [
			{ piece: "component-103", count: 1, to: "map" },
			{ piece: "component-012", count: 1, to: "map" }
		]
	},
	711: {
		placement: "national_supply",
		units: [{ piece: "component-004", count: 1, to: "map" }]
	},
	649: { placement: "ap_port_or_supply", units: [{ piece: "component-102", count: 3, to: "map" }] },
	650: { placement: "ap_port_or_supply", units: [{ piece: "component-102", count: 3, to: "map" }] },
	655: {
		placement: "ap_port_or_supply",
		units: [
			{ piece: "component-101", count: 1, to: "reserve" },
			{ piece: "component-100", count: 1, to: "reserve" },
			{ piece: "component-089", count: 1, to: "reserve" },
			{ piece: "component-090", count: 1, to: "reserve" }
		]
	},
	715: {
		placement: "friendly_occupied",
		units: [
			{ piece: "component-108", count: 1, to: "map" },
			{ piece: "component-107", count: 2, to: "reserve" },
			{ piece: "component-108", count: 2, to: "upgrade" },
			{ piece: "component-107", count: 1, to: "upgrade" }
		]
	},
	717: {
		placement: "friendly_occupied",
		units: [
			{ piece: "component-108", count: 1, to: "map" },
			{ piece: "component-010", count: 1, to: "map" },
			{ piece: "component-107", count: 1, to: "reserve" },
			{ piece: "component-108", count: 2, to: "upgrade" },
			{ piece: "component-107", count: 2, to: "upgrade" }
		]
	},
	735: {
		placement: "italian_front",
		units: [
			{ piece: "component-166", count: 1, to: "map" },
			{ piece: "component-087", count: 1, to: "map" },
			{ piece: "component-033", count: 1, to: "map" },
			{ piece: "component-107", count: 1, to: "reserve" },
			{ piece: "component-034", count: 1, to: "reserve" }
		]
	},
	733: {
		placement: "national_supply",
		units: [
			{ piece: "component-021", count: 4, to: "eliminated" },
			{ piece: "component-014", count: 3, to: "reserve" }
		],
		optional_deploy: {
			requires_event_card: 625,
			rp: { faction: "cp", nation: "ah", amount: 4 },
			piece: "component-021",
			count: 2,
			nation: "ah"
		}
	},
	747: {
		placement: "national_supply",
		units: [
			{ piece: "component-008", count: 1, to: "reserve" },
			{ piece: "component-110", count: 3, to: "reserve" },
			{ piece: "component-109", count: 3, to: "reserve" }
		]
	},
	749: {
		placement: "national_supply",
		units: [
			{ piece: "component-110", count: 4, to: "reserve" },
			{ piece: "component-109", count: 4, to: "reserve" }
		]
	}
}

const moEffects = {
	615: {
		conditional_event: cards.find((card) => card.id === 616).event,
		nation: "fr",
		add: [{ key: "veteran_offensive", count: 1, attacks: 2, attack_drm_uses: 1 }]
	},
	616: {
		conditional_event: cards.find((card) => card.id === 615).event,
		nation: "fr",
		add: [{ key: "foreign_legion_offensive", count: 1, attacks: 2, attack_drm_uses: 1 }]
	},
	618: {
		conditional_event: cards.find((card) => card.id === 619).event,
		nation: "br",
		add: [{ key: "conscription_offensive", count: 1, attacks: 2, attack_drm_uses: 1 }],
		draw_bonus: 1
	},
	619: {
		conditional_event: cards.find((card) => card.id === 618).event,
		nation: "br",
		add: [{ key: "pals_offensive", count: 1, attacks: 2, attack_drm_uses: 1 }],
		draw_bonus: 1
	},
	627: {
		nation: "it",
		add: [{ key: "lose_italian_lcu", count: 3, attacks: 0, requirement: "lose_friendly_army" }],
		draw_bonus: 1
	},
	630: {
		nation: "it",
		add: [{ key: "politicians_lose_lcu", count: 1, attacks: 0, requirement: "lose_friendly_army" }],
		draw_limit: 1
	},
	633: {
		nation: "ah",
		add: [{ key: "enter_ap_italy", count: 3, attacks: 0, requirement: "enter_enemy_italy" }]
	},
	647: {
		nation: "fr",
		add: [{ key: "destroy_german_lcu", count: 2, attacks: 0, requirement: "destroy_enemy_army", target: "ge" }],
		draw_bonus: 1
	},
	649: {
		nation: "us",
		add: [{ key: "us_attack_win", count: 1, attacks: 1, requirement: "attack_win", reward_rp: 1 }],
		draw_count: 1
	},
	650: {
		nation: "us",
		add: [{ key: "us_defense_win", count: 1, attacks: 0, requirement: "defense_win_counterattack" }],
		draw_count: 1
	},
	705: {
		nation: "fr",
		add: [{ key: "advance_after_combat", count: 1, attacks: 2, requirement: "advance_after_combat" }]
	},
	711: {
		nation: "ge",
		add: [{ key: "destroy_french_lcu", count: 1, attacks: 0, requirement: "destroy_enemy_army", target: "fr" }]
	},
	737: {
		nation: "ge",
		add: [
			{
				key: "german_attack_drm",
				count: 2,
				attacks: 0,
				passive: "national_attack_drm",
				drm: -1
			}
		],
		completion_required: 1
	},
	743: {
		nation: "fr",
		add: [{ key: "mutiny_no_attack", count: 3, attacks: 0, prohibition: "attack" }],
		duration: "turn"
	},
	751: {
		nation: "ah",
		add: [{ key: "no_offensive", count: 1, attacks: 0 }]
	}
}

const delayedEffects = {
	614: {
		type: "delay_units",
		chooser: "ap",
		target_faction: "cp",
		location_nation: "fr",
		distinct_spaces: true,
		return_after_turns: 3,
		return_placement: "faction_supply",
		groups: [
			{ types: ["army"], count: 1 },
			{ types: ["corps"], count: 2 }
		]
	}
}

const ruleModifiers = {
	600: { key: "war_aid", routes: [["br", "fr"], ["fr", "br"], ["us", "fr"], ["fr", "us"]], limit: 2 },
	601: { key: "regional_rotation", first_rp: 2, later_rp: 1, nation: "fr", maximum_step_rp: 1 },
	606: { key: "channel_blockade", blocked_faction: "cp", periodic_vp: -1, turns: [4, 8, 12] },
	608: { key: "trench_capability", faction: "ap", level_one: true, level_two_commitment: "total", veteran_auto: true },
	625: {
		key: "italy_entry",
		restore_turn: 6,
		restore_nation: "it",
		restore_type: "army",
		restore_count: 4,
		free_ops_offset: 2,
		total_war_free_ops_offset: 1,
		total_war_rp: { faction: "ap", nation: "it", amount: 2 }
	},
	634: {
		key: "all_out_war",
		persist_separately: true,
		ignore_activation_nationality_once: true,
		selective_trench_nations: [["br"], ["fr", "us"]]
	},
	646: { key: "aef_replacements", piece: "component-103", per_turn: 3, maximum: 9, port_turn: 9 },
	626: { key: "turkish_front_step_payment", nations: ["br", "in", "ca"], vp: -1 },
	635: { key: "influenza", full_armies_per_faction: 4, complete_mo: { faction: "ap", count: 1 } },
	636: { key: "allenby", extra_front_step_rp: { faction: "ap", nation: "br", amount: 1 } },
	651: { key: "activation_conversion", chooser: "ap", target: "cp", maximum: 2, adjacent_enemy: true },
	652: { key: "women_labor", grants_printed_ops: true, sr_value: 4, search: "army_reinforcement" },
	653: { key: "salonika", remove: { fr_corps: 2, br_corps: 2 } },
	657: { key: "victory_or_collapse", us_entry: -1, rebuild_limits: { ge: [1, 2], ap: [2, 2], us: null } },
	700: { key: "race_to_sea", previous_enemy_control_entry_limit: 3, grants_printed_ops: true },
	701: { key: "august_guns", destroy_adjacent_belgian_fort: true, activate_spaces: 2 },
	704: { key: "burgfrieden", recurring_rp: { faction: "cp", nation: "east", amount: 1 }, canceled_by_card: 724, end_vp_after_cancel: 1 },
	705: { key: "french_offensive_doctrine", target_faction: "ap", attack_spaces: 2 },
	706: { key: "tannenberg_heroes" },
	707: {
		key: "schlieffen_plan",
		grants_printed_ops: true,
		preactivation_sr_corps: true,
		allow_temporary_overstack: true
	},
	708: { key: "trench_capability", faction: "cp", level_one: true, level_two_commitment: "total", veteran_auto: true },
	713: { key: "ohl", discard_for_combat_card: true, timing: "action_end", return_turns: 1 },
	716: { key: "zeppelin_raids", turns: 3, recurring_rp_loss: { ap: { br: 1, us: 0.5 } } },
	718: { key: "tsar_command" },
	720: { key: "killing_ground", fort_fire: 0, escalating_ge_rp: 1, destroy_vp: 1 },
	723: { key: "uboat_offensive", damaged_british_reinforcements: true, unrestricted_naval: 5 },
	725: {
		key: "bulgaria",
		response_turns: 2,
		remove_nation: "fr",
		remove_type: "army",
		alternative_vp: 1
	},
	726: { key: "permanent_unit_removal", chooser: "ap" },
	727: { key: "gorlitz_tarnow", complete_mo: { nation: "ge", count: 1 } },
	728: { key: "gallipoli_lock", track: "turkish", duration: "turn" },
	736: { key: "hindenburg_line", end_vp_per_marker: 1, fortify_level_two_trench: true },
	737: { key: "hindenburg_ludendorff", extra_russian_front_cost: 5.5 },
	745: { key: "brest_litovsk", lock_front: "russian", russian_maintenance_discount: 1 },
	752: { key: "white_feather", required_sr_corps: { fr: 1, br: 1 }, cp_search: ["war_industry", "ge_reinforcement"] },
	754: { key: "choice_resolution" },
	755: { key: "jutland", suppress_blockade_vp: true, duration: "turn" },
	756: { key: "desertion", italian_attack_step_loss: 1, cancel_turn: 12, cadorna_immediate_losses: 2 },
	758: { key: "kemal", turkish_front_cost_increase: 1, duration: "turn" }
}

const extraAtomicOperations = {
	604: [
		{
			type: "step_loss",
			faction: "ap",
			piece: "component-097",
			replacement_piece: "component-098",
			replacement_to: "reserve"
		}
	],
	605: [
		{
			type: "step_loss",
			faction: "ap",
			piece: "component-097",
			replacement_piece: "component-098",
			replacement_to: "reserve"
		}
	],
	633: [
		{ type: "vp", amount: -1 },
		{ type: "front", track: "russian", amount: -1 }
	],
	626: [{ type: "front", track: "turkish", amount: 1 }],
	635: [{ type: "vp", amount: -1 }],
	636: [{ type: "front", track: "turkish", amount: 1 }],
	646: [{ type: "vp", amount: -1 }],
	647: [
		{ type: "end_vp", amount: -2 },
		{ type: "entry_track", track: "armistice", amount: 1, recurring: true }
	],
	655: [{ type: "front", track: "turkish", amount: 1 }],
	656: [{ type: "entry_track", track: "us", amount: -1 }],
	706: [
		{ type: "front", track: "russian", amount: 1 },
		{ type: "rp", faction: "cp", nation: "ah", amount: 1 },
		{ type: "rp", faction: "cp", nation: "east", amount: 2 }
	],
	718: [
		{ type: "front", track: "russian", amount: 1 },
		{ type: "rp", faction: "cp", nation: "east", amount: 2 }
	],
	727: [
		{ type: "front", track: "russian", amount: 1 },
		{ type: "rp", faction: "cp", nation: "east", amount: 2 },
		{ type: "rp", faction: "cp", nation: "ah", amount: 2 }
	],
	728: [{ type: "front", track: "turkish", amount: -1 }],
	743: [{ type: "rp", faction: "ap", nation: "fr", amount: -2 }],
	715: [
		{
			type: "rp",
			faction: "cp",
			nation: "ge",
			amount: 1,
			unless_event: cards.find((card) => card.id === 724).event
		}
	],
	717: [
		{
			type: "rp",
			faction: "cp",
			nation: "ge",
			amount: 1,
			unless_event: cards.find((card) => card.id === 724).event
		}
	],
	746: [
		{ type: "vp", amount: 1, max_turn: 10 },
		{ type: "entry_track", track: "us", amount: -1, recurring: true }
	],
	747: [
		{
			type: "event_cost",
			requires_event: cards.find((card) => card.id === 745).event,
			alternative_front: { track: "russian", amount: -1 }
		}
	],
	749: [
		{
			type: "event_cost",
			requires_event: cards.find((card) => card.id === 745).event,
			alternative_front: { track: "russian", amount: -1 }
		}
	],
	750: [
		{
			type: "entry_track",
			track: "armistice",
			amount: -1,
			recurring: true,
			unless_event: cards.find((card) => card.id === 745).event
		}
	],
	758: [{ type: "front", track: "turkish", amount: -1 }]
}

const opsEffects = {
	649: { attack_column: 1, ignore_trench_with_nation: "us" },
	650: { attack_column: 1, ignore_trench_with_nation: "us" },
	730: { attack_only: true, nation: "it", no_italian_bonus: true }
}

function definitionOperations(card, definition = {}) {
	const operations = []
	if (definition.vp) operations.push({ type: "vp", amount: definition.vp })
	for (const [nation, amount] of Object.entries(definition.rp || {}))
		operations.push({ type: "rp", faction: card.faction, nation, amount })
	for (const [track, amount] of Object.entries(definition.fronts || {}))
		operations.push({ type: "front", track, amount })
	if (definition.kind === "entry") operations.push({ type: "entry", nation: definition.nation })
	if (definition.cancel) operations.push({ type: "cancel_event", event: definition.cancel })
	if (definition.replacement_bonus)
		operations.push({
			type: "replacement_bonus",
			values: definition.replacement_bonus,
			free_upgrade: definition.free_upgrade || null
		})
	if (definition.end_vp) operations.push({ type: "end_vp", amount: definition.end_vp })
	if (definition.recurring_rp_loss) operations.push({ type: "recurring_rp_loss", values: definition.recurring_rp_loss })
	if (reinforcementManifests[card.id])
		operations.push({ type: "reinforcement", ...reinforcementManifests[card.id] })
	if (moEffects[card.id]) operations.push({ type: "mo_modify", ...moEffects[card.id] })
	if (delayedEffects[card.id]) operations.push(delayedEffects[card.id])
	if (combatEffects[card.id]) operations.push({ type: "combat_modifier", card: card.id })
	if (ruleModifiers[card.id]) operations.push({ type: "rule_modifier", ...ruleModifiers[card.id] })
	if (extraAtomicOperations[card.id]) operations.push(...extraAtomicOperations[card.id])
	if (operations.length === 0 && eventChoices[card.id])
		operations.push({ type: "choice_resolution", choices: eventChoices[card.id].map((choice) => choice.id) })
	if (operations.length === 0) throw new Error(`Card ${card.id} has no structured operation`)
	return operations
}

const cardEffects = Object.fromEntries(
	cards.map((card) => {
		const definition = events[card.event] || {}
		const prerequisites = prerequisiteOverrides[card.id] || {}
		const combat = combatEffects[card.id] || null
		const rule = ruleModifiers[card.id] || null
		const duration =
			combat?.duration ||
			rule?.duration ||
			(card.combat_card ? "combat" : definition.kind === "persistent" ? "game" : "instant")
		return [
			String(card.id),
			{
				card_id: card.id,
				event: card.event,
				timing: card.combat_card ? ["combat"] : card.naval_card ? ["action", "naval"] : ["action"],
				commitment: card.commitment,
				prerequisites: {
					min_turn: prerequisites.min_turn || definition.min_turn || null,
					max_turn: prerequisites.max_turn || definition.max_turn || null,
					action_round: prerequisites.action_round || null,
					requires_event: prerequisites.requires_event || definition.requires_event || null,
					requires_any_event: prerequisites.requires_any_event || definition.requires_any_event || [],
					forbids_event: prerequisites.forbids_event || null,
					min_front: prerequisites.min_front || definition.min_front || null,
					min_combined_war_status: prerequisites.min_combined_war_status || null,
					maximum_commitment: prerequisites.maximum_commitment || null,
					min_turn_or_event_count: prerequisites.min_turn_or_event_count || null
				},
				choices: eventChoices[card.id] || [],
				operations: definitionOperations(card, definition),
				combat,
				ops: opsEffects[card.id] || null,
				duration,
				cleanup: duration === "combat" ? "combat_end" : duration === "action_round" ? "action_round_end" : duration === "turn" ? "turn_end" : null,
				disposition: card.remove ? "remove" : "discard",
				source_text: card.effect
			}
		]
	})
)
write("card_effects.json", cardEffects)

write("title.json", {
	id: "end-of-glory",
	name: "End of Glory",
	name_zh: "荣耀终结",
	roles: ["Allied Powers", "Central Powers"],
	default_scenario: "1914 Historical",
	turns: 15,
	action_rounds: 6,
	hand_size: 9
})

console.log(
	JSON.stringify({
		cards: cards.length,
		mo: Object.values(mo).flat().length,
		spaces: spaces.length,
		edges: rawEdges.length,
		pieces: pieces.length
	})
)
