// Publishing the store: work out what has to be built, then write the list hubs read.
//   deno run ... tools/publish.ts --plan --platform=.platform --repo=<owner/name> --site=<address of the published list> --out=plan
//   deno run ... tools/publish.ts --assemble --platform=.platform --repo=<owner/name> --plan=plan --built=built --out=site
//
// A package is its source at one commit, built one way (lib.ts, RECIPE). Once that has been built and kept,
// it is never built again: the plan reads the list the store last published, checks the store really signed
// it, and keeps every package that still matches its entry. Only what is new is built. So a publish costs
// what changed, not what the store holds.
//
// Packages are kept as files of releases in this repository (lib.ts, packageHome). The store's site holds
// only the signed list that points at them.
import { createHash } from "node:crypto";
import {
  arg,
  type Entry,
  generalAdvice,
  licenseProblem,
  loadPlatform,
  packageHome,
  readEntries,
  RECIPE,
  ROOT,
  storeKeys,
} from "./lib.ts";

/** How many packages one run builds. The rest are built by the runs that follow it, one after another. */
const WAVE = 100;

/** What is known about a package from the package itself. The rest of what a hub is told comes from the entry. */
interface Kept {
  version: string;
  license: string;
  makes: string;
  commit: string;
  package: { url: string; sha256: string; bytes: number };
}
interface Plan {
  /** Packages already kept that still match their entries, by id. */
  kept: Record<string, Kept>;
  /** Entries whose package has to be built in this run. */
  build: string[];
  /** Entries that wait for a later run, and what the store goes on listing for them meanwhile, if anything. */
  waiting: string[];
  carried: Record<string, Kept>;
}

const platform = await loadPlatform(arg("platform", ".platform"));
const repo = arg("repo");
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("--repo must be owner/name");
const entries = await readEntries(platform);
for (const e of entries) if (e.problems.length) throw new Error(`${e.file}: ${e.problems.join("; ")}`);
const home = (e: Entry) => packageHome(repo, e.id, e.source.commit);

/** The list the store last published, if it can be read and the store signed it. Otherwise nothing is kept from it. */
async function published(site: string): Promise<Map<string, Kept>> {
  const kept = new Map<string, Kept>();
  const keys = await storeKeys();
  if (!keys.length) {
    console.error(
      "The store has no key, so nothing it published before can be trusted. Everything is built.",
    );
    return kept;
  }
  try {
    const get = async (url: string) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    };
    const bytes = await get(site);
    const signature = new TextDecoder().decode(await get(`${site}.sig`));
    if (!(await platform.verify(bytes, signature, keys))) {
      throw new Error("it is not signed by the store's key");
    }
    for (const m of JSON.parse(new TextDecoder().decode(bytes)).modules ?? []) {
      // Only a package kept where this store keeps packages, built the way it builds them now.
      if (
        typeof m?.id === "string" && m.recipe === RECIPE && /^[0-9a-f]{40}$/.test(m.source?.commit ?? "") &&
        m.package?.url === packageHome(repo, m.id, m.source.commit).url &&
        /^[0-9a-f]{64}$/.test(m.package?.sha256 ?? "") && Number.isInteger(m.package?.bytes)
      ) {
        kept.set(m.id, {
          version: String(m.version ?? "0.0.0"),
          license: String(m.license ?? ""),
          makes: String(m.makes ?? ""),
          commit: m.source.commit,
          package: { url: m.package.url, sha256: m.package.sha256, bytes: m.package.bytes },
        });
      }
    }
  } catch (err) {
    console.error(`The list published before is not used: ${(err as Error).message}. Everything is built.`);
    kept.clear();
  }
  return kept;
}

