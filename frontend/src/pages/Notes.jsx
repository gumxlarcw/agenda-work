import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  HiOutlinePlus,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineMenu,
  HiOutlineChevronDown,
  HiOutlineDocumentText,
  HiOutlineStar,
  HiOutlineUsers,
  HiOutlineUser,
  HiOutlineArchive,
  HiOutlineZoomIn,
  HiOutlineZoomOut,
  HiOutlineArrowRight,
} from 'react-icons/hi';
import {
  DndContext,
  DragOverlay,
} from '@dnd-kit/core';

import NoteSidebar from '../components/notes/NoteSidebar';
import NoteCard from '../components/notes/NoteCard';
import useNoteFilters from '../components/notes/hooks/useNoteFilters';
import useNoteDnD from '../components/notes/hooks/useNoteDnD';
import useNoteEditor from '../components/notes/hooks/useNoteEditor';
import useNotes from '../components/notes/hooks/useNotes';
import ConfirmDialog from '../components/notes/ConfirmDialog';
import DraggableNoteCard from '../components/notes/DraggableNoteCard';
import NoteEditorModal from '../components/notes/NoteEditorModal';
import ErrorBoundary from '../components/ErrorBoundary';
import CanvasArrows from '../components/notes/CanvasArrows';
import FolderManager from '../components/notes/FolderManager';
import TagManager from '../components/notes/TagManager';
import TemplateSelector from '../components/notes/TemplateSelector';
import useNoteConnections from '../components/notes/hooks/useNoteConnections';
import { notesAPI, noteFoldersAPI } from '../services/api';
import CanvasContextMenu from '../components/notes/CanvasContextMenu';
import PublicLinkModal from '../components/notes/PublicLinkModal';
import FolderShareModal from '../components/notes/FolderShareModal';

