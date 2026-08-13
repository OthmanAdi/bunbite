/**
 * Public BunBite browser smoke test.
 *
 * Starts the real Bun server against a throwaway database, then uses Chrome's
 * DevTools Protocol directly (no browser-test dependency) to verify the public
 * surface. It never reads production configuration, opens a production origin,
 * or leaves browser/server data behind.
 *
 * Run: node --experimental-websocket scripts/public-browser-smoke.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 20 || (nodeMajor === 20 && nodeMinor < 10)) {
  throw new Error("This smoke test requires Node.js 20.10 or newer.");
}
if (typeof WebSocket !== "function") {
  throw new Error("Run with Node 20 using: node --experimental-websocket scripts/public-browser-smoke.mjs");
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const smokeRoot = await mkdtemp(path.join(os.tmpdir(), "bunbite-public-browser-smoke-"));
const profileDirectory = path.join(smokeRoot, "chrome-profile");
const evidenceDirectory = path.join(smokeRoot, "evidence");
const databasePath = path.join(smokeRoot, "bunbite.sqlite");
const keyPath = path.join(smokeRoot, "bunbite.key");

function assertTemporaryPath(candidate) {
  const relative = path.relative(os.tmpdir(), candidate);
  assert.ok(!path.isAbsolute(relative) && !relative.startsWith(".."), `Refusing non-temporary path: ${candidate}`);
  assert.match(path.basename(candidate), /^bunbite-public-browser-smoke-/);
}

assertTemporaryPath(smokeRoot);

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function browserCandidates() {
  const candidates = [process.env.BUNBITE_CHROME, process.env.CHROME_BIN].filter(Boolean);
  if (process.platform === "win32") {
    for (const root of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean)) {
      candidates.push(
        path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(root, "Chromium", "Application", "chrome.exe"),
        path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      );
    }
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    );
  }
  for (const candidate of [...new Set(candidates)]) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error("Chrome/Chromium not found. Set BUNBITE_CHROME to its executable path.");
}

async function freeLoopbackPort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const address = probe.address();
  assert.ok(address && typeof address !== "string", "Unable to reserve a loopback port.");
  const { port } = address;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const suffix = lastError ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${description}.${suffix}`);
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id);
        clearTimeout(timer);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
      } else if (message.method) {
        this.events.push(message);
      }
    });
  }

  async send(method, params = {}) {
    await this.opened;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("CDP connection closed."));
    }
    this.pending.clear();
    this.socket.close();
  }
}

function isolatedServerEnvironment(port) {
  const inherited = process.env;
  const passthrough = [
    "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR",
    "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "COMSPEC",
  ];
  const env = {};
  for (const name of passthrough) {
    if (inherited[name]) env[name] = inherited[name];
  }
  return {
    ...env,
    PORT: String(port),
    DB_PATH: databasePath,
    KEYFILE: keyPath,
    BURST_MAX: "50",
    IMAGE_CONCURRENCY: "1",
    IMAGE_QUEUE_MAX: "2",
  };
}

const chrome = await browserCandidates();
const port = await freeLoopbackPort();
const baseUrl = `http://127.0.0.1:${port}`;
let server;
let browser;
let page;
let serverOutput = "";

try {
  await mkdir(profileDirectory, { recursive: true });
  await mkdir(evidenceDirectory, { recursive: true });
  server = spawn("bun", ["server/server.ts"], {
    cwd: repositoryRoot,
    env: isolatedServerEnvironment(port),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr.on("data", (chunk) => { serverOutput += String(chunk); });

  await waitFor(async () => (await fetch(`${baseUrl}/api/health`)).ok, 10_000, "isolated BunBite server health check");

  const chromeProcess = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1",
    "--window-size=1440,1000",
    `--user-data-dir=${profileDirectory}`,
    "--remote-debugging-port=0",
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  browser = chromeProcess;

  const devToolsPort = await waitFor(async () => {
    const value = await readFile(path.join(profileDirectory, "DevToolsActivePort"), "utf8");
    return Number(value.split(/\r?\n/)[0]) || undefined;
  }, 15_000, "Chrome DevTools port");
  const devToolsOrigin = `http://127.0.0.1:${devToolsPort}`;
  const target = await fetch(`${devToolsOrigin}/json/new?${encodeURIComponent(`${baseUrl}/?lang=en`)}`, { method: "PUT" })
    .then((response) => response.json());

  page = new Cdp(target.webSocketDebuggerUrl);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Network.enable");
  await page.send("Network.setBlockedURLs", { urls: ["https://*"] });
  await page.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  const navigation = await page.send("Page.navigate", { url: `${baseUrl}/?lang=en` });
  assert.equal(navigation.errorText, undefined, `Public page navigation failed: ${navigation.errorText}`);

  await waitFor(async () => {
    const result = await page.send("Runtime.evaluate", {
      expression: `document.readyState === "complete"
        && document.querySelector("#dropZone")
        && document.querySelector("#fileInput")
        && document.querySelector("#btnProcess")
        && document.querySelector("#engineBadge")?.textContent.includes("Hosted")`,
      returnByValue: true,
    });
    return result.result.value === true;
  }, 10_000, "public page initialization");

  const removedCommerce = await page.send("Runtime.evaluate", {
    expression: `({
      linked: !!document.querySelector('a[href*="pricing"], a[href*="checkout"], a[href*="portal"]'),
      accountControl: !!document.querySelector("#btnAccount, #accountModal"),
    })`,
    returnByValue: true,
  });
  assert.deepEqual(removedCommerce.result.value, {
    linked: false, accountControl: false,
  }, "Commercial public routes or controls remain reachable.");
  for (const removedPath of ["/pricing.html", "/success.html"]) {
    const response = await fetch(baseUrl + removedPath);
    assert.equal(response.status, 404, `${removedPath} is still publicly reachable.`);
  }

  for (const width of [1024, 834, 390]) {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const layout = await page.send("Runtime.evaluate", {
      expression: `({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth })`,
      returnByValue: true,
    });
    assert.equal(layout.result.value.width, width, `Viewport width was not applied at ${width}px.`);
    assert.equal(layout.result.value.noHorizontalOverflow, true, `Horizontal overflow at ${width}px.`);
  }

  const accessibility = await page.send("Runtime.evaluate", {
    expression: `(() => {
      const zone = document.querySelector("#dropZone");
      zone.focus();
      return {
        focused: document.activeElement === zone,
        keyboardReachable: zone.tabIndex === 0 && zone.getAttribute("role") === "button",
        visibleFocus: getComputedStyle(zone).boxShadow !== "none",
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches
          && getComputedStyle(zone).transitionDuration.split(",").every((value) => parseFloat(value) <= 0.01),
      };
    })()`,
    returnByValue: true,
  });
  assert.deepEqual(accessibility.result.value, {
    focused: true,
    keyboardReachable: true,
    visibleFocus: true,
    reducedMotion: true,
  }, "Drop zone keyboard focus or reduced-motion contract failed.");

  const optimize = await page.send("Runtime.evaluate", {
    expression: `(async () => {
      const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
      const input = document.querySelector("#fileInput");
      const transfer = new DataTransfer();
      transfer.items.add(new File([png], "smoke.png", { type: "image/png" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector("#btnProcess").click();
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline && !document.querySelector(".result-card")) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const card = document.querySelector(".result-card");
      return {
        result: !!card,
        download: card?.querySelector("a[download]")?.getAttribute("download") || "",
        dimensions: card?.querySelector(".rc-dims")?.textContent || "",
        serverBadge: document.querySelector("#engineBadge")?.textContent || "",
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(optimize.result.value.result, true, "A valid image did not produce a visible result.");
  assert.match(optimize.result.value.download, /smoke\.(webp|jpg|png)$/i, "Result has no download name.");
  assert.match(optimize.result.value.dimensions, /1\s*[×x]\s*1/i, "Result dimensions were not rendered.");
  assert.match(optimize.result.value.serverBadge, /Hosted/i, "The valid image did not use hosted processing.");

  await page.send("Page.reload", { ignoreCache: true });
  await waitFor(async () => {
    const result = await page.send("Runtime.evaluate", {
      expression: `document.readyState === "complete"
        && document.querySelector("#engineBadge")?.textContent.includes("Hosted")`,
      returnByValue: true,
    });
    return result.result.value === true;
  }, 10_000, "fresh public page initialization");

  const queueLimits = await page.send("Runtime.evaluate", {
    expression: `(() => {
      const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
      const input = document.querySelector("#fileInput");
      const capped = new DataTransfer();
      for (let index = 0; index < 21; index++) capped.items.add(new File([png], "cap-" + index + ".png", { type: "image/png" }));
      input.files = capped.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const oversized = new DataTransfer();
      oversized.items.add(new File([new Uint8Array(50 * 1024 * 1024 + 1)], "oversized.png", { type: "image/png" }));
      input.files = oversized.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const warnings = [...document.querySelectorAll("#toasts .toast.warn")].map((toast) => toast.textContent.trim());
      return {
        queued: document.querySelectorAll("#queueList .queue-item").length,
        capWarning: warnings.some((warning) => /up to 20 images|20 images in the queue/i.test(warning)),
        sizeWarning: warnings.some((warning) => /50\\s*(MB|MiB)/i.test(warning)),
        warnings,
      };
    })()`,
    returnByValue: true,
  });
  assert.equal(queueLimits.result.value.queued, 20, "Queue did not cap at 20 input images.");
  assert.equal(queueLimits.result.value.capWarning, true, "20-item cap did not show an actionable warning.");
  assert.equal(queueLimits.result.value.sizeWarning, true, `Image above the browser safety bound did not show an actionable warning: ${JSON.stringify(queueLimits.result.value.warnings)}`);

  const screenshot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(evidenceDirectory, "public-smoke.png"), Buffer.from(screenshot.data, "base64"));

  const browserInfo = await fetch(`${devToolsOrigin}/json/version`).then((response) => response.json());
  const browserCdp = new Cdp(browserInfo.webSocketDebuggerUrl);
  await browserCdp.send("Browser.close");
  browserCdp.close();
  console.log("[OK] Public page loaded from an isolated Bun server.");
  console.log("[OK] 1024px, 834px, and 390px layouts have no horizontal overflow.");
  console.log("[OK] Commercial public routes and controls are absent.");
  console.log("[OK] Drop-zone focus, reduced motion, hosted optimization, and browser queue safety bounds verified.");

  const errors = page.events.filter((event) =>
    event.method === "Runtime.exceptionThrown"
    || (event.method === "Log.entryAdded" && event.params.entry.level === "error")
    || (event.method === "Runtime.consoleAPICalled" && event.params.type === "error"),
  );
  assert.deepEqual(errors, [], "Public page produced runtime exceptions or error-level console output.");
} catch (error) {
  const diagnostics = serverOutput.trim().slice(-3_000);
  if (diagnostics) console.error(`Isolated server output:\n${diagnostics}`);
  throw error;
} finally {
  page?.close();
  if (browser && !(await waitForExit(browser, 3_000))) {
    browser.kill();
    await waitForExit(browser, 3_000);
  }
  if (server && !(await waitForExit(server, 3_000))) {
    server.kill();
    await waitForExit(server, 3_000);
  }
  await rm(smokeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
