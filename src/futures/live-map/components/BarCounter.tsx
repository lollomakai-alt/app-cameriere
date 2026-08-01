import React from "react";
import { Beer, Plus, X, Receipt } from "lucide-react";
import type { PosTable } from "@/lib/tables-api";

/** Come si legge lo stato di un conto al bancone (lo aggiornerà l'app del tablet in cucina). */
const statusMeta: Record<string, { label: string; className: string; dot: string }> = {
  preparing: {
    label: "in preparazione",
    className: "border-orange-500/40 bg-orange-500/10 text-orange-300",
    dot: "bg-orange-400",
  },
  ready: {
    label: "pronto da ritirare",
    className: "border-purple-500/50 bg-purple-500/15 text-purple-300",
    dot: "bg-purple-400",
  },
  occupied: {
    label: "al banco",
    className: "border-amber-500/30 bg-slate-950 text-amber-300",
    dot: "bg-amber-400",
  },
};

interface BarCounterPanelProps {
  tabs: PosTable[];
  isCreating: boolean;
  onOpenTab: (tab: PosTable) => void;
  onNewTab: () => void;
  onClose: () => void;
}

/** Pannello dei conti al banco: più clienti contemporanei, ognuno con il proprio conto. */
export const BarCounterPanel: React.FC<BarCounterPanelProps> = ({
  tabs,
  isCreating,
  onOpenTab,
  onNewTab,
  onClose,
}) => {
  const sorted = [...tabs].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-3xl border border-amber-500/40 bg-slate-950 shadow-[0_0_50px_rgba(245,158,11,0.25)] text-slate-100">
        <div className="flex items-center justify-between border-b border-amber-500/20 bg-slate-900/80 px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-400">
              <Beer className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-amber-300">Banco Bar</h3>
              <p className="text-[11px] text-slate-400">
                {sorted.length === 0
                  ? "Nessun conto aperto al bancone"
                  : `${sorted.length} cont${sorted.length === 1 ? "o aperto" : "i aperti"}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800 active:scale-95 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Receipt className="w-8 h-8 text-slate-700" />
              <p className="text-xs font-bold text-slate-400">Nessun cliente al banco</p>
              <p className="text-[11px] text-slate-600">
                Apri un conto per il primo cliente con il pulsante qui sotto.
              </p>
            </div>
          ) : (
            sorted.map((tab) => {
              const meta = statusMeta[tab.status] ?? statusMeta.occupied!;
              const isReady = tab.status === "ready";
              return (
                <button
                  key={tab.id}
                  onClick={() => onOpenTab(tab)}
                  className={`w-full flex items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 min-h-[56px] text-left active:scale-[0.98] transition-all ${
                    isReady
                      ? "border-purple-400 bg-purple-950/20 shadow-[0_0_20px_rgba(168,85,247,0.3)] hover:bg-purple-950/30"
                      : "border-amber-500/30 bg-amber-950/10 hover:border-amber-400 hover:bg-amber-950/20"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm font-black ${
                        isReady
                          ? "border-purple-400/50 bg-purple-500/15 text-purple-300"
                          : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                      }`}
                    >
                      {tab.label.replace(/\D/g, "")}
                    </span>
                    <div className="min-w-0">
                      <span className="block text-sm font-bold text-white truncate">{tab.label}</span>
                      <span className="flex items-center gap-1.5 mt-0.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          {meta.label}
                        </span>
                      </span>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${meta.className}`}
                  >
                    {isReady ? "Ritira" : "Apri conto"}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="border-t border-amber-500/20 p-4 shrink-0">
          <button
            onClick={onNewTab}
            disabled={isCreating}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed py-3.5 min-h-[52px] text-xs font-black text-slate-950 uppercase tracking-wide shadow-[0_0_20px_rgba(245,158,11,0.4)] active:scale-95 transition-all"
          >
            <Plus className="w-4 h-4" />
            {isCreating ? "Apertura in corso…" : "Nuovo cliente al banco"}
          </button>
        </div>
      </div>
    </div>
  );
};
