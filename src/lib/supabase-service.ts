import { supabase } from "@/lib/supabase";
import type { TableStatus, PosTable } from "@/lib/tables-api";
import { updateTable } from "@/lib/tables-api";
import { MenuDish } from "@/lib/menu-data";
import { insertOrderItems, clearOrderItemsForTable } from "@/lib/order-items-api";

export type PosOrderItem = {
  id: string;
  name: string;
  qty: number;
  price: number;
  note?: string;
  [key: string]: any;
};

export type PosTicket = {
  tableId: string;
  tableLabel?: string;
  items?: PosOrderItem[];
  total?: number;
  /** Numero di coperti al momento della chiusura: modificabile in ogni momento dal cameriere. */
  covers?: number;
  [key: string]: any;
};

export type SupabaseOrderPayload = {
  type: "COMANDA" | "PRECONTO" | "ORDINE";
  tableId: string;
  tableLabel: string;
  items: PosOrderItem[];
  subtotal: number;
  total: number;
  covers?: number;
  destination?: string;
  waiterName?: string;
  timestamp?: string;
};

export async function sendOrderToSupabase(payload: SupabaseOrderPayload): Promise<boolean> {
  const timestamp = payload.timestamp || new Date().toISOString();
  const tableLabel = payload.tableLabel || payload.tableId;
  const randomId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);

  try {
    const { error: jobErr } = await supabase.from("print_jobs").insert([
      {
        status: "nuovo",
        payload: {
          tavolo: tableLabel,
          table_id: payload.tableId,
          type: payload.type,
          destination: payload.destination || "Cucina",
          items: payload.items,
          total: payload.total,
          covers: payload.covers,
          timestamp: timestamp,
        },
      },
    ]);
    if (jobErr) console.warn("[Supabase] Avviso print_jobs:", jobErr.message);

    if (payload.type === "COMANDA") {
      const { error: comandeErr } = await supabase.from("comande").insert([
        {
          id: randomId,
          tavolo: tableLabel,
          destination: payload.destination || "Cucina",
          piatti: payload.items,
        },
      ]);
      if (comandeErr) console.warn("[Supabase] Avviso comande:", comandeErr.message);

      // Solo i piatti destinati alla Cucina entrano nel flusso di stato ordinato/servito:
      // il bar/cocktail va dritto al banco e non ha bisogno di essere spuntato dal cameriere.
      const kitchenItems = payload.items.filter((item) => (item.destination || "Cucina") === "Cucina");
      await insertOrderItems(payload.tableId, tableLabel, kitchenItems);
    }

    const { error: ordiniErr } = await supabase.from("ordini").insert([
      {
        id: randomId,
        tavolo: tableLabel,
        piatti: payload.items,
        tipo: payload.type,
        stato: "nuovo",
        created_at: timestamp,
      },
    ]);
    if (ordiniErr) console.warn("[Supabase] Avviso ordini:", ordiniErr.message);

    // Il preconto è la richiesta esplicita del conto: il tavolo passa in "attesa conto".
    // Negli altri casi (comanda inviata) resta semplicemente "occupato": lo stato di
    // avanzamento del cibo (in preparazione / in attesa portata) è calcolato a parte
    // dalle righe order_items, senza toccare lo stato manuale del tavolo.
    await updateTableStatusInSupabase(payload.tableId, payload.type === "PRECONTO" ? "attesa conto" : "occupied");
    return true;
  } catch (err) {
    console.error("[Supabase] Errore salvataggio ordine:", err);
    return false;
  }
}

export async function updateTableStatusInSupabase(tableId: string, status: TableStatus, extra?: { x?: number; y?: number; label?: string }): Promise<boolean> {
  try {
    await updateTable(tableId, { status, x: extra?.x, y: extra?.y, label: extra?.label });
    return true;
  } catch (err) {
    console.error("[Supabase] Errore aggiornamento stato tavolo:", err);
    return false;
  }
}

