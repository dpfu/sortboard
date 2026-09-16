import * as React from 'react';

export function useElementSize<T extends HTMLElement>(ref: React.RefObject<T>) {
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const observed = React.useRef<T | null>(null);
  const observer = React.useRef<ResizeObserver | null>(null);

  // A stable ref can point to a new node when Setup, Sort, or Replay mounts.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el === observed.current) return;
    observer.current?.disconnect();
    observed.current = el;
    if (!el) return;

    const update = (width: number, height: number) => {
      if (observed.current !== el) return;
      setSize(current => current.width === width && current.height === height ? current : { width, height });
    };
    update(el.clientWidth, el.clientHeight);

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const cr = entry.contentRect;
      update(cr.width, cr.height);
    });

    ro.observe(el);
    observer.current = ro;
  });

  React.useLayoutEffect(() => () => {
    observer.current?.disconnect();
    observed.current = null;
  }, []);

  return size;
}
