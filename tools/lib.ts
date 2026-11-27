// What the store's tools share: reading entries, checking them against the rules, and building a module's
// package from its own source the way Bitfocus's store does.
//
// The platform is not a dependency of this repository. The tools are handed a checkout of it (see
// platform.json) and use its own code to judge a package, so the store and a hub can never disagree.
// They import one file from it, mod.ts, which is what the platform offers to tools outside it.

export const arg = (name: string, fallback?: string): string => {
  const hit = Deno.args.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
};

/**
 * Which way of building packages this is. With the source commit it says exactly which package something is,
 * so the same commit is never built twice and a hub never mistakes a second build for a newer version.
 * Raise it only when the tools change in a way that should reach hubs: every entry is then built again.
 */
export const RECIPE = 1;

/**
 * Where the package for one entry is kept. Each module has a release of its own in this repository, and each
 * version of it is a file there that is written once and never changed. The list on the store's site only
 * points at them, so publishing costs the same however many packages there are.
 */
export function packageHome(repo: string, id: string, commit: string) {
  const release = `pkg-${id}`, file = `${commit.slice(0, 12)}-r${RECIPE}.tgz`;
  return { release, file, url: `https://github.com/${repo}/releases/download/${release}/${file}` };
}

export const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

export interface Entry {
  kind: "companion-module";
  id: string;
  name: string;
  description: string;
  source: { repo: string; commit: string };
  network: string[];
  advise?: Advice[];
  settings?: Record<string, string | number | boolean>;
  tested: "starts" | "pretend-device" | "real-device";
  notes?: string;
}

/** What reviewers say about one kind of request. See schema/module.schema.json. */
export interface Advice {
  about: string;
  say: "yes" | "no";
  why: string;
}

// deno-lint-ignore no-explicit-any
export type Platform = any;

/** What the store says about everything it lists, from advice.json. Throws when that file breaks the rules. */
export async function generalAdvice(platform: Platform): Promise<Advice[]> {
  const schema = JSON.parse(await Deno.readTextFile(`${ROOT}/schema/module.schema.json`));
  const valid = platform.ajv.compile({
    type: "object",
    additionalProperties: false,
    required: ["advise"],
    properties: { advise: { type: "array", maxItems: 16, items: schema.$defs.advice } },
  });
  const raw = JSON.parse(await Deno.readTextFile(`${ROOT}/advice.json`));
  if (!valid(raw)) {
    throw new Error(`advice.json does not follow the rules: ${platform.explain(valid.errors)}`);
  }
  return raw.advise;
}

/** The public keys the store's list is signed with, from keys.json. Empty until the store has a key. */
export async function storeKeys(): Promise<string[]> {
  const raw = JSON.parse(await Deno.readTextFile(`${ROOT}/keys.json`));
  if (!Array.isArray(raw?.keys) || !raw.keys.every((k: unknown) => typeof k === "string" && k.length < 100)) {
    throw new Error("keys.json must be a list of public keys");
  }
  return raw.keys;
}

/** What the platform offers to outside tools, from a checkout of it. */
export async function loadPlatform(dir: string): Promise<Platform> {
  const base = new URL(`${dir.replace(/\/$/, "")}/`, `file://${Deno.cwd()}/`).href;
  return await import(`${base}mod.ts`);
}

/** Every entry in modules/, with what is wrong with each. An entry with problems is never built. */
export async function readEntries(
  platform: Platform,
): Promise<{ file: string; entry: Entry; problems: string[] }[]> {
  const schema = JSON.parse(await Deno.readTextFile(`${ROOT}/schema/module.schema.json`));
  const valid = platform.ajv.compile(schema);
  const out: { file: string; entry: Entry; problems: string[] }[] = [];
  const names: string[] = [];
  for await (const f of Deno.readDir(`${ROOT}/modules`)) {
    if (f.isFile && f.name.endsWith(".json")) names.push(f.name);
  }
  for (const name of names.sort()) {
    const file = `modules/${name}`;
    const problems: string[] = [];
    // deno-lint-ignore no-explicit-any
    let entry: any = {};
    try {
      entry = JSON.parse(await Deno.readTextFile(`${ROOT}/${file}`));
    } catch {
      problems.push("it is not valid JSON");
    }
    if (!problems.length && !valid(entry)) problems.push(platform.explain(valid.errors));
    if (!problems.length && `${entry.id}.json` !== name) {
      problems.push(`its id is ${entry.id}, so the file must be named ${entry.id}.json`);
    }
    if (!problems.length) {
      const wide = entry.network.filter((n: string) => n === "lan" || n === "listen");
      if (wide.length && !entry.notes) {
        problems.push(`it asks for ${wide.join(" and ")} and gives no reason in notes`);
      }
    }
    out.push({ file, entry, problems });
  }
  return out;
}

