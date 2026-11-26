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

## What the checks do

On every pull request, with no secrets and a token that can only read:

1. Every entry is held to the rules in `schema/`.
2. Each new or changed module is built from its pinned source. Install scripts are never run.
3. The package is read the way a hub reads it. It must name a license that allows copies to be passed on (MIT,
   Apache-2.0, BSD or ISC) and carry its license text inside.
4. It is started inside the hub's sandbox with no access to the network and nothing to connect to. Everything
   it reaches for by itself is noted.
5. What it is, what it offers, what it reached for, and which of that the entry allows in advance are written
   out in plain words on the pull request.

The checks run against one pinned version of the hub, named in `platform.json`.

## For authors

Every listing names its license and links to its author's own source. Being listed here does not mean the
maker of a device, or Bitfocus, endorses this project.

If you wrote a module and would rather it were not listed, open an issue and it will be removed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
