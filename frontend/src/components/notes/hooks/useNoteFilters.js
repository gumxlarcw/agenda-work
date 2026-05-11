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
    setFilter('all');
    setPage(1);
  }, []);

  const handleSelectTag = useCallback((tagId) => {
    setActiveTag(prev => tagId === prev ? null : tagId);
    setActiveFolder(null);
    setFilter('all');
    setPage(1);
  }, []);

  const handleFilterChange = useCallback((f) => {
    setFilter(f);
    setActiveFolder(null);
    setActiveTag(null);
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
  };
}
