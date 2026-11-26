// Fill the store from an author's whole catalog, a batch at a time.
//   deno run ... tools/fill.ts --find --platform=.platform --max=100 --out=fill [--only=<repo>,<repo>]
//       look through the catalogs in sources.json and write an entry for each module that could be added
//   deno run ... tools/fill.ts --settle --platform=.platform --fill=fill --findings=findings
//       after each of those was built and started on a machine of its own: put the ones that passed in
//       modules/, and write down in declined/ why the others were left out
//
// Finding reads a few files of each module's source at its newest release: its manifest, what it is built
// on, and its license. It runs none of it. An entry written here allows nothing in advance, so a hub asks
// its superuser about everything the module reaches for. That is what lets a module be listed without
// anyone having studied it: being listed says it builds, starts in the sandbox and may be passed on. It
// does not say anyone has used it.
import { createHash } from "node:crypto";
import { arg, type Entry, LICENSES, loadPlatform, readEntries, RECIPE, ROOT } from "./lib.ts";
import { type Release, releases } from "./updates.ts";

interface Source {
  kind: "companion-module";
  owner: string;
  prefix: string;
  leave_out?: string[];
}
/** Why a module was left out. The first three are about the module; the rest could change on this side. */
type Why = "release" | "license" | "entry" | "api" | "build" | "start";
interface Declined {
  id: string;
  repo: string;
  commit: string;
  why: Why;
  detail: string;
  checked: string;
  /**
   * What this side was when it was left out: the hub the store checks against and how the store builds a
   * module. When any of those change, a module
   * left out for a reason on this side is looked at again.
   */
  ground: string;
}

const words = (v: unknown, max: number) =>
  [...String(v ?? "")].map((c) => (c.charCodeAt(0) < 32 ? " " : c)).join("").replace(/\s+/g, " ").trim()
    .slice(0, max);
const slug = (repo: string) =>
  repo.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 51);
const ground = createHash("sha256").update(
  JSON.parse(await Deno.readTextFile(`${ROOT}/platform.json`)).ref + `|${RECIPE}|` +
    // How a module is built. A fix there is a reason to try again what would not build before.
    await Deno.readTextFile(`${ROOT}/tools/lib.ts`),
).digest("hex").slice(0, 16);

async function git(args: string[], cwd?: string): Promise<{ ok: boolean; out: string }> {
  const r = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "null",
    // Never wait for a person to type a password for a repository that has gone private.
    env: { GIT_TERMINAL_PROMPT: "0" },
  }).output();
  return { ok: r.success, out: new TextDecoder().decode(r.stdout) };
}

/** Every repository of a source that looks like one of its modules. Names only. */
async function catalog(source: Source): Promise<string[]> {
  const names: string[] = [];
  const token = Deno.env.get("GH_TOKEN");
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(
      `https://api.github.com/orgs/${
        encodeURIComponent(source.owner)
      }/repos?type=public&per_page=100&page=${page}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    if (!res.ok) {
      throw new Error(`the list of ${source.owner}'s repositories could not be read (${res.status})`);
    }
    const repos = await res.json() as { name: string; archived: boolean; private: boolean }[];
    for (const r of repos) {
      if (
        /^[A-Za-z0-9_.-]{1,100}$/.test(r.name) && r.name.startsWith(source.prefix) && !r.archived &&
        !r.private &&
        !(source.leave_out ?? []).includes(r.name)
      ) names.push(r.name);
    }
    if (repos.length < 100) break;
  }
  return names.sort();
}

