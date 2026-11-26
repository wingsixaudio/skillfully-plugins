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

export async function run(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; out: string }> {
  const r = await new Deno.Command(cmd, { args, cwd, stdout: "piped", stderr: "piped" }).output();
  const text = new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr);
  return { ok: r.success, out: text.trim().slice(-1500) };
}

/** Licenses a bundled library may carry. Each allows copies to be passed on if its notice goes with them. */
const BUNDLED_OK = [...LICENSES, "0BSD", "Unlicense", "CC0-1.0", "BlueOak-1.0.0"];

/** Is this license expression one the store may hand out? "A OR B" needs one of them, "A AND B" both. */
export function licenseAllowed(expression: string): boolean {
  const text = expression.replace(/[()]/g, " ").trim();
  if (!text) return false;
  return text.split(/\s+OR\s+/i).some((alt) =>
    alt.split(/\s+AND\s+/i).every((l) => BUNDLED_OK.includes(l.trim()))
  );
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
  const step = async (what: string, cmd: string, args: string[], cwd = src) => {
    const r = await run(cmd, args, cwd);
    if (!r.ok) throw new Error(`${what} failed: ${r.out.slice(-600)}`);
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
  await step("installing what the module needs", "npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--silent",
  ]);

  // First a build that keeps the name of every file it pulls in, to learn what is really inside.
  await step("listing what gets bundled", "npx", ["--no-install", "companion-module-build", "--dev"]);
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
  await step("building the package", "npx", ["--no-install", "companion-module-build"]);
  let tgz = "";
  for await (const f of Deno.readDir(src)) if (f.isFile && f.name.endsWith(".tgz")) tgz = `${src}/${f.name}`;
  if (!tgz) throw new Error("the build made no package");

  // What the module's own build already credits.
  const out = `${work}/out`;
  await Deno.mkdir(out, { recursive: true });
  await step("opening the package", "tar", ["-xzf", tgz, "-C", out], work);
  let top = "pkg";
  for await (const f of Deno.readDir(out)) if (f.isDirectory) top = f.name;
  const theirs = await Deno.readTextFile(`${out}/${top}/LICENSE`).catch(() => "");
  const credited = new Set<string>();
  for (const line of theirs.matchAll(/^Packages: (.+)$/gm)) {
    for (const part of line[1].split(", ")) credited.add(part.split(" ")[0]);
  }
  const withoutText = JSON.parse(await Deno.readTextFile(`${ROOT}/notices/without-text.json`)) as {
    name: string;
    license: string;
    source: string;
    checked: string;
  }[];

  const bundled: Bundled[] = [];
  const problems: string[] = [];
  const additions: string[] = [];
  for (const dir of [...dirs].sort()) {
    if (!(await exists(`${src}/${dir}/package.json`))) continue;
    const pj = JSON.parse(await Deno.readTextFile(`${src}/${dir}/package.json`));
    const name = String(pj.name ?? dir), version = String(pj.version ?? "");
    const license = typeof pj.license === "string"
      ? pj.license
      : Array.isArray(pj.licenses)
      ? pj.licenses.map((l: { type?: string }) => l.type).join(" OR ")
      : "";
    if (bundled.some((b) => b.name === name && b.version === version)) continue;
    if (!licenseAllowed(license)) {
      problems.push(
        `the bundled library ${name} ${version} is under "${
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
    const known = withoutText.find((k) => k.name === name);
    if (texts.length) {
      additions.push(`${name}@${version} — ${license}\n${"-".repeat(80)}\n${texts.join("\n\n")}\n`);
      bundled.push({ name, version, license, notice: "added by the store" });
    } else if (known && known.license === license) {
      additions.push(
        `${name}@${version} — ${license}\n${
          "-".repeat(80)
        }\nThis library declares the ${license} license and publishes no license text or copyright notice.\nSource: ${known.source}\n`,
      );
      bundled.push({ name, version, license, notice: "none is published" });
    } else {
      problems.push(
        `the bundled library ${name} ${version} carries no license text, and nobody has recorded checking that under notices/`,
      );
    }
  }

  if (additions.length) {
    await Deno.writeTextFile(
      `${out}/${top}/LICENSES-ALSO-BUNDLED.txt`,
      "The LICENSE file beside this one was written by the module's own build. These libraries are also inside\n" +
        "main.js and are not listed there. Their notices were added by the Skillfully plugin store when it built\n" +
        `this package from ${entry.source.repo} at ${entry.source.commit}.\n\n` + additions.join("\n"),
    );
    await Deno.remove(tgz);
    await step("closing the package", "tar", ["-czf", tgz, "-C", out, top], work);
  }
  return { tgz, bundled, problems };
}
