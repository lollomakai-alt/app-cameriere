import React from "react";
import { AlertTriangle } from "lucide-react";
import { statusStyle, tableSpan, type PosTable, type TableStatus } from "@/futures/live-map/components/TableCard";

interface TableListMobileProps {
  tables: PosTable[];
  onTap: (id: string) => void;
  isMultiSelected: (id: string) => boolean;
  editMode?: boolean;
  /** Stato sintetico + alert calcolati dai check piatto, uguale a quanto usato sulla mappa canvas. */
  courseInfoFor: (id: string) => { statusOverride?: TableStatus; alert: boolean };
}

/**
 * Vista alternativa per telefono: niente mappa spaziale trascinabile (troppo piccola per
 * essere comoda su schermo stretto), solo un elenco verticale di tavoli. Un tap apre lo
 * stesso TableModal/OrderManager della mappa canvas su iPad.
 */
export const TableListMobile: React.FC<TableListMobileProps> = ({
  tables,
  onTap,
  isMultiSelected,
  editMode,
  courseInfoFor,
}) => {
  const sorted = [...tables].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  if (sorted.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center px-6">
        <p className="text-xs font-semibold text-slate-300">Nessun tavolo in questa sala</p>
        <p className="text-[11px] text-slate-500">
          Attiva "Modifica mappa" e premi Aggiungi per creare il primo tavolo.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-y-auto p-3">
      {sorted.map((t) => {
        const info = t.status === "occupied" ? courseInfoFor(String(t.id)) : { statusOverride: undefined, alert: false };
        const effectiveStatus = info.statusOverride ?? t.status;
        const style = statusStyle[effectiveStatus] || statusStyle.free!;
        const selected = isMultiSelected(t.id);
        const span = tableSpan(t);

        return (
          <button
            key={t.id}
            onClick={() => onTap(String(t.id))}
            className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 min-h-[64px] text-left backdrop-blur-md transition-all active:scale-[0.98] ${style.bg} ${style.border} ${
              selected ? "ring-4 ring-purple-400 border-purple-400" : ""
            } ${info.alert ? "ring-4 ring-red-500 animate-pulse" : ""}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/70 text-sm font-black text-slate-100">
                {t.label}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-black uppercase tracking-wide ${style.text}`}>{style.label}</span>
                  {info.alert && <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                  {span > 1 && (
                    <span className="rounded-md border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-300">
                      ×{span}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-slate-400">{t.seats ?? 4} posti</span>
              </div>
            </div>

            {editMode && (
              <span
                className={`shrink-0 h-6 w-6 rounded-full border-2 flex items-center justify-center ${
                  selected ? "border-purple-400 bg-purple-500/30" : "border-slate-600"
                }`}
              >
                {selected && <span className="h-2.5 w-2.5 rounded-full bg-purple-300" />}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
