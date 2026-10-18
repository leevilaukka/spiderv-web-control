# Spider V Web Control

A browser-based editor for Line 6 Spider V amps over USB, built from a
reverse-engineered protocol. Works on Linux (and anywhere else with Web MIDI).
Tested with a Spider V 20 MkII on firmware 2.0.1.

- Browse and load the amp's 128 presets
- See the signal chain, switch blocks on and off, and change amp, effect, reverb, wah and cab/mic models
- **Drag effects around the chain** (or Alt+← →) to the places the amp allows: effects, reverb and
  volume pedal before or after the amp, and effects in any order on each side
- Turn every parameter knob, with names and ranges from Line 6's model catalog, which you load from
  your own copy of the Spider Remote app (see [Model catalog](#model-catalog))
- Follows preset changes and edits made on the amp itself
- **GX-100-style performance controls**, kept per preset in the browser and saved along with the tone:
  - **Shortcuts** switch several blocks and set knobs at once (like CTL/assign switches with min/max),
    on a key, a button or a MIDI footswitch; toggle or momentary
  - **Channels A/B**: two setups of the amp, cab or any blocks in one preset, switched with one key,
    like a switched dual amp or two-way chain (the Spider V has one amp, so they take turns)
  - **Stage view**: big footswitch buttons; memory mode picks presets in banks of four, manual mode switches blocks
    (long-press or right-click a block to turn its knobs without leaving the stage view)
  - **MIDI pedals**: program change selects presets, footswitches trigger shortcuts or the channel switch,
    and an expression pedal sweeps a shortcut's knobs
  - The tone assistant can set up shortcuts and channels too
  - **Export and import the app settings** (amp menu) to back them up or move them to another browser:
    every preset's shortcuts and channels, the controls and MIDI pedal setup, and the tone assistant's
    provider, models and recent tones. API keys stay out of the file; an import can be undone
- **Import tone files** (`.svl6p` from Spider V Remote, the JSON "version 5" format of
  Line 6's Spider Remote apps, or raw preset dumps) via the button or drag-and-drop, and **export** the current tone as `.svl6p`. Tones exported here
  carry their shortcuts and channels A/B, which come back on import
- **Save** the current tone to any preset slot (with a new name), with one-click undo,
  and **back up** all presets to a file. An imported tone saves under the name and
  CustomTone id from its file
- **Tone assistant**: describe a sound and an AI model (Claude or Gemini, with your own API key)
  builds it on the amp from the model catalog, then refines it as you ask
- **Listen**: play the amp's USB audio output through the browser
- **Runs on an Android phone** with the amp plugged into it: install the [hosted app](#directly-on-a-phone-android)
  from Chrome and it works offline, no computer needed
- **Remote control from a phone**: a phone on the same Wi-Fi uses the amp plugged into the computer
  (scan a QR code), with the full app; shortcuts and channels stay in step on both. Works on iPhones too
- Protocol console for sending raw commands
- Demo mode with a simulated amp

The protocol is documented in [PROTOCOL.md](PROTOCOL.md).

## Run it

Requires [Bun](https://bun.sh) and Chromium or Chrome (for Web MIDI).

```sh
cd app
bun install
bun run dev
```

Open http://localhost:5173, connect the amp over USB, click **Connect**, and allow
MIDI (with SysEx) access. Use `?demo` or **Try the demo** to run without an amp.
Then load the [model catalog](#model-catalog) once, for model names and model changes.

Edits and imported tones go to the amp's edit buffer. **Save…** writes the edit buffer
to a preset slot the way Spider V Remote does (`SetPresetFile`); right after saving
you can **Undo**, which writes the slot's previous contents back. Consider
**Back up all presets** first. Tone-file settings with no counterpart on the amp
(tempo sync flags, expression pedal assignment, speaker mode) are listed as not supported.

## Run it in a container

The image holds the built app and a small server for it, including the phone relay. The amp
stays connected to the computer whose browser opens the app (Web MIDI), so the container needs no
USB access.

```sh
docker compose up -d --build      # → http://localhost:8080
```

`compose.yaml` uses host networking (Linux) so the remote-control QR code shows the machine's LAN
address. For HTTPS (phones need it for Web MIDI and to keep the screen on), uncomment `CERT_DIR`
and the volume in `compose.yaml` to mount a folder with `cert.pem` and `key.pem`, such as the dev
certificate below, and open `https://localhost:8080`. The key must be readable by uid 1000.

Without compose:

```sh
docker build -t spiderv-web-control .
docker run -d --network host spiderv-web-control
docker run -d --network host -e CERT_DIR=/certs -v "$PWD/.cache/dev-cert:/certs:ro" spiderv-web-control
```

With bridge networking (`-p 8080:8080`, e.g. on Docker Desktop), the container can't see the
LAN address; pass it with `-e PUBLIC_ADDRESSES=192.168.1.20`. Other settings: `PORT`, `HOST`.
The same server runs without Docker: `cd app && bun run build && bun run start`.

## Run the standalone executable

Each build on GitHub (and each release) has executables of the same server with the app built in,
for Linux (x64, arm64) and Windows (x64), so neither Bun nor Docker is needed. Run it and open
http://localhost:8080; it takes the same settings (`PORT`, `HOST`, `CERT_DIR`, `PUBLIC_ADDRESSES`)
as environment variables. On Linux, `chmod +x` it first; Windows may ask to let it through the
firewall, which phones need for remote control.

To build them yourself (Bun cross-compiles, so any machine can build all of them):

```sh
bun run build:exe                                             # for this machine
bun run build && bun tools/build-exe.ts bun-linux-x64 bun-windows-x64
```

They land in `dist-exe/`. A catalog made with `tools/extract-catalog.ts` would be built in
too, so keep such executables to yourself.

## Remote control from a phone

The amp stays plugged into the computer; the phone (any browser, iPhone included) talks to it
through the computer's browser tab. Start the app so other devices on the network can reach it:

```sh
cd app
bun run dev:remote        # or, for a built app: bun run build && bun run preview:remote
```

Open http://localhost:5173 on the computer and connect to the amp. In the amp menu, choose
**Remote control from a phone…**, turn on sharing and scan the QR code with the phone (or open
the link, or enter the pairing code on the phone's start page). The computer's menu shows how many
phones are connected; keep its tab open. Sharing starts again by itself the next time that browser
connects, with the same code, so a bookmark on the phone keeps working; **New code** locks out
phones that have the old one. Anyone on the network with the code can control the amp while sharing is on.

The phone keeps its screen on while it is a remote (**Keep screen on** in its amp menu turns
that off). Browsers allow that properly only on HTTPS pages; over plain http the app falls back
to a silent looping video, which not every phone honours. For a screen that reliably stays on,
serve the app over HTTPS with `bun run dev:phone` (see below for the certificate), open
`https://localhost:5175` on the computer, and accept the certificate warning once on each device.

How it works: the dev server relays WebSocket messages between the computer's tab and the phones
(`app/remote-relay.ts`). Each phone runs the whole app on a port of the computer's hub
(`app/src/lib/protocol/hub.ts`), which forwards everyone's requests to the amp one at a time per
channel and routes each reply back to whoever asked. The hub answers handshakes and symbol table
requests itself, and tells the other browsers about knob changes, since the amp doesn't report
changes made over USB. Shortcuts and channels (normally kept in one browser) are synced between them.

## Directly on a phone (Android)

The app can run on an Android phone with the amp plugged into it, without a computer. You need
Chrome (iOS browsers have no Web MIDI) and a USB OTG adapter or USB-C to USB-B cable.

1. Open https://leevilaukka.github.io/spiderv-web-control/ in Chrome on the phone.
2. Chrome menu → **Add to Home screen** (or **Install app**). From then on it opens full-screen
   and works offline, so you can play with no network.
3. Plug in the amp, open the app, tap **Connect** and allow MIDI.
4. Load the [model catalog](#model-catalog) on the phone once: choose the Spider Remote APK
   (an APK extractor app can save it from the installed Spider Remote). To bring your shortcuts,
   channels and pedal setup from a computer, use **Export app settings** there and
   **Import app settings…** on the phone.

When a new version has downloaded, the app offers to reload; it never reloads by itself, so it
won't drop the amp while you play. The hosted copy leaves out remote control, as it has no relay
server; everything else is the same app. CI publishes it from `main` (`VITE_NO_RELAY=1 bun run build`
makes the same build, which any static HTTPS host can serve).

To serve it from your own computer instead (e.g. for a development version), serve the app over
HTTPS on your network:

```sh
mkdir -p .cache/dev-cert
openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=Spider V Web Control dev" \
  -addext "subjectAltName=IP:<your PC's LAN IP>,DNS:localhost" \
  -keyout .cache/dev-cert/key.pem -out .cache/dev-cert/cert.pem
cd app && bun run dev:phone
```

Open `https://<your PC's LAN IP>:5175` on the phone, accept the certificate warning
(Advanced → Proceed), then Connect.

## Command line

```sh
bun tools/spiderv-cli.ts info           # handshake, current preset
bun tools/spiderv-cli.ts names          # list presets
bun tools/spiderv-cli.ts dump           # current tone with symbolic names
bun tools/spiderv-cli.ts load 5
bun tools/spiderv-cli.ts get Amp Bass
bun tools/spiderv-cli.ts set Amp Bass 0.6
bun tools/spiderv-cli.ts model FX4 MediumHall
bun tools/spiderv-cli.ts listen         # print messages from the amp
bun tools/spiderv-cli.ts backup backups/all.json
bun tools/spiderv-cli.ts save 12 "My Tone"           # overwrites slot 12 (0-based)
bun tools/spiderv-cli.ts restore backups/all.json 12 # put slot 12 back
bun tools/spiderv-cli.ts -v raw 0 0x9 0x2a 0x21
```

The CLI talks to the ALSA raw MIDI device directly (`--dev /dev/snd/midiCxD0` to override).
It can't run while a browser has the amp open: Chromium keeps its MIDI subscription
until the tab (sometimes the whole browser) is closed, even after **Disconnect**.

## Tests

```sh
bun test
```

Some fixtures in `test/fixtures` are listed under [Third-party material](#third-party-material).
Made for the tests: `test-catalog.json`, a model catalog covering the models the tests and demo
mode use (with made-up names and defaults), and `test-tone-plexi.svl6p`, a tone laid out exactly
like a file saved by Spider V Remote.

## Model catalog

The names of the amp's models and knobs, their ranges and defaults, and which models each block
can use come from Line 6's *Spider Remote* Android app. They belong to Line 6, so this project
doesn't include them. Load them from your own copy of the app:

- **In the app:** amp menu → **Model catalog…**, then choose the Spider Remote APK (`.apk`,
  `.xapk` or `.apks`). It is read in the browser and kept there; phones connected as remotes get it
  from the computer. Copy the APK from an Android phone with the app installed, e.g. with an APK
  extractor app.
- **At build time:** `bun tools/extract-catalog.ts SpiderRemote.apk` writes
  `app/src/lib/catalog.json` (ignored by git), which the app's build includes. Keep such a build
  to yourself.

Without the catalog the editor still works: model and knob names are made from the amp's
internal ids (`DoubleVerb` → "Double Verb"), knobs show 0 to 10, and models can't be changed.
Demo mode uses the test catalog.

## License

The code is released under the [MIT License](LICENSE). The material below comes from elsewhere,
is not covered by that license and stays with its owners.

### Third-party material

| File | What it is | Source |
|---|---|---|
| `test/fixtures/spiderv20-mkii-session.json` | Replies of a Spider V 20 MkII (fw 2.0.1): its symbol table, the names of its 128 presets and one preset. Used by the tests and demo mode | Recorded from the author's amp with `bun tools/spiderv-cli.ts record` |
| `test/fixtures/line6-arachnid-rhythm.json` | The sample tone shipped in the app | Line 6 *Spider Remote* app |
| `test/fixtures/spiderv30-remote-capture.txt` | SysEx between Spider V Remote and a Spider V 30, extracted with `tools/pcap2sysex.py` | USB capture in [stric9r/Line6-FBV3-Clone](https://github.com/stric9r/Line6-FBV3-Clone) (GPL-3.0) |

They are included to make the amp's protocol interoperable with free software, the way the
reverse engineering in [PROTOCOL.md](PROTOCOL.md) is. If you own any of it and want it removed,
open an issue.

Line 6 and Spider V are trademarks of Yamaha Guitar Group. This project isn't affiliated with them.
