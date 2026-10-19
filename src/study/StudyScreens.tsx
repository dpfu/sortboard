import * as React from 'react';
import { ArrowRight, Download, Play, Check, PanelsTopLeft } from 'lucide-react';
import type { CardData, RecordingSession } from '../types';
import { studyScores, type StudyDefinition } from './model';
import { studyCopy } from './copy';
import { CardPreview } from '../CardPreview';
import './study.css';

export function StudyScreens({ study, recordings, cards, busy, status, onStart, onReplay, onExport, onNew, onNotes, onWorkspace, onPreview }: {
  study: StudyDefinition; recordings: Array<RecordingSession | undefined>; cards: CardData[]; busy: boolean; status: string;
  onStart: (index: number) => void; onReplay: (recording: RecordingSession) => void; onExport: () => void;
  onNew: () => void; onNotes: (recording: RecordingSession, notes: string, comparisonNotes?: string) => Promise<boolean>;
  onWorkspace: () => void; onPreview: (card: CardData) => void;
}) {
  const next = recordings.findIndex(r => !r?.studyRound?.completedAt);
  const finished = next < 0;
  const previous = next > 0 ? recordings[next - 1] : finished ? recordings.at(-1) : undefined;
  const copy = studyCopy(study);
  const [notes, setNotes] = React.useState(previous?.studyRound?.reflection || '');
  const [comparisonNotes, setComparisonNotes] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    const saved = previous?.studyRound?.reflection || '';
    try { setNotes(sessionStorage.getItem(`sortboard.study-notes:${previous?.createdAt}`) ?? saved); }
    catch { setNotes(saved); }
  }, [previous?.createdAt, previous?.studyRound?.reflection]);
  React.useEffect(() => {
    const saved = previous?.studyRound?.comparisonNotes || '';
    try { setComparisonNotes(sessionStorage.getItem(`sortboard.study-comparison:${previous?.createdAt}`) ?? saved); }
    catch { setComparisonNotes(saved); }
  }, [previous?.createdAt, previous?.studyRound?.comparisonNotes]);
  const saveNotes = async () => {
    if (!previous) return true;
    setSaving(true);
    try {
      const saved = await onNotes(previous, notes, finished ? comparisonNotes : undefined);
      if (saved) try {
        sessionStorage.removeItem(`sortboard.study-notes:${previous.createdAt}`);
        sessionStorage.removeItem(`sortboard.study-comparison:${previous.createdAt}`);
      } catch { /* Optional recovery. */ }
      return saved;
    } finally { setSaving(false); }
  };
  const allBusy = busy || saving;
  const scores = recordings.map(r => r ? studyScores(study, r) : new Map<string, number>());
  return <div className="studyShell">
    <header className="studyHeader"><span><PanelsTopLeft />SortBoard <span className="studyHeader__divider">/</span> Guided study</span>
      <button className="btn btn--ghost btn--tiny" onClick={onWorkspace} disabled={allBusy}>Workspace</button></header>
    <main className="studyPage" lang={study.taskLanguage || 'en'} aria-busy={allBusy}>
      <p className="studyEyebrow">{finished ? copy.completed : next > 0 ? `Round ${next} of ${study.rounds.length} · ${copy.saved}` : copy.introduction}</p>
      <h1>{finished ? copy.comparison : next > 0 ? copy.reflection : study.title}</h1>
      {previous ? <section className="studyReflection" aria-label="Discuss this round">
        <p><Check />{previous.studyRound?.title} {copy.saved}</p>
        {!finished ? <>
          <h2>{previous.studyRound?.title}: {copy.result}</h2>
          <p>{previous.studyRound?.prompt}</p>
          <div className="studyRoundResult" aria-label="Saved round result" style={{ gridTemplateColumns: `repeat(${study.scale.length}, minmax(0, 1fr))` }}>
            {study.scale.map(position => <div key={position.value}><strong>{position.label}</strong>
              {cards.filter(card => scores[next - 1]?.get(card.id) === position.value).map(card => <button key={card.id}
                className="studyResultImage" aria-label={`Enlarge image ${card.meta.name}`} onClick={() => onPreview(card)}>
                <CardPreview card={card} showPreviewButton={false} /><span>{card.meta.name}</span></button>)}
            </div>)}
          </div>
        </> : null}
        <h2>{copy.discuss}</h2>
        <ul>{copy.roundQuestions.map(q => <li key={q}>{q}</li>)}</ul>
        <label htmlFor="study-notes">{copy.notes} <span className="hint">{copy.optional}</span></label>
        <textarea id="study-notes" value={notes} rows={3} disabled={allBusy} placeholder={copy.notesPlaceholder}
          onChange={e => { setNotes(e.target.value); try { sessionStorage.setItem(`sortboard.study-notes:${previous.createdAt}`, e.target.value); } catch { /* Optional recovery. */ } }} />
        <button className="btn btn--ghost btn--tiny" disabled={allBusy} onClick={() => void saveNotes()}>Save notes</button>
      </section> : <>
        <p className="studyIntro">{study.introduction}</p>
        <div className="studySteps">{copy.steps.map(step => <span key={step}>{step}</span>)}</div>
        {copy.instructions.map(text => <p key={text}>{text}</p>)}
        <details className="studyCompanions"><summary>{copy.rolesTitle}</summary><p>{copy.roles}</p></details>
        <p className="hint">{copy.local}</p>
      </>}
      {!finished ? <section className="studyNext">
        <p className="studyEyebrow">Round {next + 1} of {study.rounds.length} · {study.rounds[next].title}</p>
        <h2>{study.rounds[next].prompt}</h2>
        {next > 0 ? <p>{copy.nextRound}</p> : null}
        <button className="btn studyPrimary" disabled={allBusy} onClick={() => void (async () => { if (await saveNotes()) onStart(next); })()}>
          {recordings[next] ? `Resume round ${next + 1}` : next ? `Continue to round ${next + 1}` : 'Start sorting'}<ArrowRight /></button>
      </section> : <>
        <section className="studyReviewStep">
        <h2>{copy.compareTitle}</h2>
        <ul>{copy.compareQuestions.map(q => <li key={q}>{q}</li>)}</ul>
        <div className="studyComparison"><table><caption>{copy.table}</caption><thead><tr><th scope="col">Card</th>{study.rounds.map(r => <th key={r.id} scope="col">{r.title}</th>)}{study.rounds.length === 2 ? <th scope="col">{copy.difference}</th> : null}</tr></thead>
          <tbody>{[...cards].sort((a, b) => a.meta.name.localeCompare(b.meta.name)).map(card => <tr key={card.id}>
            <th scope="row"><button className="studyImage" onClick={() => onPreview(card)} aria-label={`Enlarge image ${card.meta.name}`}><CardPreview card={card} showPreviewButton={false} /><span>{card.meta.name}</span></button></th>
            {scores.map((s, i) => <td key={i}>{s.has(card.id) ? (s.get(card.id)! > 0 ? '+' : '') + s.get(card.id) : '—'}</td>)}
            {study.rounds.length === 2 ? <td className="studyDifference">{scores[0]?.has(card.id) && scores[1]?.has(card.id) ?
              `${scores[1].get(card.id)! - scores[0].get(card.id)! > 0 ? '+' : ''}${scores[1].get(card.id)! - scores[0].get(card.id)!}` : '—'}</td> : null}
          </tr>)}</tbody></table></div>
        {study.rounds.length === 2 ? <p className="hint">{copy.differenceHint}</p> : null}
        {recordings.slice(0, -1).map(r => r?.studyRound?.reflection ? <details key={r.createdAt} className="studyCredits">
          <summary>{r.studyRound.title}: {copy.notes}</summary><p className="studyCreditText">{r.studyRound.reflection}</p>
        </details> : null)}
        {study.rounds.length > 1 ? <><label htmlFor="study-comparison">{copy.comparisonNotes} <span className="hint">{copy.optional}</span></label>
        <textarea id="study-comparison" rows={4} value={comparisonNotes} disabled={allBusy} placeholder={copy.comparisonPlaceholder}
          onChange={e => { setComparisonNotes(e.target.value); try { sessionStorage.setItem(`sortboard.study-comparison:${previous?.createdAt}`, e.target.value); } catch { /* Optional recovery. */ } }} />
        <button className="btn btn--ghost btn--tiny" disabled={allBusy} onClick={() => void saveNotes()}>Save notes</button></> : null}
        </section>
        <section className="studyReviewStep"><h2>{copy.replayTitle}</h2><p>{copy.replay}</p>
          <div className="studyResultsActions">{recordings.map((r, i) => r ? <button key={r.createdAt} className="btn btn--ghost" disabled={allBusy}
            onClick={() => void (async () => { if (await saveNotes()) onReplay(r); })()}><Play />Replay round {i + 1} · {r.studyRound?.title}</button> : null)}</div>
        </section>
        <section className="studyReviewStep"><h2>{copy.exportTitle}</h2><p>{copy.export}</p>
          <button className="btn studyPrimary" disabled={allBusy} onClick={() => void (async () => { if (await saveNotes()) onExport(); })()}><Download />Export study</button>
          {status === 'Project exported.' ? <p className="studyExported" role="status"><Check />{copy.exported}</p> : null}
        </section>
        <div className="studyResultsActions"><button className="btn btn--ghost" disabled={allBusy} onClick={() => void (async () => { if (await saveNotes()) onNew(); })()}>New participant</button></div>
        <p className="hint">{copy.newParticipant}</p>
      </>}
      {status ? <p className="studyStatus" role={/could not|failed|invalid/i.test(status) ? 'alert' : 'status'}>{status}</p> : null}
      <details className="studyCredits"><summary>{copy.about}</summary><p>{study.reference}</p><p className="studyCreditText">{study.credits}</p></details>
    </main>
  </div>;
}
