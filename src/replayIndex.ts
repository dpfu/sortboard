import type { CardData, DragSegment, RecordingSession, RecordingSegment, StaticMoveMember } from './types';
import { getDefaultActiveStageId } from './workflow';

export type Keyframe = {
  t: number;
  x: number;
  y: number;
  state?: 'dragging' | 'settling' | 'idle';
};

export type Track = {
  cardId: string;
  frames: Keyframe[];
};

export type TimelineMarker = {
  t: number;
  kind: 'cluster';
  score: number;
};

export type ReplayIndex = {
  durationMs: number;
  segments: RecordingSegment[];
  stageTransitions: Array<{ t: number; toStageId: string }>;
  assignmentFrames: Array<{
    t: number;
    changes: NonNullable<DragSegment['widgetAssignmentChanges']>;
  }>;
  tracks: Map<string, Track>;
  markers: TimelineMarker[];
};

function lerp(a: number, b: number, u: number) {
  return a + (b - a) * u;
}

function binarySearchFrameIndex(frames: Keyframe[], t: number) {
  // returns i such that frames[i].t <= t < frames[i+1].t (clamped)
  let lo = 0;
  let hi = frames.length - 1;
  if (hi <= 0) return 0;
  if (t <= frames[0].t) return 0;
  if (t >= frames[hi].t) return hi;

  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

function pushFrame(track: Track, frame: Keyframe) {
  const last = track.frames[track.frames.length - 1];
  if (last && last.t === frame.t && last.x === frame.x && last.y === frame.y) return;
  track.frames.push(frame);
}

function addSegmentToTrack(track: Track, seg: DragSegment) {
  // path points
  for (const p of seg.path) {
    pushFrame(track, { t: p[0], x: p[1], y: p[2], state: 'dragging' });
  }
  // drop at t1
  pushFrame(track, { t: seg.t1, x: seg.drop.x, y: seg.drop.y, state: 'settling' });

  const settleMs = seg.settleMs ?? 0;
  const tFinal = seg.t1 + settleMs;
  pushFrame(track, { t: tFinal, x: seg.final.x, y: seg.final.y, state: 'idle' });
}

function addGroupMemberSegmentToTrack(track: Track, seg: DragSegment, member: NonNullable<DragSegment['groupMembers']>[number]) {
  const offsetX = member.from.x - seg.from.x;
  const offsetY = member.from.y - seg.from.y;
  for (const p of seg.path) {
    pushFrame(track, { t: p[0], x: p[1] + offsetX, y: p[2] + offsetY, state: 'dragging' });
  }
  pushFrame(track, { t: seg.t1, x: member.drop.x, y: member.drop.y, state: 'settling' });

  const settleMs = seg.settleMs ?? 0;
  const tFinal = seg.t1 + settleMs;
  pushFrame(track, { t: tFinal, x: member.final.x, y: member.final.y, state: 'idle' });
}

function addStaticMemberSegmentToTrack(
  track: Track,
  seg: Pick<RecordingSegment, 't1' | 'settleMs'>,
  member: StaticMoveMember
) {
  pushFrame(track, { t: seg.t1, x: member.from.x, y: member.from.y, state: 'settling' });
  const settleMs = seg.settleMs ?? 0;
  const tFinal = seg.t1 + settleMs;
  pushFrame(track, { t: tFinal, x: member.final.x, y: member.final.y, state: 'idle' });
}

export function buildReplayIndex(rec: RecordingSession): ReplayIndex {
  const tracks = new Map<string, Track>();

  // Initialize with t=0 snapshot.
  for (const c of rec.cardsAtStart) {
    tracks.set(c.id, { cardId: c.id, frames: [{ t: 0, x: c.x, y: c.y, state: 'idle' }] });
  }

  let durationMs = 0;
  const segs = [...rec.segments].sort((a, b) => a.t0 - b.t0);
  const stageTransitions = segs
    .filter((segment) => segment.type === 'stage-transition')
    .map((segment) => ({ t: segment.t0, toStageId: segment.toStageId }));
  const assignmentFrames = segs
    .flatMap((segment, order) => {
      if (!('widgetAssignmentChanges' in segment) || !segment.widgetAssignmentChanges?.length) return [];
      return [{
        t: segment.type === 'stage-transition' ? segment.t0 : segment.t1,
        order,
        changes: segment.widgetAssignmentChanges,
      }];
    })
    .sort((a, b) => a.t - b.t || a.order - b.order)
    .map(({ t, changes }) => ({ t, changes }));
  for (const seg of segs) {
    if (seg.type === 'drag') {
      let tr = tracks.get(seg.cardId);
      if (!tr) {
        tr = { cardId: seg.cardId, frames: [{ t: 0, x: seg.from.x, y: seg.from.y, state: 'idle' }] };
        tracks.set(seg.cardId, tr);
      }
      addSegmentToTrack(tr, seg);

      for (const member of seg.groupMembers || []) {
        let memberTrack = tracks.get(member.cardId);
        if (!memberTrack) {
          memberTrack = { cardId: member.cardId, frames: [{ t: 0, x: member.from.x, y: member.from.y, state: 'idle' }] };
          tracks.set(member.cardId, memberTrack);
        }
        addGroupMemberSegmentToTrack(memberTrack, seg, member);
      }

      for (const member of seg.settleMembers || []) {
        let memberTrack = tracks.get(member.cardId);
        if (!memberTrack) {
          memberTrack = { cardId: member.cardId, frames: [{ t: 0, x: member.from.x, y: member.from.y, state: 'idle' }] };
          tracks.set(member.cardId, memberTrack);
        }
        addStaticMemberSegmentToTrack(memberTrack, seg, member);
      }
    } else {
      for (const member of seg.members) {
        let memberTrack = tracks.get(member.cardId);
        if (!memberTrack) {
          memberTrack = { cardId: member.cardId, frames: [{ t: 0, x: member.from.x, y: member.from.y, state: 'idle' }] };
          tracks.set(member.cardId, memberTrack);
        }
        addStaticMemberSegmentToTrack(memberTrack, seg, member);
      }
    }

    const segEnd = seg.t1 + (seg.settleMs ?? 0);
    if (segEnd > durationMs) durationMs = segEnd;
  }

  // Ensure monotonic by sorting frames for each track.
  for (const tr of tracks.values()) {
    tr.frames.sort((a, b) => a.t - b.t);
  }

  // Keep duration at least 1ms to avoid weird slider ranges.
  durationMs = Math.max(1, Math.round(durationMs));

  // ---- Derived timeline markers: cluster-change spikes (edgeDiff) ----
  // Heuristic: adjacency edges based on center-distance threshold.
  const threshold = 0.85 * rec.cardW;

  function edgeKey(a: string, b: string) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function edgesForPose(pose: Map<string, { x: number; y: number }>) {
    const ids = Array.from(pose.keys());
    const centers = ids.map((id) => {
      const p = pose.get(id)!;
      return { id, cx: p.x + rec.cardW / 2, cy: p.y + rec.cardH / 2 };
    });

    const edges = new Set<string>();
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const dx = centers[i].cx - centers[j].cx;
        const dy = centers[i].cy - centers[j].cy;
        if (dx * dx + dy * dy < threshold * threshold) {
          edges.add(edgeKey(centers[i].id, centers[j].id));
        }
      }
    }
    return edges;
  }

  function symDiffSize(a: Set<string>, b: Set<string>) {
    let n = 0;
    for (const k of a) if (!b.has(k)) n += 1;
    for (const k of b) if (!a.has(k)) n += 1;
    return n;
  }

  // Use poseAt() after we've built tracks.
  const tmpIndex: ReplayIndex = {
    durationMs,
    segments: segs,
    stageTransitions,
    assignmentFrames,
    tracks,
    markers: [],
  };
  let prevEdges: Set<string> | null = null;
  const markers: TimelineMarker[] = [];

  for (const seg of segs) {
    const t = Math.round(seg.t1 + (seg.settleMs ?? 0));
    const pose = poseAt(tmpIndex, t);
    const edges = edgesForPose(pose);

    if (prevEdges) {
      const score = symDiffSize(edges, prevEdges);
      markers.push({ t, kind: 'cluster', score });
    }

    prevEdges = edges;
  }

  return { durationMs, segments: segs, stageTransitions, assignmentFrames, tracks, markers };
}

