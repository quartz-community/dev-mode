/**
 * Ask real Obsidian how its Bases core plugin renders and evaluates a vault.
 *
 *   tsx scripts/obsidian-bases-probe/probe.ts <vault-dir> [--out dir] [--open a.base,b.md]
 *       [--app-version latest] [--lang en] [--tz Europe/Amsterdam] [--width 1600 --height 1200]
 *       [--wait 8000] [--keep [minutes]] [--json]
 *   tsx scripts/obsidian-bases-probe/probe.ts eval [--port 9339] '<js>'   # against a --keep session
 *   tsx scripts/obsidian-bases-probe/probe.ts eval --formulas '{"d":"today() - date(\"2024-03-05\")"}'
 *       [--filter 'file.name == "probe"']   # ad hoc formulas: writes __adhoc.base in the vault copy
 *   ... eval --click 640,300 '<js>'      # real mouse click first, then the code
 *
 * The vault is copied (never modified). Into the copy go: Bases enabled in
 * `.obsidian/core-plugins.json`, and a tiny helper plugin that exposes the `obsidian`
 * module as `window.__probeObsidian` so values can be classified (`DurationValue`, ...).
 *
 * What gets opened: `<vault>/probe.json` if present —
 *   { "open": [ { "file": "x.base", "views": "all" | ["A", "B"], "eval": "<js>", "wait": 8000 },
 *               { "file": "note.md" } ] }
 * — otherwise every `.base` file, and every `.md` that holds a ```base block or a `.base` embed.
 * `eval` runs in the renderer after render with `leaf`, `controllers`, `app`, `obsidian`,
 * `__probe` in scope; its (JSON-able) return value is recorded.
 *
 * Per opened file the result holds, for each Bases view on screen: the DOM (SVGs stripped,
 * input values surfaced as data-probe-value), the cells/cards as displayed, the evaluated
 * value of every shown property for every result entry (type, toString, fields, renderTo
 * output), controller errors, and a screenshot. Output: .dev/obsidian-bases-probe/<name>/
 * {results.json, SUMMARY.md, *.png}. The Obsidian version that answered is stamped in.
 *
 * Environment (Linux): Obsidian needs a display, and reading mode / the bases views render off
 * requestAnimationFrame, which Chromium starves for unmapped windows. So the probe always starts
 * its own Xvfb plus herbstluftwm (found on PATH, in /nix/store, or via `nix build`), like
 * repos/remark-obsidian's `parity-record` wrapper. The Electron + installer asar come from the
 * system `obsidian` wrapper (NixOS package) when present — that runs without nix-ld — else from
 * obsidian-launcher's AppImage download. Override with OBSIDIAN_ELECTRON + OBSIDIAN_INSTALLER_ASAR,
 * or OBSIDIAN_EXECUTABLE. The app asar (the actual Obsidian version) is downloaded by
 * obsidian-launcher into .dev/obsidian-cache. Every subprocess and wait has a timeout.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "@playwright/test";
import { parseArgs } from "../lib/args.js";
import { safeReadJson } from "../lib/json.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(HERE, "..", "..");
const DEV_DIR = join(WORKSPACE_ROOT, ".dev");
const CACHE_DIR = process.env.OBSIDIAN_CACHE ?? join(DEV_DIR, "obsidian-cache");
const HELPER_ID = "bases-probe-helper";
const DEFAULT_PORT = 9339;

const LAUNCH_TIMEOUT_MS = 90_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;
const NIX_BUILD_TIMEOUT_MS = 300_000;
const EVAL_TIMEOUT_MS = 120_000;

interface OpenRequest {
  file: string;
  views?: "all" | string[];
  eval?: string;
  wait?: number;
  mode?: "preview" | "source";
  screenshot?: boolean;
}

interface ProbeSpec {
  open?: OpenRequest[];
}

// ---------------------------------------------------------------- helpers

function log(msg: string): void {
  process.stderr.write(`obsidian-bases-probe: ${msg}\n`);
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${what} timed out after ${ms} ms`)),
        ms,
      );
    }),
  ]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

function which(cmd: string): string | null {
  const r = spawnSync("sh", ["-c", `command -v ${cmd}`], {
    encoding: "utf8",
    timeout: 5_000,
  });
  const out = r.stdout?.trim();
  return r.status === 0 && out ? out : null;
}

/**
 * obsidian-launcher is not a dev-mode root dependency; it comes with remark-obsidian's
 * wdio-obsidian-service (the parity harness). Resolve it through that chain so the probe uses
 * exactly the launcher the parity recorder uses, without a second copy in the root lockfile.
 */
