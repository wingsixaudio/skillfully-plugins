// The checks every pull request gets.
//   deno run --config .platform/deno.json ... tools/check.ts --platform=.platform [--base=origin/main | --all]
//
// Every entry is held to the rules. Each new or changed module is then built from its pinned source, read the
// way a hub would read it, and started inside the hub's sandbox with nothing to connect to. What it says about
// itself is written out in plain words for whoever reviews the pull request.

import { arg, buildModule, type Entry, licenseProblem, loadPlatform, readEntries, ROOT, run } from "./lib.ts";

const platform = await loadPlatform(arg("platform", ".platform"));
const safe = platform.report.safe as (text: unknown, max?: number) => string;
const code = (text: unknown) => "`" + String(text ?? "").replace(/[`\r\n|]/g, "").slice(0, 120) + "`";
const lines: string[] = ["## Store checks", ""];
let failed = 0;

const entries = await readEntries(platform);
for (const e of entries.filter((e) => e.problems.length)) {
  failed++;
  lines.push(`**${code(e.file)} cannot be accepted:** ${e.problems.map((p) => safe(p, 400)).join("; ")}`, "");
}

// Which modules to build: all of them, or only what this pull request touches.
let build = entries.filter((e) => !e.problems.length);
if (!Deno.args.includes("--all")) {
  const diff = await run("git", ["diff", "--name-only", `${arg("base")}...HEAD`], ROOT);
  const changed = diff.out.split("\n").map((l) => l.trim()).filter(Boolean);
  // A change to the tools, the rules or the platform version could change the answer for every entry.
  const everything = changed.some((f) => /^(tools|schema|\.github)\/|^platform\.json$/.test(f));
  if (!everything) build = build.filter((e) => changed.includes(e.file));
}
const sound = entries.length - failed;
lines.push(
  `${sound} of ${entries.length} ${entries.length === 1 ? "entry follows" : "entries follow"} the rules. ` +
    `${build.length} built and started.`,
  "",
);

async function prove(entry: Entry): Promise<void> {
  const work = await Deno.makeTempDir({ prefix: "store-" });
  const problems: string[] = [];
  const facts: string[] = [];
  try {
    const pkg = await platform.install.readModulePackage(await Deno.readFile(await buildModule(entry, work)));
    if (pkg.module.id !== entry.id) {
      problems.push(`the module calls itself ${code(pkg.module.id)}, so that must be the entry's id`);
    }
    const license = licenseProblem(pkg);
    if (license) problems.push(license);
    facts.push(
      `Module ${code(pkg.module.name)} version ${code(pkg.module.version)}, ${
        pkg.module.license ? `${code(pkg.module.license)} license` : "**no license named**"
      }`,
    );
    facts.push(`Source: ${safe(entry.source.repo)} at ${code(entry.source.commit.slice(0, 12))}`);
    facts.push(`Asks to reach: ${entry.network.map(code).join(", ") || "nothing"}`);
    facts.push(`Proven so far: ${code(entry.tested)}`);

    // Start it with only the grants that need no settings. It has no device to find, and should not need one
    // to say what it is.
    const installed = await platform.install.writeModule(pkg, `${work}/data`, {
      name: entry.name,
      network: entry.network.filter((n) => !n.includes("{")),
      mode: "listen",
    });
    const hub = await platform.hub.startHub({
      dbPath: ":memory:",
      plugins: [{ dir: installed.dir, mode: "listen", settings: entry.settings ?? {} }],
    });
    try {
      const host = hub.hosts.get(installed.id);
      await host.whenReady(30000);
      for (let i = 0; i < 50 && !host.settingsForm; i++) await new Promise((r) => setTimeout(r, 100));
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
      // A grant written as {name} is filled from a setting, so the module must have that setting.
      for (const n of entry.network) {
        for (const m of n.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) {
          if (!form.some((f) => f.id === m[1])) {
            problems.push(
              `its network grant uses ${code(`{${m[1]}}`)}, but the module has no setting called ${
                code(m[1])
              }`,
            );
          }
        }
      }
      for (const name of Object.keys(entry.settings ?? {})) {
        if (!form.some((f) => f.id === name)) {
          problems.push(`it sets ${code(name)}, but the module has no setting called ${code(name)}`);
        }
      }
      // With the settings the entry starts it with, it should not reach for anything it was not granted.
      const refused = hub.log.read({ type: "skillfully.plugin.event", limit: 200 })
        .filter((e: { data: { name?: string } }) => e.data.name === "module.refused")
        .map((e: { data: { detail?: { what?: string } } }) => String(e.data.detail?.what ?? ""));
      for (const what of [...new Set(refused)] as string[]) {
        problems.push(
          `as it started, the hub refused it: ${
            safe(what, 200)
          }. Widen the grant and say why, or start it with a setting that stops it asking`,
        );
      }
    } finally {
      await hub.stop();
    }
  } catch (err) {
    problems.push(safe((err as Error).message, 700));
  } finally {
    await Deno.remove(work, { recursive: true }).catch(() => {});
  }
  lines.push(`### ${safe(entry.name, 80)} (${code(entry.id)})`, "", ...facts.map((f) => `- ${f}`));
  if (entry.notes) lines.push(`- The submitter's notes: ${safe(entry.notes, 600)}`);
  if (problems.length) {
    failed++;
    lines.push("", `**It cannot be accepted as it is:**`, ...problems.map((p) => `- ${p}`));
  } else lines.push("", "It can be accepted. What it is allowed to reach is a reviewer's call.");
  lines.push("");
}

for (const e of build) await prove(e.entry);

console.log(lines.join("\n"));
Deno.exit(failed ? 1 : 0);
