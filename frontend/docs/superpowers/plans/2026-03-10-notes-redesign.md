# Notes Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the basic plain-text Notes into a full-featured note-taking system with TipTap rich text, checklist with auto-sort and task conversion, folders + tags, templates, image attachments, sharing, search, archive, and AI summarization.

**Architecture:** TipTap (ProseMirror) editor with JSON storage (`content_json`) alongside plain text (`content`) for FULLTEXT search. MySQL schema extended with 4 new tables (folders, tags, tag_map, templates, attachments). Backend routes expanded from basic CRUD to support folders, tags, templates, attachments, sharing, archive, search, AI summary, and checklist-to-task conversion.

**Tech Stack:** React 18, TipTap 2.x, Tailwind CSS 3, Node.js/Express, MySQL/MariaDB, multer (uploads), malika-llm-proxy (claude-sonnet-4-6 for AI summary)

**Spec:** `docs/superpowers/specs/2026-03-10-notes-redesign-design.md`

---

## File Structure

### Backend (Create)
- `backend/src/routes/note-folder.routes.js` — Folder CRUD endpoints
- `backend/src/routes/note-tag.routes.js` — Tag CRUD endpoints
- `backend/src/routes/note-template.routes.js` — Template CRUD + system seed
- `backend/src/routes/note-attachment.routes.js` — Image upload/delete
- `backend/uploads/notes/` — Image upload directory

### Backend (Modify)
- `backend/src/routes/note.routes.js` — Extend with search, archive, share, AI summary, checklist-to-task, content_json, folder_id, tags
- `backend/src/server.js` — Register new routes, static file serving for uploads

### Frontend (Create)
- `frontend/src/components/notes/NoteEditor.jsx` — TipTap editor + toolbar
- `frontend/src/components/notes/NoteSidebar.jsx` — Folders tree + tags + filters
- `frontend/src/components/notes/NoteCard.jsx` — Card preview component
- `frontend/src/components/notes/FolderManager.jsx` — Folder CRUD modal
- `frontend/src/components/notes/TagManager.jsx` — Tag CRUD modal
- `frontend/src/components/notes/TemplateSelector.jsx` — Template picker
- `frontend/src/components/notes/ShareModal.jsx` — User picker for sharing
- `frontend/src/components/notes/AISummaryPanel.jsx` — AI summary trigger + display

### Frontend (Modify)
- `frontend/src/pages/Notes.jsx` — Full redesign: sidebar layout, TipTap integration, all new features
- `frontend/src/services/api.js` — Add folder, tag, template, attachment API methods
- `frontend/package.json` — Add TipTap dependencies

---

## Chunk 1: Database & Backend Foundation

### Task 1: Database Migration

**Files:**
- Execute SQL on: `agenda_work_db`

- [ ] **Step 1: Backup existing notes table**

```bash
cd /var/www/html/agenda_work/backend
mysqldump -u root agenda_work_db notes > /tmp/notes_backup_$(date +%Y%m%d).sql
```

- [ ] **Step 2: Alter notes table — add new columns**

```sql
ALTER TABLE notes
  ADD COLUMN content_json JSON DEFAULT NULL AFTER content,
  ADD COLUMN folder_id INT DEFAULT NULL AFTER category,
  ADD COLUMN is_archived TINYINT(1) DEFAULT 0 AFTER is_pinned,
  ADD COLUMN template_id INT DEFAULT NULL,
  ADD COLUMN linked_task_id INT DEFAULT NULL,
  ADD COLUMN linked_kegiatan_id INT DEFAULT NULL,
  ADD COLUMN shared_with JSON DEFAULT NULL,
  ADD COLUMN ai_summary TEXT DEFAULT NULL;
```

- [ ] **Step 3: Add FULLTEXT index**

```sql
ALTER TABLE notes ADD FULLTEXT INDEX idx_notes_search (title, content);
```

- [ ] **Step 4: Create note_folders table**

```sql
CREATE TABLE note_folders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  parent_id INT DEFAULT NULL,
  color VARCHAR(20) DEFAULT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (parent_id) REFERENCES note_folders(id) ON DELETE CASCADE
);
```

- [ ] **Step 5: Create note_tags and note_tag_map tables**

