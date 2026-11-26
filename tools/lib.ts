// What the store's tools share: reading entries, checking them against the rules, and building a module's
// package from its own source the way Bitfocus's store does.
//
// The platform is not a dependency of this repository. The tools are handed a checkout of it (see
// platform.json) and use its own code to judge a package, so the store and a hub can never disagree.

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
  settings?: Record<string, string | number | boolean>;
  tested: "starts" | "pretend-device" | "real-device";
  notes?: string;
}

// deno-lint-ignore no-explicit-any
export type Platform = { contract: any; install: any; hub: any; report: any; asks: any };

/** The platform's own code, from a checkout of it. */
export async function loadPlatform(dir: string): Promise<Platform> {
  const base = new URL(`${dir.replace(/\/$/, "")}/`, `file://${Deno.cwd()}/`).href;
  return {
    contract: await import(`${base}contract/mod.ts`),
    install: await import(`${base}core/install.ts`),
    hub: await import(`${base}core/hub.ts`),
    report: await import(`${base}tools/plugin_report.ts`),
    asks: await import(`${base}core/asks.ts`),
  };
}

/** Every entry in modules/, with what is wrong with each. An entry with problems is never built. */
export async function readEntries(
  platform: Platform,
): Promise<{ file: string; entry: Entry; problems: string[] }[]> {
  const schema = JSON.parse(await Deno.readTextFile(`${ROOT}/schema/module.schema.json`));
  const valid = platform.contract.ajv.compile(schema);
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
    if (!problems.length && !valid(entry)) problems.push(platform.contract.explain(valid.errors));
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
  if (!LICENSES.includes(pkg.module.license)) {
    return `its package names the license "${
      String(pkg.module.license).slice(0, 40) || "none"
    }", and the store only hands out ${LICENSES.join(", ")}`;
  }
  if (!pkg.files.some((f: { path: string }) => /^licen[cs]e(\.[a-z]+)?$/i.test(f.path))) {
    return "its package does not carry its license text, which the license requires of every copy";
  }
  return null;
}

export async function run(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; out: string }> {
  const r = await new Deno.Command(cmd, { args, cwd, stdout: "piped", stderr: "piped" }).output();
  const text = new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr);
  return { ok: r.success, out: text.trim().slice(-1500) };
}

/**
 * Build a module's package from its source at the pinned commit. This runs the module's own build, which is
 * someone else's code: it happens on a machine that holds no secrets, and install scripts are never run.
 */
export async function buildModule(entry: Entry, work: string): Promise<string> {
  const src = `${work}/src`;
  await Deno.mkdir(src, { recursive: true });
  const step = async (what: string, cmd: string, args: string[]) => {
    const r = await run(cmd, args, src);
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
  await step("building the package", "npx", ["--no-install", "companion-module-build"]);
  for await (const f of Deno.readDir(src)) if (f.isFile && f.name.endsWith(".tgz")) return `${src}/${f.name}`;
  throw new Error("the build made no package");
}
