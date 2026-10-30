// One-time provisioning: never print or write the generated encryption key.
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const wrangler = fileURLToPath(new URL("../analytics-worker/node_modules/wrangler/bin/wrangler.js", import.meta.url));
const config = fileURLToPath(new URL("../publishing-worker/wrangler.toml", import.meta.url));
const existing = spawnSync(process.execPath, [wrangler, "secret", "list", "--config", config], { cwd: root, encoding: "utf8" });
if (existing.status !== 0) throw new Error("Cannot inspect existing secret names; refusing to replace a key.");
if (JSON.parse(existing.stdout).some(secret => secret.name === "TOKEN_ENCRYPTION_KEY")) {
  console.log("TOKEN_ENCRYPTION_KEY is already configured; leaving it unchanged.");
} else {
  const child = spawn(process.execPath, [wrangler, "secret", "put", "TOKEN_ENCRYPTION_KEY", "--config", config], { cwd: root, stdio: ["pipe", "inherit", "inherit"] });
  child.stdin.end(randomBytes(32).toString("base64") + "\n");
  child.on("exit", code => { process.exitCode = code ?? 1; });
}