async function loadLauncher(): Promise<any> {
  const candidates = [
    join(WORKSPACE_ROOT, "package.json"),
    join(WORKSPACE_ROOT, "repos", "remark-obsidian", "package.json"),
  ];
  for (const from of candidates) {
    if (!existsSync(from)) continue;
    const req = createRequire(from);
    for (const chain of [
      ["obsidian-launcher"],
      ["wdio-obsidian-service", "obsidian-launcher"],
    ]) {
      try {
        let resolved = from;
        for (const name of chain)
          resolved = createRequire(resolved).resolve(name);
        void req;
        // The CJS entry resolves; import the ESM build next to it.
        const esm = resolved.replace(/index\.cjs$/, "index.js");
        const mod = await import(
          pathToFileURL(existsSync(esm) ? esm : resolved).href
        );
        return mod.default ?? mod.ObsidianLauncher ?? mod;
      } catch {
        /* try the next chain */
      }
    }
  }
  throw new Error(
    "obsidian-launcher not found. It is installed with repos/remark-obsidian's dev dependencies " +
      "(wdio-obsidian-service); run `pnpm install` in the workspace.",
  );
}

function findBinaryInStore(name: string): string | null {
  try {
    for (const entry of readdirSync("/nix/store")) {
      if (!entry.includes(`-${name}-`)) continue;
      const bin = join("/nix/store", entry, "bin", name);
      if (existsSync(bin)) return bin;
    }
  } catch {
    /* not NixOS */
  }
  return null;
}

function resolveTool(name: string, nixAttr: string): string {
  const onPath = which(name);
  if (onPath) return onPath;
  const inStore = findBinaryInStore(name);
  if (inStore) return inStore;
  if (which("nix")) {
    log(`${name} not on PATH; building nixpkgs#${nixAttr}`);
    const r = spawnSync(
      "nix",
      ["build", "--no-link", "--print-out-paths", `nixpkgs#${nixAttr}`],
      {
        encoding: "utf8",
        timeout: NIX_BUILD_TIMEOUT_MS,
      },
    );
    const out = r.stdout?.trim().split("\n").pop();
    if (r.status === 0 && out && existsSync(join(out, "bin", name)))
      return join(out, "bin", name);
  }
  throw new Error(
    `${name} not found (PATH, /nix/store, nix build nixpkgs#${nixAttr})`,
  );
}

interface ObsidianExecutable {
  command: string;
  prefixArgs: string[];
  installerVersion: string | null;
  source: string;
}

/** Electron + installer asar of the system Obsidian (NixOS wrapper), parsed out of the wrapper. */
function systemObsidian(): ObsidianExecutable | null {
  if (process.env.OBSIDIAN_EXECUTABLE) {
    return {
      command: process.env.OBSIDIAN_EXECUTABLE,
      prefixArgs: [],
      installerVersion: process.env.OBSIDIAN_INSTALLER_VERSION ?? null,
      source: "OBSIDIAN_EXECUTABLE",
    };
  }
  let electron = process.env.OBSIDIAN_ELECTRON;
  let asar = process.env.OBSIDIAN_INSTALLER_ASAR;
  let source = "OBSIDIAN_ELECTRON/OBSIDIAN_INSTALLER_ASAR";
  if (!electron || !asar) {
    const wrapper = which("obsidian");
    if (!wrapper) return null;
    let text = "";
    try {
      if (statSync(wrapper).size > 100_000) return null;
      text = readFileSync(wrapper, "utf8");
    } catch {
      return null;
    }
    electron = /^ELECTRON="([^"]+)"/m.exec(text)?.[1];
    asar = /^APP_ASAR="([^"]+)"/m.exec(text)?.[1];
    // nixpkgs' plain makeWrapper variant: exec <electron> <asar>
    if (!electron || !asar) {
      const m =
        /exec\s+"?([^"\s]+electron)"?\s+(?:\$\w+\s+)?"?([^"\s]+\.asar)"?/m.exec(
          text,
        );
      electron = m?.[1];
      asar = m?.[2];
    }
    source = `system wrapper ${wrapper}`;
  }
  if (!electron || !asar || !existsSync(electron) || !existsSync(asar))
    return null;
  const version = /obsidian-(\d+\.\d+\.\d+)/.exec(asar)?.[1] ?? null;
  return {
    command: electron,
    prefixArgs: [asar],
    installerVersion: version,
    source,
  };
}

