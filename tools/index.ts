// Put the built packages and a list of them where hubs can fetch them.
//   deno run ... tools/index.ts --platform=.platform --built=built --out=site
// Nothing from a package is run here. Each is read the way a hub would read it, and listed with its checksum
// so a hub can tell that what it downloaded is what was built.

import { arg, generalAdvice, licenseProblem, loadPlatform, readEntries, ROOT } from "./lib.ts";

const platform = await loadPlatform(arg("platform", ".platform"));
const built = arg("built", "built"), out = arg("out", "site");
await Deno.mkdir(`${out}/packages`, { recursive: true });

const modules = [];
for (const { entry, problems } of await readEntries(platform)) {
  if (problems.length) throw new Error(`${entry.id}: ${problems.join("; ")}`);
  const bytes = await Deno.readFile(`${built}/${entry.id}.tgz`);
  const pkg = await platform.readPackage(bytes);
  if (pkg.about.id !== entry.id) throw new Error(`${entry.id}: the package is for ${pkg.about.id}`);
  // Checked again here, at the last step before anything is handed out.
  const license = licenseProblem(pkg);
  if (license) throw new Error(`${entry.id}: ${license}`);
  const path = `packages/${entry.id}-${pkg.about.version}.tgz`;
  await Deno.writeFile(`${out}/${path}`, bytes);
  modules.push({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    version: pkg.about.version,
    license: pkg.about.license,
    source: entry.source,
    network: entry.network,
    advise: entry.advise ?? [],
    settings: entry.settings ?? {},
    tested: entry.tested,
    notes: entry.notes ?? "",
    package: { path, sha256: pkg.sha256, bytes: bytes.length },
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

// A plain page for a person who opens the address in a browser.
const esc = (t: unknown) =>
  String(t ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll(
    '"',
    "&quot;",
  );
const proven = {
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
<p>What a team can add to a <a href="https://github.com/wingsixaudio/skillfully">Skillfully</a> hub. Hubs read <a href="index.json">index.json</a>. To add something here, open a pull request on <a href="https://github.com/wingsixaudio/skillfully-plugins">the repository</a>.</p>
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
console.log(`listed ${modules.length} modules in ${out}/index.json`);
