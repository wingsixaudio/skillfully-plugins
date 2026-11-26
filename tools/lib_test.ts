// Reading what a library says about its own license. Run with: deno test tools/
import { declaredLicense, licenseAllowed, noticeInReadme } from "./lib.ts";

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
