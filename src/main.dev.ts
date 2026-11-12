/* eslint global-require: off, no-console: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `yarn build` or `yarn build:main`, this file is compiled to
 * `./src/main.prod.js` using webpack. This gives us some performance wins.
 */
import 'core-js/stable';
import 'regenerator-runtime/runtime';
import fs from 'fs';
import path from 'path';
import { app, BrowserWindow, ipcMain, powerSaveBlocker, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import MenuBuilder from './menu';

app.setName('DeadmoneyShootout');

export default class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();
  }
}

let mainWindow: BrowserWindow | null = null;

const getPlayersFilePath = () =>
  app.isPackaged
    ? path.join(app.getPath('userData'), 'players.txt')
    : path.resolve(__dirname, '../resource/players.txt');

const isPlayerNames = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every(
    (name: unknown) => typeof name === 'string' && name.trim() !== ''
  );

type BlindLevel = {
  round: string;
  sb: string;
  lb: string;
  ante: string;
  duration: string;
};

type BlindStructure = {
  name: string;
  levels: BlindLevel[];
};

const blindStructuresPath = () =>
  path.join(app.getPath('userData'), 'blind-structures.json');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isValidBlindStructure = (value: unknown): value is BlindStructure => {
  if (!isRecord(value)) {
    return false;
  }

  const { name, levels } = value;
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > 60 ||
    Array.from(name).some(
      (character) =>
        character === '/' ||
        character === '\\' ||
        character.charCodeAt(0) < 32 ||
        character.charCodeAt(0) === 127
    ) ||
    !Array.isArray(levels) ||
    levels.length === 0 ||
    levels.length > 100
  ) {
    return false;
  }

  return levels.every((level: unknown, index: number) => {
    if (!isRecord(level)) return false;
    const { round, sb, lb, ante, duration } = level;
    return (
      typeof round === 'string' &&
      round === String(index + 1) &&
      typeof sb === 'string' &&
      /^\d+$/.test(sb) &&
      typeof lb === 'string' &&
      /^\d+$/.test(lb) &&
      typeof ante === 'string' &&
      (ante === '-' || /^\d+$/.test(ante)) &&
      typeof duration === 'string' &&
      (duration === '*'
        ? index === levels.length - 1
        : /^\d+$/.test(duration) && Number(duration) > 0)
    );
  });
};

const readBlindStructures = async (): Promise<BlindStructure[]> => {
  let contents: string;
  try {
    contents = await fs.promises.readFile(blindStructuresPath(), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const parsedStructures: unknown = JSON.parse(contents);
  if (!Array.isArray(parsedStructures)) {
    throw new Error('Saved blind structures have an invalid format.');
  }

  const savedStructures: BlindStructure[] = [];
  parsedStructures.forEach((value: unknown) => {
    if (!isValidBlindStructure(value)) {
      throw new Error('Saved blind structures have an invalid format.');
    }
    if (
      savedStructures.some(
        (saved) => saved.name.toLowerCase() === value.name.toLowerCase()
      )
    ) {
      throw new Error('Saved blind structures have duplicate names.');
    }
    savedStructures.push(value);
  });
  return savedStructures;
};

ipcMain.handle('players:load', async () => {
  try {
    return await fs.promises.readFile(getPlayersFilePath(), 'utf8');
  } catch (error) {
    if (app.isPackaged && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
});

ipcMain.handle('players:save', async (_event, playerNames: unknown) => {
  if (!isPlayerNames(playerNames)) {
    throw new Error('Player names must be a list of non-empty strings.');
  }

  await fs.promises.writeFile(
    getPlayersFilePath(),
    playerNames.map((name) => name.trim()).join('\n'),
    'utf8'
  );
});

ipcMain.handle('blinds:load', async () => readBlindStructures());

ipcMain.handle('blinds:save', async (_event, structure: unknown) => {
  if (!isValidBlindStructure(structure)) {
    throw new Error('Blind structure name or levels are invalid.');
  }

  const savedStructures = await readBlindStructures();
  if (
    [...savedStructures].some(
      (saved) =>
        saved.name.toLowerCase() === structure.name.trim().toLowerCase()
    )
  ) {
    throw new Error('A blind structure with that name already exists.');
  }

  const updatedStructures = [
    ...savedStructures,
    { ...structure, name: structure.name.trim() },
  ];
  await fs.promises.mkdir(path.dirname(blindStructuresPath()), {
    recursive: true,
  });
  await fs.promises.writeFile(
    blindStructuresPath(),
    JSON.stringify(updatedStructures, null, 2),
    'utf8'
  );
  return updatedStructures[updatedStructures.length - 1];
});

ipcMain.handle('blinds:delete', async (_event, structureName: unknown) => {
  if (typeof structureName !== 'string' || !structureName.trim()) {
    throw new Error('A blind structure name is required.');
  }

  const savedStructures = await readBlindStructures();
  const updatedStructures = savedStructures.filter(
    (structure) => structure.name !== structureName
  );
  if (updatedStructures.length === savedStructures.length) {
    throw new Error('The custom blind structure was not found.');
  }

  await fs.promises.writeFile(
    blindStructuresPath(),
    JSON.stringify(updatedStructures, null, 2),
    'utf8'
  );
  return updatedStructures;
});

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

if (
  process.env.NODE_ENV === 'development' ||
  process.env.DEBUG_PROD === 'true'
) {
  require('electron-debug')();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload
    )
    .catch(console.log);
};

const createWindow = async () => {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.DEBUG_PROD === 'true'
  ) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    icon: getAssetPath('DeadmoneyShootout.png'),
    webPreferences: {
      nodeIntegration: true,
    },
  });

  mainWindow.loadURL(`file://${__dirname}/index.html`);

  // @TODO: Use 'ready-to-show' event
  //        https://github.com/electron/electron/blob/master/docs/api/browser-window.md#using-ready-to-show-event
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Keep the display awake while the clock is up (macOS and Windows)
  const sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');

  mainWindow.on('closed', () => {
    powerSaveBlocker.stop(sleepBlockerId);
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.on('new-window', (event, url) => {
    event.preventDefault();
    shell.openExternal(url);
  });

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  new AppUpdater();
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  app.quit();
});

app.whenReady().then(createWindow).catch(console.log);

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) createWindow();
});