export default function Notes() {
  const { isAdmin, user } = useAuth();

  // Filters (search, folder, tag, filter, page + debounce)
  const {
    activeFolder, setActiveFolder, activeTag, setActiveTag,
    filter, setFilter, searchQuery, setSearchQuery, debouncedSearch,
    page, setPage,
    handleSelectFolder, handleSelectTag, handleFilterChange,
  } = useNoteFilters();

  // View
  const [showSidebar, setShowSidebar] = useState(false);

  // Modal visibility
  const [showFolderManager, setShowFolderManager] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [publicLinkModal, setPublicLinkModal] = useState(null); // { noteId, folderId, noteTitle, folderName }
  const [folderShareModal, setFolderShareModal] = useState(null); // { folderId, folderName }
  const [sharedFolders, setSharedFolders] = useState([]);
  const [activeSharedFolder, setActiveSharedFolder] = useState(null);

  const createMenuRef = useRef(null);

  // ─── Data + CRUD (hook) ──────────────────────────────────
  const {
    notes, folders, tags, templates, loading, initialLoad,
    total, totalPages, counts,
    fetchNotes,
    handleDelete: getDeleteConfirm, handleArchive: doArchive, handlePin,
    handleShareSave: doShareSave, handleImageUpload: doImageUpload, handleSummarize,
    handleSaveAsTemplate: doSaveAsTemplate,
    handleFolderCreate, handleFolderUpdate, handleFolderDelete,
    handleTagCreate, handleTagUpdate, handleTagDelete,
    handleTemplateDelete,
  } = useNotes({ page, setPage, debouncedSearch, activeFolder, setActiveFolder, activeTag, setActiveTag, filter });

  // ─── Free-position drag and drop ────────────────────────
  const {
    activeNote, notePositions, cardWidths, cardHeights,
    snapEnabled, setSnapEnabled,
    canvasRef, sensors, modifiers,
    canvasHeight, canvasWidth, SNAP_GRID, CANVAS_PAD,
    handleDragStart, handleDragEnd,
    handleCardResize, handleResetLayout,
    zoom, zoomIn, zoomOut, zoomReset, zoomFit,
    panOffset, isPanning, spaceDown, canvasWrapperRef,
    handleCanvasPanStart, handleCanvasPanMove, handleCanvasPanEnd,
    onEscapeRef,
  } = useNoteDnD(notes, 'grid', `f${activeFolder || ''}_t${activeTag || ''}_${filter}`, { useOwnerLayout: !!activeSharedFolder });

  // ─── Note connections (arrows) ────────────────────────
  // When viewing shared folder, load owner's connections
  const sharedFolderOwnerId = activeSharedFolder
    ? (sharedFolders.find(f => f.id === activeSharedFolder)?.user_id || null)
    : null;
  const {
    connections, connectMode, connectSource,
    deleteConnection, startConnectMode, cancelConnectMode, handleConnectClick,
  } = useNoteConnections(sharedFolderOwnerId);

  // Wire Escape key to cancel connect mode
  useEffect(() => {
    onEscapeRef.current = () => { if (connectMode) cancelConnectMode(); };
    return () => { onEscapeRef.current = null; };
  }, [connectMode, cancelConnectMode, onEscapeRef]);

  // ─── Editor (hook) ──────────────────────────────────────
  const {
    selectedNote, showEditor, editorLoading, saving, isDirty,
    editorTitle, setEditorTitle,
    editorContent, setEditorContent,
    editorPlainText, setEditorPlainText,
    editorFolder, setEditorFolder,
    editorTags, toggleEditorTag,
    editorColor, setEditorColor,
    editorPinned, setEditorPinned,
    confirmDialog, setConfirmDialog,
    setIsDirty, setShowEditor,
    openNewNote, openExistingNote,
    handleSave, handleEditorBack,
    editorReadOnly, lockInfo, userRole, forceTakeover,
    onNoteCreatedRef,
  } = useNoteEditor({ fetchNotes, activeFolder });

  // ─── Load shared folders ─────────────────────────────────
  useEffect(() => {
    noteFoldersAPI.getSharedWithMe()
      .then(res => setSharedFolders(res.data.data || []))
      .catch(() => {});
  }, []);

  // ─── When a shared folder is selected, load its notes ───
  const handleSelectSharedFolder = useCallback((folderId) => {
    if (activeSharedFolder === folderId) {
      // Toggle off — return to clean 'all' state
      setActiveSharedFolder(null);
      setActiveFolder(null);
      setActiveTag(null);
      setFilter('all');
      setSearchQuery('');
      setPage(1);
    } else {
      // Enter shared folder view
      setActiveSharedFolder(folderId);
      setActiveFolder(folderId);
      setActiveTag(null);
      setFilter('all');
      setSearchQuery('');
      setPage(1);
    }
  }, [activeSharedFolder, setActiveFolder, setActiveTag, setFilter, setSearchQuery, setPage]);

  // Track pending position for notes created via double-click on canvas
  const pendingPositionRef = useRef(null);

  // Wire: after note is created, set its canvas position if pending
  useEffect(() => {
    onNoteCreatedRef.current = async (newNoteId) => {
      const pos = pendingPositionRef.current;
      if (!pos) return;
      pendingPositionRef.current = null;
      try {
        await notesAPI.updatePosition(newNoteId, pos.x, pos.y);
      } catch { /* ignore */ }
    };
    return () => { onNoteCreatedRef.current = null; };
  }, [onNoteCreatedRef]);

  // Wrap openNewNote/openExistingNote to also close local modals
  const handleOpenNewNote = useCallback((template = null) => {
    setShowTemplateSelector(false);
    setShowCreateMenu(false);
    openNewNote(template);
  }, [openNewNote]);

  // Double-click on empty canvas → create note at that position (disabled in shared folder view)
  const handleCanvasDoubleClick = useCallback((e) => {
    if (activeSharedFolder) return;
    // Only trigger on the canvas background, not on notes
    if (e.target.closest('[data-draggable-card]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const canvasX = Math.round((e.clientX - rect.left - panOffset.x) / zoom);
    const canvasY = Math.round((e.clientY - rect.top - panOffset.y) / zoom);
    pendingPositionRef.current = { x: canvasX, y: canvasY };
    handleOpenNewNote();
  }, [panOffset, zoom, handleOpenNewNote, activeSharedFolder]);

  // Right-click context menu
  const handleCanvasContextMenu = useCallback((e) => {
    e.preventDefault();
    const noteCard = e.target.closest('[data-draggable-card]');
    const rect = e.currentTarget.getBoundingClientRect();
    const canvasX = Math.round((e.clientX - rect.left - panOffset.x) / zoom);
    const canvasY = Math.round((e.clientY - rect.top - panOffset.y) / zoom);

    if (noteCard) {
      const noteId = noteCard.dataset?.noteId || noteCard.closest('[data-note-id]')?.dataset?.noteId;
      const note = notes.find(n => String(n.id) === String(noteId));
      setContextMenu({ type: 'note', clientX: e.clientX, clientY: e.clientY, note, canvasX, canvasY });
    } else {
      setContextMenu({ type: 'canvas', clientX: e.clientX, clientY: e.clientY, canvasX, canvasY });
    }
  }, [notes, panOffset, zoom]);

  const handleOpenExistingNote = useCallback((note) => {
    // If in connect mode, handle connection click instead of opening editor
    if (handleConnectClick(note.id)) return;
    openExistingNote(note);
  }, [openExistingNote, handleConnectClick]);

  // ─── Close create menu on outside click ────────────────
  useEffect(() => {
    function handleClickOutside(e) {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target)) {
        setShowCreateMenu(false);
      }
    }
    if (showCreateMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showCreateMenu]);

  // ─── Handle opening the folder share modal ─────────────
  const handleShareFolder = useCallback((folderId) => {
    const folder = folders.find(f => f.id === folderId);
    setFolderShareModal({ folderId, folderName: folder?.name || 'Folder' });
  }, [folders]);

  // ─── Active folder name ────────────────────────────────
  const activeFolderName = useMemo(() => {
    if (activeSharedFolder) {
      const sf = sharedFolders.find(f => f.id === activeSharedFolder);
      return sf ? `${sf.name} (shared by ${sf.owner_name})` : null;
    }
    if (!activeFolder) return null;
    return folders.find(f => f.id === activeFolder)?.name;
  }, [activeFolder, activeSharedFolder, folders, sharedFolders]);

  const activeTagObj = useMemo(() => {
    if (!activeTag) return null;
    return tags.find(t => t.id === activeTag);
  }, [activeTag, tags]);

  // ─── Thin wrappers for cross-hook handlers ────────────
  const handleDelete = useCallback((noteId) => {
    setConfirmDialog(getDeleteConfirm(noteId, { showEditor, selectedNote, setShowEditor }));
  }, [getDeleteConfirm, showEditor, selectedNote, setShowEditor, setConfirmDialog]);

  const handleArchive = useCallback((noteId) => {
    doArchive(noteId, { showEditor, selectedNote, setShowEditor });
  }, [doArchive, showEditor, selectedNote, setShowEditor]);

  const handleContextAction = useCallback((action, menu) => {
    const isShared = !!activeSharedFolder;
    if (action === 'create') {
      if (isShared) return; // Can't create in shared folder
      pendingPositionRef.current = { x: menu.canvasX, y: menu.canvasY };
      handleOpenNewNote();
    } else if (action === 'resetLayout') {
      if (isShared) return; // Can't reset shared layout
      handleResetLayout(fetchNotes);
    } else if (action === 'fitAll') {
      zoomFit();
    } else if (menu.note) {
      if (action === 'edit') handleOpenExistingNote(menu.note);
      else if (action === 'pin') handlePin(menu.note.id);
      else if (isShared) return; // Block archive/delete/connect in shared view
      else if (action === 'archive') handleArchive(menu.note.id);
      else if (action === 'delete') handleDelete(menu.note.id);
      else if (action === 'connect') {
        startConnectMode();
        handleConnectClick(menu.note.id);
      }
    }
  }, [handleOpenNewNote, handleResetLayout, fetchNotes, zoomFit, handleOpenExistingNote, handlePin, handleArchive, handleDelete, startConnectMode, handleConnectClick, activeSharedFolder]);

  const handleShareSave = useCallback((userIds, roles) => {
    doShareSave(selectedNote, userIds, roles, () => {});
  }, [doShareSave, selectedNote]);

  const handleImageUpload = useCallback((file) => {
    return doImageUpload(file, selectedNote);
  }, [doImageUpload, selectedNote]);

  const handleSaveAsTemplate = useCallback(() => {
    doSaveAsTemplate(editorTitle, editorContent);
  }, [doSaveAsTemplate, editorTitle, editorContent]);

  // ─── Master note aggregated progress + child notes map ──
  // For each "target" note, compute aggregated progress and per-child details
  const { aggregatedProgressMap, childNotesMap } = useMemo(() => {
    if (!connections || connections.length === 0 || notes.length === 0) return { aggregatedProgressMap: {}, childNotesMap: {} };
    const notesById = {};
    notes.forEach(n => { notesById[n.id] = n; });

    // Use DB-cached progress (includes StatusCell + checkboxes), fallback to content_json parse
    const getProgress = (note) => {
      if (!note) return null;
      if (note.progress_total > 0) {
        return { checked: note.progress_done, total: note.progress_total, pct: note.progress };
      }
      // Fallback: parse content_json for checkboxes + statusCells
      if (!note.content_json) return null;
      try {
        const json = typeof note.content_json === 'string' ? JSON.parse(note.content_json) : note.content_json;
        let total = 0, done = 0;
        const walk = (node) => {
          if (node.type === 'taskItem') { total++; if (node.attrs?.checked) done++; }
          if (node.type === 'statusCell') {
            total++;
            const status = node.attrs?.status || 'empty';
            const steps = node.attrs?.steps;
            if (steps && Array.isArray(steps)) {
              const idx = steps.findIndex(s => s.key === status);
              if (idx >= 0 && steps.length > 1) done += idx / (steps.length - 1);
            } else {
              if (status === 'complete') done += 1;
              else if (status === 'progress') done += 0.5;
            }
          }
          if (node.content) node.content.forEach(walk);
        };
        walk(json);
        return total > 0 ? { checked: Math.round(done * 10) / 10, total } : null;
      } catch { return null; }
    };

    // Group connections by target_note_id
    const targetMap = {};
    connections.forEach(c => {
      if (!targetMap[c.target_note_id]) targetMap[c.target_note_id] = [];
      targetMap[c.target_note_id].push(c.source_note_id);
    });

    const aggResult = {};
    const childResult = {};
    for (const [targetId, sourceIds] of Object.entries(targetMap)) {
      let totalChecked = 0, totalItems = 0;
      const children = [];
      sourceIds.forEach(srcId => {
        const note = notesById[srcId];
        if (!note) return;
        const prog = getProgress(note);
        children.push({ id: note.id, title: note.title, color: note.color, checked: prog?.checked || 0, total: prog?.total || 0 });
        if (prog) { totalChecked += prog.checked; totalItems += prog.total; }
      });
      childResult[targetId] = children;
      if (totalItems > 0) {
        aggResult[targetId] = { checked: totalChecked, total: totalItems, sources: sourceIds.length };
      }
    }
    return { aggregatedProgressMap: aggResult, childNotesMap: childResult };
  }, [connections, notes]);

  // ─── Quick stats for inline summary ────────────────────
  const quickStats = useMemo(() => {
    const pinned = notes.filter(n => n.is_pinned).length;
    const shared = notes.filter(n => {
      try {
        const s = typeof n.shared_with === 'string' ? JSON.parse(n.shared_with) : n.shared_with;
        return Array.isArray(s) && s.length > 0;
      } catch { return false; }
    }).length;
    return { pinned, shared };
  }, [notes]);

  // ─── Pagination controls ──────────────────────────────
  const paginationNumbers = useMemo(() => {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
      .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
      .reduce((acc, p, idx, arr) => {
        if (idx > 0 && p - arr[idx - 1] > 1) acc.push('...');
        acc.push(p);
        return acc;
      }, []);
  }, [page, totalPages]);

  // ═══════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════
  if (initialLoad && loading && !showEditor) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="h-16 bg-white rounded-2xl animate-pulse" />
        <div className="flex gap-5">
          <div className="hidden lg:block w-56 h-80 bg-white rounded-2xl animate-pulse" />
          <div className="flex-1 space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-32 bg-white rounded-xl animate-pulse" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    {/* ═══ Editor Modal Overlay ═══ */}
    {showEditor && (
      <ErrorBoundary>
        <NoteEditorModal
          selectedNote={selectedNote}
          editorLoading={editorLoading}
          saving={saving}
          editorTitle={editorTitle}
          setEditorTitle={setEditorTitle}
          editorContent={editorContent}
          setEditorContent={setEditorContent}
          editorPlainText={editorPlainText}
          setEditorPlainText={setEditorPlainText}
          editorFolder={editorFolder}
          setEditorFolder={setEditorFolder}
          editorTags={editorTags}
          toggleEditorTag={toggleEditorTag}
          editorColor={editorColor}
          setEditorColor={setEditorColor}
          editorPinned={editorPinned}
          setEditorPinned={setEditorPinned}
          setIsDirty={setIsDirty}
          folders={folders}
          tags={tags}
          onSave={handleSave}
          onBack={handleEditorBack}
          onSaveAsTemplate={handleSaveAsTemplate}
          onShareSave={handleShareSave}
          onImageUpload={handleImageUpload}
          onSummarize={handleSummarize}
          readOnly={editorReadOnly}
          lockInfo={lockInfo}
          userRole={userRole}
          onForceTakeover={forceTakeover}
          connectedChildren={childNotesMap[selectedNote?.id]}
          aggregatedProgress={aggregatedProgressMap[selectedNote?.id]}
        />
      </ErrorBoundary>
    )}

    {/* ═══ Main list view (always rendered) ═══ */}
    <div className={`flex flex-col animate-fadeIn ${notes.length > 0 ? 'h-[calc(100vh-4.5rem)] lg:h-[calc(100vh-5rem)] overflow-hidden' : ''}`}>
      {/* ══════ Header Row: Title + inline summary ══════ */}
      <div className="flex-shrink-0 mb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSidebar(true)}
              className="lg:hidden p-2 hover:bg-gray-100 rounded-xl transition-colors"
              aria-label="Buka sidebar"
            >
              <HiOutlineMenu className="w-5 h-5 text-gray-600" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-lg shadow-primary-200">
                <HiOutlineDocumentText className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Notes</h1>
                <p className="text-xs text-gray-400 mt-0.5">
                  {total} catatan
                  {activeFolderName && <span> di <strong className="text-gray-600">{activeFolderName}</strong></span>}
                  {activeTagObj && (
                    <span> · tag <span className="inline-block w-2 h-2 rounded-full align-middle" style={{ backgroundColor: activeTagObj.color }} /> <strong className="text-gray-600">{activeTagObj.name}</strong></span>
                  )}
                  {!activeFolderName && !activeTagObj && quickStats.pinned > 0 && (
                    <span> · {quickStats.pinned} pinned</span>
                  )}
                  {!activeFolderName && !activeTagObj && quickStats.shared > 0 && (
                    <span> · {quickStats.shared} shared</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Create button with dropdown — hidden when viewing shared folder */}
          {!activeSharedFolder && (
            <div className="relative" ref={createMenuRef}>
              <button
                onClick={() => setShowCreateMenu(!showCreateMenu)}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl shadow-sm shadow-primary-200 transition-all hover:shadow-md"
              >
                <HiOutlinePlus className="w-4 h-4" />
                <span className="hidden sm:inline">Catatan Baru</span>
                <HiOutlineChevronDown className="w-3.5 h-3.5" />
              </button>
              {showCreateMenu && (
                <div className="absolute right-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-xl py-1 w-48 z-20 animate-fadeIn">
                  <button
                    onClick={() => handleOpenNewNote()}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm text-gray-700 transition-colors"
                  >
                    Catatan kosong
                  </button>
                  <button
                    onClick={() => { setShowTemplateSelector(true); setShowCreateMenu(false); }}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm text-gray-700 transition-colors"
                  >
                    Dari template...
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      {/* ══════ Main content area with sidebar ══════ */}
      <div className="flex gap-3 flex-1 min-h-0">
        {/* Desktop Sidebar — Glassmorphism */}
        <div className="hidden lg:flex w-56 flex-shrink-0">
          <div className="sidebar-gradient rounded-2xl p-3 shadow-lg overflow-hidden flex flex-col w-full">
            <div className="absolute inset-0 sidebar-frost pointer-events-none rounded-2xl" />
            <div className="relative sidebar-nav-scroll flex-1 overflow-y-auto">
              <NoteSidebar
                folders={folders}
                tags={tags}
                counts={counts}
                activeFolder={activeFolder}
                activeTag={activeTag}
                filter={filter}
                onSelectFolder={(id) => { setActiveSharedFolder(null); setSearchQuery(''); handleSelectFolder(id); }}
                onSelectTag={(id) => { setActiveSharedFolder(null); setSearchQuery(''); handleSelectTag(id); }}
                onFilterChange={(f) => { setActiveSharedFolder(null); setSearchQuery(''); handleFilterChange(f); }}
                onManageFolders={() => setShowFolderManager(true)}
                onManageTags={() => setShowTagManager(true)}
                onQuickAddFolder={handleFolderCreate}
                onQuickAddTag={handleTagCreate}
                onPublicLink={(folderId, folderName) => setPublicLinkModal({ folderId, folderName })}
                onShareFolder={handleShareFolder}
                sharedFolders={sharedFolders}
                onSelectSharedFolder={handleSelectSharedFolder}
                activeSharedFolder={activeSharedFolder}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
              />
            </div>
          </div>
        </div>

        {/* Mobile Sidebar Overlay */}
        <NoteSidebar
          folders={folders}
          tags={tags}
          counts={counts}
          activeFolder={activeFolder}
          activeTag={activeTag}
          filter={filter}
          onSelectFolder={(id) => { setActiveSharedFolder(null); setSearchQuery(''); handleSelectFolder(id); setShowSidebar(false); }}
          onSelectTag={(id) => { setActiveSharedFolder(null); setSearchQuery(''); handleSelectTag(id); setShowSidebar(false); }}
          onFilterChange={(f) => { setActiveSharedFolder(null); setSearchQuery(''); handleFilterChange(f); setShowSidebar(false); }}
          onManageFolders={() => setShowFolderManager(true)}
          onManageTags={() => setShowTagManager(true)}
          onQuickAddFolder={handleFolderCreate}
          onQuickAddTag={handleTagCreate}
          onPublicLink={(folderId, folderName) => setPublicLinkModal({ folderId, folderName })}
          onShareFolder={handleShareFolder}
          sharedFolders={sharedFolders}
          onSelectSharedFolder={(id) => { handleSelectSharedFolder(id); setShowSidebar(false); }}
          activeSharedFolder={activeSharedFolder}
          show={showSidebar}
          onClose={() => setShowSidebar(false)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        {/* Notes grid / list */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {/* Loading overlay — keeps old content visible, dims with spinner */}
          <div className={`flex-1 min-h-0 flex flex-col transition-opacity duration-200 ${loading && notes.length > 0 ? 'opacity-50 pointer-events-none' : ''}`}>
            {loading && notes.length === 0 ? (
              <div className="flex items-center justify-center h-48 animate-fadeIn">
                <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
              </div>
            ) : notes.length === 0 && !loading ? (
              /* ── Empty state — compact for filters, full for default ── */
              filter === 'archived' || filter === 'pinned' || filter === 'shared' || filter === 'mine' ? (
                <div className="bg-white rounded-2xl p-8 text-center shadow-sm border border-gray-100 animate-fadeIn">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gray-50 flex items-center justify-center">
                    {filter === 'archived' ? <HiOutlineArchive className="w-6 h-6 text-gray-300" /> :
                     filter === 'pinned' ? <HiOutlineStar className="w-6 h-6 text-gray-300" /> :
                     filter === 'mine' ? <HiOutlineUser className="w-6 h-6 text-gray-300" /> :
                     <HiOutlineUsers className="w-6 h-6 text-gray-300" />}
                  </div>
                  <p className="text-sm text-gray-400">
                    {filter === 'archived' ? 'Tidak ada catatan di arsip' :
                     filter === 'pinned' ? 'Belum ada catatan yang di-pin' :
                     filter === 'mine' ? 'Belum ada catatan milik Anda' :
                     'Belum ada catatan yang di-share'}
                  </p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl p-12 text-center shadow-sm border border-gray-100 animate-fadeIn">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary-50 flex items-center justify-center">
                    <HiOutlineDocumentText className="w-8 h-8 text-primary-400" />
                  </div>
                  <h3 className="font-semibold text-gray-900 text-lg mb-1">
                    {debouncedSearch ? 'Tidak ditemukan' : 'Mulai mencatat'}
                  </h3>
                  <p className="text-gray-400 text-sm mb-5 max-w-xs mx-auto">
                    {debouncedSearch
                      ? `Tidak ada catatan untuk "${debouncedSearch}". Coba kata kunci lain.`
                      : 'Buat catatan pertama Anda untuk mulai mengorganisir ide dan informasi.'}
                  </p>
                  {!debouncedSearch && (
                    <button
                      onClick={() => handleOpenNewNote()}
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl shadow-sm shadow-primary-200 transition-all"
                    >
                      <HiOutlinePlus className="w-4 h-4" />
                      Buat Catatan
                    </button>
                  )}
                </div>
              )
            ) : notes.length > 0 ? (
              <div className="flex-1 min-h-0 flex flex-col">
                {/* Zoomable free-position canvas */}
                <DndContext
                    sensors={sensors}
                    modifiers={modifiers}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                  >
                  <div className="flex-1 min-h-0 flex flex-col">
                    {/* Canvas viewport — Figma-style infinite canvas */}
                    <div
                      ref={canvasWrapperRef}
                      className="relative overflow-hidden rounded-xl border border-gray-200 animate-fadeIn flex-1"
                      style={{
                        cursor: isPanning ? 'grabbing' : spaceDown ? 'grab' : 'default',
                        backgroundColor: '#e8eaed',
                      }}
                      onMouseDown={handleCanvasPanStart}
                      onMouseMove={handleCanvasPanMove}
                      onMouseUp={handleCanvasPanEnd}
                      onDoubleClick={handleCanvasDoubleClick}
                      onContextMenu={handleCanvasContextMenu}
                    >
                      {/* Grid dots layer — viewport-fixed, tiles infinitely like Figma */}
                      {snapEnabled && (
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            opacity: Math.min(0.3, zoom * 0.2),
                            backgroundImage: 'radial-gradient(circle, #6366f1 1px, transparent 1px)',
                            backgroundSize: `${SNAP_GRID * zoom}px ${SNAP_GRID * zoom}px`,
                            backgroundPosition: `${((panOffset.x % (SNAP_GRID * zoom)) + SNAP_GRID * zoom) % (SNAP_GRID * zoom)}px ${((panOffset.y % (SNAP_GRID * zoom)) + SNAP_GRID * zoom) % (SNAP_GRID * zoom)}px`,
                          }}
                        />
                      )}

                      {/* Canvas layer — transformed by zoom & pan */}
                      <div
                        ref={canvasRef}
                        className="absolute"
                        style={{
                          width: canvasWidth + CANVAS_PAD,
                          height: canvasHeight + CANVAS_PAD,
                          transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
                          transformOrigin: '0 0',
                        }}
                      >
                        {/* Artboard — white canvas area with shadow */}
                        <div
                          className="absolute inset-0 rounded-2xl pointer-events-none"
                          style={{
                            backgroundColor: '#ffffff',
                            boxShadow: '0 2px 20px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)',
                          }}
                        />
                        {/* SVG arrows between connected notes */}
                        <CanvasArrows
                          connections={connections}
                          notePositions={notePositions}
                          cardWidths={cardWidths}
                          cardHeights={cardHeights}
                          onDeleteConnection={activeSharedFolder ? undefined : deleteConnection}
                        />

                        {notes.map(note => (
                          <DraggableNoteCard
                            key={note.id}
                            note={note}
                            position={notePositions[note.id] || { x: 0, y: 0 }}
                            cardWidth={cardWidths[note.id]}
                            cardHeight={cardHeights[note.id]}
                            tags={note.tags || []}
                            onClick={(n) => handleOpenExistingNote(n)}
                            onPin={(n) => handlePin(n.id)}
                            onArchive={activeSharedFolder ? undefined : (n) => handleArchive(n.id)}
                            onDelete={activeSharedFolder ? undefined : (n) => handleDelete(n.id)}
                            onResize={handleCardResize}
                            currentUserId={user?.id}
                            zoom={zoom}
                            connectMode={connectMode}
                            isConnectSource={connectSource === note.id}
                            readOnly={!!activeSharedFolder}
                            aggregatedProgress={aggregatedProgressMap[note.id]}
                            childNotes={childNotesMap[note.id]}
                          />
                        ))}
                      </div>

                      {/* Zoom controls — floating bottom-right */}
                      <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-xl px-1.5 py-1 shadow-lg z-30">
                        <button
                          onClick={zoomOut}
                          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-600"
                          title="Zoom out (Ctrl+Scroll ↓)"
                          aria-label="Perkecil"
                        >
                          <HiOutlineZoomOut className="w-4 h-4" />
                        </button>
                        <button
                          onClick={zoomReset}
                          className="px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors min-w-[3rem] text-center"
                          title="Reset zoom"
                          aria-label="Reset zoom"
                        >
                          {Math.round(zoom * 100)}%
                        </button>
                        <button
                          onClick={zoomIn}
                          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-600"
                          title="Zoom in (Ctrl+Scroll ↑)"
                          aria-label="Perbesar"
                        >
                          <HiOutlineZoomIn className="w-4 h-4" />
                        </button>
                        <div className="w-px h-5 bg-gray-200" />
                        <button
                          onClick={zoomFit}
                          className="px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Fit semua catatan"
                        >
                          Fit
                        </button>
                      </div>

                      {/* Connect mode button — bottom-left next to shortcut hint */}
                      <div className="absolute bottom-3 left-3 flex items-center gap-2 z-30">
                        {!activeSharedFolder && (
                          <button
                            onClick={connectMode ? cancelConnectMode : startConnectMode}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border transition-all shadow-sm ${
                              connectMode
                                ? 'bg-primary-600 text-white border-primary-600 shadow-primary-200'
                                : 'bg-white/90 backdrop-blur-sm text-gray-600 border-gray-200 hover:bg-gray-50'
                            }`}
                            title={connectMode ? 'Batal menghubungkan' : 'Hubungkan catatan'}
                          >
                            <HiOutlineArrowRight className="w-3.5 h-3.5" />
                            {connectMode
                              ? (connectSource ? 'Pilih target...' : 'Pilih sumber...')
                              : 'Hubungkan'}
                          </button>
                        )}
                        <div className="text-[10px] text-gray-400 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-xl px-2.5 py-1.5 shadow-sm leading-relaxed">
                          <span className="font-medium text-gray-500">Scroll</span> geser
                          <span className="mx-1 text-gray-300">·</span>
                          <span className="font-medium text-gray-500">Ctrl+Scroll</span> zoom
                          <span className="mx-1 text-gray-300">·</span>
                          <span className="font-medium text-gray-500">Space+Drag</span> geser
                          <span className="mx-1 text-gray-300">·</span>
                          <span className="font-medium text-gray-500">Pinch</span> zoom
                        </div>
                      </div>
                    </div>
                  </div>
                    <DragOverlay dropAnimation={null} />
                </DndContext>

                {/* Right-click context menu */}
                <CanvasContextMenu
                  menu={contextMenu}
                  onClose={() => setContextMenu(null)}
                  onAction={handleContextAction}
                  readOnly={!!activeSharedFolder}
                />

                {/* ── Pagination ── */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between bg-white rounded-xl p-3 border border-gray-100 mt-5">
                    <p className="text-xs text-gray-400">
                      {(page - 1) * 12 + 1}–{Math.min(page * 12, total)} dari {total}
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        aria-label="Halaman sebelumnya"
                      >
                        <HiOutlineChevronLeft className="w-4 h-4" />
                      </button>
                      {paginationNumbers.map((p, idx) =>
                        p === '...' ? (
                          <span key={`gap-${idx}`} className="px-1.5 text-gray-300 text-xs">...</span>
                        ) : (
                          <button
                            key={p}
                            onClick={() => setPage(p)}
                            className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                              page === p
                                ? 'bg-primary-600 text-white shadow-sm'
                                : 'hover:bg-gray-100 text-gray-500'
                            }`}
                          >
                            {p}
                          </button>
                        )
                      )}
                      <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                        className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        aria-label="Halaman berikutnya"
                      >
                        <HiOutlineChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
          {/* Loading spinner overlay for refetch */}
          {loading && notes.length > 0 && (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>

      {/* ═══ Modals ═══ */}

      {showFolderManager && (
        <FolderManager
          folders={folders}
          onClose={() => setShowFolderManager(false)}
          onCreate={handleFolderCreate}
          onUpdate={handleFolderUpdate}
          onDelete={handleFolderDelete}
        />
      )}

      {showTagManager && (
        <TagManager
          tags={tags}
          onClose={() => setShowTagManager(false)}
          onCreate={handleTagCreate}
          onUpdate={handleTagUpdate}
          onDelete={handleTagDelete}
        />
      )}

      {showTemplateSelector && (
        <TemplateSelector
          templates={templates}
          onSelect={(template) => handleOpenNewNote(template)}
          onDelete={handleTemplateDelete}
          onClose={() => setShowTemplateSelector(false)}
        />
      )}

      {publicLinkModal && (
        <PublicLinkModal
          onClose={() => setPublicLinkModal(null)}
          noteId={publicLinkModal.noteId}
          folderId={publicLinkModal.folderId}
          noteTitle={publicLinkModal.noteTitle}
          folderName={publicLinkModal.folderName}
        />
      )}

      {folderShareModal && (
        <FolderShareModal
          folderId={folderShareModal.folderId}
          folderName={folderShareModal.folderName}
          onClose={() => setFolderShareModal(null)}
        />
      )}
    </div>

    {/* ═══ Confirm Dialog ═══ */}
    <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
    </>
  );
}