```sql
CREATE TABLE note_tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(50) NOT NULL,
  color VARCHAR(20) DEFAULT '#6b7280',
  UNIQUE KEY unique_user_tag (user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE note_tag_map (
  note_id INT NOT NULL,
  tag_id INT NOT NULL,
  PRIMARY KEY (note_id, tag_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES note_tags(id) ON DELETE CASCADE
);
```

- [ ] **Step 6: Create note_templates table**

```sql
CREATE TABLE note_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  content_json JSON NOT NULL,
  category VARCHAR(50) DEFAULT NULL,
  is_system TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 7: Create note_attachments table**

```sql
CREATE TABLE note_attachments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  note_id INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  filepath VARCHAR(500) NOT NULL,
  mimetype VARCHAR(100) NOT NULL,
  size_bytes INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);
```

- [ ] **Step 8: Migrate existing categories to tags**

```sql
-- Create tags from existing unique categories
INSERT IGNORE INTO note_tags (user_id, name)
SELECT DISTINCT user_id, category FROM notes
WHERE category IS NOT NULL AND category != '';

-- Map notes to their category tags
INSERT IGNORE INTO note_tag_map (note_id, tag_id)
SELECT n.id, t.id FROM notes n
JOIN note_tags t ON n.user_id = t.user_id AND n.category = t.name
WHERE n.category IS NOT NULL AND n.category != '';
```

- [ ] **Step 9: Verify all tables**

```bash
mysql -u root agenda_work_db -e "DESCRIBE notes;"
mysql -u root agenda_work_db -e "DESCRIBE note_folders;"
mysql -u root agenda_work_db -e "DESCRIBE note_tags;"
mysql -u root agenda_work_db -e "DESCRIBE note_tag_map;"
mysql -u root agenda_work_db -e "DESCRIBE note_templates;"
mysql -u root agenda_work_db -e "DESCRIBE note_attachments;"
```

- [ ] **Step 10: Seed system templates**

Insert 5 system templates with TipTap JSON content for: Notulen Rapat, Weekly Report, Field Visit Log, SOP Document, Meeting Action Items.

- [ ] **Step 11: Create uploads directory**

```bash
mkdir -p /var/www/html/agenda_work/backend/uploads/notes
```

---

### Task 2: Backend — Folder Routes

**Files:**
- Create: `backend/src/routes/note-folder.routes.js`
- Modify: `backend/src/server.js` (register route)

- [ ] **Step 1: Create note-folder.routes.js**

Endpoints:
- `GET /` — List user's folders as flat list (frontend builds tree)
- `POST /` — Create folder (enforce max 2 levels: if parent_id has a parent, reject)
- `PUT /:id` — Update name, color, parent_id, sort_order
- `DELETE /:id` — Delete folder (set notes.folder_id = NULL for affected notes)

All routes use `verifyToken`. Non-admin users only see/edit own folders.

- [ ] **Step 2: Register in server.js**

```js
const noteFolderRoutes = require('./routes/note-folder.routes');
app.use('/api/notes/folders', noteFolderRoutes);
```

Place BEFORE `app.use('/api/notes', noteRoutes)` to avoid `/:id` catch.

- [ ] **Step 3: Test endpoints**

```bash
# Create folder
curl -X POST http://localhost:5100/api/notes/folders -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"Rapat","color":"#3b82f6"}'

# Create subfolder
curl -X POST http://localhost:5100/api/notes/folders -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"Tim A","parent_id":1}'

