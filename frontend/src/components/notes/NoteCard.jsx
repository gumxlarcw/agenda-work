import dayjs from 'dayjs';
import {
  HiOutlineStar,
  HiOutlineTrash,
  HiOutlineArchive,
  HiOutlineLink,
  HiOutlineUsers,
  HiOutlineDocumentText,
} from 'react-icons/hi';

// Extract checklist progress from content_json
function getChecklistProgress(contentJson) {
  if (!contentJson) return null;
  try {
    const json = typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson;
    let total = 0, checked = 0;
    const walk = (node) => {
      if (node.type === 'taskItem') {
        total++;
        if (node.attrs?.checked) checked++;
      }
      if (node.content) node.content.forEach(walk);
    };
    walk(json);
    return total > 0 ? { total, checked } : null;
  } catch { return null; }
}

// Render inline text with marks (bold, italic, highlight, code)
function renderInlineContent(nodes) {
  if (!nodes) return null;
  return nodes.map((node, i) => {
    if (node.type === 'text') {
      let el = node.text;
      if (node.marks) {
        for (const mark of node.marks) {
          if (mark.type === 'bold') el = <strong key={`b${i}`}>{el}</strong>;
          else if (mark.type === 'italic') el = <em key={`i${i}`}>{el}</em>;
          else if (mark.type === 'highlight') el = <mark key={`h${i}`} className="bg-yellow-200/60 px-0.5 rounded-sm">{el}</mark>;
          else if (mark.type === 'code') el = <code key={`c${i}`} className="bg-gray-100 text-[10px] px-1 py-0.5 rounded font-mono">{el}</code>;
          else if (mark.type === 'strike') el = <s key={`s${i}`}>{el}</s>;
        }
      }
      return <span key={i}>{el}</span>;
    }
    if (node.type === 'hardBreak') return <br key={i} />;
    if (node.type === 'statusCell') {
      const steps = node.attrs?.steps || STATUS_PRESETS_DEFAULT;
      const status = node.attrs?.status || 'empty';
      const current = steps.find(s => s.key === status) || steps[0];
      return (
        <span
          key={i}
          className="inline-flex items-center gap-0.5 px-1 py-0 rounded-full text-[9px] font-semibold border mx-0.5"
          style={{ backgroundColor: current.bg, color: current.color, borderColor: current.color }}
        >
          {current.icon} {current.label}
        </span>
      );
    }
    return null;
  });
}

// Extract plain text from a ProseMirror node
function extractText(node) {
  if (!node) return '';
  if (node.text) return node.text;
  if (node.content) return node.content.map(extractText).join('');
  return '';
}

// Status badge preset colors (matching StatusCell extension)
const STATUS_PRESETS_DEFAULT = [
  { key: 'empty', label: 'Belum', icon: '○', color: '#9ca3af', bg: '#f3f4f6' },
  { key: 'progress', label: 'Progress', icon: '◐', color: '#f59e0b', bg: '#fef3c7' },
  { key: 'complete', label: 'Selesai', icon: '●', color: '#22c55e', bg: '#dcfce7' },
];

// Render inline nodes including statusCell
function renderInlineWithStatus(nodes) {
  if (!nodes) return null;
  return nodes.map((child, j) => {
    if (child.type === 'statusCell') {
      const steps = child.attrs?.steps || STATUS_PRESETS_DEFAULT;
      const status = child.attrs?.status || 'empty';
      const current = steps.find(s => s.key === status) || steps[0];
      return (
        <span key={j} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold border whitespace-nowrap mx-0.5"
          style={{ backgroundColor: current.bg, color: current.color, borderColor: current.color }}>
          {current.icon} {current.label}
        </span>
      );
    }
    if (child.type === 'text') {
      let el = child.text;
      if (child.marks) {
        for (const mark of child.marks) {
          if (mark.type === 'bold') el = <strong key={`b${j}`}>{el}</strong>;
          else if (mark.type === 'italic') el = <em key={`i${j}`}>{el}</em>;
          else if (mark.type === 'highlight') el = <mark key={`h${j}`} className="bg-yellow-200/60 px-0.5 rounded-sm">{el}</mark>;
        }
      }
      return <span key={j}>{el}</span>;
    }
    if (child.type === 'hardBreak') return <br key={j} />;
    return null;
  });
}

// Map TipTap textAlign to CSS
function alignStyle(attrs) {
  const a = attrs?.textAlign;
  if (!a || a === 'left') return {};
  return { textAlign: a };
}
function alignClass(attrs) {
  const a = attrs?.textAlign;
  if (a === 'center') return 'justify-center';
  if (a === 'right') return 'justify-end';
  return '';
}