/** Licenses that allow a built copy to be passed on, as long as the license travels with it. */
export const LICENSES = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"];

/**
 * Why the store may not hand out copies of this package, or null when it may. The store publishes the built
 * package, so the package must name a license that allows that and must carry the license text inside.
 */
// deno-lint-ignore no-explicit-any
export function licenseProblem(pkg: any): string | null {
  if (!LICENSES.includes(pkg.about.license)) {
    return `its package names the license "${
      String(pkg.about.license).slice(0, 40) || "none"
    }", and the store only hands out ${LICENSES.join(", ")}`;
  }
  if (!pkg.files.some((f: { path: string }) => /^module\/licen[cs]e(\.[a-z]+)?$/i.test(f.path))) {
    return "its package does not carry its license text, which the license requires of every copy";
  }
  return null;
}

/**
 * What kinds of thing an entry is, from the words its author filed it under. kinds.json says which words
 * mean which kind. A module's own keywords decide; only when it has none is what it says it makes looked
 * at. Two kinds at most, in the order kinds.json lists them. None is an answer too: it is then found by
 * its maker and by typing.
 */
export function kindsFor(keywords: string[], makes: string, table: Record<string, string[]>): string[] {
  const filed = keywords.map((k) => k.toLowerCase().trim()).filter(Boolean);
  const from = filed.length ? filed : [makes.toLowerCase()];
  const has = (word: string) =>
    from.some((k) =>
      k === word || new RegExp(`(^|[^a-z0-9])${word.replace(/[^a-z0-9 ]/g, "")}([^a-z0-9]|$)`).test(k)
    );
  return Object.entries(table).filter(([, words]) => words.some(has)).map(([kind]) => kind).slice(0, 2);
}

/** Which words mean which kind of thing, from kinds.json. */
export async function kindsTable(): Promise<Record<string, string[]>> {
  const raw = JSON.parse(await Deno.readTextFile(`${ROOT}/kinds.json`));
  const table: Record<string, string[]> = {};
  for (const [kind, words] of Object.entries(raw.kinds ?? {})) {
    if (!/^[A-Za-z][A-Za-z ]{1,29}$/.test(kind) || !Array.isArray(words)) {
      throw new Error(`kinds.json: "${kind.slice(0, 40)}" is not a kind and a list of words`);
    }
    table[kind] = words.map((w) => String(w).toLowerCase().trim()).filter((w) =>
      /^[a-z0-9][a-z0-9 -]{1,29}$/.test(w)
    );
  }
  return table;
}

/**
 * What went wrong, out of everything a failed step printed: the lines that say so, not the tail of a stack
 * trace. This is what gets written down as the reason, so it has to be the part worth reading.
 */
export function gist(out: string, max = 600): string {
  const lines = out.split("\n")
    // deno-lint-ignore no-control-regex
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim())
    .filter((l) => l && !/^at\s/.test(l) && !/^Node\.js v/.test(l) && !/^[{}\[\]]+,?$/.test(l));
  const telling = lines.filter((l) =>
    /\berror\b|not found|cannot|can't|failed|unsupported|not supported|ERR!|invalid|missing/i.test(l)
  );
  const text = (telling.length ? telling : lines.slice(-12)).join(" ").replace(/\s+/g, " ");
  return text.slice(0, max);
}

/**
 * Which license a library's own license file is, when its package.json does not say. Only the few whose
 * text is unmistakable, by words that are in every copy of them. Anything else is "not known", which the
 * store treats as no license.
 */
