import { useState, lazy, Suspense } from 'react';
import {
  HiOutlineX,
  HiOutlineFolder,
  HiOutlineTag,
  HiOutlineColorSwatch,
  HiOutlineShare,
  HiOutlineSparkles,
  HiOutlineSave,
  HiOutlineTemplate,
  HiOutlineLink,
  HiOutlineLockClosed,
  HiOutlineEye,
  HiOutlineClock,
  HiOutlineUser,
} from 'react-icons/hi';
import dayjs from 'dayjs';
import ShareModal from './ShareModal';
import AISummaryPanel from './AISummaryPanel';
import PublicLinkModal from './PublicLinkModal';

const NoteEditor = lazy(() => import('./NoteEditor'));

const COLORS = ['#ffffff', '#fef3c7', '#d1fae5', '#dbeafe', '#ede9fe', '#fce7f3', '#fee2e2'];

const ACTION_LABELS = {
  created: 'membuat catatan',
  edited: 'mengedit',
  title_edited: 'mengubah judul',
  content_edited: 'mengubah isi',
  folder_moved: 'memindahkan folder',
  tag_changed: 'mengubah tag',
  color_changed: 'mengubah warna',
  pinned: 'mem-pin',
  unpinned: 'meng-unpin',
  archived: 'mengarsipkan',
  unarchived: 'mengembalikan dari arsip',
  shared: 'membagikan',
  share_revoked: 'menghapus akses',
  public_link_created: 'membuat tautan publik',
  public_link_revoked: 'mencabut tautan publik',
  status_changed: 'mengubah status',
  connection_added: 'menghubungkan catatan',
  connection_removed: 'memutus koneksi',
};

function ChangeDetail({ d }) {
  if (!d || typeof d !== 'object') return null;

  // tags: { added: string[], removed: string[] }
  if (Array.isArray(d.added) || Array.isArray(d.removed)) {
    return (
      <div>
        {d.added?.length > 0 && (
          <div className="text-green-600">+ {d.added.map(x => typeof x === 'object' ? x.name : x).join(', ')}</div>
        )}
        {d.removed?.length > 0 && (
          <div className="text-red-400">− {d.removed.map(x => typeof x === 'object' ? x.name : x).join(', ')}</div>
        )}
      </div>
    );
  }

  // folder: { from_id, from_name, to_id, to_name }
  if ('from_name' in d || 'to_name' in d) {
    return (
      <div>
        <span className="text-gray-500">{d.from_name || '—'}</span>
        <span className="mx-1">→</span>
        <span className="text-gray-700">{d.to_name || '—'}</span>
      </div>
    );
  }

  // status cell: { cell_label, from, to }
  if ('cell_label' in d) {
    return (
      <div>
        <span className="font-medium">{d.cell_label}</span>:
        <span className="text-gray-500 ml-1">{d.from || '—'}</span>
        <span className="mx-1">→</span>
        <span className="text-gray-700">{d.to || '—'}</span>
      </div>
    );
  }

  // connection: { other_note_id, other_title }
  if ('other_title' in d) {
    return <div className="text-gray-600">↔ {d.other_title}</div>;
  }

  // public link: { token_tail }
  if ('token_tail' in d) {
    return <div className="text-gray-500">…{d.token_tail}</div>;
  }

  // admin impersonation: { impersonated_by: { id, name } }
  if ('impersonated_by' in d) {
    return (
      <div className="text-amber-600 italic">
        via admin: {d.impersonated_by?.name || `User #${d.impersonated_by?.id}`}
      </div>
    );
  }

  // generic from/to (title, color, etc.)
  if ('from' in d && 'to' in d) {
    return (
      <div>
        <span className="text-gray-500">{String(d.from ?? '—')}</span>
        <span className="mx-1">→</span>
        <span className="text-gray-700">{String(d.to ?? '—')}</span>
      </div>
    );
  }

  return null;
}