# List
curl http://localhost:5100/api/notes/folders -H "Authorization: Bearer $TOKEN"
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/note-folder.routes.js backend/src/server.js
git commit -m "feat(notes): add folder CRUD routes"
```

---

### Task 3: Backend — Tag Routes

**Files:**
- Create: `backend/src/routes/note-tag.routes.js`
- Modify: `backend/src/server.js`

- [ ] **Step 1: Create note-tag.routes.js**

Endpoints:
- `GET /` — List user's tags with note count (`LEFT JOIN note_tag_map GROUP BY tag_id`)
- `POST /` — Create tag (name, color). Enforce unique per user.
- `PUT /:id` — Update name, color
- `DELETE /:id` — Delete tag (CASCADE removes from note_tag_map)

- [ ] **Step 2: Register in server.js**

```js
const noteTagRoutes = require('./routes/note-tag.routes');
app.use('/api/notes/tags', noteTagRoutes);
```

Place BEFORE `app.use('/api/notes', noteRoutes)`.

- [ ] **Step 3: Test and commit**

---

### Task 4: Backend — Template Routes

**Files:**
- Create: `backend/src/routes/note-template.routes.js`
- Modify: `backend/src/server.js`

- [ ] **Step 1: Create note-template.routes.js**

Endpoints:
- `GET /` — List system templates (is_system=1) + user's own templates
- `POST /` — Create user template from content_json
- `DELETE /:id` — Delete own template (cannot delete system templates)

- [ ] **Step 2: Register in server.js**

```js
const noteTemplateRoutes = require('./routes/note-template.routes');
app.use('/api/notes/templates', noteTemplateRoutes);
```

- [ ] **Step 3: Test and commit**

---

### Task 5: Backend — Attachment Routes

**Files:**
- Create: `backend/src/routes/note-attachment.routes.js`
- Modify: `backend/src/server.js` (register route + static serving)

- [ ] **Step 1: Install multer if not present**

```bash
cd /var/www/html/agenda_work/backend && npm ls multer 2>/dev/null || npm install multer
```

- [ ] **Step 2: Create note-attachment.routes.js**

Endpoints:
- `POST /:noteId/attachments` — Upload image (multer, max 5MB, jpg/png/webp/gif). Save to `uploads/notes/{noteId}_{timestamp}_{filename}`. Verify note ownership.
- `DELETE /attachments/:attachmentId` — Delete attachment + file from disk. Verify note ownership.

Multer config:
```js
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads/notes'),
  filename: (req, file, cb) => {
    const unique = `${req.params.noteId}_${Date.now()}_${file.originalname}`;
    cb(null, unique);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    cb(null, allowed.includes(file.mimetype));
  }
});
```

- [ ] **Step 3: Add static file serving in server.js**

```js
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
```

- [ ] **Step 4: Register route in server.js**

```js
const noteAttachmentRoutes = require('./routes/note-attachment.routes');
app.use('/api/notes', noteAttachmentRoutes);
```

- [ ] **Step 5: Test upload and commit**

---

### Task 6: Backend — Extend note.routes.js

**Files:**
- Modify: `backend/src/routes/note.routes.js`

- [ ] **Step 1: Backup**

```bash
cp backend/src/routes/note.routes.js backend/src/routes/note.routes.js.backup
```

- [ ] **Step 2: Extend GET / with new filters**

Add support for query params:
- `search` — FULLTEXT search: `MATCH(n.title, n.content) AGAINST(? IN BOOLEAN MODE)`
- `folder_id` — filter by folder
- `tag_id` — filter via JOIN note_tag_map
- `is_archived` — filter archived (default: show non-archived)
- `shared_with_me` — show notes where `JSON_CONTAINS(shared_with, ?)` for current user

- [ ] **Step 3: Extend GET /:id to include tags and attachments**

```sql
-- After fetching note, also fetch:
SELECT t.* FROM note_tags t JOIN note_tag_map m ON t.id = m.tag_id WHERE m.note_id = ?
SELECT * FROM note_attachments WHERE note_id = ?
```

Return as `note.tags` and `note.attachments`.

- [ ] **Step 4: Extend POST / and PUT /:id**

Add fields: `content_json`, `folder_id`, `linked_task_id`, `linked_kegiatan_id`, `tag_ids` (array).

On create/update with `content_json`:
- Store `content_json` as-is
- Extract plain text from JSON for `content` column (for FULLTEXT search)
- Handle `tag_ids`: delete old mappings, insert new ones

Plain text extraction helper:
```js
function extractPlainText(json) {
  if (!json) return '';
  const walk = (node) => {
    if (node.text) return node.text;
    if (node.content) return node.content.map(walk).join('\n');
    return '';
  };
  return walk(json).trim();
}
```

- [ ] **Step 5: Add PATCH /:id/archive**

Toggle `is_archived` between 0 and 1.

- [ ] **Step 6: Add PATCH /:id/share**

Body: `{ user_ids: [4, 5] }`. Update `shared_with` JSON column. Verify note ownership.

- [ ] **Step 7: Add POST /:id/summarize (AI Summary)**

```js
router.post('/:id/summarize', verifyToken, async (req, res) => {
  // 1. Fetch note, verify ownership
  // 2. Extract plain text from content_json or content
  // 3. Call malika-llm-proxy:
  //    POST http://localhost:3031/v1/chat/completions
  //    model: "claude-sonnet-4-6"
  //    system: "Rangkum catatan berikut dalam 3-5 poin utama, bahasa Indonesia, format bullet. Jika ada checklist, sebutkan progress (X/Y selesai)."
  //    user: plain text content
  // 4. Save ai_summary to DB
  // 5. Return summary
});
```

- [ ] **Step 8: Add POST /:id/checklist-to-task**

```js
router.post('/:id/checklist-to-task', verifyToken, async (req, res) => {
  // Body: { text, priority, end_date }
  // 1. Verify note ownership
  // 2. Create task: INSERT INTO tasks (user_id, task, priority, status, end_date)
  // 3. Update note: linked_task_id = new task id (or add to array)
  // 4. Return new task
});
```

- [ ] **Step 9: Test all new endpoints**

- [ ] **Step 10: Commit**

```bash
git add backend/src/routes/note.routes.js
git commit -m "feat(notes): extend routes with search, archive, share, AI summary, checklist-to-task"
```

---

## Chunk 2: Frontend — TipTap & Components

### Task 7: Install TipTap Dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install TipTap packages**

```bash
cd /var/www/html/agenda_work/frontend
npm install @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-task-list @tiptap/extension-task-item @tiptap/extension-table @tiptap/extension-table-row @tiptap/extension-table-cell @tiptap/extension-table-header @tiptap/extension-image @tiptap/extension-highlight @tiptap/extension-placeholder @tiptap/extension-character-count
```

- [ ] **Step 2: Verify build still works**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add TipTap editor dependencies"
```

