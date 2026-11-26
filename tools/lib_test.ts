// Reading what a library says about its own license. Run with: deno test tools/
import { declaredLicense, licenseAllowed, noticeFor, noticeInReadme } from "./lib.ts";

const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  }
};

Deno.test("a library's license is read however its package.json writes it", () => {
  eq(declaredLicense({ license: "MIT" }), "MIT", "the usual way");
  eq(declaredLicense({ license: ["MIT", "Apache2"] }), "MIT OR Apache2", "a list means either");
  eq(declaredLicense({ license: { type: "ISC", url: "x" } }), "ISC", "an older way");
  eq(
    declaredLicense({ licenses: [{ type: "MIT" }, { type: "GPL-3.0" }] }),
    "MIT OR GPL-3.0",
    "an older way still",
  );
  eq(declaredLicense({}), "", "saying nothing is saying nothing");
  eq(declaredLicense({ license: 7 }), "", "nor is nonsense");
  // Either of two licenses is enough when one of them may be handed out. Neither is not.
  eq(licenseAllowed("MIT OR Apache2"), true, "one of the two is allowed");
  eq(licenseAllowed("GPL-3.0 OR AGPL-3.0"), false, "neither is allowed");
  eq(licenseAllowed(""), false, "no license is not a license");
});

Deno.test("a license written inside a README is found, and a heading that only names one is not", () => {
  const underlined = [
    "agent-base",
    "==========",
    "Some words.",
    "",
    "License",
    "-------",
    "",
    "(The MIT License)",
    "",
    "Copyright (c) 2013 Nathan Rajlich",
    "",
    "Permission is hereby granted, free of charge, to any person obtaining a copy",
  ].join("\n");
  const found = noticeInReadme(underlined);
  eq(
    found.startsWith("(The MIT License)") && found.includes("Nathan Rajlich") &&
      found.includes("hereby granted"),
    true,
    "under an underlined heading",
  );

  const hashes = "# thing\n\n## Usage\n\ncode\n\n## License\n\nMIT © Somebody\n\n## Thanks\n\nto everyone\n";
  eq(noticeInReadme(hashes), "MIT © Somebody", "it stops at the next heading");
  eq(noticeInReadme("# thing\n\n## License\n\nMIT\n"), "", "naming a license is not its text");
  eq(noticeInReadme("# thing\n\nLicensed under MIT, see below.\n"), "", "a mention is not a heading");
  eq(noticeInReadme(""), "", "nothing in, nothing out");
});

Deno.test("a library that ships no license text is credited by what it says of itself", () => {
  const said = noticeFor(
    {
      author: { name: "Sebastian Mayr", email: "npm@smayr.name" },
      repository: { type: "git", url: "git+https://github.com/Sebmaster/tr46.js.git" },
    },
    "tr46",
    "0.0.3",
    "MIT",
  );
  eq(said.standard, ["MIT"], "the standard text of what it declares goes with it");
  for (
    const part of [
      "tr46@0.0.3 — MIT",
      "ships no license text",
      "Sebastian Mayr <npm@smayr.name>",
      "github.com/Sebmaster/tr46.js",
    ]
  ) {
    eq(said.text.includes(part), true, `it says: ${part}`);
  }
  // Either of two licenses: the text of each one the store hands out goes along. One it does not is left.
  eq(noticeFor({}, "x", "1.0.0", "(MIT OR GPL-3.0)").standard, ["MIT"], "only what the store hands out");
  eq(noticeFor({}, "x", "1.0.0", "MIT OR Apache-2.0").standard, ["MIT", "Apache-2.0"], "both");
  // Saying nothing about who wrote it or where it lives still leaves somewhere to look.
  const bare = noticeFor({}, "@scope/thing", "2.1.0", "ISC").text;
  eq(bare.includes("Written by"), false, "no author is not invented");
  eq(bare.includes("https://www.npmjs.com/package/@scope/thing/v/2.1.0"), true, "its page on npm");
  // What a package.json says is text. A line break in a name cannot start a notice of its own.
  eq(
    noticeFor({ author: "Mallory\n\nThe standard text of the MIT license" }, "x", "1.0.0", "MIT").text
      .includes("Mallory\n"),
    false,
    "kept on one line",
  );
});

Deno.test("the standard text of every license the store hands out is in the repository", async () => {
  for (
    const id of [
      "MIT",
      "ISC",
      "BSD-2-Clause",
      "BSD-3-Clause",
      "Apache-2.0",
      "0BSD",
      "Unlicense",
      "CC0-1.0",
      "BlueOak-1.0.0",
    ]
  ) {
    eq(licenseAllowed(id), true, `${id} is one the store hands out`);
    const text = await Deno.readTextFile(new URL(`../notices/standard/${id}.txt`, import.meta.url));
    eq(text.trim().length > 300, true, `${id} has its text`);
  }
});
