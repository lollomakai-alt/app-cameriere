import React, { useEffect, useState } from "react";
import { Plus, Trash2, Combine, Scissors, Check, Pencil, Users } from "lucide-react";

interface MapEditBarProps {
  selectedCount: number;
  canSplit: boolean;
  /** Tavolo singolo selezionato (per rinomina / coperti). */
  single: { id: string; label: string; seats: number } | null;
  onAddTable: () => void;
  onDeleteTables: () => void;
  onMergeTables: () => void;
  onSplitTable: () => void;
  onRename: (id: string, label: string) => void;
  onSeats: (id: string, seats: number) => void;
  onDone: () => void;
}

const btn =
  "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors disabled:opacity-25 disabled:cursor-not-allowed active:scale-95";

/** Toolbar compatta di modifica mappa, ancorata in basso. */
export const MapEditBar: React.FC<MapEditBarProps> = ({
  selectedCount,
  canSplit,
  single,
  onAddTable,
  onDeleteTables,
  onMergeTables,
  onSplitTable,
  onRename,
  onSeats,
  onDone,
}) => {
  const [label, setLabel] = useState(single?.label ?? "");
  const [seats, setSeats] = useState(String(single?.seats ?? 4));

  useEffect(() => {
    setLabel(single?.label ?? "");
    setSeats(String(single?.seats ?? 4));
  }, [single?.id, single?.label, single?.seats]);

  return (
    <div
      data-keep-open
      className="pointer-events-auto flex max-w-full flex-col gap-1.5 rounded-2xl border border-amber-500/40 bg-slate-950/95 px-2 py-2 shadow-[0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl"
    >
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <button onClick={onAddTable} className={`${btn} border-emerald-500/40 bg-emerald-500/10 text-emerald-300`}>
          <Plus className="h-3.5 w-3.5" /> Aggiungi
        </button>
        <button
          onClick={onMergeTables}
          disabled={selectedCount < 2}
          className={`${btn} border-cyan-500/40 bg-cyan-500/10 text-cyan-300`}
        >
          <Combine className="h-3.5 w-3.5" /> Unisci
        </button>
        <button
          onClick={onSplitTable}
          disabled={!canSplit}
          className={`${btn} border-purple-500/40 bg-purple-500/10 text-purple-300`}
        >
          <Scissors className="h-3.5 w-3.5" /> Dividi
        </button>
        <button
          onClick={onDeleteTables}
          disabled={selectedCount < 1}
          className={`${btn} border-rose-500/40 bg-rose-500/10 text-rose-300`}
        >
          <Trash2 className="h-3.5 w-3.5" /> Elimina
        </button>
        <button onClick={onDone} className={`${btn} border-slate-700 bg-slate-900 text-slate-300`}>
          <Check className="h-3.5 w-3.5" /> Fine
        </button>
      </div>

      {single && (
        <div className="flex items-center justify-center gap-1.5 border-t border-slate-800 pt-1.5">
          <Pencil className="h-3 w-3 shrink-0 text-amber-400" />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label.trim() && label !== single.label && onRename(single.id, label.trim())}
            onKeyDown={(e) => e.key === "Enter" && label.trim() && onRename(single.id, label.trim())}
            className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-semibold text-slate-100 outline-none focus:border-amber-400"
            placeholder="Nome"
          />
          <Users className="ml-1 h-3 w-3 shrink-0 text-cyan-400" />
          <input
            type="number"
            min={1}
            max={40}
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            onBlur={() => {
              const n = Number(seats);
              if (Number.isFinite(n) && n > 0 && n !== single.seats) onSeats(single.id, n);
            }}
            className="w-14 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-semibold text-slate-100 outline-none focus:border-cyan-400"
          />
          <span className="text-[10px] text-slate-500">posti</span>
        </div>
      )}
    </div>
  );
};
