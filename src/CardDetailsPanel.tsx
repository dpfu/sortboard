import * as React from 'react';
import {
  TEXT_CARD_COLOR_KEYS,
  type CardData,
  type CardMetadataV1,
  type CategoryWidgetData,
  type PreSortWidgetData,
  type QSortWidgetData,
  type StackData,
  type StackSortKey,
  type TextCardColorKey,
} from './types';
import { CardPreview } from './CardPreview';
import { formatDurationLabel } from './media';

export interface StackOption {
  id: string;
  name: string;
  count: number;
}

export interface ClosedContainerOption {
  id: string;
  name: string;
  count: number;
  kind: 'source' | 'target';
}

export type DetailsPanelContext =
  | { kind: 'none' }
  | {
      kind: 'multi';
      selectedCount: number;
      stackOptions: StackOption[];
      sharedStackId?: string | null;
      onCreateStack?: () => void;
      onAddToStack?: (stackId: string) => void;
      onRemoveFromStack?: () => void;
      onDeleteSelectedCards?: () => void;
    }
  | {
      kind: 'stack';
      stack: StackData;
      count: number;
      sortKey: StackSortKey;
      onUpdateName: (name: string) => void;
      onChangeSortKey: (key: StackSortKey) => void;
      onSort: () => void;
      onShuffle: () => void;
      onSplit: () => void;
    }
  | {
      kind: 'closed-target';
      widget: CategoryWidgetData;
      count: number;
      onUpdateName: (name: string) => void;
      onUpdateDescription: (description: string) => void;
      onUpdateCapacityMode: (mode: CategoryWidgetData['capacityMode']) => void;
      onUpdateCapacity: (capacity: number) => void;
      onUpdateAllowedTags: (tags: string[]) => void;
      onUpdateLayout: (layout: CategoryWidgetData['layout']) => void;
      onDelete: () => void;
    }
  | {
      kind: 'pre-sort-widget';
      widget: PreSortWidgetData;
      counts: [number, number];
      onUpdateTitle: (title: string) => void;
      onUpdateZoneLabel: (zoneId: string, label: string) => void;
    }
  | {
      kind: 'qsort-widget';
      widget: QSortWidgetData;
      laneCounts: number[];
      bucketCounts: number[];
      onUpdateTitle: (title: string) => void;
      onUpdateLaneLabel: (laneId: string, label: string) => void;
      onUpdateBucketLabel: (bucketId: string, label: string) => void;
      onUpdateBucketCapacity: (bucketId: string, capacity: number) => void;
      onGenerateNormalDistribution?: () => void;
    }
  | {
      kind: 'card';
      card: CardData;
      stack?: StackOption | null;
      stackOptions?: StackOption[];
      closedContainer?: ClosedContainerOption | null;
      onUpdateMeta: (patch: Partial<CardMetadataV1>) => void;
      onBeginMetaEdit?: () => void;
      onEndMetaEdit?: () => void;
      onDeleteCard: () => void;
      onBringToFront: () => void;
      onOpenPreview?: () => void;
      onAddToStack?: (stackId: string) => void;
      onRemoveFromStack?: () => void;
    };

export interface CardDetailsPanelProps {
  context: DetailsPanelContext;
  isDrawer?: boolean;
  onClose?: () => void;
}

