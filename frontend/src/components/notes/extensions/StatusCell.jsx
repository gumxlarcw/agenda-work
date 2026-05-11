/**
 * StatusCell — Custom TipTap Node Extension
 * Clickable status badge with configurable presets.
 * Stores steps in node attrs so each badge is self-contained.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { useState } from 'react';

// ═══════ Built-in Presets ═══════

const PRESETS = [
  {
    id: 'basic',
    name: 'Basic',
    steps: [
      { key: 'empty', label: 'Belum', icon: '○', color: '#9ca3af', bg: '#f3f4f6' },
      { key: 'progress', label: 'Progress', icon: '◐', color: '#f59e0b', bg: '#fef3c7' },
      { key: 'complete', label: 'Selesai', icon: '●', color: '#22c55e', bg: '#dcfce7' },
    ],
  },
  {
    id: 'document',
    name: 'Dokumen',
    steps: [
      { key: 'empty', label: 'Belum', icon: '○', color: '#9ca3af', bg: '#f3f4f6' },
      { key: 'draft', label: 'Draft', icon: '✎', color: '#6366f1', bg: '#e0e7ff' },
      { key: 'review', label: 'Review', icon: '◎', color: '#f59e0b', bg: '#fef3c7' },
      { key: 'upload', label: 'Upload', icon: '↑', color: '#3b82f6', bg: '#dbeafe' },
      { key: 'verified', label: 'Verified', icon: '✓', color: '#22c55e', bg: '#dcfce7' },
    ],
  },
  {
    id: 'approval',
    name: 'Approval',
    steps: [
      { key: 'empty', label: 'Pending', icon: '○', color: '#9ca3af', bg: '#f3f4f6' },
      { key: 'submitted', label: 'Submitted', icon: '→', color: '#3b82f6', bg: '#dbeafe' },
      { key: 'approved', label: 'Approved', icon: '✓', color: '#22c55e', bg: '#dcfce7' },
      { key: 'rejected', label: 'Ditolak', icon: '✗', color: '#ef4444', bg: '#fee2e2' },
    ],
  },
  {
    id: 'priority',
    name: 'Prioritas',
    steps: [
      { key: 'none', label: 'None', icon: '—', color: '#9ca3af', bg: '#f3f4f6' },
      { key: 'low', label: 'Low', icon: '▽', color: '#22c55e', bg: '#dcfce7' },
      { key: 'medium', label: 'Medium', icon: '◇', color: '#f59e0b', bg: '#fef3c7' },
      { key: 'high', label: 'High', icon: '△', color: '#ef4444', bg: '#fee2e2' },
    ],
  },
];

// Helper: get step config from attrs
function getStepConfig(attrs) {
  const steps = attrs.steps || PRESETS[0].steps;
  const status = attrs.status || steps[0]?.key || 'empty';
  const current = steps.find(s => s.key === status) || steps[0];
  const idx = steps.findIndex(s => s.key === status);
  return { steps, status, current, idx };
}

// ═══════ React NodeView ═══════

function StatusCellView({ node, updateAttributes, editor }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const { steps, current, idx } = getStepConfig(node.attrs);
  const editable = editor.isEditable;

  const handleClick = () => {
    if (!editable) return;
    const next = steps[(idx + 1) % steps.length];
    updateAttributes({ status: next.key });
  };

  // Build tooltip showing all steps with current highlighted
  const tooltipContent = steps.map((s, i) => (
    `${i === idx ? '▸ ' : '  '}${s.icon} ${s.label}`
  )).join('\n');

  return (
    <NodeViewWrapper as="span" className="status-cell-wrapper">
      <button
        type="button"
        onClick={handleClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className="status-cell-badge"
        style={{
          backgroundColor: current.bg,
          color: current.color,
          borderColor: current.color,
        }}
        title={tooltipContent}
        contentEditable={false}
      >
        <span className="status-cell-icon">{current.icon}</span>
        <span className="status-cell-text">{current.label}</span>
      </button>
      {showTooltip && (
        <span className="status-cell-tooltip" contentEditable={false}>
          {steps.map((s, i) => (
            <span key={s.key} className={`status-tooltip-step ${i === idx ? 'active' : ''}`} style={{ color: s.color }}>
              {s.icon} {s.label}
            </span>
          ))}
        </span>
      )}
    </NodeViewWrapper>
  );
}

// ═══════ TipTap Node Extension ═══════

const StatusCell = Node.create({
  name: 'statusCell',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      status: {
        default: 'empty',
        parseHTML: (el) => el.getAttribute('data-status') || 'empty',
        renderHTML: (attrs) => ({ 'data-status': attrs.status }),
      },
      steps: {
        default: null, // null = use legacy basic preset
        parseHTML: (el) => {
          try { return JSON.parse(el.getAttribute('data-steps')); } catch { return null; }
        },
        renderHTML: (attrs) => {
          if (!attrs.steps) return {};
          return { 'data-steps': JSON.stringify(attrs.steps) };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="status-cell"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    // Render as self-contained span with visible text (for clipboard)
    const steps = node.attrs.steps || PRESETS[0].steps;
    const current = steps.find(s => s.key === node.attrs.status) || steps[0];
    return ['span', mergeAttributes({
      'data-type': 'status-cell',
      style: `background:${current.bg};color:${current.color};border:1px solid ${current.color};border-radius:9999px;padding:1px 6px;font-size:11px;font-weight:600;`,
    }, HTMLAttributes), `${current.icon} ${current.label}`];
  },

  addNodeView() {
    return ReactNodeViewRenderer(StatusCellView);
  },

  addCommands() {
    return {
      insertStatusCell: (attrs = {}) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: {
            status: attrs.status || (attrs.steps ? attrs.steps[0].key : 'empty'),
            steps: attrs.steps || null,
          },
        });
      },
    };
  },
});

export default StatusCell;
export { PRESETS, getStepConfig };
