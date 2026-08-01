import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Beer } from "lucide-react";
import { TopNav } from "@/components/top-nav";
import { RoomSelector } from "@/futures/live-map/components/roomselector";
import { MapEditBar } from "@/futures/live-map/components/MapEditBar";
import {
  TableCard,
  cellSize,
  COLS,
  ROWS,
} from "@/futures/live-map/components/TableCard";

import { TableModal } from "@/futures/live-map/components/TableModal";
import { OrderManager } from "@/futures/live-map/components/OrderManager";
import { ReservationsSidebar } from "@/futures/live-map/components/ReservationsSidebar";
import { BarCounterPanel } from "@/futures/live-map/components/BarCounter";
import { isBarTab, openBarTab, closeBarTab } from "@/lib/bar-counter";
import type { Reservation } from "@/lib/reservations-api";
import {
  fetchReservations,
  createReservation,
  assignReservationToTable,
  completeReservation,
} from "@/lib/reservations-api";
import { supabase } from "@/lib/supabase";
import { updateTableStatusInSupabase } from "@/lib/supabase-service";
import {
  createTable,
  deleteTables as deleteTablesApi,
  fetchTables,
  gridPosition,
  updateTable,
  writeSpan,
  type PosTable,
} from "@/lib/tables-api";
import { loadRooms, makePrefix, saveRooms, type PosRoom } from "@/lib/rooms-store";

