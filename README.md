# Skillfully plugins

What a team can add to a [Skillfully](https://github.com/wingsixaudio/skillfully) hub: drivers for their
equipment, screens for their people, and skills for an agent. Everything here arrived as a pull request, was
checked on a machine its author does not control, and runs sandboxed on the hub.

## What is in here

| Folder     | What it holds                                                                            |
| ---------- | ---------------------------------------------------------------------------------------- |
| `plugins/` | Plugins written for Skillfully's own contract, as code. One folder each.                 |
| `modules/` | Entries for Bitfocus Companion modules. An entry is a small file, not the module's code. |
| `schema/`  | The rules an entry must follow.                                                          |
| `tools/`   | What the checks run.                                                                     |

### A module entry is a pointer, not a copy

Many devices already have a [Bitfocus Companion](https://bitfocus.io/companion) module, and a Skillfully hub
can run one as it is. An entry in `modules/` says:

- where the module's source lives, at **one exact commit**
- which of the hub's questions have been answered in advance (see below)
- how far it has been proven: that it starts, against a stand-in, or with the real device

The module's code stays in its author's repository. When an entry is merged, the store builds the package from
that commit and publishes it with a checksum, so a hub can add it in one step and know it got what was built.

### A hub asks before a module reaches anything

A module needs no entry here to be used. A team can add any Companion module to their hub from its package
file. It starts with **no access to the network**, and when it tries to reach something the hub asks a
superuser first, in plain words, the way a phone asks before an app uses the camera.

An entry saves every team from answering the same ordinary questions. Someone has looked at what the module
reaches for and written down what is fine to allow for everyone: usually "the address the team types in, on
this port". Anything not written down, the hub still asks about.

An entry can also give **advice** for the questions it leaves to a team: "we expect this" or "we advise
against this", with the reason. The hub shows it beside the question. `advice.json` holds the same kind of
advice for everything in the store, such as advising against anything that reaches the internet. Advice allows
nothing. The team's superuser still decides.

### The list is signed

The publishing step signs the list of what the store offers, and a hub checks that signature before it reads
any of it. Each package's checksum is in the list, so a signed list vouches for every package it names. The
public half of the key is in `keys.json`, and in every hub. The private half is a secret that only the signing
job on `main` can use; that job starts from a clean copy of this repository and never has a module's code or
package on it.

A hub that cannot check the signature still lets a team add from the list, and then allows nothing in advance
and passes on no recommendation to allow anything.

`tools/new_key.ts` makes a key. Its own first lines say how, and where each half goes. To replace a key, put
both private halves in the secret (one per line) and both public halves in `keys.json` until every hub has the
new one.

## What the checks do

On every pull request, with no secrets and a token that can only read:

1. Every entry is held to the rules in `schema/`.
2. Each new or changed module is built from its pinned source. Install scripts are never run.
3. The build works out every library that is really bundled inside the module. Each must be under a license
   that allows copies to be passed on, and the package must carry each one's notice. Where the module's own
   build left a notice out, the store adds it.
4. The package is read the way a hub reads it. It must name a license that allows copies to be passed on (MIT,
   Apache-2.0, BSD or ISC) and carry its license text inside.
5. It is started inside the hub's sandbox with no access to the network and nothing to connect to. Everything
   it reaches for by itself is noted.
6. What it is, what it offers, what it reached for, and which of that the entry allows in advance are written
   out in plain words on the pull request.

The checks run against one pinned version of the hub, named in `platform.json`.

Each entry is checked on a machine of its own, so one entry or two hundred take about the same time, and no
module's build ever shares a machine with another's. A change to the tools or the rules builds a spread of the
existing entries again, to show nothing broke.

## How publishing scales

A package is its author's source at one commit, built one way. Once that has been built it is never built
again.

- **Packages are kept as release files in this repository**, one release per module, one file per version. A
  file is written once and never changed.
- **The store's site holds only the signed list** that points at them, with each package's checksum.
- **A publish builds only what is new.** It reads the list published before, checks the store signed it, and
  keeps every package that still matches its entry. Changing an entry's words, advice or answers publishes
  without building anything.
- **Any number of entries can be merged at once.** A hundred are built per run, each on its own machine, and
  the run starts the next one until none are waiting. A module is listed once its package exists.
- **One failed build does not hold up the rest.** That module is left out, the others are published, and the
  run ends red so it is noticed.

`RECIPE` in `tools/lib.ts` says which way of building made a package. Raising it builds everything again and
offers the result to hubs as a repackaging. It is for when the tools change in a way hubs should receive, such
as a notice that was being left out.

## Keeping up with authors

Once a week the store asks each module's author's repository whether it has released something newer than the
store lists. For each one that has, it opens a pull request that points the entry at the new release. It
downloads none of the author's code to find out: it only asks for the names of their releases.

That pull request is checked like any other. The new version is built from its source, started in the sandbox
with no access, and reported on, and a person decides. A proposed version goes back to `tested: starts`,
because nobody has used it with a device yet. Closing the pull request without merging means that version is
not proposed again.

When an update is merged and published, every hub that added that module shows that a newer version is there,
and its superuser chooses when to take it.

## Filling the store from a catalog

`sources.json` names whole catalogs of modules, such as Bitfocus's. The **Fill the store** workflow, started
by hand from the Actions tab, works through them a batch at a time:

1. It reads a few files of each module's source at its newest release: its manifest, what it is built on, and
   its license. It runs none of it. A module the hub cannot run, or that carries no license that lets copies
   be passed on, is left out here.
2. Each one that is left is built and started in the hub's sandbox, on a machine of its own.
3. Those that pass go into one pull request. The ordinary checks prove each of them again, and a person
   decides whether to merge.

An entry made this way **allows nothing in advance**, so a hub asks its superuser about everything the module
reaches for. That is what lets a module be listed without anyone having studied it. Being listed says a module
builds, starts in the sandbox and may be passed on. It does not say anyone has used it with a device: it is
marked `tested: starts` until someone does. Anyone who has used one can raise that, and add what it should be
allowed in advance, with an ordinary pull request.

Every module that was looked at and left out gets a file in `declined/` saying why, so it is not built again
on the next run. It is looked at again when its author releases something newer, or when the reason was on
this side and this side has changed.

## For authors

Every listing names its license and links to its author's own source. Every package carries the license
notices of the module and of the libraries bundled inside it. Being listed here does not mean the maker of a
device, or Bitfocus, endorses this project.

If you wrote a module and would rather it were not listed, open an issue and it will be removed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
