import { useState, useEffect, useRef, useCallback } from 'react';
import { HiOutlineBell, HiOutlineCheck, HiOutlineShare, HiOutlineCalendar } from 'react-icons/hi';
import { notificationsAPI } from '../services/api';

const TYPE_CONFIG = {
  note_shared: { icon: HiOutlineShare, color: 'text-blue-500 bg-blue-50' },
  event_created: { icon: HiOutlineCalendar, color: 'text-emerald-500 bg-emerald-50' },
  task_assigned: { icon: HiOutlineBell, color: 'text-amber-500 bg-amber-50' },
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m}m lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j lalu`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}h lalu`;
  return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

export default function NotificationBell({ collapsed }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);
  const btnRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const res = await notificationsAPI.getAll({ limit: 20 });
      setNotifications(res.data.data || []);
      setUnreadCount(res.data.unread_count || 0);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target) &&
          btnRef.current && !btnRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleMarkAllRead = async () => {
    try {
      await notificationsAPI.markAllRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
      setUnreadCount(0);
    } catch { /* ignore */ }
  };

  const handleToggle = () => {
    setOpen(!open);
    if (!open) fetchNotifications();
  };

  return (
    <>
      {/* Bell icon button */}
      <button
        ref={btnRef}
        onClick={handleToggle}
        className={`relative p-2 rounded-xl transition-colors ${
          open ? 'bg-white/15 text-white' : 'text-indigo-200/60 hover:text-white hover:bg-white/8'
        }`}
        title="Notifikasi"
      >
        <HiOutlineBell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center ring-2 ring-indigo-900">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel — opens downward, positioned to the right of sidebar */}
      {open && (
        <div
          ref={panelRef}
          className="fixed z-[60] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
          style={{
            width: 320,
            top: 12,
            left: collapsed ? 80 : 272,
          }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Notifikasi</h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-[11px] text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
              >
                <HiOutlineCheck className="w-3 h-3" />
                Tandai semua dibaca
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-gray-50">
            {loading && notifications.length === 0 ? (
              <div className="flex justify-center py-8">
                <div className="w-5 h-5 border-2 border-gray-200 border-t-indigo-500 rounded-full animate-spin" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-8 text-center">
                <HiOutlineBell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-xs text-gray-400">Belum ada notifikasi</p>
              </div>
            ) : (
              notifications.map(n => {
                const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.task_assigned;
                const Icon = cfg.icon;
                return (
                  <div
                    key={n.id}
                    className={`px-4 py-3 flex items-start gap-3 transition-colors ${
                      n.is_read ? 'bg-white hover:bg-gray-50' : 'bg-blue-50/40 hover:bg-blue-50/60'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs leading-snug ${n.is_read ? 'text-gray-600' : 'text-gray-900 font-medium'}`}>
                        {n.title}
                      </p>
                      {n.message && (
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">{n.message}</p>
                      )}
                      <p className="text-[10px] text-gray-300 mt-1">
                        {n.from_name || n.from_username || ''} · {timeAgo(n.created_at)}
                      </p>
                    </div>
                    {!n.is_read && (
                      <span className="w-2 h-2 bg-indigo-500 rounded-full flex-shrink-0 mt-1.5" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );
}