// ---------------------------------------------------------------- vault

function defaultRequests(vault: string): OpenRequest[] {
  const out: OpenRequest[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".base"))
        out.push({ file: relative(vault, full), views: "all" });
      else if (entry.name.endsWith(".md")) {
        const text = readFileSync(full, "utf8");
        if (
          /```base\b/.test(text) ||
          /!\[\[[^\]]*\.base(#[^\]]*)?(\|[^\]]*)?\]\]/.test(text)
        ) {
          out.push({ file: relative(vault, full) });
        }
      }
    }
  };
  walk(vault);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

function prepareVault(src: string, dest: string): void {
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true, preserveTimestamps: true });
  const obs = join(dest, ".obsidian");
  mkdirSync(obs, { recursive: true });

  const corePath = join(obs, "core-plugins.json");
  let core: unknown = existsSync(corePath) ? safeReadJson(corePath) : null;
  if (Array.isArray(core)) {
    if (!core.includes("bases")) core.push("bases");
  } else if (core && typeof core === "object") {
    (core as Record<string, boolean>).bases = true;
  } else {
    core = ["file-explorer", "properties", "bases"];
  }
  writeFileSync(corePath, JSON.stringify(core, null, 2));

  const communityPath = join(obs, "community-plugins.json");
  const community = existsSync(communityPath)
    ? (safeReadJson(communityPath) as string[])
    : [];
  if (!community.includes(HELPER_ID)) community.push(HELPER_ID);
  writeFileSync(communityPath, JSON.stringify(community));

  const pluginDir = join(obs, "plugins", HELPER_ID);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, "manifest.json"),
    JSON.stringify({
      id: HELPER_ID,
      name: "Bases probe helper",
      version: "0.0.1",
      minAppVersion: "1.9.0",
      description: "Exposes the obsidian module to the dev-mode Bases probe",
      author: "dev-mode",
      isDesktopOnly: true,
    }),
  );
  writeFileSync(
    join(pluginDir, "main.js"),
    'const obsidian = require("obsidian");\n' +
      "module.exports = class extends obsidian.Plugin { onload() { window.__probeObsidian = obsidian; } };\n",
  );
}

// ---------------------------------------------------------------- session

interface Session {
  browser: Browser;
  page: Page;
  port: number;
  info: Record<string, unknown>;
  stop: () => Promise<void>;
}

async function startDisplay(width: number, height: number) {
  const xvfb = resolveTool("Xvfb", "xvfb");
  const wm = resolveTool("herbstluftwm", "herbstluftwm");
  let display = "";
  for (let n = 90; n <= 99; n++) {
    const lock = `/tmp/.X${n}-lock`;
    if (existsSync(lock)) {
      const pid = Number(readFileSync(lock, "utf8").trim());
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        /* stale */
      }
      if (alive) continue;
      rmSync(lock, { force: true });
      rmSync(`/tmp/.X11-unix/X${n}`, { force: true });
    }
    display = `:${n}`;
    break;
  }
  if (!display) throw new Error("displays :90-:99 are all taken");
  const xProc = spawn(
    xvfb,
    [display, "-screen", "0", `${width}x${height}x24`, "-noreset"],
    {
      stdio: "ignore",
    },
  );
  const until = Date.now() + 20_000;
  while (!existsSync(`/tmp/.X11-unix/X${display.slice(1)}`)) {
    if (Date.now() > until) throw new Error(`Xvfb ${display} did not come up`);
    await sleep(100);
  }
  const wmProc = spawn(wm, [], {
    stdio: "ignore",
    env: { ...process.env, DISPLAY: display },
  });
  await sleep(1_000);
  return { display, procs: [wmProc, xProc] };
}

async function startSession(opts: {
  vault: string;
  appVersion: string;
  lang?: string;
  chromiumLang?: string;
  tz?: string;
  width: number;
  height: number;
  port?: number;
}): Promise<Session> {
  const Launcher = await loadLauncher();
  const launcher = new Launcher({ cacheDir: CACHE_DIR });
  const sys = systemObsidian();
  let exe: ObsidianExecutable;
  const [appVersion, installerVersion] = await withTimeout<[string, string]>(
    launcher.resolveVersion(opts.appVersion, sys?.installerVersion ?? "latest"),
    DOWNLOAD_TIMEOUT_MS,
    "resolving Obsidian version",
  );
  if (sys) exe = sys;
  else {
    log(
      `no system Obsidian; downloading installer ${installerVersion} (needs nix-ld on NixOS)`,
    );
    const installer = await withTimeout<string>(
      launcher.downloadInstaller(installerVersion),
      DOWNLOAD_TIMEOUT_MS,
      "downloading the Obsidian installer",
    );
    exe = {
      command: installer,
      prefixArgs: [],
      installerVersion,
      source: "obsidian-launcher download",
    };
  }
  const appPath = await withTimeout<string>(
    launcher.downloadApp(appVersion),
    DOWNLOAD_TIMEOUT_MS,
    `downloading Obsidian ${appVersion}`,
  );
  const localStorage: Record<string, string> = {};
  if (opts.lang) localStorage.language = opts.lang;
  const configDir: string = await launcher.setupConfigDir({
    appVersion,
    installerVersion: exe.installerVersion ?? installerVersion,
    appPath,
    vault: opts.vault,
    localStorage,
  });

  const { display, procs } = await startDisplay(opts.width, opts.height);
  const port = opts.port ?? (await freePort());
  const env: NodeJS.ProcessEnv = { ...process.env, DISPLAY: display };
  // Never open on the user's desktop: the NixOS electron wrapper switches to Wayland when
  // these are set, which would bypass Xvfb entirely.
  delete env.WAYLAND_DISPLAY;
  delete env.NIXOS_OZONE_WL;
  delete env.ELECTRON_OZONE_PLATFORM_HINT;
  if (opts.tz) env.TZ = opts.tz;
  const args = [
    ...exe.prefixArgs,
    `--user-data-dir=${configDir}`,
    "--no-sandbox",
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
    "--ozone-platform=x11",
  ];
  if (opts.chromiumLang) {
    // Electron on Linux takes its locale (navigator.language, <input type=date> display) from
    // the environment; --lang alone is overridden.
    args.push(`--lang=${opts.chromiumLang}`);
    const posix = `${opts.chromiumLang.replace("-", "_")}.UTF-8`;
    env.LANG = posix;
    env.LC_ALL = posix;
    env.LANGUAGE = opts.chromiumLang.replace("-", "_");
  }
  const logPath = join(configDir, "probe-electron.log");
  const obsProc: ChildProcess = spawn(exe.command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logChunks: string[] = [];
  obsProc.stdout?.on("data", (d) => logChunks.push(String(d)));
  obsProc.stderr?.on("data", (d) => logChunks.push(String(d)));
  const allProcs = [obsProc, ...procs];

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      writeFileSync(logPath, logChunks.join(""));
    } catch {
      /* ignore */
    }
    for (const p of allProcs) {
      try {
        p.kill("SIGTERM");
      } catch {
        /* gone */
      }
    }
    await sleep(500);
    for (const p of allProcs) {
      try {
        if (p.exitCode === null) p.kill("SIGKILL");
      } catch {
        /* gone */
      }
    }
    rmSync(`/tmp/.X${display.slice(1)}-lock`, { force: true });
    rmSync(configDir, { recursive: true, force: true });
  };
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      void stop().then(() => process.exit(130));
    });
  }

  try {
    const browser = await connect(port, LAUNCH_TIMEOUT_MS, () =>
      logChunks.join(""),
    );
    const page = await appPage(browser, LAUNCH_TIMEOUT_MS);
    try {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    } catch {
      /* the window manager focuses the window anyway */
    }
    await withTimeout(
      page.waitForFunction(
        () =>
          (window as any).app?.workspace?.layoutReady === true &&
          (window as any).__probeObsidian !== undefined,
        undefined,
        { timeout: LAUNCH_TIMEOUT_MS, polling: 250 },
      ),
      LAUNCH_TIMEOUT_MS + 5_000,
      "waiting for the vault and helper plugin to load",
    );
    await page.evaluate(
      ({ w, h }) => {
        try {
          const remote =
            (window as any).require?.("@electron/remote") ??
            (window as any).require?.("electron").remote;
          remote
            ?.getCurrentWindow()
            ?.setBounds({ x: 0, y: 0, width: w, height: h });
        } catch {
          /* fall back to whatever the window got */
        }
      },
      { w: opts.width, h: opts.height },
    );
    await page.evaluate(readFileSync(join(HERE, "page-helpers.js"), "utf8"));
    // Let the metadata cache finish its initial scan before any base runs its query.
    await page.evaluate(async () => {
      const app = (window as any).app;
      const until = Date.now() + 30_000;
      while (Date.now() < until && app.metadataCache.inProgressTaskCount > 0) {
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 500));
    });
    const info = await page.evaluate(
      ({ appVersion }) => {
        const w = window as any;
        let ver: string | null = null;
        try {
          ver = w.require("electron").ipcRenderer.sendSync("version");
        } catch {
          /* older installers */
        }
        return {
          obsidianApp: ver ?? appVersion,
          userAgent: navigator.userAgent,
          appLanguage: w.localStorage.getItem("language") ?? "en (default)",
          momentLocale: w.moment?.locale?.() ?? null,
          navigatorLanguage: navigator.language,
          intlLocale: Intl.DateTimeFormat().resolvedOptions().locale,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          now: new Date().toString(),
          vault: w.app.vault.getName(),
          windowSize: { width: window.innerWidth, height: window.innerHeight },
          enabledCorePlugins: Object.keys(w.app.internalPlugins.plugins).filter(
            (k) => w.app.internalPlugins.plugins[k].enabled,
          ),
        };
      },
      { appVersion },
    );
    Object.assign(info, {
      executable: exe.source,
      installerVersion: exe.installerVersion ?? installerVersion,
      requestedAppVersion: appVersion,
    });
    if (info.obsidianApp !== appVersion) {
      // Obsidian loads the newest of (bundled app, user-data-dir asar): an app older than the
      // installer's own bundle is silently ignored. The stamp above is what actually answered.
      log(
        `WARNING: asked for Obsidian ${appVersion} but ${String(info.obsidianApp)} is running ` +
          `(installer ${String(exe.installerVersion ?? installerVersion)} bundles a newer app). Use an older installer ` +
          `(OBSIDIAN_EXECUTABLE / OBSIDIAN_ELECTRON + OBSIDIAN_INSTALLER_ASAR) to run older apps.`,
      );
    }
    return { browser, page, port, info, stop };
  } catch (e) {
    log(`Obsidian output:\n${logChunks.join("").slice(-4000)}`);
    await stop();
    throw e;
  }
}

async function connect(
  port: number,
  timeoutMs: number,
  output: () => string = () => "",
): Promise<Browser> {
  const until = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < until) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
        timeout: 10_000,
      });
    } catch (e) {
      lastErr = e;
      await sleep(500);
    }
  }
  throw new Error(
    `could not connect to Obsidian on port ${port}: ${String(lastErr)}\n${output().slice(-2000)}`,
  );
}

async function appPage(browser: Browser, timeoutMs: number): Promise<Page> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    for (const ctx of browser.contexts()) {
      const page = ctx
        .pages()
        .find((p) => p.url().startsWith("app://obsidian.md/index.html"));
      if (page) return page;
    }
    await sleep(250);
  }
  throw new Error("no Obsidian window appeared");
}

// ---------------------------------------------------------------- probing

const SCREENSHOT_LIMIT = 16_000;

async function probeFile(
  page: Page,
  req: OpenRequest,
  outDir: string,
  defaultWait: number,
) {
  const wait = req.wait ?? defaultWait;
  const opened = await page.evaluate(
    async ({ file, mode, wait }) => {
      const w = window as any;
      const app = w.app;
      const f = app.vault.getAbstractFileByPath(file);
      if (!f) return { error: `no such file in vault: ${file}` };
      // One leaf, reused: the previous file's view is replaced, so nothing else renders.
      const leaf = w.__probeLeaf?.parent
        ? w.__probeLeaf
        : app.workspace.getLeaf(false);
      await leaf.openFile(f, {
        active: true,
        state: f.extension === "md" ? { mode: mode ?? "preview" } : {},
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      w.__probeLeaf = leaf;
      const rendered = await w.__probe.waitForRender(
        leaf.view.containerEl,
        wait,
      );
      return {
        viewType: leaf.view.getViewType(),
        mode: leaf.view.getMode?.() ?? null,
        rendered,
      };
    },
    { file: req.file, mode: req.mode, wait },
  );
  if ("error" in opened) return { request: req, ...opened };

  const viewNames: string[] = await page.evaluate(() => {
    const c = (window as any).__probeLeaf.view.controller;
    return (
      c?.getQueryViewNames?.() ??
      (c?.query?.views ?? []).map((v: any) => v.name)
    );
  });
  const wanted =
    req.views === "all"
      ? viewNames
      : Array.isArray(req.views)
        ? req.views
        : [null as string | null];

  const shots: string[] = [];
  const passes = [];
  for (const viewName of wanted.length ? wanted : [null]) {
    if (viewName !== null) {
      await page.evaluate(
        async ({ name, wait }) => {
          const w = window as any;
          const c = w.__probeLeaf.view.controller;
          c.selectView(name);
          await w.__probe.sleep(300);
          await w.__probe.waitForRender(w.__probeLeaf.view.containerEl, wait);
        },
        { name: viewName, wait },
      );
    }
    const pass = await page.evaluate(
      async ({ code }) => {
        const w = window as any;
        const leaf = w.__probeLeaf;
        const controllers = w.__probe.findControllers(leaf);
        const root = leaf.view.containerEl;
        const viewEls = [...root.querySelectorAll(".bases-view")].filter(
          (el: any) => el.offsetParent !== null,
        );
        const embeds = [...root.querySelectorAll(".bases-embed")]
          .filter((el: any) => el.offsetParent !== null)
          .map((el: any) => ({
            className: el.className,
            src: el.getAttribute("src"),
            alt: el.getAttribute("alt"),
            rect: w.__probe.rect(el),
            errorText:
              el.querySelector(".bases-error, .bases-query-error")
                ?.textContent ?? null,
          }));
        let evalResult: unknown;
        if (code) {
          try {
            const fn = new Function(
              "leaf",
              "controllers",
              "app",
              "obsidian",
              "__probe",
              `return (async () => { ${code} })()`,
            );
            evalResult = w.__probe.plain(
              await fn(leaf, controllers, w.app, w.__probeObsidian, w.__probe),
              -10,
            );
          } catch (e: any) {
            evalResult = { evalError: String(e?.stack ?? e) };
          }
        }
        return {
          selectedView: leaf.view.controller?.viewName ?? null,
          embeds,
          controllers: controllers.map((c: any) => w.__probe.readController(c)),
          views: viewEls.map((el: any) => w.__probe.readViewDom(el)),
          errors: [
            ...root.querySelectorAll(
              ".bases-error, .bases-query-error, .bases-view-error",
            ),
          ]
            .map((e: any) => e.textContent.trim())
            .filter((t: string) => t !== ""),
          eval: evalResult,
          pageText:
            root.querySelector(".view-content")?.innerText?.slice(0, 20000) ??
            null,
        };
      },
      { code: req.eval ?? null },
    );
    if (req.screenshot !== false) {
      const slug = `${req.file.replace(/[^\w.-]+/g, "_")}${viewName ? `--${viewName.replace(/[^\w.-]+/g, "_")}` : ""}`;
      const shot = join(outDir, `${slug}.png`);
      const box = await page.evaluate(() => {
        const r = (
          window as any
        ).__probeLeaf.view.containerEl.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      if (box.width > 0 && box.height > 0) {
        await page.screenshot({
          path: shot,
          clip: { ...box, height: Math.min(box.height, SCREENSHOT_LIMIT) },
          timeout: 30_000,
        });
        shots.push(shot);
        Object.assign(pass, { screenshot: shot });
      }
    }
    passes.push({ view: viewName, ...pass });
  }
  return { request: req, ...opened, viewNames, passes, screenshots: shots };
}

function summarize(results: any): string {
  const lines: string[] = [];
  lines.push(`# Obsidian Bases probe: ${results.vaultSource}`);
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(results.obsidian, null, 2));
  lines.push("```");
  for (const r of results.files) {
    lines.push("");
    lines.push(`## ${r.request.file}`);
    if (r.error) {
      lines.push(`ERROR: ${r.error}`);
      continue;
    }
    lines.push(
      `viewType=${r.viewType} mode=${r.mode} views=${JSON.stringify(r.viewNames)}`,
    );
    for (const pass of r.passes) {
      lines.push("");
      lines.push(
        `### view: ${pass.view ?? `(default: ${pass.selectedView ?? "embedded"})`}`,
      );
      if (pass.screenshot) lines.push(`screenshot: ${pass.screenshot}`);
      if (pass.embeds.length)
        lines.push(
          `embeds: ${JSON.stringify(pass.embeds.map((e: any) => [e.className, e.src]))}`,
        );
      if (pass.errors.length)
        lines.push(`errors: ${JSON.stringify(pass.errors)}`);
      pass.views.forEach((v: any, i: number) => {
        const c = pass.controllers[i];
        lines.push("");
        lines.push(
          `#### ${v.type} "${v.name}"${c?.error || c?.errorText ? ` error: ${c.error ?? c.errorText}` : ""}`,
        );
        if (v.type === "table") {
          lines.push(`| ${v.headers.map((h: any) => h.label).join(" | ")} |`);
          lines.push(`|${v.headers.map(() => "---").join("|")}|`);
          for (const row of v.rows)
            lines.push(
              `| ${row.map((c: any) => c.text.replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`,
            );
        } else if (v.type === "cards") {
          for (const card of v.cards) {
            lines.push(
              `- card ${Math.round(card.rect.width)}x${Math.round(card.rect.height)}` +
                (card.cover
                  ? ` cover ${Math.round(card.cover.rect.width)}x${Math.round(card.cover.rect.height)}`
                  : "") +
                `: ${card.properties.map((p: any) => `${p.property}=${JSON.stringify(p.text)}`).join(", ")}`,
            );
          }
        } else {
          lines.push("```");
          lines.push(v.text.slice(0, 3000));
          lines.push("```");
        }
        if (c) {
          lines.push("");
          lines.push("evaluated:");
          for (const e of c.entries) {
            const vals = Object.entries(e.values)
              .filter(([p]) => p !== "file.name")
              .map(([p, val]: [string, any]) =>
                val.error
                  ? `${p}: ERROR ${val.error}`
                  : `${p}: ${val.type} ${JSON.stringify(val.str)}${val.rendered?.text !== undefined && val.rendered.text !== val.str ? ` (renders ${JSON.stringify(val.rendered.text)})` : ""}`,
              );
            lines.push(`- ${e.file}: ${vals.join("; ")}`);
          }
        }
      });
      if (pass.eval !== undefined) {
        lines.push("");
        lines.push("eval:");
        lines.push("```json");
        lines.push(JSON.stringify(pass.eval, null, 2).slice(0, 20000));
        lines.push("```");
      }
    }
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------- main

async function runEval(
  flags: Record<string, string | boolean>,
  positional: string[],
) {
  const port = Number(flags.port ?? DEFAULT_PORT);
  let code = positional.join(" ");
  if (typeof flags.formulas === "string") {
    // --formulas '{"d":"date(\"2024-03-10\") - date(\"2024-03-01\")"}' [--filter 'file.name == "probe"']
    const filter =
      typeof flags.filter === "string" ? flags.filter : 'file.ext == "md"';
    code = `return await __probe.adhoc(${flags.formulas}, ${JSON.stringify(filter)})`;
  }
  const browser = await connect(port, 10_000);
  const page = await appPage(browser, 10_000);
  // Always (re)install, so an edited page-helpers.js applies to a running --keep session.
  await page.evaluate(readFileSync(join(HERE, "page-helpers.js"), "utf8"));
  if (typeof flags.click === "string") {
    // --click x,y: a real (CDP) mouse click before the code runs, e.g. to see what a card click does.
    const [x, y] = flags.click.split(",").map(Number);
    await page.mouse.click(x, y);
    await sleep(1_000);
  }
  const result = await withTimeout(
    page.evaluate(async (src) => {
      const w = window as any;
      const fn = new Function(
        "app",
        "obsidian",
        "__probe",
        `return (async () => { ${src} })()`,
      );
      return w.__probe.plain(
        await fn(w.app, w.__probeObsidian, w.__probe),
        -10,
      );
    }, code),
    EVAL_TIMEOUT_MS,
    "eval",
  );
  if (typeof flags.screenshot === "string")
    await page.screenshot({ path: flags.screenshot });
  console.log(
    typeof result === "string" ? result : JSON.stringify(result, null, 2),
  );
  await browser.close().catch(() => undefined);
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  if (positional[0] === "eval") return runEval(flags, positional.slice(1));
  const src = positional[0];
  if (!src || flags.help) {
    console.log(
      readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0],
    );
    process.exit(src ? 0 : 2);
  }
  const vaultSource = resolve(src);
  if (!existsSync(vaultSource))
    throw new Error(`no such vault directory: ${vaultSource}`);
  const name =
    typeof flags.name === "string" ? flags.name : basename(vaultSource);
  const outDir = resolve(
    typeof flags.out === "string"
      ? flags.out
      : join(DEV_DIR, "obsidian-bases-probe", name),
  );
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const specPath = join(vaultSource, "probe.json");
  const spec: ProbeSpec = existsSync(specPath)
    ? (safeReadJson(specPath) as ProbeSpec)
    : {};
  let requests = spec.open ?? defaultRequests(vaultSource);
  if (typeof flags.open === "string") {
    const only = flags.open.split(",");
    requests = only.map(
      (f) =>
        requests.find((r) => r.file === f) ?? {
          file: f,
          views: f.endsWith(".base") ? "all" : undefined,
        },
    );
  }

  const vault = join(tmpdir(), `obsidian-bases-probe-${name}-${process.pid}`);
  prepareVault(vaultSource, vault);
  rmSync(join(vault, "probe.json"), { force: true });

  const width = Number(flags.width ?? 1600);
  const height = Number(flags.height ?? 1200);
  const session = await startSession({
    vault,
    appVersion:
      typeof flags["app-version"] === "string"
        ? flags["app-version"]
        : (process.env.OBSIDIAN_APP_VERSION ?? "latest"),
    lang: typeof flags.lang === "string" ? flags.lang : undefined,
    chromiumLang:
      typeof flags["chromium-lang"] === "string"
        ? flags["chromium-lang"]
        : undefined,
    tz: typeof flags.tz === "string" ? flags.tz : undefined,
    width,
    height,
    port: flags.port
      ? Number(flags.port)
      : flags.keep
        ? DEFAULT_PORT
        : undefined,
  });
  log(
    `Obsidian ${session.info.obsidianApp} (${session.info.executable}) on CDP port ${session.port}`,
  );
  try {
    const files = [];
    for (const req of requests) {
      log(`opening ${req.file}`);
      try {
        files.push(
          await withTimeout(
            probeFile(session.page, req, outDir, Number(flags.wait ?? 8000)),
            EVAL_TIMEOUT_MS * 2,
            `probing ${req.file}`,
          ),
        );
      } catch (e) {
        files.push({ request: req, error: String((e as Error).stack ?? e) });
      }
    }
    const results = {
      vaultSource,
      probedAt: new Date().toISOString(),
      obsidian: session.info,
      files,
    };
    writeFileSync(
      join(outDir, "results.json"),
      JSON.stringify(results, null, 2),
    );
    writeFileSync(join(outDir, "SUMMARY.md"), summarize(results));
    if (flags.json) console.log(JSON.stringify(results, null, 2));
    else
      log(
        `wrote ${relative(process.cwd(), join(outDir, "SUMMARY.md"))} and results.json`,
      );
    if (flags.keep) {
      const minutes = typeof flags.keep === "string" ? Number(flags.keep) : 30;
      log(
        `keeping Obsidian open for ${minutes} min: tsx scripts/obsidian-bases-probe/probe.ts eval --port ${session.port} '<js>'  (vault copy: ${vault})`,
      );
      await sleep(minutes * 60_000);
    }
  } finally {
    await session.browser.close().catch(() => undefined);
    await session.stop();
    rmSync(vault, { recursive: true, force: true });
  }
}

main().catch((e) => {
  log(String((e as Error).stack ?? e));
  process.exit(1);
});
