export default function ConfirmDialog({ dialog, onClose }) {
  if (!dialog) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl animate-fadeIn">
        <div className="p-6">
          <p className="text-gray-800 text-sm">{dialog.message}</p>
        </div>
        <div className="flex justify-end gap-2 px-6 pb-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Batal
          </button>
          <button
            onClick={() => { dialog.onConfirm(); onClose(); }}
            className={`px-4 py-2 text-sm text-white rounded-lg transition-colors ${
              dialog.confirmColor === 'red'
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-primary-600 hover:bg-primary-700'
            }`}
          >
            {dialog.confirmLabel || 'Ya'}
          </button>
        </div>
      </div>
    </div>
  );
}
