import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Beer } from "lucide-react";
import { TopNav } from "@/components/top-nav";
import { RoomSelector } from "@/futures/live-map/components/roomselector";
import { TableModal } from "@/futures/live-map/components/TableModal";
import { OrderManager } from "@/futures/live-map/components/OrderManager";
import { TableListMobile } from "@/futures/live-map/components/TableListMobile";
import { BarCounterPanel } from "@/futures/live-map/components/BarCounter";
import { isBarTab, openBarTab, closeBarTab } from "@/lib/bar-counter";
import type { Reservation } from "@/lib/reservations-api";
import { fetchReservations, completeReservation } from "@/lib/reservations-api";
import { supabase } from "@/lib/supabase";
import { updateTableStatusInSupabase } from "@/lib/supabase-service";
import { fetchAllOpenOrderItems, summarizeTableCourses, type OrderItemRow } from "@/lib/order-items-api";
import { fetchAlertThreshold, DEFAULT_ALERT_THRESHOLD_MINUTES } from "@/lib/alert-settings-api";
import { fetchTables, type PosTable } from "@/lib/tables-api";
import { loadRooms, type PosRoom } from "@/lib/rooms-store";
import { QrLoginScreen } from "@/futures/live-map/components/QrLoginScreen";
import { loadSession, clearSession, type EmployeeSession } from "@/lib/employee-session";

/**
 * App Cameriere: pensata solo per telefono, sempre a mappa lineare (mai il canvas
 * spaziale del gestionale). Rispetto al gestionale principale, qui NON si modifica
 * la mappa (niente aggiungi/unisci/dividi/sposta tavoli, niente cambio posti): quello
 * resta un compito da gestionale. Da qui il cameriere può solo:
 * - aprire un tavolo per controllare/gestire l'ordine (aggiungere piatti, invio comanda/preconto, chiudi e paga)
 * - controllare e gestire i corsi (segnare i piatti serviti)
 * - spostare/unire l'ordine su un altro tavolo se ha aperto quello sbagliato
 * Tutto sincronizzato in tempo reale con le stesse tabelle Supabase del gestionale madre.
 */
export const Route = createFileRoute("/")({
  component: AppGate,
  head: () => ({
    meta: [
      { title: "App Cameriere -- Sala" },
      {
        name: "description",
        content: "App cameriere: stato tavoli, gestione ordini e corsi in tempo reale, sincronizzata col gestionale.",
      },
    ],
  }),
});

/** Cancello d'accesso: senza una sessione dipendente valida si vede solo la schermata di scansione QR. */
function AppGate() {
  const [session, setSession] = useState<EmployeeSession | null>(() => loadSession());

  if (!session) {
    return <QrLoginScreen onLoggedIn={setSession} />;
  }

  return (
    <MappaCameriere
      session={session}
      onLogout={() => {
        clearSession();
        setSession(null);
      }}
    />
  );
}