/** Look at one module's newest release without running any of it. An entry to try, or the reason it is left out. */
async function look(
  source: Source,
  name: string,
  release: Release | undefined,
  work: string,
): Promise<{ entry: Entry } | { declined: Omit<Declined, "checked" | "ground"> }> {
  const repo = `https://github.com/${source.owner}/${name}`;
  const no = (
    why: Why,
    detail: string,
    id = slug(name.slice(source.prefix.length)),
    commit = release?.commit ?? "",
  ) => ({
    declined: { id, repo, commit, why, detail },
  });
  if (!release) return no("release", "its author has not released a version");
  const dir = `${work}/${name}`;
  const cloned = await git([
    "clone",
    "-q",
    "--depth",
    "1",
    "--branch",
    release.tag,
    "--filter=blob:none",
    "--no-checkout",
    repo,
    dir,
  ]);
  if (!cloned.ok) return no("release", "its newest release could not be read");
  const show = async (path: string) => (await git(["show", `HEAD:${path}`], dir)).out;
  let theirs: Record<string, unknown>, pkg: Record<string, unknown>;
  try {
    theirs = JSON.parse(await show("companion/manifest.json"));
    pkg = JSON.parse(await show("package.json"));
  } catch {
    return no(
      "entry",
      "it has no manifest that can be read, so it is not a module of the kind the store lists",
    );
  }
  const id = String(theirs.id ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9][a-z0-9-]{1,50}$/.test(id)) return no("entry", "its manifest gives no usable id");
  const deps = { ...(pkg.devDependencies as object ?? {}), ...(pkg.dependencies as object ?? {}) } as Record<
    string,
    unknown
  >;
  const base = /(\d+)\./.exec(String(deps["@companion-module/base"] ?? ""))?.[1];
  if (base !== "1") {
    return no(
      "api",
      base
        ? `it is built on version ${base} of Companion's module base, and the hub runs modules built on version 1`
        : "it is not built on Companion's module base, so the hub cannot run it",
      id,
    );
  }
  const license = words(pkg.license ?? theirs.license, 40);
  if (!LICENSES.includes(license)) {
    return no(
      "license",
      `it names the license "${license || "none"}", which is not one that lets copies be passed on`,
      id,
    );
  }
  const top = (await git(["ls-tree", "--name-only", "HEAD"], dir)).out.split("\n");
  if (!top.some((f) => /^licen[cs]e(\.[a-z]+)?$/i.test(f))) {
    return no("license", "it carries no license text to pass on with it", id);
  }

  const maker = words(theirs.manufacturer, 40);
  const products = Array.isArray(theirs.products)
    ? theirs.products.map((p) => words(p, 40)).filter(Boolean)
    : [];
  let called = [maker, products.slice(0, 2).join(", ")].filter(Boolean).join(" ").slice(0, 80);
  if (called.length < 3) called = words(theirs.shortname ?? theirs.name ?? id, 80);
  if (called.length < 3) called = id;
  let does = words(theirs.description, 300);
  if (does.length < 10) does = `Controls ${called} through its Bitfocus Companion module.`.slice(0, 300);
  return {
    entry: {
      kind: "companion-module",
      id,
      name: called,
      description: does,
      source: { repo, commit: release.commit },
      // Nothing is answered in advance. A hub asks its superuser about everything this reaches for.
      network: [],
      tested: "starts",
      notes:
        "Added from its author's catalog without anyone studying it. It allows nothing in advance, so a hub asks before it reaches anything.",
    },
  };
}

async function readDeclined(): Promise<Map<string, Declined>> {
  const all = new Map<string, Declined>();
  for await (const f of Deno.readDir(`${ROOT}/declined`)) {
    if (!f.isFile || !f.name.endsWith(".json")) continue;
    try {
      const d = JSON.parse(await Deno.readTextFile(`${ROOT}/declined/${f.name}`)) as Declined;
      if (typeof d.repo === "string") all.set(d.repo, d);
    } catch { /* a file that cannot be read is as good as not there: the module is looked at again */ }
  }
  return all;
}
const stamp = (d: Omit<Declined, "checked" | "ground">): Declined => ({
  ...d,
  detail: words(d.detail, 300),
  checked: new Date().toISOString().slice(0, 10),
  ground,
});
const save = async (dir: string, name: string, what: unknown) => {
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(`${dir}/${name}.json`, JSON.stringify(what, null, 2) + "\n");
};

const platform = await loadPlatform(arg("platform", ".platform"));

