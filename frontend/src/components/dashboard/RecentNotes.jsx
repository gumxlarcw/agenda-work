import { Link } from 'react-router-dom';
import { HiOutlineArrowRight, HiOutlineDocumentText } from 'react-icons/hi';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { glassCard } from './BentoGrid';

dayjs.extend(relativeTime);

export default function RecentNotes({ notes, loading, error }) {
  if (loading) {
    return (
      <div className={`${glassCard} p-5 animate-pulse`}>
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        {[1,2].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl mb-2" />)}
      </div>
    );
  }

  if (error) {
    return <div className={`${glassCard} p-5 text-center text-gray-400 text-sm`}>Gagal memuat notes.</div>;
  }

  return (
    <div className={`${glassCard} p-5 h-full overflow-hidden flex flex-col`}>
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <HiOutlineDocumentText className="w-4 h-4 text-indigo-400" />
          Recent Notes
        </h3>
        <Link to="/notes" className="text-xs text-indigo-500 hover:text-indigo-600 flex items-center gap-1">
          View all <HiOutlineArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {notes.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">Belum ada catatan.</p>
      ) : (
        <div className="space-y-2 overflow-auto flex-1 min-h-0">
          {notes.map(note => (
            <Link
              key={note.id}
              to="/notes"
              className="block p-3 rounded-xl hover:bg-white/50 transition-colors"
              style={{ borderLeft: `3px solid ${note.color || '#e5e7eb'}` }}
            >
              <p className="text-sm font-medium text-gray-800 truncate">{note.title || 'Untitled'}</p>
              <p className="text-xs text-gray-400 line-clamp-2 mt-0.5">{note.plain_text_preview || ''}</p>
              <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-400">
                {note.folder_name && <span className="text-indigo-400">📁 {note.folder_name}</span>}
                <span>{dayjs(note.updated_at).fromNow()}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