export function licenseFromText(text: string): string {
  const t = text.replace(/\s+/g, " ").toLowerCase();
  const grants = "permission is hereby granted, free of charge, to any person";
  // The Boost license by its name, or by its one condition. Its opening words alone are not enough: some
  // libraries use them with the condition taken out, and that is a different text, not this license.
  if (
    t.includes("boost software license") ||
    (t.includes(`${grants} or organization obtaining a copy`) &&
      t.includes("must be included in all copies of the software, in whole or in part"))
  ) {
    return "BSL-1.0";
  }
  if (
    t.includes(`${grants} obtaining a copy`) &&
    t.includes('the software is provided "as is", without warranty of any kind')
  ) {
    return "MIT";
  }
  if (
    t.includes(
      "permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted",
    )
  ) {
    return "ISC";
  }
  if (t.includes("apache license") && t.includes("version 2.0")) return "Apache-2.0";
  if (
    t.includes(
      "redistribution and use in source and binary forms, with or without modification, are permitted",
    )
  ) {
    return t.includes("neither the name") ? "BSD-3-Clause" : "BSD-2-Clause";
  }
  return "";
}

/** The license a library's own files say it is under, from a LICENSE or COPYING file beside its code. */
export async function licenseInFiles(dir: string): Promise<string> {
  try {
    for await (const f of Deno.readDir(dir)) {
      if (!f.isFile || !/^(licen[cs]e|copying)(\.[a-z]+)?$/i.test(f.name)) continue;
      const found = licenseFromText((await Deno.readTextFile(`${dir}/${f.name}`)).slice(0, 40000));
      if (found) return found;
    }
  } catch { /* no such folder, or nothing in it that can be read */ }
  return "";
}

/** Whether a library has a license file beside its code at all, whatever it says. */
export async function hasLicenseFile(dir: string): Promise<boolean> {
  try {
    for await (const f of Deno.readDir(dir)) {
      if (f.isFile && /^(licen[cs]e|copying)(\.[a-z]+)?$/i.test(f.name)) return true;
    }
  } catch { /* no such folder */ }
  return false;
}

/** Take the shortcuts to command-line tools out of an unpacked package. True if there were any. */
export async function dropToolShortcuts(dir: string): Promise<boolean> {
  let dropped = false;
  const walk = async (at: string, depth: number): Promise<void> => {
    if (depth > 12) return;
    for await (const f of Deno.readDir(at)) {
      const path = `${at}/${f.name}`;
      if (f.name === ".bin" && at.endsWith("/node_modules")) {
        await Deno.remove(path, { recursive: true });
        dropped = true;
      } else if (f.isDirectory && !f.isSymlink) await walk(path, depth + 1);
    }
  };
  await walk(dir, 0).catch(() => {});
  return dropped;
}

/**
 * A stand-in for the one thing a module's build asks Yarn for: "run this tool". It finds the tool in the
 * nearest node_modules and runs it. Anything else it is asked is passed to the real Yarn untouched.
 */