function MappaCameriere({ session, onLogout }: { session: EmployeeSession; onLogout: () => void }) {
  const [rooms] = useState<PosRoom[]>(loadRooms);
  const [activeRoomId, setActiveRoomId] = useState<string>(() => loadRooms()[0].id);
  const [allTables, setAllTables] = useState<PosTable[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [activeOrderTable, setActiveOrderTable] = useState<{
    id: string;
    label: string;
    seats?: number;
    reservation?: { clientName: string; covers: number; time: string; notes?: string } | null;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [flash, setFlash] = useState("");

  // Prenotazioni: solo lettura, servono per il popup "conferma arrivo cliente" quando si
  // apre un tavolo già prenotato. L'assegnazione di nuove prenotazioni resta nel gestionale.
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [pendingArrival, setPendingArrival] = useState<{
    table: PosTable;
    reservation: Reservation;
  } | null>(null);

  const [showBarPanel, setShowBarPanel] = useState(false);
  const [creatingBarTab, setCreatingBarTab] = useState(false);

  // Stato sintetico portate: righe order_items (solo Cucina) di tutti i tavoli, per calcolare
  // in automatico "in preparazione" / "in attesa" e l'alert visivo di attesa troppo lunga.
  const [orderItemsAll, setOrderItemsAll] = useState<OrderItemRow[]>([]);
  const [alertThresholdMinutes, setAlertThresholdMinutes] = useState<number>(DEFAULT_ALERT_THRESHOLD_MINUTES);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  const activeRoom = useMemo(
    () => rooms.find((r) => r.id === activeRoomId) || rooms[0],
    [rooms, activeRoomId],
  );

  const tables = useMemo(
    () => allTables.filter((t) => !isBarTab(t.label) && roomPrefixOf(t.label, rooms) === activeRoom.prefix),
    [allTables, rooms, activeRoom],
  );

  /** Conti aperti al bancone: mostrati a parte, non nell'elenco tavoli. */
  const barTabs = useMemo(() => allTables.filter((t) => isBarTab(t.label)), [allTables]);

  /* ---------------- Supabase: fetch + realtime (stessa base dati del gestionale) ---------------- */

  const reload = useCallback(async () => {
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

  /* ---------------- Stato sintetico portate: order_items + soglia alert ---------------- */

  const reloadOrderItems = useCallback(async () => {
    try {
      const rows = await fetchAllOpenOrderItems();
      setOrderItemsAll(rows);
    } catch (e) {
      console.error("Errore caricamento stato portate:", e);
    }
  }, []);

  useEffect(() => {
    reloadOrderItems();
    fetchAlertThreshold().then(setAlertThresholdMinutes);
    const channel = supabase
      .channel("public:order_items")
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, () => reloadOrderItems())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [reloadOrderItems]);

  // Tick periodico: l'alert dipende dal tempo trascorso, non solo dai dati, quindi va
  // ricalcolato anche senza nuovi eventi Supabase.
  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 15000);
    return () => window.clearInterval(t);
  }, []);

  /** Stato sintetico + eventuale alert per un tavolo, calcolato dai piatti Cucina non ancora chiusi. */
  const tableCourseInfo = useCallback(
    (tableId: string) => {
      const summary = summarizeTableCourses(orderItemsAll, tableId);
      let alert = false;
      if (summary.oldestPendingAt) {
        const elapsedMin = (nowTick - new Date(summary.oldestPendingAt).getTime()) / 60000;
        alert = elapsedMin >= alertThresholdMinutes;
      }
      const statusOverride =
        summary.synthetic === "in_preparazione" ? "preparing" : summary.synthetic === "in_attesa" ? "ready" : undefined;
      return { statusOverride: statusOverride as PosTable["status"] | undefined, alert };
    },
    [orderItemsAll, nowTick, alertThresholdMinutes],
  );

  /* ---------------- Apertura tavolo / prenotazione / banco ---------------- */

  const handleTap = useCallback(
    (id: string) => {
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

      setSelectedId(id);
    },
    [allTables, reservations],
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
      seats: table.seats,
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
      setActiveOrderTable({ id: String(created.id), label: created.label, seats: created.seats });
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

  const selectedTable = useMemo(
    () => allTables.find((t) => t.id === selectedId) || null,
    [allTables, selectedId],
  );

  return (
    <div className="flex h-screen min-h-screen w-full flex-col overflow-hidden bg-[#030712] text-slate-100 font-sans">
      <TopNav active="Mappa Live" employeeName={session.name} onLogout={onLogout} />

      <main className="relative flex flex-1 flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-[#030712] to-black">
        <div
          data-keep-open
          className="flex items-center justify-between gap-3 border-b border-cyan-500/15 bg-slate-950/70 px-3 py-2.5 backdrop-blur-xl"
        >
          <RoomSelector rooms={rooms} activeRoomId={activeRoom.id} onRoomChange={setActiveRoomId} onAddRoom={() => {}} />

          <button
            onClick={() => setShowBarPanel(true)}
            className={`relative inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-all ${
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
        </div>

        <div className="relative flex-1 overflow-hidden p-2.5">
          <div className="relative h-full w-full rounded-3xl border border-cyan-500/20 bg-slate-950/40 shadow-[inset_0_0_80px_rgba(0,0,0,0.9)] backdrop-blur-md">
            {isLoading ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent shadow-[0_0_15px_rgba(6,182,212,0.6)]" />
                <span className="text-[11px] uppercase tracking-wider text-cyan-400/80">Sincronizzazione…</span>
              </div>
            ) : (
              <TableListMobile
                tables={tables}
                onTap={handleTap}
                isMultiSelected={() => false}
                courseInfoFor={(id) => tableCourseInfo(id)}
              />
            )}
          </div>
        </div>
      </main>

      <TableModal
        table={selectedTable as any}
        onClose={() => setSelectedId("")}
        onOpenOrder={(tableId) => {
          const t = allTables.find((item) => item.id === tableId);
          if (t) setActiveOrderTable({ id: t.id, label: t.label, seats: t.seats });
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
            tableSeats={activeOrderTable.seats}
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
            otherTables={allTables
              .filter((t) => String(t.id) !== activeOrderTable.id)
              .map((t) => ({ id: String(t.id), label: t.label, status: t.status }))}
            onOrderMoved={(targetId, targetLabel) => {
              setActiveOrderTable({ id: targetId, label: targetLabel });
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

function roomPrefixOf(label: string, rooms: PosRoom[]): string {
  const match = rooms
    .map((r) => r.prefix)
    .filter((p) => label.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  return match ?? rooms[0].prefix;
}