// Render content inside a table cell — handles all node types with alignment
function renderCellContent(content) {
  if (!content) return null;
  return content.map((node, i) => {
    if (node.type === 'paragraph') {
      const hasStatus = node.content?.some(n => n.type === 'statusCell');
      // Status badges: default to center in table cells (matching editor CSS behavior)
      const effectiveAlign = node.attrs?.textAlign || (hasStatus ? 'center' : null);
      const effAttrs = effectiveAlign ? { textAlign: effectiveAlign } : node.attrs;
      return (
        <div key={i} className={`text-[10px] text-gray-600 leading-relaxed flex flex-wrap gap-0.5 ${alignClass(effAttrs)}`} style={alignStyle(effAttrs)}>
          {renderInlineWithStatus(node.content)}
        </div>
      );
    }
    if (node.type === 'taskList' && node.content) {
      return (
        <div key={i} className="flex flex-col items-center gap-0.5">
          {node.content.map((item, j) => {
            if (item.type !== 'taskItem') return null;
            const checked = !!item.attrs?.checked;
            const text = extractText(item).trim();
            return (
              <div key={j} className="flex items-center justify-center gap-1">
                <span className={`w-3 h-3 rounded border flex-shrink-0 flex items-center justify-center ${
                  checked ? 'bg-green-500 border-green-500' : 'border-gray-300'
                }`}>
                  {checked && (
                    <svg className="w-2 h-2 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </span>
                {text && <span className={`text-[9px] ${checked ? 'line-through text-gray-400' : 'text-gray-600'}`}>{text}</span>}
              </div>
            );
          })}
        </div>
      );
    }
    if ((node.type === 'orderedList' || node.type === 'bulletList') && node.content) {
      const start = node.attrs?.start || 1;
      return (
        <div key={i} className="text-[10px] text-gray-600 leading-relaxed">
          {node.content.map((li, j) => {
            const text = extractText(li).trim();
            if (!text) return null;
            const prefix = node.type === 'orderedList' ? `${start + j}. ` : '• ';
            return (
              <div key={j} style={alignStyle(li.content?.[0]?.attrs)}>
                <span className="text-gray-400">{prefix}</span>
                {renderInlineWithStatus(li.content?.[0]?.content)}
              </div>
            );
          })}
        </div>
      );
    }
    // Fallback
    const fallbackText = extractText(node).trim();
    if (fallbackText) return <div key={i} className="text-[10px] text-gray-600">{fallbackText}</div>;
    return null;
  });
}

// Render a single ProseMirror node as JSX for card preview
function renderNode(node, key, fillHeight) {
  switch (node.type) {
    case 'paragraph': {
      const text = extractText(node);
      const hasInlineNodes = node.content?.some(n => n.type === 'statusCell');
      if (!text.trim() && !hasInlineNodes) return null;
      return (
        <p key={key} className="text-xs text-gray-600 leading-relaxed py-0.5" style={alignStyle(node.attrs)}>
          {renderInlineWithStatus(node.content) || renderInlineContent(node.content)}
        </p>
      );
    }

    case 'heading': {
      const text = extractText(node);
      if (!text.trim()) return null;
      const level = node.attrs?.level || 1;
      const sizes = { 1: 'text-sm font-bold', 2: 'text-xs font-bold', 3: 'text-xs font-semibold' };
      return (
        <p key={key} className={`${sizes[level] || sizes[3]} text-gray-800 leading-snug py-0.5`} style={alignStyle(node.attrs)}>
          {renderInlineContent(node.content)}
        </p>
      );
    }

    case 'taskList': {
      if (!node.content) return null;
      return (
        <div key={key} className="space-y-0.5">
          {node.content.map((item, j) => {
            if (item.type !== 'taskItem') return null;
            const checked = !!item.attrs?.checked;
            return (
              <div key={j} className="flex items-start gap-1.5 py-0.5">
                <span className={`mt-0.5 w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
                  checked ? 'bg-primary-500 border-primary-500' : 'border-gray-300'
                }`}>
                  {checked && (
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </span>
                <span className={`text-xs leading-relaxed ${checked ? 'line-through text-gray-400' : 'text-gray-600'}`}>
                  {renderInlineContent(item.content?.[0]?.content)}
                </span>
              </div>
            );
          })}
        </div>
      );
    }

    case 'bulletList': {
      if (!node.content) return null;
      return (
        <div key={key} className="space-y-0.5 pl-3">
          {node.content.map((li, j) => {
            const text = extractText(li);
            if (!text.trim()) return null;
            return (
              <p key={j} className="text-xs text-gray-600 leading-relaxed py-0.5">
                <span className="text-gray-400 mr-1">•</span>
                {renderInlineContent(li.content?.[0]?.content)}
              </p>
            );
          })}
        </div>
      );
    }

    case 'orderedList': {
      if (!node.content) return null;
      const start = node.attrs?.start || 1;
      return (
        <div key={key} className="space-y-0.5 pl-3">
          {node.content.map((li, j) => {
            const text = extractText(li);
            if (!text.trim()) return null;
            return (
              <p key={j} className="text-xs text-gray-600 leading-relaxed py-0.5">
                <span className="text-gray-400 mr-1">{start + j}.</span>
                {renderInlineContent(li.content?.[0]?.content)}
              </p>
            );
          })}
        </div>
      );
    }

    case 'blockquote': {
      return (
        <div key={key} className="border-l-2 border-gray-300 pl-2 my-0.5">
          {node.content?.map((child, j) => renderNode(child, `${key}-bq-${j}`, fillHeight))}
        </div>
      );
    }

    case 'codeBlock': {
      const text = extractText(node);
      return (
        <pre key={key} className="bg-gray-800 text-gray-200 text-[10px] px-2 py-1.5 rounded my-0.5 overflow-hidden font-mono leading-relaxed whitespace-pre-wrap break-words">
          {text}
        </pre>
      );
    }

    case 'horizontalRule': {
      return <hr key={key} className="border-t border-gray-200 my-1.5" />;
    }

    case 'table': {
      if (!node.content) return null;
      return (
        <div key={key} className="overflow-hidden my-1 rounded-lg border border-gray-200">
          <table className="w-full text-[10px] border-collapse">
            <tbody>
              {node.content.map((row, ri) => (
                <tr key={ri} className={ri > 0 && ri % 2 === 0 ? 'bg-gray-50/50' : ''}>
                  {row.content?.map((cell, ci) => {
                    const isHeader = cell.type === 'tableHeader';
                    const align = cell.attrs?.textAlign || 'left';
                    const colwidth = cell.attrs?.colwidth;
                    const style = colwidth ? { width: colwidth[0] + 'px' } : {};
                    return (
                      <td
                        key={ci}
                        style={{ ...style, textAlign: align }}
                        className={`border border-gray-200 px-1.5 py-1 break-words overflow-hidden align-top ${
                          isHeader ? 'bg-gradient-to-b from-gray-50 to-gray-100 font-semibold text-gray-700' : 'text-gray-600'
                        }`}
                      >
                        {renderCellContent(cell.content)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case 'image': {
      const src = node.attrs?.src;
      if (!src) return null;
      return (
        <div key={key} className="my-1">
          <img
            src={src}
            alt={node.attrs?.alt || ''}
            className="w-full max-h-24 rounded object-cover"
            loading="lazy"
          />
        </div>
      );
    }

    default:
      return null;
  }
}

// Render content_json as rich preview — all content types
function renderRichPreview(contentJson, fillHeight) {
  if (!contentJson) return null;
  try {
    const json = typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson;
    if (!json.content) return null;

    if (fillHeight) {
      // Show everything when card is resized
      const elements = json.content
        .map((node, i) => renderNode(node, i, true))
        .filter(Boolean);
      return elements.length > 0 ? elements : null;
    }

    // Limited preview: count visible lines, stop at 5
    const elements = [];
    let lineCount = 0;
    const maxLines = 5;

    for (const node of json.content) {
      if (lineCount >= maxLines) break;

      if (node.type === 'taskList' && node.content) {
        const items = [];
        for (const item of node.content) {
          if (lineCount >= maxLines) break;
          if (item.type === 'taskItem') {
            items.push(item);
            lineCount++;
          }
        }
        if (items.length > 0) {
          elements.push(renderNode({ ...node, content: items }, elements.length, false));
        }
      } else if ((node.type === 'bulletList' || node.type === 'orderedList') && node.content) {
        const items = [];
        for (const li of node.content) {
          if (lineCount >= maxLines) break;
          if (extractText(li).trim()) {
            items.push(li);
            lineCount++;
          }
        }
        if (items.length > 0) {
          elements.push(renderNode({ ...node, content: items }, elements.length, false));
        }
      } else {
        const rendered = renderNode(node, elements.length, false);
        if (rendered) {
          elements.push(rendered);
          lineCount++;
        }
      }
    }

    return elements.length > 0 ? elements : null;
  } catch {
    return null;
  }
}

export default function NoteCard({ note, tags = [], onClick, onPin, onArchive, onDelete, fillHeight, currentUserId, aggregatedProgress, childNotes, compact = false }) {
  // Use DB-cached progress (includes StatusCell + checkboxes), fallback to frontend parse
  const progress = (note.progress_total > 0)
    ? { total: note.progress_total, checked: note.progress_done, pct: Math.round(note.progress) }
    : getChecklistProgress(note.content_json);
  const sharedCount = (() => {
    if (!note.shared_with) return 0;
    try {
      const parsed = typeof note.shared_with === 'string' ? JSON.parse(note.shared_with) : note.shared_with;
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch { return 0; }
  })();

  // Rich preview from content_json (all content types) — skip in compact mode
  const richPreview = compact ? null : renderRichPreview(note.content_json, fillHeight);

  // Fallback: plain text preview if no content_json
  const plainPreview = (!richPreview && !compact) ? (() => {
    const lines = (note.content || '').split('\n').filter(l => l.trim());
    const text = fillHeight ? lines.join('\n') : lines.slice(0, 2).join('\n');
    return text || null;
  })() : null;

  // Determine accent color for left border
  const accentColor = note.is_pinned ? '#6366f1' : (note.color && note.color !== '#ffffff' ? note.color : '#e5e7eb');

  return (
    <div
      className={`rounded-xl shadow-sm hover:shadow-md transition-all relative group cursor-pointer border border-gray-100 overflow-hidden ${fillHeight ? 'h-full' : ''}`}
      style={{ backgroundColor: note.color || '#ffffff' }}
      onClick={() => onClick?.(note)}
    >
      {/* Left accent border */}
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl" style={{ backgroundColor: accentColor }} />

      <div className="flex flex-col h-full" style={{ paddingLeft: '1.25rem' }}>
        {/* Hover actions — absolute top-right, outside layout flow */}
        {/* Hover actions */}
        <div className="absolute top-2 right-2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10"
          data-note-actions
          onClick={e => e.stopPropagation()}
        >
          <button onClick={() => onPin?.(note)}
            className={`p-1.5 rounded-lg transition-colors ${note.is_pinned ? 'bg-primary-50 text-primary-500' : 'hover:bg-gray-100 text-gray-400 bg-white/80'}`}
            title={note.is_pinned ? 'Unpin' : 'Pin'}
            aria-label={note.is_pinned ? 'Unpin catatan' : 'Pin catatan'}>
            <HiOutlineStar className={`w-3.5 h-3.5 ${note.is_pinned ? 'fill-primary-400' : ''}`} />
          </button>
          <button onClick={() => onArchive?.(note)}
            className={`p-1.5 rounded-lg transition-colors ${note.is_archived ? 'bg-amber-50 text-amber-500' : 'hover:bg-gray-100 text-gray-400 bg-white/80'}`}
            title={note.is_archived ? 'Unarchive' : 'Archive'}
            aria-label={note.is_archived ? 'Kembalikan dari arsip' : 'Arsipkan'}>
            <HiOutlineArchive className="w-3.5 h-3.5" />
          </button>
          {/* Delete only for owner */}
          {(!currentUserId || note.user_id === currentUserId) && (
            <button onClick={() => onDelete?.(note)}
              className="p-1.5 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-lg transition-colors bg-white/80" title="Hapus"
              aria-label="Hapus catatan">
              <HiOutlineTrash className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Header — compact: title only; full: pinned badge + title + tags */}
        <div className={`flex-shrink-0 ${compact ? 'pt-2.5 pr-4 pb-0' : `pt-4 pr-4 ${fillHeight ? 'pb-2 border-b border-gray-100/60' : 'pb-0'}`}`}>
          {!compact && !!note.is_pinned && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-primary-100 text-primary-700 mb-1.5">
              <HiOutlineStar className="w-3 h-3 fill-primary-500" />
              Pinned
            </span>
          )}
          <h3 className={`font-semibold text-gray-900 ${compact ? 'text-xs' : 'text-sm'} ${fillHeight && !compact ? '' : 'truncate'}`}>{note.title || 'Untitled'}</h3>
          {!compact && tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {tags.slice(0, 4).map(tag => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                  style={{ backgroundColor: tag.color + '18', color: tag.color }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </span>
              ))}
              {tags.length > 4 && (
                <span className="text-[10px] text-gray-400 self-center">+{tags.length - 4}</span>
              )}
            </div>
          )}
        </div>

        {/* Content area — hidden in compact mode */}
        {!compact && (
          <div className={`flex-1 min-h-0 pr-4 ${fillHeight ? 'overflow-auto' : ''}`}>
            {/* Master note: show child notes progress list */}
            {childNotes && childNotes.length > 0 && (
              <div className={`${fillHeight ? 'pt-2' : 'mt-2'} space-y-1.5`}>
                {childNotes.map(child => {
                  const hasProgress = child.total > 0;
                  const pct = hasProgress ? Math.round((child.checked / child.total) * 100) : 0;
                  const done = hasProgress && pct === 100;
                  return (
                    <div key={child.id} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: child.color || '#6b7280' }} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-[11px] font-medium truncate ${done ? 'text-green-600 line-through' : 'text-gray-700'}`}>
                          {child.title || 'Untitled'}
                        </p>
                      </div>
                      {hasProgress ? (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${done ? 'bg-green-500' : 'bg-primary-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={`text-[9px] font-medium tabular-nums ${done ? 'text-green-600' : 'text-gray-400'}`}>
                            {pct}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-[9px] text-gray-300">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Regular note content */}
            {(!childNotes || childNotes.length === 0) && (
              <div className={`${fillHeight ? 'pt-2' : 'mt-2'} overflow-hidden`}>
                {richPreview ? (
                  <div className={fillHeight ? '' : 'line-clamp-4'}>{richPreview}</div>
                ) : plainPreview ? (
                  <p className={`text-gray-500 text-xs leading-relaxed whitespace-pre-line ${fillHeight ? '' : 'line-clamp-2'}`}>{plainPreview}</p>
                ) : null}
              </div>
            )}
          </div>
        )}

        {/* Bottom meta row — simplified in compact mode */}
        <div className={`flex items-center gap-2 ${compact ? 'mt-1 pt-1 pr-4 pb-2' : 'mt-2 pt-2 pr-4 pb-4'} border-t border-gray-100/80 flex-wrap flex-shrink-0`}>
          {/* Progress bar (StatusCell + checkboxes) */}
          {progress && (() => {
            const pct = progress.pct != null ? progress.pct : Math.round((progress.checked / progress.total) * 100);
            const isComplete = pct >= 100;
            const barColor = pct >= 100 ? 'bg-green-500' : pct >= 50 ? 'bg-primary-500' : pct > 0 ? 'bg-amber-500' : 'bg-gray-300';
            return (
              <div className="flex items-center gap-1.5">
                <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
                <span className={`text-[10px] font-medium ${isComplete ? 'text-green-600' : pct >= 50 ? 'text-primary-500' : 'text-gray-400'}`}>
                  {pct}%
                </span>
              </div>
            );
          })()}

          {/* Aggregated progress from connected child notes (master note) */}
          {aggregatedProgress && aggregatedProgress.total > 0 && (() => {
            const pct = Math.round((aggregatedProgress.checked / aggregatedProgress.total) * 100);
            const isComplete = pct >= 100;
            const barColor = pct >= 100 ? 'bg-green-500' : pct >= 50 ? 'bg-purple-500' : 'bg-amber-500';
            return (
              <div className="flex items-center gap-1.5">
                <div className="w-20 h-2 bg-purple-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
                <span className={`text-[10px] font-medium ${isComplete ? 'text-green-600' : 'text-purple-600'}`}>
                  {pct}%
                </span>
                <span className="text-[9px] text-purple-400">{aggregatedProgress.sources} catatan</span>
              </div>
            );
          })()}

          {/* Linked badges — hidden in compact */}
          {!compact && note.linked_task_id && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-primary-600 font-medium">
              <HiOutlineLink className="w-3 h-3" />
              Task
            </span>
          )}
          {!compact && note.linked_kegiatan_id && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-purple-600 font-medium">
              <HiOutlineLink className="w-3 h-3" />
              Event
            </span>
          )}

          {/* Shared badge — hidden in compact */}
          {!compact && sharedCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 font-medium">
              <HiOutlineUsers className="w-3 h-3" />
              {sharedCount}
            </span>
          )}

          {/* Folder name — hidden in compact */}
          {!compact && note.folder_name && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
              <HiOutlineDocumentText className="w-3 h-3" />
              {note.folder_name}
            </span>
          )}

          {/* Owner + Date — hidden in compact */}
          {!compact && (
            <span className="text-[10px] text-gray-400 ml-auto font-medium flex items-center gap-1.5">
              {note.owner_name && (
                <span className="text-gray-500">{note.owner_name}</span>
              )}
              <span>·</span>
              {dayjs(note.updated_at).format('DD MMM, HH:mm')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
