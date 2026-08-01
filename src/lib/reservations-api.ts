import { supabase } from "@/lib/supabase";

export type ReservationStatus = "confirmed" | "seated" | "cancelled";

export interface Reservation {
  id: string;
  clientName: string;
  date: string;
  time: string;
  covers: number;
  notes?: string;
  tableId?: string;
  status: ReservationStatus;
}

function mapRow(row: Record<string, any>): Reservation {
  return {
    id: String(row.id),
    clientName: String(row.client_name ?? ""),
    date: String(row.date ?? new Date().toISOString().slice(0, 10)),
    time: String(row.time ?? ""),
    covers: Number(row.covers ?? 2),
    notes: row.notes ?? "",
    tableId: row.table_id ?? undefined,
    status: (row.status as ReservationStatus) ?? "confirmed",
  };
}

export async function fetchReservations(): Promise<Reservation[]> {
  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .order("date", { ascending: true })
    .order("time", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function createReservation(input: {
  clientName: string;
  date: string;
  time: string;
  covers: number;
  notes?: string;
}): Promise<Reservation> {
  const { data, error } = await supabase
    .from("reservations")
    .insert([
      {
        client_name: input.clientName,
        date: input.date,
        time: input.time,
        covers: input.covers,
        notes: input.notes || null,
      },
    ])
    .select()
    .single();
  if (error) throw error;
  return mapRow(data as Record<string, any>);
}

/** Assegna la prenotazione a un tavolo: farà brillare il tavolo di ciano sulla mappa. */
export async function assignReservationToTable(id: string, tableLabel: string): Promise<void> {
  const { error } = await supabase
    .from("reservations")
    .update({ table_id: tableLabel, status: "seated" })
    .eq("id", id);
  if (error) throw error;
}

/** Toglie l'assegnazione al tavolo, la prenotazione torna "da assegnare". */
export async function unassignReservation(id: string): Promise<void> {
  const { error } = await supabase
    .from("reservations")
    .update({ table_id: null, status: "confirmed" })
    .eq("id", id);
  if (error) throw error;
}

/** Cliente arrivato: la prenotazione ha esaurito il suo scopo, si rimuove. */
export async function completeReservation(id: string): Promise<void> {
  const { error } = await supabase.from("reservations").delete().eq("id", id);
  if (error) throw error;
}

export async function cancelReservation(id: string): Promise<void> {
  const { error } = await supabase.from("reservations").update({ status: "cancelled" }).eq("id", id);
  if (error) throw error;
}

export async function deleteReservation(id: string): Promise<void> {
  const { error } = await supabase.from("reservations").delete().eq("id", id);
  if (error) throw error;
}
