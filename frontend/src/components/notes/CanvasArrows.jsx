import { useMemo, useState } from 'react';

// Calculate the closest edge connection point between two rectangles.
// Returns { from: {x,y}, to: {x,y} } for the arrow endpoints.
function getEdgePoints(sourcePos, sourceW, sourceH, targetPos, targetW, targetH) {
  const sx = sourcePos.x + sourceW / 2;
  const sy = sourcePos.y + sourceH / 2;
  const tx = targetPos.x + targetW / 2;
  const ty = targetPos.y + targetH / 2;

  const dx = tx - sx;
  const dy = ty - sy;

  // Source exit point — project to edge of source rect
  const from = projectToEdge(sx, sy, sourceW, sourceH, dx, dy);
  // Target entry point — project to edge of target rect (reverse direction)
  const to = projectToEdge(tx, ty, targetW, targetH, -dx, -dy);

  return { from, to };
}

function projectToEdge(cx, cy, w, h, dx, dy) {
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = w / 2;
  const hh = h / 2;
  // Scale factor to reach edge
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

// Curved arrow path with a slight bend
function arrowPath(from, to) {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  // Perpendicular offset for gentle curve
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const offset = Math.min(30, dist * 0.15);
  const nx = -dy / (dist || 1) * offset;
  const ny = dx / (dist || 1) * offset;
  const cx = mx + nx;
  const cy = my + ny;
  return { path: `M${from.x},${from.y} Q${cx},${cy} ${to.x},${to.y}`, cx, cy };
}

export default function CanvasArrows({ connections, notePositions, cardWidths, cardHeights, onDeleteConnection }) {
  const [confirmId, setConfirmId] = useState(null);

  const arrows = useMemo(() => {
    if (!connections || connections.length === 0) return [];
    return connections.map(conn => {
      const sourcePos = notePositions[conn.source_note_id];
      const targetPos = notePositions[conn.target_note_id];
      if (!sourcePos || !targetPos) return null;

      const sw = cardWidths[conn.source_note_id] || 280;
      const sh = cardHeights[conn.source_note_id] || 200;
      const tw = cardWidths[conn.target_note_id] || 280;
      const th = cardHeights[conn.target_note_id] || 200;

      const { from, to } = getEdgePoints(sourcePos, sw, sh, targetPos, tw, th);
      const { path, cx, cy } = arrowPath(from, to);

      return { ...conn, from, to, path, cx, cy };
    }).filter(Boolean);
  }, [connections, notePositions, cardWidths, cardHeights]);

  if (arrows.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: '100%', height: '100%', overflow: 'visible' }}
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="5"
          markerHeight="4"
          refX="4.5"
          refY="2"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L5,2 L0,4 L1,2 Z" fill="#6366f1" />
        </marker>
        <marker
          id="arrowhead-hover"
          markerWidth="6"
          markerHeight="5"
          refX="5.5"
          refY="2.5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L6,2.5 L0,5 L1.25,2.5 Z" fill="#4f46e5" />
        </marker>
      </defs>

      {arrows.map(arrow => (
        <g key={arrow.id} className="group/arrow">
          {/* Wider invisible hit area for hover/click */}
          <path
            d={arrow.path}
            fill="none"
            stroke="transparent"
            strokeWidth="16"
            className="pointer-events-auto cursor-pointer"
            onClick={() => setConfirmId(confirmId === arrow.id ? null : arrow.id)}
          />
          {/* Visible arrow */}
          <path
            d={arrow.path}
            fill="none"
            stroke={confirmId === arrow.id ? '#ef4444' : '#6366f1'}
            strokeWidth={confirmId === arrow.id ? 3 : 2}
            strokeDasharray="none"
            markerEnd="url(#arrowhead)"
            className="transition-all pointer-events-none"
            opacity={confirmId === arrow.id ? 1 : 0.6}
          />
          {/* Delete confirmation tooltip */}
          {confirmId === arrow.id && (
            <foreignObject x={arrow.cx - 60} y={arrow.cy - 36} width="120" height="32" className="pointer-events-auto">
              <div className="flex items-center justify-center gap-1 bg-white rounded-lg shadow-lg border border-gray-200 px-2 py-1">
                <span className="text-xs text-gray-600">Hapus?</span>
                <button
                  className="text-xs text-white bg-red-500 hover:bg-red-600 rounded px-2 py-0.5 font-medium"
                  onClick={(e) => { e.stopPropagation(); onDeleteConnection?.(arrow.id); setConfirmId(null); }}
                >
                  Ya
                </button>
                <button
                  className="text-xs text-gray-500 hover:text-gray-700 px-1"
                  onClick={(e) => { e.stopPropagation(); setConfirmId(null); }}
                >
                  ✕
                </button>
              </div>
            </foreignObject>
          )}
          {/* Label */}
          {arrow.label && (
            <text
              x={arrow.cx}
              y={arrow.cy - 6}
              textAnchor="middle"
              className="text-[10px] fill-gray-500 pointer-events-none select-none"
              style={{ fontFamily: 'system-ui, sans-serif' }}
            >
              {arrow.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
