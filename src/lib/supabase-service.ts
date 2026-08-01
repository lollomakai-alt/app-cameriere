import { supabase } from "@/lib/supabase";
import type { TableStatus, PosTable } from "@/lib/tables-api";
import { updateTable } from "@/lib/tables-api";
import { MenuDish } from "@/lib/menu-data";

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
  [key: string]: any;
};

export type SupabaseOrderPayload = {
  type: "COMANDA" | "PRECONTO" | "ORDINE";
  tableId: string;
  tableLabel: string;
  items: PosOrderItem[];
  subtotal: number;
  total: number;
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
          timestamp: timestamp,
        },
      },
    ]);
    if (jobErr) console.warn("[Supabase] Avviso print_jobs:", jobErr.message);

    if (payload.type === "COMANDA") {
      const piattiConStato = payload.items.map((item) => ({ ...item, status: item.status || "nuovo" }));
      const { error: comandeErr } = await supabase.from("comande").insert([
        {
          id: randomId,
          tavolo: tableLabel,
          destination: payload.destination || "Cucina",
          piatti: piattiConStato,
        },
      ]);
      if (comandeErr) console.warn("[Supabase] Avviso comande:", comandeErr.message);
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

    await updateTableStatusInSupabase(payload.tableId, "occupied");
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
    await updateTableStatusInSupabase(ticket.tableId, "free");
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
    return (data || []).map((row: any) => ({
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

export async function reopenTicketInSupabase(ticket: PosTicket): Promise<boolean> {
  return true;
}
