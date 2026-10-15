# Spider V Web Control

A browser-based editor for Line 6 Spider V amps over USB, built from a
reverse-engineered protocol. Works on Linux (and anywhere else with Web MIDI).
Tested with a Spider V 20 MkII on firmware 2.0.1.

- Browse and load the amp's 128 presets
- See the signal chain, switch blocks on and off, and change amp, effect, reverb, wah and cab/mic models
- Turn every parameter knob, with names and ranges from Line 6's model catalog
- Follows preset changes and edits made on the amp itself
- **Import tone files** (`.svl6p` from Spider V Remote, the JSON "version 5" format of
  Line 6's Spider Remote apps, or raw preset dumps) via the button or drag-and-drop, and **export** the current tone as `.svl6p`
- **Save** the current tone to any preset slot (with a new name), with one-click undo,
  and **back up** all presets to a file. An imported tone saves under the name and
  CustomTone id from its file
- **Listen**: play the amp's USB audio output through the browser
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

Edits and imported tones go to the amp's edit buffer. **Save…** writes the edit buffer
to a preset slot the way Spider V Remote does (`SetPresetFile`); right after saving
you can **Undo**, which writes the slot's previous contents back. Consider
**Back up all presets** first. Tone-file settings with no counterpart on the amp
(tempo sync flags, expression pedal assignment, speaker mode) are listed as not supported.

## On a phone (Android)

Web MIDI needs Chrome on Android (iOS browsers don't support it) and HTTPS. Plug the amp
into the phone with a USB OTG adapter, then serve the app over HTTPS on your network:

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

`test/fixtures/spiderv30-remote-capture.txt` is SysEx extracted with
`tools/pcap2sysex.py` from the USB capture in
[stric9r/Line6-FBV3-Clone](https://github.com/stric9r/Line6-FBV3-Clone).
`test/fixtures/spiderv20-mkii-session.json` was recorded from a real amp with
`bun tools/spiderv-cli.ts record`. It also powers demo mode.
`test/fixtures/line6-arachnid-rhythm.json` is the sample tone shipped in the Spider Remote app;
`test/fixtures/customtone-do-i-wanna-know.svl6p` is a CustomTone download (author MATOUK).

## Model catalog

`app/src/lib/catalog.json` (display names, parameter names and ranges) is extracted
from the assets of Line 6's *Spider Remote* Android app:

```sh
unzip -o SpiderRemote.apk 'assets/*' -d /tmp/spider-apk
bun tools/extract-catalog.ts /tmp/spider-apk/assets
```

Line 6 and Spider V are trademarks of Yamaha Guitar Group. This project isn't affiliated with them.
