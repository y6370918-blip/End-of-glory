import { createReadStream, existsSync } from "node:fs"
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { extname, join, normalize } from "node:path"
import { homedir, tmpdir } from "node:os"
import { Buffer } from "node:buffer"
import {
	auditMapSource,
	EDITOR_EDGE_FLAGS,
	EDITOR_EDGE_TYPES,
	EDITOR_FACTIONS,
	EDITOR_MODES,
	EDITOR_NATIONS,
	EDITOR_TERRAINS
} from "./map_editor_audit.mjs"
import { auditManifest, createAuditManifest, sha256 } from "./map_audit_manifest.mjs"
import {
	auditMultiRegionScopeErrors,
	changedRegions,
	commitConfirmedProposals,
	prepareMultiRegionSave,
	reconcileDraftManifest,
	sourceRevision,
	workingMap
} from "./map_editor_workflow.mjs"

const root = normalize(join(import.meta.dirname, ".."))
if (process.env.NODE_ENV === "production") throw new Error("The EOG map editor is disabled in production")
const MAP_EDITOR_PROTOCOL = 5
const sourceRoot = join(root, "data", "source")
const port = Number(process.argv[2] || 8766)
const files = Object.freeze({
	spaces: join(sourceRoot, "spaces.json"),
	edges: join(sourceRoot, "edges.json"),
	ui: join(sourceRoot, "ui.json"),
	manifest: join(sourceRoot, "map_audit.json")
})
const generatedData = join(root, "data.js")
const mapImage = join(root, "assets", "map.png")
const buildErrorLog = join(root, "tmp", "map-editor-build-error.txt")
const mime = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".webp": "image/webp"
}

function historicalSetupText(source) {
	const start = source.indexOf("function set_up_historical_scenario()")
	if (start < 0) throw new Error("Historical setup function was not found")
	const brace = source.indexOf("{", start)
	let depth = 0
	for (let index = brace; index < source.length; index += 1) {
		if (source[index] === "{") depth += 1
		else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1)
	}
	throw new Error("Historical setup function is incomplete")
}

function reply(response, status, payload) {
	response.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" })
	response.end(JSON.stringify(payload, null, 2))
}

async function body(request) {
	const chunks = []
	for await (const chunk of request) chunks.push(chunk)
	return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

async function loadCurrent() {
	const [spaces, edges, ui, rawManifest, mapSha256] = await Promise.all([
		readFile(files.spaces, "utf8").then(JSON.parse),
		readFile(files.edges, "utf8").then(JSON.parse),
		readFile(files.ui, "utf8").then(JSON.parse),
		readFile(files.manifest, "utf8").then(JSON.parse),
		sha256(mapImage)
	])
	const manifest = rawManifest.schema === 2
		? rawManifest
		: createAuditManifest({ spaces, edges, mapSha256, previous: rawManifest })
	const formal = { spaces, edges, ui }
	return { formal, manifest, mapSha256, revision: sourceRevision({ ...formal, manifest }) }
}

function combinedAudit(formal, manifest, mapSha256) {
	const formalReport = auditMapSource(formal.spaces, formal.edges, formal.ui)
	const draft = workingMap(formal, manifest)
	const draftReport = auditMapSource(draft.spaces, draft.edges, draft.ui)
	const manifestReport = auditManifest(manifest, formal.spaces, formal.edges, mapSha256)
	return {
		ok: formalReport.ok && draftReport.ok && manifestReport.ok,
		errors: [...formalReport.errors, ...draftReport.errors, ...manifestReport.errors],
		warnings: manifestReport.warnings,
		counts: { ...formalReport.counts, ...manifestReport.counts }
	}
}

function buildFailureDetail(build) {
	const lines = (build.output || build.error || `exit ${build.code}`).trim().split(/\r?\n/).filter(Boolean)
	return lines.find((line) => line.startsWith("Error: "))?.slice(7) || lines.at(-1) || "unknown build error"
}

function sourcePayload(current, report = combinedAudit(current.formal, current.manifest, current.mapSha256)) {
	const draft = workingMap(current.formal, current.manifest)
	return {
		...draft,
		formal: current.formal,
		mapAudit: current.manifest,
		mapAuditReport: report,
		baseRevision: current.revision,
		editorProtocol: MAP_EDITOR_PROTOCOL,
		modes: EDITOR_MODES,
		edgeTypes: EDITOR_EDGE_TYPES,
		edgeFlags: EDITOR_EDGE_FLAGS,
		spaceTerrains: EDITOR_TERRAINS,
		spaceNations: EDITOR_NATIONS,
		spaceFactions: EDITOR_FACTIONS
	}
}

async function runCommand(command, args, options = {}) {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			cwd: root,
			env: { ...process.env, ...(options.env || {}) },
			windowsHide: true
		})
		let output = ""
		let finished = false
		child.stdout.on("data", (chunk) => { output += chunk })
		child.stderr.on("data", (chunk) => { output += chunk })
		child.on("error", (error) => {
			if (!finished) { finished = true; resolve({ code: null, output, error: error.message }) }
		})
		child.on("close", (code) => {
			if (!finished) { finished = true; resolve({ code, output, error: null }) }
		})
	})
}

