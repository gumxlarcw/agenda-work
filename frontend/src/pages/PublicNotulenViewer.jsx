import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { HiOutlineDocumentText, HiOutlineClock } from 'react-icons/hi';
import { notulenAPI } from '../services/api';

function formatTanggal(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d)) return val;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}j ${m}m`;
  if (m > 0) return `${m}m ${s}d`;
  return `${s}d`;
}

// Safe: escapes all HTML entities before adding markup (same pattern as NotulenAI.jsx)
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

export default function PublicNotulenViewer() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('summary');

  useEffect(() => {
    async function load() {
      try {
        const res = await notulenAPI.getPublicSession(token);
        setData(res.data.data);
      } catch (err) {
        setError(err.response?.status === 404 ? 'Link tidak valid atau sudah dihapus.' : 'Gagal memuat notulen.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-400 text-sm">Memuat notulen...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-8 max-w-sm w-full text-center">
          <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <HiOutlineDocumentText className="w-7 h-7 text-gray-300" />
          </div>
          <p className="text-gray-600 font-medium">{error}</p>
        </div>
      </div>
    );
  }

  const session = data;
  const segments = session.segments || [];
  const summary = session.summary || '';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        {/* Header */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-lg shadow-primary-200 shrink-0">
              <HiOutlineDocumentText className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold text-gray-900">{session.judul}</h1>
              {session.sub_judul && <p className="text-sm text-gray-500 mt-0.5">{session.sub_judul}</p>}
              <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400 flex-wrap">
                <span>{formatTanggal(session.tanggal)}</span>
                <span>{session.pencatat}</span>
                <span>{session.instansi}</span>
                {session.duration_seconds > 0 && (
                  <span className="flex items-center gap-0.5">
                    <HiOutlineClock className="w-3 h-3" />{formatDuration(session.duration_seconds)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1">
          {[
            { key: 'summary', label: summary ? 'Ringkasan' : 'Ringkasan (belum)' },
            { key: 'transcript', label: `Transkrip (${segments.length})` },
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

        {/* Summary */}
        {activeTab === 'summary' && (
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            {summary ? (
              /* Safe: renderMarkdown escapes all HTML entities before adding markup */
              <div className="p-4 text-sm text-gray-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }} />
            ) : (
              <div className="p-12 text-center">
                <p className="text-gray-400">Ringkasan belum tersedia.</p>
              </div>
            )}
          </div>
        )}

        {/* Transcript */}
        {activeTab === 'transcript' && (
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <div className="p-4 max-h-[70vh] overflow-y-auto">
              {segments.length === 0 ? (
                <p className="text-gray-300 italic text-sm">Tidak ada segmen</p>
              ) : segments.map(s => {
                const m = Math.floor((s.timestamp_seconds || 0) / 60).toString().padStart(2, '0');
                const sc = Math.floor((s.timestamp_seconds || 0) % 60).toString().padStart(2, '0');
                return (
                  <div key={s.id} className="flex items-baseline gap-2 py-1.5 border-b border-gray-50 last:border-0">
                    <span className="text-primary-500 font-mono text-xs font-semibold whitespace-nowrap">[{m}:{sc}]</span>
                    <span className="flex-1 text-gray-700 text-sm leading-relaxed">{s.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-300 pt-4">Notulen AI &mdash; BPS Provinsi Maluku Utara</p>
      </div>
    </div>
  );
}
