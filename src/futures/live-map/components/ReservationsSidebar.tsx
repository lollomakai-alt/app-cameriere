import React, { useState } from "react";
import { Calendar, Users, Clock, Plus, X } from "lucide-react";
import type { Reservation } from "@/lib/reservations-api";

export type { Reservation };

interface ReservationsSidebarProps {
  reservations: Reservation[];
  selectedReservationId: string | null;
  onSelectReservation: (res: Reservation) => void;
  onAddReservation: (res: Omit<Reservation, "id" | "status">) => void;
}

export const ReservationsSidebar: React.FC<ReservationsSidebarProps> = ({
  reservations,
  selectedReservationId,
  onSelectReservation,
  onAddReservation,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [clientName, setClientName] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("20:00");
  const [covers, setCovers] = useState(2);
  const [notes, setNotes] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) return;
    onAddReservation({
      clientName: clientName.trim(),
      date,
      time,
      covers,
      notes: notes.trim(),
    });
    setClientName("");
    setNotes("");
    setShowModal(false);
  };

  const sortedReservations = [...reservations].sort((a, b) => a.time.localeCompare(b.time));

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l border-cyan-500/25 bg-slate-950/95 backdrop-blur-xl select-none h-full lg:flex lg:w-88">
      
      {/* Header Sidebar */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-cyan-500/20 bg-slate-900/40">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-white">Prenotazioni</h3>
            <p className="text-[10px] text-slate-400">Tocca per assegnare al tavolo</p>
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 px-3.5 py-2 text-[11px] font-extrabold text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.2)] transition-all active:scale-95 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Nuova</span>
        </button>
      </div>

      {/* Lista Prenotazioni */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {sortedReservations.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-slate-500 text-xs italic px-4">
            Nessuna prenotazione attiva al momento.
          </div>
        ) : (
          sortedReservations.map((res) => {
            const isSelected = selectedReservationId === res.id;
            return (
              <div
                key={res.id}
                onClick={() => onSelectReservation(res)}
                className={`group relative flex flex-col p-3.5 rounded-2xl border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-cyan-500/25 border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.4)]"
                    : "bg-cyan-950/20 hover:bg-cyan-950/30 border-cyan-500/30 hover:border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.1)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-cyan-200 truncate">
                    {res.clientName}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-950 border border-cyan-500/30 text-[10px] font-mono font-bold text-cyan-400">
                      <Clock className="w-3 h-3" />
                      {res.time}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-950 border border-cyan-500/30 text-[10px] font-mono text-cyan-300">
                      <Users className="w-3 h-3 text-cyan-400" />
                      {res.covers}
                    </span>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <span className="text-slate-300 truncate italic">
                    {res.notes ? `"${res.notes}"` : "Nessuna nota"}
                  </span>
                  <span className={`font-bold px-2 py-0.5 rounded-lg text-[10px] ${
                    res.tableId ? "text-cyan-300 bg-cyan-500/20 border border-cyan-500/40" : "text-cyan-400 bg-cyan-500/10 border border-cyan-500/30"
                  }`}>
                    {res.tableId ? `Tavolo ${res.tableId}` : "Da assegnare"}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modale Nuova Prenotazione */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="w-full max-w-sm rounded-3xl bg-slate-950 border border-cyan-500/50 p-6 shadow-[0_0_40px_rgba(6,182,212,0.3)] text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-cyan-500/20 mb-4">
              <h4 className="text-sm font-black text-cyan-400 uppercase tracking-wider">Nuova Prenotazione</h4>
              <button 
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-xl bg-slate-900 border border-cyan-500/20 text-slate-400 hover:text-white cursor-pointer transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Nome Cliente</label>
                <input
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Es. Mario Rossi"
                  className="w-full rounded-xl bg-slate-900 border border-cyan-500/30 px-3.5 py-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Data</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-cyan-500/30 px-3 py-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Orario</label>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-cyan-500/30 px-3 py-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Coperti</label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={covers}
                  onChange={(e) => setCovers(Number(e.target.value))}
                  className="w-full rounded-xl bg-slate-900 border border-cyan-500/30 px-3.5 py-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Note (opzionale)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Es. Seggiolone, allergie..."
                  className="w-full rounded-xl bg-slate-900 border border-cyan-500/30 px-3.5 py-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full mt-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 py-3 text-xs font-black text-slate-950 uppercase tracking-wide shadow-[0_0_20px_rgba(6,182,212,0.4)] transition-all cursor-pointer"
              >
                Salva Prenotazione
              </button>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
};
