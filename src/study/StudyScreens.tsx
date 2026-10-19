import { ArrowRight, Download, Play, Check, PanelsTopLeft } from 'lucide-react';
import type { CardData, RecordingSession } from '../types';
import { studyScores, type StudyDefinition } from './model';
import { studyCopy } from './copy';
import { CardPreview } from '../CardPreview';
import './study.css';

export function StudyScreens({ study, recordings, cards, busy, status, onStart, onReplay, onExport, onNew, onWorkspace, onPreview }: {
  study: StudyDefinition; recordings: Array<RecordingSession | undefined>; cards: CardData[]; busy: boolean; status: string;
  onStart: (index: number) => void; onReplay: (recording: RecordingSession) => void; onExport: () => void;
  onNew: () => void;
  onWorkspace: () => void; onPreview: (card: CardData) => void;
}) {
  const next = recordings.findIndex(r => !r?.studyRound?.completedAt);
  const finished = next < 0;
  const previous = next > 0 ? recordings[next - 1] : finished ? recordings.at(-1) : undefined;
  const copy = studyCopy(study);
  const scores = recordings.map(r => r ? studyScores(study, r) : new Map<string, number>());
  return <div className="studyShell">
    <header className="studyHeader"><span><PanelsTopLeft />SortBoard <span className="studyHeader__divider">/</span> Guided study</span>
      <button className="btn btn--ghost btn--tiny" onClick={onWorkspace} disabled={busy}>Workspace</button></header>
    <main className="studyPage" lang={study.taskLanguage || 'en'} aria-busy={busy}>
      <p className="studyEyebrow">{finished ? copy.completed : next > 0 ? `Round ${next} of ${study.rounds.length} · ${copy.saved}` : copy.introduction}</p>
      <h1>{finished ? copy.comparison : next > 0 ? copy.reflection : study.title}</h1>
      {previous ? <section className="studyReflection" aria-label="Discuss this round">
        <p><Check />{previous.studyRound?.title} {copy.saved}</p>
        {!finished ? <>
          <div className="studyResultHeading"><h2>{previous.studyRound?.title}: {copy.result}</h2>
            <button className="btn btn--ghost" disabled={busy} onClick={() => onReplay(previous)}><Play />Replay round {next}</button>
          </div>
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
        <button className="btn studyPrimary" disabled={busy} onClick={() => onStart(next)}>
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
        </section>
        <section className="studyReviewStep"><h2>{copy.replayTitle}</h2><p>{copy.replay}</p>
          <div className="studyResultsActions">{recordings.map((r, i) => r ? <button key={r.createdAt} className="btn btn--ghost" disabled={busy}
            onClick={() => onReplay(r)}><Play />Replay round {i + 1} · {r.studyRound?.title}</button> : null)}</div>
        </section>
        <section className="studyReviewStep"><h2>{copy.exportTitle}</h2><p>{copy.export}</p>
          <button className="btn studyPrimary" disabled={busy} onClick={onExport}><Download />Export study</button>
          {status === 'Project exported.' ? <p className="studyExported" role="status"><Check />{copy.exported}</p> : null}
        </section>
        <div className="studyResultsActions"><button className="btn btn--ghost" disabled={busy} onClick={onNew}>New participant</button></div>
        <p className="hint">{copy.newParticipant}</p>
      </>}
      {status ? <p className="studyStatus" role={/could not|failed|invalid/i.test(status) ? 'alert' : 'status'}>{status}</p> : null}
      <details className="studyCredits"><summary>{copy.about}</summary><p>{study.reference}</p><p className="studyCreditText">{study.credits}</p></details>
    </main>
  </div>;
}
