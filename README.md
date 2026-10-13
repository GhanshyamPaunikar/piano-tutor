<div align="center">

<img src="docs/icon-256.png" width="128" alt="Piano Tutor icon">

# Piano Tutor

### The easiest way to learn piano. Watch the notes fall, press the keys that light up, play real songs from day one.

[![Download for Mac](https://img.shields.io/badge/Download-macOS-111?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/GhanshyamPaunikar/piano-tutor/releases/latest)
[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/GhanshyamPaunikar/piano-tutor/releases/latest)
[![Works with MIDI keyboards](https://img.shields.io/badge/Works%20with-any%20MIDI%20keyboard-3d7bff?style=for-the-badge)](#connect-your-keyboard)

<img src="docs/screenshots/practice.png" alt="Piano Tutor showing falling notes over a named piano keyboard" width="100%">

</div>

---

## Why Piano Tutor

Most people quit piano because the first months feel like homework. Piano Tutor makes the first minute fun.

- **No sheet music needed.** Notes fall toward the keyboard like a game. When a note reaches a key, play it.
- **Every key is named.** Each falling note and every key on the piano shows its name (C, D, E or Do, Re, Mi), so you always know what to press.
- **It waits for you.** In Practice mode the song pauses until you play the right note. Learn at your own speed, with zero pressure.
- **One hand at a time.** Learn the right hand, then the left, then put them together. The app plays the other hand for you.
- **It remembers how far you got.** Press Enter to replay everything you know from the start, or Shift+Enter to pick up where you stopped. That's how piano teachers build a song: review what you know, then add a little more.
- **Any song you like.** Load any MIDI file or a whole folder of them. Thousands of MIDI songs are available online.
- **Works with your keyboard.** Plug in any USB or Bluetooth MIDI keyboard. No keyboard yet? Play with your computer keys.
- **Free.** Every feature is free. A small one-time payment removes the ads forever.

## See it in action

<table>
<tr>
<td width="50%"><img src="docs/screenshots/library.png" alt="Song library"><br><b>Your song library</b><br>Search by title, artist or genre. Filter by difficulty, sort by artist, jump A to Z, and keep favourites and playlists.</td>
<td width="50%"><img src="docs/screenshots/sheet-music.png" alt="Sheet music above falling notes"><br><b>Falling notes and sheet music</b><br>Turn on sheet music to see the score scroll above the keyboard and learn to read notes as you play.</td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/free-play.png" alt="Free Play mode"><br><b>Free Play</b><br>Just play. Every note you press rises up in colour. Perfect for warming up or noodling around.</td>
<td width="50%"><img src="docs/screenshots/devices.png" alt="MIDI devices and keyboard size"><br><b>Made for your keyboard</b><br>Pick your keyboard size (25 to 88 keys) and the screen shows exactly your keys. Play the song through your keyboard's own speakers.</td>
</tr>
</table>

## Features

| | |
|---|---|
| **Three ways to learn** | **Listen** to a song first, **Practice** with the song waiting for you, then **Play along** in real time. |
| **Hands separately** | Left hand, right hand or both. Choose whether you hear the other hand or play in silence. |
| **Tempo control** | Slow a song down to 50% and speed it back up as you improve. |
| **Review what you know** | Piano Tutor tracks how far you have learned each song, for each hand. One key replays the song from the start up to that point, on repeat. Another starts a bar before where you stopped. |
| **Loop any section** | Mark the bar you keep missing and repeat it until it sticks. |
| **Sheet music** | A scrolling grand staff generated from the song, highlighting each note as it plays. |
| **Metronome** | A gentle click on every beat, with an accent on the first. |
| **Keyboard sizes** | 25, 37, 49, 61, 76 or 88 keys. Notes beyond your keyboard move an octave inside it, so every song fits. |
| **Sound on your keyboard** | Send the song to your digital piano's speakers instead of the computer. |
| **Sustain pedal** | Your keyboard's sustain pedal just works. |
| **Previews** | Click any song to hear 30 seconds before you start. |
| **Your music folder** | Point Piano Tutor at a folder of MIDI files once. It remembers it and reads every subfolder. |
| **Works offline** | The desktop app and its piano sound need no internet connection. |

## Get Piano Tutor

### Mac and Windows

Download the latest version from the **[Releases page](https://github.com/GhanshyamPaunikar/piano-tutor/releases/latest)**:

| Your computer | Download |
|---|---|
| Mac with Apple silicon (M1, M2, M3, M4) | `Piano-Tutor-1.0.0-arm64.dmg` |
| Mac with Intel processor | `Piano-Tutor-1.0.0-x64.dmg` |
| Windows 10 or 11 | `Piano-Tutor-Setup-1.0.0.exe` |

> **First launch.** Piano Tutor is not yet signed with an Apple or Microsoft certificate, so your computer asks before opening it the first time.
> **Mac:** right-click the app and choose **Open**, or go to System Settings, Privacy & Security, and click **Open Anyway**.
> **Windows:** if SmartScreen appears, click **More info**, then **Run anyway**.

### In your browser

Piano Tutor also runs in Chrome or Edge with no install. To run it from this repository:

```bash
git clone https://github.com/GhanshyamPaunikar/piano-tutor.git
cd piano-tutor
python3 serve.py
```

Then open **http://localhost:5173**.

## Connect your keyboard

1. Plug your keyboard into your computer with a USB cable (or pair it over Bluetooth MIDI).
2. Open **MIDI Devices** in the sidebar and click **Connect keyboard**.
3. Choose your **keyboard size** so the screen matches the keys in front of you.
4. Optional: under **Play sound on**, choose your keyboard to hear everything through its speakers.

### No keyboard? Use your computer

Your computer keyboard becomes a two-octave piano:

```
 Black keys:   2  3     5  6  7     9  0
 White keys:  Q  W  E  R  T  Y  U  I  O  P  [  ]      (starts at C4)

 Black keys:   S  D     G  H  J     L  ;
 White keys:  Z  X  C  V  B  N  M  ,  .  /            (starts at C3)
```

Press **Up** and **Down** to change octave. In Free Play, hold **Space** to sustain.

## Keyboard shortcuts

| Where | Key | Action |
|---|---|---|
| Library | `Cmd K` or `/` | Search |
| Library | `Up` `Down` | Move through songs |
| Library | `Enter` | Learn the song |
| Library | `Space` | Play or stop a preview |
| Library | `L` `R` | Learn the left or right hand only |
| Library | `F` | Add to favourites |
| Library | `X` | Select (Shift for a range) |
| Player | `Space` | Play or pause |
| Player | `Left` `Right` | Skip 5 seconds |
| Player | `-` `=` | Slower or faster |
| Player | `Enter` | Review: replay from the start to where you have learned |
| Player | `Shift Enter` | Continue learning from where you stopped |
| Player | `K` | Mark everything up to here as learned |
| Anywhere | `Esc` | Back, close or clear |

## Free, with an option to remove ads

Piano Tutor is free with every feature included. The free version shows a small ad. If you enjoy it, a **one-time payment of $10 removes the ads forever**: no subscription, no account, nothing more to pay. You receive a licence key by email; paste it under **Remove ads** and the ads disappear.

<img src="docs/screenshots/remove-ads.png" alt="Remove ads for a one-time $10" width="100%">

---

## For developers

Piano Tutor is a plain web app (HTML, CSS and JavaScript modules, no build step) with an [Electron](https://www.electronjs.org/) shell for the desktop apps.

```
index.html          the whole interface
style.css           styles
js/app.js           player: falling notes, input, practice modes, Free Play
js/library.js       library: songs, search, filters, playlists, favourites
js/song.js          MIDI file to song, hand detection
js/sheet.js         sheet music
js/audio.js         piano sound, metronome, sound on a MIDI keyboard
js/monetize.js      ads and the Remove ads licence
js/config.js        your AdSense and Lemon Squeezy settings
starter/            songs that ship with the app (public domain, arranged for Piano Tutor)
desktop/            Electron main process, icon and build settings
```

### Run and build

```bash
npm install            # once
npm start              # run the desktop app
npm run dist           # build the Mac (.dmg) and Windows (.exe) installers into dist/
npm run screenshots    # retake the screenshots in docs/screenshots
PIANO_TUTOR_EVAL=test.js npx electron .   # run a test script inside the hidden app and print its result
python3 serve.py       # run the web version at http://localhost:5173
```

### Set up ads and the Remove ads purchase

Everything lives in [`js/config.js`](js/config.js):

1. **Ads on the website.** Create a [Google AdSense](https://adsense.google.com) account for your domain, create two ad units, then fill in `adsenseClient` and the two `slots`. Until then, and always in the desktop app, the ad spot shows a "Remove ads" banner instead.
2. **The $10 purchase.** Create a [Lemon Squeezy](https://www.lemonsqueezy.com) store and a product priced at $10 with **licence keys enabled**. Put the product's checkout link in `checkoutUrl`, and its `storeId` and `productId` so only your keys unlock the app. Lemon Squeezy handles payment, tax and the receipt email with the key.

### Bundling songs

Use **Add Music Folder** in the app, or bundle a collection: put MIDI files in a folder and run

```bash
python3 tools/build_collection.py path/to/your/midi/folder
```

This copies them into `songs/` and writes `songs/index.json` with title, artist, level and length for each song (file names like `Artist - Title (Easy).mid` are understood). Only bundle songs you have the right to distribute.

## Licence

Copyright Ghanshyam Paunikar. All rights reserved.