export async function closeTicketInSupabase(ticket: PosTicket): Promise<boolean> {
  try {
    const { error: ticketErr } = await supabase.from("tickets").insert([
      {
        table_id: ticket.tableId,
        table_label: ticket.tableLabel || ticket.tableId,
        items: ticket.items || [],
        total: ticket.total || 0,
        covers: ticket.covers ?? null,
        status: "closed",
        closed_at: new Date().toISOString(),
      },
    ]);
    if (ticketErr) throw ticketErr;

    await updateTableStatusInSupabase(ticket.tableId, "free");
    await clearOrderItemsForTable(ticket.tableId);
    return true;
  } catch (err) {
    console.error("[Supabase] Errore chiusura conto:", err);
    return false;
  }
}

/* ==========================================
   GESTIONE MENU CONNESSA A public.menu_dishes
   ========================================== */

export async function fetchMenuDishesFromSupabase(): Promise<MenuDish[] | null> {
  try {
    const { data, error } = await supabase.from("menu_dishes").select("*");
    if (error) {
      console.error("[Supabase] Errore recupero menu_dishes:", error.message);
      return null;
    }
    const dishes = (data || []).map((row: any) => ({
      id: String(row.id),
      name: row.name,
      description: row.description || "",
      price: String(row.price || 0),
      destination: row.destination || "Cucina",
      isComposable: Boolean(row.is_composable),
      ingredients: Array.isArray(row.ingredients) ? row.ingredients : [],
      categoryRules: row.category_rules && typeof row.category_rules === "object" ? row.category_rules : {},
      course: row.course || undefined,
      isQuickItem: Boolean(row.is_quick_item),
    }));

    // Rimuove i piatti doppi: stesso nome scritto esattamente uguale (spazi iniziali/finali ignorati).
    // Tiene il primo incontrato, così eventuali righe duplicate su Supabase non vengono più mostrate.
    const seenNames = new Set<string>();
    const deduped = dishes.filter((dish) => {
      const key = dish.name.trim().toLowerCase();
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });

    return deduped;
  } catch (err) {
    console.error("[Supabase] Errore fetch menu:", err);
    return null;
  }
}

export async function saveDishToSupabase(dish: MenuDish): Promise<boolean> {
  try {
    const payload = {
      id: dish.id,
      name: dish.name,
      description: dish.description,
      price: Number(dish.price) || 0,
      destination: dish.destination,
      is_composable: !!dish.isComposable,
      ingredients: dish.ingredients ?? [],
      category_rules: dish.categoryRules ?? {},
      course: dish.course || null,
      is_quick_item: !!dish.isQuickItem,
    };

    const { error } = await supabase.from("menu_dishes").upsert([payload]);
    if (error) {
      console.error("[Supabase] Errore salvataggio piatto:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Supabase] Errore salvataggio dish:", err);
    return false;
  }
}

export async function deleteDishFromSupabase(dishId: string): Promise<boolean> {
  try {
    const { error } = await supabase.from("menu_dishes").delete().eq("id", dishId);
    if (error) {
      console.error("[Supabase] Errore eliminazione piatto:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Supabase] Errore delete dish:", err);
    return false;
  }
}

export async function reopenTicketInSupabase(ticket: PosTicket & { id?: string }): Promise<boolean> {
  try {
    if (ticket.id) {
      const { error } = await supabase.from("tickets").update({ status: "reopened" }).eq("id", ticket.id);
      if (error) throw error;
    }

    await updateTableStatusInSupabase(ticket.tableId, "occupied");

    // Ripristina il conto nel draft locale del tavolo, così il cameriere ritrova gli articoli e può continuare a modificarlo
    if (typeof window !== "undefined" && ticket.tableId) {
      try {
        window.localStorage.setItem(
          `draft:table:${ticket.tableId}`,
          JSON.stringify({ orderItems: ticket.items || [], discountPercent: 0, splitCount: 1 }),
        );
      } catch {
        // storage non disponibile: la riapertura su Supabase resta comunque valida
      }
    }

    return true;
  } catch (err) {
    console.error("[Supabase] Errore riapertura conto:", err);
    return false;
  }
}
