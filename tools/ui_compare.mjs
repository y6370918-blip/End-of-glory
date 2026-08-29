import { chromium } from "@playwright/test"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { createReadStream } from "node:fs"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, normalize } from "node:path"

const require = createRequire(import.meta.url)
const eogRoot = normalize(join(import.meta.dirname, ".."))
const publicRoot = normalize(join(eogRoot, ".."))
const pugRoot = normalize(join(publicRoot, "paths-of-glory-schlieffen-edition", "PUG-main"))
const outputRoot = normalize(join(eogRoot, "test-results", "ui-compare"))
const runtimeRoot = normalize(join(outputRoot, ".runtime"))
const port = Number(process.env.EOG_UI_COMPARE_PORT || 8878)

const viewports = [
	{ name: "desktop", width: 1920, height: 1080 },
	{ name: "laptop", width: 1366, height: 768 },
	{ name: "mobile", width: 390, height: 844 },
	{ name: "landscape", width: 844, height: 390 }
]
const dprs = [1, 2]
const scales = [0.5, 0.72, 1, 1.2]
const quick = process.env.EOG_UI_COMPARE_QUICK === "1"

const mime = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webp": "image/webp"
}

function buildEogPreview() {
	const result = spawnSync(process.execPath, ["tools/build_preview.mjs", "action-card"], {
		cwd: eogRoot,
		stdio: "inherit"
	})
	if (result.status !== 0) throw new Error("Failed to build the EOG visual preview")
}

async function buildPugPreview() {
	const rules = require(join(pugRoot, "rules.js"))
	const state = rules.setup(1914, "Historical", { seed: 42, no_supply_warnings: true })
	const view = rules.view(state, "Central Powers")
	view.log = [
		".h1 Turn 1",
		".h2 行动阶段",
		"#cp 战斗：Verdun",
		"*进攻方：同盟国",
		"> 德国单位发起进攻",
		"*防守方：协约国",
		"> 法国单位防守",
		"*开火与损失",
		">> 同盟国骰点 B5",
		">> 协约国骰点 W2",
		"> 撤退与挺进"
	]

	await mkdir(runtimeRoot, { recursive: true })
	await writeFile(
		join(runtimeRoot, "pug-state.js"),
		`window.view = ${JSON.stringify(view)};
window.params = { title_id: "pursuit-of-glory" };
window.player = "Central Powers";
window.roles = [];
window.replay = 0;
window.send_action = function () {};
window.send_query = function () {};
window.toggle_zoom = function () {};
window.update_zoom = function () {};
window.action_button = function (action, label) {
	const actions = document.getElementById("actions");
	if (!actions || !window.view?.actions || !(action in window.view.actions)) return;
	const button = document.createElement("button");
	button.textContent = label;
	actions.append(button);
};
window.action_button_imp = window.action_button;
window.action_button_with_argument = function (action, _arg, label) { window.action_button(action, label); };

document.addEventListener("DOMContentLoaded", function () {
	const header = document.querySelector("header");
	const main = document.querySelector("main");
	const inner = document.createElement("div");
	inner.id = "pan_zoom_main";
	inner.dataset.scale = "1";
	inner.style.transformOrigin = "0 0";
	while (main.firstChild) inner.append(main.firstChild);
	const outer = document.createElement("div");
	outer.id = "pan_zoom_wrap";
	outer.append(inner);
	main.append(outer);
	const toolbar = document.getElementById("toolbar");
	const first = toolbar.querySelector(":scope > details");
	for (const [id, icon] of [["zoom_button", "magnifying-glass"], ["chat_button", "chat-bubble"], ["log_button", "scroll-quill"]]) {
		const button = document.createElement("button");
		button.id = id;
		button.innerHTML = '<img src="/images/' + icon + '.svg" alt="">';
		first.after(button);
	}
	const actions = document.createElement("div");
	actions.id = "actions";
	const prompt = document.createElement("div");
	prompt.id = "prompt";
	prompt.textContent = window.view.prompt || "";
	header.append(actions, prompt);
	for (const definition of [["Allied Powers", "协约国"], ["Central Powers", "同盟国"]]) {
		const element = document.getElementById("role_" + definition[0].replace(/\\W/g, "_"));
		element.querySelector(".role_user").textContent = "视觉对比";
		window.roles.push({ role: definition[0], element, name: element.querySelector(".role_name"), stat: element.querySelector(".role_stat") });
	}
	if (typeof window.on_update === "function") window.on_update();
	const log = document.getElementById("log");
	log.replaceChildren();
	for (const [index, entry] of (window.view.log || []).entries()) log.append(window.on_log(entry, index));
	if (window.innerWidth <= 800) document.querySelector("aside").hidden = true;
});
`,
		"utf8"
	)

	const source = await readFile(join(pugRoot, "play.html"), "utf8")
	const preview = source
		.replace("<head>", '<head>\n\t\t<base href="/pug/">')
		.replace('<script defer src="/common/client.js"></script>', '<script defer src="/compare/pug-state.js"></script>')
		.replace("<title>PURSUIT OF GLORY</title>", "<title>PUG - 视觉对比</title>")
	await writeFile(join(runtimeRoot, "pug-preview.html"), preview, "utf8")
}

