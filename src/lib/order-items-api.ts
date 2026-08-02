import { supabase } from "@/lib/supabase";

/**
 * Stato per singolo piatto (riga d'ordine), non per l'intero ordine.
 * Solo i piatti destinati alla Cucina entrano in questo flusso: il bar/cocktail
 * va dritto al banco appena ordinato e non ha bisogno di essere "spuntato".
 *
 * Nessun automatismo di sblocco corso: cucina e sala si coordinano a voce.
 * Il sistema si limita a registrare quando il cameriere porta fisicamente il piatto
 * al tavolo (stato "servito" + timestamp), e a derivare da questi check uno stato
 * sintetico del tavolo per la mappa live.
 */
export type OrderItemStatus = "ordinato" | "servito";

export interface OrderItemRow {
  id: string;
  tableId: string;
  tableLabel: string;
  dishId: string;
  name: string;
  price: number;
  qty: number;
  course?: string;
  status: OrderItemStatus;
  orderedAt: string;
  servedAt?: string | null;
}

function mapRow(row: any): OrderItemRow {
  return {
    id: String(row.id),
    tableId: String(row.table_id),
    tableLabel: row.table_label || String(row.table_id),
    dishId: row.dish_id || "",
    name: row.name,
    price: Number(row.price) || 0,
    qty: Number(row.qty) || 1,
    course: row.course || undefined,
    status: row.status === "servito" ? "servito" : "ordinato",
    orderedAt: row.ordered_at,
    servedAt: row.served_at || null,
  };
}

/** Righe piatto (solo Cucina) per un singolo tavolo, usate nel pannello "Stato portate". */
export async function fetchOrderItemsForTable(tableId: string): Promise<OrderItemRow[]> {
  try {
    const { data, error } = await supabase
      .from("order_items")
      .select("*")
      .eq("table_id", tableId)
      .order("ordered_at", { ascending: true });
    if (error) throw error;
    return (data || []).map(mapRow);
  } catch (err) {
    console.error("[Supabase] Errore recupero stato portate:", err);
    return [];
  }
}

/** Tutte le righe non ancora servite di tutti i tavoli: usate per lo stato sintetico sulla mappa live. */
export async function fetchAllOpenOrderItems(): Promise<OrderItemRow[]> {
  try {
    // "Aperte" = non servite, oppure servite di recente (utile per capire quando un tavolo
    // ha appena finito una portata ed è "in attesa" della successiva).
    const { data, error } = await supabase
      .from("order_items")
      .select("*")
      .order("ordered_at", { ascending: true });
    if (error) throw error;
    return (data || []).map(mapRow);
  } catch (err) {
    console.error("[Supabase] Errore recupero righe ordine:", err);
    return [];
  }
}

/** Registra le righe piatto (solo destinazione Cucina) al momento dell'invio della comanda. */
export async function insertOrderItems(
  tableId: string,
  tableLabel: string,
  items: { id: string; name: string; price: number; qty: number; course?: string }[],
): Promise<boolean> {
  if (items.length === 0) return true;
  try {
    const rows = items.map((item) => ({
      table_id: tableId,
      table_label: tableLabel,
      dish_id: item.id,
      name: item.name,
      price: item.price,
      qty: item.qty,
      course: item.course || null,
      status: "ordinato",
    }));
    const { error } = await supabase.from("order_items").insert(rows);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error("[Supabase] Errore registrazione righe ordine:", err);
    return false;
  }
}

/** Solo il cameriere segna i piatti come serviti: singolo o gruppo, con timestamp automatico. */
export async function markOrderItemsServed(ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  try {
    const { error } = await supabase
      .from("order_items")
      .update({ status: "servito", served_at: new Date().toISOString() })
      .in("id", ids);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error("[Supabase] Errore aggiornamento piatti serviti:", err);
    return false;
  }
}

/** Riassegna le righe piatto già inviate in cucina da un tavolo a un altro (spostamento/unione ordine). */
export async function reassignOrderItemsTable(
  fromTableId: string,
  toTableId: string,
  toTableLabel: string,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("order_items")
      .update({ table_id: toTableId, table_label: toTableLabel })
      .eq("table_id", fromTableId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error("[Supabase] Errore spostamento righe ordine:", err);
    return false;
  }
}

/** Ripulisce le righe di un tavolo quando il conto viene chiuso (evita che restino "aperte" all'infinito). */
export async function clearOrderItemsForTable(tableId: string): Promise<boolean> {
  try {
    const { error } = await supabase.from("order_items").delete().eq("table_id", tableId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error("[Supabase] Errore pulizia righe ordine:", err);
    return false;
  }
}

/**
 * Stato sintetico calcolato per un tavolo, a partire dalle righe Cucina non ancora chiuse:
 * - "in_preparazione": ci sono piatti ordinati non ancora serviti
 * - "in_attesa": tutti i piatti finora ordinati sono stati serviti (in attesa della portata
 *   successiva, oppure del conto)
 * - "nessuno": nessuna riga cucina per questo tavolo (es. solo drink, o niente ancora inviato)
 */
export type TableCourseSummary = {
  synthetic: "in_preparazione" | "in_attesa" | "nessuno";
  oldestPendingAt: string | null;
};

export function summarizeTableCourses(items: OrderItemRow[], tableId: string): TableCourseSummary {
  const forTable = items.filter((i) => i.tableId === tableId);
  if (forTable.length === 0) return { synthetic: "nessuno", oldestPendingAt: null };

  const pending = forTable.filter((i) => i.status === "ordinato");
  if (pending.length > 0) {
    const oldest = pending.reduce((min, i) => (i.orderedAt < min ? i.orderedAt : min), pending[0].orderedAt);
    return { synthetic: "in_preparazione", oldestPendingAt: oldest };
  }
  return { synthetic: "in_attesa", oldestPendingAt: null };
}
