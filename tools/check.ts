// The checks every pull request gets.
//   deno run --config .platform/deno.json ... tools/check.ts --platform=.platform [--base=origin/main | --all]
//
// By hand, that does everything on one machine. In the checks it is three steps, so that any number of
// entries can be proven at once and no module's build shares a machine with another's:
//   --plan       what can be said without building, and which entries to build (printed as a JSON list)
//   --id=<id>    build and start one entry, and write down what was found
//   --report     put the findings together, and fail if any entry did
//
// Every entry is held to the rules. Each new or changed module is then built from its pinned source, read the
// way a hub would read it, and started inside the hub's sandbox with nothing to connect to. What it says about
// itself is written out in plain words for whoever reviews the pull request.

import {
  arg,
  buildModule,
  type Entry,
  generalAdvice,
  licenseProblem,
  loadPlatform,
  readEntries,
  ROOT,
  run,
  storeKeys,
} from "./lib.ts";

const platform = await loadPlatform(arg("platform", ".platform"));
const safe = platform.safe as (text: unknown, max?: number) => string;
const code = (text: unknown) => "`" + String(text ?? "").replace(/[`\r\n|]/g, "").slice(0, 120) + "`";

const entries = await readEntries(platform);
// The store's own files are held to their rules before any entry is looked at.
const general = await generalAdvice(platform);
await storeKeys();
const kinds: Record<string, string> = {
  device: "reaching one device on the local network",
  everyone: "sending to every device on the network at once",
  "this-computer": "reaching other programs on the hub's own computer",
  ports: "opening ports on the hub's computer",
  name: "reaching a device by its name",
  internet: "reaching the internet",
};
const about = (a: { about: string }) => kinds[a.about] ?? `reaching ${code(a.about)}`;
/** What was found out about one entry. Written by the machine that checked it, read by the one that reports. */
interface Finding {
  id: string;
  name: string;
  notes: string;
  facts: string[];
  problems: string[];
}

/** How many entries one pull request's checks will build. Each is built on a machine of its own. */
const AT_ONCE = 250;
/** When the tools or the rules change, this many entries are built again to show nothing broke. */
const SAMPLE = 12;

async function prove(entry: Entry): Promise<Finding> {
  const work = await Deno.makeTempDir({ prefix: "store-" });
  const problems: string[] = [];
  const facts: string[] = [];
  try {
    const built = await buildModule(entry, work);
    problems.push(...built.problems.map((p) => safe(p, 300)));
    const pkg = await platform.readPackage(await Deno.readFile(built.tgz));
    if (pkg.about.id !== entry.id) {
      problems.push(`the module calls itself ${code(pkg.about.id)}, so that must be the entry's id`);
    }
    const license = licenseProblem(pkg);
    if (license) problems.push(license);
    facts.push(
      `Module ${code(pkg.about.name)} version ${code(pkg.about.version)}, ${
        pkg.about.license ? `${code(pkg.about.license)} license` : "**no license named**"
      }`,
    );
    const added = built.bundled.filter((b) => b.notice === "added by the store");
    const none = built.bundled.filter((b) => b.notice === "none is published");
    facts.push(
      `${built.bundled.length} libraries are bundled inside it. The package carries a license notice for each` +
        (added.length
          ? `. The module's own build left out ${added.length}, which the store added: ${
            added.map((b) => code(b.name)).join(", ")
          }`
          : "") +
        (none.length
          ? `. ${none.map((b) => code(b.name)).join(", ")} ${
            none.length === 1 ? "declares" : "declare"
          } a license and ${none.length === 1 ? "publishes" : "publish"} no text to pass on`
          : ""),
    );
    facts.push(`Source: ${safe(entry.source.repo)} at ${code(entry.source.commit.slice(0, 12))}`);
    facts.push(`What it needs was installed ${built.installed}. Install scripts were not run`);
    facts.push(
      `The entry allows in advance: ${
        entry.network.map(code).join(", ") || "nothing, so a team is asked about everything"
      }`,
    );
    for (const a of entry.advise ?? []) {
      facts.push(
        a.say === "yes"
          ? `**The entry tells teams to expect ${about(a)}**, so that box starts ticked: "${
            safe(a.why, 240)
          }"`
          : `The entry advises teams against ${about(a)}: "${safe(a.why, 240)}"`,
      );
    }
    facts.push(`Proven so far: ${code(entry.tested)}`);

    // Start it the way a hub does for a device nobody has answered for yet: with no access to the network at
    // all, and nothing to connect to. The runtime notes everything it reaches for.
    const installed = await platform.writePackage(pkg, `${work}/data`, { name: entry.name });
    const hub = await platform.startHub({
      dbPath: ":memory:",
      dataDir: `${work}/data`,
      plugins: [{ dir: installed.dir, mode: "listen", granted: [], settings: entry.settings ?? {} }],
    });
    try {
      const host = hub.hosts.get(installed.id);
      await host.whenReady(30000);
      for (let i = 0; i < 50 && !host.settingsForm; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 3000)); // long enough for it to try what it tries on its own
      const keys = [...host.state.keys()] as string[];
      const actions = keys.filter((k) => /^generic\/action\/[^/]+\/title$/.test(k)).map((k) =>
        host.state.get(k)
      );
      const readings = keys.filter((k) => /^generic\/reading\/[^/]+$/.test(k));
      const form = (host.settingsForm ?? []) as { id: string; label: string; kind: string }[];
      facts.push(
        `Runs inside the hub's sandbox and describes itself: ${actions.length} actions, ${readings.length} readings, ${
          form.filter((f) => f.kind !== "note").length
        } settings`,
      );
      if (actions.length) {
        facts.push(
          `Actions: ${actions.slice(0, 12).map((a: unknown) => safe(a, 60)).join(", ")}${
            actions.length > 12 ? ", and more" : ""
          }`,
        );
      }
      if (form.length) {
        facts.push(
          `Settings: ${
            form.filter((f) => f.kind !== "note").slice(0, 12).map((f) =>
              `${safe(f.label, 60)} (${code(f.id)})`
            ).join(", ")
          }`,
        );
      }

      // What it reached for by itself, before anyone gave it an address. A hub would ask its superuser about
      // each of these unless the entry answers it in advance.
      const asked = [...host.asks.values()] as { value: string; words: string; caution?: string }[];
      // What a team will be shown beside a question the entry leaves to them.
      const told = (ask: unknown) => {
        const advice = platform.advised(ask, entry.advise ?? [], general);
        return !advice
          ? ""
          : ` They will be told the store ${advice.say === "yes" ? "expects it" : "advises against it"}: "${
            safe(advice.why, 240)
          }"`;
      };
      const fixed = entry.network.filter((n) => !n.includes("{"));
      if (!asked.length) facts.push("Given no access and no device, it reached for nothing");
      for (const a of asked) {
        const answered = platform.covered(a.value, fixed);
        facts.push(
          `Given no access and no device, it tried to: ${safe(a.words, 200)} (${code(a.value)}). ${
            answered
              ? "The entry allows this in advance."
              : "**The entry does not answer this, so every team will be asked.**"
          }${answered ? "" : told(a)}`,
        );
      }
      for (const [kind, times] of [...host.attempts] as [string, number][]) {
        facts.push(
          `**It also tried to ${safe(platform.attemptWords(kind), 80)}**, ${times} ${
            times === 1 ? "time" : "times"
          }. A hub never allows that`,
        );
      }

      // An answer written as {name} is filled from a setting, so the module must have that setting.
      for (const n of entry.network) {
        for (const m of n.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) {
          if (!form.some((f) => f.id === m[1])) {
            problems.push(`its entry allows ${code(n)}, but the module has no setting called ${code(m[1])}`);
          }
        }
      }
      for (const name of Object.keys(entry.settings ?? {})) {
        if (!form.some((f) => f.id === name)) {
          problems.push(`it sets ${code(name)}, but the module has no setting called ${code(name)}`);
        }
      }
    } finally {
      await hub.stop();
    }
  } catch (err) {
    problems.push(safe((err as Error).message, 700));
  } finally {
    await Deno.remove(work, { recursive: true }).catch(() => {});
  }
  return { id: entry.id, name: entry.name, notes: entry.notes ?? "", facts, problems };
}

/**
 * A line of a finding, made safe to put in the report. A finding comes from a machine that built someone
 * else's code, so it is text, not markdown: it cannot start a heading, a link or a new line. Only the two
 * marks the checks themselves use, bold and code, are let through.
 */
const line = (text: string, max: number) => safe(text, max).replaceAll("\\*\\*", "**").replaceAll("\\`", "`");

/** What a finding says, as part of the report. */
function written(f: Finding): string[] {
  const lines = [`### ${safe(f.name, 80)} (${code(f.id)})`, "", ...f.facts.map((x) => `- ${line(x, 1200)}`)];
  if (f.notes) lines.push(`- The submitter's notes: ${safe(f.notes, 600)}`);
  if (f.problems.length) {
    lines.push("", `**It cannot be accepted as it is:**`, ...f.problems.map((p) => `- ${line(p, 800)}`));
  } else {
    lines.push(
      "",
      "It can be accepted. Whether what the entry allows in advance, and what it advises, is right is a reviewer's call.",
    );
  }
  return [...lines, ""];
}

/** Which entries this change has to prove again, and why those. */
async function planned(): Promise<{ ids: string[]; why: string }> {
  const sound = entries.filter((e) => !e.problems.length);
  if (Deno.args.includes("--all")) return { ids: sound.map((e) => e.entry.id), why: "every entry" };
  const diff = await run("git", ["diff", "--name-only", `${arg("base")}...HEAD`], ROOT);
  const changed = diff.out.split("\n").map((l) => l.trim()).filter(Boolean);
  const mine = sound.filter((e) => changed.includes(e.file)).map((e) => e.entry.id);
  // A change to the tools, the rules or the platform version could change the answer for any entry. Building
  // every entry again would not scale, so a spread of them is built, along with whatever this change touches.
  const everything = changed.some((f) => /^(tools|schema|\.github)\/|^(platform|advice|keys)\.json$/.test(f));
  if (!everything) return { ids: mine, why: "the entries this change touches" };
  const rest = sound.map((e) => e.entry.id).filter((id) => !mine.includes(id));
  const step = Math.max(1, Math.floor(rest.length / SAMPLE));
  const spread = rest.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  return {
    ids: [...mine, ...spread],
    why: rest.length > spread.length
      ? `the entries this change touches, and ${spread.length} of the other ${rest.length} as a sample, because it changes how entries are checked`
      : "every entry, because this changes how entries are checked",
  };
}

const unsound = entries.filter((e) => e.problems.length);
const out = arg("out", "findings");

if (Deno.args.includes("--plan")) {
  // What can be said without building anything, and the list of entries to build. Printed as JSON.
  const plan = await planned();
  const tooMany = plan.ids.length > AT_ONCE
    ? `This change touches ${plan.ids.length} entries. The checks build ${AT_ONCE} at a time, each on a machine of its own, so it has to be split.`
    : "";
  await Deno.mkdir(out, { recursive: true });
  await Deno.writeTextFile(
    `${out}/plan.json`,
    JSON.stringify({
      total: entries.length,
      why: plan.why,
      ids: tooMany ? [] : plan.ids,
      refused: [
        ...unsound.map((e) => ({ file: e.file, problems: e.problems })),
        ...(tooMany ? [{ file: "this change", problems: [tooMany] }] : []),
      ],
    }),
  );
  console.log(JSON.stringify(tooMany ? [] : plan.ids));
} else if (Deno.args.some((a) => a.startsWith("--id="))) {
  // One entry, on a machine of its own. What is found out is written down for the report, pass or fail.
  const id = arg("id");
  const found = entries.find((e) => e.entry.id === id && !e.problems.length);
  const finding: Finding = found ? await prove(found.entry) : {
    id,
    name: id,
    notes: "",
    facts: [],
    problems: ["there is no entry by that name that follows the rules"],
  };
  await Deno.mkdir(out, { recursive: true });
  await Deno.writeTextFile(`${out}/${id.replace(/[^a-z0-9-]/g, "")}.json`, JSON.stringify(finding));
  console.log(written(finding).join("\n"));
  Deno.exit(finding.problems.length ? 1 : 0);
} else if (Deno.args.includes("--report")) {
  // Put together what each machine found. An entry that was meant to be built and left no finding failed.
  const plan = JSON.parse(await Deno.readTextFile(`${out}/plan.json`));
  const lines: string[] = ["## Store checks", ""];
  let failed = 0;
  for (const r of plan.refused as { file: string; problems: string[] }[]) {
    failed++;
    lines.push(
      `**${code(r.file)} cannot be accepted:** ${r.problems.map((p) => safe(p, 400)).join("; ")}`,
      "",
    );
  }
  const findings: Finding[] = [];
  for (const id of plan.ids as string[]) {
    let f: Finding;
    try {
      const raw = JSON.parse(await Deno.readTextFile(`${out}/${id}.json`));
      // A finding comes from a machine that built someone else's code. It is read as data and held to its shape.
      const list = (
        v: unknown,
      ) => (Array.isArray(v) ? v.slice(0, 60).map((x) => String(x).slice(0, 2000)) : []);
      f = {
        id,
        name: String(raw.name ?? id),
        notes: String(raw.notes ?? ""),
        facts: list(raw.facts),
        problems: list(raw.problems),
      };
    } catch {
      f = {
        id,
        name: id,
        notes: "",
        facts: [],
        problems: ["the machine that was building it stopped before it finished"],
      };
    }
    findings.push(f);
    if (f.problems.length) failed++;
  }
  const sound = plan.total - plan.refused.filter((r: { file: string }) => r.file !== "this change").length;
  lines.push(
    `${sound} of ${plan.total} ${plan.total === 1 ? "entry follows" : "entries follow"} the rules. ` +
      `${findings.length} built and started: ${plan.why}.`,
    "",
  );
  // What failed first, so it is not lost under what passed.
  for (
    const f of [
      ...findings.filter((f) => f.problems.length),
      ...findings.filter((f) => !f.problems.length),
    ]
  ) {
    lines.push(...written(f));
  }
  console.log(lines.join("\n").slice(0, 900_000));
  Deno.exit(failed ? 1 : 0);
} else {
  // Everything on this one machine: plan, build each in turn, report. For running the checks by hand.
  const plan = await planned();
  const lines: string[] = ["## Store checks", ""];
  let failed = unsound.length;
  for (const e of unsound) {
    lines.push(
      `**${code(e.file)} cannot be accepted:** ${e.problems.map((p) => safe(p, 400)).join("; ")}`,
      "",
    );
  }
  lines.push(
    `${entries.length - unsound.length} of ${entries.length} ${
      entries.length === 1 ? "entry follows" : "entries follow"
    } the rules. ` +
      `${plan.ids.length} built and started: ${plan.why}.`,
    "",
  );
  for (const id of plan.ids) {
    const f = await prove(entries.find((e) => e.entry.id === id)!.entry);
    if (f.problems.length) failed++;
    lines.push(...written(f));
  }
  console.log(lines.join("\n"));
  Deno.exit(failed ? 1 : 0);
}
