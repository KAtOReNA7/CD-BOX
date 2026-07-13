import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const localCommonPath = fileURLToPath(new URL("../scripts/local-common.ps1", import.meta.url));
const localStartPath = fileURLToPath(new URL("../scripts/local-start.ps1", import.meta.url));
const localBootstrapPath = fileURLToPath(new URL("../scripts/local-bootstrap.ps1", import.meta.url));
const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageLockPath = fileURLToPath(new URL("../package-lock.json", import.meta.url));

function powershellLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function resolvedProxyEnvironment(
  environment: Record<string, string>,
  invocations = 1,
) {
  const calls = Array.from(
    { length: invocations },
    () => "Set-LocalNodeProxyEnvironment",
  ).join("; ");
  const command = [
    `. ${powershellLiteral(localCommonPath)}`,
    calls,
    "[pscustomobject]@{ HTTP_PROXY=$env:HTTP_PROXY; HTTPS_PROXY=$env:HTTPS_PROXY; ALL_PROXY=$env:ALL_PROXY; NO_PROXY=$env:NO_PROXY; NODE_USE_ENV_PROXY=$env:NODE_USE_ENV_PROXY } | ConvertTo-Json -Compress",
  ].join("; ");
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command,
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      NO_PROXY: "",
      NODE_USE_ENV_PROXY: "",
      ...environment,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim()) as Record<string, string>;
}

test("local Node proxy setup maps ALL_PROXY and protects every loopback identity", () => {
  const environment = resolvedProxyEnvironment({
    ALL_PROXY: "http://127.0.0.1:10808",
    NO_PROXY: "packages.example,.internal.example",
  });

  assert.equal(environment.HTTP_PROXY, "http://127.0.0.1:10808");
  assert.equal(environment.HTTPS_PROXY, "http://127.0.0.1:10808");
  assert.equal(environment.ALL_PROXY, "http://127.0.0.1:10808");
  assert.equal(
    environment.NO_PROXY,
    "packages.example,.internal.example,localhost,127.0.0.1,::1",
  );
  assert.equal(environment.NODE_USE_ENV_PROXY, "1");
});

test("local Node proxy setup preserves specific proxies and is idempotent", () => {
  const environment = resolvedProxyEnvironment({
    HTTP_PROXY: "http://http-proxy.example:8080",
    HTTPS_PROXY: "http://https-proxy.example:8443",
    ALL_PROXY: "http://fallback-proxy.example:1080",
    NO_PROXY: "LOCALHOST,packages.example,::1",
  }, 2);

  assert.equal(environment.HTTP_PROXY, "http://http-proxy.example:8080");
  assert.equal(environment.HTTPS_PROXY, "http://https-proxy.example:8443");
  assert.equal(environment.ALL_PROXY, "http://fallback-proxy.example:1080");
  assert.equal(environment.NO_PROXY, "LOCALHOST,packages.example,::1,127.0.0.1");
  assert.equal(environment.NODE_USE_ENV_PROXY, "1");
});

test("local start normalizes proxy state before launching Node", () => {
  const source = readFileSync(localStartPath, "utf8");
  const proxySetup = source.indexOf("Set-LocalNodeProxyEnvironment");
  const nodeLaunch = source.indexOf("& $node $nextCli");

  assert.ok(proxySetup >= 0);
  assert.ok(nodeLaunch > proxySetup);
  assert.doesNotMatch(source, /\$env:NODE_USE_ENV_PROXY\s*=/u);
});

test("public lifecycle scripts pin Node and every Next.js server to loopback port 3000", () => {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
    engines: { node: string };
    scripts: { dev: string; start: string; "local:start": string };
  };
  const packageLock = JSON.parse(readFileSync(packageLockPath, "utf8")) as {
    packages: { "": { engines: { node: string } } };
  };
  const source = readFileSync(localStartPath, "utf8");

  assert.equal(packageJson.engines.node, "24.16.0");
  assert.equal(packageLock.packages[""].engines.node, "24.16.0");
  assert.equal(packageJson.scripts.dev, "next dev -H 127.0.0.1 -p 3000");
  assert.equal(packageJson.scripts.start, "npm run local:start");
  assert.match(packageJson.scripts["local:start"], /scripts\/local-start\.ps1/u);
  assert.doesNotMatch(source, /param\s*\([\s\S]*?\$Port/u);
  assert.match(source, /\$args\.Count -ne 0/u);
  assert.match(source, /\$Port = 3000/u);
  assert.match(source, /& \$node \$nextCli "start" "-H" "127\.0\.0\.1" "-p" \(\[string\]\$Port\)/u);
});

test("public bootstrap always refuses an existing environment and always completes setup", () => {
  const source = readFileSync(localBootstrapPath, "utf8");

  assert.doesNotMatch(source, /ReplaceExistingEnvFile|SkipApplicationSetup/u);
  assert.match(
    source,
    /if \(Test-Path -LiteralPath \$environmentPath -PathType Leaf\) \{[\s\S]*?Bootstrap stopped without reading or changing it\./u,
  );
  assert.match(source, /& \(Join-Path \$PSScriptRoot "local-setup\.ps1"\)/u);
});
