// Sign the list a publish is about to hand out.
//   STORE_SIGNING_KEY=<private key> deno run ... tools/sign.ts --platform=.platform --site=site
//
// The private key comes from the environment and is never written anywhere. It is only ever given to the
// one publishing job that runs this file, which has no module's code or package on it. The public half is
// in keys.json, and in every hub.
//
// While keys.json is empty the store has no key yet, and the list goes out unsigned: hubs then allow
// nothing in advance. Once keys.json names a key, a list that is not signed with it is never published.
import { arg, loadPlatform, storeKeys } from "./lib.ts";

const platform = await loadPlatform(arg("platform", ".platform"));
const site = arg("site", "site");
const keys = await storeKeys();
// More than one private key, on separate lines, while a key is being replaced.
const secrets = (Deno.env.get("STORE_SIGNING_KEY") ?? "").split(/\s+/).filter(Boolean);

if (!keys.length && !secrets.length) {
  console.log("The store has no key yet (keys.json is empty). The list is published unsigned.");
  Deno.exit(0);
}
if (!secrets.length) {
  console.error("keys.json names a key, and this run was not given the private half. Nothing is published.");
  Deno.exit(1);
}
const list = await Deno.readFile(`${site}/index.json`);
let signature: string;
try {
  signature = await platform.sign(list, secrets);
} catch {
  // Said without the reason: the reason could carry part of the key.
  console.error("The signing key could not be used. It is not a key this tool made.");
  Deno.exit(1);
}
// Checked the way a hub will check it, with each public key, before anything is handed out.
for (const key of keys) {
  if (!(await platform.verify(list, signature, [key]))) {
    console.error(
      `The list was signed, but not by the key ${
        key.slice(0, 12)
      }... in keys.json. Hubs holding that key would refuse it. Nothing is published.`,
    );
    Deno.exit(1);
  }
}
if (!keys.length) {
  console.error(
    "A signing key was given, but keys.json names no public key for hubs to check. Nothing is published.",
  );
  Deno.exit(1);
}
await Deno.writeTextFile(`${site}/index.json.sig`, signature);
console.log(`Signed the list. ${keys.length === 1 ? "One key" : `${keys.length} keys`} can check it.`);
