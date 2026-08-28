import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createWorker, PSM } from "tesseract.js"

const root = join(import.meta.dirname, "..")
const requested = new Set(
	(process.argv.find((arg) => arg.startsWith("--ids="))?.slice(6) || "")
		.split(",")
		.filter(Boolean)
		.map(Number)
)
const cards = [
	...Array.from({ length: 59 }, (_, index) => ({ id: 600 + index, faction: "ap" })),
	...Array.from({ length: 59 }, (_, index) => ({ id: 700 + index, faction: "cp" }))
].filter((card) => requested.size === 0 || requested.has(card.id))

function normalize(text) {
	return text
		.replace(/\r/g, "")
		.replace(/[ \t]+/g, " ")
		.replace(/([\p{Script=Han}，。：；、（）【】]) +(?=[\p{Script=Han}，。：；、（）【】])/gu, "$1")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
}

const worker = await createWorker(["chi_sim", "eng"])
await worker.setParameters({
	preserve_interword_spaces: "1",
	tessedit_pageseg_mode: PSM.SINGLE_BLOCK
})

const result = []
for (const [index, card] of cards.entries()) {
	const filename = join(root, "assets", "cards", card.faction, `${card.id}@2x.webp`)
	const recognition = await worker.recognize(filename, {
		rectangle: { left: 0, top: 390, width: 800, height: 694 }
	})
	result.push({
		id: card.id,
		confidence: Math.round(recognition.data.confidence * 10) / 10,
		raw: recognition.data.text.trim(),
		text: normalize(recognition.data.text)
	})
	process.stdout.write(`${index + 1}/${cards.length} ${card.id} ${Math.round(recognition.data.confidence)}%\n`)
}
await worker.terminate()

await mkdir(join(root, "data", "generated"), { recursive: true })
const suffix = requested.size ? `-${[...requested].join("-")}` : ""
const output = join(root, "data", "generated", `card_ocr${suffix}.json`)
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8")
process.stdout.write(`${output}\n`)
