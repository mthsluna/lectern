# Changelog

## 1.19.0

- A browser extension for Chrome, Edge and Brave: the timer in the toolbar, today's hours on its icon. It works on its own, or linked to the app.
- Linked, the extension and the app share one clock: buttons pressed in the browser run in the app, even while it sits in the tray.
- Fixed: with the window closed, a Pomodoro now still changes phase and plays its chimes. The window is kept loaded, hidden, while a Pomodoro runs.

## 1.18.1

- Pomodoro settings open from the switch itself, so it stays centred.
- A calmer sound list: a play icon that turns into moving bars while a chime plays, and a check on the chosen one.
- Volume moves in steps of 1 %, shows the percent, follows you while dragging, and mutes with a click on the speaker.
- A project website at mthsluna.github.io/lectern.

## 1.18.0

- Pomodoro mode: a Free / Pomodoro switch above the timer. Classic 25 / 5 / 15 by default, every length adjustable.
- Chimes for time to rest and time to study, chosen from eight clean public-domain sounds, with volume.
- The countdown keeps running, and the chime still plays, while Lectern sits in the tray.

## 1.17.0

- Clear a day you started by mistake: click it in the report, then Clear day. Undo is there for a few seconds.
- Calendar colours that read at a glance: green for studied days, an amber ring for today, a neutral band for the open week.
- Subject suggestions in their own list, with keyboard support and hours per subject.
- The week card keeps its size while you edit the goal.

## 1.16.0

- Icons instead of words for the Today and Report tabs.
- The play triangle sits in the true centre of its button.

## 1.15.0

- A clearer calendar: studied days are green discs that deepen with time, today is a ring, the open week is outlined, and a legend explains them.
- The calendar fades out when you click away.
- A nicer subject field with a book icon.
- The play button and content stay centred even when the window scrolls.

## 1.14.2

- Side weeks in the carousel fade out toward the edges.

## 1.14.1

- More space between the weeks in the carousel.
- The dashed pace line is gone from the week chart.

## 1.14.0

- The week carousel curves like a drum.
- A bigger play button to start another session.
- A clearer week chart: tracks, hours per day, and a dashed line for the daily pace your goal needs.
- On wide windows the content stays in a comfortable column.

## 1.13.0

- Updates install in place: Update shows an "Updating Lectern" window and reopens Lectern when it is done. No installer to run.
- Install this version by hand once; from here on, updates are a click.

## 1.12.0

- The week carousel now works like Cover Flow, with weeks on both sides.
- Motion everywhere: buttons, the subject field, the status line, the goal and the charts animate in instead of appearing out of nowhere.

## 1.11.0

- The week switcher is a 3D carousel: neighbouring weeks turn away in perspective, and you can click them.
- Setting a weekly goal sends an arrow into the target.
- A quieter round button to start another session.

## 1.10.0

- A calendar in the report: click the dates to see the month, with a dot on every day you studied, and jump to any week.
- The week switcher works like a carousel, with the year above the dates.
- Prettier buttons for setting a goal and starting another session.

## 1.9.3

- The theme icon animates: the sun sets and the moon rises, or the moon sets and the sun rises.

## 1.9.2

- A new moon for the theme icon: a crescent with the Lectern sparkle.

## 1.9.1

- The theme control is a single icon: the sun by day, the moon by night. One click flips it.

## 1.9.0

- Sessions that cross midnight are split between the days: 22:00 to 03:00 counts 2 h on the first day and 3 h on the next, for study, breaks and subjects alike.

## 1.8.1

- Fixes Windows Defender quarantining Lectern 1.8.0 (a false positive). Lectern no longer downloads or runs installers itself; Update opens the installer in your browser.
- Sun and moon theme switch, one click.
- The report's week range is a calendar chip: "18 – 24 de outubro" with the year beside it.
- The installer refreshes the Windows icon cache, so the taskbar shows the current icon.

## 1.8.0

- Updates from GitHub. When a new release is out, a quiet line offers it: Update, Not now or Skip this version.
- Updates are verified against GitHub's SHA-256 digest, installed silently, and Lectern reopens on its own.

## 1.7.0

- A new installer in Lectern's own style: the rising-star mark, calm screens for install, update and removal, and dark mode. No administrator prompt.
- Optional desktop shortcut and start with Windows (straight to the tray).
- Uninstalling asks whether to keep your study history.
- `--silent` for scripted installs and removals.
- Updates an existing install in place.

## 1.6.1

- The installer uses the Lectern icon and branded setup pages instead of the default NSIS look.

## 1.6.0

- Dark mode. Follows Windows by default; a toggle in the header cycles System, Light and Dark.
- New README with a light and dark showcase, generated by `npm run screenshots`.

## 1.5.0

- Weekly goal, shown as a thin progress line under the week's total.
- Optional subject per session, with suggestions and a by-subject breakdown in the report.
- Day streak next to the week label.
- The report notes a personal-best week.
- Keyboard shortcuts: `Space` to start, pause and resume, `S` to stop, arrows to change week.

## 1.4.0

- Typography in the spirit of Apple's system interfaces: an ultralight timer, semibold headings and bold report figures.
- Smaller installer, since the serif font is gone.

## 1.3.0

- New mark: a four-pointed guiding star rising over a horizon, set in a bookplate shield.

## 1.2.0

- Closing the window sends Lectern to the system tray and unloads the interface (about 27 MB in the background).
- Deep jade accent colour.

## 1.1.0

- Ten languages, chosen on first launch: English, 中文, हिन्दी, Español, Français, العربية, Português, Русский, 日本語 and Deutsch.

## 1.0.0

- First release: a study timer with start, pause and stop, and a weekly report every Saturday.
