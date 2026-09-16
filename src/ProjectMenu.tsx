import * as React from 'react';
import { ChevronDown, Folder, SlidersHorizontal } from 'lucide-react';

export function ProjectMenu({ name, disabled, children, label = 'Project menu' }: { name: string; disabled: boolean; children: React.ReactNode; label?: string }) {
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const panelId = React.useId();
  React.useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="projectMenu" ref={root}>
    <button ref={button} className="projectMenu__trigger" type="button" aria-label={label} title={name} aria-expanded={open} aria-controls={panelId} disabled={disabled} onClick={() => setOpen(value => !value)}>
      {label === 'Project menu' ? <Folder /> : <SlidersHorizontal />}<span className="projectMenu__name">{name}</span><ChevronDown className="projectMenu__chevron" />
    </button>
    {open ? <div id={panelId} className="projectMenu__panel" onChange={event => { if (event.target instanceof HTMLSelectElement) { setOpen(false); button.current?.focus(); } }} onClick={event => { if ((event.target as HTMLElement).closest('button')) { setOpen(false); button.current?.focus(); } }}>{children}</div> : null}
  </div>;
}
