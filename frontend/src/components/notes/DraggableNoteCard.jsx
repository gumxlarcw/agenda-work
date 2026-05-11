import { useRef, useCallback } from 'react';
import { useDraggable } from '@dnd-kit/core';
import NoteCard from './NoteCard';

// Free-position draggable wrapper for NoteCard with corner resize handle.
// dnd-kit's onPointerDown calls preventDefault() which blocks native click,
// so we detect clicks manually via pointerDown/pointerUp distance check.
export default function DraggableNoteCard({ note, tags, position, cardWidth, cardHeight, onClick, onPin, onArchive, onDelete, onResize, currentUserId, zoom = 1, connectMode = false, isConnectSource = false, aggregatedProgress, childNotes, readOnly = false }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: note.id, disabled: readOnly });
  const pointerStart = useRef(null);
  const containerRef = useRef(null);
  const width = cardWidth || 280;
  const height = cardHeight || null; // null = auto height

  const style = {
    position: 'absolute',
    left: position.x,
    top: position.y,
    width,
    height: height || undefined,
    minHeight: 120,
    transform: transform ? `translate3d(${transform.x / zoom}px, ${transform.y / zoom}px, 0)` : undefined,
    zIndex: isDragging ? 100 : 1,
    boxShadow: isDragging ? '0 20px 40px rgba(0,0,0,0.15), 0 0 0 2px rgba(99,102,241,0.3)'
      : isConnectSource ? '0 0 0 3px rgba(99,102,241,0.5), 0 4px 12px rgba(99,102,241,0.2)' : undefined,
    transition: isDragging ? 'none' : 'box-shadow 0.2s',
    cursor: readOnly ? 'pointer' : connectMode ? 'crosshair' : isDragging ? 'grabbing' : 'grab',
  };

  const mergedOnPointerDown = useCallback((e) => {
    pointerStart.current = { x: e.clientX, y: e.clientY, target: e.target };
    listeners?.onPointerDown?.(e);
  }, [listeners]);

  const handlePointerUp = useCallback((e) => {
    if (!pointerStart.current) return;
    const dx = e.clientX - pointerStart.current.x;
    const dy = e.clientY - pointerStart.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 10) {
      const clickedAction = pointerStart.current.target?.closest?.('[data-note-actions]');
      const clickedResize = pointerStart.current.target?.closest?.('[data-resize-handle]');
      if (!clickedAction && !clickedResize) {
        onClick?.(note);
      }
    }
    pointerStart.current = null;
  }, [note, onClick]);

  // Corner resize (bottom-right): resizes both width and height
  const handleCornerResize = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = width;
    const el = containerRef.current || e.target.closest('[data-draggable-card]');
    const startH = el ? el.offsetHeight : (height || 200);

    const onMove = (ev) => {
      const newW = Math.round(Math.max(150, startW + (ev.clientX - startX) / zoom));
      const newH = Math.round(Math.max(80, startH + (ev.clientY - startY) / zoom));
      if (el) {
        el.style.width = newW + 'px';
        el.style.height = newH + 'px';
      }
    };
    const onUp = (ev) => {
      const finalW = Math.round(Math.max(150, startW + (ev.clientX - startX) / zoom));
      const finalH = Math.round(Math.max(80, startH + (ev.clientY - startY) / zoom));
      onResize?.(note.id, finalW, finalH);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [width, height, note.id, onResize, zoom]);

  return (
    <div
      ref={(node) => { setNodeRef(node); containerRef.current = node; }}
      style={style}
      data-draggable-card
      data-note-id={note.id}
      {...attributes}
      {...listeners}
      onPointerDown={mergedOnPointerDown}
      onPointerUp={handlePointerUp}
      className="group"
    >
      <NoteCard
        note={note}
        tags={tags}
        onPin={onPin}
        onArchive={onArchive}
        onDelete={onDelete}
        fillHeight={!!height}
        currentUserId={currentUserId}
        aggregatedProgress={aggregatedProgress}
        childNotes={childNotes}
        compact={false}
      />
      {/* Corner resize handle — hidden in readOnly mode */}
      {!readOnly && (
        <div
          data-resize-handle
          onPointerDown={handleCornerResize}
          className="absolute bottom-1 right-1 w-5 h-5 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
        >
          <svg viewBox="0 0 16 16" className="w-full h-full text-gray-400">
            <path d="M14 14L14 8M14 14L8 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M14 14L10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
          </svg>
        </div>
      )}
    </div>
  );
}
