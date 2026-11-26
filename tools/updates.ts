// Notice when a module's author has released a newer version than the one an entry pins.
//   deno run --allow-read --allow-run=git tools/updates.ts --look [--index=<the published index.json>]
//       prints, as JSON, what could be proposed: [{ id, name, repo, pinned, from, version, commit }]
//   deno run --allow-read --allow-write=modules tools/updates.ts --apply --id=<id> --commit=<commit>
//       points one entry at another commit, and changes nothing else in it
//
// Looking asks each author's repository which releases it has. It downloads none of their code and runs
// none of it. A release is a tag named like v1.2.3 or 1.2.3. Anything else a repository says about itself
// is ignored, and what is used is checked to be exactly a version and a commit before it goes anywhere.
//
// This only ever proposes. A newer version is built, started in the sandbox and reported on by the same
// checks as any other change, and a person decides.
import { arg, ROOT } from "./lib.ts";

const VERSION = /^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/;
const COMMIT = /^[0-9a-f]{40}$/;
const REPO = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ID = /^[a-z0-9][a-z0-9-]{1,50}$/;

interface Release {
  version: string;
  parts: number[];
  commit: string;
}

/** The releases in what `git ls-remote --tags` printed. A tag with a note attached is listed twice; the line ending ^{} has the commit. */
export function releases(listing: string): Release[] {
  const found = new Map<string, Release>();
  for (const line of listing.split("\n")) {
    const m = /^([0-9a-f]{40})\trefs\/tags\/([^\s^]+)(\^\{\})?$/.exec(line.trim());
    const v = m && VERSION.exec(m[2]);
    if (!m || !v) continue;
    const parts = v.slice(1).map(Number);
    const version = parts.join(".");
    if (!found.has(version) || m[3]) found.set(version, { version, parts, commit: m[1] });
  }
  // Oldest first, so the newest is last.
  return [...found.values()].sort((a, b) => later(a.parts, b.parts) ? -1 : 1);
}

/** Is b a later version than a? */
const later = (a: number[], b: number[]) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] > a[i];
  return false;
};

/**
 * What to propose for an entry pinned at this commit, if anything. built is the version the store last
 * built from that commit, when that is known: it is how an entry pinned somewhere that is not a release
 * is kept from being moved backwards.
 */
export function proposal(
  pinned: string,
  all: Release[],
  built?: string,
): { from: string; to: Release } | null {
  const newest = all.at(-1);
  if (!newest || newest.commit === pinned) return null;
  const now = all.find((r) => r.commit === pinned);
  if (now) return later(now.parts, newest.parts) ? { from: now.version, to: newest } : null;
  const was = VERSION.exec(built ?? "")?.slice(1).map(Number);
  if (was) return later(was, newest.parts) ? { from: was.join("."), to: newest } : null;
  // Nothing says what version this is. The newest release is offered, and the report on the pull request
  // shows what it would change.
  return { from: "a commit that is not a release", to: newest };
}

async function entries(): Promise<
  { file: string; id: string; name: string; repo: string; commit: string }[]
> {
  const out = [];
  for await (const f of Deno.readDir(`${ROOT}/modules`)) {
    if (!f.isFile || !f.name.endsWith(".json")) continue;
    const e = JSON.parse(await Deno.readTextFile(`${ROOT}/modules/${f.name}`));
    // An entry that does not follow the rules is the checks' business, not this tool's.
    if (!ID.test(e?.id ?? "") || !REPO.test(e?.source?.repo ?? "") || !COMMIT.test(e?.source?.commit ?? "")) {
      continue;
    }
    out.push({
      file: f.name,
      id: e.id,
      name: String(e.name ?? e.id).replace(/[^\w .()+-]/g, "").slice(0, 80),
      repo: e.source.repo,
      commit: e.source.commit,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

if (import.meta.main) {
  if (Deno.args.includes("--look")) {
    // --index=<file>: the store's published list, which says what version each entry was last built as.
    const built = new Map<string, string>();
    const index = Deno.args.find((a) => a.startsWith("--index="))?.slice(8);
    if (index) {
      try {
        for (const m of JSON.parse(await Deno.readTextFile(index)).modules ?? []) {
          if (typeof m?.id === "string" && typeof m?.version === "string") built.set(m.id, m.version);
        }
      } catch {
        console.error("the published list could not be read, so it is not used");
      }
    }
    const found = [];
    for (const e of await entries()) {
      const out = await new Deno.Command("git", {
        args: ["ls-remote", "--tags", e.repo],
        stdout: "piped",
        stderr: "piped",
        // Never wait for a person to type a password for a repository that has gone private.
        env: { GIT_TERMINAL_PROMPT: "0" },
      }).output();
      if (!out.success) {
        console.error(`${e.id}: its source could not be asked for its releases`);
        continue;
      }
      const p = proposal(e.commit, releases(new TextDecoder().decode(out.stdout)), built.get(e.id));
      if (!p) {
        console.error(`${e.id}: nothing newer`);
        continue;
      }
      console.error(`${e.id}: ${p.from} -> ${p.to.version}`);
      found.push({
        id: e.id,
        name: e.name,
        repo: e.repo,
        pinned: e.commit,
        from: p.from,
        version: p.to.version,
        commit: p.to.commit,
      });
    }
    console.log(JSON.stringify(found));
  } else if (Deno.args.includes("--apply")) {
    const id = arg("id"), commit = arg("commit");
    if (!ID.test(id) || !COMMIT.test(commit)) throw new Error("an id and a full commit are needed");
    const path = `${ROOT}/modules/${id}.json`;
    const entry = JSON.parse(await Deno.readTextFile(path));
    entry.source.commit = commit;
    // A new version has not been proven with anything yet, whatever the old one was.
    entry.tested = "starts";
    await Deno.writeTextFile(path, JSON.stringify(entry, null, 2) + "\n");
    console.log(`${id} now points at ${commit}`);
  } else {
    console.error("usage: tools/updates.ts --look | --apply --id=<id> --commit=<commit>");
    Deno.exit(2);
  }
}
