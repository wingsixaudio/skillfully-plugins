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
- what the module should be allowed to reach on a hub, as narrowly as it can be made
- how far it has been proven: that it starts, against a stand-in, or with the real device

The module's code stays in its author's repository. When an entry is merged, the store builds the package from
that commit and publishes it with a checksum, so a hub can add it in one step and know it got what was built.

## What the checks do

On every pull request, with no secrets and a token that can only read:

1. Every entry is held to the rules in `schema/`.
2. Each new or changed module is built from its pinned source. Install scripts are never run.
3. The package is read the way a hub reads it. It must name a license that allows copies to be passed on (MIT,
   Apache-2.0, BSD or ISC) and carry its license text inside.
4. It is started inside the hub's sandbox with nothing to connect to, and must describe itself without
   reaching for anything it was not granted.
5. What it is, what it offers and what it asks for are written out in plain words on the pull request.

The checks run against one pinned version of the hub, named in `platform.json`.

## For authors

Every listing names its license and links to its author's own source. Being listed here does not mean the
maker of a device, or Bitfocus, endorses this project.

If you wrote a module and would rather it were not listed, open an issue and it will be removed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