---

### Task 8: Frontend — NoteEditor Component

**Files:**
- Create: `frontend/src/components/notes/NoteEditor.jsx`

- [ ] **Step 1: Create NoteEditor.jsx**

Component that wraps TipTap with:
- **Toolbar**: Bold, Italic, Heading (1-3), Bullet list, Ordered list, Checklist (TaskList), Blockquote, Code block, Table (insert 3x3), Image (from URL/attachment), Highlight, Horizontal rule, Undo/Redo
- **Editor area**: TipTap `EditorContent` with placeholder "Tulis catatan..."
- **Props**: `content` (JSON or null), `onChange(json, plainText)`, `onImageUpload(file)`, `editable` (default true)
- **Checklist auto-sort**: Custom extension or transaction that moves checked TaskItems to bottom of their list
- **Styling**: Tailwind prose classes for rendered content, toolbar as flex wrap with icon buttons

Toolbar button pattern:
```jsx
<button
  onClick={() => editor.chain().focus().toggleBold().run()}
  className={`p-1.5 rounded ${editor.isActive('bold') ? 'bg-gray-200' : 'hover:bg-gray-100'}`}
>
  <BoldIcon className="w-4 h-4" />
</button>
```

- [ ] **Step 2: Add TipTap editor styles to global CSS**

Add to `frontend/src/index.css` (or equivalent):
```css
.tiptap-editor .ProseMirror { min-height: 200px; outline: none; }
.tiptap-editor .ProseMirror ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5rem; }
.tiptap-editor .ProseMirror ul[data-type="taskList"] li[data-checked="true"] p { text-decoration: line-through; opacity: 0.5; }
.tiptap-editor .ProseMirror table { border-collapse: collapse; width: 100%; }
.tiptap-editor .ProseMirror td, .tiptap-editor .ProseMirror th { border: 1px solid #d1d5db; padding: 0.5rem; }
```

- [ ] **Step 3: Build and verify renders**

- [ ] **Step 4: Commit**

---

### Task 9: Frontend — NoteSidebar Component

**Files:**
- Create: `frontend/src/components/notes/NoteSidebar.jsx`

- [ ] **Step 1: Create NoteSidebar.jsx**

Props: `folders`, `tags`, `activeFolder`, `activeTag`, `filter`, `onSelectFolder(id)`, `onSelectTag(id)`, `onFilterChange(filter)`, `onManageFolders()`, `onManageTags()`

Sections:
1. **Filters**: All | Pinned | Archived | Shared with me (pill buttons)
2. **Folders**: Tree view (parent → children indented), click to filter, "Manage" button
3. **Tags**: Flat list with colored dot + note count, click to filter, "Manage" button

