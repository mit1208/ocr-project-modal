'use client';

type IMEExportProps = {
  disabled?: boolean;
  onExport: (format: 'pdf' | 'word') => Promise<void> | void;
};

export default function IMEExport({ disabled, onExport }: IMEExportProps) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Export</div>
      <p className="mt-2 text-sm text-slate-600">Download the assembled IME summary as a PDF or Word-compatible document.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => onExport('pdf')}
          disabled={disabled}
          className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 disabled:opacity-50"
        >
          Export PDF
        </button>
        <button
          onClick={() => onExport('word')}
          disabled={disabled}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          Export Word
        </button>
      </div>
    </div>
  );
}