function ActivityLogSidebar({ selectedNote }) {
  const logs = selectedNote?.activity_log;

  return (
    <div className="w-72 border-l bg-gray-50/80 flex flex-col flex-shrink-0">
      <div className="px-3 py-3 border-b bg-white/60">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
          <HiOutlineClock className="w-3.5 h-3.5" />
          Riwayat Aktivitas
        </h4>
      </div>
      <div className="flex-1 overflow-auto px-3 py-2">
        {(!logs || logs.length === 0) ? (
          <p className="text-xs text-gray-400 py-4 text-center">Belum ada aktivitas</p>
        ) : (
          <div className="space-y-3">
            {logs.map((log, i) => {
              let details = null;
              try { details = log.details ? JSON.parse(log.details) : null; } catch { /* ignore */ }
              return (
                <div key={log.id || i} className="text-xs">
                  <div className="flex items-start gap-1.5">
                    <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <HiOutlineUser className="w-3 h-3 text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div>
                        <span className="font-semibold text-gray-700">{log.user_name}</span>
                        <span className="text-gray-500 ml-1">{ACTION_LABELS[log.action] || log.action}</span>
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {dayjs(log.created_at).format('DD MMM YYYY, HH:mm')}
                      </div>
                    </div>
                  </div>
                  {Array.isArray(details) && details.length > 0 && (
                    <div className="ml-[30px] mt-1 space-y-0.5 pl-2 border-l-2 border-gray-200">
                      {details.map((d, j) => (
                        <div key={j} className="text-[11px] text-gray-500">
                          <ChangeDetail d={d} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function NoteEditorModal({
  selectedNote, editorLoading, saving,
  editorTitle, setEditorTitle,
  editorContent, setEditorContent,
  editorPlainText, setEditorPlainText,
  editorFolder, setEditorFolder,
  editorTags, toggleEditorTag,
  editorColor, setEditorColor,
  editorPinned, setEditorPinned,
  setIsDirty,
  folders, tags,
  onSave, onBack, onSaveAsTemplate,
  onShareSave, onImageUpload, onSummarize,
  readOnly = false, lockInfo = null, userRole = 'owner', onForceTakeover,
  connectedChildren, aggregatedProgress,
}) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFolderSelect, setShowFolderSelect] = useState(false);
  const [showTagSelect, setShowTagSelect] = useState(false);
  const [showAISummary, setShowAISummary] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showPublicLink, setShowPublicLink] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-xl w-full max-w-6xl max-h-[95vh] flex flex-col shadow-2xl animate-fadeIn">
        {/* Editor Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-white rounded-t-xl">
          <div className="flex items-center gap-2">
            {selectedNote && !readOnly && (
              <button
                onClick={onSaveAsTemplate}
                className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
                title="Simpan sebagai template"
              >
                <HiOutlineTemplate className="w-5 h-5" />
              </button>
            )}
            {userRole === 'viewer' && (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 text-gray-500 text-xs font-medium">
                <HiOutlineEye className="w-3.5 h-3.5" /> Hanya baca
              </span>
            )}
            {lockInfo && (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 text-xs font-medium">
                <HiOutlineLockClosed className="w-3.5 h-3.5" /> Diedit oleh {lockInfo.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lockInfo && onForceTakeover && userRole !== 'viewer' && (
              <button
                onClick={onForceTakeover}
                className="text-xs px-3 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-700 font-medium transition-colors"
              >
                Ambil Alih
              </button>
            )}
            {!readOnly && (
              <button
                onClick={onSave}
                disabled={saving}
                className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-50"
              >
                <HiOutlineSave className="w-4 h-4" />
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            )}
            <button
              onClick={onBack}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
              aria-label="Tutup"
            >
              <HiOutlineX className="w-5 h-5" />
            </button>
          </div>
        </div>

        {editorLoading ? (
          <div className="flex-1 flex items-center justify-center min-h-[300px]">
            <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Left: Editor area */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              {/* Title input */}
              <div className="px-6 pt-4" style={{ backgroundColor: editorColor }}>
                <input
                  type="text"
                  value={editorTitle}
                  onChange={(e) => { if (!readOnly) { setEditorTitle(e.target.value); setIsDirty(true); } }}
                  placeholder="Judul catatan..."
                  className="w-full text-2xl font-bold text-gray-900 bg-transparent border-none outline-none placeholder-gray-400"
                  autoFocus
                  readOnly={readOnly}
                />
              </div>

              {/* Editor body */}
              <div className="flex-1 overflow-auto" style={{ backgroundColor: editorColor }}>
                <div className="px-6 py-4">
                  <Suspense fallback={<div className="flex items-center justify-center py-12 text-gray-400">Memuat editor...</div>}>
                    <NoteEditor
                      key={selectedNote?.id ?? 'new'}
                      content={editorContent}
                      onChange={(json, plainText) => {
                        if (!readOnly) {
                          setEditorContent(json);
                          setEditorPlainText(plainText);
                          setIsDirty(true);
                        }
                      }}
                      onImageUpload={readOnly ? undefined : onImageUpload}
                      editable={!readOnly}
                      editorColor={editorColor}
                    />
                  </Suspense>
                </div>

              {/* Connected Children — Master Dashboard */}
              {connectedChildren && connectedChildren.length > 0 && (() => {
                const globalPct = aggregatedProgress
                  ? Math.round((aggregatedProgress.checked / aggregatedProgress.total) * 100)
                  : null;
                const doneCount = connectedChildren.filter(c => c.total > 0 && c.checked === c.total).length;
                return (
                  <div className="border-t bg-gradient-to-b from-slate-50 to-white">
                    {/* Header with global progress */}
                    <div className="px-6 pt-4 pb-3">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                          <span className="w-5 h-5 rounded-md bg-primary-100 flex items-center justify-center">
                            <HiOutlineLink className="w-3 h-3 text-primary-600" />
                          </span>
                          Catatan Terhubung
                          <span className="text-[10px] font-medium text-slate-400 normal-case tracking-normal">
                            {connectedChildren.length} aspek
                          </span>
                        </h4>
                        {globalPct !== null && (
                          <span className={`text-lg font-black tracking-tight ${
                            globalPct === 100 ? 'text-emerald-500' : globalPct >= 50 ? 'text-primary-600' : 'text-slate-400'
                          }`}>
                            {globalPct}%
                          </span>
                        )}
                      </div>
                      {globalPct !== null && (
                        <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                          <div
                            className={`h-2.5 rounded-full transition-all duration-500 ${
                              globalPct === 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-primary-400 to-primary-600'
                            }`}
                            style={{ width: `${globalPct}%` }}
                          />
                        </div>
                      )}
                    </div>
                    {/* Per-child cards */}
                    <div className="px-6 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {connectedChildren.map(child => {
                        const pct = child.total > 0 ? Math.round((child.checked / child.total) * 100) : null;
                        const isDone = pct === 100;
                        return (
                          <div
                            key={child.id}
                            className={`rounded-lg border px-3 py-2.5 transition-colors ${
                              isDone ? 'bg-emerald-50/60 border-emerald-200' : 'bg-white border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1.5">
                              <span
                                className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-white"
                                style={{ backgroundColor: child.color || '#6b7280' }}
                              />
                              <span className="flex-1 text-sm font-medium text-slate-700 truncate">{child.title}</span>
                              {isDone && (
                                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">Done</span>
                              )}
                            </div>
                            {pct !== null ? (
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                  <div
                                    className={`h-1.5 rounded-full transition-all duration-300 ${
                                      isDone ? 'bg-emerald-500' : 'bg-primary-400'
                                    }`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className={`text-[11px] font-semibold tabular-nums w-8 text-right ${
                                  isDone ? 'text-emerald-600' : 'text-slate-500'
                                }`}>
                                  {pct}%
                                </span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-400 italic">Belum ada checklist</span>
                            )}
                            {pct !== null && (
                              <div className="text-[10px] text-slate-400 mt-1">
                                {child.checked}/{child.total} item
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              </div>

              {/* Editor Footer */}
              <div className="border-t px-4 py-2.5 flex flex-wrap items-center gap-2 text-sm" style={{ backgroundColor: editorColor === '#ffffff' ? 'white' : editorColor }}>
                {/* Folder selector */}
                <div className="relative">
                  <button
                    onClick={() => { setShowFolderSelect(!showFolderSelect); setShowTagSelect(false); setShowColorPicker(false); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
                  >
                    <HiOutlineFolder className="w-4 h-4" />
                    <span className="hidden sm:inline">
                      {editorFolder ? (folders.find(f => f.id === editorFolder)?.name || 'Folder') : 'Folder'}
                    </span>
                  </button>
                  {showFolderSelect && (
                    <div className="absolute bottom-full left-0 mb-1 bg-white border rounded-lg shadow-lg py-1 w-48 max-h-48 overflow-auto z-20">
                      <button
                        onClick={() => { setEditorFolder(null); setShowFolderSelect(false); }}
                        className={`w-full text-left px-3 py-1.5 hover:bg-gray-50 text-sm ${!editorFolder ? 'font-medium text-primary-600' : 'text-gray-700'}`}
                      >
                        Tanpa folder
                      </button>
                      {folders.map(f => (
                        <button
                          key={f.id}
                          onClick={() => { setEditorFolder(f.id); setShowFolderSelect(false); }}
                          className={`w-full text-left px-3 py-1.5 hover:bg-gray-50 text-sm flex items-center gap-2 ${editorFolder === f.id ? 'font-medium text-primary-600' : 'text-gray-700'}`}
                        >
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: f.color || '#6b7280' }} />
                          {f.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tag selector */}
                <div className="relative">
                  <button
                    onClick={() => { setShowTagSelect(!showTagSelect); setShowFolderSelect(false); setShowColorPicker(false); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
                  >
                    <HiOutlineTag className="w-4 h-4" />
                    <span className="hidden sm:inline">
                      {editorTags.length > 0 ? `${editorTags.length} tag` : 'Tag'}
                    </span>
                  </button>
                  {showTagSelect && (
                    <div className="absolute bottom-full left-0 mb-1 bg-white border rounded-lg shadow-lg py-1 w-48 max-h-48 overflow-auto z-20">
                      {tags.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-gray-400">Belum ada tag</p>
                      ) : tags.map(t => (
                        <button
                          key={t.id}
                          onClick={() => toggleEditorTag(t.id)}
                          className={`w-full text-left px-3 py-1.5 hover:bg-gray-50 text-sm flex items-center gap-2 ${editorTags.includes(t.id) ? 'font-medium text-primary-600' : 'text-gray-700'}`}
                        >
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color || '#6b7280' }} />
                          {t.name}
                          {editorTags.includes(t.id) && <span className="ml-auto text-primary-500 text-xs">&#10003;</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Color picker */}
                <div className="relative">
                  <button
                    onClick={() => { setShowColorPicker(!showColorPicker); setShowFolderSelect(false); setShowTagSelect(false); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
                  >
                    <HiOutlineColorSwatch className="w-4 h-4" />
                    <span className="w-4 h-4 rounded-full border border-gray-300" style={{ backgroundColor: editorColor }} />
                  </button>
                  {showColorPicker && (
                    <div className="absolute bottom-full left-0 mb-1 bg-white border rounded-lg shadow-lg p-2 z-20">
                      <div className="flex gap-1.5">
                        {COLORS.map(c => (
                          <button
                            key={c}
                            onClick={() => { setEditorColor(c); setShowColorPicker(false); }}
                            className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${editorColor === c ? 'border-primary-500 scale-110' : 'border-gray-200'}`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Pin toggle */}
                <button
                  onClick={() => setEditorPinned(!editorPinned)}
                  className={`px-2.5 py-1.5 rounded-lg hover:bg-gray-100 text-sm ${editorPinned ? 'text-yellow-600 font-medium' : 'text-gray-600'}`}
                  title={editorPinned ? 'Unpin' : 'Pin'}
                >
                  {editorPinned ? '\u2605 Pinned' : '\u2606 Pin'}
                </button>

                <div className="w-px h-5 bg-gray-200 hidden sm:block" />

                {/* Share button */}
                {selectedNote && (
                  <button
                    onClick={() => setShowShareModal(true)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
                  >
                    <HiOutlineShare className="w-4 h-4" />
                    <span className="hidden sm:inline">Share</span>
                  </button>
                )}

                {/* Public Link button */}
                {selectedNote && (
                  <button
                    onClick={() => setShowPublicLink(true)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
                  >
                    <HiOutlineLink className="w-4 h-4" />
                    <span className="hidden sm:inline">Public Link</span>
                  </button>
                )}

                {/* AI Summary */}
                {selectedNote && (
                  <button
                    onClick={() => setShowAISummary(!showAISummary)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 text-purple-600"
                  >
                    <HiOutlineSparkles className="w-4 h-4" />
                    <span className="hidden sm:inline">AI Ringkasan</span>
                  </button>
                )}

                {selectedNote?.linked_task_id && (
                  <span className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-blue-600 bg-blue-50 rounded-lg">
                    <HiOutlineLink className="w-3.5 h-3.5" />
                    Task #{selectedNote.linked_task_id}
                  </span>
                )}
                {selectedNote?.linked_kegiatan_id && (
                  <span className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-green-600 bg-green-50 rounded-lg">
                    <HiOutlineLink className="w-3.5 h-3.5" />
                    Kegiatan #{selectedNote.linked_kegiatan_id}
                  </span>
                )}

                {selectedNote && (
                  <span className="ml-auto text-xs text-gray-400 hidden sm:flex items-center gap-1">
                    {selectedNote.owner_name && (
                      <>
                        <HiOutlineUser className="w-3.5 h-3.5" />
                        <span className="text-gray-500 font-medium">{selectedNote.owner_name}</span>
                        <span>·</span>
                      </>
                    )}
                    Diubah {dayjs(selectedNote.updated_at).format('DD MMM YYYY, HH:mm')}
                  </span>
                )}
              </div>

              {/* AI Summary panel */}
              {showAISummary && selectedNote && (
                <div className="border-t px-4 py-3 bg-gray-50">
                  <AISummaryPanel
                    noteId={selectedNote.id}
                    summary={selectedNote.ai_summary}
                    onSummarize={onSummarize}
                  />
                </div>
              )}
            </div>

            {/* Right: Activity Log sidebar — always visible for existing notes */}
            {selectedNote && (
              <ActivityLogSidebar selectedNote={selectedNote} />
            )}
          </div>
        )}
      </div>

      {/* Share Modal */}
      {showShareModal && selectedNote && (
        <ShareModal
          note={selectedNote}
          onClose={() => setShowShareModal(false)}
          onSave={(userIds, roles) => { onShareSave(userIds, roles); setShowShareModal(false); }}
        />
      )}

      {/* Public Link Modal */}
      {showPublicLink && selectedNote && (
        <PublicLinkModal
          onClose={() => setShowPublicLink(false)}
          noteId={selectedNote.id}
          noteTitle={editorTitle || selectedNote.title}
        />
      )}
    </div>
  );
}
