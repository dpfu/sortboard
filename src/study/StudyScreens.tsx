import * as React from 'react';
import { ArrowRight, Download, Play, Check, PanelsTopLeft } from 'lucide-react';
import type { CardData, RecordingSession } from '../types';
import { studyScores, type StudyDefinition } from './model';
import './study.css';

export function StudyScreens({ study, recordings, cards, busy, status, onStart, onReplay, onExport, onNew, onNotes, onWorkspace, onPreview }: {
  study: StudyDefinition; recordings: Array<RecordingSession | undefined>; cards: CardData[]; busy: boolean; status: string;
  onStart: (index: number) => void; onReplay: (recording: RecordingSession) => void; onExport: () => void;
  onNew: () => void; onNotes: (recording: RecordingSession, notes: string) => Promise<boolean>;
  onWorkspace: () => void; onPreview: (card: CardData) => void;
}) {
  const next = recordings.findIndex(r => !r?.studyRound?.completedAt);
  const finished = next < 0;
  const previous = next > 0 ? recordings[next - 1] : finished ? recordings.at(-1) : undefined;
  const [notes, setNotes] = React.useState(previous?.studyRound?.reflection || '');
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    const saved = previous?.studyRound?.reflection || '';
    try { setNotes(sessionStorage.getItem(`sortboard.study-notes:${previous?.createdAt}`) ?? saved); }
    catch { setNotes(saved); }
  }, [previous?.createdAt, previous?.studyRound?.reflection]);
  const saveNotes = async () => {
    if (!previous) return true;
    setSaving(true);
    try {
      const saved = await onNotes(previous, notes);
      if (saved) try { sessionStorage.removeItem(`sortboard.study-notes:${previous.createdAt}`); } catch { /* Optional recovery. */ }
      return saved;
    } finally { setSaving(false); }
  };
  const allBusy = busy || saving;
  const scores = recordings.map(r => r ? studyScores(study, r) : new Map<string, number>());
  return <div className="studyShell">
    <header className="studyHeader"><span><PanelsTopLeft />SortBoard <span className="studyHeader__divider">/</span> Guided study</span>
      <button className="btn btn--ghost btn--tiny" onClick={onWorkspace} disabled={allBusy}>Workspace</button></header>
    <main className="studyPage" aria-busy={allBusy}>
      <p className="studyEyebrow">{finished ? 'Both rounds saved' : next > 0 ? `Round ${next} of ${study.rounds.length} saved` : 'A guided sorting exercise'}</p>
      <h1>{finished ? 'Compare your two perspectives' : next > 0 ? 'A moment to reflect' : study.title}</h1>
      {previous ? <section className="studyReflection" aria-label="Discuss this round">
        <p><Check />{previous.studyRound?.title} is saved.</p>
        {!finished ? <>
          <h2>{previous.studyRound?.title}: your result</h2>
          <p>{previous.studyRound?.prompt}</p>
          <div className="studyRoundResult" aria-label="Saved first-round result">
            {study.scale.map(position => <div key={position.value}><strong>{position.label}</strong>
              {cards.filter(card => scores[next - 1]?.get(card.id) === position.value).map(card => <button key={card.id}
                className="studyResultImage" aria-label={`Enlarge image ${card.meta.name}`} onClick={() => onPreview(card)}>
                <img src={card.src} alt={`Image ${card.meta.name}`} /><span>{card.meta.name}</span></button>)}
            </div>)}
          </div>
        </> : null}
        <h2>Talk through your choices</h2>
        <p>Why these images at the two extremes? Which placement was hardest to decide?</p>
        <label htmlFor="study-notes">Discussion notes <span className="hint">(optional)</span></label>
        <textarea id="study-notes" value={notes} rows={3} disabled={allBusy} placeholder="The participant's reasons, in their own words."
          onChange={e => { setNotes(e.target.value); try { sessionStorage.setItem(`sortboard.study-notes:${previous.createdAt}`, e.target.value); } catch { /* Optional recovery. */ } }} />
        <button className="btn btn--ghost btn--tiny" disabled={allBusy} onClick={() => void saveNotes()}>Save notes</button>
      </section> : <>
        <p className="studyIntro">{study.introduction}</p>
        <div className="studySteps"><span>1 · Sort the images</span><span>2 · Discuss your choices</span><span>3 · Try a second perspective</span></div>
        <p>Drag every image into a place on the scale. Move images again whenever you change your mind. Double-click an image to enlarge it.</p>
        <p>Place images you disagree with on the left and images you agree with on the right. The middle means undecided. Rows are extra places within the same score.</p>
        <p>There are fewer places at the extremes. All places must be filled. There is no right or wrong answer.</p>
      </>}
      {!finished ? <section className="studyNext">
        <p className="studyEyebrow">Round {next + 1} of {study.rounds.length} · {study.rounds[next].title}</p>
        <h2>{study.rounds[next].prompt}</h2>
        {next > 0 ? <p>The same images will be mixed again on an empty grid. Sort them according to this new statement.</p> : null}
        <button className="btn studyPrimary" disabled={allBusy} onClick={() => void (async () => { if (await saveNotes()) onStart(next); })()}>
          {recordings[next] ? `Resume round ${next + 1}` : next ? `Continue to round ${next + 1}` : 'Start round 1'}<ArrowRight /></button>
      </section> : <>
        <div className="studyResultsActions"><button className="btn studyPrimary" disabled={allBusy} onClick={() => void (async () => { if (await saveNotes()) onExport(); })()}><Download />Export study</button>{recordings.map((r, i) => r ? <button key={r.createdAt} className="btn btn--ghost" disabled={allBusy}
          onClick={() => void (async () => { if (await saveNotes()) onReplay(r); })()}><Play />Replay round {i + 1} · {r.studyRound?.title}</button> : null)}</div>
        <div className="studyComparison"><table><caption>Each image under both statements</caption><thead><tr><th scope="col">Image</th>{study.rounds.map(r => <th key={r.id} scope="col">{r.title}</th>)}</tr></thead>
          <tbody>{[...cards].sort((a, b) => a.meta.name.localeCompare(b.meta.name)).map(card => <tr key={card.id}>
            <th scope="row"><button className="studyImage" onClick={() => onPreview(card)} aria-label={`Enlarge image ${card.meta.name}`}><img src={card.src} alt={`Image ${card.meta.name}`} /><span>{card.meta.name}</span></button></th>
            {scores.map((s, i) => <td key={i}>{s.has(card.id) ? (s.get(card.id)! > 0 ? '+' : '') + s.get(card.id) : '—'}</td>)}</tr>)}</tbody></table></div>
        <p>What changed between the two statements? Discuss the reasons for those changes.</p>
        {recordings.slice(0, -1).map(r => r?.studyRound?.reflection ? <details key={r.createdAt} className="studyCredits">
          <summary>{r.studyRound.title}: discussion notes</summary><p className="studyCreditText">{r.studyRound.reflection}</p>
        </details> : null)}
        <div className="studyResultsActions"><button className="btn btn--ghost" disabled={allBusy} onClick={() => void (async () => { if (await saveNotes()) onNew(); })()}>New participant</button></div>
        <p className="hint">The export contains both results, replays, discussion notes and image credits. A new participant gets a fresh project; these results stay saved.</p>
      </>}
      {status ? <p className="studyStatus" role={/could not|failed|invalid/i.test(status) ? 'alert' : 'status'}>{status}</p> : null}
      <details className="studyCredits"><summary>About this exercise and image credits</summary><p>{study.reference}</p><p className="studyCreditText">{study.credits}</p></details>
    </main>
  </div>;
}
