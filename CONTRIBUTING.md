# Contributing

Everything arrives as a pull request. The checks run by themselves and tell you, in plain words, what they
found. Nothing is merged until they pass and a maintainer has looked at what the plugin asks for.

## Add a Companion module

If a device has a Bitfocus Companion module, you do not need to write code.

1. Find the module's repository (most are at `github.com/bitfocus/companion-module-…`) and copy the full id of
   the commit you want. A branch or a tag is refused: those can move.
2. Add `modules/<id>.json`, where `<id>` is the module's own id from its `companion/manifest.json`:

```json
{
  "kind": "companion-module",
  "id": "tplink-kasasmartplug",
  "name": "TP-Link Kasa smart plug",
  "description": "Turns TP-Link Kasa smart plugs and power strips on and off, and reports what they are doing.",
  "source": {
    "repo": "https://github.com/bitfocus/companion-module-tplink-kasasmartplug",
    "commit": "dff17d5921f6fc21cd3035e15ec2d84455a3af68"
  },
  "network": ["{host}:9999", "listen"],
  "settings": { "scan": false },
  "tested": "pretend-device",
  "notes": "Why it is allowed what it is allowed, and anything a team should know."
}
```

3. Open a pull request.

### What to put under `network`

A hub asks its superuser before a module reaches anything. Whatever you list here, a hub allows **without
asking**, for every team. This is the part a reviewer reads most closely, so list only what is plainly fine
for everyone and leave the rest for each team to decide.

- `"{host}:9999"` means "the address in the module's `host` setting, on port 9999": the device the team typed
  in. The name in braces must be one of the module's own settings. This is the usual entry.
- `"listen"` lets it open ports on the hub's computer, for devices that answer or announce themselves. List it
  only when the module cannot work without it, and say why in `notes`.
- `"lan"` lets it reach any device on the local network. It is almost never right to allow that in advance.

An empty list, `[]`, is a fine entry. The hub then asks about everything.

The checks start the module with no access at all and tell you what it reached for on its own. If it reaches
for something you would not want every team asked about, such as scanning the whole network, start it with a
setting that stops it (`settings`).

### What to put under `advise`

Leave it out unless a team is likely to be asked something that needs explaining. Each piece of advice is
about a kind of place (`device`, `everyone`, `this-computer`, `ports`, `name`, `internet`) or one exact
address, and says `yes` (expected) or `no` (advised against), with a reason a superuser can weigh:

```json
"advise": [
  { "about": "everyone", "say": "no", "why": "This is the module scanning for plugs. Type the plug's address into its settings instead." }
]
```

`no` is the useful one: it tells a team why a question appeared and what to do instead. `yes` starts the
team's box ticked, so reviewers hold it to the same standard as `network`. Advice allows nothing either way.

### What to put under `tested`

Say only what is true.

- `starts`: it runs in the sandbox and describes itself. The checks prove this much for you.
- `pretend-device`: you drove a stand-in that speaks the device's protocol.
- `real-device`: you used it with the real thing. Say which model in `notes`.

## Add a plugin written for Skillfully

A driver, screen or skill written for Skillfully's own contract goes in `plugins/<id>/` as code, with a
`plugin.json` at its top. The
[platform's guide](https://github.com/wingsixaudio/skillfully/blob/main/CONTRIBUTING.md) covers how to write
one. The same checker the hub uses runs on it here.

## Run the checks yourself

You need [Deno](https://deno.com), Node 22 and git.

```sh
git clone https://github.com/wingsixaudio/skillfully .platform
git -C .platform checkout "$(jq -r .ref platform.json)"
deno run --config .platform/deno.json --allow-read --allow-write --allow-run --allow-net=127.0.0.1 --allow-env \
  tools/check.ts --platform=.platform --all
```

## What gets a pull request merged

- The checks pass.
- It allows in advance only what is plainly fine for every team, and `notes` explains anything wide.
- Any advice is true, plain, and says what to do instead when it advises against something.
- `tested` says no more than is true.
- Its words are plain: what the device is, what the plugin does.
