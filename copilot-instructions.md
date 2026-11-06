# Copilot instructions for this repo

## Project

- This repo is an Electron + React + TypeScript app for a poker timer.
- It is based on electron-react-boilerplate and is a single-window desktop app.
- Do not assume a normal `yarn start` works for local development.

## Required runtime

- Use Node 16 for local dev and app startup.
- This project is old (Electron 11 / webpack 5 / webpack-dev-server 3) and is not compatible with modern Node 26+.
- Modern Node versions trigger webpack/css-loader compatibility issues and may break the app startup flow.

## Node setup

- Install/use Node 16 via nvm:
  - `export NVM_DIR="$HOME/.nvm"`
  - `. "$NVM_DIR/nvm.sh"`
  - `nvm use 16`
- This repo was successfully run with Node `v16.20.2`.

## Yarn setup

- `yarn` may not be on PATH initially.
- Install it with:
  - `npm install -g yarn`

## Dependency install

- Run:
  - `yarn install --frozen-lockfile --non-interactive`
- This project has a `postinstall` step that builds the renderer DLL required for webpack dev.

## First-run startup sequence

The repo’s startup flow requires a workaround because the normal `yarn start` script is not sufficient in this environment.

1. Start the renderer in the correct environment:

   - `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 16 >/dev/null`
   - `mkdir -p /tmp/noop-npm`
   - `printf '%s\n' '#!/bin/sh' 'sleep 100000' > /tmp/noop-npm/npm`
   - `chmod +x /tmp/noop-npm/npm`
   - `cd /Users/ericthornton/repos/poker_timer`
   - `PATH="/tmp/noop-npm:$PATH" yarn start:renderer`

2. If the DLL files are missing, build them explicitly before or while bringing up the app:

   - `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 16 >/dev/null`
   - `cd /Users/ericthornton/repos/poker_timer`
   - `yarn cross-env NODE_ENV=development webpack --config ./.erb/configs/webpack.config.renderer.dev.dll.babel.js`

3. Start the Electron main process with the Electron override removed:
   - `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 16 >/dev/null`
   - `cd /Users/ericthornton/repos/poker_timer`
   - `env -u ELECTRON_RUN_AS_NODE yarn start:main`

## Known startup gotchas

- `ELECTRON_RUN_AS_NODE=1` is set in some VS Code/extension environments and makes Electron act like a plain Node process. Always unset it for this app:
  - `env -u ELECTRON_RUN_AS_NODE ...`
- Electron 11's macOS development bundle defaults to the OS-visible name `Electron`. `app.setName()` only changes Electron's internal name and does not change the name macOS shows. The `start:main` script runs `.erb/scripts/SetDevAppName.js` first to set the development bundle's `CFBundleDisplayName` and `CFBundleName` from `productName`; packaged builds get their name from electron-builder.
- The packaged app version comes from `src/package.json`. The macOS build remains universal (`build.mac.target` uses `arch: universal`), while `build.dmg.artifactName` controls only the DMG filename; use `${productName}-${version}.${ext}` to omit the architecture suffix.
- This environment lacks `/usr/bin/python`, which electron-builder 22's DMG target requires. If the universal app bundle builds but DMG creation fails with `spawn /usr/bin/python ENOENT`, create and verify a compressed image from `release/mac-universal/DeadmoneyShootout.app` with `hdiutil create` and `hdiutil verify`.
- `webpack-dev-server` needs the DLL files in `.erb/dll` to exist before the renderer can serve UI assets correctly.
- The warning `Invalid header: Does not start with Cr24` during Electron startup is harmless in this repo and does not necessarily indicate a fatal issue.
- `Browserslist: caniuse-lite is outdated` warnings are harmless and do not stop the app.
- `DeprecationWarning` messages from webpack/css-loader under Node 16 are not fatal for this project.

## Useful verification commands

Use these to confirm the app is actually running:

- Check webpack renderer health:
  - `curl -I --max-time 20 http://localhost:1212/dist/renderer.dev.js`
- Check live processes:
  - `ps -ef | grep -E 'electron|webpack serve|yarn start:renderer|yarn start:main' | grep -v grep`

## Working state observed in this session

- The app served successfully on `http://localhost:1212/` with webpack dev server.
- The Electron app launched successfully when started with Node 16 and `env -u ELECTRON_RUN_AS_NODE`.
- Verified response: `HTTP/1.1 200 OK` for the bundled renderer script.

## Short version

If a future Copilot instance needs to start this app:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 16
npm install -g yarn
cd /Users/ericthornton/repos/poker_timer
yarn install --frozen-lockfile --non-interactive
yarn cross-env NODE_ENV=development webpack --config ./.erb/configs/webpack.config.renderer.dev.dll.babel.js
mkdir -p /tmp/noop-npm
printf '%s\n' '#!/bin/sh' 'sleep 100000' > /tmp/noop-npm/npm
chmod +x /tmp/noop-npm/npm
PATH="/tmp/noop-npm:$PATH" yarn start:renderer
# then in a second terminal:
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 16
cd /Users/ericthornton/repos/poker_timer
env -u ELECTRON_RUN_AS_NODE yarn start:main
```

## Important note

- Do not use the default `yarn start` flow for this repo in the current environment unless the startup blockers are resolved.
- The no-op npm shim is required to prevent the renderer spawn hook from killing the dev server during this repo’s older Electron/webpack startup sequence.
- Any time a commit is made, record any new repo-specific learnings or setup discoveries in this file so future Copilot sessions inherit the updated knowledge.
- Give the Start/Pause clock toggle a fixed width (`.ClockToggle`) because its changing label otherwise shifts the clock button row.
