# Player's Notebook

[Version française](./README.md)

**➜ [Open the app](https://sebplace.github.io/carnet-du-joueur/)** · installable on a phone, then works offline.

Player's Notebook is a private offline notebook for recording, organising and cross-checking your player-side information in Blood on the Clocktower.

> Unofficial fan-made project: Player's Notebook is not affiliated with, endorsed by, or approved by The Pandemonium Institute, and it does not replace the Storyteller or the official rules.

## What it does

- creates a 5-to-20-player seating roster, with a printable paper sheet sized to the actual player count;
- records claims, 3-for-3s, clues, notes, executions, ballots, night deaths, delayed information and what you yourself claimed;
- links and visualises your notes (seats, round table, timeline, link graph, player-by-character grid, contradiction map) and supports search;
- runs locally in the browser and can be installed as a PWA.

## What it does not do

- it does not read the Storyteller’s Grimoire or know hidden information;
- it does not simulate every ability, poison, drunkenness, jinx, role change or Storyteller decision;
- it does not identify liars, render any rules verdict or certify that a world is legal;
- it does not sync external scripts or redistribute official assets;
- it does not send your notes to a server or AI model.

## Run locally

There are no third-party libraries and nothing to install in the project. You only need Node.js 20 or newer to run the small bundled local server:

```bash
npm start
```

Then open <http://127.0.0.1:8794>.

Do not open `index.html` directly as a `file://` URL: the app uses ES modules and a service worker, which require a local HTTP origin or HTTPS. Any static server works; `npm start` is only a convenience wrapper around the bundled Node server.

## Offline use and installation

After the first visit from the local address or an HTTPS address, the service worker can cache the app. Settings show the cache status. Install it from your browser menu; on iOS/Safari, use Share → Add to Home Screen.

## Privacy

Everything stays in the browser’s local storage. There is no account, telemetry, or intentional network upload of your notes. Exports are plaintext JSON files: treat them as private notes, protect your device, and do not share them during a game.

## To show your table

You can read this before the game:

> I am using a private notebook, like a sheet of paper. It reads nothing from the Storyteller or the Grimoire, uses no AI, sends nothing anywhere, and gives no rules verdicts. If the table would rather I play without my phone, I will put it away.

## Screenshots to add

<!-- TODO screenshots: game setup screen; quick claim entry; ballot entry; Investigation view; privacy and backups screen; PWA install flow. -->

## Licence

[LICENSE](./LICENSE) states the current status: the source code and original project content are licensed under Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0). The rights to Blood on the Clocktower, its characters, scripts, trademarks, artwork and official text remain with The Pandemonium Institute and their respective holders.

**Licence note under consideration:** CC BY-NC-SA 4.0 is a poor fit for source code. A future split between code and content licences is being considered; this does not change the current licence stated here.
