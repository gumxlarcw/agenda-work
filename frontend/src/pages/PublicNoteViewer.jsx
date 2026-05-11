import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { notePublicShareAPI } from '../services/api';
import {
  HiOutlineZoomIn,
  HiOutlineZoomOut,
  HiOutlineClock,
  HiOutlineUser,
  HiOutlineFolder,
  HiOutlineTag,
  HiOutlineStar,
  HiOutlineEye,
  HiOutlineX,
  HiOutlineCalendar,
  HiOutlineDocumentText,
} from 'react-icons/hi';
import NoteCard from '../components/notes/NoteCard';
import CanvasArrows from '../components/notes/CanvasArrows';

const NoteEditor = lazy(() => import('../components/notes/NoteEditor'));

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.05;
const CANVAS_PAD = 200;

/* ── Brand Icon ───────────────────────────────── */
function BrandIcon({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="2" y="4" width="32" height="28" rx="6" fill="url(#pubBrandGrad)" />
      <rect x="2" y="4" width="32" height="9" rx="6" fill="url(#pubBrandGradTop)" />
      <rect x="2" y="10" width="32" height="3" fill="url(#pubBrandGradTop)" />
      <rect x="10" y="2" width="3" height="6" rx="1.5" fill="white" opacity="0.9" />
      <rect x="23" y="2" width="3" height="6" rx="1.5" fill="white" opacity="0.9" />
      <path d="M12 21L16 25L25 16" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
      <defs>
        <linearGradient id="pubBrandGrad" x1="2" y1="4" x2="34" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366f1" /><stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id="pubBrandGradTop" x1="2" y1="4" x2="34" y2="13" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4f46e5" /><stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ── Action labels (shared) ──────────────────── */
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

/* ── Safe JSON parse ─────────────────────────── */
function safeParseJson(input) {
  if (!input) return null;
  if (typeof input !== 'string') return input;
  try { return JSON.parse(input); } catch { return null; }
}

/* ── Change Detail (reused from NoteEditorModal pattern) ── */
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

/* ═══════════════════════════════════════════════
   SINGLE NOTE VIEWER — Editorial document layout
   ═══════════════════════════════════════════════ */
function SingleNoteViewer({ data }) {
  const note = data.data.notes[0];
  const activities = note?.activity_log || [];
  const parsedContent = useMemo(() => safeParseJson(note?.content_json), [note]);
  const noteColor = note?.color && note.color !== '#ffffff' ? note.color : null;

  const formatDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('id-ID', {
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#f0f1f3' }}>
      {/* Subtle texture background */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      {/* ── Header ─────────────────────────────── */}
      <header className="relative bg-white/80 backdrop-blur-md border-b border-gray-200/60 px-6 py-3 flex items-center justify-between flex-shrink-0 z-10">
        <div className="flex items-center gap-3">
          <BrandIcon className="w-7 h-7" />
          <div className="leading-tight">
            <h1 className="text-sm font-bold text-gray-800">Agenda Work</h1>
            <p className="text-[10px] text-gray-400 tracking-wide uppercase">Shared View</p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-gray-400 bg-gray-100/80 rounded-full">
          <HiOutlineEye className="w-3.5 h-3.5" />
          Read-only
        </span>
      </header>

      {/* ── Main Content ────────────────────────── */}
      <main className="flex-1 relative z-0 py-8 px-4">
        <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-6">
          {/* ── Note Document ─────────────────────── */}
          <article className="flex-1 min-w-0">
            <div
              className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden"
              style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.06)' }}
            >
              {/* Color accent stripe */}
              {noteColor && (
                <div className="h-1.5" style={{ backgroundColor: noteColor }} />
              )}

              {/* Note header */}
              <div className="px-8 pt-8 pb-4" style={noteColor ? { backgroundColor: noteColor + '0a' } : undefined}>
                {/* Pin badge */}
                {note.is_pinned === 1 && (
                  <div className="flex items-center gap-1.5 mb-3">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200/60">
                      <HiOutlineStar className="w-3 h-3" />
                      Disematkan
                    </span>
                  </div>
                )}

                {/* Title */}
                <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 leading-tight mb-4">
                  {note.title || 'Untitled'}
                </h2>

                {/* Meta row */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-gray-400">
                  <span className="flex items-center gap-1.5">
                    <HiOutlineUser className="w-3.5 h-3.5" />
                    <span className="text-gray-600 font-medium">{data.owner?.name || note.owner_name}</span>
                  </span>
                  {note.folder_name && (
                    <span className="flex items-center gap-1.5">
                      <HiOutlineFolder className="w-3.5 h-3.5" />
                      <span className="text-gray-500">{note.folder_name}</span>
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <HiOutlineCalendar className="w-3.5 h-3.5" />
                    <span>{formatDate(note.updated_at)}</span>
                  </span>
                </div>

                {/* Tags */}
                {note.tags && note.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-4">
                    {note.tags.map(t => (
                      <span
                        key={t.id}
                        className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border"
                        style={{
                          backgroundColor: (t.color || '#6b7280') + '12',
                          borderColor: (t.color || '#6b7280') + '30',
                          color: t.color || '#6b7280',
                        }}
                      >
                        <HiOutlineTag className="w-3 h-3" />
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="mx-8">
                <div className="border-t border-gray-100" />
              </div>

              {/* Content — full TipTap rendering */}
              <div className="px-8 py-6" style={noteColor ? { backgroundColor: noteColor + '06' } : undefined}>
                {parsedContent ? (
                  <Suspense fallback={
                    <div className="flex items-center justify-center py-12 text-gray-400 text-sm">Memuat konten...</div>
                  }>
                    <NoteEditor
                      content={parsedContent}
                      editable={false}
                      editorColor={noteColor || '#ffffff'}
                    />
                  </Suspense>
                ) : note.content ? (
                  <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {note.content}
                  </div>
                ) : (
                  <p className="text-gray-400 italic text-sm py-8 text-center">Catatan ini belum memiliki konten.</p>
                )}
              </div>

              {/* Created date footer */}
              <div className="px-8 py-4 border-t border-gray-100 bg-gray-50/50">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-400">
                  <span>Dibuat {formatDate(note.created_at)}</span>
                  <span>Terakhir diubah {formatDate(note.updated_at)}</span>
                </div>
              </div>
            </div>
          </article>

          {/* ── Activity Log Sidebar ──────────────── */}
          {activities.length > 0 && (
            <aside className="lg:w-72 xl:w-80 flex-shrink-0">
              <div
                className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden lg:sticky lg:top-4"
                style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.06)' }}
              >
                <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                    <HiOutlineClock className="w-4 h-4" />
                    Riwayat Aktivitas
                  </h3>
                </div>
                <div className="px-4 py-3 max-h-[calc(100vh-14rem)] overflow-auto">
                  <div className="space-y-4">
                    {activities.map((log, i) => {
                      let details = null;
                      try { details = log.details ? JSON.parse(log.details) : null; } catch { /* ignore */ }
                      return (
                        <div key={log.id || i} className="text-xs">
                          <div className="flex items-start gap-2">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <HiOutlineUser className="w-3.5 h-3.5 text-indigo-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div>
                                <span className="font-semibold text-gray-700">{log.user_name}</span>
                                <span className="text-gray-500 ml-1">{ACTION_LABELS[log.action] || log.action}</span>
                              </div>
                              <div className="text-[10px] text-gray-400 mt-0.5">
                                {new Date(log.created_at).toLocaleDateString('id-ID', {
                                  day: 'numeric', month: 'short', year: 'numeric',
                                  hour: '2-digit', minute: '2-digit',
                                })}
                              </div>
                            </div>
                          </div>
                          {Array.isArray(details) && details.length > 0 && (
                            <div className="ml-9 mt-1.5 space-y-0.5 pl-3 border-l-2 border-gray-200">
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
                </div>
              </div>
            </aside>
          )}
        </div>
      </main>

      {/* ── Footer ─────────────────────────────── */}
      <footer className="relative bg-white/80 backdrop-blur-md border-t border-gray-200/60 px-6 py-3 flex items-center justify-between flex-shrink-0 z-10">
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <BrandIcon className="w-5 h-5" />
          <span className="font-medium text-gray-500">Agenda Work</span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">BPS Provinsi Maluku Utara</span>
        </div>
        <p className="text-[10px] text-gray-300">
          © {new Date().getFullYear()} Agenda Work
        </p>
      </footer>
    </div>
  );
}


/* ═══════════════════════════════════════════════
   NOTE DETAIL MODAL — Used in folder canvas view
   ═══════════════════════════════════════════════ */
function NoteDetailModal({ note, ownerName, onClose, connectedChildren, aggregatedProgress }) {
  const parsedContent = useMemo(() => safeParseJson(note?.content_json), [note]);
  const noteColor = note?.color && note.color !== '#ffffff' ? note.color : null;
  const activities = note?.activity_log || [];

  const formatDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('id-ID', {
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl animate-fadeIn overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: '0 4px 40px rgba(0,0,0,0.15)' }}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-gray-200/60 bg-gray-50/50 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <HiOutlineDocumentText className="w-5 h-5 text-indigo-500 flex-shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-800 truncate">{note.title || 'Untitled'}</h3>
              <p className="text-[10px] text-gray-400 flex items-center gap-1.5">
                <HiOutlineUser className="w-3 h-3" /> {ownerName || note.owner_name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-gray-400 bg-gray-100 rounded-full">
              <HiOutlineEye className="w-3 h-3" /> Read-only
            </span>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
              <HiOutlineX className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>

        {/* Content area */}
        <div className="flex flex-1 overflow-hidden flex-col lg:flex-row">
          {/* Note content */}
          <div className="flex-1 overflow-auto min-w-0">
            {/* Color accent */}
            {noteColor && <div className="h-1" style={{ backgroundColor: noteColor }} />}

            {/* Metadata */}
            <div className="px-6 pt-5 pb-3" style={noteColor ? { backgroundColor: noteColor + '08' } : undefined}>
              {note.is_pinned === 1 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200/60 mb-3">
                  <HiOutlineStar className="w-3 h-3" /> Disematkan
                </span>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-gray-400">
                {note.folder_name && (
                  <span className="flex items-center gap-1">
                    <HiOutlineFolder className="w-3.5 h-3.5" /> <span className="text-gray-500">{note.folder_name}</span>
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <HiOutlineCalendar className="w-3.5 h-3.5" /> {formatDate(note.updated_at)}
                </span>
              </div>
              {note.tags && note.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {note.tags.map(t => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-lg border"
                      style={{
                        backgroundColor: (t.color || '#6b7280') + '12',
                        borderColor: (t.color || '#6b7280') + '30',
                        color: t.color || '#6b7280',
                      }}
                    >
                      <HiOutlineTag className="w-2.5 h-2.5" /> {t.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="mx-6"><div className="border-t border-gray-100" /></div>

            {/* Full content via TipTap */}
            <div className="px-6 py-5" style={noteColor ? { backgroundColor: noteColor + '04' } : undefined}>
              {parsedContent ? (
                <Suspense fallback={<div className="flex items-center justify-center py-8 text-gray-400 text-sm">Memuat konten...</div>}>
                  <NoteEditor content={parsedContent} editable={false} editorColor={noteColor || '#ffffff'} />
                </Suspense>
              ) : note.content ? (
                <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap">{note.content}</div>
              ) : (
                <p className="text-gray-400 italic text-sm py-6 text-center">Catatan ini belum memiliki konten.</p>
              )}
            </div>

            {/* Connected Children — Master Dashboard */}
            {connectedChildren && connectedChildren.length > 0 && (() => {
              const globalPct = aggregatedProgress
                ? Math.round((aggregatedProgress.checked / aggregatedProgress.total) * 100)
                : null;
              return (
                <div className="border-t bg-gradient-to-b from-slate-50 to-white">
                  <div className="px-6 pt-4 pb-3">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <HiOutlineDocumentText className="w-4 h-4 text-indigo-500" />
                        Catatan Terhubung
                        <span className="text-[10px] font-medium text-slate-400 normal-case tracking-normal">
                          {connectedChildren.length} aspek
                        </span>
                      </h4>
                      {globalPct !== null && (
                        <span className={`text-lg font-black tracking-tight ${
                          globalPct === 100 ? 'text-emerald-500' : globalPct >= 50 ? 'text-indigo-600' : 'text-slate-400'
                        }`}>{globalPct}%</span>
                      )}
                    </div>
                    {globalPct !== null && (
                      <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                        <div className={`h-2.5 rounded-full transition-all duration-500 ${
                          globalPct === 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-indigo-400 to-indigo-600'
                        }`} style={{ width: `${globalPct}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="px-6 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {connectedChildren.map(child => {
                      const pct = child.total > 0 ? Math.round((child.checked / child.total) * 100) : null;
                      const isDone = pct === 100;
                      return (
                        <div key={child.id} className={`rounded-lg border px-3 py-2.5 ${
                          isDone ? 'bg-emerald-50/60 border-emerald-200' : 'bg-white border-slate-200'
                        }`}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-white" style={{ backgroundColor: child.color || '#6b7280' }} />
                            <span className="flex-1 text-sm font-medium text-slate-700 truncate">{child.title}</span>
                            {isDone && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">Done</span>}
                          </div>
                          {pct !== null ? (
                            <>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                  <div className={`h-1.5 rounded-full ${isDone ? 'bg-emerald-500' : 'bg-indigo-400'}`} style={{ width: `${pct}%` }} />
                                </div>
                                <span className={`text-[11px] font-semibold tabular-nums w-8 text-right ${isDone ? 'text-emerald-600' : 'text-slate-500'}`}>{pct}%</span>
                              </div>
                              <div className="text-[10px] text-slate-400 mt-1">{child.checked}/{child.total} item</div>
                            </>
                          ) : (
                            <span className="text-[10px] text-slate-400 italic">Belum ada checklist</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Footer dates */}
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-400">
                <span>Dibuat {formatDate(note.created_at)}</span>
                <span>Terakhir diubah {formatDate(note.updated_at)}</span>
              </div>
            </div>
          </div>

          {/* Activity log sidebar */}
          {activities.length > 0 && (
            <div className="lg:w-64 xl:w-72 border-t lg:border-t-0 lg:border-l border-gray-200/60 bg-gray-50/30 flex-shrink-0 overflow-auto">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/80">
                <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <HiOutlineClock className="w-3.5 h-3.5" /> Riwayat Aktivitas
                </h4>
              </div>
              <div className="px-3 py-2 space-y-3 max-h-[50vh] lg:max-h-none overflow-auto">
                {activities.map((log, i) => {
                  let details = null;
                  try { details = log.details ? JSON.parse(log.details) : null; } catch {}
                  return (
                    <div key={log.id || i} className="text-[11px]">
                      <div className="flex items-start gap-2">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <HiOutlineUser className="w-3 h-3 text-indigo-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div>
                            <span className="font-semibold text-gray-700">{log.user_name}</span>
                            <span className="text-gray-500 ml-1">{ACTION_LABELS[log.action] || log.action}</span>
                          </div>
                          <div className="text-[10px] text-gray-400 mt-0.5">
                            {new Date(log.created_at).toLocaleDateString('id-ID', {
                              day: 'numeric', month: 'short', year: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </div>
                        </div>
                      </div>
                      {Array.isArray(details) && details.length > 0 && (
                        <div className="ml-8 mt-1 space-y-0.5 pl-2.5 border-l-2 border-gray-200">
                          {details.map((d, j) => (
                            <div key={j} className="text-[10px] text-gray-500"><ChangeDetail d={d} /></div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════
   FOLDER CANVAS VIEWER — Existing canvas layout
   ═══════════════════════════════════════════════ */
function FolderCanvasViewer({ data }) {
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [selectedNote, setSelectedNote] = useState(null);
  const panStartRef = useRef(null);
  const wrapperRef = useRef(null);

  const notes = data?.data?.notes || [];
  const connections = data?.data?.connections || [];

  // ─── Master note aggregated progress + child notes map ──
  const { aggregatedProgressMap, childNotesMap } = useMemo(() => {
    if (!connections.length || !notes.length) return { aggregatedProgressMap: {}, childNotesMap: {} };
    const notesById = {};
    notes.forEach(n => { notesById[n.id] = n; });

    const getProgress = (contentJson) => {
      const json = safeParseJson(contentJson);
      if (!json) return null;
      let total = 0, checked = 0;
      const walk = (node) => {
        if (node.type === 'taskItem') { total++; if (node.attrs?.checked) checked++; }
        if (node.content) node.content.forEach(walk);
      };
      walk(json);
      return total > 0 ? { checked, total } : null;
    };

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
        const prog = getProgress(note.content_json);
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

  // Note positions
  const notePositions = useMemo(() => {
    const pos = {};
    const CARD_W = 320, CARD_H = 260, cols = 3;
    let autoIdx = 0;
    notes.forEach(note => {
      if (note.position_x != null && note.position_y != null) {
        pos[note.id] = { x: note.position_x, y: note.position_y };
      } else {
        pos[note.id] = { x: (autoIdx % cols) * CARD_W, y: Math.floor(autoIdx / cols) * CARD_H };
        autoIdx++;
      }
    });
    return pos;
  }, [notes]);

  const cardWidths = useMemo(() => {
    const w = {};
    notes.forEach(n => { if (n.card_width) w[n.id] = n.card_width; });
    return w;
  }, [notes]);

  const cardHeights = useMemo(() => {
    const h = {};
    notes.forEach(n => { if (n.card_height) h[n.id] = n.card_height; });
    return h;
  }, [notes]);

  const canvasWidth = useMemo(() => {
    let maxX = 1200;
    Object.entries(notePositions).forEach(([id, pos]) => {
      const w = cardWidths[id] || 280;
      if (pos.x + w + CANVAS_PAD > maxX) maxX = pos.x + w + CANVAS_PAD;
    });
    return maxX;
  }, [notePositions, cardWidths]);

  const canvasHeight = useMemo(() => {
    let maxY = 800;
    Object.entries(notePositions).forEach(([id, pos]) => {
      const h = cardHeights[id] || 200;
      if (pos.y + h + CANVAS_PAD > maxY) maxY = pos.y + h + CANVAS_PAD;
    });
    return maxY;
  }, [notePositions, cardHeights]);

  const zoomIn = () => setZoom(z => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100));
  const zoomOut = () => setZoom(z => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100));
  const zoomReset = () => { setZoom(1); setPanOffset({ x: 0, y: 0 }); };

  const zoomFit = useCallback(() => {
    if (!wrapperRef.current || !notes.length) return;
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    notes.forEach(n => {
      const pos = notePositions[n.id] || { x: 0, y: 0 };
      const w = cardWidths[n.id] || 280;
      const h = cardHeights[n.id] || 200;
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.x + w > maxX) maxX = pos.x + w;
      if (pos.y + h > maxY) maxY = pos.y + h;
    });
    const contentW = maxX - minX + 80;
    const contentH = maxY - minY + 80;
    const viewW = wrapperRef.current.clientWidth;
    const viewH = wrapperRef.current.clientHeight || 600;
    const fitZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(viewW / contentW, viewH / contentH)));
    const finalZoom = Math.round(fitZoom * 100) / 100;
    setZoom(finalZoom);
    const scaledW = contentW * finalZoom;
    const scaledH = contentH * finalZoom;
    setPanOffset({
      x: (viewW - scaledW) / 2 - minX * finalZoom,
      y: (viewH - scaledH) / 2 - minY * finalZoom,
    });
  }, [notes, notePositions, cardWidths, cardHeights]);

  useEffect(() => {
    if (notes.length > 1) setTimeout(zoomFit, 100);
  }, [notes.length]); // eslint-disable-line

  const handlePanStart = useCallback((e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    setIsPanning(true);
    panStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
  }, [panOffset]);

  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e) => {
      if (!panStartRef.current) return;
      setPanOffset({ x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y });
    };
    const onUp = () => { setIsPanning(false); panStartRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isPanning]);

  // Alt+Wheel zoom
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!e.altKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      setZoom(prev => {
        const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
        const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round((prev + delta) * 100) / 100));
        const scale = newZoom / prev;
        setPanOffset(p => ({ x: cursorX - scale * (cursorX - p.x), y: cursorY - scale * (cursorY - p.y) }));
        return newZoom;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const allActivities = data.data.activities || [];
  const title = data.folder?.name || 'Folder';

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between flex-shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <BrandIcon />
          <div>
            <h1 className="text-sm font-bold text-gray-800 leading-tight">Agenda Work</h1>
            <p className="text-[10px] text-gray-400">Shared View</p>
          </div>
          <div className="w-px h-8 bg-gray-200 mx-2" />
          <div>
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              <HiOutlineFolder className="w-4 h-4 text-primary-500" />
              {title}
            </h2>
            <p className="text-[10px] text-gray-400 flex items-center gap-1">
              <HiOutlineUser className="w-3 h-3" />
              {data.owner?.name}
              <span className="mx-1">·</span>
              {notes.length} catatan
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {allActivities.length > 0 && (
            <button
              onClick={() => setShowActivity(!showActivity)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                showActivity ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <HiOutlineClock className="w-3.5 h-3.5" />
              Activity
            </button>
          )}
          <span className="text-[10px] text-gray-300 flex items-center gap-1">
            <HiOutlineEye className="w-3 h-3" /> Read-only
          </span>
        </div>
      </header>

      {/* Canvas */}
      <div className="flex-1 relative overflow-hidden">
        <div
          ref={wrapperRef}
          className="w-full h-full overflow-hidden"
          style={{
            cursor: isPanning ? 'grabbing' : 'default',
            backgroundColor: '#e8eaed',
          }}
          onMouseDown={handlePanStart}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            className="absolute"
            style={{
              width: canvasWidth + CANVAS_PAD,
              height: canvasHeight + CANVAS_PAD,
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
          >
            <div
              className="absolute inset-0 rounded-2xl pointer-events-none"
              style={{ backgroundColor: '#ffffff', boxShadow: '0 2px 20px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)' }}
            />
            <CanvasArrows
              connections={connections}
              notePositions={notePositions}
              cardWidths={cardWidths}
              cardHeights={cardHeights}
            />
            {notes.map(note => {
              const pos = notePositions[note.id] || { x: 0, y: 0 };
              const width = cardWidths[note.id] || 280;
              const height = cardHeights[note.id] || null;
              return (
                <div
                  key={note.id}
                  className="absolute group"
                  style={{ left: pos.x, top: pos.y, width, height: height || undefined, minHeight: 120, cursor: 'pointer' }}
                  onClick={() => setSelectedNote(selectedNote?.id === note.id ? null : note)}
                >
                  <NoteCard note={note} tags={note.tags || []} compact={false} fillHeight={!!height} aggregatedProgress={aggregatedProgressMap[note.id]} childNotes={childNotesMap[note.id]} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Zoom controls */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-xl px-1.5 py-1 shadow-lg z-30">
          <button onClick={zoomOut} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-600"><HiOutlineZoomOut className="w-4 h-4" /></button>
          <button onClick={zoomReset} className="px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors min-w-[3rem] text-center">{Math.round(zoom * 100)}%</button>
          <button onClick={zoomIn} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-600"><HiOutlineZoomIn className="w-4 h-4" /></button>
          <div className="w-px h-5 bg-gray-200" />
          <button onClick={zoomFit} className="px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">Fit</button>
        </div>

        <div className="absolute bottom-3 left-3 z-30">
          <div className="text-[10px] text-gray-400 bg-white/70 backdrop-blur-sm rounded-lg px-2 py-1">
            Alt+Scroll: zoom · Spasi/tengah+drag: geser
          </div>
        </div>

        {/* Note detail modal */}
        {selectedNote && <NoteDetailModal note={selectedNote} ownerName={data.owner?.name} onClose={() => setSelectedNote(null)} connectedChildren={childNotesMap[selectedNote?.id]} aggregatedProgress={aggregatedProgressMap[selectedNote?.id]} />}
      </div>

      {/* Activity panel (slide-in) */}
      {showActivity && (
        <div className="fixed right-0 top-0 bottom-0 w-80 bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col animate-slideInRight">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
              <HiOutlineClock className="w-4 h-4" /> Activity Log
            </h3>
            <button onClick={() => setShowActivity(false)} className="p-1 hover:bg-gray-100 rounded-lg"><HiOutlineX className="w-4 h-4" /></button>
          </div>
          <div className="flex-1 overflow-auto p-3 space-y-2">
            {allActivities.map((a, i) => (
              <div key={i} className="flex gap-2 text-xs p-2 rounded-lg hover:bg-gray-50">
                <div className="w-6 h-6 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center flex-shrink-0">
                  <HiOutlineUser className="w-3 h-3" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-gray-700">{a.user_name}</p>
                  <p className="text-gray-500">{ACTION_LABELS[a.action] || a.action}</p>
                  <p className="text-gray-300 mt-0.5">{new Date(a.created_at).toLocaleString('id-ID')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 px-4 py-2 flex items-center justify-between flex-shrink-0 z-10">
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          <BrandIcon className="w-5 h-5" />
          <span className="font-medium text-gray-500">Agenda Work</span>
          <span>·</span>
          <span>BPS Provinsi Maluku Utara</span>
        </div>
        <p className="text-[10px] text-gray-300">© {new Date().getFullYear()} Agenda Work</p>
      </footer>
    </div>
  );
}


/* ═══════════════════════════════════════════════
   MAIN — Route handler, fetches data, delegates
   ═══════════════════════════════════════════════ */
export default function PublicNoteViewer() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await notePublicShareAPI.getPublic(token);
        setData(res.data);
      } catch (err) {
        setError(err.response?.data?.message || 'Link tidak ditemukan atau sudah tidak aktif');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Memuat...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f0f1f3' }}>
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <HiOutlineX className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Link Tidak Valid</h2>
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // Bifurcate: single note = editorial viewer, folder = canvas viewer
  if (data?.share_type === 'note') {
    return <SingleNoteViewer data={data} />;
  }

  return <FolderCanvasViewer data={data} />;
}
