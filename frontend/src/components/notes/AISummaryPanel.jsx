import { useState, useEffect } from 'react';
import { HiOutlineSparkles, HiOutlineRefresh, HiOutlineChevronDown, HiOutlineChevronUp } from 'react-icons/hi';
import toast from 'react-hot-toast';

export default function AISummaryPanel({ noteId, summary, onSummarize }) {
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(!!summary);
  const [currentSummary, setCurrentSummary] = useState(summary || '');

  // Sync when summary prop changes (e.g. re-opening panel after regeneration)
  useEffect(() => {
    if (summary) {
      setCurrentSummary(summary);
      setExpanded(true);
    }
  }, [summary]);

  const handleSummarize = async () => {
    setLoading(true);
    try {
      const result = await onSummarize(noteId);
      if (!result || !result.trim()) {
        toast.error('Ringkasan kosong — coba tambahkan konten terlebih dahulu');
        return;
      }
      setCurrentSummary(result);
      setExpanded(true);
      toast.success('Ringkasan berhasil dibuat');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal membuat ringkasan');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => currentSummary ? setExpanded(!expanded) : handleSummarize()}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <HiOutlineSparkles className="w-4 h-4 text-purple-500" />
        <span className="text-sm font-medium text-gray-700 flex-1">
          AI Summary
        </span>
        {loading ? (
          <div className="w-4 h-4 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
        ) : currentSummary ? (
          expanded ? <HiOutlineChevronUp className="w-4 h-4 text-gray-400" /> : <HiOutlineChevronDown className="w-4 h-4 text-gray-400" />
        ) : (
          <span className="text-xs text-purple-600">Generate</span>
        )}
      </button>

      {expanded && currentSummary && (
        <div className="px-4 py-3 border-t border-gray-200">
          <div className="text-sm text-gray-700 whitespace-pre-wrap">{currentSummary}</div>
          <button
            onClick={handleSummarize}
            disabled={loading}
            className="mt-2 flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800 transition-colors"
          >
            <HiOutlineRefresh className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Generating...' : 'Regenerate'}
          </button>
        </div>
      )}
    </div>
  );
}
