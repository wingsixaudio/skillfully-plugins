// Build one module's package from its pinned source.
//   deno run ... tools/build.ts --platform=.platform --id=<id> --out=built
// Each module is built on its own machine, so one module's build can never touch another's package.

import { arg, buildModule, loadPlatform, readEntries } from "./lib.ts";

const platform = await loadPlatform(arg("platform", ".platform"));
const id = arg("id");
const found = (await readEntries(platform)).find((e) => e.entry.id === id);
if (!found || found.problems.length) {
  console.error(`${id}: ${found ? found.problems.join("; ") : "there is no such entry"}`);
  Deno.exit(1);
}
const work = await Deno.makeTempDir({ prefix: "store-" });
const out = arg("out", "built");
await Deno.mkdir(out, { recursive: true });
const built = await buildModule(found.entry, work);
if (built.problems.length) {
  console.error(`${id} may not be handed out:\n- ${built.problems.join("\n- ")}`);
  Deno.exit(1);
}
await Deno.copyFile(built.tgz, `${out}/${id}.tgz`);
await Deno.remove(work, { recursive: true }).catch(() => {});
console.log(`built ${out}/${id}.tgz`);
