<div align="center">

<img src="docs/lectern-light.webp#gh-light-mode-only" width="96" alt="Lectern">
<img src="docs/lectern-dark.webp#gh-dark-mode-only" width="96" alt="Lectern">

# Lectern

A quiet study timer for Windows.<br>
Press start when you sit down. Read your week on Saturday.

[**Download**](https://github.com/mthsluna/lectern/releases/latest/download/Lectern-Setup.exe) &nbsp;·&nbsp;
[Website](https://mthsluna.github.io/lectern/) &nbsp;·&nbsp;
[Changelog](CHANGELOG.md)

<br>

<img src="docs/showcase-light.png#gh-light-mode-only" alt="Lectern: the timer, the weekly report and the language picker">
<img src="docs/showcase-dark.png#gh-dark-mode-only" alt="Lectern: the timer, the weekly report and the language picker">

</div>

<br>

## Features

- **One-click timer.** Breaks are tracked, never counted as study.
- **Weekly report.** Opens by itself every Saturday, with a written summary.
- **Pomodoro.** Classic 25 / 5 / 15, fully adjustable, with soft chimes.
- **Goal, streak and subjects.** Set once, then just study.
- **Private.** No account, works offline, one local file.
- **Site blocker.** Instagram, X, TikTok and any site you add stay closed while the timer runs.
- **Browser extension.** For Chrome, Edge and Brave; links to the app by itself.
- **Light and dark, in ten languages.**

<p align="center">
  <img src="docs/clips/showcase.webp" alt="Lectern in motion: starting the clock, setting up a Pomodoro, and browsing the weekly report">
</p>

## Install

Download [**Lectern-Setup.exe**](https://github.com/mthsluna/lectern/releases/latest/download/Lectern-Setup.exe)
and run it. No administrator rights, no account. Requires Windows 10 or 11.

Lectern updates itself in place when a new version is out.

For the browser, download [**Lectern-Extension.zip**](https://github.com/mthsluna/lectern/releases/latest/download/Lectern-Extension.zip)
and follow the [three steps](extension/README.md#install). With the app installed, the two link automatically.

## Build

```bash
npm install
npm run dev      # run
npm run build    # installer in dist/
```

Requires [Rust](https://rustup.rs) and [Node.js](https://nodejs.org). Built with [Tauri](https://tauri.app).

## License

[MIT](LICENSE). Chimes by [Qvantor](https://freesound.org/people/Qvantor/), CC0.

<br>

<div align="center"><sub>Made by <a href="https://github.com/mthsluna">@mthsluna</a></sub></div>
