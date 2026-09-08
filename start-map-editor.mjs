import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const noOpen = args.includes("--no-open");
const portArgs = args.filter(arg => arg !== "--no-open");
const port = portArgs.length ? Number(portArgs[0]) : 8766;
const server = join(root, "tools", "map_editor_server.mjs");

if (Number(process.versions.node.split(".")[0]) < 22) {
  console.error("Node.js 22 or newer is required.");
  process.exit(1);
}
if (portArgs.length > 1 || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Usage: start-map-editor.cmd [port] [--no-open]");
  process.exit(1);
}
if (!existsSync(server)) {
  console.error("Map editor files are missing: tools/map_editor_server.mjs");
  console.error("Use the full development project, not the server deployment package.");
  process.exit(1);
}

const url = `http://127.0.0.1:${port}/`;
console.log(`Starting EOG map editor: ${url}`);
console.log("Keep this window open. Type q then Enter, or press Ctrl+C, to stop.");
const child = spawn(process.execPath, [server, String(port)], {
  cwd: root,
  stdio: ["ignore", "pipe", "inherit"],
  windowsHide: true,
});
let ready = false;
let output = "";
child.stdout.on("data", chunk => {
  process.stdout.write(chunk);
  output = (output + chunk.toString()).slice(-4096);
  if (ready || !output.includes(`EOG map editor: http://127.0.0.1:${port}`)) return;
  ready = true;
  if (noOpen) return;
  const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const browserArgs = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const browser = spawn(command, browserArgs, { stdio: "ignore", windowsHide: true });
  browser.on("error", () => console.error(`Could not open a browser. Open ${url} manually.`));
  browser.unref();
});
child.on("error", error => {
  process.stdin.pause();
  console.error(`Could not start the map editor: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", code => {
  process.stdin.pause();
  if (code) console.error(`Editor stopped (${code}). If the port is busy, try: start-map-editor.cmd 8767`);
  process.exitCode = code || 0;
});
process.stdin.setEncoding("utf8");
process.stdin.on("data", input => {
  if (input.trim().toLowerCase() === "q") child.kill();
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill());
}
