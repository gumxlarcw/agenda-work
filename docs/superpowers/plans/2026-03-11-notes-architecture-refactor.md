# Notes Architecture Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor monolithic `Notes.jsx` (1,407 lines) into custom hooks + extracted UI components incrementally, with zero behavior changes.

**Architecture:** Extract 4 custom hooks (`useNoteFilters`, `useNoteDnD`, `useNoteEditor`, `useNotes`) to encapsulate state + logic, then extract 5 UI components (`NoteToolbar`, `NoteGridView`, `NoteListView`, `NoteEditorModal`, `ConfirmDialog`). Notes.jsx becomes a ~150-line thin orchestrator.

**Tech Stack:** React 18 (hooks), @dnd-kit/core + modifiers, TipTap (lazy-loaded), Tailwind CSS, react-hot-toast, dayjs

---

## File Structure

```
frontend/src/
  pages/
    Notes.jsx                              — MODIFY: shrink from 1407 → ~150 lines
  components/notes/
    hooks/
      useNoteFilters.js                    — CREATE: search, folder, tag, filter state
      useNoteDnD.js                        — CREATE: positions, widths, drag/resize, snap
      useNoteEditor.js                     — CREATE: editor state, save, dirty, drafts, shortcuts
      useNotes.js                          — CREATE: CRUD, fetch, pagination, metadata
    DraggableNoteCard.jsx                  — CREATE: extract from Notes.jsx (lines 48-134)
    NoteGridView.jsx                       — CREATE: DndContext canvas + DraggableNoteCard
    NoteListView.jsx                       — CREATE: stacked NoteCard list
    NoteEditorModal.jsx                    — CREATE: editor modal overlay
    NoteToolbar.jsx                        — CREATE: search, view toggle, snap, create
    ConfirmDialog.jsx                      — CREATE: reusable confirm modal
```

**Existing files (unchanged):** `NoteEditor.jsx`, `NoteCard.jsx`, `NoteSidebar.jsx`, `FolderManager.jsx`, `TagManager.jsx`, `TemplateSelector.jsx`, `ShareModal.jsx`, `AISummaryPanel.jsx`

---

## Chunk 1: Custom Hooks

### Task 1: Extract `useNoteFilters` hook

**Files:**
- Create: `frontend/src/components/notes/hooks/useNoteFilters.js`
- Modify: `frontend/src/pages/Notes.jsx`

- [ ] **Step 1: Create the hooks directory**

```bash
mkdir -p frontend/src/components/notes/hooks
```

- [ ] **Step 2: Create `useNoteFilters.js`**

```js
import { useState, useEffect, useRef, useCallback } from 'react';

export default function useNoteFilters() {
  const [activeFolder, setActiveFolder] = useState(null);
  const [activeTag, setActiveTag] = useState(null);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimerRef = useRef(null);
  const [page, setPage] = useState(1);

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 400);
    return () => clearTimeout(searchTimerRef.current);
  }, [searchQuery]);

  const handleSelectFolder = useCallback((folderId) => {
    setActiveFolder(prev => folderId === prev ? null : folderId);
    setActiveTag(null);
    setPage(1);
  }, []);

  const handleSelectTag = useCallback((tagId) => {
    setActiveTag(prev => tagId === prev ? null : tagId);
    setActiveFolder(null);
    setPage(1);
  }, []);

  const handleFilterChange = useCallback((f) => {
    setFilter(f);
    setActiveFolder(null);
    setActiveTag(null);
    setPage(1);
  }, []);

  const resetFilters = useCallback(() => {
    setActiveFolder(null);
    setActiveTag(null);
    setFilter('all');
    setSearchQuery('');
    setPage(1);
  }, []);

  return {
    activeFolder, setActiveFolder,
    activeTag, setActiveTag,
    filter, setFilter,
    searchQuery, setSearchQuery,
    debouncedSearch,
    page, setPage,
    handleSelectFolder,
    handleSelectTag,
    handleFilterChange,
    resetFilters,
  };
}
```

- [ ] **Step 3: Update Notes.jsx — replace filter state with hook**

In `Notes.jsx`, replace:
- Lines 161-167 (filter state declarations)
- Lines 156-159 (pagination state — `page` moves to hook, keep `totalPages`/`total` in Notes)
- Lines 341-349 (debounced search useEffect)
- Lines 763-781 (handleSelectFolder, handleSelectTag, handleFilterChange)

Add import:
```js
import useNoteFilters from '../components/notes/hooks/useNoteFilters';
```

Inside `Notes()`, replace all those state/effects/handlers with:
```js
const {
  activeFolder, setActiveFolder, activeTag, setActiveTag,
  filter, searchQuery, setSearchQuery, debouncedSearch,
  page, setPage,
  handleSelectFolder, handleSelectTag, handleFilterChange,
} = useNoteFilters();
```

Remove the standalone `page` useState and related lines. Keep `totalPages`, `total` in Notes.jsx (they come from API response).

- [ ] **Step 4: Build and verify**

```bash
cd frontend && npm run build
```

Expected: Build succeeds, no errors. All filter/search/pagination behavior unchanged.

