import * as React from 'react';
import { ArrowRight, FilePlus2, FolderOpen, PanelsTopLeft, Upload } from 'lucide-react';

export function WelcomeDialog({ busy, status, onBlank, onDemo, onImport }: {
  busy: boolean;
  status: string;
  onBlank: () => void;
  onDemo: () => void;
  onImport: () => void;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return <dialog className="welcomeDialog" ref={dialogRef} aria-labelledby="welcome-title"
    onCancel={event => event.preventDefault()}>
    <div className="welcomeDialog__brand"><PanelsTopLeft aria-hidden="true" />SortBoard</div>
    <h1 id="welcome-title">Welcome to SortBoard</h1>
    <p className="welcomeDialog__intro">A local sorting tool for images, text and video.</p>
    <p className="welcomeDialog__privacy">SortBoard runs in your browser. Your projects and recordings stay on this device. Nothing you add is uploaded to a server or cloud service.</p>
    <div className="welcomeDialog__choices">
      <button className="welcomeChoice" type="button" disabled={busy} onClick={onBlank}>
        <FilePlus2 aria-hidden="true" />
        <strong>Start with a blank project</strong>
        <span>Bring your own images, text or videos.</span>
        <ArrowRight aria-hidden="true" />
      </button>
      <button className="welcomeChoice welcomeChoice--demo" type="button" disabled={busy} onClick={onDemo}>
        <FolderOpen aria-hidden="true" />
        <strong>Start with a demo project</strong>
        <span>Try a prepared Open, Closed or Q-Sort.</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </div>
    <footer className="welcomeDialog__footer">
      <button className="btn btn--ghost btn--tiny" type="button" disabled={busy} onClick={onImport}><Upload />Import project</button>
      {status ? <p role={/failed/i.test(status) ? 'alert' : 'status'}>{status}</p> : null}
    </footer>
  </dialog>;
}
