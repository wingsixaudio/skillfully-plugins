// Reading what a library says about its own license. Run with: deno test tools/
import {
  declaredLicense,
  dropToolShortcuts,
  gist,
  kindsFor,
  kindsTable,
  licenseAllowed,
  licenseFromText,
  licenseInFiles,
  noticeFor,
  noticeInReadme,
  run,
  yarnStandIn,
} from "./lib.ts";

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

Deno.test("a library's license is read from its own license file when package.json does not say", async () => {
  const mit =
    `(The MIT License)\n\nCopyright (c) 2014 Someone\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction...\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED`;
  eq(licenseFromText(mit), "MIT", "the words every copy of it has");
  const boost = await Deno.readTextFile(new URL("../notices/standard/BSL-1.0.txt", import.meta.url));
  eq(licenseFromText(boost), "BSL-1.0", "the Boost license, by its name");
  eq(
    licenseFromText(boost.split("\n").slice(1).join("\n")),
    "BSL-1.0",
    "and without its name, by its one condition",
  );
  // Its opening words with the condition taken out are not the Boost license, however alike they read.
  eq(
    licenseFromText(
      'Permission is hereby granted, free of charge, to any person or organization obtaining a copy of the software and accompanying documentation covered by this license (the "Software") to use, reproduce, display, distribute, execute, and transmit the Software, and to permit third-parties to whom the Software is furnished to do so.\n\nTHE SOFTWARE IS PROVIDED "AS IS"',
    ),
    "",
    "a text that only starts like it is not it",
  );
  eq(licenseAllowed("BSL-1.0"), true, "Boost is one the store hands out when it is bundled");
  eq(
    licenseFromText(
      "Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that",
    ),
    "ISC",
    "ISC",
  );
  eq(
    licenseFromText(
      "Redistribution and use in source and binary forms, with or without modification, are permitted provided that... Neither the name of the copyright holder",
    ),
    "BSD-3-Clause",
    "three clauses",
  );
  // Saying a license's name is not being under it, and something unknown is not guessed at.
  eq(licenseFromText("This is sort of like MIT, ask me first."), "", "a name is not a grant");
  eq(licenseFromText("All rights reserved."), "", "not a license to pass on");

  const dir = await Deno.makeTempDir();
  eq(await licenseInFiles(dir), "", "a library with no such file has none");
  await Deno.writeTextFile(`${dir}/LICENSE.md`, mit);
  eq(await licenseInFiles(dir), "MIT", "found beside its code");
  eq(licenseAllowed(await licenseInFiles(dir)), true, "and it is one the store hands out");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("the reason written down for a failed build is the part that says what failed", () => {
  const out =
    `yarn run v1.22.22\ninfo Visit https://yarnpkg.com/en/docs/cli/run for documentation about this command.\n    at maybeClose (node:internal/child_process:1101:16)\n    at ChildProcess._handle.onexit (node:internal/child_process:304:5) {\n  _stderr: 'error Command "webpack" not found.\\n',\n}\n\nNode.js v22.23.5\n`;
  const said = gist(out);
  eq(said.includes('Command "webpack" not found'), true, "the line that says what went wrong");
  eq(/maybeClose|Node\.js v22/.test(said), false, "and not the stack under it");
  eq(gist("\u001b[31mERR!\u001b[0m code E404").includes("\u001b"), false, "colours are not words");
  eq(gist("one\ntwo\nthree"), "one two three", "with nothing that names an error, what was printed last");
  eq(gist("x ".repeat(2000)).length <= 600, true, "never more than a note can hold");
});

Deno.test("shortcuts to tools are left out of a package, and nothing else is touched", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(`${dir}/node_modules/.bin`, { recursive: true });
  await Deno.mkdir(`${dir}/node_modules/dep/node_modules/.bin`, { recursive: true });
  await Deno.writeTextFile(`${dir}/node_modules/dep/index.js`, "");
  await Deno.writeTextFile(`${dir}/main.js`, "");
  await Deno.symlink("../dep/index.js", `${dir}/node_modules/.bin/dep`);
  await Deno.mkdir(`${dir}/.bin`);
  eq(await dropToolShortcuts(dir), true, "there were some");
  const left: string[] = [];
  const walk = async (at: string) => {
    for await (const f of Deno.readDir(at)) {
      left.push(`${at.slice(dir.length)}/${f.name}`);
      if (f.isDirectory) await walk(`${at}/${f.name}`);
    }
  };
  await walk(dir);
  eq(left.sort(), [
    "/.bin",
    "/main.js",
    "/node_modules",
    "/node_modules/dep",
    "/node_modules/dep/index.js",
    "/node_modules/dep/node_modules",
  ], "only the shortcut folders inside node_modules went");
  eq(await dropToolShortcuts(dir), false, "and there are none the second time");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("a build that asks Yarn to run a tool gets that tool, from the module's own folder", async () => {
  const work = await Deno.makeTempDir();
  const bin = `${work}/src/node_modules/.bin`;
  await Deno.mkdir(`${work}/src/node_modules/@companion-module/tools`, { recursive: true });
  await Deno.mkdir(bin, { recursive: true });
  await Deno.writeTextFile(`${bin}/webpack`, '#!/bin/sh\necho "webpack ran with $*"\n');
  await Deno.chmod(`${bin}/webpack`, 0o755);
  const standIn = `${await yarnStandIn(work)}/yarn`;
  const env = { PATH: `${work}/yarn-stand-in:${Deno.env.get("PATH") ?? ""}` };
  // Asked from inside the tools folder, the way the module build tool asks, in both spellings it has used.
  const tools = `${work}/src/node_modules/@companion-module/tools`;
  const modern = await run(
    "node",
    [standIn, "run", "-B", "webpack", "-c", "x.cjs", "--env", "dev"],
    tools,
    env,
  );
  eq([modern.ok, modern.out.trim()], [true, "webpack ran with -c x.cjs --env dev"], "the newer spelling");
  const older = await run("node", [standIn, "webpack", "-c", "x.cjs"], tools, env);
  eq([older.ok, older.out.trim()], [true, "webpack ran with -c x.cjs"], "the older spelling");
  // A tool that fails still fails.
  await Deno.writeTextFile(`${bin}/broken`, "#!/bin/sh\nexit 3\n");
  await Deno.chmod(`${bin}/broken`, 0o755);
  eq((await run("node", [standIn, "run", "broken"], tools, env)).ok, false, "a failure is passed on");
  await Deno.remove(work, { recursive: true });
});

Deno.test("an entry is filed under kinds by the words its own author filed it under", async () => {
  const table = await kindsTable();
  eq(Object.keys(table).length >= 8, true, "kinds.json lists the kinds");
  eq(kindsFor(["Audio", "Mixer"], "", table), ["Audio"], "by its keywords, whatever their capitals");
  eq(
    kindsFor(["PTZ Camera", "video"], "", table),
    ["Video", "Cameras"],
    "a word inside a keyword counts, and two kinds at most",
  );
  eq(kindsFor(["dmx"], "", table), ["Lighting"], "by a word that only means one thing");
  eq(kindsFor(["audiophile-grade"], "", table), [], "part of a longer word is not the word");
  eq(
    kindsFor([], "Behringer WING digital mixer", table),
    ["Audio"],
    "with no keywords, by what it says it makes",
  );
  eq(kindsFor(["cheese"], "a mixer", table), [], "its own keywords decide, even when they file it nowhere");
  eq(kindsFor([], "", table), [], "nothing to go on is not a kind");
});
