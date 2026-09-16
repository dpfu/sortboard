import * as React from 'react';
import { ArrowRight, Check, FilePlus2, LayoutDashboard, Columns3, SlidersHorizontal, Table2, Upload, X } from 'lucide-react';
import { createDemoArchive, demoAssetUrl, demoDistribution, loadDemoCatalog, type DemoCatalog } from './demoProjects';

export function DemoProjectDialog({ onClose, onImport, firstVisit = false, onNewProject, onImportProject }: {
  onClose: () => void; onImport: (archive: Blob) => Promise<void>; firstVisit?: boolean;
  onNewProject?: () => void; onImportProject?: () => void;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [catalog, setCatalog] = React.useState<DemoCatalog | null>(null);
  const [presetId, setPresetId] = React.useState('closed-sort-15');
  const [customize, setCustomize] = React.useState(false);
  const [selected, setSelected] = React.useState(new Set<string>());
  const [busy, setBusy] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [progress, setProgress] = React.useState('');
  const [error, setError] = React.useState('');
  const [attempt, setAttempt] = React.useState(0);
  const requestRef = React.useRef<AbortController | null>(null);
  const preset = catalog?.presets.find(item => item.id === presetId);

  React.useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
    return () => { requestRef.current?.abort(); previous?.focus(); };
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    setError('');
    void loadDemoCatalog(controller.signal).then(value => {
      setCatalog(value);
      const suggested = value.presets.find(preset => preset.type === 'closed') || value.presets[0];
      setPresetId(suggested.id);
      setSelected(new Set(suggested.imageIds));
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load demos.'); });
    return () => controller.abort();
  }, [attempt]);

  async function createProject() {
    if (!catalog || !preset || busy) return;
    setBusy(true); setError(''); setProgress('Preparing your demo...');
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const archive = await createDemoArchive(catalog, preset, selected, controller.signal, setProgress);
      setImporting(true);
      await onImport(archive);
      onClose();
    } catch (reason) {
      setError(controller.signal.aborted ? 'Demo creation cancelled. Your current project is unchanged.' : reason instanceof Error ? reason.message : 'Could not create the demo project. Please try again.');
    } finally { setBusy(false); setImporting(false); setProgress(''); }
  }

  return (
    <dialog className="demoDialog" ref={dialogRef} aria-labelledby="demo-title" onCancel={event => {
      event.preventDefault(); if (!busy) onClose();
    }}>
      <header className="demoDialog__header">
        <div><h2 id="demo-title">{firstVisit ? 'Try SortBoard' : 'Demo projects'}</h2><p>Sort a set of images, then replay your session.</p></div>
        <button className={`btn btn--ghost ${firstVisit ? '' : 'btn--icon'}`} type="button" aria-label={firstVisit ? 'Open starter board' : 'Close'} title={firstVisit ? undefined : 'Close'} onClick={onClose} disabled={busy}>{firstVisit ? <>Open starter board<ArrowRight /></> : <X />}</button>
      </header>
      <div className="demoDialog__body" aria-busy={busy}>
        {!catalog && !error ? <p role="status">Loading demo library...</p> : null}
        {catalog && preset ? <>
          <fieldset className="demoDialog__presets" disabled={busy}>
            <legend>Sort type</legend>
            {catalog.presets.map(item => <label className={`demoPreset ${item.id === presetId ? 'isActive' : ''}`} key={item.id}>
              <input type="radio" name="demo-preset" value={item.id} checked={item.id === presetId} onChange={() => {
                setPresetId(item.id); setSelected(new Set(item.imageIds)); setError('');
              }} />
              <span><strong>{item.type === 'open' ? <LayoutDashboard /> : item.type === 'closed' ? <Columns3 /> : <Table2 />}{item.type === 'open' ? 'Open sort' : item.type === 'closed' ? 'Closed sort' : 'Q-Sort'}</strong><small>{item.name.split(' - ')[1]} · {item.imageIds.length} images</small>{item.type === 'closed' ? <small className="demoPreset__suggested">Suggested first try</small> : null}</span>
            </label>)}
          </fieldset>
          <p className="demoDialog__instructions">{preset.instructions}</p>
          <div className="demoDialog__customizeRow"><strong>{selected.size} images</strong><button className="btn btn--ghost btn--tiny" type="button" disabled={busy} aria-expanded={customize} onClick={() => setCustomize(value => !value)}>{customize ? <Check /> : <SlidersHorizontal />}{customize ? 'Done customizing' : 'Customize images'}</button></div>
          {!customize ? <div className="demoDialog__preview" aria-label="Preview of selected images">{catalog.images.filter(image => selected.has(image.id)).slice(0, 6).map(image => <img key={image.id} src={demoAssetUrl(image.file)} alt="" />)}</div> : <>
          <div className="demoDialog__selection">
            <strong>{selected.size} images selected</strong>
            <button className="btn btn--ghost btn--tiny" disabled={busy} onClick={() => setSelected(new Set(preset.imageIds))}>Use suggested images</button>
            <button className="btn btn--ghost btn--tiny" disabled={busy} onClick={() => setSelected(new Set(catalog.images.map(image => image.id)))}>Select all</button>
            <button className="btn btn--ghost btn--tiny" disabled={busy} onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
          <p className="hint">{preset.type === 'qsort' ? `Distribution: ${demoDistribution(preset, selected.size).join(' / ')}. Capacities follow your image count. ` : ''}Clear the selection to start with an empty template and add your own images later.</p>
          <details className="demoDialog__provenance"><summary>About these images</summary><p>All 60 images are AI-generated: 30 DiffusionDB images from 2022 and 30 Imagegen images from 2026 made with the same prompts. Closed Sort asks about perceived origin. Prompts and source details are saved in card Notes and are visible in Setup. The demo uses resized WebP copies without cropping.</p><a href={demoAssetUrl('README.md')} target="_blank" rel="noreferrer">Sources and image preparation</a></details>
          <fieldset className="demoDialog__images" disabled={busy}>
            <legend>Include images</legend>
            {catalog.images.map(image => <label key={image.id} className={`demoImage ${selected.has(image.id) ? 'isSelected' : ''}`}>
              <img src={demoAssetUrl(image.file)} alt="" loading="lazy" />
              <span><input type="checkbox" checked={selected.has(image.id)} aria-label={`Include ${image.meta.name}`} onChange={event => {
                const checked = event.currentTarget.checked;
                setSelected(previous => { const next = new Set(previous); if (checked) next.add(image.id); else next.delete(image.id); return next; });
              }} /><strong>{image.meta.name}</strong></span>
              <small>{image.title}</small><small>{image.source} · Pair {image.pairId}</small>
            </label>)}
          </fieldset>
          </>}
        </> : null}
      </div>
      {firstVisit ? <div className="demoDialog__ownProject"><span>Use your own material</span><button className="btn btn--ghost" disabled={busy} onClick={onNewProject}><FilePlus2 />New project</button><button className="btn btn--ghost" disabled={busy} onClick={onImportProject}><Upload />Import project</button></div> : null}
      <footer className="demoDialog__footer">
        {error ? <p role="alert">{error}</p> : <p role="status">{progress || 'Stored in this browser. Export to share.'}</p>}
        <div>{busy && !importing ? <button className="btn btn--ghost" onClick={() => requestRef.current?.abort()}>Cancel</button> : null}{!catalog && error ? <button className="btn" onClick={() => setAttempt(value => value + 1)}>Retry</button> : null}
          {catalog ? <button className="btn" disabled={busy} onClick={() => void createProject()}>{busy ? 'Creating...' : selected.size ? `Open demo with ${selected.size} images` : 'Create empty template'}{!busy ? <ArrowRight /> : null}</button> : null}</div>
      </footer>
    </dialog>
  );
}
