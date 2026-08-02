import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Utensils, Receipt, X, CalendarCheck, Flame, CheckCircle2 } from "lucide-react";

export type TableStatus = "free" | "reserved" | "preparing" | "ready" | "occupied" | "attesa conto";

export interface PosTable {
  id: string;
  label: string;
  status: TableStatus;
  x: number;
  y: number;
  [key: string]: any;
}

interface TableModalProps {
  table: PosTable | null;
  onClose: () => void;
  onOpenOrder: (tableId: string) => void;
  onFlash: (msg: string) => void;
  onTableUpdated?: () => void;
}

export const TableModal: React.FC<TableModalProps> = ({
  table,
  onClose,
  onOpenOrder,
  onFlash,
  onTableUpdated,
}) => {
  const [reservationData, setReservationData] = useState<any>(null);
  const [loadingReservation, setLoadingReservation] = useState(false);

  // Se il tavolo è riservato, recuperiamo i dettagli della prenotazione da Supabase
  useEffect(() => {
    if (table && table.status === "reserved") {
      fetchReservationDetails();
    } else {
      setReservationData(null);
    }
  }, [table]);

  const fetchReservationDetails = async () => {
    setLoadingReservation(true);
    try {
      const { data, error } = await supabase
        .from("ordini")
        .select("*")
        .eq("tavolo", table?.label)
        .single();

      if (!error && data) {
        setReservationData(data);
      }
    } catch (err) {
      console.error("Errore recupero prenotazione:", err);
    } finally {
      setLoadingReservation(false);
    }
  };

  if (!table) return null;

  // Azione quando si aggiunge l'ordine da una prenotazione:
  // Cancella la prenotazione e sposta lo stato del tavolo in "preparing" (Arancione)
  const handleAddOrderFromReservation = async () => {
    try {
      // 1. Aggiorna lo stato del tavolo a "preparing" (Arancione) su Supabase
      const { error: tableError } = await supabase
        .from("Tables")
        .update({ status: "preparing" })
        .eq("id", table.id);

      if (tableError) throw tableError;

      // 2. Cancella la prenotazione associata
      if (reservationData?.id) {
        await supabase
          .from("ordini")
          .delete()
          .eq("id", reservationData.id);
      }

      onFlash(` Tavolo ${table.label}: Prenotazione convertita in Ordine in Preparazione!`);
      
      if (onTableUpdated) onTableUpdated();
      onClose();
      
      // Apre direttamente la comanda
      onOpenOrder(table.id);
    } catch (err) {
      console.error("Errore conversione prenotazione:", err);
      onFlash("❌ Errore durante l'aggiornamento dello stato.");
    }
  };

  const handleUpdateTableInfo = async (newStatus: TableStatus) => {
    try {
      const { error } = await supabase
        .from("Tables")
        .update({ status: newStatus })
        .eq("id", table.id);

      if (error) throw error;

      onFlash(` Tavolo ${table.label} aggiornato con successo!`);
      if (onTableUpdated) onTableUpdated();
      onClose();
    } catch (err) {
      console.error("Errore durante l'aggiornamento su Supabase:", err);
      onFlash("❌ Errore di connessione con il database.");
    }
  };

  const getStatusBadge = (status: TableStatus) => {
    switch (status) {
      case "free":
        return <span className="text-emerald-400 font-black uppercase tracking-wider">Libero</span>;
      case "reserved":
        return <span className="text-cyan-400 font-black uppercase tracking-wider animate-pulse">Riservato</span>;
      case "preparing":
        return <span className="text-orange-400 font-black uppercase tracking-wider animate-pulse">In Preparazione</span>;
      case "ready":
        return <span className="text-purple-400 font-black uppercase tracking-wider animate-ping">Pronto</span>;
      case "occupied":
        return <span className="text-rose-400 font-black uppercase tracking-wider">Occupato</span>;
      case "attesa conto":
        return <span className="text-amber-400 font-black uppercase tracking-wider animate-pulse">Attesa Conto</span>;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 animate-in fade-in duration-300 touch-none select-none">
      <div className={`w-full max-w-md rounded-3xl bg-slate-950 border p-6 shadow-[0_0_90px_rgba(0,0,0,0.5)] text-slate-100 flex flex-col gap-6 ${
        table.status === "reserved" 
          ? "border-cyan-500/80 shadow-[0_0_90px_rgba(6,182,212,0.35)] ring-1 ring-cyan-400/30" 
          : table.status === "preparing"
          ? "border-orange-500/80 shadow-[0_0_90px_rgba(249,115,22,0.35)] ring-1 ring-orange-400/30"
          : table.status === "ready"
          ? "border-purple-500/80 shadow-[0_0_90px_rgba(168,85,247,0.35)] ring-1 ring-purple-400/30"
          : table.status === "attesa conto"
          ? "border-amber-500/80 shadow-[0_0_90px_rgba(245,158,11,0.35)] ring-1 ring-amber-400/30"
          : "border-emerald-500/50 shadow-[0_0_90px_rgba(16,185,129,0.3)] ring-1 ring-emerald-400/20"
      }`}>
        
        {/* Header Modale */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex flex-col gap-1">
            <h3 className={`text-xl sm:text-2xl font-black drop-shadow-[0_0_12px_currentColor] flex items-center gap-2 ${
              table.status === "reserved" ? "text-cyan-400" : table.status === "preparing" ? "text-orange-400" : table.status === "ready" ? "text-purple-400" : table.status === "attesa conto" ? "text-amber-400" : "text-emerald-400"
            }`}>
              Tavolo <span className="font-mono text-white">{table.label}</span>
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-slate-400 uppercase tracking-widest font-semibold">Stato:</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-800 shadow-inner">
                {getStatusBadge(table.status)}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-2xl bg-slate-900 border border-slate-800 p-3 text-slate-300 hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/30 transition-all active:scale-95 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* SE SPECIFICO PER TAVOLO RISERVATO: Mostra dettagli prenotazione prima di aprire l'ordine */}
        {table.status === "reserved" ? (
          <div className="flex flex-col gap-4">
            <div className="p-4 rounded-2xl bg-cyan-950/30 border border-cyan-500/40 flex flex-col gap-2 shadow-inner">
              <div className="flex items-center gap-2 text-cyan-300 font-bold text-xs uppercase tracking-wider">
                <CalendarCheck className="w-4 h-4 text-cyan-400" />
                Dettagli Prenotazione
              </div>
              {loadingReservation ? (
                <p className="text-xs text-slate-400 italic">Caricamento dettagli...</p>
              ) : reservationData ? (
                <div className="flex flex-col gap-1 text-xs text-slate-300 mt-1">
                  <p><strong className="text-cyan-400">Cliente:</strong> {reservationData.nome || reservationData.cliente || "Ospite"}</p>
                  <p><strong className="text-cyan-400">Orario:</strong> {reservationData.orario || "Non specificato"}</p>
                  <p><strong className="text-cyan-400">Coperti:</strong> {reservationData.coperti || reservationData.persone || "N/D"}</p>
                  {reservationData.note && <p><strong className="text-cyan-400">Note:</strong> {reservationData.note}</p>}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">Nessun dettaglio aggiuntivo trovato nel database.</p>
              )}
            </div>

            <button
              onClick={handleAddOrderFromReservation}
              className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 py-4 px-4 text-xs sm:text-sm font-extrabold text-black shadow-[0_0_30px_rgba(6,182,212,0.5)] transition-all flex items-center justify-center gap-3 active:scale-95 uppercase tracking-wide min-h-[50px]"
            >
              <Utensils className="w-4 h-4 text-black shrink-0" />
              <span>Aggiungi Ordine (Avvia Preparazione)</span>
            </button>
          </div>
        ) : (
          /* Azioni Standard per altri stati */
          <div className="flex flex-col gap-3.5">
            <button
              onClick={() => {
                onOpenOrder(table.id);
                onClose();
              }}
              className="w-full rounded-2xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/60 py-4 px-4 text-xs sm:text-sm font-extrabold text-emerald-300 shadow-[0_0_25px_rgba(16,185,129,0.3)] hover:shadow-[0_0_35px_rgba(16,185,129,0.5)] hover:border-emerald-400 transition-all flex items-center justify-center gap-3 active:scale-95 uppercase tracking-wide min-h-[50px]"
            >
              <Utensils className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Gestisci Comanda (Cucina)</span>
            </button>

            {(table.status === "occupied" || table.status === "preparing" || table.status === "ready" || table.status === "attesa conto") && (
              <button
                onClick={() => handleUpdateTableInfo("free")}
                className="w-full rounded-2xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/60 py-4 px-4 text-xs sm:text-sm font-extrabold text-rose-300 shadow-[0_0_25px_rgba(244,63,94,0.3)] hover:shadow-[0_0_35px_rgba(244,63,94,0.5)] hover:border-rose-400 transition-all flex items-center justify-center gap-3 active:scale-95 uppercase tracking-wide min-h-[50px]"
              >
                <Receipt className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Stampa Preconto / Libera Tavolo</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
