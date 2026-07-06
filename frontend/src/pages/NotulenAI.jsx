import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { Line as ProgressLine } from 'rc-progress';
import { useAuth } from '../context/AuthContext';
import { notulenAPI, notulenFoldersAPI, getNotulenWsUrl } from '../services/api';
import toast from 'react-hot-toast';
import {
  HiOutlineMicrophone, HiOutlineStop, HiOutlinePlay, HiOutlineTrash,
  HiOutlineDocumentText, HiOutlineDownload, HiOutlineClipboard,
  HiOutlineArrowLeft, HiOutlineClock, HiOutlineRefresh, HiOutlineX,
  HiOutlinePause, HiOutlineUpload, HiOutlineCloudUpload, HiOutlineShare,
  HiOutlinePencil, HiOutlineSearch, HiOutlineChevronLeft, HiOutlineChevronRight,
  HiOutlineDocumentDuplicate, HiOutlineCheck, HiOutlineArchive,
  HiOutlineChatAlt2, HiOutlineLink, HiOutlineArrowRight,
  HiOutlineFilm, HiOutlineCloudDownload, HiOutlineSwitchHorizontal,
  HiOutlineScissors, HiOutlineSaveAs,
  HiOutlineFolder, HiOutlineFolderOpen, HiOutlinePlusCircle, HiOutlineInbox,
  HiOutlineDotsVertical, HiOutlineHome,
} from 'react-icons/hi';

const CHUNK_SEC = 15;
const TARGET_RATE = 16000;

const STATUS_BADGE = {
  recording: 'bg-red-100 text-red-700 ring-1 ring-red-200',
  completed: 'bg-green-100 text-green-700 ring-1 ring-green-200',
  archived: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200',
};

// Detect mobile & iOS
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// --- Date formatter (ISO → YYYY-MM-DD or readable) ---
function formatTanggal(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d)) return val;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
function toDateInput(val) {
  if (!val) return '';
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  if (isNaN(d)) return '';
  // Use local date parts (not toISOString which is UTC) to avoid -1 day shift in UTC+ timezones
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// --- Duration formatter ---
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}j ${m}m`;
  if (m > 0) return `${m}m ${s}d`;
  return `${s}d`;
}

// --- Simple markdown renderer (output is safe — input is entity-escaped first) ---
function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h4 class="font-semibold text-gray-800 mt-3 mb-1">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="font-bold text-gray-800 text-base mt-4 mb-1">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="font-bold text-gray-900 text-lg mt-4 mb-2">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    .replace(/^[─═]{3,}$/gm, '<hr class="my-3 border-gray-200"/>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal">$2</li>')
    .replace(/\n/g, '<br/>')
    .replace(/((?:<li class="ml-4 list-disc">.*?<\/li>(?:<br\/>)?)+)/g, '<ul class="my-1">$1</ul>')
    .replace(/((?:<li class="ml-4 list-decimal">.*?<\/li>(?:<br\/>)?)+)/g, '<ol class="my-1">$1</ol>');
}

// --- Clipboard with fallback ---
function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); return true; } catch { return false; }
  finally { document.body.removeChild(ta); }
}

// --- Haptic feedback (Android Chrome) ---
function haptic(ms = 50) { try { navigator.vibrate?.(ms); } catch {} }

// --- Share helper ---
async function shareText(title, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return true;
    } catch (e) { if (e.name !== 'AbortError') console.log('Share failed:', e); }
  }
  return false;
}

// --- Wake Lock helper ---
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return null;
  try {
    const lock = await navigator.wakeLock.request('screen');
    console.log('Wake lock acquired');
    return lock;
  } catch (e) { console.log('Wake lock failed:', e.message); return null; }
}

// --- Detect AudioWorklet support ---
function supportsAudioWorklet() {
  try { return typeof AudioWorkletNode !== 'undefined' && !isMobile; } catch { return false; }
}

// ===================================================
// Confirm Dialog Component
// ===================================================
function ConfirmDialog({ open, message, onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const handleKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', handleKey); };
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 animate-fadeIn" onClick={onCancel}>
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl space-y-4" onClick={e => e.stopPropagation()}>
        <p className="text-gray-800 text-sm leading-relaxed">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="btn btn-secondary flex-1 text-sm">Batal</button>
          <button onClick={onConfirm} className="btn btn-danger flex-1 text-sm">Hapus</button>
        </div>
      </div>
    </div>
  );
}

// ===================================================
// Back Button (consistent)
// ===================================================
function BackButton({ onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm font-medium transition-colors">
      <HiOutlineArrowLeft className="w-4 h-4" /> Kembali
    </button>
  );
}

// ===================================================
// Edit Modal Component
// ===================================================
// Google Drive-style folder tile: big rounded card with folder icon on the
// left, name + session count in the middle, and a 3-dot menu on the right
// for rename / delete. Click the tile body (not the menu) to open the folder.
function FolderTile({ folder, isOpen, onToggleMenu, onCloseMenu, onOpen, onRename, onDelete }) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onCloseMenu();
    };
    const onEsc = (e) => { if (e.key === 'Escape') onCloseMenu(); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [isOpen, onCloseMenu]);

  return (
    <div className="relative group">
      <button
        onDoubleClick={onOpen}
        onClick={onOpen}
        className="w-full flex items-center gap-2.5 px-3 py-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 hover:shadow-sm transition-all text-left"
        title={`Buka folder "${folder.name}"`}
      >
        <div className="w-9 h-9 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
          <HiOutlineFolder className="w-5 h-5 text-primary-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-800 truncate">{folder.name}</p>
          <p className="text-[11px] text-gray-400">{folder.session_count || 0} sesi</p>
        </div>
      </button>
      {/* 3-dot menu — absolute positioned, appears on hover or when open */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
        className={`absolute top-1/2 -translate-y-1/2 right-2 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all ${isOpen ? 'bg-gray-100 text-gray-700 opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        title="Opsi folder"
      >
        <HiOutlineDotsVertical className="w-4 h-4" />
      </button>
      {isOpen && (
        <div
          ref={menuRef}
          className="absolute z-20 top-11 right-2 w-40 bg-white border border-gray-200 rounded-lg shadow-lg py-1 animate-fadeIn"
        >
          <button
            onClick={onRename}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 text-left"
          >
            <HiOutlinePencil className="w-3.5 h-3.5 text-gray-400" />
            Ubah nama
          </button>
          <button
            onClick={onDelete}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 text-left"
          >
            <HiOutlineTrash className="w-3.5 h-3.5" />
            Hapus folder
          </button>
        </div>
      )}
    </div>
  );
}

