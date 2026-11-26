// Make the store's signing key. Run this once, on your own computer, and never in a workflow.
//   deno run --config .platform/deno.json --allow-read --allow-write=. tools/new_key.ts --platform=.platform
//
// It writes the private half to one file, store-signing-key.txt, which git ignores. Put what is in that
// file into the secret STORE_SIGNING_KEY of the github-pages environment, then delete the file. It prints only the public half,
// which is not a secret: that goes into keys.json here and into STORE_KEYS in the platform.
import { arg, loadPlatform } from "./lib.ts";

const platform = await loadPlatform(arg("platform", ".platform"));
const out = "store-signing-key.txt";
if (await Deno.stat(out).catch(() => null)) {
  console.error(`${out} is already here. Use it or delete it first: a second key would replace the first.`);
  Deno.exit(1);
}
const key = await platform.newKey();
await Deno.writeTextFile(out, key.privateKey + "\n", { mode: 0o600 });
console.log(`The private half is in ${out}. It is not shown here on purpose.`);
console.log(
  "  1. Put what is in that file into a secret called STORE_SIGNING_KEY, in the github-pages environment",
);
console.log(
  "     (Settings, Environments, github-pages, Environment secrets). Only runs from main can use it.",
);
console.log("  2. Delete the file.");
console.log(
  "  3. Add this public half to keys.json here, and to STORE_KEYS in the platform's core/store.ts:",
);
console.log(`\n     ${key.publicKey}\n`);
