import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const operations = new Map([
  ["setup", "local-setup.ps1"],
  ["start", "local-start.ps1"],
  ["db-init", "local-db-init.ps1"],
  ["db-backup", "local-db-backup.ps1"],
  ["db-restore", "local-db-restore.ps1"],
]);

const [operation, ...forwardedArguments] = process.argv.slice(2);
const scriptName = operations.get(operation);

if (!scriptName) {
  process.stderr.write("Unknown local operation.\n");
  process.exit(2);
}

if (process.platform !== "win32") {
  process.stderr.write("CD-BOX local operations currently support Windows only.\n");
  process.exit(2);
}

const windowsDirectory = process.env.SystemRoot ?? "C:\\Windows";
const powershell = path.join(
  windowsDirectory,
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const scriptPath = path.join(scriptDirectory, scriptName);
const result = spawnSync(
  powershell,
  [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    ...forwardedArguments,
  ],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (result.error) {
  process.stderr.write(`Unable to start the local operation: ${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
