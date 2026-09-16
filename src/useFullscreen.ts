import * as React from 'react';

export function useFullscreen() {
  const managedTarget = React.useRef<HTMLElement | null>(null);
  const [element, setElement] = React.useState<Element | null>(() => document.fullscreenElement || null);
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const supported = document.fullscreenEnabled === true;

  React.useEffect(() => {
    const update = () => setElement(document.fullscreenElement || null);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const enter = React.useCallback(async (target: HTMLElement | null) => {
    setMessage('');
    if (target && document.fullscreenElement === target) return true;
    if (!target || !document.fullscreenEnabled || !target.requestFullscreen) {
      setMessage('Full screen is unavailable in this browser. You can continue in this window.');
      return false;
    }
    setPending(true);
    try {
      // Invoke synchronously from the click, before awaiting persistence: the
      // browser requires transient user activation to enter full screen.
      await target.requestFullscreen();
      managedTarget.current = target;
      return document.fullscreenElement === target;
    } catch {
      setMessage('Full screen could not start. You can continue in this window.');
      return false;
    } finally {
      setElement(document.fullscreenElement || null);
      setPending(false);
    }
  }, []);

  const exit = React.useCallback(async (target: HTMLElement | null) => {
    if (!target || document.fullscreenElement !== target) return;
    setPending(true);
    try {
      await document.exitFullscreen();
    } catch {
      setMessage('Press Esc to leave full screen.');
    } finally {
      setElement(document.fullscreenElement || null);
      setPending(false);
    }
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return;
      // Dialogs can consume Escape first. Embedded browsers may deliver the
      // key to the page without performing the native full-screen exit.
      // A task runs after every key listener; microtasks can run between native listeners.
      window.setTimeout(() => {
        if (!event.defaultPrevented) void exit(managedTarget.current);
      }, 0);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exit]);

  const clearMessage = React.useCallback(() => setMessage(''), []);
  return { element, supported, pending, message, enter, exit, clearMessage };
}
