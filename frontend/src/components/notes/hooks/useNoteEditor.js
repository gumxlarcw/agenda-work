import { useState, useEffect, useCallback, useRef } from 'react';
import { notesAPI } from '../../../services/api';
import toast from 'react-hot-toast';

const DRAFT_KEY = 'notes_draft';

function safeParseJson(input) {
  if (!input) return null;
  if (typeof input !== 'string') return input;
  try { return JSON.parse(input); } catch { return null; }
}

export default function useNoteEditor({ fetchNotes, activeFolder }) {
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
  const [editorReadOnly, setEditorReadOnly] = useState(false);
  const [lockInfo, setLockInfo] = useState(null); // { name } of user holding lock
  const [userRole, setUserRole] = useState('owner'); // 'owner' | 'editor' | 'viewer'

  const [confirmDialog, setConfirmDialog] = useState(null);
  const lockIntervalRef = useRef(null);

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

  // Release lock helper
  const releaseLock = useCallback(async (noteId) => {
    if (lockIntervalRef.current) {
      clearInterval(lockIntervalRef.current);
      lockIntervalRef.current = null;
    }
    if (noteId) {
      try { await notesAPI.unlock(noteId); } catch { /* ignore */ }
    }
  }, []);

  // Open existing note
  const openExistingNote = useCallback(async (note) => {
    setShowEditor(true);
    setEditorLoading(true);
    setEditorReadOnly(false);
    setLockInfo(null);
    setUserRole('owner');
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

      // Determine role and locking
      const role = full.user_role || 'owner';
      setUserRole(role);

      if (role === 'viewer') {
        // Viewer — read-only, no lock needed
        setEditorReadOnly(true);
      } else {
        // Owner or editor — try to acquire lock
        try {
          await notesAPI.lock(full.id);
          // Lock acquired — start keep-alive ping every 2 minutes
          lockIntervalRef.current = setInterval(async () => {
            try { await notesAPI.lock(full.id); } catch { /* ignore */ }
          }, 2 * 60 * 1000);
        } catch (err) {
          if (err.response?.status === 409) {
            // Someone else is editing
            const editorName = err.response.data?.editing_by_user?.name || 'Seseorang';
            setLockInfo({ name: editorName });
            setEditorReadOnly(true);
          }
        }
      }
    } catch (error) {
      toast.error('Gagal memuat catatan');
      setShowEditor(false);
    } finally {
      setEditorLoading(false);
    }
  }, []);

  // Callback ref for post-creation hook (e.g. setting position from canvas double-click)
  const onNoteCreatedRef = useRef(null);

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
        await releaseLock(selectedNote.id);
      } else {
        const res = await notesAPI.create(payload);
        const newId = res.data?.data?.id;
        toast.success('Catatan dibuat');
        clearDraft();
        if (onNoteCreatedRef.current && newId) {
          onNoteCreatedRef.current(newId);
        }
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

  // Close with unsaved-changes guard + release lock
  const handleEditorBack = useCallback(() => {
    const doClose = () => {
      if (selectedNote) releaseLock(selectedNote.id);
      setShowEditor(false);
      setIsDirty(false);
      setEditorReadOnly(false);
      setLockInfo(null);
    };

    if (!isDirty) {
      doClose();
      return;
    }
    setConfirmDialog({
      message: 'Perubahan belum disimpan. Keluar tanpa menyimpan?',
      onConfirm: () => {
        doClose();
        if (!selectedNote) clearDraft();
        setConfirmDialog(null);
      },
    });
  }, [isDirty, selectedNote, clearDraft, releaseLock]);

  // Keyboard shortcuts
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

  // Force take over editing lock from another user
  const forceTakeover = useCallback(async () => {
    if (!selectedNote) return;
    try {
      await notesAPI.lock(selectedNote.id, true);
      setEditorReadOnly(false);
      setLockInfo(null);
      toast.success('Editing lock diambil alih');
      // Start keep-alive
      lockIntervalRef.current = setInterval(async () => {
        try { await notesAPI.lock(selectedNote.id); } catch { /* ignore */ }
      }, 2 * 60 * 1000);
    } catch (err) {
      toast.error('Gagal mengambil alih editing');
    }
  }, [selectedNote]);

  // Cleanup lock interval on unmount
  useEffect(() => {
    return () => {
      if (lockIntervalRef.current) clearInterval(lockIntervalRef.current);
    };
  }, []);

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
    editorReadOnly, lockInfo, userRole,
    confirmDialog, setConfirmDialog,
    setIsDirty, setShowEditor,
    openNewNote, openExistingNote,
    handleSave, handleEditorBack, forceTakeover,
    onNoteCreatedRef,
  };
}
