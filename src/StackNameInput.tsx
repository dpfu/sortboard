import * as React from 'react';

export function StackNameInput({ name, onCommit, onClose }: { name: string; onCommit: (name: string) => void; onClose: () => void }) {
  const [value, setValue] = React.useState(name);
  const cancelled = React.useRef(false);
  return <input className="stackHalo__handle stackHalo__nameInput" aria-label="Stack name" autoFocus value={value}
    onFocus={event => event.currentTarget.select()}
    onChange={event => setValue(event.currentTarget.value)}
    onPointerDown={event => event.stopPropagation()}
    onBlur={() => { if (!cancelled.current && value.trim()) onCommit(value.trim()); onClose(); }}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; onClose(); }
    }} />;
}
