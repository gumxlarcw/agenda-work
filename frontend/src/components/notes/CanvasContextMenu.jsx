import { useEffect, useRef } from 'react';
import {
  HiOutlinePlus,
  HiOutlineRefresh,
  HiOutlineZoomIn,
  HiOutlineTrash,
  HiOutlinePencil,
  HiOutlineStar,
  HiOutlineArchive,
  HiOutlineArrowRight,
} from 'react-icons/hi';

export default function CanvasContextMenu({ menu, onClose, onAction, readOnly = false }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!menu) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menu, onClose]);

  if (!menu) return null;

  const items = menu.type === 'note'
    ? [
        { key: 'edit', label: 'Edit', icon: HiOutlinePencil },
        { key: 'pin', label: menu.note?.is_pinned ? 'Unpin' : 'Pin', icon: HiOutlineStar },
        ...(!readOnly ? [
          { key: 'archive', label: 'Arsipkan', icon: HiOutlineArchive },
          { key: 'connect', label: 'Hubungkan', icon: HiOutlineArrowRight },
          { key: 'divider' },
          { key: 'delete', label: 'Hapus', icon: HiOutlineTrash, danger: true },
        ] : []),
      ]
    : [
        ...(!readOnly ? [
          { key: 'create', label: 'Buat catatan di sini', icon: HiOutlinePlus },
          { key: 'resetLayout', label: 'Reset layout', icon: HiOutlineRefresh },
        ] : []),
        { key: 'fitAll', label: 'Fit semua', icon: HiOutlineZoomIn },
      ];

  return (
    <div
      ref={ref}
      className="fixed z-[200] bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[180px] animate-fadeIn"
      style={{ left: menu.clientX, top: menu.clientY }}
    >
      {items.map(item =>
        item.key === 'divider' ? (
          <div key="divider" className="border-t border-gray-100 my-1" />
        ) : (
          <button
            key={item.key}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${
              item.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700'
            }`}
            onClick={() => { onAction(item.key, menu); onClose(); }}
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
