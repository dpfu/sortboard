import { ArrowRight, Download, Play, Check, PanelsTopLeft } from 'lucide-react';
import type { CardData, RecordingSession } from '../types';
import { studyScores, type StudyDefinition } from './model';
import { studyCopy } from './copy';
import { CardPreview } from '../CardPreview';
import { StudyComparison } from './StudyComparison';
import './study.css';

export function StudyScreens({ study, recordings, cards, busy, status, onStart, onReplay, onExport, onNew, onWorkspace, onPreview }: {
  study: StudyDefinition; recordings: Array<RecordingSession | undefined>; cards: CardData[]; busy: boolean; status: string;
  onStart: (index: number) => void; onReplay: (recording: RecordingSession) => void; onExport: () => void;
  onNew: () => void;
  onWorkspace: () => void; onPreview: (card: CardData) => void;
}) {
  const next = recordings.findIndex(r => !r?.studyRound?.completedAt);
  const finished = next < 0;
  const previous = next > 0 ? recordings[next - 1] : undefined;
  const copy = studyCopy(study);
  const previousScores = previous && !finished ? studyScores(study, previous) : new Map<string, number>();
  return <div className="studyShell">
    <header className="studyHeader"><span><PanelsTopLeft />SortBoard <span className="studyHeader__divider">/</span> Q-Sort</span>
      <button className="btn btn--ghost btn--tiny" onClick={onWorkspace} disabled={busy}>Workspace</button></header>
    <main className={`studyPage${finished ? ' studyPage--comparison' : ''}`} lang={study.taskLanguage || 'en'} aria-busy={busy}>
      <p className="studyEyebrow">{finished ? copy.completed : next > 0 ? `Round ${next} of ${study.rounds.length} · ${copy.saved}` : copy.introduction}</p>
      <h1>{finished ? copy.comparison : next > 0 ? copy.reflection : study.title}</h1>
      {previous && !finished ? <section className="studyReflection" aria-label="Discuss this round">
        <p><Check />{previous.studyRound?.title} {copy.saved}</p>
        <div className="studyResultHeading"><h2>{previous.studyRound?.title}: {copy.result}</h2>
          <button className="btn btn--ghost" disabled={busy} onClick={() => onReplay(previous)}><Play />Replay round {next}</button>
        </div>
        <p>{previous.studyRound?.prompt}</p>
        <div className="studyRoundResult" aria-label="Saved round result" style={{ gridTemplateColumns: `repeat(${study.scale.length}, minmax(0, 1fr))` }}>
          {study.scale.map(position => <div key={position.value}><strong>{position.label}</strong>
            {cards.filter(card => previousScores.get(card.id) === position.value).map(card => <button key={card.id}
              className="studyResultImage" aria-label={`Enlarge image ${card.meta.name}`} onClick={() => onPreview(card)}>
              <CardPreview card={card} showPreviewButton={false} /><span>{card.meta.name}</span></button>)}
          </div>)}
        </div>
        <h2>{copy.discuss}</h2>
        <ul>{copy.roundQuestions.map(q => <li key={q}>{q}</li>)}</ul>
      </section> : !finished ? <>
        <p className="studyIntro">{study.introduction}</p>
        <div className="studySteps">{copy.steps.map(step => <span key={step}>{step}</span>)}</div>
        {copy.instructions.map(text => <p key={text}>{text}</p>)}
        <details className="studyCompanions"><summary>{copy.rolesTitle}</summary><p>{copy.roles}</p></details>
        <p className="hint">{copy.local}</p>
      </> : null}
      {!finished ? <section className="studyNext">
        <p className="studyEyebrow">Round {next + 1} of {study.rounds.length} · {study.rounds[next].title}</p>
        <h2>{study.rounds[next].prompt}</h2>
        {next > 0 ? <p>{copy.nextRound}</p> : null}
        <button className="btn studyPrimary" disabled={busy} onClick={() => onStart(next)}>
          {recordings[next] ? `Resume round ${next + 1}` : next ? `Continue to round ${next + 1}` : 'Start sorting'}<ArrowRight /></button>
      </section> : <>
        <StudyComparison key={`${study.id}:${recordings.map(r => r?.createdAt).join(':')}`} study={study} recordings={recordings} cards={cards} busy={busy} onReplay={onReplay} onPreview={onPreview} />
        {copy.compareQuestions.length ? <details className="studyComparisonQuestions"><summary>Discussion prompts</summary>
          <ul>{copy.compareQuestions.map(q => <li key={q}>{q}</li>)}</ul>
        </details> : null}
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
