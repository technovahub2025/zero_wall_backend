const asyncHandler = require('../utils/asyncHandler');
const KanbanBoard = require('../models/KanbanBoard');

const DEFAULT_TASK_COLUMNS = [
  { id: 'todo', title: 'Todo', color: '#94a3b8', order: 0, isDefault: true },
  { id: 'in-progress', title: 'In Progress', color: '#3b82f6', order: 1, isDefault: true },
  { id: 'review', title: 'Review', color: '#f59e0b', order: 2, isDefault: true },
  { id: 'done', title: 'Done', color: '#22c55e', order: 3, isDefault: true },
];

const DEFAULT_OVERVIEW_COLUMNS = [
  'Concept Design',
  'Scheme Design',
  'Preliminary Design',
  'Structural Design',
  'Working Drawings',
  'Detailed Engineering',
  'GFC Drawings',
  'Shop Drawings',
  'Site Supervision',
  'As-Built Drawings',
  'Project Handover',
].map((title, order) => ({
  id: slugify(title),
  title,
  color: '#3b82f6',
  order,
  isDefault: true,
}));

function normalizeBoardType(value = '') {
  const next = String(value || '').trim().toLowerCase();
  if (next === 'task' || next === 'overview') return next;
  return 'task';
}

function getDefaultColumns(boardType) {
  return boardType === 'overview'
    ? DEFAULT_OVERVIEW_COLUMNS.map((column) => ({ ...column }))
    : DEFAULT_TASK_COLUMNS.map((column) => ({ ...column }));
}

function normalizeColumns(columns, boardType) {
  const seen = new Set();
  const defaults = getDefaultColumns(boardType);
  const rows = Array.isArray(columns) ? columns : [];
  const normalized = rows
    .map((column, index) => {
      const fallback = defaults[index] || defaults[0] || {};
      const id = String(column?.id || fallback.id || '').trim();
      const title = String(column?.title || fallback.title || '').trim();
      const color = String(column?.color || fallback.color || '#3b82f6').trim();
      const order = Number.isFinite(Number(column?.order)) ? Number(column.order) : index;
      if (!id || !title || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        title,
        color,
        order,
        isDefault: Boolean(column?.isDefault ?? fallback.isDefault ?? false),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  return normalized;
}

const getKanbanColumns = asyncHandler(async (req, res) => {
  const boardType = normalizeBoardType(req.query.boardType);
  const board = await KanbanBoard.findOne({ boardType });
  const defaults = getDefaultColumns(boardType);
  const columns = board?.columns?.length ? normalizeColumns(board.columns, boardType) : defaults;

  return res.json({
    success: true,
    data: {
      boardType,
      columns,
    },
  });
});

const saveKanbanColumns = asyncHandler(async (req, res) => {
  const boardType = normalizeBoardType(req.body.boardType || req.query.boardType);
  const columns = normalizeColumns(req.body.columns, boardType);
  if (!columns.length) {
    return res.status(400).json({
      success: false,
      message: 'At least one column is required',
    });
  }

  const board = await KanbanBoard.findOneAndUpdate(
    { boardType },
    {
      boardType,
      columns,
      updatedBy: req.user?.id || null,
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );

  return res.json({
    success: true,
    message: 'Kanban columns updated',
    data: {
      boardType: board.boardType,
      columns: normalizeColumns(board.columns, boardType),
    },
  });
});

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = {
  getKanbanColumns,
  saveKanbanColumns,
};
