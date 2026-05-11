# Notes Redesign — Full Feature Design Spec

**Date:** 2026-03-10
**Status:** Approved
**Project:** Agenda Work (BPS Maluku Utara)

## Overview

Redesign the Notes feature from basic plain-text CRUD into a full-featured note-taking system with rich text editing (TipTap), embedded checklists with auto-sort and task conversion, folders + tags organization, templates, image attachments, note sharing, full-text search, archive, and AI summarization via claude-sonnet-4-6.

## Context

Current state: plain text notes with title, content, category (free text), color (7 options), pin. No search, no checklist, no tags, no archive, no rich text.

Target users: BPS employees using Agenda Work for meeting notes, memos, SOPs, and field visit logs.

## Architecture Decision

**Rich text editor: TipTap** (ProseMirror wrapper)
- Mature ecosystem with extensions for checklist, table, image, highlight
- JSON storage format (content_json) alongside plain text (content) for search
- Bundle ~150KB gzip, acceptable for the app

## Database Schema

### Alter `notes` table

```sql
ALTER TABLE notes
  ADD COLUMN content_json JSON DEFAULT NULL AFTER content,
  ADD COLUMN folder_id INT DEFAULT NULL AFTER category,
  ADD COLUMN is_archived TINYINT(1) DEFAULT 0 AFTER is_pinned,
  ADD COLUMN template_id INT DEFAULT NULL,
  ADD COLUMN linked_task_id INT DEFAULT NULL,
  ADD COLUMN linked_kegiatan_id INT DEFAULT NULL,
  ADD COLUMN shared_with JSON DEFAULT NULL,
  ADD COLUMN ai_summary TEXT DEFAULT NULL,
  ADD FULLTEXT INDEX idx_notes_search (title, content);
```

### New tables

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

## Backend API

### Notes CRUD (revised)

| Method | Endpoint | Description |
|---|---|---|
| GET `/notes` | List notes | Filters: folder_id, tag_id, is_archived, search (FULLTEXT), shared_with_me |
| GET `/notes/:id` | Detail | Include tags, attachments, linked task/kegiatan |
| POST `/notes` | Create | content_json, folder_id, tag_ids[], template_id, linked_task_id, linked_kegiatan_id |
| PUT `/notes/:id` | Update | All fields |
| PATCH `/notes/:id/archive` | Archive/unarchive | Toggle is_archived |
| PATCH `/notes/:id/share` | Share | Set shared_with user IDs (read-only) |
| POST `/notes/:id/summarize` | AI summary | Send to claude-sonnet-4-6, save ai_summary |
| POST `/notes/:id/checklist-to-task` | Convert checklist → Task | Body: { text, priority } |
| PATCH `/notes/:id/checklist-sort` | Auto-sort checked items | Reorder content_json |

### Folders

| Method | Endpoint |
|---|---|
| GET `/notes/folders` | List folders (tree) |
| POST `/notes/folders` | Create (max 2 level enforced) |
| PUT `/notes/folders/:id` | Rename/move |
| DELETE `/notes/folders/:id` | Delete (notes move to root) |

### Tags

| Method | Endpoint |
|---|---|
| GET `/notes/tags` | List with note count |
| POST `/notes/tags` | Create |
| PUT `/notes/tags/:id` | Rename/recolor |
| DELETE `/notes/tags/:id` | Delete (remove from all notes) |

### Templates

| Method | Endpoint |
|---|---|
| GET `/notes/templates` | List system + user templates |
| POST `/notes/templates` | Create user template |
| DELETE `/notes/templates/:id` | Delete user template |

### Attachments

| Method | Endpoint |
|---|---|
| POST `/notes/:id/attachments` | Upload image (multer, max 5MB, jpg/png/webp) |
| DELETE `/notes/attachments/:attachmentId` | Delete attachment |

### Search

`GET /notes?search=keyword` → MySQL FULLTEXT `MATCH(title, content) AGAINST(? IN BOOLEAN MODE)`

## Frontend Architecture

### TipTap Extensions

- StarterKit (bold, italic, heading, lists, blockquote, code block, hr)
- TaskList + TaskItem (checklist toggle)
- Table + TableRow/Cell/Header
- Image (inline from attachments)
- Highlight (color text highlight)
- Placeholder
- CharacterCount

Custom: ChecklistAutoSort, ChecklistToTask context menu

### Page Layout

Sidebar (folders tree + tags) | Main (filter chips + note cards grid/list)

Note editor as modal or inline expand with:
- Top: TipTap toolbar (B, I, H1, H2, bullet, ordered, checklist, hr, quote, table, image)
- Middle: Editor area
- Bottom: Tags, folder, color, link task/kegiatan

### Components

| Component | Purpose |
|---|---|
| NoteEditor.jsx | TipTap editor + toolbar + metadata |
| NoteSidebar.jsx | Folders tree + tags + filters |
| NoteCard.jsx | Card preview |
| FolderManager.jsx | CRUD folder modal |
| TagManager.jsx | CRUD tag modal |
| TemplateSelector.jsx | Template picker on create |
| ShareModal.jsx | User picker for sharing |
| AISummaryPanel.jsx | Trigger + display AI summary |

### Mobile Responsive

- Sidebar collapses to hamburger / bottom sheet
- Note cards single column
- TipTap toolbar wraps to 2 rows
- Editor modal fullscreen on mobile

### NPM Packages

```
@tiptap/react @tiptap/starter-kit @tiptap/extension-task-list
@tiptap/extension-task-item @tiptap/extension-table
@tiptap/extension-image @tiptap/extension-highlight
@tiptap/extension-placeholder @tiptap/extension-character-count
```

## Templates (Pre-built)

| Template | Key Sections |
|---|---|
| Notulen Rapat | Tanggal, peserta, agenda, pembahasan, action items checklist |
| Weekly Report | Pencapaian, kendala, rencana minggu depan checklist |
| Field Visit Log | Lokasi, tanggal, temuan, foto, tindak lanjut checklist |
| SOP Document | Tujuan, ruang lingkup, prosedur, catatan penting |
| Meeting Action Items | Table: No/Item/PIC/Deadline/Status, checklist summary |

Users can "Save as Template" from any note.

## AI Summary

- Model: `claude-sonnet-4-6` via malika-llm-proxy
- System prompt: "Rangkum catatan berikut dalam 3-5 poin utama, bahasa Indonesia, format bullet WhatsApp (*bold*). Jika ada checklist, sebutkan progress (X/Y selesai)."
- Stored in `ai_summary` column, re-generable
- Displayed in collapsible panel below note

## Sharing

- Read-only sharing via `shared_with` JSON array of user IDs
- Shared notes appear in "Shared with me" filter
- Owner can revoke anytime
- No collaborative editing

## Checklist Features

1. **Simple toggle**: Click to check/uncheck (TipTap TaskItem)
2. **Auto-sort**: Checked items move to bottom of checklist group
3. **Convert to Task**: Right-click → "Convert to Task" → creates Task in Agenda Work, links back to note

## Migration & Backward Compatibility

- Existing plain text notes: `content` retained, `content_json` = NULL
- Editor auto-detects: content_json present → TipTap render, NULL → plain text in TipTap
- On save: always write both content_json (TipTap JSON) + content (extracted plain text for FULLTEXT search)
- Existing `category` values migrated to tags automatically
- No data loss — old columns preserved
