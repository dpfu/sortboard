import * as React from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import { buildNormalDistributionBuckets } from '../workflow';
import type { SortWorkflowData } from '../types';
import { normalizeStudy, type StudyDefinition } from './model';
import { studyCopy } from './copy';
import './study.css';

export function StudySetupDialog({ study, projectName, instructions, workflow, cardCount, onSave, onClose }: {
  study?: StudyDefinition; projectName: string; instructions?: string; workflow: SortWorkflowData; cardCount: number;
  onSave: (study: StudyDefinition) => Promise<void>; onClose: () => void;
}) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const legacyPreSort = !study ? workflow.widgets.find(w => w.kind === 'pre-sort') : undefined;
  const initialPreSort = study?.preSort || (legacyPreSort?.kind === 'pre-sort'
    ? { labels: legacyPreSort.zones.map(zone => zone.label) as [string, string] } : undefined);
  const [draft, setDraft] = React.useState<StudyDefinition>(() => {
    if (study) return normalizeStudy(study)!;
    const widget = workflow.widgets.find(w => w.kind === 'qsort');
    const buckets = widget?.buckets || buildNormalDistributionBuckets(cardCount, 7);
    return { version: 1, id: nanoid(), title: projectName, introduction: '', reference: '', credits: '',
      anchors: { disagree: 'Disagree', undecided: 'Undecided', agree: 'Agree' },
      ...(initialPreSort ? { preSort: initialPreSort } : {}),
      scale: buckets.map((b, i) => ({ value: Number.isFinite(Number(b.label)) ? Number(b.label) : i - Math.floor(buckets.length / 2), label: b.label, capacity: b.capacity })),
      rounds: [{ id: nanoid(), title: 'Round 1', prompt: instructions || '' }] };
  });
  const [preSortLabels, setPreSortLabels] = React.useState<[string, string]>(initialPreSort?.labels || ['More', 'Less']);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const anchors = studyCopy(draft).scale;
  const capacity = draft.scale.reduce((sum, s) => sum + s.capacity, 0);
  React.useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, []);
  const patch = (value: Partial<StudyDefinition>) => { setError(''); setDraft(d => ({ ...d, ...value })); };
  const fitScale = (count: number) => patch({ scale: buildNormalDistributionBuckets(cardCount, count).map((b, i) => ({
    value: i - Math.floor(count / 2), label: b.label, capacity: b.capacity,
  })) });
  const updateScale = (index: number, value: Partial<StudyDefinition['scale'][number]>) => patch({ scale: draft.scale.map((s, i) => i === index ? { ...s, ...value } : s) });
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (capacity !== cardCount) { setError(`The grid has ${capacity} places for ${cardCount} cards. Fit the distribution or adjust the places.`); return; }
    if (draft.rounds.some(r => !r.prompt.trim())) { setError('Enter a task for every round.'); return; }
    setBusy(true);
    try { await onSave(normalizeStudy({ ...draft, ...(draft.preSort ? { preSort: { labels: preSortLabels } } : {}) })!); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save the design. Please try again.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="studySetup" aria-labelledby="qsort-design-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={event => void save(event)}>
      <header><h2 id="qsort-design-title">Q-Sort design</h2><button type="button" className="btn btn--ghost btn--icon" aria-label="Close" disabled={busy} onClick={onClose}><X /></button></header>
      <fieldset disabled={busy} className="studySetup__body">
        <section><h3>Tasks</h3>
          {draft.rounds.map((round, index) => <div key={round.id} className="studySetup__round">
            <div className="studySetup__row"><label>Round {index + 1} title<input aria-label={`Round ${index + 1} title`} value={round.title} required onChange={e => patch({ rounds: draft.rounds.map((r, i) => i === index ? { ...r, title: e.target.value } : r) })} /></label>
              <button className="btn btn--ghost btn--icon" type="button" aria-label={`Remove round ${index + 1}`} disabled={draft.rounds.length === 1} onClick={() => patch({ rounds: draft.rounds.filter((_, i) => i !== index) })}><Trash2 /></button></div>
            <label>Task<textarea aria-label={`Task for round ${index + 1}`} rows={2} value={round.prompt} required placeholder="What should participants sort by?" onChange={e => patch({ rounds: draft.rounds.map((r, i) => i === index ? { ...r, prompt: e.target.value } : r) })} /></label>
          </div>)}
          <button className="btn btn--ghost btn--tiny" type="button" onClick={() => patch({ rounds: [...draft.rounds, { id: nanoid(), title: `Round ${draft.rounds.length + 1}`, prompt: '' }] })}><Plus />Add round</button>
        </section>
        <section><h3>Scale</h3>
          <div className="studySetup__anchors">{(['disagree', 'undecided', 'agree'] as const).map((key, i) => <label key={key}>{['Left label', 'Middle label', 'Right label'][i]}<input value={anchors[key]} onChange={e => patch({ anchors: { ...anchors, [key]: e.target.value } })} /></label>)}</div>
          <div className="studySetup__row"><label>Scale positions<select aria-label="Scale positions" value={draft.scale.length} onChange={e => fitScale(Number(e.target.value))}>{Array.from({ length: 13 }, (_, i) => i + 3).map(n => <option key={n} value={n}>{n}</option>)}</select></label>
            <button type="button" className="btn btn--ghost btn--tiny" onClick={() => {
              const fitted = buildNormalDistributionBuckets(cardCount, draft.scale.length);
              patch({ scale: draft.scale.map((s, i) => ({ ...s, capacity: fitted[i].capacity })) });
            }}>Fit to {cardCount} cards</button><output className={capacity === cardCount ? '' : 'studySetup__invalid'}>{capacity} / {cardCount} places</output></div>
          <table className="studySetup__scale"><thead><tr><th>Value</th><th>Label</th><th>Places</th></tr></thead><tbody>{draft.scale.map((s, i) => <tr key={i}>
            <td><input type="number" step="any" aria-label={`Value at position ${i + 1}`} value={s.value} required onChange={e => updateScale(i, { value: Number(e.target.value) })} /></td>
            <td><input aria-label={`Label at position ${i + 1}`} value={s.label} required onChange={e => updateScale(i, { label: e.target.value })} /></td>
            <td><input type="number" min={0} step={1} aria-label={`Places at position ${i + 1}`} value={s.capacity} required onChange={e => updateScale(i, { capacity: Number(e.target.value) })} /></td>
          </tr>)}</tbody></table>
        </section>
        <section><h3>Flow</h3><label className="studySetup__check"><input type="checkbox" checked={!!draft.preSort} onChange={e => patch({ preSort: e.target.checked ? { labels: preSortLabels } : undefined })} />Pre-sort before each round</label>
          {draft.preSort ? <div className="studySetup__anchors">{preSortLabels.map((value, i) => <label key={i}>Group {i + 1}<input required value={value} onChange={e => setPreSortLabels(labels => labels.map((v, n) => n === i ? e.target.value : v) as [string, string])} /></label>)}</div> : null}
          <label>Exercise language<select aria-label="Exercise language" value={draft.taskLanguage || 'en'} onChange={e => patch({ taskLanguage: e.target.value === 'de' ? 'de' : undefined })}><option value="en">English</option><option value="de">German</option></select></label>
          <details><summary>Introduction and discussion</summary>
            <label>Introduction<textarea rows={3} value={draft.introduction} onChange={e => patch({ introduction: e.target.value })} /></label>
            <label>Discussion questions <span className="hint">One per line</span><textarea rows={3} value={(draft.discussionQuestions || studyCopy(draft).roundQuestions).join('\n')} onChange={e => patch({ discussionQuestions: e.target.value.split('\n').filter(Boolean) })} /></label>
            {draft.rounds.length > 1 ? <label>Comparison questions <span className="hint">One per line</span><textarea rows={3} value={(draft.comparisonQuestions || studyCopy(draft).compareQuestions).join('\n')} onChange={e => patch({ comparisonQuestions: e.target.value.split('\n').filter(Boolean) })} /></label> : null}
          </details>
        </section>
      </fieldset>
      <footer>{error ? <p role="alert">{error}</p> : null}<button type="button" className="btn btn--ghost" disabled={busy} onClick={onClose}>Cancel</button><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save design'}</button></footer>
    </form>
  </dialog>;
}
