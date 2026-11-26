// What counts as a newer release, and what does not. Run with: deno test tools/
import { proposal, releases } from "./updates.ts";

const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  }
};
const c = (n: number) => String(n).repeat(40).slice(0, 40);
const LISTING = [
  `${c(1)}\trefs/tags/v2.2.3`,
  `${c(2)}\trefs/tags/v2.2.4`,
  // A tag with a note attached is listed twice. The second line is the commit.
  `${c(8)}\trefs/tags/v2.10.0`,
  `${c(3)}\trefs/tags/v2.10.0^{}`,
  // Not releases: a version still being tried, a name, a branch, and things that only look like tags.
  `${c(4)}\trefs/tags/v3.0.0-beta.1`,
  `${c(5)}\trefs/tags/latest`,
  `${c(6)}\trefs/heads/v9.9.9`,
  `${c(7)}\trefs/tags/v9.9.9; rm -rf /`,
  `not-a-commit\trefs/tags/v9.9.8`,
  "",
].join("\n");

Deno.test("releases are tags named like versions, in order, by the commit each one is", () => {
  eq(
    releases(LISTING).map((r) => [r.version, r.commit]),
    [["2.2.3", c(1)], ["2.2.4", c(2)], ["2.10.0", c(3)]],
    "2.10.0 is later than 2.2.4, and nothing else in the listing is a release",
  );
  eq(releases(""), [], "a repository with no tags has no releases");
});

Deno.test("only a later release is proposed", () => {
  const all = releases(LISTING);
  eq(proposal(c(3), all), null, "pinned at the newest release");
  eq(proposal(c(1), all)?.to.version, "2.10.0", "pinned at an older release");
  eq(proposal(c(1), all)?.from, "2.2.3", "it says what it is moving from");
  eq(proposal(c(9), all)?.from, "a commit that is not a release", "pinned somewhere that is not a release");
  eq(proposal(c(1), []), null, "nothing to propose when the author has released nothing");
  // An entry pinned somewhere that is not a release is not moved backwards, as long as the store knows what
  // version it last built. That covers an author taking a release back, too.
  const older = releases(`${c(1)}\trefs/tags/v2.2.3`);
  eq(proposal(c(3), older, "2.10.0"), null, "what was built is later than anything now released");
  eq(proposal(c(3), older, "2.2.3"), null, "what was built is the same version");
  eq(proposal(c(9), all, "2.2.4")?.from, "2.2.4", "what was built is older than the newest release");
  eq(
    proposal(c(9), all, "not a version")?.from,
    "a commit that is not a release",
    "an unreadable version is no version",
  );
});
