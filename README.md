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
advice for everything in the store, such as advising against anything that reaches the internet. Advice
allows nothing. The team's superuser still decides.

### The list is signed

The publishing step signs the list of what the store offers, and a hub checks that signature before it reads
any of it. Each package's checksum is in the list, so a signed list vouches for every package it names. The
public half of the key is in `keys.json`, and in every hub. The private half is a secret that only the signing
job on `main` can use; that job starts from a clean copy of this repository and never has a module's code or
package on it.

A hub that cannot check the signature still lets a team add from the list, and then allows nothing in
advance and passes on no recommendation to allow anything.

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

## For authors

Every listing names its license and links to its author's own source. Every package carries the license
notices of the module and of the libraries bundled inside it. Being listed here does not mean the maker of a
device, or Bitfocus, endorses this project.

If you wrote a module and would rather it were not listed, open an issue and it will be removed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
