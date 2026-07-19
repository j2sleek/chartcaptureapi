import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Pull the fenced JSON payload out of a child process's stdout. */
function extractEnv(stdout: string): Record<string, unknown> {
  const match = /<<<ENV>>>(.*)<<<END>>>/s.exec(stdout);
  assert.ok(match, `no env payload in stdout: ${stdout}`);
  return JSON.parse(match[1]!);
}

const envModule = fileURLToPath(
  new URL("../src/config/env.ts", import.meta.url),
);

/**
 * env.ts validates process.env at import time and calls process.exit(1) on
 * failure, so we exercise it in child processes with a curated environment.
 */
async function importEnvWith(
  overrides: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  // tsx may print its own diagnostics to stdout, so the payload is fenced
  // between markers and extracted by the caller rather than parsed whole.
  const script = `import("${envModule}").then((m) => {
    process.stdout.write("<<<ENV>>>" + JSON.stringify({
      concurrency: m.env.CAPTURE_CONCURRENCY,
      pool: m.env.PAGE_POOL_SIZE,
      authEnabled: m.authEnabled,
      isProduction: m.isProduction,
      keys: m.env.API_KEYS,
      proxy: m.proxyConfig ?? null,
      widgetTimeout: m.env.WIDGET_TIMEOUT,
      captureTimeout: m.env.CAPTURE_TIMEOUT,
    }) + "<<<END>>>");
  });`;

  // A clean base env: keep PATH/HOME so node + tsx resolve, drop the rest.
  const base: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
  };

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      { env: { ...base, ...overrides } },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

test("valid environment loads with defaults", async () => {
  const { code, stdout } = await importEnvWith({ NODE_ENV: "test" });
  assert.equal(code, 0);
  const parsed = extractEnv(stdout);
  assert.equal(parsed.pool, 3);
  assert.equal(parsed.concurrency, 3);
  assert.equal(parsed.authEnabled, false);
  assert.equal(parsed.isProduction, false);
  assert.equal(parsed.widgetTimeout, 15000);
});

test("API_KEYS is parsed as a trimmed CSV and enables auth", async () => {
  const { code, stdout } = await importEnvWith({
    NODE_ENV: "test",
    API_KEYS: " k1 , k2 ,, k3 ",
  });
  assert.equal(code, 0);
  const parsed = extractEnv(stdout);
  assert.deepEqual(parsed.keys, ["k1", "k2", "k3"]);
  assert.equal(parsed.authEnabled, true);
});

test("CAPTURE_CONCURRENCY is clamped to PAGE_POOL_SIZE", async () => {
  const { code, stdout } = await importEnvWith({
    NODE_ENV: "test",
    PAGE_POOL_SIZE: "2",
    CAPTURE_CONCURRENCY: "8",
  });
  assert.equal(code, 0);
  const parsed = extractEnv(stdout);
  assert.equal(parsed.pool, 2);
  assert.equal(parsed.concurrency, 2);
});

test("no proxy configured by default", async () => {
  const { code, stdout } = await importEnvWith({ NODE_ENV: "test" });
  assert.equal(code, 0);
  assert.equal(extractEnv(stdout).proxy, null);
});

test("PROXY_SERVER with inline credentials is split into fields", async () => {
  const { code, stdout } = await importEnvWith({
    NODE_ENV: "test",
    PROXY_SERVER: "http://alice:s3cr3t@proxy.example.com:8080",
  });
  assert.equal(code, 0);
  assert.deepEqual(extractEnv(stdout).proxy, {
    server: "http://proxy.example.com:8080/",
    username: "alice",
    password: "s3cr3t",
  });
});

test("explicit PROXY_USERNAME/PASSWORD override inline creds", async () => {
  const { code, stdout } = await importEnvWith({
    NODE_ENV: "test",
    PROXY_SERVER: "socks5://inline:nope@proxy.example.com:1080",
    PROXY_USERNAME: "bob",
    PROXY_PASSWORD: "pw",
  });
  assert.equal(code, 0);
  assert.deepEqual(extractEnv(stdout).proxy, {
    server: "socks5://proxy.example.com:1080",
    username: "bob",
    password: "pw",
  });
});

test("invalid PROXY_SERVER scheme fails fast", async () => {
  const { code, stderr } = await importEnvWith({
    NODE_ENV: "test",
    PROXY_SERVER: "proxy.example.com:8080",
  });
  assert.equal(code, 1);
  assert.match(stderr, /PROXY_SERVER/);
});

test("WIDGET_TIMEOUT is clamped to half of CAPTURE_TIMEOUT", async () => {
  const { code, stdout } = await importEnvWith({
    NODE_ENV: "test",
    CAPTURE_TIMEOUT: "30000",
    WIDGET_TIMEOUT: "40000",
  });
  assert.equal(code, 0);
  const parsed = extractEnv(stdout);
  assert.equal(parsed.widgetTimeout, 15000);
});

test("WIDGET_TIMEOUT under half-budget is left untouched", async () => {
  const { code, stdout } = await importEnvWith({
    NODE_ENV: "test",
    CAPTURE_TIMEOUT: "30000",
    WIDGET_TIMEOUT: "12000",
  });
  assert.equal(code, 0);
  assert.equal(extractEnv(stdout).widgetTimeout, 12000);
});

test("invalid PORT fails fast with exit code 1", async () => {
  const { code, stderr } = await importEnvWith({
    NODE_ENV: "test",
    PORT: "not-a-number",
  });
  assert.equal(code, 1);
  assert.match(stderr, /Invalid environment configuration/);
});

test("out-of-range BROWSER_POOL_SIZE fails fast", async () => {
  const { code, stderr } = await importEnvWith({
    NODE_ENV: "test",
    BROWSER_POOL_SIZE: "99",
  });
  assert.equal(code, 1);
  assert.match(stderr, /BROWSER_POOL_SIZE/);
});
