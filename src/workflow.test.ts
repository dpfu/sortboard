import { describe, expect, it } from 'vitest';
import {
  addClosedCategoryWidget,
  buildNormalDistributionBuckets,
  createWorkflowForTemplate,
  getClosedCategoryWidgets,
  getNextStageId,
  getQSortWidget,
  getSeedSourceWidget,
  getSourceWidget,
  isWorkflowConfiguredForSorting,
  patchWorkflowWidget,
  removeWidgetFromWorkflow,
} from './workflow';

describe('workflow scaffolding', () => {
  it('creates closed and qsort templates with the expected stages and widgets', () => {
    const closed = createWorkflowForTemplate('closed', 1200, 800, 15);
    const qsort = createWorkflowForTemplate('qsort', 1200, 800, 15);
    const open = createWorkflowForTemplate('open', 1200, 800, 15);
    const qsortWidget = getQSortWidget(qsort, qsort.stages[1]?.id);

    expect(closed.templateId).toBe('closed');
    expect(closed.stages).toHaveLength(1);
    expect(closed.stages[0]?.kind).toBe('closed-sort');
    expect(closed.widgets.map((widget) => widget.kind)).toEqual(['source', 'category']);

    expect(qsort.templateId).toBe('qsort');
    expect(qsort.stages.map((stage) => stage.kind)).toEqual(['presort', 'qsort']);
    expect(qsort.widgets.map((widget) => widget.kind)).toEqual(['source', 'pre-sort', 'qsort']);
    expect(getSourceWidget(qsort, qsort.stages[0]?.id)?.title).toBe('Source');
    expect(qsortWidget?.buckets.length).toBe(7);
    expect(qsortWidget?.w).toBe(1040);
    expect(qsortWidget?.h).toBe(620);
    expect(qsortWidget?.x).toBe(80);
    expect(qsortWidget?.y).toBe(90);

    expect(open).toEqual({
      templateId: 'open',
      stages: [],
      widgets: [],
    });
  });

  it('builds a balanced normal-distribution bucket set that preserves the card count', () => {
    const buckets = buildNormalDistributionBuckets(15, 7);
    const total = buckets.reduce((sum, bucket) => sum + bucket.capacity, 0);
    const center = buckets[Math.floor(buckets.length / 2)]!;

    expect(total).toBe(15);
    expect(buckets).toHaveLength(7);
    expect(center.capacity).toBeGreaterThanOrEqual(buckets[0]!.capacity);
    expect(center.capacity).toBeGreaterThanOrEqual(buckets[buckets.length - 1]!.capacity);
  });

  it('finds the correct source widget for seeding and validates template completeness', () => {
    const closed = createWorkflowForTemplate('closed', 1200, 800, 10);
    const qsort = createWorkflowForTemplate('qsort', 1200, 800, 10);
    const presortStageId = qsort.stages.find((stage) => stage.kind === 'presort')?.id || null;
    const qsortStageId = qsort.stages.find((stage) => stage.kind === 'qsort')?.id || null;
    const incompleteQSort = {
      ...qsort,
      widgets: qsort.widgets.filter((widget) => widget.kind !== 'source'),
    };

    expect(getSeedSourceWidget(closed)?.stageId).toBe(closed.stages[0]?.id);
    expect(getSeedSourceWidget(qsort, qsortStageId)?.stageId).toBe(presortStageId);
    expect(getNextStageId(qsort, presortStageId)).toBe(qsortStageId);
    expect(getNextStageId(qsort, qsortStageId)).toBeNull();
    expect(isWorkflowConfiguredForSorting(closed, 'closed')).toBe(true);
    expect(isWorkflowConfiguredForSorting(qsort, 'qsort')).toBe(true);
    expect(isWorkflowConfiguredForSorting(incompleteQSort, 'qsort')).toBe(false);
  });

  it('adds and removes closed category widgets while preserving the source widget', () => {
    const workflow = createWorkflowForTemplate('closed', 1200, 800, 8);
    const stageId = workflow.stages[0]!.id;
    const sourceId = getSourceWidget(workflow, stageId)?.id;
    const expanded = addClosedCategoryWidget(workflow, stageId, 1200, 800);
    const categories = getClosedCategoryWidgets(expanded, stageId);
    const trimmed = removeWidgetFromWorkflow(expanded, categories[0]!.id);

    expect(categories).toHaveLength(2);
    expect(categories[1]!.title).toBe('Category 2');
    expect(getSourceWidget(trimmed, stageId)?.id).toBe(sourceId);
    expect(getClosedCategoryWidgets(trimmed, stageId)).toHaveLength(1);
  });

  it('patches one widget without cloning unrelated workflow data', () => {
    const workflow = createWorkflowForTemplate('closed', 1200, 800, 8);
    const target = getClosedCategoryWidgets(workflow, workflow.stages[0]!.id)[0]!;
    const source = getSourceWidget(workflow, workflow.stages[0]!.id)!;
    const patched = patchWorkflowWidget(workflow, target.id, { title: 'Updated category' });

    expect(patched).not.toBe(workflow);
    expect(patched.stages).toBe(workflow.stages);
    expect(patched.widgets.find((widget) => widget.id === source.id)).toBe(source);
    expect(patched.widgets.find((widget) => widget.id === target.id)?.title).toBe('Updated category');
    expect(target.title).not.toBe('Updated category');
  });
});
