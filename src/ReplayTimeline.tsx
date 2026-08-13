import * as React from 'react';
import type { RecordingSegment, RecordingSession } from './types';

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

export function formatTimeMs(tMs: number) {
  const t = Math.max(0, Math.round(tMs));
  const ms = t % 1000;
  const s = Math.floor(t / 1000) % 60;
  const m = Math.floor(t / 60000);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  const mss = String(ms).padStart(3, '0');
  return `${mm}:${ss}.${mss}`;
}

type Props = {
  recordingSession: RecordingSession;
  durationMs: number;
  timeMs: number;
  clusterMarkers?: Array<{ t: number; score: number }>;
  onTimeChange: (tMs: number) => void;
};

function segmentWeight(seg: RecordingSegment) {
  if (seg.type !== 'drag') {
    return 36;
  }
  const dx = seg.final.x - seg.from.x;
  const dy = seg.final.y - seg.from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist;
}

export function ReplayTimeline({ recordingSession, durationMs, timeMs, clusterMarkers, onTimeChange }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  const draw = React.useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;

    const cssW = el.clientWidth || 1;
    const cssH = 40;

    const dpr = window.devicePixelRatio || 1;
    el.style.height = `${cssH}px`;
    const pixelWidth = Math.floor(cssW * dpr);
    const pixelHeight = Math.floor(cssH * dpr);
    if (el.width !== pixelWidth) el.width = pixelWidth;
    if (el.height !== pixelHeight) el.height = pixelHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, cssW, cssH);

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    ctx.fillRect(0, 0, cssW, cssH);

    const dur = Math.max(1, durationMs);

    // Drag markers (blocks)
    for (const seg of recordingSession.segments) {
      const t0 = seg.t0;
      const t1 = seg.t1;
      const x0 = (t0 / dur) * cssW;
      const x1 = (t1 / dur) * cssW;

      const dist = segmentWeight(seg);
      const h = Math.min(cssH - 6, 7 + dist / 30);

      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x0, cssH - h, Math.max(2, x1 - x0), h);
    }

    // Cluster markers (spikes)
    if (clusterMarkers && clusterMarkers.length) {
      const maxScore = Math.max(1, ...clusterMarkers.map((m) => m.score));
      for (const m of clusterMarkers) {
        const x = (m.t / dur) * cssW;
        const h = Math.min(cssH - 4, 4 + (m.score / maxScore) * (cssH - 8));
        ctx.strokeStyle = 'rgba(67, 152, 224, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, cssH);
        ctx.lineTo(x, cssH - h);
        ctx.stroke();
      }
    }

    // Playhead
    const px = (timeMs / dur) * cssW;
    ctx.strokeStyle = 'rgba(0,0,0,0.74)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, cssH);
    ctx.stroke();
  }, [clusterMarkers, durationMs, recordingSession.segments, timeMs]);

  React.useEffect(() => {
    draw();
  }, [draw]);

  const drawRef = React.useRef(draw);
  drawRef.current = draw;

  // Redraw on resize.
  React.useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => drawRef.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const updateFromClientX = React.useCallback(
    (clientX: number) => {
      const el = canvasRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const u = clamp01((clientX - r.left) / Math.max(1, r.width));
      onTimeChange(Math.round(u * durationMs));
    },
    [durationMs, onTimeChange]
  );

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
      updateFromClientX(e.clientX);
    },
    [updateFromClientX]
  );

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!(e.buttons & 1)) return;
      updateFromClientX(e.clientX);
    },
    [updateFromClientX]
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      const step = Math.max(100, Math.round(durationMs / 100));
      const pageStep = Math.max(1000, Math.round(durationMs / 10));
      let nextTime = timeMs;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextTime -= step;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextTime += step;
      else if (event.key === 'PageDown') nextTime -= pageStep;
      else if (event.key === 'PageUp') nextTime += pageStep;
      else if (event.key === 'Home') nextTime = 0;
      else if (event.key === 'End') nextTime = durationMs;
      else return;
      event.preventDefault();
      onTimeChange(Math.max(0, Math.min(durationMs, nextTime)));
    },
    [durationMs, onTimeChange, timeMs]
  );

  return (
    <canvas
      ref={canvasRef}
      data-testid="replay-timeline"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
      className="replayTimelineCanvas"
      role="slider"
      tabIndex={0}
      aria-label="Replay timeline"
      aria-valuemin={0}
      aria-valuemax={durationMs}
      aria-valuenow={Math.max(0, Math.min(durationMs, timeMs))}
      aria-valuetext={formatTimeMs(timeMs)}
    />
  );
}