Mobile: render as slide-out panel / bottom sheet.

- [ ] **Step 2: Commit**

---

### Task 10: Frontend — NoteCard Component

**Files:**
- Create: `frontend/src/components/notes/NoteCard.jsx`

- [ ] **Step 1: Create NoteCard.jsx**

Props: `note`, `onClick`, `onPin`, `onArchive`, `onDelete`

Displays:
- Color background from `note.color`
- Pin star icon
- Title (bold)
- Content preview: first 2 lines of plain text (from `content`)
- Tags as colored chips
- Linked badge: `🔗 Task #X` or `🔗 Kegiatan #X`
- Shared badge: `👥 Shared (N)`
- Date: `updated_at` formatted
- Archive/delete on hover actions
- Checklist progress if has TaskList: "3/5 items" mini progress bar

- [ ] **Step 2: Commit**

---

### Task 11: Frontend — FolderManager, TagManager, TemplateSelector, ShareModal, AISummaryPanel

**Files:**
- Create: `frontend/src/components/notes/FolderManager.jsx`
- Create: `frontend/src/components/notes/TagManager.jsx`
- Create: `frontend/src/components/notes/TemplateSelector.jsx`
- Create: `frontend/src/components/notes/ShareModal.jsx`
- Create: `frontend/src/components/notes/AISummaryPanel.jsx`

- [ ] **Step 1: Create FolderManager.jsx**

Modal with:
- List of folders (tree structure, drag to reorder optional)
- Add folder form (name, color, parent dropdown)
- Edit inline (click to rename)
- Delete with confirmation
- Max 2 level enforcement in dropdown (hide children as parent options)

- [ ] **Step 2: Create TagManager.jsx**

Modal with:
- List of tags with colored dot + note count
- Add tag form (name, color picker)
- Edit inline
- Delete with confirmation

- [ ] **Step 3: Create TemplateSelector.jsx**

Modal/dropdown:
- Grid of template cards (name, description, preview icon)
- System templates labeled with badge
- User templates with delete option
- On select: calls `onSelect(template.content_json)`

- [ ] **Step 4: Create ShareModal.jsx**

Modal:
- Search/select users from list (fetched from `/api/users`)
- Currently shared users shown with remove button
- Save → PATCH `/notes/:id/share` with user_ids array

- [ ] **Step 5: Create AISummaryPanel.jsx**

Collapsible panel below editor:
- "✨ Generate AI Summary" button
- Loading state while waiting for LLM
- Display summary in formatted text
- "Regenerate" button to re-run

- [ ] **Step 6: Commit all components**

---

## Chunk 3: Frontend — Page Redesign & Integration

### Task 12: Frontend — Extend API Service

**Files:**
- Modify: `frontend/src/services/api.js`

- [ ] **Step 1: Add new API methods**

```js
export const notesAPI = {
  // existing...
  getAll: (params) => api.get('/notes', { params }),
  getOne: (id) => api.get(`/notes/${id}`),
  create: (data) => api.post('/notes', data),
  update: (id, data) => api.put(`/notes/${id}`, data),
  delete: (id) => api.delete(`/notes/${id}`),
  // new
  archive: (id) => api.patch(`/notes/${id}/archive`),
  share: (id, userIds) => api.patch(`/notes/${id}/share`, { user_ids: userIds }),
  summarize: (id) => api.post(`/notes/${id}/summarize`),
  checklistToTask: (id, data) => api.post(`/notes/${id}/checklist-to-task`, data),
  checklistSort: (id) => api.patch(`/notes/${id}/checklist-sort`),
  uploadAttachment: (id, formData) => api.post(`/notes/${id}/attachments`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  deleteAttachment: (attachId) => api.delete(`/notes/attachments/${attachId}`),
};

export const noteFoldersAPI = {
  getAll: () => api.get('/notes/folders'),
  create: (data) => api.post('/notes/folders', data),
  update: (id, data) => api.put(`/notes/folders/${id}`, data),
  delete: (id) => api.delete(`/notes/folders/${id}`),
};

export const noteTagsAPI = {
  getAll: () => api.get('/notes/tags'),
  create: (data) => api.post('/notes/tags', data),
  update: (id, data) => api.put(`/notes/tags/${id}`, data),
  delete: (id) => api.delete(`/notes/tags/${id}`),
};

export const noteTemplatesAPI = {
  getAll: () => api.get('/notes/templates'),
  create: (data) => api.post('/notes/templates', data),
  delete: (id) => api.delete(`/notes/templates/${id}`),
};
```

