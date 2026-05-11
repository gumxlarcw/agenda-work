import { useState, useEffect, useRef } from 'react';
import {
  HiOutlineFolder,
  HiOutlineFolderOpen,
  HiOutlineTag,
  HiOutlineStar,
  HiOutlineArchive,
  HiOutlineUsers,
  HiOutlineCollection,
  HiOutlineUser,
  HiOutlineCog,
  HiOutlineX,
  HiOutlinePlus,
  HiOutlineCheck,
  HiOutlineDotsVertical,
  HiOutlineLink,
  HiOutlineSearch,
} from 'react-icons/hi';

const FILTERS = [
  { key: 'all', label: 'Semua', icon: HiOutlineCollection },
  { key: 'mine', label: 'My Notes', icon: HiOutlineUser },
  { key: 'pinned', label: 'Pinned', icon: HiOutlineStar },
  { key: 'archived', label: 'Arsip', icon: HiOutlineArchive },
  { key: 'shared', label: 'Shared', icon: HiOutlineUsers },
];

export default function NoteSidebar({
  folders = [],
  tags = [],
  counts = {},
  activeFolder,
  activeTag,
  filter,
  onSelectFolder,
  onSelectTag,
  onFilterChange,
  onManageFolders,
  onManageTags,
  onQuickAddFolder,
  onQuickAddTag,
  onPublicLink,
  onShareFolder,
  sharedFolders = [],
  onSelectSharedFolder,
  activeSharedFolder,
  show,
  onClose,
  searchQuery = '',
  onSearchChange,
}) {
  const [addingFolder, setAddingFolder] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [folderMenuId, setFolderMenuId] = useState(null);
  const folderMenuRef = useRef(null);

  // Close folder 3-dot menu on outside click
  useEffect(() => {
    if (!folderMenuId) return;
    const handler = (e) => {
      if (folderMenuRef.current && !folderMenuRef.current.contains(e.target)) setFolderMenuId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [folderMenuId]);

  const submitFolder = async () => {
    if (!newFolderName.trim() || !onQuickAddFolder) return;
    try {
      await onQuickAddFolder({ name: newFolderName.trim() });
      setNewFolderName('');
      setAddingFolder(false);
    } catch { /* parent shows toast */ }
  };

  const submitTag = async () => {
    if (!newTagName.trim() || !onQuickAddTag) return;
    try {
      await onQuickAddTag({ name: newTagName.trim(), color: '#6b7280' });
      setNewTagName('');
      setAddingTag(false);
    } catch { /* parent shows toast */ }
  };

  // Build folder tree
  const rootFolders = folders.filter(f => !f.parent_id);
  const getChildren = (parentId) => folders.filter(f => f.parent_id === parentId);

  const sidebarContent = (
    <div className="space-y-5">
      {/* Search */}
      {onSearchChange && (
        <div className="relative">
          <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Cari catatan..."
            className="w-full px-4 py-2 pl-9 pr-8 text-sm bg-white/10 border border-white/15 rounded-xl outline-none text-white placeholder-white/30 focus:bg-white/15 focus:border-white/30 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-white/15 rounded"
              aria-label="Hapus pencarian"
            >
              <HiOutlineX className="w-3.5 h-3.5 text-white/40" />
            </button>
          )}
        </div>
      )}

      {/* Filters */}
      <div>
        <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.15em] px-3 mb-2">Filter</h3>
        <div className="space-y-0.5">
          {FILTERS.map(({ key, label, icon: Icon }) => {
            const isActive = filter === key && !activeFolder && !activeTag && !activeSharedFolder;
            const count = counts[key];
            return (
              <button
                key={key}
                onClick={() => onFilterChange(key)}
                className={`sidebar-nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-200 relative ${
                  isActive
                    ? 'sidebar-nav-active text-white font-medium shadow-sm'
                    : 'text-indigo-100/60 hover:bg-white/10 hover:text-white'
                }`}
              >
                {isActive && (
                  <span className="sidebar-active-indicator absolute left-0 w-[3px] h-4 bg-white rounded-r-full" />
                )}
                <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'scale-110' : ''} transition-transform`} />
                <span className="flex-1 text-left">{label}</span>
                {count > 0 && (
                  <span className={`text-[10px] font-medium min-w-[20px] text-center px-1.5 py-0.5 rounded-full ${
                    isActive ? 'bg-white/20 text-white' : 'bg-white/10 text-white/40'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Folders */}
      <div>
        <div className="flex items-center justify-between px-3 mb-2">
          <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.15em]">Folder</h3>
          <div className="flex items-center gap-0.5">
            <button onClick={() => setAddingFolder(true)} className="p-1 hover:bg-white/10 rounded-lg transition-colors" title="Tambah Folder" aria-label="Tambah folder">
              <HiOutlinePlus className="w-3.5 h-3.5 text-white/40" />
            </button>
            <button onClick={onManageFolders} className="p-1 hover:bg-white/10 rounded-lg transition-colors" title="Kelola Folder" aria-label="Kelola folder">
              <HiOutlineCog className="w-3.5 h-3.5 text-white/40" />
            </button>
          </div>
        </div>
        {addingFolder && (
          <div className="flex items-center gap-1 mb-1.5 px-2">
            <input
              autoFocus
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitFolder(); if (e.key === 'Escape') setAddingFolder(false); }}
              placeholder="Nama folder..."
              className="flex-1 text-sm px-2 py-1 bg-white/10 border border-white/20 rounded-lg outline-none text-white placeholder-white/30 focus:bg-white/15 focus:border-white/30"
            />
            <button onClick={submitFolder} className="p-1 hover:bg-white/15 rounded-lg text-emerald-300" aria-label="Konfirmasi tambah folder">
              <HiOutlineCheck className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setAddingFolder(false)} className="p-1 hover:bg-white/10 rounded-lg text-white/40" aria-label="Batal tambah folder">
              <HiOutlineX className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className="space-y-0.5">
          {rootFolders.map((folder) => {
            const children = getChildren(folder.id);
            const isActive = activeFolder === folder.id && !activeSharedFolder;

            return (
              <div key={folder.id} className="group relative">
                <button
                  onClick={() => onSelectFolder(isActive ? null : folder.id)}
                  className={`sidebar-nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-200 relative ${
                    isActive
                      ? 'sidebar-nav-active text-white font-medium'
                      : 'text-indigo-100/60 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {isActive && <span className="sidebar-active-indicator absolute left-0 w-[3px] h-4 bg-white rounded-r-full" />}
                  {isActive ? (
                    <HiOutlineFolderOpen className="w-4 h-4 flex-shrink-0" style={{ color: folder.color || undefined }} />
                  ) : (
                    <HiOutlineFolder className="w-4 h-4 flex-shrink-0" style={{ color: folder.color || undefined }} />
                  )}
                  <div className="flex-1 min-w-0 text-left">
                    <span className="block truncate">{folder.name}</span>
                    {folder.folder_progress != null && folder.total_items > 0 && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              folder.folder_progress >= 100 ? 'bg-green-400' : folder.folder_progress >= 50 ? 'bg-blue-400' : 'bg-amber-400'
                            }`}
                            style={{ width: `${Math.min(100, folder.folder_progress)}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-white/40 whitespace-nowrap">{Math.round(folder.folder_progress)}%</span>
                      </div>
                    )}
                  </div>
                  {folder.note_count > 0 && (
                    <span className={`text-[10px] font-medium min-w-[20px] text-center px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                      isActive ? 'bg-white/20 text-white' : 'bg-white/10 text-white/40'
                    }`}>
                      {folder.note_count}
                    </span>
                  )}
                </button>
                {/* 3-dot menu — absolute positioned over the count area */}
                <div className="absolute right-1 top-1/2 -translate-y-1/2" ref={folderMenuId === folder.id ? folderMenuRef : undefined}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setFolderMenuId(folderMenuId === folder.id ? null : folder.id); }}
                    className="p-1 rounded-lg hover:bg-white/15 text-white/30 hover:text-white/70 opacity-0 group-hover:opacity-100 transition-all"
                    aria-label="Opsi folder"
                  >
                    <HiOutlineDotsVertical className="w-3.5 h-3.5" />
                  </button>
                  {folderMenuId === folder.id && (
                    <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 w-40 z-50">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFolderMenuId(null);
                          onPublicLink?.(folder.id, folder.name);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <HiOutlineLink className="w-4 h-4" />
                        Public Link
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFolderMenuId(null);
                          onShareFolder?.(folder.id);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <HiOutlineUsers className="w-4 h-4" />
                        Share
                      </button>
                    </div>
                  )}
                </div>

                {/* Children */}
                {children.length > 0 && isActive && (
                  <div className="ml-5 space-y-0.5 mt-0.5">
                    {children.map((child) => {
                      const childActive = activeFolder === child.id;
                      return (
                        <button
                          key={child.id}
                          onClick={() => onSelectFolder(childActive ? null : child.id)}
                          className={`sidebar-nav-item w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-sm transition-all duration-200 relative ${
                            childActive
                              ? 'sidebar-nav-active text-white font-medium'
                              : 'text-indigo-100/50 hover:bg-white/10 hover:text-white/80'
                          }`}
                        >
                          {childActive && <span className="sidebar-active-indicator absolute left-0 w-[3px] h-4 bg-white rounded-r-full" />}
                          <HiOutlineFolder className="w-3.5 h-3.5 flex-shrink-0" style={{ color: child.color || undefined }} />
                          <span className="truncate">{child.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {rootFolders.length === 0 && (
            <p className="text-xs text-white/20 px-3 py-1">Belum ada folder</p>
          )}
        </div>
      </div>

      {/* Shared Folders */}
      {sharedFolders && sharedFolders.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-300/50 mb-2 px-1">Shared with me</p>
          {sharedFolders.map(f => (
            <button
              key={`shared-${f.id}`}
              onClick={() => onSelectSharedFolder(f.id)}
              className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all ${
                activeSharedFolder === f.id
                  ? 'bg-white/15 text-white'
                  : 'text-indigo-100/60 hover:bg-white/8 hover:text-indigo-100'
              }`}
            >
              <HiOutlineUsers className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{f.name}</span>
              <span className="ml-auto text-[10px] text-indigo-300/40">{f.owner_name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Tags */}
      <div>
        <div className="flex items-center justify-between px-3 mb-2">
          <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.15em]">Tag</h3>
          <div className="flex items-center gap-0.5">
            <button onClick={() => setAddingTag(true)} className="p-1 hover:bg-white/10 rounded-lg transition-colors" title="Tambah Tag" aria-label="Tambah tag">
              <HiOutlinePlus className="w-3.5 h-3.5 text-white/40" />
            </button>
            <button onClick={onManageTags} className="p-1 hover:bg-white/10 rounded-lg transition-colors" title="Kelola Tag" aria-label="Kelola tag">
              <HiOutlineCog className="w-3.5 h-3.5 text-white/40" />
            </button>
          </div>
        </div>
        {addingTag && (
          <div className="flex items-center gap-1 mb-1.5 px-2">
            <input
              autoFocus
              value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitTag(); if (e.key === 'Escape') setAddingTag(false); }}
              placeholder="Nama tag..."
              className="flex-1 text-sm px-2 py-1 bg-white/10 border border-white/20 rounded-lg outline-none text-white placeholder-white/30 focus:bg-white/15 focus:border-white/30"
            />
            <button onClick={submitTag} className="p-1 hover:bg-white/15 rounded-lg text-emerald-300" aria-label="Konfirmasi tambah tag">
              <HiOutlineCheck className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setAddingTag(false)} className="p-1 hover:bg-white/10 rounded-lg text-white/40" aria-label="Batal tambah tag">
              <HiOutlineX className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className="space-y-0.5">
          {tags.map((tag) => {
            const isActive = activeTag === tag.id;
            return (
              <button
                key={tag.id}
                onClick={() => onSelectTag(isActive ? null : tag.id)}
                className={`sidebar-nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-200 relative ${
                  isActive
                    ? 'sidebar-nav-active text-white font-medium'
                    : 'text-indigo-100/60 hover:bg-white/10 hover:text-white'
                }`}
              >
                {isActive && <span className="sidebar-active-indicator absolute left-0 w-[3px] h-4 bg-white rounded-r-full" />}
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-white/10" style={{ backgroundColor: tag.color }} />
                <span className="truncate">{tag.name}</span>
                {tag.note_count > 0 && (
                  <span className="ml-auto text-[10px] text-white/30 font-medium">{tag.note_count}</span>
                )}
              </button>
            );
          })}
          {tags.length === 0 && (
            <p className="text-xs text-white/20 px-3 py-1">Belum ada tag</p>
          )}
        </div>
      </div>
    </div>
  );

  // Desktop inline mode: show prop not passed → render in glass container
  if (show == null) return sidebarContent;

  // Mobile: always render (for slide transition), toggle visibility via classes
  return (
    <div className={`lg:hidden fixed inset-0 z-50 transition-opacity duration-300 ${show ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`absolute left-0 top-0 bottom-0 w-72 sidebar-gradient overflow-y-auto shadow-2xl transition-transform duration-300 ease-out ${show ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="absolute inset-0 sidebar-frost pointer-events-none" />
        <div className="relative p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white text-sm">Filter & Navigasi</h2>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors" aria-label="Tutup sidebar">
              <HiOutlineX className="w-5 h-5 text-white/70" />
            </button>
          </div>
          {sidebarContent}
        </div>
      </div>
    </div>
  );
}