function parseTagsInput(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatCardKind(kind: CardData['kind']) {
  if (kind === 'image') return 'Image card';
  if (kind === 'video') return 'Video card';
  return 'Text card';
}

const TEXT_CARD_COLOR_LABELS: Record<TextCardColorKey, string> = {
  slate: 'Slate',
  sand: 'Sand',
  mint: 'Mint',
  sky: 'Sky',
  rose: 'Rose',
  amber: 'Amber',
};

export function CardDetailsPanel({ context, isDrawer = false, onClose }: CardDetailsPanelProps) {
  const addableStacks =
    context.kind === 'multi' ? context.stackOptions : context.kind === 'card' ? context.stackOptions || [] : [];
  const [targetStackId, setTargetStackId] = React.useState(addableStacks[0]?.id || '');
  const panelRef = React.useRef<HTMLElement | null>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  const titleId = React.useId();
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (!isDrawer) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusTimer = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!panel?.contains(document.activeElement)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isDrawer]);

  React.useEffect(() => {
    if (context.kind !== 'multi' && context.kind !== 'card') {
      setTargetStackId('');
      return;
    }
    const options = context.kind === 'multi' ? context.stackOptions : context.stackOptions || [];
    if (options.some((option) => option.id === targetStackId)) return;
    setTargetStackId(options[0]?.id || '');
  }, [context, targetStackId]);

  const title =
    context.kind === 'stack'
      ? 'Stack'
      : context.kind === 'closed-target'
        ? 'Category'
        : context.kind === 'pre-sort-widget' || context.kind === 'qsort-widget'
          ? context.kind === 'pre-sort-widget'
            ? 'Pre-Sort'
            : 'Q-Sort'
        : context.kind === 'none' || context.kind === 'multi'
          ? 'Details'
          : 'Card';
  const cardMetaEditHandlers = context.kind === 'card'
    ? { onFocus: context.onBeginMetaEdit, onBlur: context.onEndMetaEdit }
    : {};

  return (
    <aside
      ref={panelRef}
      className={`detailsPanel ${isDrawer ? 'detailsPanel--drawer' : ''}`}
      aria-label={isDrawer ? undefined : title}
      aria-labelledby={isDrawer ? titleId : undefined}
      aria-modal={isDrawer ? true : undefined}
      role={isDrawer ? 'dialog' : undefined}
    >
      <div className="detailsPanel__headerRow">
        <div className="sectionTitle" id={titleId}>{title}</div>
        {isDrawer ? (
          <button ref={closeButtonRef} className="btn btn--ghost btn--tiny" type="button" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>

      {context.kind === 'none' ? (
        <div className="detailsPanel__empty">Select an item on the board to edit its details.</div>
      ) : null}

      {context.kind === 'multi' ? (
        <>
          <div className="detailsPanel__empty">
            <div>{context.selectedCount} cards selected.</div>
            <div className="hint">Shift-click cards or drag a selection box to select more.</div>
          </div>

          {context.onCreateStack || context.onRemoveFromStack || (context.onAddToStack && context.stackOptions.length > 0) ? (
            <div className="detailsPanel__section">
              <div className="detailsPanel__field">
                <label>Stack actions</label>
                <div className="detailsPanel__inlineActions">
                  {context.onCreateStack ? (
                    <button className="btn btn--ghost btn--tiny" type="button" onClick={context.onCreateStack}>
                      Create stack
                    </button>
                  ) : null}
                  {context.onRemoveFromStack && context.sharedStackId ? (
                    <button className="btn btn--ghost btn--tiny" type="button" onClick={context.onRemoveFromStack}>
                      Remove from stack
                    </button>
                  ) : null}
                </div>
              </div>

              {context.stackOptions.length > 0 && context.onAddToStack ? (
                <div className="detailsPanel__field">
                  <label htmlFor="multi-add-stack">Add to stack</label>
                  <div className="detailsPanel__inlineRow">
                    <select
                      id="multi-add-stack"
                      value={targetStackId}
                      onChange={(event) => setTargetStackId(event.currentTarget.value)}
                    >
                      {context.stackOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name} ({option.count})
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn--ghost btn--tiny"
                      type="button"
                      disabled={!targetStackId}
                      onClick={() => targetStackId && context.onAddToStack?.(targetStackId)}
                    >
                      Add
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="detailsPanel__actions">
            <button
              className="btn btn--ghost btn--tiny btn--dangerSoft"
              type="button"
              onClick={context.onDeleteSelectedCards}
            >
              Delete selected
            </button>
          </div>
        </>
      ) : null}

      {context.kind === 'stack' ? (
        <>
          <div className="detailsPanel__section">
            <div className="detailsPanel__field">
              <label htmlFor="stack-name">Name</label>
              <input
                id="stack-name"
                value={context.stack.name}
                onChange={(event) => context.onUpdateName(event.currentTarget.value)}
              />
            </div>

            <div className="detailsPanel__kv">
              <span>Cards</span>
              <span className="mono">{context.count}</span>
            </div>

            <div className="detailsPanel__field">
              <label htmlFor="stack-sort-key">Sort by</label>
              <select
                id="stack-sort-key"
                value={context.sortKey}
                onChange={(event) => context.onChangeSortKey(event.currentTarget.value as StackSortKey)}
              >
                <option value="name">Name</option>
                <option value="created">Date added</option>
              </select>
            </div>
          </div>

          <div className="detailsPanel__actions">
            <button className="btn btn--ghost btn--tiny" type="button" onClick={context.onSort}>
              Sort
            </button>
            <button className="btn btn--ghost btn--tiny" type="button" onClick={context.onShuffle}>
              Shuffle
            </button>
            <button className="btn btn--ghost btn--tiny" type="button" onClick={context.onSplit}>
              Split in half
            </button>
          </div>
        </>
      ) : null}

      {context.kind === 'closed-target' ? (
        <>
          <div className="detailsPanel__section">
            <div className="detailsPanel__field">
              <label htmlFor="closed-target-name">Name</label>
              <input
                id="closed-target-name"
                value={context.widget.title}
                onChange={(event) => context.onUpdateName(event.currentTarget.value)}
              />
            </div>

            <div className="detailsPanel__field">
              <label htmlFor="closed-target-description">Description</label>
              <textarea
                id="closed-target-description"
                rows={3}
                value={context.widget.description}
                onChange={(event) => context.onUpdateDescription(event.currentTarget.value)}
              />
            </div>

            <div className="detailsPanel__kv">
              <span>Cards</span>
              <span className="mono">{context.count}</span>
            </div>

            <div className="detailsPanel__field">
              <label htmlFor="closed-target-layout">Layout</label>
              <select
                id="closed-target-layout"
                value={context.widget.layout}
                onChange={(event) => context.onUpdateLayout(event.currentTarget.value as CategoryWidgetData['layout'])}
              >
                <option value="stack">Stack</option>
                <option value="fan">Fan</option>
              </select>
            </div>

            <div className="detailsPanel__field">
              <label htmlFor="closed-target-capacity-mode">Capacity</label>
              <select
                id="closed-target-capacity-mode"
                value={context.widget.capacityMode}
                onChange={(event) =>
                  context.onUpdateCapacityMode(event.currentTarget.value as CategoryWidgetData['capacityMode'])
                }
              >
                <option value="unlimited">Unlimited</option>
                <option value="limited">Limited</option>
              </select>
            </div>

            {context.widget.capacityMode === 'limited' ? (
              <div className="detailsPanel__field">
                <label htmlFor="closed-target-capacity">Max cards</label>
                <input
                  id="closed-target-capacity"
                  type="number"
                  min={1}
                  value={context.widget.capacity ?? 1}
                  onChange={(event) => context.onUpdateCapacity(Number(event.currentTarget.value) || 1)}
                />
              </div>
            ) : null}

            <div className="detailsPanel__field">
              <label htmlFor="closed-target-tags">Allowed tags</label>
              <input
                id="closed-target-tags"
                placeholder="Separate tags with commas"
                value={context.widget.allowedTags.join(', ')}
                onChange={(event) => context.onUpdateAllowedTags(parseTagsInput(event.currentTarget.value))}
              />
            </div>
          </div>

          <div className="detailsPanel__actions">
            <button className="btn btn--ghost btn--tiny btn--dangerSoft" type="button" onClick={context.onDelete}>
              Remove category
            </button>
          </div>
        </>
      ) : null}

      {context.kind === 'pre-sort-widget' ? (
        <>
          <div className="detailsPanel__section">
            <div className="detailsPanel__field">
              <label htmlFor="presort-widget-name">Name</label>
              <input
                id="presort-widget-name"
                value={context.widget.title}
                onChange={(event) => context.onUpdateTitle(event.currentTarget.value)}
              />
            </div>

            {context.widget.zones.map((zone, index) => (
              <div className="detailsPanel__field" key={zone.id}>
                <label htmlFor={`presort-zone-${zone.id}`}>Pre-sort choice {index + 1}</label>
                <input
                  id={`presort-zone-${zone.id}`}
                  value={zone.label}
                  onChange={(event) => context.onUpdateZoneLabel(zone.id, event.currentTarget.value)}
                />
              </div>
            ))}

            <div className="detailsPanel__kv">
              <span>{context.widget.zones[0]?.label || 'Zone 1'}</span>
              <span className="mono">{context.counts[0] ?? 0}</span>
            </div>
            <div className="detailsPanel__kv">
              <span>{context.widget.zones[1]?.label || 'Zone 2'}</span>
              <span className="mono">{context.counts[1] ?? 0}</span>
            </div>
          </div>
        </>
      ) : null}

      {context.kind === 'qsort-widget' ? (
        <>
          <div className="detailsPanel__section">
            <div className="detailsPanel__field">
              <label htmlFor="qsort-widget-name">Name</label>
              <input
                id="qsort-widget-name"
                value={context.widget.title}
                onChange={(event) => context.onUpdateTitle(event.currentTarget.value)}
              />
            </div>

            {context.widget.lanes.map((lane, index) => (
              <div className="detailsPanel__field" key={lane.id}>
                <label htmlFor={`qsort-lane-${lane.id}`}>Pre-sort group {index + 1}</label>
                <input
                  id={`qsort-lane-${lane.id}`}
                  value={lane.label}
                  onChange={(event) => context.onUpdateLaneLabel(lane.id, event.currentTarget.value)}
                />
              </div>
            ))}

            {context.widget.buckets.map((bucket, index) => (
              <div className="detailsPanel__field" key={bucket.id} role="group" aria-labelledby={`qsort-position-${bucket.id}`}>
                <div className="detailsPanel__fieldTitle" id={`qsort-position-${bucket.id}`}>Scale position {index + 1}</div>
                <div className="detailsPanel__fieldPair">
                  <label>
                    <span>Label</span>
                    <input
                      aria-label={`Label for scale position ${index + 1}`}
                      value={bucket.label}
                      onChange={(event) => context.onUpdateBucketLabel(bucket.id, event.currentTarget.value)}
                    />
                  </label>
                  <label>
                    <span>Capacity</span>
                    <input
                      aria-label={`Capacity for scale position ${index + 1} (${bucket.label})`}
                      type="number"
                      min={0}
                      value={bucket.capacity}
                      onChange={(event) => context.onUpdateBucketCapacity(bucket.id, Number(event.currentTarget.value) || 0)}
                    />
                  </label>
                </div>
                <div className="hint">{`${context.bucketCounts[index] ?? 0} / ${bucket.capacity} placed`}</div>
              </div>
            ))}
          </div>

          {context.onGenerateNormalDistribution ? (
            <div className="detailsPanel__actions">
              <button className="btn btn--ghost btn--tiny" type="button" onClick={context.onGenerateNormalDistribution}>
                Regenerate distribution
              </button>
              <div className="hint">Replaces the current capacities to fit all cards.</div>
            </div>
          ) : null}
        </>
      ) : null}

      {context.kind === 'card' ? (
        <>
          <div className="detailsPanel__cardHeader">
            <div className="detailsPanel__thumbWrap">
              <CardPreview card={context.card} showPreviewButton={false} />
            </div>
            <div className="detailsPanel__titleBlock">
              <div className="detailsPanel__title">{context.card.meta.name || '(Unnamed card)'}</div>
              <div className="detailsPanel__kind">{formatCardKind(context.card.kind)}</div>
            </div>
          </div>

          {context.card.kind === 'video' ? (
            <div className="detailsPanel__section">
              <div className="detailsPanel__field">
                <label>Preview</label>
                <div className="detailsPanel__videoFrame">
                  {context.card.src ? (
                    <video
                      className="detailsPanel__video"
                      src={context.card.src}
                      poster={context.card.posterSrc}
                      controls
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <div className="detailsPanel__videoEmpty">This video file is unavailable.</div>
                  )}
                </div>
                {context.onOpenPreview ? (
                  <div className="detailsPanel__inlineActions">
                    <button className="btn btn--ghost btn--tiny" type="button" onClick={context.onOpenPreview}>
                      Open video
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="detailsPanel__section">
            <div className="detailsPanel__field">
              <label htmlFor="card-meta-name">Name</label>
              <input
                id="card-meta-name"
                value={context.card.meta.name}
                {...cardMetaEditHandlers}
                onChange={(event) => context.onUpdateMeta({ name: event.currentTarget.value })}
              />
            </div>

            <div className="detailsPanel__field">
              <label htmlFor="card-meta-notes">Notes</label>
              <textarea
                id="card-meta-notes"
                rows={4}
                value={context.card.meta.notes}
                {...cardMetaEditHandlers}
                onChange={(event) => context.onUpdateMeta({ notes: event.currentTarget.value })}
              />
            </div>

            <div className="detailsPanel__field">
              <label htmlFor="card-meta-tags">Tags</label>
              <input
                id="card-meta-tags"
                placeholder="Separate tags with commas"
                value={context.card.meta.tags.join(', ')}
                {...cardMetaEditHandlers}
                onChange={(event) => context.onUpdateMeta({ tags: parseTagsInput(event.currentTarget.value) })}
              />
            </div>

            {context.card.kind === 'text' ? (
              <>
                <div className="detailsPanel__field">
                  <label htmlFor="card-meta-front-text">Text on card</label>
                  <input
                    id="card-meta-front-text"
                    value={context.card.meta.frontText || ''}
                    {...cardMetaEditHandlers}
                    onChange={(event) => context.onUpdateMeta({ frontText: event.currentTarget.value })}
                  />
                </div>

                <div className="detailsPanel__field">
                  <label htmlFor="card-meta-color">Color</label>
                  <select
                    id="card-meta-color"
                    value={context.card.meta.color || 'slate'}
                    {...cardMetaEditHandlers}
                    onChange={(event) => context.onUpdateMeta({ color: event.currentTarget.value as TextCardColorKey })}
                  >
                    {TEXT_CARD_COLOR_KEYS.map((color) => (
                      <option key={color} value={color}>
                        {TEXT_CARD_COLOR_LABELS[color]}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}
          </div>

          <div className="detailsPanel__section">
            {context.card.kind === 'video' ? (
              <>
                <div className="detailsPanel__kv">
                  <span>Duration</span>
                  <span>{formatDurationLabel(context.card.meta.durationSec) || 'Unknown'}</span>
                </div>
                {context.card.meta.originalFileName ? (
                  <div className="detailsPanel__kv">
                    <span>File</span>
                    <span>{context.card.meta.originalFileName}</span>
                  </div>
                ) : null}
              </>
            ) : null}
            {context.closedContainer ? (
              <div className="detailsPanel__kv">
                <span>Location</span>
                <span>{`${context.closedContainer.name} (${context.closedContainer.count})`}</span>
              </div>
            ) : (
              <div className="detailsPanel__kv">
                <span>Stack</span>
                <span>{context.stack ? `${context.stack.name} (${context.stack.count})` : 'Not in a stack'}</span>
              </div>
            )}
            {context.onAddToStack && addableStacks.length > 0 ? (
              <div className="detailsPanel__field">
                <label htmlFor="card-add-stack">Add to stack</label>
                <div className="detailsPanel__inlineRow">
                  <select
                    id="card-add-stack"
                    value={targetStackId}
                    onChange={(event) => setTargetStackId(event.currentTarget.value)}
                  >
                    {addableStacks.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name} ({option.count})
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn--ghost btn--tiny"
                    type="button"
                    disabled={!targetStackId}
                    onClick={() => targetStackId && context.onAddToStack?.(targetStackId)}
                  >
                    Add
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="detailsPanel__actions">
            <button className="btn btn--ghost btn--tiny" type="button" onClick={context.onBringToFront}>
              Bring to front
            </button>
            {context.onRemoveFromStack ? (
              <button className="btn btn--ghost btn--tiny" type="button" onClick={context.onRemoveFromStack}>
                Remove from stack
              </button>
            ) : null}
            <button className="btn btn--ghost btn--tiny btn--dangerSoft" type="button" onClick={context.onDeleteCard}>
              Delete card
            </button>
          </div>
        </>
      ) : null}
    </aside>
  );
}