if (Deno.args.includes("--plan")) {
  const before = await published(arg("site"));
  const plan: Plan = { kept: {}, build: [], waiting: [], carried: {} };
  for (const { entry } of entries) {
    const was = before.get(entry.id);
    if (was && was.commit === entry.source.commit) plan.kept[entry.id] = was;
    else if (plan.build.length < WAVE) plan.build.push(entry.id);
    else {
      plan.waiting.push(entry.id);
      // Until its turn comes, the store goes on listing the version it already has.
      if (was) plan.carried[entry.id] = was;
    }
  }
  const out = arg("out", "plan");
  await Deno.mkdir(out, { recursive: true });
  await Deno.writeTextFile(`${out}/plan.json`, JSON.stringify(plan));
  console.error(
    `${
      Object.keys(plan.kept).length
    } kept as they are, ${plan.build.length} to build now, ${plan.waiting.length} waiting for the next run.`,
  );
  // Read by the workflow: what to build, and how much is left after this run.
  console.log(
    JSON.stringify({
      build: plan.build,
      need: plan.build.length + plan.waiting.length,
      left: plan.waiting.length,
    }),
  );
} else if (Deno.args.includes("--assemble")) {
  const plan: Plan = JSON.parse(await Deno.readTextFile(`${arg("plan", "plan")}/plan.json`));
  const built = arg("built", "built"), out = arg("out", "site");
  await Deno.mkdir(`${out}`, { recursive: true });
  await Deno.mkdir("upload", { recursive: true });
  const upload: { release: string; file: string; path: string; id: string }[] = [];
  const failed: string[] = [];
  const fresh: Record<string, Kept> = {};

  for (const id of plan.build) {
    const entry = entries.find((e) => e.entry.id === id)!.entry;
    const where = home(entry);
    try {
      // A run that stopped half way may already have kept this package. What is kept is never replaced, so
      // that one is listed, not the one just built: the two would not be the same bytes.
      const there = await fetch(where.url, { signal: AbortSignal.timeout(60000) }).catch(() => null);
      const already = there?.ok ? new Uint8Array(await there.arrayBuffer()) : null;
      await there?.body?.cancel().catch(() => {});
      const bytes = already ?? await Deno.readFile(`${built}/${id}.tgz`);
      // Read the way a hub would read it. Nothing in it is run.
      const pkg = await platform.readPackage(bytes);
      if (pkg.about.id !== id) throw new Error(`the package is for ${pkg.about.id}`);
      // Checked again here, at the last step before anything is handed out.
      const license = licenseProblem(pkg);
      if (license) throw new Error(license);
      fresh[id] = {
        version: pkg.about.version,
        license: pkg.about.license,
        makes: pkg.about.makes,
        commit: entry.source.commit,
        package: {
          url: where.url,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length,
        },
      };
      if (!already) {
        await Deno.mkdir(`upload/${where.release}`, { recursive: true });
        await Deno.writeFile(`upload/${where.release}/${where.file}`, bytes);
        upload.push({
          release: where.release,
          file: where.file,
          path: `upload/${where.release}/${where.file}`,
          id,
        });
      }
    } catch (err) {
      failed.push(`${id}: ${String((err as Error).message).slice(0, 300)}`);
    }
  }

  const modules = [];
  for (const { entry } of entries) {
    const k = plan.kept[entry.id] ?? fresh[entry.id] ?? plan.carried[entry.id];
    if (!k) continue; // not built yet, or its build failed: it is not listed until it is
    modules.push({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      version: k.version,
      license: k.license,
      makes: k.makes,
      // The source of the package that is listed, which is the entry's unless a newer one is still waiting.
      source: { repo: entry.source.repo, commit: k.commit },
      recipe: RECIPE,
      network: entry.network,
      advise: entry.advise ?? [],
      settings: entry.settings ?? {},
      tested: entry.tested,
      notes: entry.notes ?? "",
      package: k.package,
    });
  }
  const index = {
    format: 1,
    generated: new Date().toISOString(),
    platform: JSON.parse(await Deno.readTextFile(`${ROOT}/platform.json`)),
    modules,
    // What the store's reviewers say about anything a device asks for, whatever it is.
    advise: await generalAdvice(platform),
    plugins: [],
  };
  await Deno.writeTextFile(`${out}/index.json`, JSON.stringify(index, null, 2) + "\n");
  await Deno.writeTextFile("upload/upload.json", JSON.stringify(upload));
  await Deno.writeTextFile("upload/failed.json", JSON.stringify(failed));

  // A plain page for a person who opens the address in a browser.
  const esc = (t: unknown) =>
    String(t ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll(
      '"',
      "&quot;",
    );
  const proven: Record<string, string> = {
    starts: "Starts and describes itself",
    "pretend-device": "Proven against a stand-in",
    "real-device": "Proven with the real device",
  };
  await Deno.writeTextFile(
    `${out}/index.html`,
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Skillfully plugins</title>
<style>body{margin:0;padding:24px 16px 48px;background:#000;color:#f4f4f5;font:16px/1.5 ui-sans-serif,system-ui,sans-serif}main{max-width:680px;margin:0 auto}
h1{font-size:24px;margin:0 0 4px}h1 span{color:#f7941d}p{color:#a1a1aa;margin:0 0 20px}a{color:#f7941d}
article{background:#121214;border-radius:16px;padding:18px;margin:0 0 14px}h2{font-size:18px;margin:0 0 4px}article p{margin:0 0 8px;font-size:15px}small{color:#a1a1aa}</style>
<main><h1>skillfully<span>.plugins</span></h1>
<p>${modules.length} ${
      modules.length === 1 ? "thing" : "things"
    } a team can add to a <a href="https://github.com/wingsixaudio/skillfully">Skillfully</a> hub. Hubs read <a href="index.json">index.json</a>. To add something here, open a pull request on <a href="https://github.com/${
      esc(repo)
    }">the repository</a>.</p>
${
      modules.map((m) =>
        `<article><h2>${esc(m.name)}</h2><p>${esc(m.description)}</p><p><small>${
          esc(proven[m.tested])
        }. Version ${esc(m.version)}${
          m.license ? `, ${esc(m.license)} license` : ""
        }. A Companion module from <a href="${esc(m.source.repo)}">its own source</a>.</small></p>${
          m.notes ? `<p><small>${esc(m.notes)}</small></p>` : ""
        }</article>`
      ).join("\n")
    }
</main></html>
`,
  );
  console.log(
    `Listed ${modules.length} of ${entries.length}: ${Object.keys(plan.kept).length} kept as they were, ${
      Object.keys(fresh).length
    } built now (${upload.length} to keep), ${plan.waiting.length} waiting for the next run.`,
  );
  for (const f of failed) console.log(`Not listed, because its package could not be made: ${f}`);
} else {
  console.error("usage: tools/publish.ts --plan | --assemble");
  Deno.exit(2);
}
