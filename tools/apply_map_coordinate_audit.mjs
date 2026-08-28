import path from "node:path"
import { auditManifest, loadMapAudit } from "./map_audit_manifest.mjs"

const root = path.resolve(import.meta.dirname, "..")
const value = await loadMapAudit(root)
const report = auditManifest(value.manifest, value.spaces, value.edges, value.mapSha256)
process.stderr.write("This command is now read-only. Map positions and connections require region approval and must not be inferred or batch-applied.\n")
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (!report.ok) process.exitCode = 1
