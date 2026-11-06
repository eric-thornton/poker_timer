# Poker Timer

Deadmoney's Shootout: an Electron + React + TypeScript desktop app, built on
electron-react-boilerplate (Electron 11.0.1, webpack 5.5.1, electron-builder 22.10.5).
No login or auth; the app is a single window.

## Layout

- `src/App.tsx`, `src/App.global.css`: the whole UI. Title, then three columns
  20% / 60% / 20%: **Structure** (blinds table), **Clock**, **Payouts** (with a **Buyins**
  header 1/3 of the way down). The Clock section shows `mm:ss` (16.8vw, four times the title). It starts at the current round's Duration (minutes), counts down once Start Clock is pressed (also bound to the space bar), and pauses on Pause Clock. At 00:00 it rolls into the next round and keeps counting; after the last round it stops at 00:00. "CLOCK PAUSED" (5vw, bold orange) shows under the clock whenever it is not running, including before the first Start (it is hidden with `visibility`, not removed, so the blinds line below does not jump). Under that, two lines `Curr: SB/LB` and `Next: SB/LB` (labels right-aligned so the colons line up; next is `-` on the last level). Labels are 5vw (same as CLOCK PAUSED); the blinds values are two steps larger (1.44em, about 7.2vw). The gap between the Curr and Next rows equals the gap between CLOCK PAUSED and Curr (both 55px at 1512x860, set by `row-gap: 0.33em` on `.BlindsLine`; measured on the ink of the digits). Widest case `Curr: 6000/12000` still fits the 60% column with little to spare, so check it (round 16) if sizes change; 8vw labels would not fit. A level whose Duration is `*` shows `--:--` and does not count. The countdown is timestamp based (`endTimeRef`, 200ms poll), so pausing/resuming and background throttling do not drift. Changing round or structure resets the clock to that round's Duration (changing structure also pauses). A **Sounds** block is pinned to the bottom-left corner of the middle column (`.SoundSettings`, absolutely positioned so it does not add height): drop-downs `Warn:` and `End:`, held in `warningSound` / `endSound` state. Their choices are `None` plus every `resource/*.wav` (shown without the extension, found with `require.context`, embedded in the bundle as data URIs by the `asset/inline` rule in `webpack.config.base.js`, which must force `mimetype: 'audio/wav'`: webpack's default `audio/wave` fails in Electron with "Unable to load URL due to content type" and `play()` rejects silently; types in `src/resource.d.ts`). Defaults: Warn `oneminute`, End `bell` (if present). The Warn sound plays when the running clock counts down through 01:00 (not for a round that starts at 01:00), the End sound at 00:00, including the last round. To test without waiting, override `Date.now` in the page (via the debug port) to jump near 01:00 / 00:00, and wrap `HTMLMediaElement.prototype.play` to log the real outcome (`.then`/`.catch` plus the `ended` and `error` events); do not replace `play()`, or a decode failure goes unnoticed. A sound is fire-and-forget: it plays to its end regardless of the clock moving on. Buttons under it: Round Up / Round Down (move the highlighted current round in the Structure table, clamped to the first and last level; `roundIndex` resets to round 1 when the structure changes).
- `resource/*.blinds`: blind structures named `hh:mm.blinds`, pipe delimited, one level per line:
  `Round|SB|LB|Anty|Duration`. `-` means no ante; `*` in Duration is on the last level
  (meaning not yet confirmed with the user). `App.tsx` loads every `.blinds` file with `require.context`, so a new file in `resource/` shows up in the Structure drop-down (under the Structure heading, sorted by hh:mm, default `2:51`).
- `resource/players.unl`: one player name per line. It drives the Buyins table (Name, Count,
  Value, plus a Total row). Count starts at 1; each row has a single + button that adds a buyin
  up to the selected limit. The Wrap checkbox defaults off; when enabled, the next click at the
  limit returns the count to 1. Value is count x \$10 (`BUYIN_PRICE`). The limit is chosen by
  the "Number of Buyins Allowed" radios (2, 3 or 4, `BUYIN_LIMITS`, default 2) at the bottom of
  the Structure column; lowering it trims counts that are over it. Counts are held in React
  state only, so they reset when the app restarts.
- `resource/payouts.unl`: `pot|1st %|2nd %|3rd %|4th %`, one row per pot size ($50 to $300 in
  \$10 steps); a `-` in the 4th column means only three places are paid. The Payouts table
  looks up the row for the current pot (buyin count x \$10; the closest smaller row if there is
  no exact match) and shows Place, %, Payout. The buyin counts live in `Hello` in `App.tsx`
  and are passed to both `Buyins` and `Payouts`.
- The right column has two views, switched by a Buyins / Player Selection radio pair pinned to
  the bottom of the column: the Buyins table, and a Player Selection checklist of everyone in
  `players.unl`. Unchecked players are left out of the Buyins table, the totals and the pot
  (so Payouts follows). All players start checked; a player's buyin count is kept while
  unchecked. State (`counts`, `playing`, `view`) lives in `Hello` in `App.tsx`, in memory only.
- `images/`: empty, reserved for images.
- `.unl` and `.blinds` files are imported as raw text via the `asset/source` rule in
  `.erb/configs/webpack.config.base.js`; types are in `src/resource.d.ts`.
- The Structure table font size is computed from `vw`/`vh` in `.Structure` so all 16 rows fit
  the 20% column at any window size. Keep it in sync if the row count or columns change.
- The user spells the ante column "Anty"; keep that spelling.

## Keeping the screen awake

`src/main.dev.ts` starts Electron's `powerSaveBlocker` (`prevent-display-sleep`) when the window
is created and stops it when the window closes. It works on macOS and Windows. Check on a Mac with
`pmset -g assertions` (look for a `NoDisplaySleepAssertion` named "Electron").

## Running in dev (the stock `yarn start` does NOT work here)

This machine has only Node 26 and the project is Node 14 era. Known problems and fixes
(none of these need repo changes):

1. webpack 4/5 + css-loader's old postcss break on Node 26 (`exports` error). Run webpack
   under Node 16: `npm install node@16` in a scratch dir gives a `node` binary; put a
   symlink to it first on PATH.
2. `yarn start` launches Electron via `npm run start:main`, and modern npm rejects the old
   `devEngines` field in package.json. Instead run the two halves separately, with a no-op
   `npm` shim script (`#!/bin/sh` + `sleep 100000`) first on PATH for the renderer so its
   spawn hook does not kill the dev server:
   - `PATH=<shim>:$PATH yarn start:renderer` (dev server on :1212)
   - `env -u ELECTRON_RUN_AS_NODE yarn start:main`
3. `ELECTRON_RUN_AS_NODE=1` is set when running inside the VS Code extension; it makes
   Electron behave as plain Node ("Not running in an Electron environment"). Always unset it.
4. The Electron binary may be missing or half extracted (`node_modules/electron/path.txt`
   absent, no `Frameworks`). Fix: `ditto -x -k` the zip from
   `~/Library/Caches/electron/...v11.0.1-darwin-arm64.zip` into `node_modules/electron/dist`
   and write `Electron.app/Contents/MacOS/Electron` to `path.txt`.
5. The renderer hot reloads CSS/TS changes, but a webpack config change needs the renderer
   restarted, and Electron has to be restarted to see main-process changes. The
   "Invalid header: Does not start with Cr24" log line (devtools extension installer) is harmless.
6. Window-size checks: with the debug port, `Emulation.setDeviceMetricsOverride` (e.g. 1512x860, 1280x720) plus `Page.captureScreenshot` shows the layout at laptop sizes even when DevTools squeezes the real window. The middle column stack (title, 16.8vw clock, 2-line CLOCK PAUSED, blinds line, buttons) is sized in vw, so short screens are the tight case.
7. To drive the UI without clicking, launch Electron with `--remote-debugging-port=9222` and
   evaluate JS over the DevTools protocol (the `ws` package is in node_modules): click buttons with
   `document.querySelector(...).click()` and read `.ClockDisplay`. This was used to test the clock.
8. To see the window: `osascript -e 'tell application "Electron" to activate'`, then
   `screencapture -x <file>`. It can be hidden behind other apps otherwise.

## Building for macOS (Intel and Apple Silicon)

- `package.json` `build.mac.target` is `dmg` with `arch: universal`, so one app runs on both
  x64 and arm64. There are no native modules. Verify with
  `lipo -archs release/mac-universal/DeadmoneyShootout.app/Contents/MacOS/DeadmoneyShootout`
  (expect `x86_64 arm64`). Build output goes to `release/` (gitignored).
- The app icon source is `assets/DeadmoneyShootout.jpg`; macOS packaging and the Electron
  window use its square PNG derivative, `assets/DeadmoneyShootout.png`.
- Build with: `CSC_IDENTITY_AUTO_DISCOVERY=false yarn package`, with the PATH shim above.
  This needs **Node 14 x64 under Rosetta**: electron-osx-sign pulls in `istextorbinary` /
  `editions`, which only support Node 10-15, and Node 14 has no arm64 build. Download
  `https://nodejs.org/dist/v14.21.3/node-v14.21.3-darwin-x64.tar.gz` and put its `bin/node`
  first on PATH. Node 16 compiles webpack fine but fails at the signing step.
- The production renderer webpack config no longer uses `sass-loader` for `.css` (node-sass 5
  has no arm64 binary). There are no `.scss` files; if you add one, install dart `sass`
  and restore the loader.
- Known unresolved: the `.app` builds and is universal, but the DMG step fails with
  `spawn /usr/bin/python ENOENT` (electron-builder 22's dmg-builder needs a system python).
  Either upgrade electron-builder, switch the target to `zip`/`dir`, or provide a python.
- Notarizing is skipped unless `CI` plus `APPLE_ID`/`APPLE_ID_PASS` are set. Without a signing
  identity the app is unsigned, and Apple Silicon needs at least an ad-hoc signature to run
  when distributed.

## Building for Windows

- `package.json` `build.win.target` is `nsis`, `arch: x64`. It builds fine from macOS (no wine
  setup needed; electron-builder downloads its own binaries). After the production bundle
  exists (`yarn build`, which `yarn package` runs first), build just the installer with:
  `CSC_IDENTITY_AUTO_DISCOVERY=false node_modules/.bin/electron-builder build --win --publish never`
  using the same Node 14 PATH shim. Output: `release/DeadmoneyShootout Setup 2.3.0.exe`
  (one-click, per-user installer) and `release/win-unpacked/`.
- `yarn package` on a Mac only builds the Mac target; pass `--win` as above for Windows.
- Verified to build, not run: there is no Windows machine here. The installer is unsigned, so
  Windows SmartScreen will warn. Only x64 is built (no ia32/arm64).
- Keep the code platform neutral: use `path.join`, no `/`-only paths or Mac-only APIs.

## Conventions

- Match the existing code style; the repo uses ESLint + Prettier via lint-staged.
- Type check without npm: `node node_modules/typescript/bin/tsc --noEmit -p .`
- Commits made by Claude end with the attribution lines from the org's managed settings.
