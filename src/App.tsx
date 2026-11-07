import React, { useEffect, useRef, useState } from 'react';
import { BrowserRouter as Router, Switch, Route } from 'react-router-dom';
import { ipcRenderer } from 'electron';
import playersData from '../resource/players.txt';
import payoutsData from '../resource/payouts.unl';
import getNextBuyinCount from './buyinCount';
import './App.global.css';

const parseBlinds = (text: string) =>
  text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [round, sb, lb, ante, duration] = line.trim().split('|');
      return { round, sb, lb, ante, duration };
    });

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
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const structures = blindFiles
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
  .sort((a, b) => minutes(a.name) - minutes(b.name));

const DEFAULT_STRUCTURE = '2:51';

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

const BUYIN_PRICE = 10;
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

// total number of buyins, counting only the players in the current game
const countBuyins = (counts: number[], playing: boolean[]) =>
  counts.reduce((sum, c, i) => (playing[i] ? sum + c : sum), 0);

type BuyinsProps = {
  players: string[];
  counts: number[];
  playing: boolean[];
  maxBuyins: number;
  wrapBuyins: boolean;
  setCounts: (counts: number[]) => void;
};

const Buyins = ({
  players,
  counts,
  playing,
  maxBuyins,
  wrapBuyins,
  setCounts,
}: BuyinsProps) => {
  const setCount = (index: number, count: number) =>
    setCounts(counts.map((c, i) => (i === index ? count : c)));

  const totalCount = countBuyins(counts, playing);

  return (
    <div className="BuyinsTable">
      <table className="Buyins BuyinsHeader">
        <colgroup>
          <col className="BuyinsNameColumn" />
          <col className="BuyinsCountColumn" />
          <col className="BuyinsValueColumn" />
        </colgroup>
        <thead>
          <tr>
            <th>Name</th>
            <th>Count</th>
            <th>Value</th>
          </tr>
        </thead>
      </table>
      <div className="BuyinsScroll">
        <table className="Buyins">
          <colgroup>
            <col className="BuyinsNameColumn" />
            <col className="BuyinsCountColumn" />
            <col className="BuyinsValueColumn" />
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
                        aria-label={`Add buyin for ${name}`}
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
                    <td>${counts[i] * BUYIN_PRICE}</td>
                  </tr>
                )
            )}
          </tbody>
        </table>
      </div>
      <table className="Buyins BuyinsFooter">
        <colgroup>
          <col className="BuyinsNameColumn" />
          <col className="BuyinsCountColumn" />
          <col className="BuyinsValueColumn" />
        </colgroup>
        <tfoot>
          <tr>
            <td>Total</td>
            <td>{totalCount}</td>
            <td>${totalCount * BUYIN_PRICE}</td>
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
  const [players, setPlayers] = useState(initialPlayers);
  const [counts, setCounts] = useState<number[]>(initialPlayers.map(() => 1));
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
  const [maxBuyins, setMaxBuyins] = useState(BUYIN_LIMITS[0]);
  const [wrapBuyins, setWrapBuyins] = useState(false);
  const [clockRunning, setClockRunning] = useState(false);
  const [roundIndex, setRoundIndex] = useState(0);
  const [warningSound, setWarningSound] = useState(defaultSound('oneminute'));
  const [endSound, setEndSound] = useState(defaultSound('cow'));

  const chooseView = (nextView: 'buyins' | 'players') => {
    window.localStorage.setItem('rightView', nextView);
    setView(nextView);
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
  const [structureName, setStructureName] = useState(
    (structures.find((s) => s.name === DEFAULT_STRUCTURE) || structures[0]).name
  );
  const blinds = (structures.find((s) => s.name === structureName) as {
    levels: ReturnType<typeof parseBlinds>;
  }).levels;
  // '-' means no ante; hide the Anty column when no level pays one
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
    updatedPlaying: boolean[]
  ) => {
    setSavingPlayers(true);
    setPlayersError('');
    try {
      await ipcRenderer.invoke('players:save', updatedPlayers);
      setPlayers(updatedPlayers);
      setCounts(updatedCounts);
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
    const updatedPlaying = [...playing];
    updatedPlaying.splice(addedIndex, 0, true);
    await savePlayers(updatedPlayers, updatedCounts, updatedPlaying);
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
    const updatedPlaying = playing.filter((_, i) => i !== index);
    await savePlayers(updatedPlayers, updatedCounts, updatedPlaying);
  };
  const pot = countBuyins(counts, playing) * BUYIN_PRICE;

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
                  {hasAntes && <th>Anty</th>}
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
          <div className="BuyinLimit">
            <div>Number of Buyins Allowed</div>
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
        </section>
        <section className="Column BottomColumn">
          <div className="ColumnContent">
            <h1 className="Title">Deadmoney Shootout</h1>
            <div className="ClockDisplay">{formatClock(secondsLeft)}</div>
            {/* hidden, not removed, while running so the blinds below do not jump */}
            <div
              className={clockRunning ? 'ClockPaused Invisible' : 'ClockPaused'}
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
                  ? `${blinds[roundIndex + 1].sb}/${blinds[roundIndex + 1].lb}`
                  : '-'}
              </div>
            </div>
          </div>
          <div className="ClockFooter">
            <div className="SoundSettings">
              <div className="SoundsHeader">Sounds</div>
              <label htmlFor="warn-sound">
                Warn:
                <select
                  id="warn-sound"
                  className="SoundSelect"
                  aria-label="Warning sound"
                  value={warningSound}
                  onChange={(e) => setWarningSound(e.target.value)}
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
                  aria-label="Play warning sound"
                  title="Play"
                  onClick={() => playSound(warningSound)}
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
              <label htmlFor="end-sound">
                End:
                <select
                  id="end-sound"
                  className="SoundSelect"
                  aria-label="End sound"
                  value={endSound}
                  onChange={(e) => setEndSound(e.target.value)}
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
                  aria-label="Play end sound"
                  title="Play"
                  onClick={() => playSound(endSound)}
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
            </div>
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
        </section>
        <section className="Column BottomColumn">
          <div className="ColumnContent PlayerColumnContent">
            {view === 'buyins' ? (
              <>
                <h2>Buyins</h2>
                <Buyins
                  players={players}
                  counts={counts}
                  playing={playing}
                  maxBuyins={maxBuyins}
                  wrapBuyins={wrapBuyins}
                  setCounts={setCounts}
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
              Buyins
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
