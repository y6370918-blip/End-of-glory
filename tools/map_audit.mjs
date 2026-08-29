import path from "node:path"
import { auditManifest, loadMapAudit } from "./map_audit_manifest.mjs"

const root = path.resolve(import.meta.dirname, "..")
const value = await loadMapAudit(root)
const report = auditManifest(value.manifest, value.spaces, value.edges, value.mapSha256, {
	requireConfirmed: process.argv.includes("--require-confirmed")
})
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (!report.ok) process.exitCode = 1
