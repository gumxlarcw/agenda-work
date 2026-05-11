/**
 * Walk a ProseMirror JSON tree and collect every statusCell node, keyed by its
 * coordinates within the document (table_index/row_index/col_index). Returns
 * a Map<key, { status, label }>.
 */
function indexStatusCells(json) {
  const map = new Map();
  if (!json) return map;

  let tableIdx = -1;
  const walk = (node, path = []) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'table') tableIdx++;
    if (node.type === 'statusCell') {
      const key = `${tableIdx}:${path.join('-')}`;
      const status = node.attrs?.status ?? 'empty';
      const label = node.attrs?.label || extractFirstText(node) || `Cell ${path.join('-')}`;
      map.set(key, { status, label });
    }
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach((child, idx) => walk(child, [...path, idx]));
    }
  };
  walk(json);
  return map;
}

function extractFirstText(node) {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  if (Array.isArray(node.content)) {
    for (const c of node.content) {
      const t = extractFirstText(c);
      if (t) return t;
    }
  }
  return '';
}

/**
 * Diff two ProseMirror JSON trees. Returns an array of changed statusCell entries.
 * Only emits cells whose status changed (additions and deletions are also captured).
 *
 * Example return: [{ cell_label: 'Q1', from: 'progress', to: 'complete' }]
 */
function diffStatusCells(oldJson, newJson) {
  const oldMap = indexStatusCells(oldJson);
  const newMap = indexStatusCells(newJson);
  const changes = [];
  for (const [key, newVal] of newMap) {
    const oldVal = oldMap.get(key);
    if (!oldVal) {
      if (newVal.status && newVal.status !== 'empty') {
        changes.push({ cell_label: newVal.label, from: null, to: newVal.status });
      }
    } else if (oldVal.status !== newVal.status) {
      changes.push({ cell_label: newVal.label, from: oldVal.status, to: newVal.status });
    }
  }
  for (const [key, oldVal] of oldMap) {
    if (!newMap.has(key) && oldVal.status && oldVal.status !== 'empty') {
      changes.push({ cell_label: oldVal.label, from: oldVal.status, to: null });
    }
  }
  return changes;
}

module.exports = { diffStatusCells, indexStatusCells };