async function runBuild(sourceDirectory = sourceRoot, outputFile = generatedData) {
	return runCommand(process.execPath, [join(root, "tools", "build_data.mjs")], {
		env: { EOG_DATA_SOURCE_DIR: sourceDirectory, EOG_DATA_OUTPUT: outputFile }
	})
}

async function renderMapAudit() {
	const bundled = join(homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe")
	const candidates = [
		[process.env.PYTHON, []],
		["python", []],
		[existsSync(bundled) ? bundled : null, []],
		["py", ["-3"]]
	].filter(([command]) => command)
	const attempts = []
	for (const [command, prefix] of candidates) {
		const result = await runCommand(command, [...prefix, join(root, "tools", "render_space_audit.py")])
		attempts.push({ command, ...result })
		if (result.code === 0) return { ok: true, output: result.output.trim(), attempts: attempts.length }
	}
	return { ok: false, output: attempts.map((attempt) => attempt.output || attempt.error).filter(Boolean).join("\n"), attempts: attempts.length }
}

async function copySourceDirectory(destination) {
	await mkdir(destination, { recursive: true })
	for (const entry of await readdir(sourceRoot, { withFileTypes: true }))
		if (entry.isFile()) await copyFile(join(sourceRoot, entry.name), join(destination, entry.name))
}

async function saveChanges(value) {
	const current = await loadCurrent()
	if (value.editorProtocol != null && value.editorProtocol !== MAP_EDITOR_PROTOCOL) return { status: 409, payload: { ok: false, stale: true, errors: ["地图编辑器版本不一致，请重新启动编辑器服务器并刷新页面"] } }
	if (value.baseRevision !== current.revision) return { status: 409, payload: { ok: false, stale: true, errors: ["地图数据已变化，请重新载入后再编辑"] } }
	const reconciled = reconcileDraftManifest(current.formal, current.manifest, value.mapAudit, value)
	const incoming = reconciled.manifest
	const regions = changedRegions(incoming, current.formal)
	const errors = [...reconciled.errors, ...auditMultiRegionScopeErrors(current.manifest, incoming, regions)]
	if (!regions.length) errors.push("没有可保存的地块或连接修改")
	if (errors.length) return { status: 422, payload: { ok: false, errors: [...new Set(errors)] } }

	const manifest = prepareMultiRegionSave(incoming, regions, current.formal)
	const formal = commitConfirmedProposals(current.formal, manifest)
	const report = combinedAudit(formal, manifest, current.mapSha256)
	if (!report.ok) return { status: 422, payload: { ...report, ok: false } }

	const backupRoot = await mkdtemp(join(tmpdir(), "eog-map-editor-"))
	const stagedSource = join(backupRoot, "source")
	const stagedData = join(backupRoot, "data.js")
	const backupFiles = { ...files, data: generatedData }
	const historicalBefore = historicalSetupText(await readFile(join(root, "rules.js"), "utf8"))
	try {
		await copySourceDirectory(stagedSource)
		for (const [name, data] of Object.entries({ ...formal, map_audit: manifest }))
			await writeFile(join(stagedSource, `${name === "map_audit" ? "map_audit" : name}.json`), `${JSON.stringify(data, null, 2)}\n`, "utf8")
		let build = await runBuild(stagedSource, stagedData)
		if (build.code) build = await runBuild(stagedSource, stagedData)
		if (build.code) {
			const detail = buildFailureDetail(build)
			throw Object.assign(new Error(`Data build failed before commit：${detail}`), { build })
		}
		const stagedReport = combinedAudit(formal, manifest, current.mapSha256)
		if (!stagedReport.ok) throw new Error(`Staged-data audit failed: ${stagedReport.errors.join("; ")}`)
		for (const [name, file] of Object.entries(backupFiles)) await copyFile(file, join(backupRoot, `${name}.bak`))
		for (const [name, file] of Object.entries(files)) {
			const stagedName = name === "manifest" ? "map_audit.json" : `${name}.json`
			await copyFile(join(stagedSource, stagedName), file)
		}
		await copyFile(stagedData, generatedData)
		const rebuilt = await loadCurrent()
		const rebuiltReport = combinedAudit(rebuilt.formal, rebuilt.manifest, rebuilt.mapSha256)
		if (!rebuiltReport.ok) throw new Error(`Post-build audit failed: ${rebuiltReport.errors.join("; ")}`)
		const historicalAfter = historicalSetupText(await readFile(join(root, "rules.js"), "utf8"))
		if (historicalBefore !== historicalAfter) throw new Error("Historical setup fingerprint changed")
		const render = await renderMapAudit()
		await rm(buildErrorLog, { force: true })
		return { status: 200, payload: { ok: true, build, render, recovered: false, ...sourcePayload(rebuilt, rebuiltReport) } }
	} catch (error) {
		const buildDetail = error.build?.output || error.build?.error || ""
		await mkdir(join(root, "tmp"), { recursive: true })
		await writeFile(buildErrorLog, `${new Date().toISOString()}\n${error.message}\n${buildDetail}\n`, "utf8").catch(() => {})
		let recovered = false
		try {
			for (const [name, file] of Object.entries(backupFiles))
				if (await stat(join(backupRoot, `${name}.bak`)).catch(() => null)) await copyFile(join(backupRoot, `${name}.bak`), file)
			recovered = true
		} catch (recoveryError) {
			return { status: 500, payload: { ok: false, recovered: false, errors: [error.message, `Recovery failed: ${recoveryError.message}`], build: error.build || null } }
		}
		return { status: 500, payload: { ok: false, recovered, errors: [error.message, buildDetail].filter(Boolean), build: error.build || null } }
	} finally {
		await rm(backupRoot, { recursive: true, force: true })
	}
}

createServer(async (request, response) => {
	const url = new URL(request.url, "http://localhost")
	try {
		if (url.pathname === "/api/source" && request.method === "GET") {
			const current = await loadCurrent()
			return reply(response, 200, sourcePayload(current))
		}
		if (url.pathname === "/api/audit" && request.method === "POST") {
			const value = await body(request)
			const current = await loadCurrent()
			const report = combinedAudit({ spaces: value.spaces, edges: value.edges, ui: value.ui }, value.mapAudit, current.mapSha256)
			return reply(response, report.ok ? 200 : 422, report)
		}
		if (url.pathname === "/api/save" && request.method === "PUT") {
			const result = await saveChanges(await body(request))
			return reply(response, result.status, result.payload)
		}
		const relative = url.pathname === "/" ? "tools/map-editor/index.html" : url.pathname.replace(/^\/+/, "")
		const filename = normalize(join(root, relative))
		if (!filename.startsWith(root)) return response.writeHead(403).end("Forbidden")
		const info = await stat(filename)
		if (!info.isFile()) throw new Error("Not a file")
		response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": mime[extname(filename).toLowerCase()] || "application/octet-stream" })
		createReadStream(filename).pipe(response)
	} catch (error) {
		if (url.pathname.startsWith("/api/")) return reply(response, 500, { ok: false, errors: [error.message] })
		response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found")
	}
}).listen(port, "127.0.0.1", () => {
	process.stdout.write(`EOG map editor: http://127.0.0.1:${port}\n`)
})
