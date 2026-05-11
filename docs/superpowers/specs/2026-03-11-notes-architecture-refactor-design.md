# Notes Architecture Refactor — Design Spec

**Goal:** Refactor `Notes.jsx` (1,407 lines, 30+ useState, 20+ handlers) into custom hooks + extracted UI components via incremental steps. Zero behavior changes.

**Approach:** Custom Hooks + Component Split (incremental, one hook/component per task)

## File Structure (Final State)

```
frontend/src/components/notes/
  hooks/
    useNoteFilters.js    — search debounce, folder/tag/filter selection
    useNoteDnD.js        — positions, widths, drag handlers, snap, reset
    useNoteEditor.js     — editor state, open/close, save, dirty tracking, draft autosave
    useNotes.js          — CRUD, fetch, pagination, data state
  NoteEditorModal.jsx    — editor modal UI (title, toolbar, footer, color, tags, folder)
  NoteGridView.jsx       — DndContext canvas + DraggableNoteCard
  NoteListView.jsx       — simple stacked cards for list mode
  NoteToolbar.jsx        — top bar (search, view toggle, snap/reset, create button)
  ConfirmDialog.jsx      — reusable confirm modal
  # Existing (unchanged):
  NoteEditor.jsx         — TipTap editor wrapper
  NoteCard.jsx           — card presentation
  NoteSidebar.jsx        — sidebar filters/folders/tags
  FolderManager.jsx      — folder CRUD modal
  TagManager.jsx         — tag CRUD modal
  TemplateSelector.jsx   — template picker
  ShareModal.jsx         — user sharing modal
  AISummaryPanel.jsx     — AI summary panel
```

## Incremental Tasks

### Task 1: Extract `useNoteFilters`
**State:** `searchQuery`, `debouncedSearch`, `activeFolder`, `activeTag`, `filter`
**Logic:** debounce useEffect, filter/folder/tag change handlers, `resetFilters`
**Interface:**
```js
{ searchQuery, setSearchQuery, debouncedSearch,
  activeFolder, setActiveFolder, activeTag, setActiveTag,
  filter, setFilter, resetFilters }
```
**Impact:** ~40 lines removed from Notes.jsx

### Task 2: Extract `useNoteDnD`
**State:** `activeId`, `notePositions`, `cardWidths`, `snapEnabled`
**Logic:** sensors, modifiers, `handleDragStart`, `handleDragEnd`, `handleCardResize`, `handleResetLayout`, position sync useEffect, canvasHeight memo
**Interface:**
```js
// useNoteDnD(notes)
{ activeId, notePositions, cardWidths, snapEnabled, setSnapEnabled,
  sensors, modifiers, canvasHeight, activeNote,
  handleDragStart, handleDragEnd, handleCardResize, handleResetLayout }
```
**Impact:** ~80 lines removed from Notes.jsx

### Task 3: Extract `useNoteEditor`
**State:** all `editor*` state, `selectedNote`, `isDirty`, `saving`, `showEditor`, `editorLoading`, `confirmDialog`
**Logic:** draft autosave (localStorage), `openNewNote`, `openExistingNote`, `handleSave`, `handleEditorBack`, keyboard shortcuts (Esc/Ctrl+S), `clearDraft`
**Interface:**
```js
// useNoteEditor({ fetchNotes, activeFolder })
{ selectedNote, editorTitle, setEditorTitle, editorContent,
  editorPlainText, editorFolder, setEditorFolder, editorTags, setEditorTags,
  editorColor, setEditorColor, editorPinned, setEditorPinned,
  showEditor, editorLoading, saving, isDirty, confirmDialog, setConfirmDialog,
  openNewNote, openExistingNote, handleSave, handleEditorBack,
  setEditorContent, setEditorPlainText, setIsDirty }
```
**Impact:** ~200 lines removed from Notes.jsx

### Task 4: Extract `useNotes`
**State:** `notes`, `folders`, `tags`, `templates`, `loading`, `page`, `totalPages`, `total`
**Logic:** `fetchNotes`, `fetchMetadata`, `handleDelete`, `handleArchive`, `handlePin`, `handleShareSave`, `handleImageUpload`
**Interface:**
```js
// useNotes({ debouncedSearch, activeFolder, activeTag, filter })
{ notes, folders, tags, templates, loading, total, totalPages,
  page, setPage, fetchNotes, fetchMetadata,
  handleDelete, handleArchive, handlePin, handleShareSave, handleImageUpload }
```
**Impact:** ~150 lines removed from Notes.jsx

### Task 5: Extract UI Components
- **`NoteToolbar`** — search field, view toggle, snap/reset buttons, create dropdown
- **`NoteGridView`** — DndContext wrapper, canvas, DraggableNoteCard map, DragOverlay
- **`NoteListView`** — simple mapped NoteCard list with pagination
- **`NoteEditorModal`** — full editor modal overlay (header, TipTap editor, footer with folder/tag/color/share/AI)
- **`ConfirmDialog`** — generic confirm modal (message, confirm/cancel buttons, colors)
- **`DraggableNoteCard`** — already exists inline, move to own file

**Impact:** Notes.jsx becomes ~150-200 line orchestrator

### Task 6: Cleanup
- Remove all `.backup` files from `components/notes/` and `pages/`
- Verify build passes (`npm run build`)
- Verify all features work (CRUD, search, DnD, editor, folders, tags, share, AI summary)

## Rules
- Pure refactor — zero behavior changes, zero new features
- Each task: extract → build → manual test → next
- Hooks return plain state + handlers, no JSX
- Notes.jsx remains the single entry point / orchestrator
- Follow existing code style (no TypeScript, Tailwind classes, react-icons/hi)

## Dependencies
- No new packages needed
- Existing: react, @dnd-kit/core, @dnd-kit/modifiers, react-hot-toast, dayjs
