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
  "notes": "Why it needs what it asks for, and anything a team should know."
}
```

3. Open a pull request.

### What to put under `network`

This is the part a reviewer reads most closely. Ask for the least the module needs.

- `"{host}:9999"` means "the address in the module's `host` setting, on port 9999". The name in braces must be
  one of the module's own settings.
- `"listen"` lets it open ports on the hub's computer, for devices that answer or announce themselves.
- `"lan"` lets it reach any device on the local network. Use it only when the module truly cannot work with
  one address, and say why in `notes`.

If the module tries something on its own that your grant does not allow, such as scanning the network, either
start it with a setting that stops it (`settings`) or widen the grant and say why. The checks tell you what it
tried.

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
- It asks for the least it needs, and `notes` explains anything wide.
- `tested` says no more than is true.
- Its words are plain: what the device is, what the plugin does.