if (Deno.args.includes("--find")) {
  const out = arg("out", "fill"), max = Math.min(200, Math.max(1, Number(arg("max", "100")) || 100));
  const only = (Deno.args.find((a) => a.startsWith("--only="))?.slice(7) ?? "").split(",").filter(Boolean);
  const sources: Source[] = JSON.parse(await Deno.readTextFile(`${ROOT}/sources.json`)).sources;
  const have = await readEntries(platform);
  const listed = new Set(have.map((e) => e.entry?.source?.repo));
  const ids = new Set(have.map((e) => e.entry?.id));
  const declined = await readDeclined();
  const work = await Deno.makeTempDir({ prefix: "fill-" });
  const found: string[] = [];
  let looked = 0, left = 0;
  await Deno.mkdir(`${out}/entries`, { recursive: true });
  await Deno.mkdir(`${out}/declined`, { recursive: true });

  for (const source of sources) {
    // --only names a few to look at, for trying one out. The source's own rules still apply to them.
    const names = only.length
      ? only.filter((n) => n.startsWith(source.prefix) && !(source.leave_out ?? []).includes(n))
      : await catalog(source);
    const todo = names.filter((n) => !listed.has(`https://github.com/${source.owner}/${n}`));
    // A few at a time: each is a question to someone else's server.
    for (let at = 0; at < todo.length && found.length < max; at += 12) {
      await Promise.all(
        todo.slice(at, at + 12).map(async (name) => {
          const repo = `https://github.com/${source.owner}/${name}`;
          const tags = await git(["ls-remote", "--tags", repo]);
          const newest = tags.ok ? releases(tags.out).at(-1) : undefined;
          const was = declined.get(repo);
          // Left out before, and nothing that mattered has changed since: its author has released nothing
          // newer, and if the reason was on this side, this side is the same as it was.
          const ours = was && ["api", "build", "start"].includes(was.why);
          if (
            was && was.commit === (newest?.commit ?? "") &&
            (!ours || was.ground === ground)
          ) {
            return;
          }
          if (found.length >= max) {
            left++;
            return;
          }
          looked++;
          const seen = await look(source, name, newest, work);
          if ("entry" in seen) {
            if (ids.has(seen.entry.id)) {
              return save(
                `${out}/declined`,
                slug(name),
                stamp({
                  id: slug(name),
                  repo,
                  commit: newest!.commit,
                  why: "entry",
                  detail:
                    `its manifest calls it ${seen.entry.id}, which the store already lists from another source`,
                }),
              );
            }
            ids.add(seen.entry.id);
            found.push(seen.entry.id);
            await save(`${out}/entries`, seen.entry.id, seen.entry);
          } else {
            await save(`${out}/declined`, slug(name), stamp(seen.declined));
          }
        }),
      );
    }
  }
  await Deno.remove(work, { recursive: true }).catch(() => {});
  console.error(
    `Looked at ${looked}. ${found.length} to try${left ? `, and more waiting for the next run` : ""}.`,
  );
  console.log(JSON.stringify(found.sort()));
} else if (Deno.args.includes("--settle")) {
  const fill = arg("fill", "fill"), findings = arg("findings", "findings");
  const schema = JSON.parse(await Deno.readTextFile(`${ROOT}/schema/module.schema.json`));
  const valid = platform.ajv.compile(schema);
  const safe = platform.safe as (text: unknown, max?: number) => string;
  const added: string[] = [], reasons: Declined[] = [];
  const files = async (dir: string) => {
    const names: string[] = [];
    try {
      for await (const f of Deno.readDir(dir)) {
        if (f.isFile && /^[a-z0-9][a-z0-9-]{1,50}\.json$/.test(f.name)) names.push(f.name);
      }
    } catch { /* nothing there */ }
    return names.sort();
  };
  // What was left out before anything was built.
  for (const name of await files(`${fill}/declined`)) {
    const d = JSON.parse(await Deno.readTextFile(`${fill}/declined/${name}`)) as Declined;
    reasons.push(stamp(d));
  }
  for (const name of await files(`${fill}/entries`)) {
    const id = name.slice(0, -5);
    // Written by a machine that only read someone else's files. Held to the rules again here, where it counts.
    const entry = JSON.parse(await Deno.readTextFile(`${fill}/entries/${name}`)) as Entry;
    if (!valid(entry) || entry.id !== id) continue;
    let problems: string[] | null = null;
    try {
      const f = JSON.parse(await Deno.readTextFile(`${findings}/${name}`));
      problems = Array.isArray(f.problems) ? f.problems.map((p: unknown) => String(p)) : null;
    } catch { /* the machine that was trying it stopped before it finished */ }
    if (problems && problems.length === 0) {
      await Deno.writeTextFile(`${ROOT}/modules/${name}`, JSON.stringify(entry, null, 2) + "\n");
      added.push(id);
      // It was left out before and has now passed. What was written down about it no longer holds.
      for await (const f of Deno.readDir(`${ROOT}/declined`)) {
        if (!f.isFile || !f.name.endsWith(".json")) continue;
        const was = JSON.parse(await Deno.readTextFile(`${ROOT}/declined/${f.name}`).catch(() => "{}"));
        if (was.repo === entry.source.repo) await Deno.remove(`${ROOT}/declined/${f.name}`);
      }
    } else {
      const detail = problems?.[0] ?? "the machine that was trying it stopped before it finished";
      // Built, and then would not start or describe itself, or never built at all.
      const why: Why =
        /sandbox|start|ready|describe/i.test(detail) && !/build|npm|webpack|license|bundled/i.test(detail)
          ? "start"
          : "build";
      // A finding is written for a report, with its marks made harmless. Here it is kept as plain words.
      const plainly = detail.replace(/\\(.)/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(
        /&amp;/g,
        "&",
      );
      reasons.push(stamp({ id, repo: entry.source.repo, commit: entry.source.commit, why, detail: plainly }));
    }
  }
  for (const d of reasons) {
    if (
      !/^[a-z0-9][a-z0-9-]{1,50}$/.test(d.id) ||
      !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(d.repo)
    ) continue;
    await save(`${ROOT}/declined`, d.id, d);
  }
  // What a person reads on the pull request.
  const said: Record<Why, string> = {
    api: "Built for a kind of module the hub does not run yet",
    license: "No license that lets copies be passed on, or no license text",
    release: "No released version to pin",
    entry: "Not a module the store can describe",
    build: "Would not build, or bundles something that may not be passed on",
    start: "Built, and would not start in the sandbox",
  };
  const lines = [
    `Adds **${added.length}** ${
      added.length === 1 ? "module" : "modules"
    } from the catalogs in \`sources.json\`. ` +
    `${reasons.length} more were looked at and left out.`,
    "",
    "Every entry here allows nothing in advance, so a hub asks its superuser about everything the module reaches for. Each was built from its author's source at its newest release and started in the hub's sandbox before it was put in this pull request, and the checks do that again.",
    "",
    "Being listed says a module builds, starts in the sandbox and may be passed on. It does not say anyone has used it with a device.",
    "",
  ];
  if (reasons.length) {
    lines.push("**Left out, and why:**", "");
    for (const why of Object.keys(said) as Why[]) {
      const these = reasons.filter((r) => r.why === why);
      if (these.length) lines.push(`- ${said[why]}: ${these.length}`);
    }
    lines.push(
      "",
      "Each has a file in `declined/` saying exactly why. It is looked at again when its author releases something newer, or when the reason is something that has since changed on this side.",
      "",
    );
  }
  // A library with no license, or one the store does not hand out, holds back every module that bundles it.
  // Said here by how many modules each one holds back.
  const held = new Map<string, number>();
  for (const r of reasons) {
    const lib = /the bundled library (\S+) /.exec(r.detail)?.[1];
    if (lib) held.set(lib, (held.get(lib) ?? 0) + 1);
  }
  if (held.size) {
    lines.push(
      "**Bundled libraries holding modules back**, by having no license or one the store does not hand out (see `notices/README.md`):",
      "",
    );
    for (const [lib, n] of [...held].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      lines.push(`- \`${safe(lib, 60)}\`: ${n} ${n === 1 ? "module" : "modules"}`);
    }
    lines.push("");
  }
  if (added.length) {
    lines.push(`**Added:** ${added.slice(0, 200).map((id) => "`" + safe(id, 60) + "`").join(", ")}`);
  }
  await Deno.writeTextFile(`${fill}/summary.md`, lines.join("\n") + "\n");
  console.log(JSON.stringify({ added: added.length, declined: reasons.length }));
} else {
  console.error("usage: tools/fill.ts --find | --settle");
  Deno.exit(2);
}