- [ ] **Step 5: Manual test**

Open the app, verify:
- Search debounce works
- Folder/tag selection works
- Filter buttons (All/Pinned/Archived/Shared) work
- Pagination works
- Selecting a folder clears active tag (and vice versa)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/notes/hooks/useNoteFilters.js frontend/src/pages/Notes.jsx
git commit -m "refactor: extract useNoteFilters hook from Notes.jsx"
```

---

### Task 2: Extract `useNoteDnD` hook

**Files:**
- Create: `frontend/src/components/notes/hooks/useNoteDnD.js`
- Modify: `frontend/src/pages/Notes.jsx`

- [ ] **Step 1: Create `useNoteDnD.js`**

```js
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { createSnapModifier } from '@dnd-kit/modifiers';
import { notesAPI } from '../../../services/api';
import toast from 'react-hot-toast';

const SNAP_GRID = 20;

export default function useNoteDnD(notes, viewMode) {
  const [activeId, setActiveId] = useState(null);
  const [notePositions, setNotePositions] = useState({});
  const [cardWidths, setCardWidths] = useState({});
  const [snapEnabled, setSnapEnabled] = useState(false);
  const canvasRef = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );
  const snapModifier = useMemo(() => createSnapModifier(SNAP_GRID), []);
  const modifiers = snapEnabled ? [snapModifier] : [];

  // Compute initial positions for notes without saved positions
  useEffect(() => {
    if (notes.length === 0) return;
    setNotePositions(prev => {
      const next = { ...prev };
      const CARD_W = 296;
      const CARD_H = 216;
      const cols = 3;
      let autoIdx = 0;
      notes.forEach(note => {
        if (note.position_x != null && note.position_y != null) {
          next[note.id] = { x: note.position_x, y: note.position_y };
        } else if (!next[note.id]) {
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
  }, [notes]);

  // Canvas height based on furthest note
  const canvasHeight = useMemo(() => {
    if (viewMode !== 'grid') return 0;
    let maxY = 400;
    Object.values(notePositions).forEach(pos => {
      if (pos.y + 220 > maxY) maxY = pos.y + 220;
    });
    return maxY + 60;
  }, [notePositions, viewMode]);

  const handleDragStart = useCallback((event) => {
    setActiveId(event.active.id);
  }, []);

  const handleDragEnd = useCallback(async (event) => {
    setActiveId(null);
    const { active, delta } = event;
    if (!delta || (delta.x === 0 && delta.y === 0)) return;

    const noteId = active.id;
    const currentPos = notePositions[noteId] || { x: 0, y: 0 };
    const newX = Math.max(0, currentPos.x + delta.x);
    const newY = Math.max(0, currentPos.y + delta.y);

    setNotePositions(prev => ({ ...prev, [noteId]: { x: newX, y: newY } }));

    try {
      await notesAPI.updatePosition(noteId, newX, newY);
    } catch (error) {
      toast.error('Gagal menyimpan posisi');
    }
  }, [notePositions]);

  const handleCardResize = useCallback(async (noteId, newWidth) => {
    setCardWidths(prev => ({ ...prev, [noteId]: newWidth }));
    const pos = notePositions[noteId] || { x: 0, y: 0 };
    try {
      await notesAPI.updatePosition(noteId, pos.x, pos.y, newWidth);
    } catch { /* ignore */ }
  }, [notePositions]);

  const handleResetLayout = useCallback(async (fetchNotes) => {
    setNotePositions({});
    setCardWidths({});
    try {
      await Promise.all(notes.map(n => notesAPI.updatePosition(n.id, null, null, null)));
      fetchNotes();
    } catch { /* ignore */ }
  }, [notes]);

  const activeNote = activeId ? notes.find(n => n.id === activeId) : null;

  return {
    activeId, activeNote,
    notePositions, cardWidths,
    snapEnabled, setSnapEnabled,
    canvasRef, sensors, modifiers,
    canvasHeight, SNAP_GRID,
    handleDragStart, handleDragEnd,
    handleCardResize, handleResetLayout,
  };
}
```

- [ ] **Step 2: Update Notes.jsx — replace DnD state with hook**

Remove from Notes.jsx:
- Lines 241-252 (DnD state: activeId, notePositions, cardWidths, snapEnabled, sensors, SNAP_GRID, snapModifier, modifiers)
- Lines 254-283 (position sync useEffect)
- Lines 285-293 (canvasHeight memo)
- Lines 295-339 (handleDragStart, handleDragEnd, handleCardResize, handleResetLayout, activeNote)

Add import:
```js
import useNoteDnD from '../components/notes/hooks/useNoteDnD';
```

Inside `Notes()`:
```js
const {
  activeNote, notePositions, cardWidths,
  snapEnabled, setSnapEnabled,
  canvasRef, sensors, modifiers,
  canvasHeight, SNAP_GRID,
  handleDragStart, handleDragEnd,
  handleCardResize, handleResetLayout,
} = useNoteDnD(notes, viewMode);
```

Update `handleResetLayout` call in JSX — it now takes `fetchNotes` as argument:
```jsx
onClick={() => handleResetLayout(fetchNotes)}
```

- [ ] **Step 3: Build and verify**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Manual test**

- Grid view: drag cards, verify positions persist
- Snap toggle: enable/disable, verify grid dots and snapping
- Resize: drag right edge of card, verify width persists
- Reset Layout button: verify all positions reset
- List view: verify no DnD interference

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/notes/hooks/useNoteDnD.js frontend/src/pages/Notes.jsx
git commit -m "refactor: extract useNoteDnD hook from Notes.jsx"
```

---

### Task 3: Extract `useNoteEditor` hook

**Files:**
- Create: `frontend/src/components/notes/hooks/useNoteEditor.js`
- Modify: `frontend/src/pages/Notes.jsx`

This is the largest extraction (~200 lines). The hook manages: editor visibility, all editor field state, dirty tracking, draft autosave, open/close/save logic, keyboard shortcuts.

- [ ] **Step 1: Create `useNoteEditor.js`**

```js
import { useState, useEffect, useCallback, useRef } from 'react';
import { notesAPI } from '../../../services/api';
import toast from 'react-hot-toast';

const DRAFT_KEY = 'notes_draft';

// Safe JSON parse helper
function safeParseJson(input) {
  if (!input) return null;
  if (typeof input !== 'string') return input;
  try { return JSON.parse(input); } catch { return null; }
}

export default function useNoteEditor({ fetchNotes, activeFolder }) {
  // Editor field state
  const [selectedNote, setSelectedNote] = useState(null);
  const [editorTitle, setEditorTitle] = useState('');
  const [editorContent, setEditorContent] = useState(null);
  const [editorPlainText, setEditorPlainText] = useState('');
  const [editorFolder, setEditorFolder] = useState(null);
  const [editorTags, setEditorTags] = useState([]);
  const [editorColor, setEditorColor] = useState('#ffffff');
  const [editorPinned, setEditorPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Draft autosave
  const draftTimerRef = useRef(null);

  useEffect(() => {
    if (!showEditor || selectedNote) return;
    if (!isDirty) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          title: editorTitle,
          content: editorContent,
          plainText: editorPlainText,
          folder: editorFolder,
          tags: editorTags,
          color: editorColor,
          savedAt: Date.now(),
        }));
      } catch { /* quota exceeded */ }
    }, 2000);
    return () => clearTimeout(draftTimerRef.current);
  }, [showEditor, selectedNote, isDirty, editorTitle, editorContent, editorPlainText, editorFolder, editorTags, editorColor]);

  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
  }, []);

  // Open new note
  const openNewNote = useCallback((template = null) => {
    setSelectedNote(null);

    let draft = null;
    if (!template) {
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.savedAt && Date.now() - parsed.savedAt < 86400000) {
            draft = parsed;
          } else {
            localStorage.removeItem(DRAFT_KEY);
          }
        }
      } catch { /* ignore */ }
    }

    if (draft) {
      setEditorTitle(draft.title || '');
      setEditorContent(draft.content || null);
      setEditorPlainText(draft.plainText || '');
      setEditorFolder(draft.folder || null);
      setEditorTags(draft.tags || []);
      setEditorColor(draft.color || '#ffffff');
      setIsDirty(true);
      toast('Draft dipulihkan', { icon: '\ud83d\udcdd', duration: 2000 });
    } else {
      setEditorTitle('');
      setEditorContent(template?.content_json ? safeParseJson(template.content_json) : null);
      setEditorPlainText('');
      setEditorFolder(activeFolder || null);
      setEditorTags([]);
      setEditorColor('#ffffff');
      setIsDirty(false);
    }

    setEditorPinned(false);
    setShowEditor(true);
  }, [activeFolder]);

  // Open existing note
  const openExistingNote = useCallback(async (note) => {
    setShowEditor(true);
    setEditorLoading(true);
    try {
      const res = await notesAPI.getOne(note.id);
      const full = res.data.data || res.data;
      setSelectedNote(full);
      setEditorTitle(full.title || '');
      const parsedJson = full.content_json ? safeParseJson(full.content_json) : null;
      setEditorContent(parsedJson || (full.content ? {
        type: 'doc',
        content: full.content.split('\n').map(line => ({
          type: 'paragraph',
          content: line ? [{ type: 'text', text: line }] : [],
        })),
      } : null));
      setEditorPlainText(full.content || '');
      setEditorFolder(full.folder_id || null);
      setEditorTags(full.tags ? full.tags.map(t => t.id) : []);
      setEditorColor(full.color || '#ffffff');
      setEditorPinned(!!full.is_pinned);
      setIsDirty(false);
    } catch (error) {
      toast.error('Gagal memuat catatan');
      setShowEditor(false);
    } finally {
      setEditorLoading(false);
    }
  }, []);

  // Save note
  const handleSave = useCallback(async () => {
    if (!editorTitle.trim()) {
      toast.error('Judul tidak boleh kosong');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: editorTitle.trim(),
        content: editorPlainText,
        content_json: editorContent,
        folder_id: editorFolder || null,
        tag_ids: editorTags,
        color: editorColor,
        is_pinned: editorPinned,
      };

      if (selectedNote) {
        await notesAPI.update(selectedNote.id, payload);
        toast.success('Catatan diperbarui');
      } else {
        await notesAPI.create(payload);
        toast.success('Catatan dibuat');
        clearDraft();
      }

      setShowEditor(false);
      setIsDirty(false);
      fetchNotes();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Gagal menyimpan catatan');
    } finally {
      setSaving(false);
    }
  }, [editorTitle, editorPlainText, editorContent, editorFolder, editorTags, editorColor, editorPinned, selectedNote, clearDraft, fetchNotes]);

  // Close with unsaved-changes guard
  const handleEditorBack = useCallback(() => {
    if (!isDirty) {
      setShowEditor(false);
      return;
    }
    setConfirmDialog({
      message: 'Perubahan belum disimpan. Keluar tanpa menyimpan?',
      onConfirm: () => {
        setShowEditor(false);
        setIsDirty(false);
        if (!selectedNote) clearDraft();
        setConfirmDialog(null);
      },
    });
  }, [isDirty, selectedNote, clearDraft]);

  // Keyboard shortcuts (Esc close, Ctrl+S save)
  const handleEditorBackRef = useRef(null);
  const handleSaveRef = useRef(null);
  handleEditorBackRef.current = handleEditorBack;
  handleSaveRef.current = handleSave;

  useEffect(() => {
    if (!showEditor) return;
    const handler = (e) => {
      if (e.key === 'Escape') { handleEditorBackRef.current(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showEditor]);

  // Toggle tag in editor
  const toggleEditorTag = useCallback((tagId) => {
    setEditorTags(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    );
  }, []);

  return {
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
  };
}
```

- [ ] **Step 2: Update Notes.jsx — replace editor state with hook**

Remove from Notes.jsx:
- Lines 136-141 (`safeParseJson` — moved to hook)
- Lines 181-226 (all editor state, confirm dialog, DRAFT_KEY, draftTimerRef, autosave useEffect, clearDraft)
- Lines 396-410 (keyboard shortcuts: refs + useEffect)
- Lines 429-507 (openNewNote, openExistingNote)
- Lines 509-565 (handleSave, handleEditorBack, ref assignments)
- Lines 783-788 (toggleEditorTag)

Add import:
```js
import useNoteEditor from '../components/notes/hooks/useNoteEditor';
```

Inside `Notes()`:
```js
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
} = useNoteEditor({ fetchNotes, activeFolder });
```

Note: `fetchNotes` is used by `handleSave`. Since `useNotes` (Task 4) doesn't exist yet, keep `fetchNotes` as a local function for now. Task 4 will move it.

- [ ] **Step 3: Build and verify**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Manual test**

- Create new note → save → verify created
- Open existing note → edit → save → verify updated
- Edit note → close without saving → verify confirm dialog
- Edit note → Ctrl+S → verify saves
- Edit note → Esc → verify closes (with confirm if dirty)
- Create new note → type some text → close browser → reopen → create new → verify draft restored
- Verify no TDZ errors in console

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/notes/hooks/useNoteEditor.js frontend/src/pages/Notes.jsx
git commit -m "refactor: extract useNoteEditor hook from Notes.jsx"
```

---

### Task 4: Extract `useNotes` hook

**Files:**
- Create: `frontend/src/components/notes/hooks/useNotes.js`
- Modify: `frontend/src/pages/Notes.jsx`

- [ ] **Step 1: Create `useNotes.js`**

```js
import { useState, useEffect, useCallback } from 'react';
import { notesAPI, noteFoldersAPI, noteTagsAPI, noteTemplatesAPI } from '../../../services/api';
import toast from 'react-hot-toast';

const ITEMS_PER_PAGE = 12;

export default function useNotes({ page, setPage, debouncedSearch, activeFolder, setActiveFolder, activeTag, setActiveTag, filter }) {
  const [notes, setNotes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [tags, setTags] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Fetch notes
  const fetchNotes = useCallback(async () => {
    try {
      setLoading(true);
      const params = { page, limit: ITEMS_PER_PAGE };
      if (debouncedSearch) params.search = debouncedSearch;
      if (activeFolder) params.folder_id = activeFolder;
      if (activeTag) params.tag_id = activeTag;
      if (filter === 'pinned') params.is_pinned = 1;
      if (filter === 'archived') params.is_archived = 1;
      if (filter === 'shared') params.shared = 1;

      const response = await notesAPI.getAll(params);
      setNotes(response.data.data || []);
      if (response.data.pagination) {
        setTotalPages(response.data.pagination.totalPages);
        setTotal(response.data.pagination.total);
      }
    } catch (error) {
      toast.error('Gagal memuat catatan');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, activeFolder, activeTag, filter]);

  // Fetch metadata (once)
  const fetchMetadata = useCallback(async () => {
    try {
      const [foldersRes, tagsRes, templatesRes] = await Promise.all([
        noteFoldersAPI.getAll(),
        noteTagsAPI.getAll(),
        noteTemplatesAPI.getAll(),
      ]);
      setFolders(foldersRes.data.data || foldersRes.data || []);
      setTags(tagsRes.data.data || tagsRes.data || []);
      setTemplates(templatesRes.data.data || templatesRes.data || []);
    } catch (error) {
      console.error('Failed to fetch metadata:', error);
    }
  }, []);

  useEffect(() => { fetchMetadata(); }, [fetchMetadata]);
  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  // Delete note
  const handleDelete = useCallback((noteId, { showEditor, selectedNote, setShowEditor }) => {
    return {
      message: 'Hapus catatan ini?',
      confirmLabel: 'Hapus',
      confirmColor: 'red',
      onConfirm: async () => {
        try {
          await notesAPI.delete(noteId);
          toast.success('Catatan dihapus');
          if (showEditor && selectedNote?.id === noteId) {
            setShowEditor(false);
          }
          if (notes.length === 1 && page > 1) {
            setPage(page - 1);
          } else {
            fetchNotes();
          }
        } catch (error) {
          toast.error('Gagal menghapus catatan');
        }
      },
    };
  }, [notes, page, setPage, fetchNotes]);

  // Archive note
  const handleArchive = useCallback(async (noteId, { showEditor, selectedNote, setShowEditor }) => {
    try {
      await notesAPI.archive(noteId);
      toast.success('Catatan diarsipkan');
      if (showEditor && selectedNote?.id === noteId) {
        setShowEditor(false);
      }
      fetchNotes();
    } catch (error) {
      toast.error('Gagal mengarsipkan catatan');
    }
  }, [fetchNotes]);

  // Pin toggle
  const handlePin = useCallback(async (noteId) => {
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    try {
      await notesAPI.update(noteId, { is_pinned: !note.is_pinned });
      fetchNotes();
    } catch (error) {
      toast.error('Gagal memperbarui catatan');
    }
  }, [notes, fetchNotes]);

  // Share handler
  const handleShareSave = useCallback(async (selectedNote, userIds, setShowShareModal) => {
    if (!selectedNote) return;
    try {
      await notesAPI.share(selectedNote.id, userIds);
      toast.success('Sharing diperbarui');
      setShowShareModal(false);
    } catch (error) {
      toast.error('Gagal memperbarui sharing');
    }
  }, []);

  // Image upload
  const handleImageUpload = useCallback(async (file, selectedNote) => {
    if (!selectedNote) {
      toast.error('Simpan catatan terlebih dahulu sebelum mengunggah gambar');
      return null;
    }
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await notesAPI.uploadAttachment(selectedNote.id, formData);
      return res.data.data?.url || res.data.url;
    } catch (error) {
      toast.error('Gagal mengunggah gambar');
      return null;
    }
  }, []);

  // AI summarize
  const handleSummarize = useCallback(async (noteId) => {
    const res = await notesAPI.summarize(noteId);
    return res.data.data?.ai_summary || res.data.ai_summary || '';
  }, []);

  // Template creation
  const handleSaveAsTemplate = useCallback(async (title, content) => {
    if (!title?.trim() || !content) {
      toast.error('Buat catatan terlebih dahulu');
      return;
    }
    try {
      await noteTemplatesAPI.create({ name: title.trim(), content_json: content });
      toast.success('Template disimpan');
      const res = await noteTemplatesAPI.getAll();
      setTemplates(res.data.data || res.data || []);
    } catch (error) {
      toast.error('Gagal menyimpan template');
    }
  }, []);

  // Folder CRUD
  const handleFolderCreate = useCallback(async (data) => {
    try {
      await noteFoldersAPI.create(data);
      const res = await noteFoldersAPI.getAll();
      setFolders(res.data.data || res.data || []);
      toast.success('Folder dibuat');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Gagal membuat folder');
      throw error;
    }
  }, []);

  const handleFolderUpdate = useCallback(async (id, data) => {
    try {
      await noteFoldersAPI.update(id, data);
      const res = await noteFoldersAPI.getAll();
      setFolders(res.data.data || res.data || []);
      toast.success('Folder diperbarui');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Gagal memperbarui folder');
      throw error;
    }
  }, []);

  const handleFolderDelete = useCallback(async (id) => {
    try {
      await noteFoldersAPI.delete(id);
      if (activeFolder === id) setActiveFolder(null);
      const res = await noteFoldersAPI.getAll();
      setFolders(res.data.data || res.data || []);
      toast.success('Folder dihapus');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Gagal menghapus folder');
      throw error;
    }
  }, [activeFolder, setActiveFolder]);

  // Tag CRUD
  const handleTagCreate = useCallback(async (data) => {
    try {
      await noteTagsAPI.create(data);
      const res = await noteTagsAPI.getAll();
      setTags(res.data.data || res.data || []);
      toast.success('Tag dibuat');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Gagal membuat tag');
      throw error;
    }
  }, []);

  const handleTagUpdate = useCallback(async (id, data) => {
    try {
      await noteTagsAPI.update(id, data);
      const res = await noteTagsAPI.getAll();
      setTags(res.data.data || res.data || []);
      toast.success('Tag diperbarui');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Gagal memperbarui tag');
      throw error;
    }
  }, []);

  const handleTagDelete = useCallback(async (id) => {
    try {
      await noteTagsAPI.delete(id);
      if (activeTag === id) setActiveTag(null);
      const res = await noteTagsAPI.getAll();
      setTags(res.data.data || res.data || []);
      toast.success('Tag dihapus');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Gagal menghapus tag');
      throw error;
    }
  }, [activeTag, setActiveTag]);

  // Template delete
  const handleTemplateDelete = useCallback(async (id) => {
    try {
      await noteTemplatesAPI.delete(id);
      const res = await noteTemplatesAPI.getAll();
      setTemplates(res.data.data || res.data || []);
      toast.success('Template dihapus');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Gagal menghapus template');
      throw error;
    }
  }, []);

  return {
    notes, folders, tags, templates, loading,
    total, totalPages,
    fetchNotes, fetchMetadata,
    handleDelete, handleArchive, handlePin,
    handleShareSave, handleImageUpload, handleSummarize,
    handleSaveAsTemplate,
    handleFolderCreate, handleFolderUpdate, handleFolderDelete,
    handleTagCreate, handleTagUpdate, handleTagDelete,
    handleTemplateDelete,
  };
}
```

- [ ] **Step 2: Update Notes.jsx**

Remove from Notes.jsx:
- Lines 149-154 (data state: notes, folders, tags, templates, loading)
- Lines 157-159 (totalPages, total)
- Lines 351-414 (fetchNotes, fetchMetadata, useEffects)
- Lines 567-761 (all CRUD handlers: handleDelete through handleTemplateDelete)
- Lines 790-810 (activeFolderName, activeTagObj, paginationNumbers memos — keep these in Notes.jsx, they're view-related)

Add import:
```js
import useNotes from '../components/notes/hooks/useNotes';
```

Inside `Notes()`:
```js
const {
  notes, folders, tags, templates, loading,
  total, totalPages,
  fetchNotes,
  handleDelete: getDeleteConfirm, handleArchive: doArchive, handlePin,
  handleShareSave: doShareSave, handleImageUpload: doImageUpload, handleSummarize,
  handleSaveAsTemplate: doSaveAsTemplate,
  handleFolderCreate, handleFolderUpdate, handleFolderDelete,
  handleTagCreate, handleTagUpdate, handleTagDelete,
  handleTemplateDelete,
} = useNotes({ page, setPage, debouncedSearch, activeFolder, setActiveFolder, activeTag, setActiveTag, filter });
```

Note: `handleDelete` and `handleArchive` now have different signatures (they accept editor context). Create thin wrappers in Notes.jsx:
```js
const onDelete = (noteId) => {
  setConfirmDialog(getDeleteConfirm(noteId, { showEditor, selectedNote, setShowEditor }));
};
const onArchive = (noteId) => doArchive(noteId, { showEditor, selectedNote, setShowEditor });
const onShareSave = (userIds) => doShareSave(selectedNote, userIds, setShowShareModal);
const onImageUpload = (file) => doImageUpload(file, selectedNote);
const onSaveAsTemplate = () => doSaveAsTemplate(editorTitle, editorContent);
```

- [ ] **Step 3: Build and verify**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Manual test**

- CRUD: create, read, update, delete notes
- Folders: create, update, delete, filter by folder
- Tags: create, update, delete, filter by tag
- Templates: create from note, select template, delete template
- Share: share a note, verify modal
- Pin/archive: toggle pin, archive
- Image upload: verify it works for saved notes
- AI summary: generate summary

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/notes/hooks/useNotes.js frontend/src/pages/Notes.jsx
git commit -m "refactor: extract useNotes hook from Notes.jsx"
```

---

## Chunk 2: UI Component Extraction

### Task 5: Extract `ConfirmDialog` and `DraggableNoteCard` components

**Files:**
- Create: `frontend/src/components/notes/ConfirmDialog.jsx`
- Create: `frontend/src/components/notes/DraggableNoteCard.jsx`
- Modify: `frontend/src/pages/Notes.jsx`

- [ ] **Step 1: Create `ConfirmDialog.jsx`**

```jsx
export default function ConfirmDialog({ dialog, onClose }) {
  if (!dialog) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl animate-fadeIn">
        <div className="p-6">
          <p className="text-gray-800 text-sm">{dialog.message}</p>
        </div>
        <div className="flex justify-end gap-2 px-6 pb-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Batal
          </button>
          <button
            onClick={dialog.onConfirm}
            className={`px-4 py-2 text-sm text-white rounded-lg transition-colors ${
              dialog.confirmColor === 'red'
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-primary-600 hover:bg-primary-700'
            }`}
          >
            {dialog.confirmLabel || 'Ya'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `DraggableNoteCard.jsx`**

Move the `DraggableNoteCard` function (lines 48-134 of Notes.jsx) into its own file:

```jsx
import { useRef, useCallback } from 'react';
import { useDraggable } from '@dnd-kit/core';
import NoteCard from './NoteCard';

export default function DraggableNoteCard({ note, tags, position, cardWidth, onClick, onPin, onArchive, onDelete, onResize }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: note.id });
  const pointerStart = useRef(null);
  const resizeRef = useRef(null);
  const width = cardWidth || 280;

  const style = {
    position: 'absolute',
    left: position.x,
    top: position.y,
    width,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 100 : 1,
    transition: isDragging ? 'none' : 'box-shadow 0.2s',
    cursor: isDragging ? 'grabbing' : 'grab',
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
    if (dist < 5) {
      const clickedAction = pointerStart.current.target?.closest?.('[data-note-actions]');
      if (!clickedAction) {
        onClick?.(note);
      }
    }
    pointerStart.current = null;
  }, [note, onClick]);

  const handleResizeStart = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev) => {
      const newW = Math.max(200, Math.min(800, startW + ev.clientX - startX));
      resizeRef.current?.style && (resizeRef.current.parentElement.style.width = newW + 'px');
    };
    const onUp = (ev) => {
      const finalW = Math.max(200, Math.min(800, startW + ev.clientX - startX));
      onResize?.(note.id, finalW);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [width, note.id, onResize]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onPointerDown={mergedOnPointerDown}
      onPointerUp={handlePointerUp}
    >
      <NoteCard
        note={note}
        tags={tags}
        onPin={onPin}
        onArchive={onArchive}
        onDelete={onDelete}
      />
      <div
        ref={resizeRef}
        onPointerDown={handleResizeStart}
        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize opacity-0 hover:opacity-100 group-hover:opacity-50 transition-opacity"
        style={{ cursor: 'col-resize' }}
      >
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-gray-300 rounded-full" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update Notes.jsx**

- Remove inline `DraggableNoteCard` function (lines 45-134)
- Remove inline confirm dialog JSX (lines 1377-1404)
- Add imports:
```js
import ConfirmDialog from '../components/notes/ConfirmDialog';
import DraggableNoteCard from '../components/notes/DraggableNoteCard';
```
- Replace confirm dialog JSX with:
```jsx
<ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
```
- Remove `useDraggable` from dnd-kit import (no longer needed in Notes.jsx)

- [ ] **Step 4: Build and verify**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Manual test**

- Drag cards in grid view
- Resize cards
- Click card to open editor
- Delete/archive/pin via hover buttons
- Confirm dialogs work (delete, unsaved changes)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/notes/ConfirmDialog.jsx frontend/src/components/notes/DraggableNoteCard.jsx frontend/src/pages/Notes.jsx
git commit -m "refactor: extract ConfirmDialog and DraggableNoteCard components"
```

---

### Task 6: Extract `NoteGridView`, `NoteListView`, `NoteToolbar`, `NoteEditorModal`

**Files:**
- Create: `frontend/src/components/notes/NoteGridView.jsx`
- Create: `frontend/src/components/notes/NoteListView.jsx`
- Create: `frontend/src/components/notes/NoteToolbar.jsx`
- Create: `frontend/src/components/notes/NoteEditorModal.jsx`
- Modify: `frontend/src/pages/Notes.jsx`

This is the final extraction. After this, Notes.jsx becomes a thin orchestrator (~150 lines).

**Important:** The exact implementation of these components depends on the state of Notes.jsx after Tasks 1-5. The implementing agent should:

1. Read the current Notes.jsx (post Tasks 1-5)
2. Extract each JSX section into its own component
3. Pass all needed data/handlers as props
4. Keep the component interfaces minimal

**Component boundaries:**

- **`NoteToolbar`** — receives: `searchQuery`, `setSearchQuery`, `viewMode`, `setViewMode`, `snapEnabled`, `setSnapEnabled`, `showCreateMenu`, `setShowCreateMenu`, `notes.length`, `handleResetLayout`, `openNewNote`, `setShowTemplateSelector`, `total`, `activeFolderName`, `activeTagObj`, `setShowSidebar`, `createMenuRef`, `fetchNotes`
- **`NoteGridView`** — receives: DnD props (`sensors`, `modifiers`, `handleDragStart`, `handleDragEnd`, `canvasRef`, `canvasHeight`, `snapEnabled`, `SNAP_GRID`), `notes`, `notePositions`, `cardWidths`, `activeNote`, card handlers (`openExistingNote`, `handlePin`, `onArchive`, `onDelete`, `handleCardResize`)
- **`NoteListView`** — receives: `notes`, card handlers (`openExistingNote`, `handlePin`, `onArchive`, `onDelete`)
- **`NoteEditorModal`** — receives: all editor state and handlers from `useNoteEditor`, `folders`, `tags`, `selectedNote`, plus modal-specific handlers (`handleSummarize`, `onSaveAsTemplate`, `onShareSave`, `onImageUpload`)

- [ ] **Step 1: Create all 4 component files**

Extract the JSX from Notes.jsx into each file, passing needed values as props.

- [ ] **Step 2: Update Notes.jsx to import and use the new components**

Notes.jsx should now look approximately like:

```jsx
import { useState, useEffect, useMemo, useRef } from 'react';
import useNoteFilters from '../components/notes/hooks/useNoteFilters';
import useNoteDnD from '../components/notes/hooks/useNoteDnD';
import useNoteEditor from '../components/notes/hooks/useNoteEditor';
import useNotes from '../components/notes/hooks/useNotes';
import NoteSidebar from '../components/notes/NoteSidebar';
import NoteToolbar from '../components/notes/NoteToolbar';
import NoteGridView from '../components/notes/NoteGridView';
import NoteListView from '../components/notes/NoteListView';
import NoteEditorModal from '../components/notes/NoteEditorModal';
import ConfirmDialog from '../components/notes/ConfirmDialog';
import FolderManager from '../components/notes/FolderManager';
import TagManager from '../components/notes/TagManager';
import TemplateSelector from '../components/notes/TemplateSelector';

export default function Notes() {
  // Hooks
  const filters = useNoteFilters();
  const data = useNotes({ ...filter params... });
  const editor = useNoteEditor({ fetchNotes: data.fetchNotes, activeFolder: filters.activeFolder });
  const dnd = useNoteDnD(data.notes, viewMode);

  // View state
  const [viewMode, setViewMode] = useState(() => ...);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showFolderManager, setShowFolderManager] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);

  // Derived data
  const activeFolderName = useMemo(...);
  const activeTagObj = useMemo(...);
  const paginationNumbers = useMemo(...);

  // Thin wrappers for handlers that need cross-hook context
  const onDelete = (noteId) => { ... };
  const onArchive = (noteId) => { ... };

  return (
    <>
      <NoteEditorModal ... />
      <div className="space-y-0 animate-fadeIn">
        <NoteToolbar ... />
        <div className="flex gap-5">
          <NoteSidebar ... />
          {viewMode === 'grid' ? <NoteGridView ... /> : <NoteListView ... />}
        </div>
      </div>
      <FolderManager ... />
      <TagManager ... />
      <TemplateSelector ... />
      <ConfirmDialog ... />
    </>
  );
}
```

- [ ] **Step 3: Build and verify**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Full regression test**

Test EVERY feature:
- [ ] Search notes
- [ ] Filter: All, Pinned, Archived, Shared
- [ ] Select folder / tag
- [ ] Create blank note
- [ ] Create from template
- [ ] Edit existing note (title + content)
- [ ] Save note (button + Ctrl+S)
- [ ] Close editor (X button + Esc)
- [ ] Unsaved changes guard
- [ ] Delete note (confirm dialog)
- [ ] Archive note
- [ ] Pin note
- [ ] Grid view: drag cards
- [ ] Grid view: resize cards
- [ ] Grid view: snap toggle
- [ ] Grid view: reset layout
- [ ] List view rendering
- [ ] View toggle (grid/list)
- [ ] Pagination (next/prev/number)
- [ ] Folder CRUD (manage modal)
- [ ] Tag CRUD (manage modal)
- [ ] Share note
- [ ] AI Summary
- [ ] Save as template
- [ ] Quick add folder/tag in sidebar
- [ ] Mobile responsive (sidebar toggle)
- [ ] Draft auto-save/restore

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/notes/NoteGridView.jsx frontend/src/components/notes/NoteListView.jsx frontend/src/components/notes/NoteToolbar.jsx frontend/src/components/notes/NoteEditorModal.jsx frontend/src/pages/Notes.jsx
git commit -m "refactor: extract UI components, Notes.jsx is now thin orchestrator"
```

---

## Chunk 3: Cleanup

### Task 7: Cleanup and final verification

**Files:**
- Delete: `frontend/src/pages/Notes.jsx.backup`
- Delete: `frontend/src/services/api.js.backup`
- Delete: `backend/src/routes/note.routes.js.backup`
- Modify: `frontend/src/pages/Notes.jsx` (minor cleanup if needed)

- [ ] **Step 1: Remove backup files**

```bash
find frontend/src -name "*.backup" -delete
find backend/src -name "*.backup" -delete
```

- [ ] **Step 2: Verify build**

```bash
cd frontend && npm run build
```

Expected: Clean build, no warnings (except chunk size for NoteEditor which is known).

- [ ] **Step 3: Verify line count**

```bash
wc -l frontend/src/pages/Notes.jsx
```

Expected: ~150-200 lines (down from 1,407).

```bash
wc -l frontend/src/components/notes/hooks/*.js frontend/src/components/notes/DraggableNoteCard.jsx frontend/src/components/notes/ConfirmDialog.jsx frontend/src/components/notes/NoteGridView.jsx frontend/src/components/notes/NoteListView.jsx frontend/src/components/notes/NoteToolbar.jsx frontend/src/components/notes/NoteEditorModal.jsx
```

Expected: Total should be roughly equal to original 1,407 lines (redistributed).

- [ ] **Step 4: Deploy**

```bash
cd /var/www/html/agenda_work && pm2 reload agenda-frontend && pm2 reload agenda-backend
```

- [ ] **Step 5: Final commit**

```bash
git add -A frontend/src/ backend/src/
git commit -m "chore: cleanup backup files after Notes refactor"
```
