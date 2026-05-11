import { HiOutlineX, HiOutlineDocumentText, HiOutlineTrash } from 'react-icons/hi';

const TEMPLATE_ICONS = {
  'rapat': '📋',
  'laporan': '📊',
  'lapangan': '🗺️',
  'sop': '📘',
  'default': '📝'
};

export default function TemplateSelector({ templates, onSelect, onDelete, onClose }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Pilih Template</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          {/* Blank note option */}
          <button
            onClick={() => onSelect(null)}
            className="w-full flex items-center gap-3 p-3 rounded-lg border-2 border-dashed border-gray-200 hover:border-primary-300 hover:bg-primary-50 transition-colors mb-3"
          >
            <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-xl">
              ✏️
            </div>
            <div className="text-left">
              <p className="font-medium text-gray-900">Catatan Kosong</p>
              <p className="text-xs text-gray-500">Mulai dari awal</p>
            </div>
          </button>

          {/* Templates grid */}
          {templates.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">Belum ada template. Simpan catatan sebagai template untuk memulai.</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto">
            {templates.map(template => {
              const icon = TEMPLATE_ICONS[template.category] || TEMPLATE_ICONS.default;
              return (
                <div
                  key={template.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-primary-300 hover:bg-primary-50 transition-colors cursor-pointer group relative"
                  onClick={() => onSelect(template)}
                >
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-xl flex-shrink-0">
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium text-gray-900 text-sm truncate">{template.name}</p>
                      {template.is_system ? (
                        <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded flex-shrink-0">System</span>
                      ) : null}
                    </div>
                    {template.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{template.description}</p>
                    )}
                  </div>

                  {/* Delete user template */}
                  {!template.is_system && onDelete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('Hapus template ini?')) onDelete(template.id);
                      }}
                      className="absolute top-2 right-2 p-1 opacity-0 group-hover:opacity-100 hover:bg-red-100 rounded transition-opacity"
                    >
                      <HiOutlineTrash className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
