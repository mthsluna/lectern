<p align="center">
  <img src="docs/lectern-light.webp#gh-light-mode-only" width="180" alt="Lectern">
  <img src="docs/lectern-dark.webp#gh-dark-mode-only" width="180" alt="Lectern">
</p>

<h1 align="center">Lectern</h1>

<p align="center">
  Press start when you sit down to study.<br>
  Every Saturday, find out how the week really went.
</p>

<p align="center">
  <a href="https://github.com/mthsluna/lectern/releases/latest"><b>Download for Windows</b></a>
  &nbsp;&middot;&nbsp;
  <a href="#what-you-get">What you get</a>
  &nbsp;&middot;&nbsp;
  <a href="#questions">Questions</a>
</p>

<br>

<p align="center">
  <img src="docs/showcase-light.png#gh-light-mode-only" alt="Lectern: timer, weekly report and language picker">
  <img src="docs/showcase-dark.png#gh-dark-mode-only" alt="Lectern: timer, weekly report and language picker">
</p>

<br>

Most study apps want you to plan, tag, configure and log before you can begin.
Lectern asks for one thing: press start. It keeps the time, notices the breaks, and
on Saturday it writes you an honest report of the week, without you ever telling it
what day it is.

## Why people keep it open

- **It is honest about breaks.** Paused time is never counted as study. The report
  shows how much of your sitting time was real focus.
- **It never loses a minute.** Time is stored as timestamps, not as a counter. Close
  the window, quit the app or restart your PC: the clock is still right when you come
  back.
- **It stays out of the way.** Closing the window sends Lectern to the system tray
  and unloads the interface, so it uses about 27 MB in the background.
- **It is tiny.** A 1.2 MB installer. It starts instantly.
- **It is yours.** No account, no internet, no tracking. Your history is a single
  file on your own computer.
- **It speaks your language.** English, 中文, हिन्दी, Español, Français, العربية,
  Português, Русский, 日本語 and Deutsch, in light or dark.

## What you get

### Every day

| | |
| :-- | :-- |
| **Start** | You are studying. The clock runs. |
| **Pause** | You are on a break. It is tracked, but never counted as study. |
| **Stop** | You are done for the day. It asks twice, so it never happens by accident. |

You can type what you are studying before you start, or leave it blank. Lectern
remembers your subjects and suggests them next time.

### Every Saturday

The first time you open Lectern on a Saturday, the report opens by itself. Miss
Saturday and it is waiting for you next time. Every past week stays one click away.

- Total hours, and how they compare with the week before
- A day-by-day chart with your best day highlighted
- Days studied, daily average and focus ratio
- Time per subject
- Progress toward your weekly goal
- A short written summary, which tells you when it is your best week yet

### Along the way

- **Weekly goal.** Set your hours once. A thin line under the week's total fills
  as you go and turns green when you get there.
- **Streak.** After two days in a row, Lectern starts counting. The streak is safe
  until the day ends, so it never breaks just because it is morning.

## Keyboard

| Key | Action |
| :-- | :-- |
| `Space` | Start, pause or resume |
| `S` | Stop (press twice) |
| `←` `→` | Previous or next week, in the report |

## Questions

**What happens when I close the window?**
Lectern keeps running in the system tray, near the clock. Click the icon to bring it
back, or right-click it and choose Quit to close it for good. The timer keeps
counting either way.

**What if I do not open the app on Saturday?**
The report is waiting the next time you do. Nothing is skipped.

**When does a week start?**
Sunday. The report on Saturday covers Sunday through Saturday.

**Where is my data?**
In a single JSON file at `%APPDATA%\app.lectern.studytimer\lectern.json`. Copy it
to back up your history, or to move it to another computer.

**Does it need the internet?**
No. Lectern never connects to anything.

## Build from source

You need [Rust](https://rustup.rs) and [Node.js](https://nodejs.org).

```bash
git clone https://github.com/mthsluna/lectern.git
cd lectern
npm install
npm run dev      # run it
npm run build    # make the installer
```

Built with [Tauri](https://tauri.app) and plain HTML, CSS and JavaScript.

## License

[MIT](LICENSE)
