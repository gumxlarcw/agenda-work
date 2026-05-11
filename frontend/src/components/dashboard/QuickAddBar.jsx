import { useState, useRef, useEffect } from 'react';
import { HiOutlinePlus, HiOutlineClipboardList, HiOutlinePencilAlt, HiOutlineBell, HiOutlineX } from 'react-icons/hi';
import { tasksAPI, notesAPI, remindersAPI } from '../../services/api';
import toast from 'react-hot-toast';
import { glassCard } from './BentoGrid';

function QuickModal({ type, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('P2');
  const [datetime, setDatetime] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      if (type === 'task') {
        await tasksAPI.create({ task: title.trim(), priority, status: 'Pending' });
      } else if (type === 'note') {
        await notesAPI.create({ title: title.trim(), content: '' });
      } else {
        await remindersAPI.create({ title: title.trim(), reminder_datetime: datetime || new Date().toISOString() });
      }
      toast.success(`${type === 'task' ? 'Task' : type === 'note' ? 'Note' : 'Reminder'} dibuat!`);
      onCreated();
      onClose();
    } catch {
      toast.error('Gagal membuat item');
    } finally {
      setSaving(false);
    }
  };

  const labels = { task: 'New Task', note: 'New Note', reminder: 'New Reminder' };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-5 space-y-3 animate-fadeIn"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{labels[type]}</h3>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <HiOutlineX className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={type === 'task' ? 'Nama task...' : type === 'note' ? 'Judul catatan...' : 'Judul reminder...'}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
        />
        {type === 'task' && (
          <div className="flex gap-2">
            {['P0','P1','P2','P3'].map(p => (
              <button key={p} type="button" onClick={() => setPriority(p)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${priority === p ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-gray-200 text-gray-500'}`}
              >{p}</button>
            ))}
          </div>
        )}
        {type === 'reminder' && (
          <input
            type="datetime-local"
            value={datetime}
            onChange={e => setDatetime(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        )}
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Menyimpan...' : 'Buat'}
        </button>
      </form>
    </div>
  );
}

export default function QuickAddBar({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(null);

  const actions = [
    { type: 'task', icon: HiOutlineClipboardList, label: 'Task', color: 'hover:bg-blue-50 hover:text-blue-600' },
    { type: 'note', icon: HiOutlinePencilAlt, label: 'Note', color: 'hover:bg-purple-50 hover:text-purple-600' },
    { type: 'reminder', icon: HiOutlineBell, label: 'Reminder', color: 'hover:bg-orange-50 hover:text-orange-600' },
  ];

  return (
    <>
      <div className={`${glassCard} p-3 hidden sm:flex items-center justify-center gap-3`}>
        {actions.map(a => (
          <button key={a.type} onClick={() => setModal(a.type)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-600 transition-colors ${a.color}`}
          >
            <a.icon className="w-4 h-4" />
            + {a.label}
          </button>
        ))}
      </div>

      <div className="sm:hidden fixed bottom-6 right-6 z-40">
        {open && (
          <div className="absolute bottom-14 right-0 flex flex-col gap-2 items-end animate-fadeIn">
            {actions.map(a => (
              <button key={a.type} onClick={() => { setModal(a.type); setOpen(false); }}
                className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-full shadow-lg text-sm font-medium text-gray-700"
              >
                <a.icon className="w-4 h-4" />
                {a.label}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setOpen(!open)}
          className={`w-14 h-14 rounded-full bg-indigo-600 text-white shadow-xl flex items-center justify-center transition-transform ${open ? 'rotate-45' : ''}`}
        >
          <HiOutlinePlus className="w-6 h-6" />
        </button>
      </div>

      {modal && <QuickModal type={modal} onClose={() => setModal(null)} onCreated={onCreated} />}
    </>
  );
}