function resolveRequest(pathname) {
	const routes = [
		["/eog/", eogRoot],
		["/pug/", pugRoot],
		["/compare/", runtimeRoot],
		["/common/", join(publicRoot, "common")],
		["/fonts/", join(publicRoot, "fonts")],
		["/images/", join(publicRoot, "images")]
	]
	for (const [prefix, root] of routes) {
		if (!pathname.startsWith(prefix)) continue
		const filename = normalize(join(root, pathname.slice(prefix.length)))
		if (!filename.startsWith(normalize(root))) return null
		return filename
	}
	return null
}

async function startServer() {
	const server = createServer(async (request, response) => {
		const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname)
		const filename = resolveRequest(pathname)
		if (!filename) {
			response.writeHead(404).end("Not found")
			return
		}
		try {
			const info = await stat(filename)
			if (!info.isFile()) throw new Error("Not a file")
			response.writeHead(200, {
				"Cache-Control": "no-store",
				"Content-Type": mime[extname(filename).toLowerCase()] || "application/octet-stream"
			})
			createReadStream(filename).pipe(response)
		} catch {
			response.writeHead(404).end("Not found")
		}
	})
	await new Promise((resolve, reject) => {
		server.once("error", reject)
		server.listen(port, "127.0.0.1", resolve)
	})
	return server
}

async function setScale(page, scale, isEog) {
	await page.evaluate(({ scale, isEog }) => {
		const doc = globalThis.document
		const inner = doc.getElementById("pan_zoom_main")
		const mapwrap = doc.getElementById("mapwrap")
		if (inner) {
			inner.dataset.scale = String(scale)
			inner.style.transform = `scale(${scale})`
		}
		if (mapwrap) mapwrap.dataset.scale = "1"
		if (isEog && typeof globalThis.syncBoardPanelLayout === "function") globalThis.syncBoardPanelLayout()
	}, { scale, isEog })
}

function comparisonIndex(rows) {
	return `<!doctype html><meta charset="utf-8"><title>EOG / PUG UI compare</title>
<style>body{font-family:sans-serif;margin:20px;background:#ddd}section{margin:24px 0;padding:12px;background:white}h2{margin:0 0 10px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pair img{width:100%;border:1px solid #555}.label{display:grid;grid-template-columns:1fr 1fr;font-weight:bold}.cards{margin-top:18px}</style>
<h1>EOG / PUG 实机视觉对比</h1>${rows.join("\n")}`
}

async function capture() {
	const server = await startServer()
	const browser = await chromium.launch()
	const rows = []
	try {
		for (const viewport of quick ? viewports.slice(0, 1) : viewports) {
			for (const dpr of quick ? dprs.slice(0, 1) : dprs) {
				const context = await browser.newContext({
					viewport: { width: viewport.width, height: viewport.height },
					deviceScaleFactor: dpr,
					colorScheme: "light",
					locale: "zh-CN"
				})
				for (const scale of quick ? scales.slice(2, 3) : scales) {
					const folder = `${viewport.name}-dpr${dpr}-scale${String(scale).replace(".", "_")}`
					const destination = join(outputRoot, folder)
					await mkdir(destination, { recursive: true })
					const eog = await context.newPage()
					await eog.goto(`http://127.0.0.1:${port}/eog/.preview.action-card.html`, { waitUntil: "networkidle" })
					await setScale(eog, scale, true)
					await eog.screenshot({ path: join(destination, "eog-shell.png") })
					await eog.locator(".panel:has(#cards)").scrollIntoViewIfNeeded()
					await eog.locator(".panel:has(#cards)").screenshot({ path: join(destination, "eog-cards.png") })
					await eog.close()

					const pug = await context.newPage()
					await pug.goto(`http://127.0.0.1:${port}/compare/pug-preview.html`, { waitUntil: "networkidle" })
					await setScale(pug, scale, false)
					await pug.screenshot({ path: join(destination, "pug-shell.png") })
					await pug.locator(".panel:has(#cards)").scrollIntoViewIfNeeded()
					await pug.locator(".panel:has(#cards)").screenshot({ path: join(destination, "pug-cards.png") })
					await pug.close()
					rows.push(`<section><h2>${viewport.width}×${viewport.height} · DPR ${dpr} · scale ${scale}</h2><div class="label"><div>EOG</div><div>PUG</div></div><div class="pair"><img src="${folder}/eog-shell.png"><img src="${folder}/pug-shell.png"></div><div class="pair cards"><img src="${folder}/eog-cards.png"><img src="${folder}/pug-cards.png"></div></section>`)
				}
				await context.close()
			}
		}
		await writeFile(join(outputRoot, "index.html"), comparisonIndex(rows), "utf8")
	} finally {
		await browser.close()
		await new Promise((resolve) => server.close(resolve))
	}
}

buildEogPreview()
await buildPugPreview()
await capture()
process.stdout.write(`UI comparison written to ${join(outputRoot, "index.html")}\n`)
