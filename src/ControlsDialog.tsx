import * as React from 'react';
import { X } from 'lucide-react';
import type { Mode, SortType } from './types';

export function ControlsDialog({ mode, sortType, stacksEnabled = true, taskLanguage, onClose }: { mode: Mode; sortType: SortType; stacksEnabled?: boolean; taskLanguage?: 'de'; onClose: () => void }) {
  const closeButton = React.useRef<HTMLButtonElement>(null);
  const close = React.useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key === 'Tab') { event.preventDefault(); closeButton.current?.focus(); }
    };
    window.addEventListener('keydown', keyDown);
    return () => { window.removeEventListener('keydown', keyDown); previous?.focus(); };
  }, []);
  const rows = taskLanguage === 'de' ? [
    ['Bilder ansehen', 'Doppelklick auf ein Bild vergrößert es. Close schließt die Ansicht. Mit der Tastatur: Bild fokussieren und Enter drücken.'],
    ...(mode === 'end' ? [['Entscheidungen nachverfolgen', 'Play recording startet das Replay. Pause hält an. Bewege den Zeitregler zu einer interessanten Stelle. Back to study führt zum Vergleich zurück.']] : [
      ['Bilder einordnen', 'Ziehe ein Bild auf einen freien Platz der Skala. Links bedeutet Ablehnung der Aussage, rechts Zustimmung. Die Reihen sind zusätzliche Plätze mit demselben Wert. Pfeiltasten bewegen ein fokussiertes Bild.'],
      ['Umsortieren', 'Du kannst Bilder jederzeit auf einen anderen freien Platz oder in die Ablage zurückziehen. Eine volle Spalte nimmt kein weiteres Bild an; die Karte kehrt zurück.'],
      ['Durchgang abschließen', 'Wenn alle zwölf Bilder eingeordnet sind, wird Finish round aktiv. Danach besprecht ihr die Entscheidungen. Pause unterbricht; Resume setzt den Durchgang später fort.'],
    ]),
    ['Vollbild', 'Das Symbol mit den vier Ecken wechselt in die Vollbildansicht. Esc verlässt sie, ohne die Sortierung zu löschen.'],
  ] : [
    ['Inspect an image or video', 'Double-click a card or use its preview icon. Keyboard: Alt + Enter in Setup, Enter while sorting. Esc closes the preview.'],
    ...(mode !== 'end' ? [['Move a card', 'Drag it to a new position. While sorting, arrow keys move a focused card.']] : [['Replay a session', 'Play from the beginning, or move along the timeline.']]),
    ...(sortType !== 'open' && mode !== 'end' ? [['Place cards on the board', 'Drop inside a category to assign a card; elsewhere it stays unsorted. Cards stay where you release them. Final Q-Sort uses fixed slots.']] : []),
    ...(sortType === 'open' ? [
      ['Move around the board', 'Drag empty space, or hold Space and drag over cards. Middle-button dragging also pans.'],
      ...(mode !== 'end' && stacksEnabled ? [['Create a stack', 'Drop cards onto one another. The outline previews the group before you let go.'], ['Name or move a stack', 'Double-click its name to edit it. Drag its label or border to move the group.']] : mode === 'end' ? [['Explore the result', 'Choose Free view in View to pan and zoom independently of the recording.']] : []),
    ] : []),
    ...(mode === 'setup' ? [['Edit cards or areas', 'Select a card or area header to open its details.'], ['Select several cards', 'Shift + drag draws a selection. Enter selects a focused card; Shift + Enter adds it.'], ['Undo setup changes', 'Use Undo or ⌘/Ctrl + Z.']] : []),
    ['Full screen', mode === 'setup' ? 'Open Display and choose Start in full screen to enter when sorting begins.' : 'Use Full screen to enter. Esc or Exit full screen returns to the window. Some browsers leave full screen before closing a preview with Esc; use Close to stay in full screen.'],
  ];
  return <div className="videoDialog" role="dialog" aria-modal="true" aria-labelledby="controls-title">
    <button className="videoDialog__backdrop" type="button" tabIndex={-1} aria-label="Close controls" onClick={onClose} />
    <div className="controlsDialog">
    <header><h2 id="controls-title">Controls</h2><button ref={closeButton} className="btn btn--ghost btn--icon" aria-label="Close" title="Close" onClick={onClose}><X /></button></header>
    <dl lang={taskLanguage || 'en'}>{rows.map(([term, description]) => <div key={term}><dt>{term}</dt><dd>{description}</dd></div>)}</dl>
    </div>
  </div>;
}