- [ ] **Step 2: Commit**

---

### Task 13: Frontend — Notes.jsx Full Redesign

**Files:**
- Modify: `frontend/src/pages/Notes.jsx`

- [ ] **Step 1: Backup**

```bash
cp frontend/src/pages/Notes.jsx frontend/src/pages/Notes.jsx.backup
```

- [ ] **Step 2: Rewrite Notes.jsx**

Layout structure:
```
┌──────────────────────────────────────────┐
│ Header: "Notes"  [Search]  [+ New Note ▾]│
│                            (dropdown:     │
│                             Blank / From  │
│                             Template)     │
├──────────┬───────────────────────────────┤
│ Sidebar  │ Note cards (grid or list)     │
│ (mobile: │                               │
│  toggle) │ Click card → open editor      │
├──────────┴───────────────────────────────┤
│ Editor modal (fullscreen on mobile)      │
│ Title input                              │
│ TipTap toolbar                           │
│ TipTap editor                            │
│ Footer: folder | tags | color | link |   │
│         share | AI summary               │
└──────────────────────────────────────────┘
```

State:
- `notes[]` — all fetched notes (client-side filter)
- `folders[]`, `tags[]` — fetched once
- `activeFolder`, `activeTag`, `filter` (all/pinned/archived/shared)
- `searchQuery` — debounced, sent to API for FULLTEXT
- `selectedNote` — currently editing note (null = list view)
- `showTemplateSelector`, `showFolderManager`, `showTagManager`, `showShareModal`

Data flow:
1. On mount: fetch notes (no search), folders, tags in parallel
2. Filter/folder/tag changes → client-side filter (like Reminders pattern)
3. Search → API call with `?search=` (FULLTEXT needs server)
4. Create: show template selector first, then open editor with template content or blank
5. Save: debounced auto-save (800ms) or explicit save button — POST/PUT with content_json + extracted plain text + tag_ids + folder_id
6. Delete/archive: optimistic UI update

- [ ] **Step 3: Wire NoteEditor with image upload**

On image insert in TipTap:
1. Open file picker
2. Upload via `notesAPI.uploadAttachment(noteId, formData)`
3. Get back filepath URL
4. Insert image node with `src` = `/uploads/notes/filename`

- [ ] **Step 4: Wire checklist-to-task**

Add context menu / button on TaskItem nodes:
1. Get text of checked/selected TaskItem
2. Show dialog: prefill title, pick priority + deadline
3. Call `notesAPI.checklistToTask(noteId, { text, priority, end_date })`
4. Update TaskItem text to show `✓ Task #XX: text`

- [ ] **Step 5: Build and test full flow**

```bash
npm run build
pm2 reload pds-frontend --update-env
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Notes.jsx frontend/src/components/notes/ frontend/src/services/api.js
git commit -m "feat(notes): full redesign with TipTap, folders, tags, templates, sharing, AI summary"
```

---

### Task 14: Backend Reload & End-to-End Test

- [ ] **Step 1: Reload backend**

```bash
cd /var/www/html/agenda_work/backend
pm2 reload agenda-backend --update-env
```

- [ ] **Step 2: Test full flow**

1. Create folder "Rapat" → subfolder "Tim A"
2. Create tags: "urgent" (red), "sensus" (blue)
3. Create note from "Notulen Rapat" template in folder "Rapat/Tim A"
4. Edit with TipTap: add heading, bullet list, checklist items, table
5. Add tags "urgent" + "sensus"
6. Upload image attachment
7. Check/uncheck checklist items → verify auto-sort
8. Convert checklist item to Task → verify task created
9. Link note to existing kegiatan
10. Share with another user → verify read-only
11. Generate AI summary → verify claude-sonnet-4-6 output
12. Archive note → verify hidden from default view, visible in "Archived"
13. Search → verify FULLTEXT matches
14. Mobile responsive → verify sidebar collapse, fullscreen editor

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(notes): complete notes redesign - TipTap, folders, tags, templates, attachments, sharing, AI summary, checklist-to-task"
```