export function poseAt(index: ReplayIndex, tMs: number) {
  const t = Math.max(0, Math.min(index.durationMs, tMs));
  const pose = new Map<string, { x: number; y: number }>();

  for (const [cardId, track] of index.tracks.entries()) {
    const frames = track.frames;
    if (frames.length === 0) continue;
    if (frames.length === 1) {
      pose.set(cardId, { x: frames[0].x, y: frames[0].y });
      continue;
    }

    const i = binarySearchFrameIndex(frames, t);
    const a = frames[i];
    const b = frames[Math.min(i + 1, frames.length - 1)];

    if (!a || !b) continue;
    if (a.t === b.t) {
      pose.set(cardId, { x: a.x, y: a.y });
      continue;
    }

    const u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    pose.set(cardId, { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) });
  }

  return pose;
}

export function applyPoseToCards(cards: CardData[], pose: Map<string, { x: number; y: number }>) {
  return cards.map((c) => {
    const p = pose.get(c.id);
    return p && (c.x !== p.x || c.y !== p.y) ? { ...c, x: p.x, y: p.y } : c;
  });
}

function applyAssignmentChanges(
  cards: CardData[],
  changes: NonNullable<DragSegment['widgetAssignmentChanges']>
) {
  if (changes.length === 0) return cards;
  const byCardId = new Map<string, typeof changes>();
  for (const change of changes) {
    const cardChanges = byCardId.get(change.cardId);
    if (cardChanges) cardChanges.push(change);
    else byCardId.set(change.cardId, [change]);
  }
  return cards.map((card) => {
    const cardChanges = byCardId.get(card.id);
    if (!cardChanges) return card;
    const nextAssignments = { ...(card.widgetAssignments || {}) };
    for (const change of cardChanges) {
      if (change.assignment) nextAssignments[change.stageId] = { ...change.assignment };
      else delete nextAssignments[change.stageId];
    }
    return {
      ...card,
      widgetAssignments: Object.keys(nextAssignments).length > 0 ? nextAssignments : undefined,
    };
  });
}

export function replayStageIdAt(recording: RecordingSession, index: ReplayIndex, tMs: number) {
  let stageId = recording.activeStageIdAtStart || getDefaultActiveStageId(recording.workflowAtStart);
  if (tMs <= 0) return stageId || null;
  for (const transition of index.stageTransitions) {
    if (transition.t > tMs) break;
    stageId = transition.toStageId;
  }
  return stageId || null;
}

export function replayCardsAt(recording: RecordingSession, index: ReplayIndex, tMs: number) {
  if (tMs <= 0) return recording.cardsAtStart;
  const latestChanges = new Map<string, NonNullable<DragSegment['widgetAssignmentChanges']>[number]>();
  for (const frame of index.assignmentFrames) {
    if (frame.t > tMs) break;
    for (const change of frame.changes) {
      latestChanges.set(`${change.cardId}\u0000${change.stageId}`, change);
    }
  }
  const cardsWithAssignments = applyAssignmentChanges(
    recording.cardsAtStart,
    Array.from(latestChanges.values())
  );
  return applyPoseToCards(cardsWithAssignments, poseAt(index, tMs));
}