export async function yarnStandIn(work: string): Promise<string> {
  const dir = `${work}/yarn-stand-in`;
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/yarn`,
    `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const rest = args[0] === "run" ? args.slice(1) : args.slice();
while (["-B", "--binary", "-T", "--top-level"].includes(rest[0])) rest.shift();
const name = rest[0];
let tool = null;
if (name && /^[A-Za-z0-9._-]+$/.test(name)) {
  for (let dir = process.cwd();;) {
    const here = path.join(dir, "node_modules", ".bin", name);
    if (fs.existsSync(here)) { tool = here; break; }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
}
const mine = path.dirname(fs.realpathSync(__filename));
const without = (process.env.PATH || "").split(path.delimiter)
  .filter((p) => p && path.resolve(p) !== mine).join(path.delimiter);
const done = tool
  ? spawnSync(tool, rest.slice(1), { stdio: "inherit" })
  : spawnSync("yarn", args, { stdio: "inherit", env: { ...process.env, PATH: without } });
process.exit(done.status === null ? 1 : done.status);
`,
  );
  await Deno.chmod(`${dir}/yarn`, 0o755);
  return dir;
}

export async function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<{ ok: boolean; out: string }> {
  // A tool that is not on this computer is a failed step like any other, with a reason.
  const r = await new Deno.Command(cmd, { args, cwd, env, stdout: "piped", stderr: "piped" }).output().catch(
    (err) => ({
      success: false,
      stdout: new Uint8Array(),
      stderr: new TextEncoder().encode(String((err as Error).message)),
    }),
  );
  const text = new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr);
  return { ok: r.success, out: text.trim().slice(-1500) };
}

/** Licenses a bundled library may carry. Each allows copies to be passed on if its notice goes with them. */
const BUNDLED_OK = [...LICENSES, "0BSD", "Unlicense", "CC0-1.0", "BlueOak-1.0.0", "BSL-1.0"];

/** Is this license expression one the store may hand out? "A OR B" needs one of them, "A AND B" both. */
export function licenseAllowed(expression: string): boolean {
  const text = expression.replace(/[()]/g, " ").trim();
  if (!text) return false;
  return text.split(/\s+OR\s+/i).some((alt) =>
    alt.split(/\s+AND\s+/i).every((l) => BUNDLED_OK.includes(l.trim()))
  );
}

/** A library's package.json: whatever its author wrote there. Read as data, never trusted for its shape. */
// deno-lint-ignore no-explicit-any
type PackageJson = any;

/** The license a library's package.json declares, in any of the ways that has been written over the years. */
export function declaredLicense(pj: PackageJson): string {
  const one = (l: unknown): string =>
    typeof l === "string"
      ? l
      : l && typeof l === "object"
      ? String((l as { type?: unknown }).type ?? "")
      : "";
  if (typeof pj?.license === "string") return pj.license;
  // More than one means any of them may be chosen.
  if (Array.isArray(pj?.license)) return pj.license.map(one).filter(Boolean).join(" OR ");
  if (pj?.license && typeof pj.license === "object") return one(pj.license);
  if (Array.isArray(pj?.licenses)) return pj.licenses.map(one).filter(Boolean).join(" OR ");
  return "";
}

/**
 * The credit for a library that declares a license and ships no text of it: what it is, the license it
 * declares, and who wrote it and where it lives as its own package.json says. Also which standard license
 * texts should go with it. Everything here is the library's own words about itself, kept as plain text.
 */
export function noticeFor(
  pj: PackageJson,
  name: string,
  version: string,
  license: string,
): { text: string; standard: string[] } {
  const plain = (v: unknown, max: number) =>
    [...String(v ?? "")].map((c) => (c.charCodeAt(0) < 32 ? " " : c)).join("").trim().slice(0, max);
  const person = (a: unknown): string =>
    typeof a === "string" ? a : a && typeof a === "object"
      ? [
        (a as { name?: unknown }).name,
        (a as { email?: unknown }).email ? `<${(a as { email?: unknown }).email}>` : "",
      ]
        .filter(Boolean).join(" ")
      : "";
  const author = plain(
    person(pj?.author) || (Array.isArray(pj?.contributors) ? pj.contributors.map(person).join(", ") : ""),
    200,
  );
  const source = plain(
    typeof pj?.repository === "string" ? pj.repository : pj?.repository?.url ?? pj?.homepage ?? "",
    200,
  ) || `https://www.npmjs.com/package/${name}/v/${version}`;
  // Of the licenses it may be used under, the ones the store hands out and has the standard text of.
  const standard = license.replace(/[()]/g, " ").split(/\s+(?:OR|AND)\s+/i).map((l) => l.trim()).filter((l) =>
    BUNDLED_OK.includes(l)
  );
  return {
    standard,
    text: `${name}@${version} — ${license}\n${"-".repeat(80)}\n` +
      `This library declares the ${license} license in its package.json and ships no license text or copyright\n` +
      `notice of its own, so there is none of its own to pass on.\n` +
      (author ? `Written by, as its package.json says: ${author}\n` : "") +
      `Source: ${source}\n` +
      (standard.length ? `The standard text of ${standard.join(" and ")} is at the end of this file.\n` : ""),
  };
}

/**
 * The license text a README carries, if it carries one: what stands under a heading called License, when that
 * holds a copyright line or the words of a grant. A heading that only names a license is not its text.
 */
export function noticeInReadme(readme: string): string {
  const lines = readme.replaceAll("\r", "").split("\n");
  const underlined = (i: number) => /^(=+|-+)\s*$/.test(lines[i + 1] ?? "") && lines[i].trim() !== "";
  for (let i = 0; i < lines.length; i++) {
    const hashes = /^(#{1,6})\s*licen[cs]e\b/i.exec(lines[i]);
    const under = /^licen[cs]e\s*$/i.test(lines[i].trim()) && underlined(i);
    if (!hashes && !under) continue;
    const level = hashes ? hashes[1].length : lines[i + 1].startsWith("=") ? 1 : 2;
    const body: string[] = [];
    for (let j = i + (under ? 2 : 1); j < lines.length; j++) {
      const next = /^(#{1,6})\s/.exec(lines[j]);
      if ((next && next[1].length <= level) || underlined(j)) break;
      body.push(lines[j]);
    }
    const text = body.join("\n").trim();
    if (
      /permission is hereby granted|redistribution and use|permission to use, copy, modify|apache license|copyright|©|\(c\)/i
        .test(text)
    ) return text.slice(0, 20000);
  }
  return "";
}

export interface Bundled {
  name: string;
  version: string;
  license: string;
  /** Where its notice in the package comes from. */
  notice: "the module's build" | "added by the store" | "none is published";
}

export interface Built {
  /** The finished package. */
  tgz: string;
  /** Every library that is really inside the module's program. */
  bundled: Bundled[];
  /** Why the store may not hand this package out. Empty when it may. */
  problems: string[];
  /** How what it needs was installed: with which tool, and whether from its author's lockfile. */
  installed: string;
}

const exists = async (path: string) => !!(await Deno.stat(path).catch(() => null));

/**
 * Build a module's package from its source at the pinned commit. This runs the module's own build, which is
 * someone else's code: it happens on a machine that holds no secrets, and install scripts are never run.
 *
 * The package must carry the license notice of everything bundled inside it. The module's build lists only
 * some of that, so the store builds once more in a mode that names every file it pulls in, finds what the list
 * missed, and adds those notices to the package.
 */
export async function buildModule(entry: Entry, work: string): Promise<Built> {
  const src = `${work}/src`;
  await Deno.mkdir(src, { recursive: true });
  const step = async (
    what: string,
    cmd: string,
    args: string[],
    cwd = src,
    env: Record<string, string> = {},
  ) => {
    const r = await run(cmd, args, cwd, env);
    if (!r.ok) throw new Error(`${what} failed: ${gist(r.out)}`);
    return r.out;
  };
  await step("starting a checkout", "git", ["init", "-q"]);
  await step("naming the source", "git", ["remote", "add", "origin", entry.source.repo]);
  await step("fetching the pinned commit", "git", [
    "fetch",
    "-q",
    "--depth",
    "1",
    "origin",
    entry.source.commit,
  ]);
  await step("checking it out", "git", ["checkout", "-q", "FETCH_HEAD"]);
  const got = (await step("reading the commit", "git", ["rev-parse", "HEAD"])).trim();
  if (got !== entry.source.commit) {
    throw new Error(`the source is at ${got}, not the pinned ${entry.source.commit}`);
  }
  // Installed the way its author installs it: with their tool, from their lockfile, so what is built is what
  // they tested. Install scripts are never run, whichever tool it is. If their way does not work here, plain
  // npm is tried, which was the only way before.
  const theirPackage = JSON.parse(await Deno.readTextFile(`${src}/package.json`));
  const quiet = {
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    YARN_ENABLE_SCRIPTS: "false",
    YARN_NODE_LINKER: "node-modules",
    YARN_ENABLE_TELEMETRY: "0",
  };
  const tried: string[] = [];
  let installedHow = "";
  const install = async (how: string, cmd: string, args: string[]) => {
    const r = await run(cmd, args, src, quiet);
    if (!r.ok) tried.push(`${how}: ${r.out.replace(/\s+/g, " ").slice(-240)}`);
    else installedHow = how;
    return r.ok;
  };
  let installed = false, usedModernYarn = false;
  if (await exists(`${src}/yarn.lock`)) {
    const modern = /^yarn@([2-9]|[1-9][0-9])\./.test(String(theirPackage.packageManager ?? "")) ||
      await exists(`${src}/.yarnrc.yml`);
    installed = await install(
      "with Yarn, from its lockfile",
      "yarn",
      modern
        ? ["install", "--immutable", "--mode=skip-build"]
        : ["install", "--frozen-lockfile", "--ignore-scripts", "--non-interactive"],
    );
    usedModernYarn = installed && modern;
  }
  if (!installed && await exists(`${src}/package-lock.json`)) {
    installed = await install("with npm, from its lockfile", "npm", [
      "ci",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]);
  }
  if (!installed) {
    installed = await install("with npm", "npm", [
      "install",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
    ]);
  }
  if (!installed) throw new Error(`installing what the module needs failed. ${tried.join(" | ")}`);

  // A module written in TypeScript has to be compiled before it can be packaged. That is done here with
  // the compiler the module itself asks for, pointed at the module's own settings, and not by running the
  // module's build script: a script can do anything, and they differ in which tools they expect to find.
  const settings = (await exists(`${src}/tsconfig.build.json`))
    ? "tsconfig.build.json"
    : (await exists(`${src}/tsconfig.json`))
    ? "tsconfig.json"
    : "";
  if (settings) await step("compiling its TypeScript", "npx", ["--no-install", "tsc", "-p", settings]);

  // A module's build tool asks Yarn to run webpack for it, in a way only newer Yarn understands. A module
  // whose lockfile is from older Yarn, or from npm, is installed the way its lockfile asks, and then that
  // one request is answered here: the tool it names is run from the module's own node_modules.
  const asked: Record<string, string> = usedModernYarn
    ? {}
    : { PATH: `${await yarnStandIn(work)}:${Deno.env.get("PATH") ?? ""}` };

  // First a build that keeps the name of every file it pulls in, to learn what is really inside.
  await step(
    "listing what gets bundled",
    "npx",
    ["--no-install", "companion-module-build", "--dev"],
    src,
    asked,
  );
  const named = await Deno.readTextFile(`${src}/pkg/main.js`);
  const dirs = new Set<string>();
  for (const m of named.matchAll(/node_modules\/[A-Za-z0-9_@.\/-]+/g)) {
    const at = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(m[0] + "/");
    if (at) dirs.add(at[1]);
  }
  for await (const f of Deno.readDir(src)) {
    if (f.isFile && f.name.endsWith(".tgz")) await Deno.remove(`${src}/${f.name}`);
  }

  // Then the build that is handed out.
  await step("building the package", "npx", ["--no-install", "companion-module-build"], src, asked);
  let tgz = "";
  for await (const f of Deno.readDir(src)) if (f.isFile && f.name.endsWith(".tgz")) tgz = `${src}/${f.name}`;
  if (!tgz) throw new Error("the build made no package");

  // What the module's own build already credits.
  const out = `${work}/out`;
  await Deno.mkdir(out, { recursive: true });
  await step("opening the package", "tar", ["-xzf", tgz, "-C", out], work);
  let top = "pkg";
  for await (const f of Deno.readDir(out)) if (f.isDirectory) top = f.name;
  // A build can leave shortcuts to command-line tools in the package (node_modules/.bin). A hub takes only
  // plain files, and a module never runs those tools, so the shortcuts are left out. Any other link stays,
  // and the hub will refuse the package for it: that one would need a person to look.
  const shortcuts = await dropToolShortcuts(`${out}/${top}`);
  const theirs = await Deno.readTextFile(`${out}/${top}/LICENSE`).catch(() => "");
  const credited = new Set<string>();
  for (const line of theirs.matchAll(/^Packages: (.+)$/gm)) {
    for (const part of line[1].split(", ")) credited.add(part.split(" ")[0]);
  }
  // The standard text of each license that had to be added for a library that ships none of its own.
  const standard = new Set<string>();

  const bundled: Bundled[] = [];
  const problems: string[] = [];
  const additions: string[] = [];
  for (const dir of [...dirs].sort()) {
    if (!(await exists(`${src}/${dir}/package.json`))) continue;
    const pj = JSON.parse(await Deno.readTextFile(`${src}/${dir}/package.json`));
    const name = String(pj.name ?? dir), version = String(pj.version ?? "");
    // Some libraries say what their license is only in a file beside their code, not in package.json.
    const license = declaredLicense(pj) || await licenseInFiles(`${src}/${dir}`);
    if (bundled.some((b) => b.name === name && b.version === version)) continue;
    if (!licenseAllowed(license)) {
      // A library that says nothing of a license is one thing. One that carries a license text the store
      // does not recognize is another: that text may well allow it, and a person has to read it to say.
      const ownText = !license && await hasLicenseFile(`${src}/${dir}`);
      problems.push(
        ownText
          ? `the bundled library ${name} ${version} carries a license text of its own that the store does not recognize, so a person has to read it`
          : `the bundled library ${name} ${version} is under "${
            license.slice(0, 40) || "no license"
          }", which the store does not hand out`,
      );
    }
    if (credited.has(`${name}@${version}`)) {
      bundled.push({ name, version, license, notice: "the module's build" });
      continue;
    }
    const texts: string[] = [];
    for await (const f of Deno.readDir(`${src}/${dir}`)) {
      if (f.isFile && /^(licen[cs]e|copying|notice)/i.test(f.name)) {
        texts.push((await Deno.readTextFile(`${src}/${dir}/${f.name}`)).trim());
      }
    }
    // Some libraries publish their license inside their README and nowhere else. That is still its text.
    if (!texts.length) {
      for await (const f of Deno.readDir(`${src}/${dir}`)) {
        if (f.isFile && /^readme(\.[a-z]+)?$/i.test(f.name)) {
          const inside = noticeInReadme(await Deno.readTextFile(`${src}/${dir}/${f.name}`));
          if (inside) texts.push(inside);
        }
      }
    }
    // A text someone supplied by hand for a library whose package ships none (notices/texts).
    if (!texts.length) {
      const supplied = await Deno.readTextFile(`${ROOT}/notices/texts/${name.replaceAll("/", "__")}.txt`)
        .catch(
          () => "",
        );
      if (supplied.trim()) texts.push(supplied.trim());
    }
    if (texts.length) {
      additions.push(`${name}@${version} — ${license}\n${"-".repeat(80)}\n${texts.join("\n\n")}\n`);
      bundled.push({ name, version, license, notice: "added by the store" });
    } else if (licenseAllowed(license)) {
      // It declares a license and ships no text of it, so there is no notice of its own to pass on. It is
      // credited by name, with what its package.json says of who wrote it and where it lives, and the
      // standard text of the license it declares goes in once, below.
      const said = noticeFor(pj, name, version, license);
      for (const id of said.standard) standard.add(id);
      additions.push(said.text);
      bundled.push({ name, version, license, notice: "none is published" });
    }
    // A library with no license, or one the store does not hand out, was refused above.
  }
  for (const id of [...standard].sort()) {
    additions.push(
      `The standard text of the ${id} license\n${"=".repeat(80)}\n${
        (await Deno.readTextFile(`${ROOT}/notices/standard/${id}.txt`)).trim()
      }\n`,
    );
  }

  // An older build tool leaves the module's own license out of the package. The license asks for it to go
  // with every copy, so it is put in from the module's source.
  let ownLicense = false;
  const inPackage: string[] = [];
  for await (const f of Deno.readDir(`${out}/${top}`)) inPackage.push(f.name);
  if (!inPackage.some((n) => /^licen[cs]e(\.[a-z]+)?$/i.test(n))) {
    for await (const f of Deno.readDir(src)) {
      if (!ownLicense && f.isFile && /^licen[cs]e(\.[a-z]+)?$/i.test(f.name)) {
        await Deno.copyFile(`${src}/${f.name}`, `${out}/${top}/LICENSE`);
        ownLicense = true;
      }
    }
  }

  if (additions.length) {
    await Deno.writeTextFile(
      `${out}/${top}/LICENSES-ALSO-BUNDLED.txt`,
      "The LICENSE file beside this one was written by the module's own build. These libraries are also inside\n" +
        "main.js and are not listed there. Their notices were added by the Skillfully plugin store when it built\n" +
        `this package from ${entry.source.repo} at ${entry.source.commit}.\n\n` + additions.join("\n"),
    );
  }
  if (additions.length || ownLicense || shortcuts) {
    await Deno.remove(tgz);
    await step("closing the package", "tar", ["-czf", tgz, "-C", out, top], work);
  }
  return { tgz, bundled, problems, installed: installedHow };
}
