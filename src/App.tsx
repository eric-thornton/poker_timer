import React, { useEffect, useRef, useState } from 'react';
import { BrowserRouter as Router, Switch, Route } from 'react-router-dom';
import { ipcRenderer } from 'electron';
import playersData from '../resource/players.txt';
import payoutsData from '../resource/payouts.unl';
import getNextBuyinCount from './buyinCount';
import {
  adjustBountyCount,
  calculateBuyinCost,
  calculateChipValue,
  calculateTotalBuyinCost,
  calculateTotalChipValue,
} from './buyinCost';
import './App.global.css';

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

const parseBlinds = (text: string): BlindLevel[] =>
  text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [round, sb, lb, ante, duration] = line.trim().split('|');
      return { round, sb, lb, ante, duration };
    });

const validateBlindStructure = (
  name: string,
  levels: BlindLevel[],
  existingNames: string[]
) => {
  const trimmedName = name.trim();
  if (!trimmedName) return 'Enter a name for the blind structure.';
  if (
    trimmedName.length > 60 ||
    Array.from(trimmedName).some(
      (character) =>
        character === '/' ||
        character === '\\' ||
        character.charCodeAt(0) < 32 ||
        character.charCodeAt(0) === 127
    )
  ) {
    return 'Use a name up to 60 characters without slashes or control characters.';
  }
  if (
    existingNames.some(
      (existingName) => existingName.toLowerCase() === trimmedName.toLowerCase()
    )
  ) {
    return 'A structure with that name already exists.';
  }
  if (levels.length === 0) return 'Add at least one level.';
  if (levels.length > 100) return 'A structure can have at most 100 levels.';

  for (let i = 0; i < levels.length; i += 1) {
    const level = levels[i];
    if (level.round !== String(i + 1)) {
      return 'Round numbers must be sequential, starting at 1.';
    }
    if (!/^\d+$/.test(level.sb) || !/^\d+$/.test(level.lb)) {
      return `Round ${i + 1}: SB and BB must be whole numbers.`;
    }
    if (level.ante !== '-' && !/^\d+$/.test(level.ante)) {
      return `Round ${i + 1}: Ante must be a whole number or "-".`;
    }
    if (level.duration !== '*' && !/^\d+$/.test(level.duration)) {
      return `Round ${i + 1}: Duration must be whole minutes or "*".`;
    }
    if (level.duration === '*' && i !== levels.length - 1) {
      return 'Only the last level can have an unlimited duration ("*").';
    }
    if (level.duration !== '*' && Number(level.duration) < 1) {
      return `Round ${i + 1}: Duration must be at least one minute.`;
    }
  }

  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isBlindStructure = (value: unknown): value is BlindStructure =>
  isRecord(value) &&
  typeof value.name === 'string' &&
  Array.isArray(value.levels) &&
  value.levels.every(
    (level: unknown) =>
      isRecord(level) &&
      typeof level.round === 'string' &&
      typeof level.sb === 'string' &&
      typeof level.lb === 'string' &&
      typeof level.ante === 'string' &&
      typeof level.duration === 'string'
  );

// A level's Duration is in minutes; '*' (the last level) has no fixed length
const durationSeconds = (level: { duration: string }) => {
  const minutes = Number(level.duration);
  return Number.isFinite(minutes) ? minutes * 60 : null;
};

const formatClock = (seconds: number | null) => {
  if (seconds === null) return '--:--';
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

// Every resource/hh:mm.blinds file is a selectable structure, shortest game first
const blindFiles = require.context('../resource', false, /\.blinds$/);
const structureMinutes = (name: string) => {
  const match = name.match(/(?:^|[- ])(\d+):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Infinity;
};
const compareStructures = (a: BlindStructure, b: BlindStructure) =>
  structureMinutes(a.name) - structureMinutes(b.name) ||
  a.name.localeCompare(b.name);
const bundledStructures: BlindStructure[] = blindFiles
  .keys()
  .map((key) => {
    const content = blindFiles(key);
    return {
      name: key.replace(/^\.\//, '').replace(/\.blinds$/, ''),
      levels: parseBlinds(
        typeof content === 'string' ? content : content.default
      ),
    };
  })
  .sort(compareStructures);

const DEFAULT_STRUCTURE = '2:51';
const INITIAL_STRUCTURE_NAME = (
  bundledStructures.find((s) => s.name === DEFAULT_STRUCTURE) ||
  bundledStructures[0]
).name;
const DEFAULT_COPY_STRUCTURE = 'template';
const INITIAL_COPY_STRUCTURE = bundledStructures.some(
  (structure) => structure.name === DEFAULT_COPY_STRUCTURE
)
  ? `bundled:${DEFAULT_COPY_STRUCTURE}`
  : `bundled:${INITIAL_STRUCTURE_NAME}`;

const initialPlayers = playersData
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '')
  .sort((a, b) => a.localeCompare(b));

const parsePlayers = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .sort((a, b) => a.localeCompare(b));

// Every resource/*.wav file is a selectable sound (shown without the extension)
const soundContext = require.context('../resource', false, /\.wav$/);
const sounds: Record<string, string> = {};
soundContext.keys().forEach((key) => {
  const mod = soundContext(key);
  sounds[key.replace(/^\.\//, '').replace(/\.wav$/, '')] =
    typeof mod === 'string' ? mod : mod.default;
});
const SOUND_OPTIONS = ['None', ...Object.keys(sounds).sort()];

const playSound = (name: string) => {
  if (sounds[name]) new Audio(sounds[name]).play().catch(() => {});
};

// starting choices, used only if the file is there
const defaultSound = (name: string) => (sounds[name] ? name : SOUND_OPTIONS[0]);

type SoundControlProps = {
  id: string;
  label: string;
  sound: string;
  onChange: (sound: string) => void;
};

const SoundControl = ({ id, label, sound, onChange }: SoundControlProps) => (
  <label htmlFor={id}>
    {label}:
    <select
      id={id}
      className="SoundSelect"
      aria-label={`${label} sound`}
      value={sound}
      onChange={(e) => onChange(e.target.value)}
    >
      {SOUND_OPTIONS.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
    <button
      type="button"
      className="SoundPlay"
      aria-label={`Play ${label.toLowerCase()} sound`}
      title="Play"
      onClick={() => playSound(sound)}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 9v6h4l5 4V5L7 9H3z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        <path d="M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
    </button>
  </label>
);

const DEFAULT_BUYIN_CHIP_VALUE = 1500;
const DEFAULT_REBUY_CHIP_VALUE = 1000;
const DEFAULT_BUYIN_COST = 10;
const DEFAULT_REBUY_COST = 10;
const BUYIN_LIMITS = [2, 3, 4];

// Each line: pot|1st %|2nd %|3rd %|4th % ('-' when that place is not paid)
const payoutTable = payoutsData
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => {
    const [pot, ...places] = line.trim().split('|');
    return {
      pot: Number(pot),
      percents: places.filter((p) => p !== '-').map(Number),
    };
  });

const PLACE_NAMES = ['First', 'Second', 'Third', 'Fourth'];

const formatDollars = (amount: number) => `$${amount.toFixed(2)}`;
const formatCost = (amount: number) => `$${amount.toLocaleString('en-US')}`;

const getStoredInteger = (key: string, defaultValue: number) => {
  const value = window.localStorage.getItem(key);
  return value !== null &&
    /^\d+$/.test(value) &&
    Number.isSafeInteger(Number(value))
    ? value
    : String(defaultValue);
};

const updateIntegerSetting = (
  key: string,
  value: string,
  setValue: (value: string) => void
) => {
  if (
    !/^\d*$/.test(value) ||
    (value !== '' && !Number.isSafeInteger(Number(value)))
  ) {
    return;
  }
  setValue(value);
  if (value === '') {
    window.localStorage.removeItem(key);
  } else {
    window.localStorage.setItem(key, value);
  }
};

// total number of buyins, counting only the players in the current game
const countBuyins = (counts: number[], playing: boolean[]) =>
  counts.reduce((sum, c, i) => (playing[i] ? sum + c : sum), 0);

type BuyinsProps = {
  players: string[];
  counts: number[];
  playing: boolean[];
  maxBuyins: number;
  wrapBuyins: boolean;
  buyInCost: number;
  rebuyCost: number;
  buyInChipValue: number;
  rebuyChipValue: number;
  showChipValue: boolean;
  bounties: number[];
  showBounties: boolean;
  subtractBounties: boolean;
  setCounts: (counts: number[]) => void;
  setBounties: (bounties: number[]) => void;
};

const Buyins = ({
  players,
  counts,
  playing,
  maxBuyins,
  wrapBuyins,
  buyInCost,
  rebuyCost,
  buyInChipValue,
  rebuyChipValue,
  showChipValue,
  bounties,
  showBounties,
  subtractBounties,
  setCounts,
  setBounties,
}: BuyinsProps) => {
  const setCount = (index: number, count: number) =>
    setCounts(counts.map((c, i) => (i === index ? count : c)));
  const adjustBounty = (index: number) =>
    setBounties(
      bounties.map((bounty, i) =>
        i === index ? adjustBountyCount(bounty, subtractBounties) : bounty
      )
    );

  const totalCount = countBuyins(counts, playing);
  const totalBounties = bounties.reduce(
    (total, bounty, index) => (playing[index] ? total + bounty : total),
    0
  );
  const totalCost = calculateTotalBuyinCost(
    counts,
    playing,
    buyInCost,
    rebuyCost
  );
  const totalChipValue = calculateTotalChipValue(
    counts,
    playing,
    buyInChipValue,
    rebuyChipValue
  );
  const tableClassName = [
    'Buyins',
    showChipValue && 'BuyinsWithChipValue',
    showBounties && 'BuyinsWithBounties',
    showChipValue && showBounties && 'BuyinsWithBothExtras',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="BuyinsTable">
      <table className={`${tableClassName} BuyinsHeader`}>
        <colgroup>
          <col className="BuyinsNameColumn" />
          <col className="BuyinsCountColumn" />
          <col className="BuyinsCostColumn" />
          {showChipValue && <col className="BuyinsChipValueColumn" />}
          {showBounties && <col className="BuyinsBountiesColumn" />}
        </colgroup>
        <thead>
          <tr>
            <th>Name</th>
            <th>Count</th>
            <th>Cost</th>
            {showChipValue && (
              <th>
                Chip
                <br />
                Value
              </th>
            )}
            {showBounties && <th className="BuyinsBountiesHeader">Bounty</th>}
          </tr>
        </thead>
      </table>
      <div className="BuyinsScroll">
        <table className={tableClassName}>
          <colgroup>
            <col className="BuyinsNameColumn" />
            <col className="BuyinsCountColumn" />
            <col className="BuyinsCostColumn" />
            {showChipValue && <col className="BuyinsChipValueColumn" />}
            {showBounties && <col className="BuyinsBountiesColumn" />}
          </colgroup>
          <tbody>
            {players.map(
              (name, i) =>
                playing[i] && (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>
                      {counts[i]}
                      <button
                        type="button"
                        className="BuyinButton"
                        aria-label={`Add buy-in for ${name}`}
                        onClick={() =>
                          setCount(
                            i,
                            getNextBuyinCount(counts[i], maxBuyins, wrapBuyins)
                          )
                        }
                      >
                        +
                      </button>
                    </td>
                    <td>
                      {formatCost(
                        calculateBuyinCost(counts[i], buyInCost, rebuyCost)
                      )}
                    </td>
                    {showChipValue && (
                      <td>
                        {calculateChipValue(
                          counts[i],
                          buyInChipValue,
                          rebuyChipValue
                        ).toLocaleString('en-US')}
                      </td>
                    )}
                    {showBounties && (
                      <td>
                        {bounties[i]}
                        <button
                          type="button"
                          className="BuyinButton"
                          aria-label={`${
                            subtractBounties ? 'Subtract' : 'Add'
                          } bounty for ${name}`}
                          onClick={() => adjustBounty(i)}
                        >
                          {subtractBounties ? '-' : '+'}
                        </button>
                      </td>
                    )}
                  </tr>
                )
            )}
          </tbody>
        </table>
      </div>
      <table className={`${tableClassName} BuyinsFooter`}>
        <colgroup>
          <col className="BuyinsNameColumn" />
          <col className="BuyinsCountColumn" />
          <col className="BuyinsCostColumn" />
          {showChipValue && <col className="BuyinsChipValueColumn" />}
          {showBounties && <col className="BuyinsBountiesColumn" />}
        </colgroup>
        <tfoot>
          <tr>
            <td>Total</td>
            <td>{totalCount}</td>
            <td>{formatCost(totalCost)}</td>
            {showChipValue && <td>{totalChipValue.toLocaleString('en-US')}</td>}
            {showBounties && <td>{totalBounties}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

type PlayerSelectionProps = {
  players: string[];
  playing: boolean[];
  setPlaying: (playing: boolean[]) => void;
  playerName: string;
  setPlayerName: (name: string) => void;
  playersReady: boolean;
  savingPlayers: boolean;
  playersError: string;
  onAddPlayer: () => void;
  onDeletePlayer: () => void;
};

const PlayerSelection = ({
  players,
  playing,
  setPlaying,
  playerName,
  setPlayerName,
  playersReady,
  savingPlayers,
  playersError,
  onAddPlayer,
  onDeletePlayer,
}: PlayerSelectionProps) => (
  <div className="PlayerSelectionView">
    <ul className="PlayerSelection">
      {players.map((name, i) => (
        <li key={name}>
          <label htmlFor={`player-${i}`}>
            <input
              id={`player-${i}`}
              type="checkbox"
              checked={playing[i]}
              disabled={!playersReady || savingPlayers}
              onChange={() =>
                setPlaying(playing.map((p, j) => (j === i ? !p : p)))
              }
            />
            {name}
          </label>
        </li>
      ))}
    </ul>
    <form
      className="PlayerEditor"
      onSubmit={(event) => {
        event.preventDefault();
        onAddPlayer();
      }}
    >
      <label htmlFor="player-name">
        Player name
        <input
          id="player-name"
          type="text"
          value={playerName}
          disabled={!playersReady || savingPlayers}
          onChange={(event) => setPlayerName(event.target.value)}
        />
      </label>
      <div className="PlayerEditorButtons">
        <button type="submit" disabled={!playersReady || savingPlayers}>
          Add
        </button>
        <button
          type="button"
          disabled={!playersReady || savingPlayers}
          onClick={onDeletePlayer}
        >
          Delete
        </button>
      </div>
      {playersError && (
        <div className="PlayerEditorError" role="alert">
          {playersError}
        </div>
      )}
    </form>
  </div>
);

type PayoutsProps = {
  pot: number;
};

const Payouts = ({ pot }: PayoutsProps) => {
  // use the row for this pot, or the closest smaller one (the first if smaller than all)
  const row =
    [...payoutTable].reverse().find((r) => r.pot <= pot) || payoutTable[0];

  return (
    <table className="Payouts">
      <thead>
        <tr>
          <th>Place</th>
          <th>%</th>
          <th>Payout</th>
        </tr>
      </thead>
      <tbody>
        {row.percents.map((percent, i) => (
          <tr key={PLACE_NAMES[i]}>
            <td>{PLACE_NAMES[i]}</td>
            <td>{percent}%</td>
            <td>{formatDollars((pot * percent) / 100)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const Hello = () => {
  const [userStructures, setUserStructures] = useState<BlindStructure[]>([]);
  const [blindStructuresReady, setBlindStructuresReady] = useState(false);
  const [blindStructuresError, setBlindStructuresError] = useState('');
  const [savingBlindStructure, setSavingBlindStructure] = useState(false);
  const [copyFromName, setCopyFromName] = useState(INITIAL_COPY_STRUCTURE);
  const [confirmingBlindDelete, setConfirmingBlindDelete] = useState(false);
  const [editorName, setEditorName] = useState('');
  const [editorLevels, setEditorLevels] = useState<BlindLevel[]>([]);
  const [editorError, setEditorError] = useState('');
  const [players, setPlayers] = useState(initialPlayers);
  const [counts, setCounts] = useState<number[]>(initialPlayers.map(() => 1));
  const [bounties, setBounties] = useState<number[]>(
    initialPlayers.map(() => 0)
  );
  const [playing, setPlaying] = useState<boolean[]>(
    initialPlayers.map(() => true)
  );
  const [playerName, setPlayerName] = useState('');
  const [playersReady, setPlayersReady] = useState(false);
  const [savingPlayers, setSavingPlayers] = useState(false);
  const [playersError, setPlayersError] = useState('');
  const [view, setView] = useState<'buyins' | 'players'>(() =>
    window.localStorage.getItem('rightView') === 'players'
      ? 'players'
      : 'buyins'
  );
  const [centerView, setCenterView] = useState<'clock' | 'settings'>('clock');
  const [appTitle, setAppTitle] = useState(
    () => window.localStorage.getItem('appTitle') ?? 'Deadmoney Shootout'
  );
  const [buyInChipValue, setBuyInChipValue] = useState(() =>
    getStoredInteger('buyInCost', DEFAULT_BUYIN_CHIP_VALUE)
  );
  const [rebuyChipValue, setRebuyChipValue] = useState(() =>
    getStoredInteger('rebuyCost', DEFAULT_REBUY_CHIP_VALUE)
  );
  const [buyInCost, setBuyInCost] = useState(() =>
    getStoredInteger('buyInPrice', DEFAULT_BUYIN_COST)
  );
  const [rebuyCost, setRebuyCost] = useState(() =>
    getStoredInteger('rebuyPrice', DEFAULT_REBUY_COST)
  );
  const [chipValueInfoSelected, setChipValueInfoSelected] = useState(false);
  const [bountiesInfoSelected, setBountiesInfoSelected] = useState(false);
  const [subtractBounties, setSubtractBounties] = useState(false);
  const [maxBuyins, setMaxBuyins] = useState(BUYIN_LIMITS[0]);
  const [wrapBuyins, setWrapBuyins] = useState(false);
  const [clockRunning, setClockRunning] = useState(false);
  const [roundIndex, setRoundIndex] = useState(0);
  const [attentionSound, setAttentionSound] = useState(defaultSound('attn'));
  const [warningSound, setWarningSound] = useState(defaultSound('oneminute'));
  const [endSound, setEndSound] = useState(defaultSound('cow'));

  useEffect(() => {
    if (clockRunning || attentionSound === SOUND_OPTIONS[0]) {
      return undefined;
    }

    const intervalId = window.setInterval(
      () => playSound(attentionSound),
      15000
    );
    return () => window.clearInterval(intervalId);
  }, [clockRunning, attentionSound]);

  const chooseView = (nextView: 'buyins' | 'players') => {
    window.localStorage.setItem('rightView', nextView);
    setView(nextView);
  };

  const chooseAppTitle = (nextTitle: string) => {
    window.localStorage.setItem('appTitle', nextTitle);
    setAppTitle(nextTitle);
  };

  useEffect(() => {
    let active = true;
    ipcRenderer
      .invoke('players:load')
      .then((savedPlayers: string | null) => {
        if (!active) return null;
        const loadedPlayers =
          savedPlayers === null ? initialPlayers : parsePlayers(savedPlayers);
        setPlayers(loadedPlayers);
        setCounts(loadedPlayers.map(() => 1));
        setBounties(loadedPlayers.map(() => 0));
        setPlaying(loadedPlayers.map(() => true));
        setPlayersReady(true);
        return null;
      })
      .catch((error: Error) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : String(error);
        setPlayersError(`Unable to load players: ${message}`);
        setPlayersReady(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    ipcRenderer
      .invoke('blinds:load')
      .then((savedStructures: unknown) => {
        if (!active) return null;
        if (
          !Array.isArray(savedStructures) ||
          !savedStructures.every(isBlindStructure)
        ) {
          throw new Error('Saved blind structures have an invalid format.');
        }
        setUserStructures(savedStructures);
        setBlindStructuresReady(true);
        return null;
      })
      .catch((error: Error) => {
        if (!active) return null;
        const message = error instanceof Error ? error.message : String(error);
        setBlindStructuresError(`Unable to load custom structures: ${message}`);
        setBlindStructuresReady(true);
        return null;
      });

    return () => {
      active = false;
    };
  }, []);

  // The space bar toggles Start/Pause from anywhere. Inputs and the drop-down keep
  // their own space behavior; a focused button must not also be clicked by it.
  useEffect(() => {
    const isFormControl = (target: EventTarget | null) =>
      ['INPUT', 'SELECT', 'TEXTAREA'].includes((target as HTMLElement).tagName);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isFormControl(e.target)) return;
      e.preventDefault();
      setClockRunning((running) => !running);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isFormControl(e.target)) e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);
  const [structureName, setStructureName] = useState(INITIAL_STRUCTURE_NAME);
  const bundledNames = new Set(
    bundledStructures.map((structure) => structure.name.toLowerCase())
  );
  const structures = [
    ...bundledStructures,
    ...userStructures.filter(
      (structure) => !bundledNames.has(structure.name.toLowerCase())
    ),
  ].sort(compareStructures);
  const copySources = [
    ...bundledStructures.map((structure) => ({
      ...structure,
      sourceId: `bundled:${structure.name}`,
      isCustom: false,
    })),
    ...userStructures.map((structure) => ({
      ...structure,
      sourceId: `custom:${structure.name}`,
      isCustom: true,
    })),
  ].sort(compareStructures);
  const selectedCopySource = copySources.find(
    (source) => source.sourceId === copyFromName
  );
  const selectedStructure =
    structures.find((s) => s.name === structureName) || structures[0];
  const blinds = selectedStructure.levels;
  // '-' means no ante; hide the Ante column when no level pays one
  const hasAntes = blinds.some((b) => b.ante !== '-');

  // Clock: counts down the current round's Duration, then rolls into the next round
  const [secondsLeft, setSecondsLeft] = useState(
    durationSeconds(blinds[roundIndex])
  );
  // when the running clock hits zero (Infinity = not counting)
  const endTimeRef = useRef(Number.POSITIVE_INFINITY);
  const tickRef = useRef(() => {});
  // the whole seconds shown on the previous tick, to spot the clock crossing 01:00
  const lastRemainingRef = useRef(0);

  tickRef.current = () => {
    if (!Number.isFinite(endTimeRef.current)) return;
    const remaining = Math.ceil((endTimeRef.current - Date.now()) / 1000);
    if (remaining > 0) {
      // Warning sound as the clock counts down to 01:00
      if (remaining === 60 && lastRemainingRef.current > 60) {
        playSound(warningSound);
      }
      lastRemainingRef.current = remaining;
      setSecondsLeft(remaining);
      return;
    }
    // End sound at 00:00
    playSound(endSound);
    if (roundIndex < blinds.length - 1) {
      // hold the clock until the next round's Duration is loaded below
      endTimeRef.current = Number.POSITIVE_INFINITY;
      setRoundIndex(roundIndex + 1);
    } else {
      setSecondsLeft(0);
      setClockRunning(false);
    }
  };

  // a new round (or structure) resets the clock to that round's Duration
  useEffect(() => {
    const seconds = durationSeconds(blinds[roundIndex]);
    setSecondsLeft(seconds);
    lastRemainingRef.current = seconds === null ? 0 : seconds;
    endTimeRef.current =
      clockRunning && seconds !== null
        ? Date.now() + seconds * 1000
        : Number.POSITIVE_INFINITY;
  }, [structureName, roundIndex]);

  // Start/Pause: tick from the saved time so pausing and resuming keeps what is left
  useEffect(() => {
    if (!clockRunning) return undefined;
    lastRemainingRef.current = secondsLeft === null ? 0 : secondsLeft;
    endTimeRef.current =
      secondsLeft !== null
        ? Date.now() + secondsLeft * 1000
        : Number.POSITIVE_INFINITY;
    const id = setInterval(() => tickRef.current(), 200);
    return () => clearInterval(id);
  }, [clockRunning]);

  // lowering the limit trims any count that is now over it
  const chooseMaxBuyins = (limit: number) => {
    setMaxBuyins(limit);
    setCounts(counts.map((c) => Math.min(c, limit)));
  };
  const savePlayers = async (
    updatedPlayers: string[],
    updatedCounts: number[],
    updatedBounties: number[],
    updatedPlaying: boolean[]
  ) => {
    setSavingPlayers(true);
    setPlayersError('');
    try {
      await ipcRenderer.invoke('players:save', updatedPlayers);
      setPlayers(updatedPlayers);
      setCounts(updatedCounts);
      setBounties(updatedBounties);
      setPlaying(updatedPlaying);
      setPlayerName('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPlayersError(`Unable to save players: ${message}`);
    } finally {
      setSavingPlayers(false);
    }
  };
  const addPlayer = async () => {
    const name = playerName.trim();
    if (!name) {
      setPlayersError('Enter a player name to add.');
      return;
    }
    if (players.some((player) => player.toLowerCase() === name.toLowerCase())) {
      setPlayersError(`${name} is already in the player list.`);
      return;
    }
    const updatedPlayers = [...players, name].sort((a, b) =>
      a.localeCompare(b)
    );
    const addedIndex = updatedPlayers.indexOf(name);
    const updatedCounts = [...counts];
    updatedCounts.splice(addedIndex, 0, 1);
    const updatedBounties = [...bounties];
    updatedBounties.splice(addedIndex, 0, 0);
    const updatedPlaying = [...playing];
    updatedPlaying.splice(addedIndex, 0, true);
    await savePlayers(
      updatedPlayers,
      updatedCounts,
      updatedBounties,
      updatedPlaying
    );
  };
  const deletePlayer = async () => {
    const name = playerName.trim();
    if (!name) {
      setPlayersError('Enter a player name to delete.');
      return;
    }
    const index = players.findIndex(
      (player) => player.toLowerCase() === name.toLowerCase()
    );
    if (index === -1) {
      setPlayersError(`${name} was not found.`);
      return;
    }
    const updatedPlayers = players.filter((_, i) => i !== index);
    const updatedCounts = counts.filter((_, i) => i !== index);
    const updatedBounties = bounties.filter((_, i) => i !== index);
    const updatedPlaying = playing.filter((_, i) => i !== index);
    await savePlayers(
      updatedPlayers,
      updatedCounts,
      updatedBounties,
      updatedPlaying
    );
  };
  const loadStructureCopy = () => {
    const source = selectedCopySource;
    if (!source) {
      setEditorError('Choose a structure to copy.');
      return;
    }
    setEditorName(`${source.name} copy`);
    setEditorLevels(source.levels.map((level) => ({ ...level })));
    setEditorError('');
    setConfirmingBlindDelete(false);
  };
  const updateEditorLevel = (
    index: number,
    field: Exclude<keyof BlindLevel, 'round'>,
    value: string
  ) => {
    setEditorLevels(
      editorLevels.map((level, i) =>
        i === index ? { ...level, [field]: value } : level
      )
    );
    setEditorError('');
  };
  const addEditorLevel = () => {
    setEditorLevels([
      ...editorLevels,
      {
        round: String(editorLevels.length + 1),
        sb: '',
        lb: '',
        ante: '-',
        duration: '10',
      },
    ]);
    setEditorError('');
  };
  const removeEditorLevel = (index: number) => {
    setEditorLevels(
      editorLevels
        .filter((_, i) => i !== index)
        .map((level, i) => ({ ...level, round: String(i + 1) }))
    );
    setEditorError('');
  };
  const saveBlindStructure = async () => {
    const validationError = validateBlindStructure(
      editorName,
      editorLevels,
      structures.map((structure) => structure.name)
    );
    if (validationError) {
      setEditorError(validationError);
      return;
    }

    setSavingBlindStructure(true);
    setEditorError('');
    try {
      const savedStructure: unknown = await ipcRenderer.invoke('blinds:save', {
        name: editorName.trim(),
        levels: editorLevels,
      });
      if (!isBlindStructure(savedStructure)) {
        throw new Error('The saved blind structure has an invalid format.');
      }
      setUserStructures([...userStructures, savedStructure]);
      setStructureName(savedStructure.name);
      setRoundIndex(0);
      setClockRunning(false);
      setBlindStructuresError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEditorError(`Unable to save blind structure: ${message}`);
    } finally {
      setSavingBlindStructure(false);
    }
  };
  const deleteBlindStructure = async () => {
    if (!selectedCopySource?.isCustom) return;
    const structure = selectedCopySource;

    setSavingBlindStructure(true);
    setEditorError('');
    try {
      const updatedStructures: unknown = await ipcRenderer.invoke(
        'blinds:delete',
        structure.name
      );
      if (
        !Array.isArray(updatedStructures) ||
        !updatedStructures.every(isBlindStructure)
      ) {
        throw new Error('The saved blind structures have an invalid format.');
      }
      setUserStructures(updatedStructures);
      setEditorName('');
      setEditorLevels([]);
      setConfirmingBlindDelete(false);
      setCopyFromName(INITIAL_COPY_STRUCTURE);
      setBlindStructuresError('');
      if (structureName === structure.name) {
        setStructureName(INITIAL_STRUCTURE_NAME);
        setRoundIndex(0);
        setClockRunning(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEditorError(`Unable to delete blind structure: ${message}`);
    } finally {
      setSavingBlindStructure(false);
    }
  };
  const numericBuyInCost = Number(buyInCost);
  const numericRebuyCost = Number(rebuyCost);
  const numericBuyInChipValue = Number(buyInChipValue);
  const numericRebuyChipValue = Number(rebuyChipValue);
  const pot = calculateTotalBuyinCost(
    counts,
    playing,
    numericBuyInCost,
    numericRebuyCost
  );

  return (
    <div className="Layout">
      <div className="Columns">
        <section className="Column BottomColumn">
          <div className="ColumnContent">
            <h2>Structure</h2>
            <select
              className="StructureSelect"
              aria-label="Structure"
              value={structureName}
              onChange={(e) => {
                setStructureName(e.target.value);
                setRoundIndex(0);
                setClockRunning(false);
              }}
            >
              {structures.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
            <table className="Structure">
              <thead>
                <tr>
                  <th>Round</th>
                  <th>SB</th>
                  <th>BB</th>
                  {hasAntes && <th>Ante</th>}
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {blinds.map((b, i) => (
                  <tr
                    key={b.round}
                    className={i === roundIndex ? 'CurrentRound' : undefined}
                  >
                    <td>{b.round}</td>
                    <td>{b.sb}</td>
                    <td>{b.lb}</td>
                    {hasAntes && <td>{b.ante}</td>}
                    <td>{b.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h2>Payouts</h2>
            <Payouts pot={pot} />
          </div>
          <div
            className="CenterViewSwitch"
            role="radiogroup"
            aria-label="Center view"
          >
            <label htmlFor="center-view-clock">
              <input
                id="center-view-clock"
                type="radio"
                name="centerView"
                checked={centerView === 'clock'}
                onChange={() => setCenterView('clock')}
              />
              Clock
            </label>
            <label htmlFor="center-view-settings">
              <input
                id="center-view-settings"
                type="radio"
                name="centerView"
                checked={centerView === 'settings'}
                onChange={() => setCenterView('settings')}
              />
              Settings
            </label>
          </div>
        </section>
        <section className="Column BottomColumn">
          <div
            className={`ColumnContent ${
              centerView === 'clock'
                ? 'ClockColumnContent'
                : 'SettingsColumnContent'
            }`}
          >
            <h1 className="Title">{appTitle}</h1>
            {centerView === 'clock' ? (
              <>
                <div className="ClockDisplay">{formatClock(secondsLeft)}</div>
                {/* hidden, not removed, while running so the blinds below do not jump */}
                <div
                  className={
                    clockRunning ? 'ClockPaused Invisible' : 'ClockPaused'
                  }
                  aria-hidden={clockRunning}
                >
                  CLOCK PAUSED
                </div>
                {/* labels are right-aligned so the colons line up */}
                <div className="BlindsLine">
                  <div className="BlindsLabel">Curr:</div>
                  <div className="BlindsValue BlindsCurrentValue">
                    {blinds[roundIndex].sb}/{blinds[roundIndex].lb}
                  </div>
                  <div className="BlindsLabel">Next:</div>
                  <div className="BlindsValue BlindsNextValue">
                    {roundIndex < blinds.length - 1
                      ? `${blinds[roundIndex + 1].sb}/${
                          blinds[roundIndex + 1].lb
                        }`
                      : '-'}
                  </div>
                </div>
              </>
            ) : (
              <>
                <h2 className="SettingsHeader">Settings</h2>
                <div className="SettingsDisplay">
                  <div className="SettingsTopGrid">
                    <div className="SettingsLeftColumn">
                      <section className="TitleSetting">
                        <div className="TitleSettingContent">
                          <label htmlFor="app-title">
                            Edit Page Title
                            <textarea
                              id="app-title"
                              rows={2}
                              aria-label="Application title"
                              value={appTitle}
                              onChange={(e) => chooseAppTitle(e.target.value)}
                            />
                          </label>
                          <div className="TitleSettingHint">
                            <span>Two lines available.</span>
                            <span>Use &lt;ENTER&gt; to start second line.</span>
                          </div>
                        </div>
                      </section>
                      <div className="BuyinLimit">
                        <div>Number of Buy-Ins Allowed</div>
                        <div className="BuyinLimitOptions">
                          {BUYIN_LIMITS.map((limit) => (
                            <label key={limit} htmlFor={`maxBuyins-${limit}`}>
                              <input
                                id={`maxBuyins-${limit}`}
                                type="radio"
                                name="maxBuyins"
                                checked={maxBuyins === limit}
                                onChange={() => chooseMaxBuyins(limit)}
                              />
                              {limit}
                            </label>
                          ))}
                          <label htmlFor="wrapBuyins">
                            <input
                              id="wrapBuyins"
                              type="checkbox"
                              checked={wrapBuyins}
                              onChange={(e) => setWrapBuyins(e.target.checked)}
                            />
                            Wrap
                          </label>
                        </div>
                      </div>
                    </div>
                    <div className="SettingsMiddleColumn">
                      <div className="BuyinValueSettings">
                        <div className="BuyinValueGrid">
                          <div />
                          <div className="BuyinValueColumnHeader">Cost</div>
                          <div className="BuyinValueColumnHeader">
                            Chip
                            <br />
                            Value
                          </div>
                          <div>Buy-In</div>
                          <input
                            id="buyin-cost"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={buyInCost}
                            aria-label="Buy-In cost"
                            onChange={(e) =>
                              updateIntegerSetting(
                                'buyInPrice',
                                e.target.value,
                                setBuyInCost
                              )
                            }
                          />
                          <input
                            id="buyin-chip-value"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={buyInChipValue}
                            aria-label="Buy-In chip value"
                            onChange={(e) =>
                              updateIntegerSetting(
                                'buyInCost',
                                e.target.value,
                                setBuyInChipValue
                              )
                            }
                          />
                          <div>Rebuys</div>
                          <input
                            id="rebuy-cost"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={rebuyCost}
                            aria-label="Rebuy cost"
                            onChange={(e) =>
                              updateIntegerSetting(
                                'rebuyPrice',
                                e.target.value,
                                setRebuyCost
                              )
                            }
                          />
                          <input
                            id="rebuy-chip-value"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={rebuyChipValue}
                            aria-label="Rebuy chip value"
                            onChange={(e) =>
                              updateIntegerSetting(
                                'rebuyCost',
                                e.target.value,
                                setRebuyChipValue
                              )
                            }
                          />
                        </div>
                      </div>
                      <section
                        className="BuyinsMoreInfo"
                        aria-labelledby="buyins-more-info-title"
                      >
                        <div
                          id="buyins-more-info-title"
                          className="BuyinsMoreInfoHeader"
                        >
                          Buy-Ins Display
                        </div>
                        <label htmlFor="chip-value-info">
                          <input
                            id="chip-value-info"
                            type="checkbox"
                            checked={chipValueInfoSelected}
                            onChange={(e) =>
                              setChipValueInfoSelected(e.target.checked)
                            }
                          />
                          Chip Value
                        </label>
                        <div className="BountiesDisplayControls">
                          <label htmlFor="bounties-info">
                            <input
                              id="bounties-info"
                              type="checkbox"
                              checked={bountiesInfoSelected}
                              onChange={(e) =>
                                setBountiesInfoSelected(e.target.checked)
                              }
                            />
                            Bounties
                          </label>
                          <label htmlFor="subtract-bounties">
                            <input
                              id="subtract-bounties"
                              type="checkbox"
                              aria-label="Subtract bounties"
                              checked={subtractBounties}
                              onChange={(e) =>
                                setSubtractBounties(e.target.checked)
                              }
                            />
                            -
                          </label>
                        </div>
                      </section>
                    </div>
                    <div className="SettingsRightColumn">
                      <div className="SoundSettings">
                        <div className="SoundsHeader">Sounds</div>
                        <SoundControl
                          id="attn-sound"
                          label="Attn"
                          sound={attentionSound}
                          onChange={setAttentionSound}
                        />
                        <SoundControl
                          id="warn-sound"
                          label="Warn"
                          sound={warningSound}
                          onChange={setWarningSound}
                        />
                        <SoundControl
                          id="end-sound"
                          label="End"
                          sound={endSound}
                          onChange={setEndSound}
                        />
                      </div>
                    </div>
                  </div>
                  <hr className="BlindEditorDivider" />
                  <section
                    className="BlindEditor"
                    aria-labelledby="blind-editor-title"
                  >
                    <h3 id="blind-editor-title">Blind Structures</h3>
                    <div className="BlindCopyControl">
                      <label htmlFor="copy-blind-structure">
                        Select blinds file
                        <select
                          id="copy-blind-structure"
                          value={copyFromName}
                          disabled={
                            !blindStructuresReady || savingBlindStructure
                          }
                          onChange={(e) => {
                            setCopyFromName(e.target.value);
                            setConfirmingBlindDelete(false);
                          }}
                        >
                          {copySources.map((structure) => (
                            <option
                              key={structure.sourceId}
                              value={structure.sourceId}
                            >
                              {structure.name}
                              {structure.isCustom ? ' (custom)' : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        disabled={!blindStructuresReady || savingBlindStructure}
                        onClick={loadStructureCopy}
                      >
                        Copy File
                      </button>
                      <button
                        type="button"
                        disabled={
                          !blindStructuresReady ||
                          savingBlindStructure ||
                          !selectedCopySource?.isCustom
                        }
                        onClick={() => setConfirmingBlindDelete(true)}
                      >
                        Delete File
                      </button>
                    </div>
                    <div className="BlindDeleteConfirmation">
                      {confirmingBlindDelete && (
                        <div role="alert">
                          Delete the selected custom blinds file?
                          <button
                            type="button"
                            disabled={savingBlindStructure}
                            onClick={deleteBlindStructure}
                          >
                            Confirm Delete
                          </button>
                          <button
                            type="button"
                            disabled={savingBlindStructure}
                            onClick={() => setConfirmingBlindDelete(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                    {!blindStructuresReady && (
                      <div>Loading saved structures...</div>
                    )}
                    {blindStructuresError && (
                      <div className="BlindEditorError" role="alert">
                        {blindStructuresError}
                      </div>
                    )}
                    <label
                      className="BlindStructureName"
                      htmlFor="blind-structure-name"
                    >
                      <span>Name</span>
                      <input
                        id="blind-structure-name"
                        value={editorName}
                        disabled={savingBlindStructure}
                        onChange={(e) => {
                          setEditorName(e.target.value);
                          setEditorError('');
                        }}
                      />
                    </label>
                    <div className="BlindLevelsScroll">
                      <table className="BlindLevels">
                        <thead>
                          <tr>
                            <th>Round</th>
                            <th>SB</th>
                            <th>BB</th>
                            <th>Ante</th>
                            <th>Duration</th>
                            <th aria-label="Actions" />
                          </tr>
                        </thead>
                        <tbody>
                          {editorLevels.map((level, i) => (
                            <tr key={level.round}>
                              <td>{level.round}</td>
                              {(['sb', 'lb', 'ante', 'duration'] as const).map(
                                (field) => (
                                  <td key={field}>
                                    <input
                                      aria-label={`Round ${i + 1} ${
                                        field === 'lb' ? 'BB' : field
                                      }`}
                                      value={level[field]}
                                      disabled={savingBlindStructure}
                                      onChange={(e) =>
                                        updateEditorLevel(
                                          i,
                                          field,
                                          e.target.value
                                        )
                                      }
                                    />
                                  </td>
                                )
                              )}
                              <td>
                                <button
                                  type="button"
                                  aria-label={`Remove round ${i + 1}`}
                                  disabled={savingBlindStructure}
                                  onClick={() => removeEditorLevel(i)}
                                >
                                  -
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="BlindEditorButtons">
                      <button
                        type="button"
                        disabled={savingBlindStructure}
                        onClick={addEditorLevel}
                      >
                        Add Level
                      </button>
                      <button
                        type="button"
                        disabled={!blindStructuresReady || savingBlindStructure}
                        onClick={saveBlindStructure}
                      >
                        {savingBlindStructure ? 'Saving...' : 'Save Structure'}
                      </button>
                    </div>
                    {editorError && (
                      <div className="BlindEditorError" role="alert">
                        {editorError}
                      </div>
                    )}
                  </section>
                </div>
              </>
            )}
          </div>
          {centerView === 'clock' && (
            <div className="ClockFooter">
              <div className="ClockButtons">
                <button
                  className={`ClockToggle ${
                    clockRunning ? 'ClockTogglePause' : 'ClockToggleStart'
                  }`}
                  type="button"
                  onClick={() => setClockRunning(!clockRunning)}
                >
                  {clockRunning ? 'Pause Clock' : 'Start Clock'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setRoundIndex(Math.min(roundIndex + 1, blinds.length - 1))
                  }
                >
                  Round Up
                </button>
                <button
                  type="button"
                  onClick={() => setRoundIndex(Math.max(roundIndex - 1, 0))}
                >
                  Round Down
                </button>
              </div>
            </div>
          )}
        </section>
        <section className="Column BottomColumn">
          <div className="ColumnContent PlayerColumnContent">
            {view === 'buyins' ? (
              <>
                <h2 className="BuyinsHeading">Buy-Ins</h2>
                <Buyins
                  players={players}
                  counts={counts}
                  playing={playing}
                  maxBuyins={maxBuyins}
                  wrapBuyins={wrapBuyins}
                  buyInCost={numericBuyInCost}
                  rebuyCost={numericRebuyCost}
                  buyInChipValue={numericBuyInChipValue}
                  rebuyChipValue={numericRebuyChipValue}
                  showChipValue={chipValueInfoSelected}
                  bounties={bounties}
                  showBounties={bountiesInfoSelected}
                  subtractBounties={subtractBounties}
                  setCounts={setCounts}
                  setBounties={setBounties}
                />
              </>
            ) : (
              <>
                <h2>Player Selection</h2>
                <PlayerSelection
                  players={players}
                  playing={playing}
                  setPlaying={setPlaying}
                  playerName={playerName}
                  setPlayerName={setPlayerName}
                  playersReady={playersReady}
                  savingPlayers={savingPlayers}
                  playersError={playersError}
                  onAddPlayer={addPlayer}
                  onDeletePlayer={deletePlayer}
                />
              </>
            )}
          </div>
          <div className="ViewSwitch">
            <label htmlFor="view-buyins">
              <input
                id="view-buyins"
                type="radio"
                name="rightView"
                checked={view === 'buyins'}
                onChange={() => chooseView('buyins')}
              />
              Buy-Ins
            </label>
            <label htmlFor="view-players">
              <input
                id="view-players"
                type="radio"
                name="rightView"
                checked={view === 'players'}
                onChange={() => chooseView('players')}
              />
              Player Selection
            </label>
          </div>
        </section>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <Router>
      <Switch>
        <Route path="/" component={Hello} />
      </Switch>
    </Router>
  );
}
