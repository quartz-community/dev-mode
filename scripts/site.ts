/**
 * Build / serve Quartz sites in isolated sandboxes (never touches repos/quartz).
 *
 *   site build <target> [--config overlay.yaml] [--name n] [--verbose] [--json]
 *   site serve <target> [--port 8080] [--no-build]       static server (production-like)
 *   site dev   <target> [--port 8080] [--ws-port 3001]   Quartz live server, sandboxed
 *   site config <target> [--config overlay.yaml]         print the resolved config YAML
 *   site targets [--json]                                list fixtures / repros
 *
 * <target>: fixture:<name> | repro:<slug> | docs | <dir> (see scripts/lib/site-target.ts)
 */
import { spawn } from "node:child_process";
import { stringify } from "yaml";
import { parseArgs } from "./lib/args.js";
import {
  enabledPluginNames,
  findStaleDists,
  prepareConfiguredSandbox,
  rel,
} from "./lib/sandbox.js";
import {
  formatStaleDists,
  listFixtures,
  listRepros,
  parseSiteTarget,
  prepareSite,
  resolveTargetConfig,
} from "./lib/site-target.js";
import { basePathFromBaseUrl, startStaticServer } from "./lib/static-server.js";

const USAGE = `Usage:
  site build <target> [--config overlay.yaml] [--name n] [--verbose] [--json]
  site serve <target> [--port 8080] [--no-build] [--config overlay.yaml]
  site dev <target> [--port 8080] [--ws-port 3001] [--config overlay.yaml]
  site config <target> [--config overlay.yaml]
  site targets [--json]

<target>: fixture:<name> | repro:<slug> | docs | <dir>`;

function str(flag: string | boolean | undefined): string | undefined {
  return typeof flag === "string" ? flag : undefined;
}

async function cmdBuild(spec: string, flags: Record<string, string | boolean>) {
  const prepared = await prepareSite(spec, {
    config: str(flags.config),
    name: str(flags.name),
    verbose: Boolean(flags.verbose),
  }).catch((error: Error) => {
    if (flags.json) {
      console.log(
        JSON.stringify(
          { ok: false, target: spec, error: error.message },
          null,
          2,
        ),
      );
    } else {
      console.error(error.message);
    }
    process.exit(1);
  });
  const build = prepared.build!;
  if (flags.json) {
    const { log: _log, ...rest } = build;
    console.log(
      JSON.stringify(
        { ...rest, basePath: prepared.basePath, target: prepared.target.spec },
        null,
        2,
      ),
    );
    return;
  }
  console.log(
    `✓ Built ${prepared.target.spec} in ${(build.durationMs / 1000).toFixed(1)}s → ${rel(build.outDir)}`,
  );
  console.log(
    `  plugins enabled: ${build.enabledPlugins.length}   base path: ${prepared.basePath || "/"}   log: ${rel(build.logPath)}`,
  );
  for (const line of formatStaleDists(build)) console.log(line);
  for (const w of build.warnings) console.log(`  ${w}`);
  for (const e of build.errors) console.log(`  ${e}`);
}

async function cmdServe(spec: string, flags: Record<string, string | boolean>) {
  const prepared = await prepareSite(spec, {
    config: str(flags.config),
    name: str(flags.name),
    noBuild: Boolean(flags["no-build"]),
    basePath: str(flags["base-path"]),
  });
  for (const line of formatStaleDists(prepared.build)) console.log(line);
  const port = Number(str(flags.port) ?? 8080);
  const server = await startStaticServer({
    root: prepared.siteDir,
    basePath: prepared.basePath,
    port,
  });
  console.log(
    `Serving ${rel(prepared.siteDir)} at ${server.url("")}  (Ctrl+C to stop)`,
  );
  const stop = () => {
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function cmdDev(spec: string, flags: Record<string, string | boolean>) {
  const target = parseSiteTarget(spec);
  const config = resolveTargetConfig(target, str(flags.config));
  const name = `dev-${str(flags.name) ?? target.id}`;
  const stale = findStaleDists(config);
  for (const s of stale) {
    console.log(
      `⚠ ${s.name}: dist/ is ${s.reason === "missing" ? "missing" : "older than src/"} — run: just build-plugin ${s.name} (or keep 'just watch' running)`,
    );
  }
  const prepared = await prepareConfiguredSandbox(name, config);
  if (!prepared.ok) {
    console.error(prepared.log);
    process.exit(1);
  }
  const port = str(flags.port) ?? "8080";
  const wsPort = str(flags["ws-port"]) ?? "3001";
  const basePath = basePathFromBaseUrl(config.configuration.baseUrl);
  console.log(
    `Sandbox ${rel(prepared.dir)} — Quartz live server on http://localhost:${port}/ (content: ${rel(target.contentDir!)})`,
  );
  if (basePath)
    console.log(
      `  note: config baseUrl has base path ${basePath}; the Quartz dev server serves at /`,
    );
  // No timeout: this is an interactive long-running server, stopped with Ctrl+C.
  const child = spawn(
    process.execPath,
    [
      "quartz/bootstrap-cli.mjs",
      "build",
      "--serve",
      "-d",
      target.contentDir!,
      "--port",
      port,
      "--wsPort",
      wsPort,
    ],
    { cwd: prepared.dir, stdio: "inherit" },
  );
  const forward = (signal: NodeJS.Signals) => () => child.kill(signal);
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));
  child.on("close", (code) => process.exit(code ?? 0));
}

function cmdConfig(spec: string, flags: Record<string, string | boolean>) {
  const target = parseSiteTarget(spec);
  const config = resolveTargetConfig(target, str(flags.config));
  if (flags.json) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  console.log(`# Resolved config for ${target.spec}`);
  console.log(`# enabled plugins: ${enabledPluginNames(config).join(", ")}`);
  console.log(stringify(config, { lineWidth: 0 }));
}

function cmdTargets(flags: Record<string, string | boolean>) {
  const fixtures = listFixtures();
  const repros = listRepros();
  if (flags.json) {
    console.log(JSON.stringify({ fixtures, repros }, null, 2));
    return;
  }
  console.log("Fixtures (e2e/fixtures):");
  for (const f of fixtures) console.log(`  fixture:${f}`);
  console.log("Repros (e2e/repros):");
  for (const r of repros) console.log(`  repro:${r}`);
  if (!repros.length)
    console.log("  (none — create one with: just repro-new <slug>)");
  console.log(
    "Other: docs (repos/quartz/docs with the default config), or a directory path",
  );
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [command, spec] = positional;
  if (!command || flags.help) {
    console.log(USAGE);
    process.exit(command ? 0 : 1);
  }
  if (command === "targets") return cmdTargets(flags);
  if (!spec) {
    console.error(`Missing <target>.\n${USAGE}`);
    process.exit(1);
  }
  switch (command) {
    case "build":
      return cmdBuild(spec, flags);
    case "serve":
      return cmdServe(spec, flags);
    case "dev":
      return cmdDev(spec, flags);
    case "config":
      return cmdConfig(spec, flags);
    default:
      console.error(`Unknown command "${command}".\n${USAGE}`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
