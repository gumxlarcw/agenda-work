import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import StatusCell, { PRESETS } from './extensions/StatusCell.jsx';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  HiOutlinePhotograph, HiOutlineTrash, HiOutlinePlus, HiOutlineMinus,
  HiOutlineViewBoards, HiOutlineX,
} from 'react-icons/hi';

// Toolbar button component
function ToolbarButton({ onClick, active, disabled, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded text-sm font-medium transition-colors ${
        active
          ? 'bg-primary-100 text-primary-700'
          : 'text-gray-600 hover:bg-gray-100'
      } ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );
}

// Toolbar separator
function Sep() {
  return <div className="w-px h-5 bg-gray-200 mx-0.5" />;
}

// Table size picker — hover grid to pick rows x columns
function TableSizePicker({ onInsert, onClose }) {
  const [hoverRow, setHoverRow] = useState(0);
  const [hoverCol, setHoverCol] = useState(0);
  const maxRows = 8;
  const maxCols = 8;

  return (
    <div
      className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl p-3 z-50"
      onMouseLeave={() => { setHoverRow(0); setHoverCol(0); }}
    >
      <div className="text-xs text-gray-500 mb-2 text-center font-medium">
        {hoverRow > 0 ? `${hoverRow} × ${hoverCol}` : 'Pilih ukuran tabel'}
      </div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${maxCols}, 1fr)` }}>
        {Array.from({ length: maxRows * maxCols }, (_, i) => {
          const r = Math.floor(i / maxCols) + 1;
          const c = (i % maxCols) + 1;
          const isHighlighted = r <= hoverRow && c <= hoverCol;
          return (
            <div
              key={i}
              className={`w-5 h-5 rounded-sm border cursor-pointer transition-colors ${
                isHighlighted
                  ? 'bg-primary-400 border-primary-500'
                  : 'bg-gray-50 border-gray-200 hover:border-gray-300'
              }`}
              onMouseEnter={() => { setHoverRow(r); setHoverCol(c); }}
              onClick={() => { onInsert(r, c); onClose(); }}
            />
          );
        })}
      </div>
    </div>
  );
}

// Floating table toolbar — appears when cursor is inside a table
// Vertical table sidebar — sits on the left of editor, scrolls with viewport
function TableToolbar({ editor }) {
  const [showStatusPick, setShowStatusPick] = useState(false);
  if (!editor || !editor.isActive('table')) return null;

  const btn = (onClick, title, children, danger = false) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-lg transition-colors ${
        danger
          ? 'text-red-500 hover:bg-red-50'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  );

  const label = (text) => <span className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider px-1 pt-1">{text}</span>;
  const sep = <div className="h-px w-full bg-gray-100 my-0.5" />;

  return (
    <div className="flex flex-col items-center gap-0.5 py-2 animate-fadeIn">
      {label('Baris')}
      {btn(() => editor.chain().focus().addRowBefore().run(), 'Tambah baris di atas',
        <span className="text-xs">+↑</span>
      )}
      {btn(() => editor.chain().focus().addRowAfter().run(), 'Tambah baris di bawah',
        <span className="text-xs">+↓</span>
      )}
      {btn(() => editor.chain().focus().deleteRow().run(), 'Hapus baris',
        <HiOutlineMinus className="w-3.5 h-3.5" />, true
      )}

      {sep}

      {label('Kolom')}
      {btn(() => editor.chain().focus().addColumnBefore().run(), 'Tambah kolom kiri',
        <span className="text-xs">+←</span>
      )}
      {btn(() => editor.chain().focus().addColumnAfter().run(), 'Tambah kolom kanan',
        <span className="text-xs">+→</span>
      )}
      {btn(() => editor.chain().focus().deleteColumn().run(), 'Hapus kolom',
        <HiOutlineMinus className="w-3.5 h-3.5" />, true
      )}

      {sep}

      {label('Sel')}
      {btn(() => editor.chain().focus().toggleHeaderRow().run(), 'Toggle header',
        <span className="text-[11px] font-bold">H</span>
      )}
      {btn(() => editor.chain().focus().mergeCells().run(), 'Gabung sel',
        <span className="text-[11px]">⊞</span>
      )}
      {btn(() => editor.chain().focus().splitCell().run(), 'Pisah sel',
        <span className="text-[11px]">⊟</span>
      )}

      {sep}

      {label('Align')}
      {btn(() => editor.chain().focus().setTextAlign('left').run(), 'Rata kiri',
        <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="currentColor"><path d="M0 1h12v1.5H0zm0 3h7v1.5H0zm0 3h12v1.5H0zm0 3h7v1.5H0z"/></svg>
      )}
      {btn(() => editor.chain().focus().setTextAlign('center').run(), 'Rata tengah',
        <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="currentColor"><path d="M0 1h12v1.5H0zm2.5 3h7v1.5h-7zM0 7h12v1.5H0zm2.5 3h7v1.5h-7z"/></svg>
      )}
      {btn(() => editor.chain().focus().setTextAlign('right').run(), 'Rata kanan',
        <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="currentColor"><path d="M0 1h12v1.5H0zm5 3h7v1.5H5zM0 7h12v1.5H0zm5 3h7v1.5H5z"/></svg>
      )}

      {sep}

      {/* Insert status badge — with preset picker */}
      <div className="relative">
        {btn(() => setShowStatusPick(!showStatusPick), 'Insert status badge',
          <span className="text-[10px] font-bold">○◐●</span>
        )}
        {showStatusPick && (
          <StatusPresetPicker
            onInsert={(steps) => { editor.chain().focus().insertStatusCell({ steps }).run(); setShowStatusPick(false); }}
            onClose={() => setShowStatusPick(false)}
          />
        )}
      </div>

      {sep}

      {/* Delete table */}
      {btn(() => editor.chain().focus().deleteTable().run(), 'Hapus tabel',
        <HiOutlineTrash className="w-3.5 h-3.5" />,
        true
      )}
    </div>
  );
}

// Status preset picker popup
const STEP_COLORS = [
  { color: '#9ca3af', bg: '#f3f4f6', name: 'Abu' },
  { color: '#6366f1', bg: '#e0e7ff', name: 'Indigo' },
  { color: '#3b82f6', bg: '#dbeafe', name: 'Biru' },
  { color: '#22c55e', bg: '#dcfce7', name: 'Hijau' },
  { color: '#f59e0b', bg: '#fef3c7', name: 'Kuning' },
  { color: '#ef4444', bg: '#fee2e2', name: 'Merah' },
  { color: '#a855f7', bg: '#f3e8ff', name: 'Ungu' },
  { color: '#ec4899', bg: '#fce7f3', name: 'Pink' },
];
const STEP_ICONS = ['○','◐','●','✎','◎','↑','✓','✗','→','△','▽','◇','★','—','⊕','⊘'];

function StatusPresetPicker({ onInsert, onClose }) {
  const [mode, setMode] = useState('presets'); // 'presets' | 'custom'
  const [customSteps, setCustomSteps] = useState([
    { key: 'step_0', label: 'Belum', icon: '○', color: '#9ca3af', bg: '#f3f4f6' },
    { key: 'step_1', label: '', icon: '◐', color: '#f59e0b', bg: '#fef3c7' },
    { key: 'step_2', label: 'Selesai', icon: '●', color: '#22c55e', bg: '#dcfce7' },
  ]);

  const updateStep = (idx, field, value) => {
    setCustomSteps(prev => prev.map((s, i) => {
      if (i !== idx) return s;
      if (field === 'colorIdx') {
        const c = STEP_COLORS[value];
        return { ...s, color: c.color, bg: c.bg };
      }
      return { ...s, [field]: value };
    }));
  };

  const addStep = () => {
    const n = customSteps.length;
    const c = STEP_COLORS[Math.min(n, STEP_COLORS.length - 1)];
    setCustomSteps(prev => [...prev, { key: `step_${n}`, label: '', icon: '○', color: c.color, bg: c.bg }]);
  };

  const removeStep = (idx) => {
    if (customSteps.length <= 2) return;
    setCustomSteps(prev => prev.filter((_, i) => i !== idx));
  };

  const handleInsertCustom = () => {
    const valid = customSteps.map((s, i) => ({
      ...s,
      key: s.key || `step_${i}`,
      label: s.label.trim() || `Tahap ${i + 1}`,
    }));
    if (valid.length >= 2) {
      onInsert(valid);
      onClose();
    }
  };

  if (mode === 'custom') {
    return (
      <div
        className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl p-3 z-50 w-72 animate-fadeIn"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-700">Custom Status</p>
          <button type="button" onClick={() => setMode('presets')} className="text-[10px] text-primary-500 hover:text-primary-700">← Preset</button>
        </div>

        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {customSteps.map((step, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              {/* Icon picker */}
              <select
                value={step.icon}
                onChange={e => updateStep(idx, 'icon', e.target.value)}
                className="w-8 text-center text-sm border border-gray-200 rounded px-0 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-400"
              >
                {STEP_ICONS.map(ic => <option key={ic} value={ic}>{ic}</option>)}
              </select>
              {/* Label */}
              <input
                value={step.label}
                onChange={e => updateStep(idx, 'label', e.target.value)}
                placeholder={`Tahap ${idx + 1}`}
                className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-400"
              />
              {/* Color picker */}
              <select
                value={STEP_COLORS.findIndex(c => c.color === step.color)}
                onChange={e => updateStep(idx, 'colorIdx', parseInt(e.target.value))}
                className="w-7 text-center border border-gray-200 rounded py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-400"
                style={{ backgroundColor: step.bg, color: step.color }}
              >
                {STEP_COLORS.map((c, ci) => <option key={ci} value={ci} style={{ backgroundColor: c.bg, color: c.color }}>●</option>)}
              </select>
              {/* Remove */}
              <button
                type="button"
                onClick={() => removeStep(idx)}
                disabled={customSteps.length <= 2}
                className="p-0.5 text-gray-300 hover:text-red-500 disabled:opacity-20 transition-colors"
              >
                <HiOutlineX className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addStep}
          className="w-full mt-2 flex items-center justify-center gap-1 text-[10px] text-primary-500 hover:text-primary-700 hover:bg-primary-50 rounded-lg py-1 transition-colors"
        >
          <HiOutlinePlus className="w-3 h-3" /> Tambah tahap
        </button>

        {/* Preview */}
        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-1 flex-wrap">
          {customSteps.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border"
              style={{ backgroundColor: s.bg, color: s.color, borderColor: s.color }}>
              {s.icon} {s.label || `Tahap ${i+1}`}
            </span>
          ))}
        </div>

        <button
          type="button"
          onClick={handleInsertCustom}
          disabled={customSteps.length < 2}
          className="w-full mt-2 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white text-xs font-semibold rounded-lg transition-all"
        >
          Insert Status Badge
        </button>
      </div>
    );
  }

  return (
    <div
      className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl p-2 z-50 w-56 animate-fadeIn"
      onMouseLeave={onClose}
    >
      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider px-2 mb-1">Pilih tipe status</p>
      {PRESETS.map(preset => (
        <button
          key={preset.id}
          type="button"
          onClick={() => { onInsert(preset.steps); onClose(); }}
          className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2 group"
        >
          <div className="flex items-center gap-0.5">
            {preset.steps.map(s => (
              <span key={s.key} className="text-xs" style={{ color: s.color }}>{s.icon}</span>
            ))}
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium text-gray-700">{preset.name}</span>
            <span className="text-[10px] text-gray-400 ml-1">({preset.steps.length} tahap)</span>
          </div>
        </button>
      ))}
      <div className="border-t border-gray-100 mt-1 pt-1">
        <button
          type="button"
          onClick={() => setMode('custom')}
          className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-primary-50 transition-colors flex items-center gap-2 text-primary-600"
        >
          <HiOutlinePlus className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">Custom...</span>
        </button>
      </div>
    </div>
  );
}

export default function NoteEditor({ content, onChange, onImageUpload, editable = true, editorColor }) {
  const fileInputRef = useRef(null);
  const editorAreaRef = useRef(null);
  const initializedRef = useRef(false);
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [isInTable, setIsInTable] = useState(false);
  const [toolbarPos, setToolbarPos] = useState(null);
  // F4/F6: Use refs to avoid stale closures in useEditor callbacks
  const onChangeRef = useRef(onChange);
  const onImageUploadRef = useRef(onImageUpload);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onImageUploadRef.current = onImageUpload; }, [onImageUpload]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true, lastColumnResizable: true, allowTableNodeSelection: true }),
      TableRow,
      TableCell,
      TableHeader,
      Image.configure({ inline: false, allowBase64: false }),
      TextAlign.configure({ types: ['heading', 'paragraph', 'tableCell', 'tableHeader'] }),
      Highlight.configure({ multicolor: false }),
      Placeholder.configure({ placeholder: 'Tulis catatan...' }),
      CharacterCount,
      StatusCell,
    ],
    content: content || '',
    editable,
    onUpdate: ({ editor }) => {
      // Skip the first onUpdate fired by TipTap on initial content load
      if (!initializedRef.current) {
        initializedRef.current = true;
        return;
      }
      if (onChangeRef.current) {
        const json = editor.getJSON();
        const text = editor.getText();
        onChangeRef.current(json, text);
      }
    },
  });

  useEffect(() => {
    if (editor) {
      editor.setEditable(editable);
    }
  }, [editable, editor]);

  // Track cursor position — update isInTable + toolbar position
  useEffect(() => {
    if (!editor) return;
    const onSelectionUpdate = () => {
      const inTable = editor.isActive('table');
      setIsInTable(inTable);
      if (inTable && editorAreaRef.current) {
        const rect = editorAreaRef.current.getBoundingClientRect();
        setToolbarPos({ left: rect.left, top: Math.max(rect.top, 80) });
      }
    };
    editor.on('selectionUpdate', onSelectionUpdate);
    editor.on('transaction', onSelectionUpdate);
    return () => {
      editor.off('selectionUpdate', onSelectionUpdate);
      editor.off('transaction', onSelectionUpdate);
    };
  }, [editor]);

  const handleImageClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !onImageUploadRef.current || !editor) return;

    // Frontend file size pre-check (5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Ukuran file maksimal 5MB');
      e.target.value = '';
      return;
    }

    try {
      const url = await onImageUploadRef.current(file);
      if (url) {
        editor.chain().focus().setImage({ src: url }).run();
      }
    } catch (err) {
      console.error('Image upload failed:', err);
    }
    // Reset input
    e.target.value = '';
  }, [editor]);

  const handleInsertTable = useCallback((rows, cols) => {
    if (!editor) return;
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
  }, [editor]);

  if (!editor) return null;

  // Toolbar bg — match editor color or default to gray-50
  const toolbarBg = editorColor && editorColor !== '#ffffff' ? editorColor : undefined;

  return (
    <div className="tiptap-editor border border-gray-200 rounded-lg overflow-visible">
      {/* Toolbar — sticky so it stays visible on scroll */}
      {editable && (
        <div
          className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 rounded-t-lg"
          style={{ backgroundColor: toolbarBg || '#f9fafb' }}
        >
          {/* Text formatting */}
          <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
            <span className="font-bold">B</span>
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
            <span className="italic">I</span>
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} title="Highlight">
            <span className="bg-yellow-200 px-0.5">H</span>
          </ToolbarButton>

          <Sep />

          {/* Headings */}
          <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1">
            H1
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">
            H2
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3">
            H3
          </ToolbarButton>

          <Sep />

          {/* Lists */}
          <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet List">
            &#8226;
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Ordered List">
            1.
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="Checklist">
            &#9745;
          </ToolbarButton>

          <Sep />

          {/* Block elements */}
          <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote">
            &#8220;
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code Block">
            {'</>'}
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal Rule">
            &#8212;
          </ToolbarButton>

          <Sep />

          {/* Text Alignment */}
          <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Rata Kiri">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h14v1.5H1zm0 4h8v1.5H1zm0 4h14v1.5H1zm0 4h8v1.5H1z"/></svg>
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Rata Tengah">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h14v1.5H1zm3 4h8v1.5H4zM1 10h14v1.5H1zm3 4h8v1.5H4z"/></svg>
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Rata Kanan">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h14v1.5H1zm6 4h8v1.5H7zM1 10h14v1.5H1zm6 4h8v1.5H7z"/></svg>
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Rata Kiri-Kanan (Justify)">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h14v1.5H1zm0 4h14v1.5H1zm0 4h14v1.5H1zm0 4h14v1.5H1z"/></svg>
          </ToolbarButton>

          <Sep />

          {/* Table — with size picker */}
          <div className="relative">
            <ToolbarButton
              onClick={() => setShowTablePicker(!showTablePicker)}
              title="Insert Table"
              active={showTablePicker}
            >
              &#9638;
            </ToolbarButton>
            {showTablePicker && (
              <TableSizePicker
                onInsert={handleInsertTable}
                onClose={() => setShowTablePicker(false)}
              />
            )}
          </div>

          {/* Image */}
          <ToolbarButton onClick={handleImageClick} title="Insert Image">
            <HiOutlinePhotograph className="w-4 h-4" />
          </ToolbarButton>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Status Badge — with preset picker */}
          <div className="relative">
            <ToolbarButton
              onClick={() => setShowStatusPicker(!showStatusPicker)}
              active={showStatusPicker}
              title="Insert Status Badge"
            >
              <span className="text-xs">○◐●</span>
            </ToolbarButton>
            {showStatusPicker && (
              <StatusPresetPicker
                onInsert={(steps) => editor.chain().focus().insertStatusCell({ steps }).run()}
                onClose={() => setShowStatusPicker(false)}
              />
            )}
          </div>

          <Sep />

          {/* Undo/Redo */}
          <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo">
            &#8617;
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo">
            &#8618;
          </ToolbarButton>

          {/* Character count */}
          <div className="ml-auto text-xs text-gray-400">
            {editor.storage.characterCount.characters()} karakter
          </div>
        </div>
      )}

      {/* Editor content */}
      <div className="px-4 py-3" ref={editorAreaRef}>
        <EditorContent editor={editor} />
      </div>

      {/* Table toolbar — fixed position outside left edge of editor */}
      {editable && isInTable && toolbarPos && (
        <div
          className="fixed z-50 animate-fadeIn"
          style={{ left: toolbarPos.left - 52, top: toolbarPos.top }}
        >
          <div className="w-11 bg-white border border-gray-200 rounded-xl shadow-lg overflow-y-auto max-h-[70vh]">
            <TableToolbar editor={editor} />
          </div>
        </div>
      )}
    </div>
  );
}