export const Route = createFileRoute("/")({
  component: MappaLive,
  head: () => ({
    meta: [
      { title: "Mappa Live -- Gestione Sale e Tavoli" },
      {
        name: "description",
        content:
          "Mappa live del ristorante: stato tavoli in tempo reale, gestione sale, unione e divisione dei tavoli.",
      },
      { property: "og:title", content: "Mappa Live -- Gestione Sale e Tavoli" },
      {
        property: "og:description",
        content: "Stato tavoli in tempo reale, gestione sale e comande dal palmare.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function MappaLive() {
  const [rooms, setRooms] = useState<PosRoom[]>(loadRooms);
  const [activeRoomId, setActiveRoomId] = useState<string>(() => loadRooms()[0].id);
  const [allTables, setAllTables] = useState<PosTable[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string>("");
  const [activeOrderTable, setActiveOrderTable] = useState<{
    id: string;
    label: string;
    reservation?: { clientName: string; covers: number; time: string; notes?: string } | null;
  } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [multiSel, setMultiSel] = useState<string[]>([]);
  const [flash, setFlash] = useState("");

  // Stato prenotazioni: caricato e sincronizzato da Supabase (tabella reservations)
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [pendingArrival, setPendingArrival] = useState<{
    table: PosTable;
    reservation: Reservation;
  } | null>(null);

  const [selectedReservationId, setSelectedReservationId] = useState<string | null>(null);
  const [showBarPanel, setShowBarPanel] = useState(false);
  const [creatingBarTab, setCreatingBarTab] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // lato del tavolo (quadrato) calcolato sul canvas: la mappa entra sempre nel viewport
  const [cell, setCell] = useState(84);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => setCell(cellSize(el.clientWidth, el.clientHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isLoading]);



  const activeRoom = useMemo(
    () => rooms.find((r) => r.id === activeRoomId) || rooms[0],
    [rooms, activeRoomId],
  );

  const tables = useMemo(
    () =>
      allTables.filter(
        (t) => !isBarTab(t.label) && roomPrefixOf(t.label, rooms) === activeRoom.prefix,
      ),
    [allTables, rooms, activeRoom],
  );

  /** Conti aperti al bancone: non occupano celle sulla mappa dei tavoli. */
  const barTabs = useMemo(() => allTables.filter((t) => isBarTab(t.label)), [allTables]);

  /* ---------------- Supabase: fetch + realtime ---------------- */

  const reload = useCallback(async () => {
    if (draggingRef.current) return; // non sovrascrivere una posizione in corso di trascinamento
    try {
      const rows = await fetchTables();
      setAllTables(rows);
    } catch (e: any) {
      console.error("Errore caricamento Tables:", e);
      setFlash("⚠️ Errore di sincronizzazione database");
    } finally {
      setIsLoading(false);
    }
  }, []);



  useEffect(() => {
    reload();
    const channel = supabase
      .channel("public:Tables")
      .on("postgres_changes", { event: "*", schema: "public", table: "Tables" }, () => reload())
      .subscribe();
    const poll = window.setInterval(reload, 8000);
    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(poll);
    };
  }, [reload]);

  const reloadReservations = useCallback(async () => {
    try {
      const rows = await fetchReservations();
      setReservations(rows);
    } catch (e) {
      console.error("Errore caricamento prenotazioni:", e);
    }
  }, []);

  useEffect(() => {
    reloadReservations();
    const channel = supabase
      .channel("public:reservations")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, () => reloadReservations())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [reloadReservations]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(""), 3000);
    return () => window.clearTimeout(t);
  }, [flash]);

  /* ---------------- Click-outside globale ---------------- */

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-keep-open]")) return;
      setSelectedId("");
      setMultiSel([]);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, []);

  /* ---------------- Azioni tavoli e prenotazioni ---------------- */

  const handleTap = useCallback(
    async (id: string) => {
      if (editMode) {
        setMultiSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
        return;
      }

      if (selectedReservationId) {
        const targetTable = allTables.find((t) => t.id === id);
        const targetRes = reservations.find((r) => r.id === selectedReservationId);

        if (targetTable && targetRes) {
          try {
            await assignReservationToTable(targetRes.id, targetTable.label);
            // Il tavolo brilla di ciano finché la prenotazione resta assegnata
            await updateTableStatusInSupabase(targetTable.id, "reserved");
            await reloadReservations();
            reload();
            setFlash(`✨ Prenotazione di ${targetRes.clientName} assegnata al Tavolo ${targetTable.label}`);
          } catch (e) {
            console.error("Errore assegnazione prenotazione:", e);
            setFlash("⚠️ Assegnazione prenotazione non riuscita");
          }
          setSelectedReservationId(null);
          return;
        }
      }

      const targetTable = allTables.find((t) => t.id === id);
      if (!targetTable) return;

      // Tavolo con prenotazione attiva: prima di aprire la comanda chiedo conferma dell'arrivo del cliente
      const linkedReservation = reservations.find(
        (r) => r.tableId === targetTable.label && r.status === "seated",
      );
      if (linkedReservation) {
        setPendingArrival({ table: targetTable, reservation: linkedReservation });
        return;
      }

      // APERTURA DIRETTA ORDINI: Tocchi il tavolo -> Si apre subito il gestore ordini
      setActiveOrderTable({ id: String(targetTable.id), label: targetTable.label });
    },
    [editMode, selectedReservationId, allTables, reservations, reload, reloadReservations]
  );

  /** Conferma l'arrivo del cliente: la prenotazione si chiude e si passa alla comanda. */
  const confirmArrival = useCallback(async () => {
    if (!pendingArrival) return;
    const { table, reservation } = pendingArrival;
    try {
      await completeReservation(reservation.id);
      await updateTableStatusInSupabase(table.id, "free");
      await reloadReservations();
      reload();
    } catch (e) {
      console.error("Errore conferma arrivo cliente:", e);
      setFlash("⚠️ Errore nella conferma arrivo cliente");
    }
    setActiveOrderTable({
      id: String(table.id),
      label: table.label,
      reservation: {
        clientName: reservation.clientName,
        covers: reservation.covers,
        time: reservation.time,
        notes: reservation.notes,
      },
    });
    setPendingArrival(null);
  }, [pendingArrival, reload, reloadReservations]);

  /** Apre un nuovo conto al bancone e passa subito alla presa comanda. */
  const handleNewBarTab = useCallback(async () => {
    setCreatingBarTab(true);
    try {
      const created = await openBarTab(allTables);
      setAllTables((prev) => [...prev, created]);
      setShowBarPanel(false);
      setActiveOrderTable({ id: String(created.id), label: created.label });
    } catch (e: any) {
      console.error("Errore apertura conto al banco:", e);
      setFlash(`⚠️ ${e?.message || "Impossibile aprire il conto al banco"}`);
    } finally {
      setCreatingBarTab(false);
    }
  }, [allTables]);

  /** Conto pagato: al banco sparisce subito e il numero torna disponibile. */
  const handleTicketClosed = useCallback(
    async (closedTableId: string) => {
      const target = allTables.find((t) => String(t.id) === String(closedTableId));
      if (!target || !isBarTab(target.label)) return;
      setAllTables((prev) => prev.filter((t) => String(t.id) !== String(closedTableId)));
      try {
        await closeBarTab(String(closedTableId));
      } catch (e) {
        console.error("Errore chiusura conto al banco:", e);
        reload();
      }
    },
    [allTables, reload],
  );

  /** Prima cella libera (evita sovrapposizioni), a partire da una preferita. */
  const findFreeCell = useCallback(
    (list: PosTable[], span = 1, prefer?: { col: number; row: number }, ignoreId?: string) => {
      const taken = (col: number, row: number) =>
        list.some((t) => {
          if (ignoreId && t.id === ignoreId) return false;
          const ts = Math.max(1, t.span ?? 1);
          return t.y === row && col < t.x + ts && t.x < col + span;
        });
      if (prefer) {
        const c = Math.max(0, Math.min(COLS - span, prefer.col));
        const r = Math.max(0, Math.min(ROWS - 1, prefer.row));
        if (!taken(c, r)) return { col: c, row: r };
      }
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col <= COLS - span; col++) {
          if (!taken(col, row)) return { col, row };
        }
      }
      return { col: 0, row: 0 };
    },
    [],
  );

  /** Rilascio del tavolo: la posizione è già snappata alla griglia dal TableCard. */
  const handleMove = useCallback(
    async (id: string, col: number, row: number) => {
      draggingRef.current = true;
      const current = allTables.find((t) => String(t.id) === id);
      if (!current) {
        draggingRef.current = false;
        return;
      }
      const span = Math.max(1, current.span ?? 1);
      // niente più ricerca automatica di una cella libera vicina: con la griglia grande
      // non serve, il tavolo va esattamente dove lo lasci (solo i bordi restano un limite)
      const finalCol = Math.max(0, Math.min(COLS - span, col));
      const finalRow = Math.max(0, Math.min(ROWS - 1, row));

      setAllTables((prev) =>
        prev.map((t) => (String(t.id) === id ? { ...t, x: finalCol, y: finalRow } : t)),
      );

      try {
        await updateTable(id, { x: finalCol, y: finalRow });
      } catch (e: any) {
        console.error(e);
        setFlash("⚠️ Posizione non salvata");
        reload();
      } finally {
        draggingRef.current = false;
      }
    },
    [allTables, reload],
  );


  const handleRenameTable = useCallback(async (id: string, label: string) => {
    setAllTables((prev) => prev.map((t) => (t.id === id ? { ...t, label } : t)));
    try {
      await updateTable(id, { label });
      setFlash(`✏️ Rinominato in ${label}`);
    } catch (e: any) {
      setFlash("⚠️ Rinomina non salvata");
      reload();
    }
  }, [reload]);

  const handleSeatsChange = useCallback(async (id: string, seats: number) => {
    setAllTables((prev) => prev.map((t) => (t.id === id ? { ...t, seats } : t)));
    try {
      await updateTable(id, { seats });
      setFlash(`👥 ${seats} posti`);
    } catch {
      setFlash("⚠️ Coperti non salvati");
      reload();
    }
  }, [reload]);


  const nextLabel = useCallback(() => {
    const prefix = activeRoom.prefix;
    const used = tables
      .map((t) => Number(t.label.replace(prefix, "")))
      .filter((n) => Number.isFinite(n));
    let n = 1;
    while (used.includes(n)) n++;
    return `${prefix}${n}`;
  }, [tables, activeRoom]);

  const handleAddTable = async () => {
    try {
      const spot = findFreeCell(tables, 1);
      const created = await createTable(nextLabel(), 0);
      created.x = spot.col;
      created.y = spot.row;
      setAllTables((prev) => [...prev, created]);
      await updateTable(created.id, { x: spot.col, y: spot.row });
      setFlash(`✨ Tavolo ${created.label} creato`);
    } catch (e: any) {
      console.error(e);
      setFlash(`⚠️ ${e?.message || "Errore durante la creazione"}`);
    }
  };


  const handleDeleteTables = async () => {
    if (!multiSel.length) return;
    const ids = [...multiSel];
    setAllTables((prev) => prev.filter((t) => !ids.includes(t.id)));
    setMultiSel([]);
    try {
      await deleteTablesApi(ids);
      setFlash("🗑️ Tavoli rimossi");
    } catch (e: any) {
      setFlash(`⚠️ ${e?.message || "Errore eliminazione"}`);
      reload();
    }
  };

  const handleMergeTables = async () => {
    if (multiSel.length < 2) return;
    const selected = tables.filter((t) => multiSel.includes(t.id));
    const keep = selected.reduce((a, b) => (labelNum(a.label) <= labelNum(b.label) ? a : b));
    const drop = selected.filter((t) => t.id !== keep.id);
    const span = Math.min(COLS, selected.reduce((sum, t) => sum + t.span, 0));
    // il blocco unito è più largo: lo riporto dentro i bordi della griglia
    const col = Math.max(0, Math.min(COLS - span, keep.x));
    writeSpan(keep.id, span);
    setAllTables((prev) =>
      prev
        .filter((t) => !drop.some((d) => d.id === t.id))
        .map((t) => (t.id === keep.id ? { ...t, span, x: col } : t)),
    );
    setMultiSel([]);
    try {
      await deleteTablesApi(drop.map((t) => t.id));
      if (col !== keep.x) await updateTable(keep.id, { x: col });
      setFlash(`🔗 Tavoli uniti in ${keep.label}`);
    } catch {
      reload();
    }
  };


  const handleSplitTable = async () => {
    const target = tables.find((t) => multiSel.includes(t.id) && t.span > 1);
    if (!target) return;
    const extra = target.span - 1;
    writeSpan(target.id, 1);
    const remaining = tables.map((t) => (t.id === target.id ? { ...t, span: 1 } : t));
    setAllTables((prev) => prev.map((t) => (t.id === target.id ? { ...t, span: 1 } : t)));
    setMultiSel([]);

    try {
      const prefix = activeRoom.prefix;
      const used = new Set(remaining.map((t) => labelNum(t.label)));
      const occupied = [...remaining];
      for (let i = 0; i < extra; i++) {
        let n = 1;
        while (used.has(n)) n++;
        used.add(n);
        const created = await createTable(`${prefix}${n}`, 0);
        // i pezzi separati si posizionano accanto al tavolo di partenza
        const spot = findFreeCell(occupied, 1, { col: target.x + i + 1, row: target.y });
        created.x = spot.col;
        created.y = spot.row;
        occupied.push(created);
        await updateTable(created.id, { x: spot.col, y: spot.row });
      }
      setFlash(`✂️ ${target.label} diviso`);

      reload();
    } catch (e: any) {
      setFlash(`⚠️ ${e?.message || "Errore divisione"}`);
      reload();
    }
  };



  const handleAddRoom = (name: string) => {
    const room: PosRoom = { id: String(Date.now()), name, prefix: makePrefix(name, rooms) };
    const next = [...rooms, room];
    setRooms(next);
    saveRooms(next);
    setActiveRoomId(room.id);
    setFlash(`🏛️ Sala "${name}" aggiunta`);
  };

  const selectedTable = useMemo(
    () => allTables.find((t) => t.id === selectedId) || null,
    [allTables, selectedId],
  );

  const canSplit = tables.some((t) => multiSel.includes(t.id) && t.span > 1);

  const singleSelected = useMemo(() => {
    if (multiSel.length !== 1) return null;
    const t = tables.find((x) => x.id === multiSel[0]);
    return t ? { id: t.id, label: t.label, seats: t.seats ?? 4 } : null;
  }, [multiSel, tables]);


  return (
    <div className="flex h-screen min-h-screen w-full flex-col overflow-hidden bg-[#030712] text-slate-100 font-sans">
      <TopNav active="Mappa Live" />

      {/* Main a due colonne */}
      <main className="relative flex flex-1 flex-row overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-[#030712] to-black">
        
        {/* Colonna Sinistra: Mappa e Tavoli */}
        <div className="flex flex-1 flex-col overflow-hidden relative">
          <div
            data-keep-open
            className="flex items-center justify-between gap-3 border-b border-cyan-500/15 bg-slate-950/70 px-4 py-2.5 backdrop-blur-xl"
          >
            <RoomSelector
              rooms={rooms}
              activeRoomId={activeRoom.id}
              onRoomChange={setActiveRoomId}
              onAddRoom={handleAddRoom}
            />

            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setShowBarPanel(true)}
                className={`relative inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition-all ${
                  barTabs.some((t) => t.status === "ready")
                    ? "border-purple-400 bg-purple-500/20 text-purple-300 shadow-[0_0_20px_rgba(168,85,247,0.5)] animate-pulse"
                    : barTabs.length > 0
                      ? "border-amber-400 bg-amber-500/20 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.4)]"
                      : "border-amber-500/30 bg-amber-950/30 text-amber-400 hover:bg-amber-500/10 hover:border-amber-400"
                }`}
              >
                <Beer className="h-4 w-4" />
                Banco
                {barTabs.length > 0 && (
                  <span
                    className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-black text-slate-950 ${
                      barTabs.some((t) => t.status === "ready") ? "bg-purple-400" : "bg-amber-500"
                    }`}
                  >
                    {barTabs.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => {
                  setEditMode((v) => !v);
                  setMultiSel([]);
                }}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition-all ${
                  editMode
                    ? "border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.5)]"
                    : "border-cyan-500/30 bg-cyan-950/30 text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.2)]"
                }`}
              >
                Riposiziona tavoli
              </button>
            </div>
          </div>

          {selectedReservationId && (
            <div className="bg-cyan-500/20 border-b border-cyan-500/40 px-4 py-2 text-center text-xs font-bold text-cyan-300 animate-pulse flex items-center justify-center gap-2">
              <span>💡 Tocca un tavolo sulla mappa per assegnare la prenotazione selezionata</span>
              <button 
                onClick={() => setSelectedReservationId(null)}
                className="ml-4 bg-black/40 hover:bg-black/70 px-2 py-0.5 rounded text-[10px] text-white border border-cyan-500/30"
              >
                Annulla
              </button>
            </div>
          )}

          {/* Canvas */}
          <div className="relative flex-1 overflow-hidden p-3 sm:p-5">
            <div
              ref={canvasRef}
              className="relative h-full w-full select-none overflow-auto overscroll-contain rounded-3xl border border-cyan-500/20 bg-slate-950/40 shadow-[inset_0_0_80px_rgba(0,0,0,0.9)] backdrop-blur-md"
            >
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#06b6d408_1px,transparent_1px),linear-gradient(to_bottom,#06b6d408_1px,transparent_1px)] bg-[size:3rem_3rem]" />

              {isLoading ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3">
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent shadow-[0_0_15px_rgba(6,182,212,0.6)]" />
                  <span className="text-[11px] uppercase tracking-wider text-cyan-400/80">
                    Sincronizzazione…
                  </span>
                </div>
              ) : tables.length === 0 ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
                  <p className="text-xs font-semibold text-slate-300">Nessun tavolo in questa sala</p>
                  <p className="text-[11px] text-slate-500">
                    Attiva "Riposiziona tavoli" e premi Aggiungi per creare il primo tavolo.
                  </p>
                </div>
              ) : (
                <div className="min-h-full w-full flex items-start justify-center p-4">
                  <div
                    className="relative"
                    style={{
                      width: COLS * cell,
                      height: ROWS * cell,
                      backgroundImage: editMode
                        ? "linear-gradient(to right,#06b6d41f 1px,transparent 1px),linear-gradient(to bottom,#06b6d41f 1px,transparent 1px)"
                        : undefined,
                      backgroundSize: `${cell}px ${cell}px`,
                    }}
                  >
                    {tables.map((t) => (
                      <TableCard
                        key={t.id}
                        table={t}
                        cell={cell}
                        onTap={handleTap}
                        onMove={handleMove}
                        isMultiSelected={multiSel.includes(t.id)}
                        editMode={editMode}
                      />
                    ))}
                  </div>
                </div>


              )}
            </div>

            {editMode && (
              <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-3">
                <MapEditBar
                  selectedCount={multiSel.length}
                  canSplit={canSplit}
                  single={singleSelected}
                  onAddTable={handleAddTable}
                  onDeleteTables={handleDeleteTables}
                  onMergeTables={handleMergeTables}
                  onSplitTable={handleSplitTable}
                  onRename={handleRenameTable}
                  onSeats={handleSeatsChange}

                  onDone={() => {
                    setEditMode(false);
                    setMultiSel([]);
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Colonna Destra: Sidebar Prenotazioni */}
        <ReservationsSidebar
          reservations={reservations}
          selectedReservationId={selectedReservationId}
          onAddReservation={async (newRes) => {
            try {
              const created = await createReservation(newRes);
              setReservations((prev) => [...prev, created]);
              setFlash(`📅 Prenotazione creata per ${created.clientName}`);
            } catch (e) {
              console.error("Errore creazione prenotazione:", e);
              setFlash("⚠️ Errore nel salvataggio della prenotazione");
            }
          }}
          onSelectReservation={(res) => {
            if (selectedReservationId === res.id) {
              setSelectedReservationId(null);
            } else {
              setSelectedReservationId(res.id);
              setFlash(`🎯 Selezionato ${res.clientName}: tocca un tavolo per assegnarlo`);
            }
          }}
        />
      </main>

      <TableModal
        table={selectedTable as any}
        onClose={() => setSelectedId("")}
        onOpenOrder={(tableId) => {
          const t = allTables.find((item) => item.id === tableId);
          if (t) setActiveOrderTable({ id: t.id, label: t.label });
        }}
        onFlash={setFlash}
        onTableUpdated={reload}
      />

      {activeOrderTable && (() => {
        const linkedReservation =
          activeOrderTable.reservation ??
          reservations.find((r) => r.tableId === activeOrderTable.label && r.status === "seated");

        return (
          <OrderManager
            tableId={activeOrderTable.id}
            tableLabel={activeOrderTable.label}
            reservation={linkedReservation ? {
              clientName: linkedReservation.clientName,
              covers: linkedReservation.covers,
              time: linkedReservation.time,
              notes: linkedReservation.notes
            } : null}
            onClose={() => setActiveOrderTable(null)}
            onFlash={setFlash}
            onTicketClosed={handleTicketClosed}
            onConvertToActive={() => {
              reload();
            }}
          />
        );
      })()}

      {showBarPanel && (
        <BarCounterPanel
          tabs={barTabs}
          isCreating={creatingBarTab}
          onOpenTab={(tab) => {
            setShowBarPanel(false);
            setActiveOrderTable({ id: String(tab.id), label: tab.label });
          }}
          onNewTab={handleNewBarTab}
          onClose={() => setShowBarPanel(false)}
        />
      )}

      {pendingArrival && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="w-full max-w-sm rounded-3xl bg-slate-950 border border-cyan-500/50 p-6 shadow-[0_0_40px_rgba(6,182,212,0.35)] text-slate-100">
            <h4 className="text-sm font-black text-cyan-400 uppercase tracking-wider mb-1">
              Tavolo {pendingArrival.table.label} prenotato
            </h4>
            <p className="text-xs text-slate-300 mb-4">
              Prenotazione di <span className="font-bold text-cyan-300">{pendingArrival.reservation.clientName}</span>{" "}
              alle {pendingArrival.reservation.time} · {pendingArrival.reservation.covers} coperti.
              {pendingArrival.reservation.notes ? ` "${pendingArrival.reservation.notes}"` : ""}
            </p>
            <p className="text-xs text-slate-400 mb-5">
              Confermi l'arrivo del cliente? La prenotazione verrà chiusa e si aprirà la comanda per questo tavolo.
            </p>
            <div className="flex gap-2.5">
              <button
                onClick={() => setPendingArrival(null)}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-900 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-800 active:scale-95 transition-all"
              >
                Annulla
              </button>
              <button
                onClick={confirmArrival}
                className="flex-1 rounded-xl bg-cyan-500 hover:bg-cyan-400 py-2.5 text-xs font-black text-slate-950 uppercase tracking-wide shadow-[0_0_20px_rgba(6,182,212,0.4)] active:scale-95 transition-all"
              >
                Conferma arrivo
              </button>
            </div>
          </div>
        </div>
      )}

      {flash && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-cyan-500/50 bg-slate-950/95 px-4 py-2.5 text-[11px] font-bold text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.4)] backdrop-blur-xl">
          {flash}
        </div>
      )}
    </div>
  );
}

function labelNum(label: string): number {
  const n = Number(label.replace(/\D/g, ""));
  return Number.isFinite(n) ? n : 9999;
}

function roomPrefixOf(label: string, rooms: PosRoom[]): string {
  const match = rooms
    .map((r) => r.prefix)
    .filter((p) => label.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  return match ?? rooms[0].prefix;
}

/**
 * I tavoli non devono mai sovrapporsi: chi occupa una cella già presa viene
 * spostato nella prima cella libera della sua sala.
 */