// Modal "Tanya AI folder" — bertanya atas SEMUA transkrip di satu folder.
// Backend membaca seluruh transkrip bertahap (map-reduce, beberapa menit);
// progress via SSE, riwayat permanen di DB (tabel notulen_folder_qa) sehingga
// aman ditutup/refresh — jawaban tetap muncul di riwayat saat selesai.
function FolderAskModal({ folder, onClose }) {
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [question, setQuestion] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStep, setProgressStep] = useState('');
  const esRef = useRef(null);
  const bottomRef = useRef(null);
  // Ref pemutus siklus dependensi attachProgress ↔ loadHistory
  const loadHistoryRef = useRef(() => {});

  const attachProgress = useCallback((qaId) => {
    setProcessing(true);
    setProgress(0);
    setProgressStep('Memulai...');
    esRef.current?.close();
    const es = new EventSource(notulenFoldersAPI.askProgressUrl(folder.id, qaId));
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        setProgress(d.percent || 0);
        setProgressStep(d.step || '');
        if (d.done) {
          es.close();
          setProcessing(false);
          if (d.error) toast.error('Gagal menjawab: ' + (d.step || ''));
          loadHistoryRef.current();
        }
      } catch {}
    };
    // Jangan matikan processing di onerror — EventSource auto-reconnect,
    // dan hasil tetap aman di DB meski koneksi progress putus.
    es.onerror = () => {};
  }, [folder.id]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await notulenFoldersAPI.listQA(folder.id);
      const rows = res.data.data || [];
      setHistory(rows);
      // Resume: pertanyaan yang masih diproses (mis. setelah refresh) → sambung SSE lagi
      const active = rows.find(r => r.status === 'processing');
      if (active) attachProgress(active.id);
    } catch {
      toast.error('Gagal memuat riwayat');
    } finally {
      setLoadingHistory(false);
    }
  }, [folder.id, attachProgress]);
  loadHistoryRef.current = loadHistory;

  useEffect(() => {
    loadHistory();
    return () => esRef.current?.close();
  }, [loadHistory]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [history, processing]);

  async function handleAsk() {
    const q = question.trim();
    if (!q || processing) return;
    setQuestion('');
    try {
      const res = await notulenFoldersAPI.ask(folder.id, q);
      const qaId = res.data.data.qaId;
      setHistory(prev => [{ id: qaId, question: q, answer: null, status: 'processing', created_at: new Date().toISOString() }, ...prev]);
      attachProgress(qaId);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal mengirim pertanyaan');
      setQuestion(q);
    }
  }

  async function handleDelete(qaId) {
    if (!window.confirm('Hapus tanya-jawab ini?')) return;
    try {
      await notulenFoldersAPI.deleteQA(folder.id, qaId);
      setHistory(prev => prev.filter(r => r.id !== qaId));
    } catch {
      toast.error('Gagal menghapus');
    }
  }

  // history dari API terbaru-dulu; tampilkan kronologis (terlama di atas) ala chat
  const ordered = [...history].reverse();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 animate-fadeIn" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full h-[85vh] shadow-xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
          <HiOutlineChatAlt2 className="w-6 h-6 text-primary-500 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-gray-900 truncate">Tanya AI — {folder.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              AI membaca SEMUA transkrip di folder ini ({folder.session_count || 0} sesi) — satu jawaban butuh beberapa menit. Riwayat tersimpan; boleh ditutup saat menunggu.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400" title="Tutup">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        {/* Riwayat */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loadingHistory ? (
            <div className="text-center text-gray-400 text-sm mt-8 animate-pulse">Memuat riwayat...</div>
          ) : ordered.length === 0 ? (
            <div className="text-center text-gray-400 text-xs mt-8">
              <p>Belum ada pertanyaan untuk folder ini.</p>
              <p className="mt-1">Contoh: "Apa saja keputusan penting dari semua sesi?"</p>
            </div>
          ) : (
            ordered.map(item => (
              <div key={item.id} className="space-y-2">
                <div className="flex justify-end items-start gap-2 group">
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-all"
                    title="Hapus tanya-jawab ini"
                  >
                    <HiOutlineTrash className="w-4 h-4" />
                  </button>
                  <div className="max-w-[85%] px-3 py-2 rounded-xl rounded-br-sm text-sm bg-primary-600 text-white leading-relaxed">
                    {item.question}
                  </div>
                </div>
                <div className="flex justify-start">
                  {item.status === 'processing' ? (
                    <div className="bg-gray-100 text-gray-400 px-3 py-2 rounded-xl rounded-bl-sm text-sm animate-pulse">Sedang membaca transkrip...</div>
                  ) : item.status === 'error' ? (
                    <div className="bg-red-50 text-red-600 px-3 py-2 rounded-xl rounded-bl-sm text-xs">
                      Gagal: {item.error_message || 'kesalahan tidak diketahui'}
                    </div>
                  ) : (
                    <div
                      className="max-w-[92%] px-4 py-3 rounded-xl rounded-bl-sm text-sm bg-gray-100 text-gray-700 leading-relaxed overflow-x-auto"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(item.answer || '') }}
                    />
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Progress saat memproses */}
        {processing && (
          <div className="px-5 py-3 border-t border-gray-100 bg-primary-50/50">
            <div className="flex items-center justify-between text-xs text-gray-600 mb-1.5">
              <span className="truncate">{progressStep || 'Memproses...'}</span>
              <span className="font-semibold shrink-0 ml-2">{progress}%</span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-primary-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {/* Input */}
        <div className="p-3 border-t border-gray-100">
          <div className="flex gap-2">
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
              placeholder={processing ? 'Tunggu jawaban selesai...' : 'Tanya tentang semua transkrip di folder ini...'}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 outline-none"
              disabled={processing}
            />
            <button
              onClick={handleAsk}
              disabled={processing || !question.trim()}
              className="px-3 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white rounded-xl transition-all"
              title="Kirim pertanyaan"
            >
              {processing ? <HiOutlineRefresh className="w-4 h-4 animate-spin" /> : <HiOutlineArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditModal({ session, folders = [], onClose, onSaved }) {
  const [judul, setJudul] = useState(session.judul || '');
  const [subJudul, setSubJudul] = useState(session.sub_judul || '');
  const [pencatat, setPencatat] = useState(session.pencatat || '');
  const [instansi, setInstansi] = useState(session.instansi || '');
  const [tanggal, setTanggal] = useState(toDateInput(session.tanggal));
  const [status, setStatus] = useState(session.status || 'completed');
  const [folderId, setFolderId] = useState(session.folder_id ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', handleKey); };
  }, [onClose]);

  async function handleSave() {
    if (!judul.trim()) { toast.error('Judul wajib diisi'); return; }
    setSaving(true);
    try {
      await notulenAPI.updateSession(session.id, {
        judul, sub_judul: subJudul || null, pencatat, instansi, tanggal, status,
        folder_id: folderId === '' ? null : folderId,
      });
      toast.success('Sesi diperbarui');
      onSaved();
    } catch { toast.error('Gagal menyimpan'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 animate-fadeIn" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900">Edit Sesi</h3>
        <div className="space-y-3">
          <div>
            <label className="form-label">Judul</label>
            <input value={judul} onChange={e => setJudul(e.target.value)} className="form-input" />
          </div>
          <div>
            <label className="form-label">Sub Judul / Konteks <span className="text-gray-400 font-normal">(opsional)</span></label>
            <input value={subJudul} onChange={e => setSubJudul(e.target.value)} placeholder="Konteks tambahan untuk AI ringkasan" className="form-input" />
          </div>
          <div>
            <label className="form-label">Pencatat</label>
            <input value={pencatat} onChange={e => setPencatat(e.target.value)} className="form-input" />
          </div>
          <div>
            <label className="form-label">Instansi</label>
            <input value={instansi} onChange={e => setInstansi(e.target.value)} className="form-input" />
          </div>
          <div>
            <label className="form-label">Tanggal</label>
            <input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} className="form-input" />
          </div>
          <div>
            <label className="form-label">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className="form-input">
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div>
            <label className="form-label">Folder</label>
            <select value={folderId ?? ''} onChange={e => setFolderId(e.target.value)} className="form-input">
              <option value="">— Tanpa folder —</option>
              {folders.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="btn btn-secondary flex-1 text-sm">Batal</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary flex-1 text-sm flex items-center justify-center gap-1.5">
            {saving ? <HiOutlineRefresh className="w-4 h-4 animate-spin" /> : <HiOutlineCheck className="w-4 h-4" />}
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}

// ===================================================
// Main Page
// ===================================================
export default function NotulenAI() {
  const { user, isAdmin } = useAuth();
  const [view, setView] = useState('list');
  const [sessions, setSessions] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('recording,completed');
  const [sortField, setSortField] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [selected, setSelected] = useState(new Set());
  const [selectedSession, setSelectedSession] = useState(null);
  const [resumeSession, setResumeSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [editSession, setEditSession] = useState(null);
  const searchTimerRef = useRef(null);

  // Folders: state, derived counts, and the active filter (null = All,
  // 'none' = unfiled, <number> = specific folder).
  const [folders, setFolders] = useState([]);
  const [unfiledCount, setUnfiledCount] = useState(0);
  const [folderFilter, setFolderFilter] = useState(null);
  const [openFolderMenuId, setOpenFolderMenuId] = useState(null);
  const [showFolderAsk, setShowFolderAsk] = useState(false);

  const loadFolders = useCallback(async () => {
    try {
      const res = await notulenFoldersAPI.list();
      setFolders(res.data.data || []);
      setUnfiledCount(res.data.unfiled_count || 0);
    } catch {
      // Non-fatal — page still usable without the folder bar.
      console.error('Gagal memuat folder');
    }
  }, []);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  useEffect(() => { if (view === 'list') loadSessions(page); }, [view, page, statusFilter, sortField, sortOrder, folderFilter]);

  // Debounced search
  useEffect(() => {
    if (view !== 'list') return;
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setPage(1);
      loadSessions(1);
    }, 500);
    return () => clearTimeout(searchTimerRef.current);
  }, [search]);

  const loadSessions = async (pageNum) => {
    try {
      setLoading(true);
      // Drive-style: at root (folderFilter === null) show only sessions
      // that aren't in any folder — otherwise sessions would appear both
      // inside their folder and loose on the home view.
      const apiFolderId = folderFilter === null ? 'none' : folderFilter;
      const res = await notulenAPI.getSessions({
        page: pageNum || 1,
        limit: 10,
        search: search || undefined,
        status: statusFilter || undefined,
        sort: sortField,
        order: sortOrder,
        folder_id: apiFolderId,
      });
      const data = res.data;
      setSessions(data.data || []);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0 });
    } catch { toast.error('Gagal memuat sesi'); }
    finally { setLoading(false); }
  };

  // Inline folder create / rename / delete — called from the chip bar.
  const handleCreateFolder = async () => {
    const name = window.prompt('Nama folder:')?.trim();
    if (!name) return;
    try {
      await notulenFoldersAPI.create({ name });
      toast.success('Folder dibuat');
      loadFolders();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal membuat folder');
    }
  };

  const handleRenameFolder = async (folder) => {
    const name = window.prompt('Nama folder baru:', folder.name)?.trim();
    if (!name || name === folder.name) return;
    try {
      await notulenFoldersAPI.update(folder.id, { name });
      toast.success('Folder diperbarui');
      loadFolders();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal mengubah folder');
    }
  };

  const handleDeleteFolder = async (folder) => {
    if (!window.confirm(`Hapus folder "${folder.name}"? Sesi di dalamnya akan menjadi tanpa folder.`)) return;
    try {
      await notulenFoldersAPI.delete(folder.id);
      toast.success('Folder dihapus');
      if (folderFilter === folder.id) setFolderFilter(null);
      loadFolders();
      loadSessions(page);
    } catch {
      toast.error('Gagal menghapus folder');
    }
  };

  const openSession = async (id) => {
    try { setLoading(true); const res = await notulenAPI.getSession(id); setSelectedSession(res.data.data); setView('detail'); }
    catch { toast.error('Gagal memuat detail'); }
    finally { setLoading(false); }
  };

  const deleteSession = async (id) => {
    try { await notulenAPI.deleteSession(id); toast.success('Sesi dihapus'); setSelected(prev => { const n = new Set(prev); n.delete(id); return n; }); loadSessions(page); }
    catch { toast.error('Gagal menghapus'); }
  };

  const archiveSession = async (id) => {
    try { await notulenAPI.updateSession(id, { status: 'archived' }); toast.success('Sesi diarsipkan'); setSelected(prev => { const n = new Set(prev); n.delete(id); return n; }); loadSessions(page); }
    catch { toast.error('Gagal mengarsipkan'); }
  };

  const bulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    try {
      await notulenAPI.bulkDelete(ids);
      toast.success(`${ids.length} sesi dihapus`);
      setSelected(new Set());
      loadSessions(page);
    } catch { toast.error('Gagal menghapus'); }
  };

  const bulkArchive = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    try {
      await notulenAPI.bulkArchive(ids);
      toast.success(`${ids.length} sesi diarsipkan`);
      setSelected(new Set());
      loadSessions(page);
    } catch { toast.error('Gagal mengarsipkan'); }
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const FILTER_OPTIONS = [
    { label: 'Semua', value: 'recording,completed,archived' },
    { label: 'Aktif', value: 'recording,completed' },
    { label: 'Arsip', value: 'archived' },
  ];

  const SORT_OPTIONS = [
    { label: 'Terbaru', field: 'created_at', order: 'desc' },
    { label: 'Terlama', field: 'created_at', order: 'asc' },
    { label: 'Durasi', field: 'duration_seconds', order: 'desc' },
    { label: 'Segmen', field: 'segment_count', order: 'desc' },
  ];

  if (view === 'record') return <RecordingView onBack={() => { setResumeSession(null); setView('list'); }} user={user} resumeSession={resumeSession} />;
  if (view === 'upload') return <UploadView onBack={() => setView('list')} user={user} onDone={(id) => { openSession(id); }} />;
  if (view === 'import') return <ImportTranscriptView onBack={() => setView('list')} user={user} onDone={(id) => { openSession(id); }} />;
  if (view === 'youtube') return <YouTubeView onBack={() => setView('list')} user={user} onDone={(id) => { openSession(id); }} />;
  if (view === 'detail' && selectedSession) return <DetailView session={selectedSession} folders={folders} onBack={() => { setSelectedSession(null); setView('list'); }} isAdmin={isAdmin} />;

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-red-200">
            <HiOutlineMicrophone className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Notulen AI</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {pagination.total || sessions.length} sesi
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setView('youtube')}
            className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl transition-all"
          >
            <HiOutlineFilm className="w-4 h-4" />
            <span className="hidden sm:inline">YouTube</span>
          </button>
          <button
            onClick={() => setView('import')}
            className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl transition-all"
          >
            <HiOutlineDocumentDuplicate className="w-4 h-4" />
            <span className="hidden sm:inline">Import</span>
          </button>
          <button
            onClick={() => setView('upload')}
            className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl transition-all"
          >
            <HiOutlineUpload className="w-4 h-4" />
            <span className="hidden sm:inline">Upload</span>
          </button>
          <button
            onClick={() => setView('record')}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl shadow-sm shadow-red-200 transition-all hover:shadow-md"
          >
            <HiOutlineMicrophone className="w-4 h-4" />
            <span className="hidden sm:inline">Rekam Live</span>
            <span className="sm:hidden">Rekam</span>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <HiOutlineSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Cari judul, pencatat..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 outline-none transition-all bg-white"
        />
      </div>

      {/* Filter Pills + Sort */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          {FILTER_OPTIONS.map(f => (
            <button
              key={f.value}
              onClick={() => { setStatusFilter(f.value); setPage(1); setSelected(new Set()); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                statusFilter === f.value
                  ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-200 shadow-sm'
                  : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={`${sortField}:${sortOrder}`}
          onChange={e => {
            const opt = SORT_OPTIONS.find(o => `${o.field}:${o.order}` === e.target.value);
            if (opt) { setSortField(opt.field); setSortOrder(opt.order); setPage(1); }
          }}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
        >
          {SORT_OPTIONS.map(o => (
            <option key={`${o.field}:${o.order}`} value={`${o.field}:${o.order}`}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Folders — Drive-style grid. Shown only at "root"; when inside a
          specific folder the grid collapses and a breadcrumb appears above
          the sessions list instead. */}
      {folderFilter === null && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Folder</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
            {folders.map(f => (
              <FolderTile
                key={f.id}
                folder={f}
                isOpen={openFolderMenuId === f.id}
                onToggleMenu={() => setOpenFolderMenuId(openFolderMenuId === f.id ? null : f.id)}
                onCloseMenu={() => setOpenFolderMenuId(null)}
                onOpen={() => { setFolderFilter(f.id); setPage(1); }}
                onRename={() => { setOpenFolderMenuId(null); handleRenameFolder(f); }}
                onDelete={() => { setOpenFolderMenuId(null); handleDeleteFolder(f); }}
              />
            ))}
            {/* "Create folder" tile — always at the end, dashed border to signal it's an action */}
            <button
              onClick={handleCreateFolder}
              className="group flex items-center gap-2.5 px-3 py-3 rounded-xl border border-dashed border-gray-300 hover:border-primary-400 hover:bg-primary-50/40 text-gray-400 hover:text-primary-600 transition-colors"
              title="Buat folder baru"
            >
              <div className="w-9 h-9 rounded-lg bg-gray-100 group-hover:bg-primary-100 flex items-center justify-center flex-shrink-0 transition-colors">
                <HiOutlinePlusCircle className="w-5 h-5" />
              </div>
              <span className="text-sm font-medium truncate">Folder baru</span>
            </button>
          </div>
        </div>
      )}

      {/* Breadcrumb — shown when viewing inside a specific folder or the
          "Tanpa folder" bucket. Clicking the home crumb clears the filter. */}
      {folderFilter !== null && (
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => { setFolderFilter(null); setPage(1); }}
            className="inline-flex items-center gap-1 text-gray-500 hover:text-primary-600 transition-colors"
          >
            <HiOutlineHome className="w-4 h-4" />
            Beranda
          </button>
          <span className="text-gray-300">›</span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-gray-800">
            <HiOutlineFolderOpen className="w-4 h-4 text-primary-500" />
            {folders.find(f => f.id === folderFilter)?.name || 'Folder'}
          </span>
          {typeof folderFilter === 'number' && (
            <button
              onClick={() => setShowFolderAsk(true)}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-xs font-medium transition-all"
              title="Tanya AI tentang semua transkrip di folder ini"
            >
              <HiOutlineChatAlt2 className="w-4 h-4" /> Tanya AI
            </button>
          )}
        </div>
      )}

      {/* Session List */}
      {loading ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-1/3" />
          {[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl" />)}
        </div>
      ) : sessions.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <HiOutlineMicrophone className="w-7 h-7 text-gray-300" />
          </div>
          <p className="text-gray-500 font-medium">Belum ada sesi notulen</p>
          <p className="text-xs text-gray-400 mt-1">Rekam langsung, upload audio, atau import transkrip</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map(s => (
            <div
              key={s.id}
              className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-3 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group"
            >
              {/* Checkbox */}
              <label className="flex items-center shrink-0" onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggleSelect(s.id)}
                  className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                />
              </label>

              {/* Content — clickable */}
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openSession(s.id)}>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-900 truncate text-sm">{s.judul}</h3>
                  {s.sub_judul && <p className="text-xs text-gray-400 truncate">{s.sub_judul}</p>}
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[s.status]}`}>{s.status}</span>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400 flex-wrap">
                  <span>{formatTanggal(s.tanggal)}</span>
                  <span>{s.pencatat}</span>
                  {s.duration_seconds > 0 && (
                    <span className="flex items-center gap-0.5">
                      <HiOutlineClock className="w-3 h-3" />{formatDuration(s.duration_seconds)}
                    </span>
                  )}
                  <span>{s.segment_count || 0} segmen</span>
                  {isAdmin && s.user_name && <span className="text-primary-500 font-medium">{s.user_name}</span>}
                </div>
              </div>

              {/* Resume Recording button — for completed/recording sessions */}
              {(s.status === 'completed' || s.status === 'recording') && (
                <button
                  onClick={(e) => { e.stopPropagation(); setResumeSession(s); setView('record'); }}
                  className="p-2 text-gray-300 hover:text-green-600 active:text-green-700 transition-colors rounded-lg hover:bg-green-50 min-w-[36px] min-h-[36px] flex items-center justify-center shrink-0"
                  title="Lanjutkan Rekam"
                >
                  <HiOutlineMicrophone className="w-4 h-4" />
                </button>
              )}

              {/* Edit button */}
              <button
                onClick={(e) => { e.stopPropagation(); setEditSession(s); }}
                className="p-2 text-gray-300 hover:text-primary-600 active:text-primary-700 transition-colors rounded-lg hover:bg-primary-50 min-w-[36px] min-h-[36px] flex items-center justify-center shrink-0"
                title="Edit"
              >
                <HiOutlinePencil className="w-4 h-4" />
              </button>

              {/* Archive button — only for non-archived */}
              {s.status !== 'archived' && (
                <button
                  onClick={(e) => { e.stopPropagation(); archiveSession(s.id); }}
                  className="p-2 text-gray-300 hover:text-amber-600 active:text-amber-700 transition-colors rounded-lg hover:bg-amber-50 min-w-[36px] min-h-[36px] flex items-center justify-center shrink-0"
                  title="Arsipkan"
                >
                  <HiOutlineArchive className="w-4 h-4" />
                </button>
              )}

              {/* Delete button */}
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(s.id); }}
                className="p-2 text-gray-300 hover:text-red-500 active:text-red-600 transition-colors rounded-lg hover:bg-red-50 min-w-[36px] min-h-[36px] flex items-center justify-center shrink-0"
                title="Hapus permanen"
              >
                <HiOutlineTrash className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <HiOutlineChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-500 font-medium">
            Hal {pagination.page || page} dari {pagination.totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
            disabled={page >= pagination.totalPages}
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <HiOutlineChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Bulk Action Bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-gray-900 text-white px-5 py-3 rounded-2xl shadow-xl animate-fadeIn">
          <span className="text-sm font-medium">{selected.size} dipilih</span>
          <button
            onClick={bulkArchive}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-xl transition-all"
          >
            <HiOutlineArchive className="w-4 h-4" /> Arsipkan
          </button>
          <button
            onClick={() => setConfirmBulkDelete(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-all"
          >
            <HiOutlineTrash className="w-4 h-4" /> Hapus
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-gray-400 hover:text-white text-xs font-medium transition-colors"
          >
            Batal
          </button>
        </div>
      )}

      {/* Edit Modal */}
      {editSession && (
        <EditModal
          session={editSession}
          folders={folders}
          onClose={() => setEditSession(null)}
          onSaved={() => { setEditSession(null); loadSessions(page); loadFolders(); }}
        />
      )}

      {/* Tanya AI folder — bertanya atas semua transkrip di folder yang sedang dibuka */}
      {showFolderAsk && typeof folderFilter === 'number' && (
        <FolderAskModal
          folder={folders.find(f => f.id === folderFilter) || { id: folderFilter, name: 'Folder' }}
          onClose={() => setShowFolderAsk(false)}
        />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        message="Yakin ingin menghapus sesi notulen ini? Data transkrip dan ringkasan akan hilang."
        onConfirm={() => { deleteSession(confirmDelete); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        message={`Yakin ingin menghapus ${selected.size} sesi notulen? Data transkrip dan ringkasan akan hilang.`}
        onConfirm={() => { bulkDelete(); setConfirmBulkDelete(false); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />
    </div>
  );
}

// ===================================================
// ── YouTube Progress Panel ──────────────────────────────────────────────────
// Ranges match backend progress mapping:
// 5-20: download | 20-35: convert | 35-40: split | 40-95: transcribe | 95-100: save
const YT_PHASES = [
  { key: 'download',   label: 'Unduh',       icon: HiOutlineCloudDownload,    min: 5,  max: 20  },
  { key: 'convert',    label: 'Konversi',     icon: HiOutlineSwitchHorizontal, min: 20, max: 35  },
  { key: 'split',      label: 'Pecah',        icon: HiOutlineScissors,         min: 35, max: 40  },
  { key: 'transcribe', label: 'Transkripsi',  icon: HiOutlineMicrophone,       min: 40, max: 95  },
  { key: 'save',       label: 'Simpan',       icon: HiOutlineSaveAs,           min: 95, max: 100 },
];

function detectPhase(percent, step) {
  const s = (step || '').toLowerCase();
  if (s.includes('mengunduh'))                                    return 'download';
  if (s.includes('mengonversi') || s.includes('konversi'))       return 'convert';
  if (s.includes('memecah'))                                     return 'split';
  if (s.includes('transkripsi') || s.includes('chunk') || s.includes('memproses')) return 'transcribe';
  if (s.includes('menyimpan') || percent >= 95)                  return 'save';
  // fallback: pick phase by range
  return YT_PHASES.find(p => percent >= p.min && percent < p.max)?.key ?? 'download';
}

const YtProgressPanel = memo(function YtProgressPanel({ percent, step }) {
  const activeKey = detectPhase(percent, step);
  const activeIdx = YT_PHASES.findIndex(p => p.key === activeKey);
  const activePhase = YT_PHASES[activeIdx];

  // Mini percent within current phase (for sub-label)
  const phaseLocal = activePhase
    ? Math.min(100, Math.round(((percent - activePhase.min) / (activePhase.max - activePhase.min)) * 100))
    : 0;

  return (
    <div className="space-y-4 p-4 bg-gray-50 rounded-2xl border border-gray-100">
      {/* Step strip */}
      <div className="flex items-center">
        {YT_PHASES.map((phase, i) => {
          const done   = activeIdx > i;
          const active = activeIdx === i;
          const Icon   = phase.icon;
          return (
            <div key={phase.key} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-500 ${
                  done   ? 'bg-primary-500 text-white shadow-sm shadow-primary-200' :
                  active ? 'bg-white text-primary-600 ring-2 ring-primary-400 shadow-md shadow-primary-100' :
                           'bg-gray-100 text-gray-300'
                }`}>
                  {done
                    ? <HiOutlineCheck className="w-4 h-4" />
                    : <Icon className={`w-4 h-4 ${active ? 'animate-pulse' : ''}`} />
                  }
                </div>
                <span className={`text-[10px] font-semibold whitespace-nowrap ${
                  active ? 'text-primary-600' : done ? 'text-gray-400' : 'text-gray-300'
                }`}>{phase.label}</span>
              </div>
              {i < YT_PHASES.length - 1 && (
                <div className={`h-0.5 flex-1 mx-1 mb-4 rounded-full transition-all duration-700 ${
                  done ? 'bg-primary-400' : 'bg-gray-200'
                }`} />
              )}
            </div>
          );
        })}
      </div>

      {/* rc-progress bar */}
      <ProgressLine
        percent={percent}
        strokeWidth={6}
        strokeColor={{ '0%': '#a5b4fc', '50%': '#6366f1', '100%': '#4338ca' }}
        trailColor="#e5e7eb"
        strokeLinecap="round"
      />

      {/* Step text + percent */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-600 truncate">{step || 'Memulai...'}</p>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {activePhase && activeKey !== 'save' && (
            <span className="text-[10px] text-gray-400 tabular-nums">
              fase {phaseLocal}%
            </span>
          )}
          <span className="text-sm font-bold text-primary-700 tabular-nums">{percent}%</span>
        </div>
      </div>
    </div>
  );
});

// YouTubeView — import dari YouTube (CC atau audio)
// ===================================================
function YouTubeView({ onBack, user, onDone }) {
  const jobIdRef = useRef(null);
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('audio');
  const [judul, setJudul] = useState('');
  const [subJudul, setSubJudul] = useState('');
  const [pencatat, setPencatat] = useState(user?.name || '');
  const [instansi, setInstansi] = useState('BPS Provinsi Maluku Utara');
  const [tanggal, setTanggal] = useState(toDateInput(new Date()));
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStep, setProgressStep] = useState('');
  const [error, setError] = useState('');

  const YOUTUBE_RE = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?|live\/|shorts\/|embed\/)|youtu\.be\/)/;

  async function handleSubmit() {
    if (!YOUTUBE_RE.test(url)) { toast.error('URL YouTube tidak valid'); return; }
    if (!judul.trim()) { toast.error('Isi judul terlebih dahulu'); return; }

    setSubmitting(true);
    setProgress(0);
    setProgressStep('Memulai...');
    setError('');
    jobIdRef.current = null;

    let jobId;
    try {
      const res = await notulenAPI.importYoutube({ url, method, judul, sub_judul: subJudul || undefined, pencatat, instansi, tanggal });
      jobId = res.data.data.jobId;
      jobIdRef.current = jobId;
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal memulai import');
      setSubmitting(false);
      return;
    }

    const MAX_SSE_RETRIES = 4;
    let sseAttempt = 0;

    const connectSSE = () => {
      const es = new EventSource(notulenAPI.youtubeProgressUrl(jobId));

      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          setProgress(d.percent || 0);
          setProgressStep(d.step || '');
          if (d.done && !d.error) {
            es.close();
            jobIdRef.current = null;
            toast.success('Import YouTube selesai!');
            onDone(d.sessionId);
          } else if (d.error) {
            es.close();
            jobIdRef.current = null;
            setError(d.step || 'Terjadi kesalahan');
            setSubmitting(false);
          }
        } catch {}
      };

      es.onerror = () => {
        es.close();
        sseAttempt++;
        if (sseAttempt < MAX_SSE_RETRIES) {
          const delay = 2000 * Math.pow(2, sseAttempt - 1);
          setProgressStep(`Koneksi terputus, menyambung ulang (${sseAttempt}/${MAX_SSE_RETRIES})...`);
          setTimeout(connectSSE, delay);
        } else {
          setError(`Koneksi progress terputus setelah ${MAX_SSE_RETRIES} percobaan. Import mungkin masih berjalan di server.`);
          setSubmitting(false);
          jobIdRef.current = null;
        }
      };
    };

    connectSSE();
  }

  async function handleCancel() {
    const jobId = jobIdRef.current;
    if (!jobId) return;
    try {
      await notulenAPI.cancelYoutubeJob(jobId);
      toast('Import dibatalkan');
    } catch { /* ignore — SSE onerror will handle UI update */ }
    jobIdRef.current = null;
    setSubmitting(false);
    setError('');
    setProgress(0);
    setProgressStep('');
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      <BackButton onClick={onBack} />

      <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-pink-600 flex items-center justify-center shadow-lg shadow-red-200">
            <HiOutlineFilm className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Import dari YouTube</h2>
            <p className="text-xs text-gray-400 mt-0.5">Ambil transkrip dari subtitle CC atau download audio</p>
          </div>
        </div>

        <div>
          <label className="form-label">URL Video YouTube</label>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            className="form-input font-mono text-sm"
            disabled={submitting}
          />
        </div>

        <div>
          <label className="form-label">Metode Pengambilan Teks</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
            {[
              { value: 'cc', label: 'Subtitle / CC', desc: 'Cepat, gunakan teks yang sudah ada di video', icon: HiOutlineDocumentText },
              { value: 'audio', label: 'Download Audio', desc: 'Akurat, transkripsi ulang via Whisper AI', icon: HiOutlineMicrophone },
            ].map(opt => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                  method === opt.value
                    ? 'border-primary-400 bg-primary-50'
                    : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                <input
                  type="radio"
                  value={opt.value}
                  checked={method === opt.value}
                  onChange={() => setMethod(opt.value)}
                  className="mt-0.5 text-primary-600 focus:ring-primary-500"
                  disabled={submitting}
                />
                <div>
                  <p className="text-sm font-semibold text-gray-800">{opt.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="form-label">Judul</label>
            <input value={judul} onChange={e => setJudul(e.target.value)} placeholder="Judul sesi notulen" className="form-input" disabled={submitting} />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Sub Judul <span className="text-gray-400 font-normal">(opsional)</span></label>
            <input value={subJudul} onChange={e => setSubJudul(e.target.value)} placeholder="Konteks untuk AI ringkasan" className="form-input" disabled={submitting} />
          </div>
          <div>
            <label className="form-label">Pencatat</label>
            <input value={pencatat} onChange={e => setPencatat(e.target.value)} className="form-input" disabled={submitting} />
          </div>
          <div>
            <label className="form-label">Instansi</label>
            <input value={instansi} onChange={e => setInstansi(e.target.value)} className="form-input" disabled={submitting} />
          </div>
          <div>
            <label className="form-label">Tanggal</label>
            <input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} className="form-input" disabled={submitting} />
          </div>
        </div>

        {submitting && (
          <YtProgressPanel percent={progress} step={progressStep} />
        )}

        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={submitting || !url || !judul.trim()}
            className="flex-1 btn btn-primary flex items-center justify-center gap-2"
          >
            {submitting
              ? <><HiOutlineRefresh className="w-4 h-4 animate-spin" /> Memproses...</>
              : <><HiOutlineFilm className="w-4 h-4" /> Mulai Import</>
            }
          </button>
          {submitting && (
            <button
              onClick={handleCancel}
              className="px-4 py-2 bg-gray-100 hover:bg-red-50 hover:text-red-600 text-gray-600 text-sm font-semibold rounded-xl border border-gray-200 transition-all"
            >
              Batal
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ===================================================
// ImportTranscriptView — import text or subtitle file
// ===================================================
function ImportTranscriptView({ onBack, user, onDone }) {
  const [activeTab, setActiveTab] = useState('paste');
  const [judul, setJudul] = useState('');
  const [subJudul, setSubJudul] = useState('');
  const [pencatat, setPencatat] = useState(user?.name || '');
  const [instansi, setInstansi] = useState('BPS Provinsi Maluku Utara');
  const [tanggal, setTanggal] = useState(toDateInput(new Date()));
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [txtFile, setTxtFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handlePasteSubmit() {
    if (!judul.trim()) { toast.error('Isi judul'); return; }
    if (!text.trim()) { toast.error('Isi teks transkrip'); return; }
    setSubmitting(true);
    try {
      const res = await notulenAPI.importText({ judul, sub_judul: subJudul || undefined, pencatat, instansi, tanggal, text });
      toast.success(`Berhasil! ${res.data.data.segmentCount} segmen diimpor`);
      onDone(res.data.data.sessionId);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal import');
    } finally { setSubmitting(false); }
  }

  async function handleSubtitleSubmit() {
    if (!judul.trim()) { toast.error('Isi judul'); return; }
    if (!file) { toast.error('Pilih file subtitle'); return; }
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('subtitle', file);
      formData.append('judul', judul);
      if (subJudul) formData.append('sub_judul', subJudul);
      formData.append('pencatat', pencatat);
      formData.append('instansi', instansi);
      formData.append('tanggal', tanggal);
      const res = await notulenAPI.importSubtitle(formData);
      toast.success(`Berhasil! ${res.data.data.segmentCount} segmen diimpor`);
      onDone(res.data.data.sessionId);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal import subtitle');
    } finally { setSubmitting(false); }
  }

  async function handleTxtSubmit() {
    if (!judul.trim()) { toast.error('Isi judul'); return; }
    if (!txtFile) { toast.error('Pilih file .txt'); return; }
    setSubmitting(true);
    try {
      const text = await txtFile.text();
      if (!text.trim()) { toast.error('File kosong'); setSubmitting(false); return; }
      const res = await notulenAPI.importText({ judul, sub_judul: subJudul || undefined, pencatat, instansi, tanggal, text });
      toast.success(`Berhasil! ${res.data.data.segmentCount} segmen diimpor`);
      onDone(res.data.data.sessionId);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal import file .txt');
    } finally { setSubmitting(false); }
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      <BackButton onClick={onBack} />

      <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-200">
            <HiOutlineDocumentDuplicate className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Import Transkrip</h2>
            <p className="text-xs text-gray-400 mt-0.5">Paste teks atau upload file subtitle (.srt/.vtt)</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1">
          {[
            { key: 'paste', label: 'Paste Teks' },
            { key: 'subtitle', label: 'Upload Subtitle' },
            { key: 'txt', label: 'File .txt' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-200 shadow-sm'
                  : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Metadata Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="form-label">Judul</label>
            <input value={judul} onChange={e => setJudul(e.target.value)} placeholder="Contoh: Rapat Koordinasi" className="form-input" />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Sub Judul / Konteks <span className="text-gray-400 font-normal">(opsional)</span></label>
            <input value={subJudul} onChange={e => setSubJudul(e.target.value)} placeholder="Deskripsi singkat untuk membantu AI meringkas" className="form-input" />
          </div>
          <div>
            <label className="form-label">Pencatat</label>
            <input value={pencatat} onChange={e => setPencatat(e.target.value)} className="form-input" />
          </div>
          <div>
            <label className="form-label">Tanggal</label>
            <input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} className="form-input" />
          </div>
        </div>

        {/* Paste Tab */}
        {activeTab === 'paste' && (
          <div>
            <label className="form-label">Teks Transkrip</label>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={"Paste teks transkrip di sini...\n\nFormat bebas — satu paragraf per segmen, atau gunakan format:\n[00:00] Teks segmen pertama\n[01:30] Teks segmen kedua"}
              rows={10}
              className="form-input resize-y min-h-[200px]"
            />
            <p className="text-xs text-gray-400 mt-1">{text.length} karakter</p>
          </div>
        )}

        {/* Subtitle Tab */}
        {activeTab === 'subtitle' && (
          <div>
            <label className="form-label">File Subtitle</label>
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-primary-400 transition-colors bg-gray-50/50">
              <HiOutlineCloudUpload className="w-8 h-8 text-gray-300 mb-2" />
              <span className="text-sm text-gray-500">{file ? file.name : 'Klik untuk pilih file .srt atau .vtt'}</span>
              {file && <span className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(1)} KB</span>}
              <input type="file" accept=".srt,.vtt" onChange={e => setFile(e.target.files[0])} className="hidden" />
            </label>
          </div>
        )}

        {/* TXT Tab */}
        {activeTab === 'txt' && (
          <div>
            <label className="form-label">File Teks (.txt)</label>
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-primary-400 transition-colors bg-gray-50/50">
              <HiOutlineDocumentText className="w-8 h-8 text-gray-300 mb-2" />
              <span className="text-sm text-gray-500">{txtFile ? txtFile.name : 'Klik untuk pilih file .txt'}</span>
              {txtFile && <span className="text-xs text-gray-400 mt-1">{(txtFile.size / 1024).toFixed(1)} KB</span>}
              <input type="file" accept=".txt,text/plain" onChange={e => setTxtFile(e.target.files[0])} className="hidden" />
            </label>
            <p className="text-xs text-gray-400 mt-2">Format bebas — teks akan diproses sebagai satu transkrip tanpa timestamp</p>
          </div>
        )}

        {/* Submit */}
        <button
          onClick={activeTab === 'paste' ? handlePasteSubmit : activeTab === 'subtitle' ? handleSubtitleSubmit : handleTxtSubmit}
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white font-semibold rounded-xl shadow-sm shadow-primary-200 transition-all text-sm"
        >
          {submitting
            ? <><HiOutlineRefresh className="w-5 h-5 animate-spin" /> Mengimpor...</>
            : <><HiOutlineDocumentDuplicate className="w-5 h-5" /> Import Transkrip</>
          }
        </button>
      </div>
    </div>
  );
}

// ===================================================
// UploadView — upload recorded audio file
// ===================================================
function UploadView({ onBack, user, onDone }) {
  const [judul, setJudul] = useState('');
  const [subJudul, setSubJudul] = useState('');
  const [pencatat, setPencatat] = useState(user?.name || '');
  const [instansi, setInstansi] = useState('BPS Provinsi Maluku Utara');
  const [tanggal, setTanggal] = useState(toDateInput(new Date()));
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef(null);

  async function handleUpload() {
    if (!judul.trim()) { toast.error('Isi judul'); return; }
    if (!file) { toast.error('Pilih file audio'); return; }
    if (file.size > 25 * 1024 * 1024) { toast.error(`File terlalu besar (${(file.size / 1024 / 1024).toFixed(1)}MB). Maks 25MB.`); return; }

    const formData = new FormData();
    formData.append('audio', file);
    formData.append('judul', judul);
    if (subJudul) formData.append('sub_judul', subJudul);
    formData.append('pencatat', pencatat);
    formData.append('instansi', instansi);
    formData.append('tanggal', tanggal);

    setUploading(true);
    setProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;

    // Simulated transcription progress: after upload (50%), animate bar toward 94%
    // so it doesn't look frozen during the ~30s Groq Whisper call.
    let simTimer = null;
    const startSimProgress = (currentPct) => {
      let pct = currentPct;
      simTimer = setInterval(() => {
        pct = Math.min(94, pct + 1);
        setProgress(pct);
      }, 1500); // +1% every 1.5s → reaches 94% in ~66s
    };

    try {
      const res = await notulenAPI.uploadAudio(formData, (e) => {
        if (e.total) {
          const uploadPct = Math.round((e.loaded / e.total) * 50);
          setProgress(uploadPct);
          if (e.loaded >= e.total && !simTimer) startSimProgress(50);
        }
      }, controller.signal);
      clearInterval(simTimer);
      setProgress(100);
      toast.success(`Berhasil! ${res.data.data.segmentCount} segmen, ${formatDuration(res.data.data.duration)}`);
      setTimeout(() => onDone(res.data.data.sessionId), 500);
    } catch (err) {
      clearInterval(simTimer);
      if (err.name === 'CanceledError' || controller.signal.aborted) {
        toast('Upload dibatalkan');
      } else {
        toast.error(err.response?.data?.message || 'Gagal upload');
      }
    } finally { setUploading(false); abortRef.current = null; }
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      <BackButton onClick={onBack} />

      <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-200">
            <HiOutlineUpload className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Upload Rekaman Audio</h2>
            <p className="text-xs text-gray-400 mt-0.5">MP3, M4A, WAV, WebM, MP4 — maks 25MB</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="form-label">Judul</label>
            <input value={judul} onChange={e => setJudul(e.target.value)} placeholder="Contoh: Rapat Koordinasi" className="form-input" />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Sub Judul / Konteks <span className="text-gray-400 font-normal">(opsional)</span></label>
            <input value={subJudul} onChange={e => setSubJudul(e.target.value)} placeholder="Deskripsi singkat untuk membantu AI meringkas" className="form-input" />
          </div>
          <div>
            <label className="form-label">Pencatat</label>
            <input value={pencatat} onChange={e => setPencatat(e.target.value)} className="form-input" />
          </div>
          <div>
            <label className="form-label">Tanggal</label>
            <input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} className="form-input" />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">File Audio</label>
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-primary-400 transition-colors bg-gray-50/50">
              <HiOutlineCloudUpload className="w-8 h-8 text-gray-300 mb-2" />
              <span className="text-sm text-gray-500">{file ? file.name : 'Klik untuk pilih file audio'}</span>
              {file && <span className="text-xs text-gray-400 mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB</span>}
              <input type="file" accept="audio/*,.mp3,.m4a,.wav,.webm,.mp4,.ogg,.flac" onChange={e => setFile(e.target.files[0])} className="hidden" />
            </label>
          </div>
        </div>

        {uploading && (
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div className="bg-primary-600 h-2 rounded-full transition-all duration-300" style={{ width: progress + '%' }} />
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleUpload}
            disabled={uploading || !file}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white font-semibold rounded-xl shadow-sm shadow-primary-200 transition-all text-sm"
          >
            {uploading
              ? <><HiOutlineRefresh className="w-5 h-5 animate-spin" /> {progress < 50 ? `Mengupload... ${Math.round(progress * 2)}%` : `Mentranskrip... ${progress}%`}</>
              : <><HiOutlineUpload className="w-5 h-5" /> Upload & Transkrip</>
            }
          </button>
          {uploading && (
            <button onClick={() => abortRef.current?.abort()} className="btn btn-secondary px-4">
              <HiOutlineX className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ===================================================
// RecordingView — live transcription with Wake Lock + MediaRecorder fallback
// ===================================================
function RecordingView({ onBack, user, resumeSession }) {
  const [phase, setPhase] = useState('setup');
  const [judul, setJudul] = useState(resumeSession?.judul || '');
  const [subJudul, setSubJudul] = useState(resumeSession?.sub_judul || '');
  const [pencatat, setPencatat] = useState(resumeSession?.pencatat || user?.name || '');
  const [instansi, setInstansi] = useState(resumeSession?.instansi || 'BPS Provinsi Maluku Utara');
  const [tanggal, setTanggal] = useState(toDateInput(resumeSession?.tanggal) || toDateInput(new Date()));
  const [audioSource, setAudioSource] = useState(isMobile ? 'mic' : 'both');
  const [segments, setSegments] = useState([]);
  const [duration, setDuration] = useState(resumeSession?.duration_seconds || 0);
  const [isPaused, setIsPaused] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [transcriptPaused, setTranscriptPaused] = useState(false);
  const [queueDepth, setQueueDepth] = useState(0);
  const [showAskPanel, setShowAskPanel] = useState(false);
  const [askInput, setAskInput] = useState('');
  const [askLoading, setAskLoading] = useState(false);
  const [askHistory, setAskHistory] = useState([]); // [{q, a}]
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryProgress, setSummaryProgress] = useState(0);
  const [summaryStep, setSummaryStep] = useState('');
  const [summary, setSummary] = useState('');
  const [editingSummary, setEditingSummary] = useState(false);
  const [draftSummary, setDraftSummary] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);
  const [sessionId, setSessionId] = useState(resumeSession?.id || null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const levelAnimRef = useRef(null);
  const micStreamRef = useRef(null);
  const displayStreamRef = useRef(null);
  const workletRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const pcmBufferRef = useRef([]);
  const sendIntervalRef = useRef(null);
  const durationIntervalRef = useRef(null);
  const startTimeRef = useRef(null);
  const pausedDurationRef = useRef(0);
  const pauseStartRef = useRef(null);
  const pendingRef = useRef(0);
  const transcriptRef = useRef(null);
  const wakeLockRef = useRef(null);
  const isPausedRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const isRecordingRef = useRef(false);
  const sessionMetaRef = useRef(null);
  const sessionIdRef = useRef(resumeSession?.id || null);
  const visibilityHandlerRef = useRef(null);
  const offlineChunkBuffer = useRef([]);
  const segmentBatchRef = useRef([]);
  const batchTimerRef = useRef(null);

  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  // Mirror sessionId into a ref so the long-lived WS reconnect closure always
  // sees the current session id (state would be stale inside the closure).
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => { setIsOnline(false); if (isRecordingRef.current) toast.error('Koneksi internet terputus!'); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  // Load existing segments when resuming a completed session
  useEffect(() => {
    if (!resumeSession?.id) return;
    notulenAPI.getSession(resumeSession.id).then(res => {
      const data = res.data?.data;
      if (!data?.segments) return;
      const loaded = data.segments.map(s => {
        const mm = Math.floor(s.timestamp_seconds / 60).toString().padStart(2, '0');
        const ss = Math.floor(s.timestamp_seconds % 60).toString().padStart(2, '0');
        return { id: s.id, ts: `${mm}:${ss}`, text: s.text };
      });
      setSegments(loaded);
      if (data.summary) setSummary(data.summary);
    }).catch(() => {});
  }, [resumeSession?.id]);

  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [segments]);

  useEffect(() => () => cleanup(), []);

  function cleanup() {
    isRecordingRef.current = false;
    clearInterval(sendIntervalRef.current);
    clearInterval(durationIntervalRef.current);
    clearTimeout(reconnectTimerRef.current);
    clearTimeout(batchTimerRef.current);
    cancelAnimationFrame(levelAnimRef.current);
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    if (displayStreamRef.current) { displayStreamRef.current.getTracks().forEach(t => t.stop()); displayStreamRef.current = null; }
    if (audioContextRef.current) { try { audioContextRef.current.close(); } catch {} audioContextRef.current = null; }
    if (mediaRecorderRef.current) { try { if (mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop(); } catch {} mediaRecorderRef.current = null; }
    if (wsRef.current) { wsRef.current._noReconnect = true; try { wsRef.current.close(); } catch {} wsRef.current = null; }
    if (wakeLockRef.current) { wakeLockRef.current.release(); wakeLockRef.current = null; }
    if (visibilityHandlerRef.current) { document.removeEventListener('visibilitychange', visibilityHandlerRef.current); visibilityHandlerRef.current = null; }
    workletRef.current = null;
    reconnectAttemptsRef.current = 0;
  }

  function connectWebSocket(isReconnect = false) {
    const ws = new WebSocket(getNotulenWsUrl());
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      reconnectAttemptsRef.current = 0;
      if (isReconnect && sessionMetaRef.current) {
        // Re-attach to the existing DB session. A reconnected WS is a NEW backend
        // connection with NO in-memory sessionState, so the old `resume` command
        // was a no-op and the backend silently dropped ALL audio after a blip.
        // resume_session rebuilds state from the DB and continues timestamps from
        // the last saved segment. Fall back to `start` only if we have no id yet.
        if (sessionIdRef.current) {
          ws.send(JSON.stringify({ command: 'resume_session', sessionId: sessionIdRef.current }));
        } else {
          ws.send(JSON.stringify({ command: 'start', ...sessionMetaRef.current }));
        }
        toast.success('Koneksi tersambung kembali', { id: 'ws-reconnect' });
      } else if (resumeSession?.id) {
        // Attach to existing completed session instead of creating a new one
        ws.send(JSON.stringify({ command: 'resume_session', sessionId: resumeSession.id }));
      } else {
        ws.send(JSON.stringify({ command: 'start', ...sessionMetaRef.current }));
      }
      if (offlineChunkBuffer.current.length > 0) {
        console.log(`[notulen] Draining ${offlineChunkBuffer.current.length} buffered chunks`);
        for (const chunk of offlineChunkBuffer.current) {
          ws.send(chunk);
          pendingRef.current++;
        }
        offlineChunkBuffer.current = [];
        setProcessing(true);
      }
      const ping = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ command: 'ping' })); }, 30000);
      ws._pingInterval = ping;
    };

    ws.onclose = () => {
      setWsConnected(false);
      clearInterval(ws._pingInterval);
      if (isRecordingRef.current && !ws._noReconnect) {
        const attempt = reconnectAttemptsRef.current;
        // No hard limit on reconnects — long recordings must survive network hiccups
        const delay = Math.min(1000 * Math.pow(2, Math.min(attempt, 6)), 64000); // cap at 64s
        console.log(`[notulen-ws] Reconnecting in ${delay}ms (attempt ${attempt + 1})`);
        toast('Koneksi terputus, menyambung ulang...', { id: 'ws-reconnect' });
        reconnectTimerRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          connectWebSocket(true);
        }, delay);
      }
    };

    ws.onerror = () => toast.error('WebSocket error');

    ws.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.type === 'transcript') {
        segmentBatchRef.current.push({ id: d.segment_id, ts: d.timestamp, text: d.text });
        pendingRef.current = Math.max(0, pendingRef.current - 1);
        if (!batchTimerRef.current) {
          batchTimerRef.current = setTimeout(() => {
            const batch = segmentBatchRef.current;
            segmentBatchRef.current = [];
            batchTimerRef.current = null;
            if (batch.length > 0) setSegments(prev => [...prev, ...batch]);
            setProcessing(pendingRef.current > 0);
          }, 500);
        }
      } else if (d.type === 'status' && d.sessionId) {
        setSessionId(d.sessionId);
      } else if (d.type === 'status' && d.message === 'transcription_paused') {
        setTranscriptPaused(true);
      } else if (d.type === 'status' && d.message === 'transcription_resumed') {
        setTranscriptPaused(false);
        setProcessing(true);
      } else if (d.type === 'queue_status') {
        setQueueDepth(d.queueDepth || 0);
        setProcessing(d.processing || false);
      } else if (d.type === 'groq_limit') {
        toast(d.message, { icon: '⚠️', duration: 8000, id: 'groq-limit' });
      }
    };

    return ws;
  }

  async function startRecording() {
    if (!judul.trim()) { toast.error('Isi judul'); return; }
    if (!navigator.mediaDevices) { toast.error('Browser tidak mendukung audio. Gunakan HTTPS + Chrome.'); return; }

    try {
      wakeLockRef.current = await requestWakeLock();
      if (visibilityHandlerRef.current) document.removeEventListener('visibilitychange', visibilityHandlerRef.current);
      visibilityHandlerRef.current = async () => {
        if (document.visibilityState === 'visible') {
          if (!wakeLockRef.current) wakeLockRef.current = await requestWakeLock();
        } else if (isRecordingRef.current) {
          toast('Jangan minimize app! Rekaman bisa terhenti di background.', { duration: 5000 });
        }
      };
      document.addEventListener('visibilitychange', visibilityHandlerRef.current);

      if (audioSource === 'mic' || audioSource === 'both') {
        micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      }
      if (audioSource === 'speaker' || audioSource === 'both') {
        try {
          displayStreamRef.current = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
          if (displayStreamRef.current.getAudioTracks().length === 0) {
            toast.error('Centang "Share audio"!');
            if (audioSource === 'speaker') { cleanup(); return; }
            displayStreamRef.current.getTracks().forEach(t => t.stop());
            displayStreamRef.current = null;
          }
        } catch (e) {
          if (audioSource === 'speaker') { toast.error('Gagal akses system audio'); cleanup(); return; }
          toast('System audio gagal, lanjut mikrofon saja');
        }
      }

      if (supportsAudioWorklet()) {
        await setupAudioWorklet();
      } else {
        setupMediaRecorder();
      }

      setupAudioLevelMonitor();

      sessionMetaRef.current = { judul, sub_judul: subJudul || undefined, pencatat, instansi, tanggal };
      isRecordingRef.current = true;
      const ws = connectWebSocket(false);

      await new Promise((ok, fail) => {
        const i = setInterval(() => { if (ws.readyState === 1) { clearInterval(i); ok(); } }, 100);
        setTimeout(() => { clearInterval(i); fail(new Error('WS timeout')); }, 10000);
      });

      startTimeRef.current = Date.now();
      pausedDurationRef.current = 0;

      if (supportsAudioWorklet()) {
        sendIntervalRef.current = setInterval(sendPCMChunk, CHUNK_SEC * 1000);
      }

      durationIntervalRef.current = setInterval(() => {
        if (!isPausedRef.current && startTimeRef.current) {
          setDuration(Math.floor((Date.now() - startTimeRef.current - pausedDurationRef.current) / 1000));
        }
      }, 1000);

      haptic(100);
      setPhase('recording');
    } catch (err) {
      toast.error('Error: ' + err.message);
      cleanup();
    }
  }

  async function setupAudioWorklet() {
    audioContextRef.current = new AudioContext({ sampleRate: TARGET_RATE });
    const code = 'class P extends AudioWorkletProcessor{process(inputs){var ch=inputs[0];if(ch&&ch[0]&&ch[0].length>0)this.port.postMessage(ch[0]);return true;}}registerProcessor("p",P);';
    const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    await audioContextRef.current.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    workletRef.current = new AudioWorkletNode(audioContextRef.current, 'p');
    if (micStreamRef.current) audioContextRef.current.createMediaStreamSource(micStreamRef.current).connect(workletRef.current);
    if (displayStreamRef.current) audioContextRef.current.createMediaStreamSource(displayStreamRef.current).connect(workletRef.current);
    pcmBufferRef.current = [];
    workletRef.current.port.onmessage = (e) => {
      if (!isPausedRef.current) pcmBufferRef.current.push(new Float32Array(e.data));
    };
  }

  function sendPCMChunk() {
    const buf = pcmBufferRef.current;
    if (!buf.length || !wsRef.current || wsRef.current.readyState !== 1) return;
    let total = 0;
    for (let i = 0; i < buf.length; i++) total += buf[i].length;
    if (total < TARGET_RATE * 0.5) return;
    const merged = new Float32Array(total);
    let off = 0;
    for (let i = 0; i < buf.length; i++) { merged.set(buf[i], off); off += buf[i].length; }
    pcmBufferRef.current = [];
    const int16 = new Int16Array(merged.length);
    for (let j = 0; j < merged.length; j++) {
      const s = Math.max(-1, Math.min(1, merged[j]));
      int16[j] = s < 0 ? s * 32768 : s * 32767;
    }
    wsRef.current.send(int16.buffer);
    pendingRef.current++;
    setProcessing(true);
  }

  function setupMediaRecorder() {
    const stream = micStreamRef.current || displayStreamRef.current;
    if (!stream) return;
    const mimeType = isIOS
      ? (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '')
      : MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';

    const mr = new MediaRecorder(stream, { mimeType: mimeType || undefined, audioBitsPerSecond: 64000 });
    mediaRecorderRef.current = mr;

    mr.ondataavailable = async (event) => {
      if (event.data.size < 1000) return;
      const arrayBuffer = await event.data.arrayBuffer();
      if (!wsRef.current || wsRef.current.readyState !== 1) {
        // Cap offline buffer at 120 chunks (~30 min of audio) to prevent memory leak
        if (offlineChunkBuffer.current.length < 120) {
          offlineChunkBuffer.current.push(arrayBuffer);
        }
        console.log(`[notulen] Buffered chunk offline (${offlineChunkBuffer.current.length} pending)`);
        return;
      }
      wsRef.current.send(arrayBuffer);
      pendingRef.current++;
      setProcessing(true);
    };

    mr.start(CHUNK_SEC * 1000);
  }

  function setupAudioLevelMonitor() {
    try {
      const stream = micStreamRef.current || displayStreamRef.current;
      if (!stream) return;
      const ctx = audioContextRef.current || new AudioContext();
      if (!audioContextRef.current) audioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      analyserRef.current = analyser;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      function updateLevel() {
        if (!analyserRef.current || !isRecordingRef.current) return;
        if (isPausedRef.current) { setAudioLevel(0); levelAnimRef.current = requestAnimationFrame(updateLevel); return; }
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        setAudioLevel(normalized);
        levelAnimRef.current = requestAnimationFrame(updateLevel);
      }
      updateLevel();
    } catch (e) {
      console.log('[notulen] Audio level monitor failed:', e.message);
    }
  }

  function togglePause() {
    haptic(50);
    if (!isPaused) {
      setIsPaused(true);
      pauseStartRef.current = Date.now();
      if (supportsAudioWorklet()) sendPCMChunk();
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.pause();
      wsRef.current?.readyState === 1 && wsRef.current.send(JSON.stringify({ command: 'pause' }));
    } else {
      setIsPaused(false);
      pausedDurationRef.current += Date.now() - pauseStartRef.current;
      if (mediaRecorderRef.current?.state === 'paused') mediaRecorderRef.current.resume();
      wsRef.current?.readyState === 1 && wsRef.current.send(JSON.stringify({ command: 'resume' }));
    }
  }

  function stopRecording() {
    haptic(200);
    isRecordingRef.current = false;
    clearInterval(sendIntervalRef.current);
    clearInterval(durationIntervalRef.current);
    clearTimeout(reconnectTimerRef.current);
    if (supportsAudioWorklet()) sendPCMChunk();
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    if (wsRef.current) { wsRef.current._noReconnect = true; }
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify({ command: 'stop' }));
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    if (displayStreamRef.current) { displayStreamRef.current.getTracks().forEach(t => t.stop()); displayStreamRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    analyserRef.current = null;
    cancelAnimationFrame(levelAnimRef.current);
    setAudioLevel(0);
    if (wakeLockRef.current) { wakeLockRef.current.release(); wakeLockRef.current = null; }
    setPhase('stopped');
  }

  async function askLive() {
    const q = askInput.trim();
    if (!q || !sessionId) return;
    setAskInput('');
    setAskLoading(true);
    setAskHistory(h => [...h, { q, a: null }]);
    try {
      const res = await notulenAPI.askQuestion(sessionId, q);
      const answer = res.data?.data?.answer || 'Tidak ada jawaban.';
      setAskHistory(h => h.map((item, i) => i === h.length - 1 ? { ...item, a: answer } : item));
    } catch {
      setAskHistory(h => h.map((item, i) => i === h.length - 1 ? { ...item, a: 'Gagal mendapatkan jawaban.' } : item));
    } finally {
      setAskLoading(false);
    }
  }

  function toggleTranscriptPause() {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    if (transcriptPaused) {
      wsRef.current.send(JSON.stringify({ command: 'resume_transcription' }));
      toast('Transkripsi dilanjutkan', { icon: '▶️' });
    } else {
      wsRef.current.send(JSON.stringify({ command: 'pause_transcription' }));
      toast('Transkripsi dihentikan sementara', { icon: '⏸️' });
    }
  }

  function startEditSummaryRec() { setDraftSummary(summary); setEditingSummary(true); }
  function cancelEditSummaryRec() { setEditingSummary(false); setDraftSummary(''); }
  async function handleSaveSummaryRec() {
    if (!sessionId) return;
    setSavingSummary(true);
    try {
      await notulenAPI.updateSession(sessionId, { summary: draftSummary });
      setSummary(draftSummary);
      setEditingSummary(false);
      toast.success('Ringkasan disimpan');
    } catch {
      toast.error('Gagal menyimpan ringkasan');
    } finally {
      setSavingSummary(false);
    }
  }

  async function handleGenerateSummary() {
    if (!sessionId) { toast.error('Tidak ada sesi aktif'); return; }
    setSummaryLoading(true);
    setSummaryProgress(0);
    setSummaryStep('Memulai...');

    // Open SSE first — it delivers progress AND the final summary.
    // The POST responds immediately; result arrives via SSE to avoid Cloudflare timeout.
    const es = new EventSource(notulenAPI.summaryProgressUrl(sessionId));
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        setSummaryProgress(d.percent || 0);
        setSummaryStep(d.step || '');
        if (d.done && d.summary) {
          setSummary(d.summary);
          toast.success('Ringkasan berhasil dibuat');
          es.close();
          setSummaryLoading(false);
        } else if (d.error) {
          toast.error('Gagal membuat ringkasan: ' + (d.step || ''));
          es.close();
          setSummaryLoading(false);
        }
      } catch {}
    };
    es.onerror = () => { es.close(); setSummaryLoading(false); toast.error('Koneksi progress terputus'); };

    try {
      await notulenAPI.generateSummary(sessionId);
    } catch {
      toast.error('Gagal memulai ringkasan');
      es.close();
      setSummaryLoading(false);
    }
  }

  function copyText(text) { copyToClipboard(text).then(ok => ok ? toast.success('Disalin ke clipboard') : toast.error('Gagal menyalin')); }

  async function downloadExport(fmt) {
    if (!sessionId) return;
    try {
      const res = await notulenAPI.exportSession(sessionId, fmt);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = url;
      a.download = `notulen_${judul.replace(/\s+/g, '_')}.${fmt}`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Gagal download'); }
  }

  function deleteSegment(segId) {
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify({ command: 'delete_segment', segment_id: segId }));
    setSegments(prev => prev.filter(s => s.id !== segId));
  }

  const mm = String(Math.floor(duration / 60)).padStart(2, '0');
  const ss = String(duration % 60).padStart(2, '0');

  return (
    <div className="space-y-4 animate-fadeIn">
      <BackButton onClick={() => {
        if (phase === 'recording') { setShowLeaveConfirm(true); return; }
        cleanup();
        onBack();
      }} />

      <ConfirmDialog
        open={showLeaveConfirm}
        message={`Rekaman sedang berjalan (${mm}:${ss}). Yakin ingin berhenti dan keluar?`}
        onConfirm={() => { setShowLeaveConfirm(false); stopRecording(); onBack(); }}
        onCancel={() => setShowLeaveConfirm(false)}
      />

      {/* Setup Phase */}
      {phase === 'setup' && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-lg ${resumeSession ? 'bg-gradient-to-br from-green-500 to-emerald-600 shadow-green-200' : 'bg-gradient-to-br from-red-500 to-rose-600 shadow-red-200'}`}>
              <HiOutlineMicrophone className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">{resumeSession ? 'Lanjutkan Rekam' : 'Rekam Live'}</h2>
              <p className="text-xs text-gray-400 mt-0.5">{resumeSession ? `Melanjutkan: ${resumeSession.judul}` : 'Transkripsi real-time dengan AI'}</p>
            </div>
          </div>
          {resumeSession && (
            <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
              <span className="text-green-600 text-base shrink-0">↩</span>
              <span className="text-xs text-green-700">
                Melanjutkan sesi yang sebelumnya — {resumeSession.segment_count || 0} segmen tersimpan akan tetap ada. Rekaman baru akan ditambahkan ke sesi yang sama.
              </span>
            </div>
          )}

          {isMobile && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              <span className="text-xs text-amber-700">Mode mobile: menggunakan mikrofon saja. Layar akan tetap nyala selama merekam.</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="form-label">Judul</label>
              <input value={judul} onChange={e => setJudul(e.target.value)} placeholder="Contoh: Rapat Koordinasi" className="form-input" />
            </div>
            <div className="md:col-span-2">
              <label className="form-label">Sub Judul / Konteks <span className="text-gray-400 font-normal">(opsional)</span></label>
              <input value={subJudul} onChange={e => setSubJudul(e.target.value)} placeholder="Deskripsi singkat untuk membantu AI meringkas" className="form-input" />
            </div>
            <div>
              <label className="form-label">Pencatat</label>
              <input value={pencatat} onChange={e => setPencatat(e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="form-label">Tanggal</label>
              <input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} className="form-input" />
            </div>
            {!isMobile && (
              <div>
                <label className="form-label">Sumber Audio</label>
                <select value={audioSource} onChange={e => setAudioSource(e.target.value)} className="form-input">
                  <option value="mic">Mikrofon saja</option>
                  <option value="speaker">Speaker/System Audio saja</option>
                  <option value="both">Mikrofon + Speaker</option>
                </select>
              </div>
            )}
          </div>

          <button
            onClick={startRecording}
            className="w-full flex items-center justify-center gap-2 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl shadow-sm shadow-red-200 transition-all hover:shadow-md"
          >
            <HiOutlineMicrophone className="w-5 h-5" /> Mulai Rekam
          </button>
        </div>
      )}

      {/* Recording / Stopped Phase */}
      {(phase === 'recording' || phase === 'stopped') && (
        <>
          {/* Status Bar */}
          <div className="bg-white border border-gray-100 rounded-xl p-3 flex items-center gap-4 flex-wrap text-sm">
            <div className="flex items-center gap-1.5">
              <div className={`w-2.5 h-2.5 rounded-full ${!isOnline ? 'bg-red-500' : wsConnected ? 'bg-green-500' : 'bg-yellow-400 animate-pulse'}`} />
              <span className={`text-xs font-medium ${!isOnline ? 'text-red-600' : 'text-gray-500'}`}>
                {!isOnline ? 'Offline' : wsConnected ? 'Terhubung' : 'Menyambung...'}
              </span>
            </div>
            <span className="font-mono font-bold text-gray-900 text-base">{mm}:{ss}</span>
            <span className="text-xs text-gray-400">{segments.length} segmen</span>
            {phase === 'recording' && (
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${isPaused ? 'bg-yellow-400' : 'bg-red-500 animate-pulse'}`} />
                <span className={`text-xs font-medium ${isPaused ? 'text-yellow-600' : 'text-red-600'}`}>{isPaused ? 'Jeda' : 'Merekam'}</span>
              </div>
            )}
            {transcriptPaused && (
              <span className="text-xs text-orange-500 font-medium flex items-center gap-1">
                <span>⏸</span> Transkripsi dihentikan
                {queueDepth > 0 && <span className="text-orange-400">({queueDepth} antrean)</span>}
              </span>
            )}
            {!transcriptPaused && processing && (
              <span className="text-xs text-yellow-500 animate-pulse font-medium flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
                Memproses{queueDepth > 0 ? ` (${queueDepth} antrean)` : '...'}
              </span>
            )}
            {phase === 'recording' && !isPaused && (
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-gray-400 text-[10px] uppercase tracking-wider font-medium">Mic</span>
                <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-75 ${audioLevel > 70 ? 'bg-red-500' : audioLevel > 35 ? 'bg-green-500' : 'bg-green-300'}`}
                    style={{ width: `${audioLevel}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Recording Controls */}
          {phase === 'recording' && (
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={togglePause}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                  isPaused
                    ? 'bg-green-600 hover:bg-green-700 text-white shadow-sm shadow-green-200'
                    : 'bg-yellow-500 hover:bg-yellow-600 text-white shadow-sm shadow-yellow-200'
                }`}
              >
                {isPaused ? <><HiOutlinePlay className="w-5 h-5" /> Lanjut</> : <><HiOutlinePause className="w-5 h-5" /> Jeda</>}
              </button>
              <button
                onClick={toggleTranscriptPause}
                title={transcriptPaused ? 'Lanjutkan transkripsi otomatis' : 'Hentikan transkripsi sementara (rekaman tetap berjalan)'}
                className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                  transcriptPaused
                    ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-200'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                {transcriptPaused ? <><HiOutlinePlay className="w-4 h-4" /> Lanjut Transkripsi</> : <><HiOutlinePause className="w-4 h-4" /> Stop Transkripsi</>}
              </button>
              <button
                onClick={stopRecording}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold text-sm shadow-sm shadow-red-200 transition-all"
              >
                <HiOutlineStop className="w-5 h-5" /> Berhenti
              </button>
            </div>
          )}

          {/* Stopped Controls */}
          {phase === 'stopped' && (
            <div className="flex gap-2 flex-wrap">
              {/* Resume transcript draining if it was paused when user stopped */}
              {transcriptPaused && (
                <button
                  onClick={toggleTranscriptPause}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm shadow-sm shadow-blue-200 transition-all"
                >
                  <HiOutlinePlay className="w-4 h-4" /> Lanjutkan Transkripsi
                  {queueDepth > 0 && <span className="opacity-75 text-xs">({queueDepth} chunk menunggu)</span>}
                </button>
              )}
              {/* Drain-in-progress indicator shown while backend processes remaining queue after stop */}
              {!transcriptPaused && processing && (
                <div className="w-full flex items-center gap-2 px-4 py-2.5 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-700">
                  <HiOutlineRefresh className="w-4 h-4 animate-spin shrink-0" />
                  <span>Memproses sisa antrean{queueDepth > 0 ? ` (${queueDepth} chunk)` : ''}... jangan tutup halaman</span>
                </div>
              )}
              <button
                onClick={handleGenerateSummary}
                disabled={summaryLoading || segments.length === 0}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white rounded-xl font-semibold text-sm shadow-sm shadow-primary-200 transition-all"
              >
                {summaryLoading ? <><HiOutlineRefresh className="w-4 h-4 animate-spin" /> Membuat...</> : <><HiOutlineDocumentText className="w-4 h-4" /> Buat Ringkasan</>}
              </button>
              {summaryLoading && (
                <div className="w-full mt-1 space-y-1">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span className="truncate">{summaryStep}</span>
                    <span className="ml-2 font-semibold text-primary-600 shrink-0">{summaryProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-primary-600 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${summaryProgress}%` }}
                    />
                  </div>
                </div>
              )}
              <button onClick={() => downloadExport('txt')} className="btn btn-secondary flex items-center gap-1 text-sm">
                <HiOutlineDownload className="w-4 h-4" /> .txt
              </button>
              {navigator.share && (
                <button
                  onClick={async () => {
                    const text = (summary || '') + '\n\n' + segments.map(s => `[${s.ts}] ${s.text}`).join('\n');
                    await shareText(judul || 'Notulen', text);
                  }}
                  className="btn btn-secondary flex items-center gap-1 text-sm"
                >
                  <HiOutlineShare className="w-4 h-4" /> Share
                </button>
              )}
            </div>
          )}

          {/* Transcript Panel */}
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Transkrip Real-Time</span>
              <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">{segments.length} segmen</span>
            </div>
            <div ref={transcriptRef} className="p-4 max-h-[50vh] overflow-y-auto min-h-[120px]">
              {segments.length === 0 ? (
                <p className="text-gray-300 italic text-sm">Transkrip akan muncul di sini saat merekam...</p>
              ) : segments.map((s) => (
                <div key={s.id} className="group flex items-baseline gap-2 py-1.5 border-b border-gray-50 last:border-0">
                  <span className="text-primary-500 font-mono text-xs font-semibold whitespace-nowrap">[{s.ts}]</span>
                  <span className="flex-1 text-gray-700 text-sm leading-relaxed">{s.text}</span>
                  <button onClick={() => deleteSegment(s.id)} className="md:opacity-0 md:group-hover:opacity-100 text-gray-300 hover:text-red-500 active:text-red-600 transition-all p-2 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-red-50">
                    <HiOutlineX className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* AI Live Q&A Panel */}
          {sessionId && segments.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <button
                onClick={() => setShowAskPanel(v => !v)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <span className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <span className="text-base">🤖</span> Tanya AI tentang Transkrip
                </span>
                <span className="text-xs text-gray-400">{showAskPanel ? '▲ Tutup' : '▼ Buka'}</span>
              </button>
              {showAskPanel && (
                <div className="border-t border-gray-100">
                  {/* Q&A History */}
                  <div className="px-4 py-3 max-h-64 overflow-y-auto space-y-4">
                    {askHistory.length === 0 && (
                      <p className="text-gray-400 text-sm italic text-center py-4">
                        Tanya apa saja tentang transkrip yang sedang berjalan...
                      </p>
                    )}
                    {askHistory.map((item, i) => (
                      <div key={i} className="space-y-2">
                        <div className="flex gap-2 justify-end">
                          <div className="bg-primary-600 text-white text-sm px-3 py-2 rounded-2xl rounded-br-sm max-w-[80%]">
                            {item.q}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <div className={`text-sm px-3 py-2 rounded-2xl rounded-bl-sm max-w-[90%] ${item.a === null ? 'bg-gray-100 text-gray-400 italic' : 'bg-gray-50 text-gray-700 border border-gray-100'}`}>
                            {item.a === null ? (
                              <span className="flex items-center gap-1.5">
                                <HiOutlineRefresh className="w-3.5 h-3.5 animate-spin" /> Menjawab...
                              </span>
                            ) : item.a}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Input */}
                  <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
                    <input
                      type="text"
                      value={askInput}
                      onChange={e => setAskInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && !askLoading && askLive()}
                      placeholder="Contoh: Siapa yang hadir? Apa keputusan yang diambil?"
                      disabled={askLoading}
                      className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 disabled:bg-gray-50"
                    />
                    <button
                      onClick={askLive}
                      disabled={askLoading || !askInput.trim()}
                      className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-200 text-white text-sm font-semibold rounded-xl transition-colors"
                    >
                      {askLoading ? <HiOutlineRefresh className="w-4 h-4 animate-spin" /> : 'Kirim'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Summary Panel */}
          {summary && (
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-900">Ringkasan</span>
                <div className="flex items-center gap-2">
                  {!editingSummary && (
                    <>
                      <button onClick={() => copyText(summary)} className="text-gray-400 hover:text-primary-600 flex items-center gap-1 text-xs font-medium transition-colors">
                        <HiOutlineClipboard className="w-4 h-4" /> Salin
                      </button>
                      <button onClick={startEditSummaryRec} className="text-gray-400 hover:text-primary-600 flex items-center gap-1 text-xs font-medium transition-colors">
                        <HiOutlinePencil className="w-4 h-4" /> Edit
                      </button>
                    </>
                  )}
                </div>
              </div>
              {editingSummary && (
                <div className="p-4 space-y-3">
                  <textarea
                    value={draftSummary}
                    onChange={e => setDraftSummary(e.target.value)}
                    className="w-full min-h-[36vh] px-3 py-2.5 text-sm text-gray-700 border border-gray-200 rounded-xl resize-y focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 outline-none font-mono leading-relaxed"
                    placeholder="Tulis ringkasan dalam format Markdown..."
                    autoFocus
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={cancelEditSummaryRec} disabled={savingSummary} className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-xl hover:border-gray-300 transition-all">
                      Batal
                    </button>
                    <button onClick={handleSaveSummaryRec} disabled={savingSummary} className="px-4 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-all flex items-center gap-1.5 disabled:bg-primary-300">
                      {savingSummary ? <><HiOutlineRefresh className="w-3.5 h-3.5 animate-spin" /> Menyimpan...</> : <><HiOutlineCheck className="w-3.5 h-3.5" /> Simpan</>}
                    </button>
                  </div>
                </div>
              )}
              {!editingSummary && (
                <div className="p-4 text-sm text-gray-700 max-h-[60vh] overflow-y-auto leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ===================================================
// DetailView — view past session
// ===================================================
function DetailView({ session: initialSession, folders = [], onBack, isAdmin }) {
  const [session, setSession] = useState(initialSession);
  const [summary, setSummary] = useState(session.summary || '');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryProgress, setSummaryProgress] = useState(0);
  const [summaryStep, setSummaryStep] = useState('');
  const [activeTab, setActiveTab] = useState('summary');
  const [segments, setSegments] = useState(session.segments || []);
  const [editingSegId, setEditingSegId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editSession, setEditSession] = useState(null);

  // Edit ringkasan state
  const [editingSummary, setEditingSummary] = useState(false);
  const [draftSummary, setDraftSummary] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);

  // Share state
  const [shareLoading, setShareLoading] = useState(false);
  const [shareToken, setShareToken] = useState(session.public_token || null);

  // Tanya AI state
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [mobileAiOpen, setMobileAiOpen] = useState(false);
  const chatEndRef = useRef(null);

  // Auto scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function refreshSession() {
    try {
      const res = await notulenAPI.getSession(session.id);
      const updated = res.data.data;
      setSession(updated);
      setSummary(updated.summary || '');
      setSegments(updated.segments || []);
      if (updated.public_token) setShareToken(updated.public_token);
    } catch { /* silent */ }
  }

  async function saveSegmentEdit(segId) {
    const trimmed = editText.trim();
    if (!trimmed) return;
    try {
      await notulenAPI.updateSegment(session.id, segId, trimmed);
      setSegments(prev => prev.map(s => s.id === segId ? { ...s, text: trimmed } : s));
      setEditingSegId(null);
    } catch { toast.error('Gagal menyimpan'); }
  }

  async function deleteSegment(segId) {
    try {
      await notulenAPI.deleteSegment(session.id, segId);
      setSegments(prev => prev.filter(s => s.id !== segId));
    } catch { toast.error('Gagal menghapus segmen'); }
  }

  const rawTranscript = useMemo(() => segments
    .map(s => {
      const mm = Math.floor((s.timestamp_seconds || 0) / 60).toString().padStart(2, '0');
      const ss = Math.floor((s.timestamp_seconds || 0) % 60).toString().padStart(2, '0');
      return `[${mm}:${ss}] ${s.text}`;
    })
    .join('\n'), [segments]);

  async function regenerateSummary() {
    setSummaryLoading(true);
    setSummaryProgress(0);
    setSummaryStep('Memulai...');

    const es = new EventSource(notulenAPI.summaryProgressUrl(session.id));
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        setSummaryProgress(d.percent || 0);
        setSummaryStep(d.step || '');
        if (d.done && d.summary) {
          setSummary(d.summary);
          setActiveTab('summary');
          toast.success('Ringkasan diperbarui');
          es.close();
          setSummaryLoading(false);
        } else if (d.error) {
          toast.error('Gagal membuat ringkasan: ' + (d.step || ''));
          es.close();
          setSummaryLoading(false);
        }
      } catch {}
    };
    es.onerror = () => { es.close(); setSummaryLoading(false); toast.error('Koneksi progress terputus'); };

    try {
      await notulenAPI.generateSummary(session.id);
    } catch {
      toast.error('Gagal memulai ringkasan');
      es.close();
      setSummaryLoading(false);
    }
  }

  function copyText(text) { copyToClipboard(text).then(ok => ok ? toast.success('Disalin') : toast.error('Gagal menyalin')); }

  async function downloadExport(fmt) {
    try {
      const res = await notulenAPI.exportSession(session.id, fmt);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = url;
      a.download = `notulen_${session.judul.replace(/\s+/g, '_')}.${fmt}`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Gagal download'); }
  }

  // Share functions
  async function generateShareLink() {
    setShareLoading(true);
    try {
      const res = await notulenAPI.shareSession(session.id);
      const token = res.data.data.token;
      setShareToken(token);
      const url = `${window.location.origin}/notulen/shared/${token}`;
      await copyToClipboard(url);
      toast.success('Link publik disalin ke clipboard');
    } catch { toast.error('Gagal membuat link publik'); }
    finally { setShareLoading(false); }
  }

  async function revokeShareLink() {
    try {
      await notulenAPI.revokeShare(session.id);
      setShareToken(null);
      toast.success('Link publik dihapus');
    } catch { toast.error('Gagal menghapus link'); }
  }

  function startEditSummary() {
    setDraftSummary(summary);
    setEditingSummary(true);
  }

  function cancelEditSummary() {
    setEditingSummary(false);
    setDraftSummary('');
  }

  async function handleSaveSummary() {
    setSavingSummary(true);
    try {
      await notulenAPI.updateSession(session.id, { summary: draftSummary });
      setSummary(draftSummary);
      setEditingSummary(false);
      toast.success('Ringkasan disimpan');
    } catch {
      toast.error('Gagal menyimpan ringkasan');
    } finally {
      setSavingSummary(false);
    }
  }

  // Tanya AI function
  async function handleAsk() {
    if (!question.trim() || asking) return;
    const q = question.trim();
    setQuestion('');
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setAsking(true);
    try {
      const res = await notulenAPI.askQuestion(session.id, q);
      setMessages(prev => [...prev, { role: 'ai', text: res.data.data.answer }]);
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: 'Gagal menjawab. Coba lagi.' }]);
    }
    finally { setAsking(false); }
  }

  // Tanya AI panel renderer (NOT a component — avoids remount on parent re-render)
  const renderAIPanel = (className) => (
    <div className={`bg-white border border-gray-100 rounded-2xl flex flex-col ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <HiOutlineChatAlt2 className="w-5 h-5 text-primary-500" />
        <span className="text-sm font-semibold text-gray-900">Tanya AI</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-xs mt-8">
            <p>Tanya apa saja tentang notulen ini.</p>
            <p className="mt-1">AI akan menjawab berdasarkan transkrip dan ringkasan.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
              m.role === 'user'
                ? 'bg-primary-600 text-white rounded-br-sm'
                : 'bg-gray-100 text-gray-700 rounded-bl-sm'
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {asking && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-400 px-3 py-2 rounded-xl rounded-bl-sm text-sm animate-pulse">Menjawab...</div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-100">
        <div className="flex gap-2">
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
            placeholder="Tanya sesuatu..."
            className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 outline-none"
            disabled={asking}
          />
          <button
            onClick={handleAsk}
            disabled={asking || !question.trim()}
            className="px-3 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white rounded-xl transition-all"
          >
            <HiOutlineArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 animate-fadeIn">
      <BackButton onClick={onBack} />

      {/* Session Header */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-lg shadow-primary-200 shrink-0">
            <HiOutlineDocumentText className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-gray-900 truncate">{session.judul}</h2>
            {session.sub_judul && <p className="text-sm text-gray-500 mt-0.5">{session.sub_judul}</p>}
            <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400 flex-wrap">
              <span>{formatTanggal(session.tanggal)}</span>
              <span>Pencatat: {session.pencatat}</span>
              <span>{session.instansi}</span>
              {session.duration_seconds > 0 && (
                <span className="flex items-center gap-0.5">
                  <HiOutlineClock className="w-3 h-3" />{formatDuration(session.duration_seconds)}
                </span>
              )}
              <span className={`font-medium px-2 py-0.5 rounded-full text-[10px] ${STATUS_BADGE[session.status]}`}>{session.status}</span>
              {isAdmin && session.user_name && <span className="text-primary-500 font-medium">{session.user_name}</span>}
            </div>
          </div>
          {/* Edit button */}
          <button
            onClick={() => setEditSession(session)}
            className="p-2 text-gray-400 hover:text-primary-600 active:text-primary-700 transition-colors rounded-lg hover:bg-primary-50 shrink-0"
            title="Edit sesi"
          >
            <HiOutlinePencil className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <button
            onClick={regenerateSummary}
            disabled={summaryLoading || segments.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white font-semibold rounded-xl shadow-sm shadow-primary-200 transition-all text-sm"
          >
            {summaryLoading ? <HiOutlineRefresh className="w-4 h-4 animate-spin" /> : <HiOutlineDocumentText className="w-4 h-4" />}
            {summary ? 'Regenerate' : 'Buat Ringkasan'}
          </button>
          {summaryLoading && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-500">
                <span className="truncate">{summaryStep}</span>
                <span className="ml-2 font-semibold text-primary-600 shrink-0">{summaryProgress}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary-600 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${summaryProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
        <button onClick={() => downloadExport('txt')} className="btn btn-secondary flex items-center gap-1 text-sm">
          <HiOutlineDownload className="w-4 h-4" /> .txt
        </button>
        <button onClick={() => downloadExport('md')} className="btn btn-secondary flex items-center gap-1 text-sm">
          <HiOutlineDownload className="w-4 h-4" /> .md
        </button>
        {/* Share Link */}
        <button
          onClick={generateShareLink}
          disabled={shareLoading}
          className="btn btn-secondary flex items-center gap-1 text-sm"
        >
          {shareLoading ? <HiOutlineRefresh className="w-4 h-4 animate-spin" /> : <HiOutlineLink className="w-4 h-4" />}
          {shareToken ? 'Salin Link' : 'Buat Link Publik'}
        </button>
        {shareToken && (
          <button
            onClick={revokeShareLink}
            className="px-2 py-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
            title="Hapus link publik"
          >
            <HiOutlineX className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 2-column layout */}
      <div className="flex gap-4 items-start">
        {/* Left column - tabs + content */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Tabs */}
          <div className="flex items-center gap-1">
            {[
              { key: 'transcript', label: `Transkrip (${segments.length})` },
              { key: 'summary', label: summary ? 'Ringkasan' : 'Ringkasan (belum)' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  activeTab === tab.key
                    ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-200 shadow-sm'
                    : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Transcript Tab */}
          {activeTab === 'transcript' && (
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-900">Raw Transkrip</span>
                <button onClick={() => copyText(rawTranscript)} className="text-gray-400 hover:text-primary-600 flex items-center gap-1 text-xs font-medium transition-colors">
                  <HiOutlineClipboard className="w-4 h-4" /> Salin
                </button>
              </div>
              <div className="p-4 max-h-[60vh] overflow-y-auto">
                {segments.length === 0 ? <p className="text-gray-300 italic text-sm">Tidak ada segmen</p> : segments.map(s => {
                  const m = Math.floor((s.timestamp_seconds||0)/60).toString().padStart(2,'0');
                  const sc = Math.floor((s.timestamp_seconds||0)%60).toString().padStart(2,'0');
                  return (
                    <div key={s.id} className="group flex items-baseline gap-2 py-1.5 border-b border-gray-50 last:border-0">
                      <span className="text-primary-500 font-mono text-xs font-semibold whitespace-nowrap">[{m}:{sc}]</span>
                      {editingSegId === s.id ? (
                        <input
                          autoFocus
                          value={editText}
                          onChange={e => setEditText(e.target.value)}
                          onBlur={() => { if (editingSegId === s.id) saveSegmentEdit(s.id); }}
                          onKeyDown={e => { if (e.key === 'Enter') { e.target.blur(); } if (e.key === 'Escape') setEditingSegId(null); }}
                          className="flex-1 text-gray-700 bg-primary-50 border border-primary-300 rounded-lg px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      ) : (
                        <span
                          className="flex-1 text-gray-700 text-sm cursor-pointer hover:bg-gray-50 active:bg-gray-100 rounded-lg px-1.5 -mx-1 py-0.5 transition-colors leading-relaxed"
                          onClick={() => { setEditingSegId(s.id); setEditText(s.text); }}
                          title="Klik untuk edit"
                        >{s.text}</span>
                      )}
                      <button onClick={() => deleteSegment(s.id)} className="md:opacity-0 md:group-hover:opacity-100 text-gray-300 hover:text-red-500 active:text-red-600 transition-all p-2 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0 rounded-lg hover:bg-red-50">
                        <HiOutlineX className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Summary Tab */}
          {activeTab === 'summary' && (
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              {summary ? (
                <>
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-900">Ringkasan</span>
                    <div className="flex items-center gap-2">
                      {!editingSummary && (
                        <>
                          <button onClick={() => copyText(summary)} className="text-gray-400 hover:text-primary-600 flex items-center gap-1 text-xs font-medium transition-colors">
                            <HiOutlineClipboard className="w-4 h-4" /> Salin
                          </button>
                          <button onClick={startEditSummary} className="text-gray-400 hover:text-primary-600 flex items-center gap-1 text-xs font-medium transition-colors">
                            <HiOutlinePencil className="w-4 h-4" /> Edit
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {editingSummary && (
                    <div className="p-4 space-y-3">
                      <textarea
                        value={draftSummary}
                        onChange={e => setDraftSummary(e.target.value)}
                        className="w-full min-h-[40vh] px-3 py-2.5 text-sm text-gray-700 border border-gray-200 rounded-xl resize-y focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 outline-none font-mono leading-relaxed"
                        placeholder="Tulis ringkasan dalam format Markdown..."
                        autoFocus
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={cancelEditSummary} disabled={savingSummary} className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-xl hover:border-gray-300 transition-all">
                          Batal
                        </button>
                        <button onClick={handleSaveSummary} disabled={savingSummary} className="px-4 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-all flex items-center gap-1.5 disabled:bg-primary-300">
                          {savingSummary ? <><HiOutlineRefresh className="w-3.5 h-3.5 animate-spin" /> Menyimpan...</> : <><HiOutlineCheck className="w-3.5 h-3.5" /> Simpan</>}
                        </button>
                      </div>
                    </div>
                  )}
                  {!editingSummary && (
                    <div className="p-4 text-sm text-gray-700 max-h-[60vh] overflow-y-auto leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }} />
                  )}
                </>
              ) : (
                <div className="p-12 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
                    <HiOutlineDocumentText className="w-7 h-7 text-gray-300" />
                  </div>
                  <p className="text-gray-500 font-medium">Ringkasan belum dibuat</p>
                  <p className="text-xs text-gray-400 mt-1">Klik "Buat Ringkasan" untuk generate dengan AI</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column - Tanya AI (hidden on mobile, shown on lg+) */}
        <div className="hidden lg:block w-80 xl:w-96 shrink-0">
          {renderAIPanel("h-[calc(100vh-220px)] sticky top-4")}
        </div>
      </div>

      {/* Mobile: Tanya AI as collapsible panel */}
      <div className="lg:hidden">
        <button
          onClick={() => setMobileAiOpen(!mobileAiOpen)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-100 rounded-2xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-all"
        >
          <HiOutlineChatAlt2 className="w-5 h-5 text-primary-500" />
          {mobileAiOpen ? 'Tutup Tanya AI' : 'Tanya AI'}
          {messages.length > 0 && (
            <span className="bg-primary-100 text-primary-700 text-xs font-medium px-2 py-0.5 rounded-full">{messages.length}</span>
          )}
        </button>
        {mobileAiOpen && (
          <div className="mt-2">
            {renderAIPanel("h-[400px]")}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editSession && (
        <EditModal
          session={editSession}
          folders={folders}
          onClose={() => setEditSession(null)}
          onSaved={() => { setEditSession(null); refreshSession(); }}
        />
      )}
    </div>
  );
}
