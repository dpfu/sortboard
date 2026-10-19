import * as React from 'react';
import { Check, Images, Play, X } from 'lucide-react';
import { CardPreview } from '../CardPreview';
import type { CardData, RecordingSession } from '../types';
import { studyDistribution, type StudyDefinition } from './model';

interface ComparisonSelection { cardIds: string[]; activeId: string }
const selectionLimit = 4;
const scoreLabel = (value: number) => value > 0 ? `+${value}` : String(value).replace('-', '−');

function readSelection(key: string, cards: CardData[]): ComparisonSelection {
  const fallback = cards.slice(0, selectionLimit).map(card => card.id);
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    const ids = Array.isArray(saved?.cardIds) ? [...new Set<string>(saved.cardIds)].filter(id => cards.some(card => card.id === id)).slice(0, selectionLimit) : [];
    if (ids.length) return { cardIds: ids, activeId: ids.includes(saved.activeId) ? saved.activeId : ids[0] };
  } catch { /* View preferences are optional; recordings remain in IndexedDB. */ }
  return { cardIds: fallback, activeId: fallback[0] || '' };
}

export function StudyComparison({ study, recordings, cards, busy, onReplay, onPreview }: {
  study: StudyDefinition; recordings: Array<RecordingSession | undefined>; cards: CardData[]; busy: boolean;
  onReplay: (recording: RecordingSession) => void; onPreview: (card: CardData) => void;
}) {
  const orderedCards = React.useMemo(() => [...cards].sort((a, b) => a.meta.name.localeCompare(b.meta.name, undefined, { numeric: true })), [cards]);
  const cardsById = React.useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  const distributions = React.useMemo(() => recordings.map(recording => recording ? studyDistribution(study, recording) : []), [study, recordings]);
  const storageKey = `sortboard.comparison.v1:${study.id}:${recordings.map(recording => recording?.createdAt).join(':')}`;
  const [selection, setSelection] = React.useState(() => readSelection(storageKey, orderedCards));
  const [choosing, setChoosing] = React.useState(false);
  const [draft, setDraft] = React.useState<string[]>([]);
  const dialog = React.useRef<HTMLDialogElement>(null);
  const dialogTitle = React.useId();
  const imageOnly = cards.every(card => card.kind === 'image');
  const noun = imageOnly ? 'image' : 'card';
  const active = cardsById.get(selection.activeId);
  const position = (round: number, id: string) => distributions[round]?.find(column => column.cardIds.includes(id));
  const placements = (id: string) => distributions.map((_, round) => {
    const column = position(round, id);
    return column ? scoreLabel(column.value) : '—';
  }).join(' → ');

  React.useEffect(() => {
    if (choosing) dialog.current?.showModal();
  }, [choosing]);

  const saveSelection = (next: ComparisonSelection) => {
    setSelection(next);
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Comparison also works without view storage. */ }
  };
  const closeChooser = () => { dialog.current?.close(); setChoosing(false); };

  if (!active) return null;
  return <div className="studyCompare" aria-label="Card comparison">
    <div className="studyCompare__stage">
      <figure className="studyCompare__focus">
        <button type="button" className="studyCompare__hero" onClick={() => onPreview(active)} aria-label={`Enlarge ${noun} ${active.meta.name}`}>
          <CardPreview card={active} showPreviewButton={false} />
        </button>
        <figcaption aria-live="polite"><strong>{active.meta.name}</strong><span className="studyCompare__movement" aria-label="Placements in round order">{placements(active.id)}</span></figcaption>
      </figure>
      <div className="studyCompare__rounds">
        {recordings.map((recording, i) => {
          if (!recording) return null;
          const task = recording.studyRound || study.rounds[i];
          const columns = distributions[i];
          const selected = position(i, active.id);
          return <section className="studyCompareRound" key={task.id} aria-label={`Round ${i + 1} · ${task.title}`}>
            <header><div><span className="studyCompareRound__number">Round {i + 1}</span><h3>{task.title}</h3></div>
              <span className="studyCompareRound__score" aria-label={`Score: ${selected ? scoreLabel(selected.value) : 'not placed'}`}>{selected ? scoreLabel(selected.value) : '—'}</span>
              <button type="button" className="btn btn--ghost btn--tiny" disabled={busy} onClick={() => onReplay(recording)} aria-label={`Replay round ${i + 1} · ${task.title}`}><Play aria-hidden="true" />Replay</button>
            </header>
            <p className="studyCompareRound__prompt">{task.prompt}</p>
            <div className="studyCompareRound__scroll">
              <div className="studyCompareGrid" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(30px, 1fr))` }} role="img"
                aria-label={`Round ${i + 1}: ${active.meta.name} at ${selected?.label ?? 'not placed'}`}>
                {columns.map(column => <div className={`studyCompareColumn${column.cardIds.includes(active.id) ? ' is-selected' : ''}`} key={column.value} aria-hidden="true">
                  <span className="studyCompareColumn__label">{column.label}</span>
                  {column.cardIds.map(id => <div key={id} data-card-id={id} className={`studyCompareTile${id === active.id ? ' is-selected' : ''}`}>
                    {cardsById.has(id) ? <CardPreview card={cardsById.get(id)!} showPreviewButton={false} /> : null}
                  </div>)}
                </div>)}
              </div>
            </div>
          </section>;
        })}
      </div>
    </div>
    <div className="studyCompare__selectionHeading"><span>{selection.cardIds.length} {selection.cardIds.length === 1 ? noun : `${noun}s`} to discuss</span>
      <button type="button" className="btn btn--ghost btn--tiny" onClick={() => { setDraft(selection.cardIds); setChoosing(true); }}><Images aria-hidden="true" />Choose {noun}s</button>
    </div>
    <div className="studyCompare__picks" aria-label="Discussion cards">
      {selection.cardIds.map(id => {
        const card = cardsById.get(id);
        return card ? <button type="button" key={id} className="studyComparePick" aria-pressed={active.id === id} aria-label={`Compare ${noun} ${card.meta.name}`}
          onClick={() => saveSelection({ ...selection, activeId: id })}>
          <CardPreview card={card} showPreviewButton={false} /><span><strong>{card.meta.name}</strong><span>{placements(id)}</span></span>
        </button> : null;
      })}
    </div>
    {choosing ? <dialog ref={dialog} className="studyCompareChooser" aria-labelledby={dialogTitle} onCancel={event => { event.preventDefault(); closeChooser(); }}>
      <header><h2 id={dialogTitle}>Choose {noun}s to discuss</h2><button type="button" className="btn btn--ghost btn--tiny" aria-label="Close" onClick={closeChooser}><X aria-hidden="true" /></button></header>
      <div className="studyCompareChooser__cards">
        {orderedCards.map(card => {
          const selected = draft.includes(card.id);
          return <button type="button" className="studyCompareChoice" key={card.id} aria-label={`Include ${noun} ${card.meta.name}`} aria-pressed={selected}
            disabled={!selected && draft.length >= selectionLimit} onClick={() => setDraft(selected ? draft.filter(id => id !== card.id) : [...draft, card.id])}>
            <CardPreview card={card} showPreviewButton={false} /><span>{card.meta.name}{selected ? <Check aria-hidden="true" /> : null}</span>
          </button>;
        })}
      </div>
      <footer><span role="status">{draft.length} / {Math.min(selectionLimit, cards.length)} selected</span><button type="button" className="btn" disabled={!draft.length} onClick={() => {
        saveSelection({ cardIds: draft, activeId: draft.includes(active.id) ? active.id : draft[0] }); closeChooser();
      }}>Done</button></footer>
    </dialog> : null}
  </div>;
}
