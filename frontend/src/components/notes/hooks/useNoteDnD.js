import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { createSnapModifier } from '@dnd-kit/modifiers';
import { notesAPI } from '../../../services/api';

const SNAP_GRID = 20;
const ZOOM_MIN = 0.01;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.02;

// Per-context localStorage helpers
const CANVAS_PREFIX = 'canvas_ctx_';
const getCanvasState = (ctxKey) => {
  try {
    const raw = localStorage.getItem(CANVAS_PREFIX + ctxKey);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const setCanvasState = (ctxKey, state) => {
  try { localStorage.setItem(CANVAS_PREFIX + ctxKey, JSON.stringify(state)); } catch {}
};

export default function useNoteDnD(notes, viewMode, contextKey = '', { useOwnerLayout = false } = {}) {
  // Load saved state for initial context on first render
  const initialState = getCanvasState(contextKey);

  const [activeId, setActiveId] = useState(null);
  const [notePositions, setNotePositions] = useState(() => initialState?.positions || {});
  const [cardWidths, setCardWidths] = useState(() => initialState?.widths || {});
  const [cardHeights, setCardHeights] = useState(() => initialState?.heights || {});
  const [snapEnabled, setSnapEnabled] = useState(false);
  const canvasRef = useRef(null);

  // Zoom & pan state — initialized from per-context localStorage
  const [zoom, setZoom] = useState(() => initialState?.zoom ?? 1);
  const [panOffset, setPanOffset] = useState(() => initialState?.pan ?? { x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef(null);
  const [viewportSize, setViewportSize] = useState({ w: 1200, h: 800 });
  const zoomRef = useRef(zoom);

  // Keep zoomRef in sync
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // Refs for current state (used by saveContextState to avoid stale closures)
  const positionsRef = useRef(notePositions);
  const widthsRef = useRef(cardWidths);
  const heightsRef = useRef(cardHeights);
  const panRef = useRef(panOffset);
  useEffect(() => { positionsRef.current = notePositions; }, [notePositions]);
  useEffect(() => { widthsRef.current = cardWidths; }, [cardWidths]);
  useEffect(() => { heightsRef.current = cardHeights; }, [cardHeights]);
  useEffect(() => { panRef.current = panOffset; }, [panOffset]);

  // Save full canvas state for a given context key
  const saveContextState = useCallback((ctxKey) => {
    if (!ctxKey && ctxKey !== '') return;
    const hasPositions = Object.keys(positionsRef.current).length > 0;
    if (!hasPositions) return; // Don't save empty state
    setCanvasState(ctxKey, {
      positions: positionsRef.current,
      widths: widthsRef.current,
      heights: heightsRef.current,
      zoom: zoomRef.current,
      pan: panRef.current,
    });
  }, []);

  // Debounced sync positions to DB (for public links)
  const dbSyncTimerRef = useRef(null);
  const syncPositionsToDB = useCallback(() => {
    if (useOwnerLayout) return; // Don't sync positions for shared folder view
    clearTimeout(dbSyncTimerRef.current);
    dbSyncTimerRef.current = setTimeout(() => {
      const pos = positionsRef.current;
      if (Object.keys(pos).length === 0) return;
      notesAPI.syncPositions(pos, widthsRef.current, heightsRef.current).catch(() => {});
    }, 3000); // 3s debounce
  }, [useOwnerLayout]);

  // Save state on unmount (page navigation / tab close) — skip for shared view
  useEffect(() => {
    const onBeforeUnload = () => { if (!useOwnerLayout) saveContextState(prevContextRef.current); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (!useOwnerLayout) saveContextState(prevContextRef.current);
      clearTimeout(dbSyncTimerRef.current);
    };
  }, [saveContextState, useOwnerLayout]);

  // Track viewport size via ResizeObserver for reactive canvas bounds
  useEffect(() => {
    const wrapper = canvasRef.current?.parentElement;
    if (!wrapper) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setViewportSize({ w: width, h: height });
    });
    ro.observe(wrapper);
    setViewportSize({ w: wrapper.clientWidth, h: wrapper.clientHeight });
    return () => ro.disconnect();
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );
  const snapModifier = useMemo(() => createSnapModifier(SNAP_GRID), []);
  const modifiers = snapEnabled ? [snapModifier] : [];

  // Save current context state before switching, restore target context state
  const prevContextRef = useRef(contextKey);
  useEffect(() => {
    if (prevContextRef.current !== contextKey) {
      // Save outgoing context state (skip for owner layout mode)
      if (!useOwnerLayout) saveContextState(prevContextRef.current);
      prevContextRef.current = contextKey;
      initialSyncDone.current = false; // Reset so DB sync fires on new context

      if (useOwnerLayout) {
        // Shared folder: always clear and use DB positions from API
        setNotePositions({});
        setCardWidths({});
        setCardHeights({});
        setPanOffset({ x: 0, y: 0 });
        setZoom(1);
      } else {
        // Normal: restore from localStorage
        const saved = getCanvasState(contextKey);
        if (saved) {
          setNotePositions(saved.positions || {});
          setCardWidths(saved.widths || {});
          setCardHeights(saved.heights || {});
          setPanOffset(saved.pan || { x: 0, y: 0 });
          setZoom(saved.zoom ?? 1);
        } else {
          setNotePositions({});
          setCardWidths({});
          setCardHeights({});
          setPanOffset({ x: 0, y: 0 });
          setZoom(1);
        }
      }
    }
  }, [contextKey, useOwnerLayout]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute initial positions for notes without saved positions
  useEffect(() => {
    if (notes.length === 0) return;
    setNotePositions(prev => {
      const next = { ...prev };
      const CARD_W = 320; // 280 card + 40 gap
      const CARD_H = 260; // ~220 card + 40 gap
      const cols = 3;
      let autoIdx = 0;
      notes.forEach(note => {
        if (next[note.id]) return; // Already has position (from localStorage restore)
        if (note.position_x != null && note.position_y != null) {
          next[note.id] = { x: note.position_x, y: note.position_y };
        } else {
          const col = autoIdx % cols;
          const row = Math.floor(autoIdx / cols);
          next[note.id] = { x: col * CARD_W, y: row * CARD_H };
          autoIdx++;
        }
      });
      return next;
    });
    setCardWidths(prev => {
      const next = { ...prev };
      notes.forEach(note => {
        if (note.card_width && !next[note.id]) next[note.id] = note.card_width;
      });
      return next;
    });
    setCardHeights(prev => {
      const next = { ...prev };
      notes.forEach(note => {
        if (note.card_height && !next[note.id]) next[note.id] = note.card_height;
      });
      return next;
    });
  }, [notes]);

  // Sync positions to DB on first load (so public links get latest positions)
  const initialSyncDone = useRef(false);
  useEffect(() => {
    if (initialSyncDone.current) return;
    if (Object.keys(notePositions).length > 0 && notes.length > 0) {
      initialSyncDone.current = true;
      syncPositionsToDB();
    }
  }, [notePositions, notes, syncPositionsToDB]);

  // Canvas bounds — at least viewport-sized (in canvas-space), expands to fit all notes.
  // No zoom division needed — CSS scale(zoom) on the canvas div already handles visual sizing.
  const CANVAS_PAD = 200;

  const canvasHeight = useMemo(() => {
    if (viewMode !== 'grid') return 0;
    let maxY = viewportSize.h;
    Object.entries(notePositions).forEach(([id, pos]) => {
      const h = cardHeights[id] || 200;
      if (pos.y + h + CANVAS_PAD > maxY) maxY = pos.y + h + CANVAS_PAD;
    });
    return maxY;
  }, [notePositions, cardHeights, viewMode, viewportSize.h]);

  const canvasWidth = useMemo(() => {
    if (viewMode !== 'grid') return 0;
    let maxX = viewportSize.w;
    Object.entries(notePositions).forEach(([id, pos]) => {
      const w = cardWidths[id] || 280;
      if (pos.x + w + CANVAS_PAD > maxX) maxX = pos.x + w + CANVAS_PAD;
    });
    return maxX;
  }, [notePositions, cardWidths, viewMode, viewportSize.w]);

  const handleDragStart = useCallback((event) => {
    setActiveId(event.active.id);
  }, []);

  // DnD delta must be divided by zoom for accurate positioning
  const handleDragEnd = useCallback((event) => {
    setActiveId(null);
    if (useOwnerLayout) return; // Shared view: don't allow drag
    const { active, delta } = event;
    if (!delta || (delta.x === 0 && delta.y === 0)) return;

    const noteId = active.id;
    const currentPos = notePositions[noteId] || { x: 0, y: 0 };
    const z = zoomRef.current;
    const newX = Math.round(Math.max(0, currentPos.x + delta.x / z));
    const newY = Math.round(Math.max(0, currentPos.y + delta.y / z));

    setNotePositions(prev => {
      const next = { ...prev, [noteId]: { x: newX, y: newY } };
      // Defer save to next tick so refs are updated
      setTimeout(() => { saveContextState(prevContextRef.current); syncPositionsToDB(); }, 0);
      return next;
    });
  }, [notePositions, saveContextState, syncPositionsToDB, useOwnerLayout]);

  const handleCardResize = useCallback((noteId, newWidth, newHeight) => {
    if (useOwnerLayout) return; // Shared view: don't allow resize
    if (newWidth != null) setCardWidths(prev => ({ ...prev, [noteId]: newWidth }));
    if (newHeight != null) setCardHeights(prev => ({ ...prev, [noteId]: newHeight }));
    // Save context state after resize
    setTimeout(() => { saveContextState(prevContextRef.current); syncPositionsToDB(); }, 0);
  }, [saveContextState, syncPositionsToDB, useOwnerLayout]);

  const handleResetLayout = useCallback((fetchNotes) => {
    setNotePositions({});
    setCardWidths({});
    setCardHeights({});
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    // Clear saved state for current context
    try { localStorage.removeItem(CANVAS_PREFIX + prevContextRef.current); } catch {}
    fetchNotes();
  }, []);

  // ─── Zoom handlers ─────────────────────────────────────
  const zoomIn = useCallback(() => {
    setZoom(z => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom(z => {
      const newZ = Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100);
      // Auto-reset pan when canvas fits in viewport
      const wrapper = canvasRef.current?.parentElement;
      if (wrapper) {
        const scaledW = (canvasWidth + CANVAS_PAD) * newZ;
        const scaledH = (canvasHeight + CANVAS_PAD) * newZ;
        if (scaledW <= wrapper.clientWidth && scaledH <= wrapper.clientHeight) {
          setPanOffset({ x: 0, y: 0 });
        }
      }
      return newZ;
    });
  }, [canvasWidth, canvasHeight]);

  const zoomReset = useCallback(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  // Fit all notes in viewport
  const zoomFit = useCallback(() => {
    if (!canvasRef.current || notes.length === 0) return;
    const wrapper = canvasRef.current.parentElement;
    if (!wrapper) return;

    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    notes.forEach(n => {
      const pos = notePositions[n.id] || { x: 0, y: 0 };
      const w = cardWidths[n.id] || 280;
      const h = cardHeights[n.id] || 200;
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.x + w > maxX) maxX = pos.x + w;
      if (pos.y + h > maxY) maxY = pos.y + h;
    });

    const contentW = maxX - minX + 40;
    const contentH = maxY - minY + 40;
    const viewW = wrapper.clientWidth;
    const viewH = wrapper.clientHeight || 600;

    const fitZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(viewW / contentW, viewH / contentH)));
    const finalZoom = Math.round(fitZoom * 100) / 100;
    setZoom(finalZoom);
    // Pan must account for zoom: center content in viewport
    const scaledContentW = contentW * finalZoom;
    const scaledContentH = contentH * finalZoom;
    const offsetX = (viewW - scaledContentW) / 2 - minX * finalZoom;
    const offsetY = (viewH - scaledContentH) / 2 - minY * finalZoom;
    setPanOffset({ x: offsetX, y: offsetY });
  }, [notes, notePositions, cardWidths, cardHeights]);

  // ─── Wheel handler: Ctrl+scroll=zoom, scroll=pan, Shift+scroll=horizontal pan ───
  const wheelHandlerRef = useRef(null);
  const canvasWrapperRef = useCallback((node) => {
    if (wheelHandlerRef.current) {
      wheelHandlerRef.current.el.removeEventListener('wheel', wheelHandlerRef.current.fn);
      wheelHandlerRef.current = null;
    }
    if (!node) return;

    const onWheel = (e) => {
      e.preventDefault();

      // Ctrl+scroll OR trackpad pinch (browser sends ctrlKey=true for pinch)
      if (e.ctrlKey || e.metaKey) {
        const rect = node.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;

        setZoom(prevZoom => {
          // Use larger step for smoother trackpad pinch
          const step = Math.abs(e.deltaY) < 10 ? ZOOM_STEP * 0.5 : ZOOM_STEP;
          const delta = e.deltaY < 0 ? step : -step;
          const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round((prevZoom + delta) * 100) / 100));
          const scaleFactor = newZoom / prevZoom;

          setPanOffset(prev => ({
            x: cursorX - scaleFactor * (cursorX - prev.x),
            y: cursorY - scaleFactor * (cursorY - prev.y),
          }));

          return newZoom;
        });
        return;
      }

      // Shift+scroll → horizontal pan
      if (e.shiftKey) {
        setPanOffset(prev => ({ x: prev.x - e.deltaY, y: prev.y }));
        return;
      }

      // Plain scroll → pan (vertical + horizontal if trackpad)
      setPanOffset(prev => ({
        x: prev.x - (e.deltaX || 0),
        y: prev.y - e.deltaY,
      }));
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    wheelHandlerRef.current = { el: node, fn: onWheel };
  }, []);

  // Auto-save context state on zoom/pan changes (debounced) — skip for shared view
  const saveTimerRef = useRef(null);
  useEffect(() => {
    if (useOwnerLayout) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveContextState(prevContextRef.current);
    }, 500);
    return () => clearTimeout(saveTimerRef.current);
  }, [zoom, panOffset, saveContextState]);

  // Check if entire canvas fits in viewport — if so, disable pan
  const canPan = useMemo(() => {
    const scaledW = (canvasWidth + CANVAS_PAD) * zoom;
    const scaledH = (canvasHeight + CANVAS_PAD) * zoom;
    return scaledW > viewportSize.w || scaledH > viewportSize.h;
  }, [canvasWidth, canvasHeight, zoom, viewportSize]);

  const onEscapeRef = useRef(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const spaceDownRef = useRef(false);

  useEffect(() => {
    const isEditing = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;

    const onKeyDown = (e) => {
      if (isEditing(e)) return;

      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
      else if (ctrl && e.key === '-') { e.preventDefault(); zoomOut(); }
      else if (ctrl && e.key === '0') { e.preventDefault(); zoomReset(); }
      else if (e.key === 'Escape') { onEscapeRef.current?.(); }
      else if (e.key === ' ' && !spaceDownRef.current) {
        e.preventDefault();
        spaceDownRef.current = true;
        setSpaceDown(true);
      }
    };
    const onKeyUp = (e) => {
      if (e.key === ' ') {
        spaceDownRef.current = false;
        setSpaceDown(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [zoomIn, zoomOut, zoomReset]);

  // Pan via middle-click OR Space+left-click
  const handleCanvasPanStart = useCallback((e) => {
    const isMiddle = e.button === 1;
    const isSpaceDrag = e.button === 0 && spaceDownRef.current;
    if (!isMiddle && !isSpaceDrag) return;
    e.preventDefault();
    setIsPanning(true);
    panStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
  }, [panOffset]);

  const handleCanvasPanMove = useCallback((e) => {
    if (!isPanning || !panStartRef.current) return;
    setPanOffset({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    });
  }, [isPanning]);

  const handleCanvasPanEnd = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  // Global mouse events for panning (so drag continues outside canvas)
  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e) => {
      if (!panStartRef.current) return;
      setPanOffset({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
    };
    const onUp = () => {
      setIsPanning(false);
      panStartRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isPanning]);

  const activeNote = activeId ? notes.find(n => n.id === activeId) : null;

  return {
    activeNote,
    notePositions, cardWidths, cardHeights,
    snapEnabled, setSnapEnabled,
    canvasRef, sensors, modifiers,
    canvasHeight, canvasWidth, SNAP_GRID, CANVAS_PAD,
    handleDragStart, handleDragEnd,
    handleCardResize, handleResetLayout,
    // Zoom & pan
    zoom, zoomIn, zoomOut, zoomReset, zoomFit,
    panOffset, isPanning, spaceDown, canvasWrapperRef,
    handleCanvasPanStart, handleCanvasPanMove, handleCanvasPanEnd,
    onEscapeRef,
  };
}
