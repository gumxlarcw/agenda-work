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
  const [initialLoad, setInitialLoad] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ all: 0, mine: 0, pinned: 0, archived: 0, shared: 0 });

  // Fetch notes
  const fetchNotes = useCallback(async () => {
    try {
      setLoading(true);
      const params = { page, limit: ITEMS_PER_PAGE };
      if (debouncedSearch) params.search = debouncedSearch;
      if (activeFolder) params.folder_id = activeFolder;
      if (activeTag) params.tag_id = activeTag;
      if (filter === 'mine') params.mine = 1;
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
      setInitialLoad(false);
    }
  }, [page, debouncedSearch, activeFolder, activeTag, filter]);

  // Fetch sidebar counts
  const fetchCounts = useCallback(async () => {
    try {
      const res = await notesAPI.getCounts();
      setCounts(res.data.data || { all: 0, pinned: 0, archived: 0, shared: 0 });
    } catch { /* ignore */ }
  }, []);

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

  useEffect(() => { fetchMetadata(); fetchCounts(); }, [fetchMetadata, fetchCounts]);
  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  // Delete note — returns confirm dialog config
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
          fetchCounts();
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
      fetchCounts();
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
      fetchCounts();
      fetchNotes();
    } catch (error) {
      toast.error('Gagal memperbarui catatan');
    }
  }, [notes, fetchNotes]);

  // Share handler
  const handleShareSave = useCallback(async (selectedNote, userIds, roles, setShowShareModal) => {
    if (!selectedNote) return;
    try {
      await notesAPI.share(selectedNote.id, userIds, roles);
      toast.success('Sharing diperbarui');
      setShowShareModal(false);
      fetchNotes();
      fetchCounts();
    } catch (error) {
      toast.error('Gagal memperbarui sharing');
    }
  }, [fetchNotes, fetchCounts]);

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
      // Backend returns attachment object with `filepath` field (e.g. "/uploads/notes/1_123_file.jpg")
      const att = res.data.data;
      return att?.filepath || att?.url || res.data.url;
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
    notes, folders, tags, templates, loading, initialLoad,
    total, totalPages, counts,
    fetchNotes, fetchMetadata, fetchCounts,
    handleDelete, handleArchive, handlePin,
    handleShareSave, handleImageUpload, handleSummarize,
    handleSaveAsTemplate,
    handleFolderCreate, handleFolderUpdate, handleFolderDelete,
    handleTagCreate, handleTagUpdate, handleTagDelete,
    handleTemplateDelete,
  };
}
