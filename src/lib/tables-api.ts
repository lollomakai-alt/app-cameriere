import { supabase } from "@/lib/supabase";

/**
 * ATTENZIONE: le colonne della tabella "Tables" su Supabase sono state create
 * con un carattere invisibile (U+2060 WORD JOINER) nel nome. Vanno referenziate
 * con il nome esatto, altrimenti PostgREST risponde 42703 (column does not exist).
 */
const WJ = "\u2060";
export const COL_LABEL = `${WJ}table_number`;
export const COL_X = `position_x${WJ}`;
export const COL_Y = `position_y${WJ}`;

export type TableStatus = "free" | "reserved" | "preparing" | "ready" | "occupied" | "attesa conto";

export interface PosTable {
  id: string;
  label: string;
  status: TableStatus;
  x: number;
  y: number;
  seats: number;
  span: number;
}

const SPAN_KEY = "makai.table.spans";

function readSpans(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(SPAN_KEY) || "{}");
  } catch {
    return {};
  }
}

export function writeSpan(id: string, span: number) {
  if (typeof window === "undefined") return;
  const spans = readSpans();
  if (span <= 1) delete spans[id];
  else spans[id] = span;
  window.localStorage.setItem(SPAN_KEY, JSON.stringify(spans));
}

function normalizeStatus(raw: unknown): TableStatus {
  const s = String(raw ?? "").toLowerCase();
  if (s === "occupied" || s === "occupato") return "occupied";
  if (s === "reserved" || s === "riservato") return "reserved";
  if (s === "preparing" || s === "in_preparazione") return "preparing";
  if (s === "ready" || s === "pronto") return "ready";
  if (s === "attesa conto" || s === "attesa_conto") return "attesa conto";
  return "free";
}

/** Griglia logica: le posizioni sono colonna/riga, non percentuali dello schermo.
 * Deve restare identica a COLS/ROWS in TableCard.tsx (canvas rettangolare per iPad orizzontale),
 * altrimenti i tavoli vengono posizionati/clampati su una griglia diversa da quella disegnata.
 */
export const GRID_COLS = 8;
export const GRID_ROWS = 5;

export function gridPosition(index: number) {
  return { x: index % GRID_COLS, y: Math.floor(index / GRID_COLS) % GRID_ROWS };
}

/**
 * Le vecchie righe salvavano percentuali (0-100). Vengono convertite in celle,
 * così i tavoli restano allineati su qualsiasi dimensione di schermo.
 */
function toCell(raw: unknown, fallback: number, cells: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const cell = n > cells - 1 ? Math.round((n / 100) * cells) : Math.round(n);
  return Math.max(0, Math.min(cells - 1, cell));
}


function mapRow(row: Record<string, any>, index: number, spans: Record<string, number>): PosTable {
  const id = String(row.id);
  const fallback = gridPosition(index);
  return {
    id,
    label: String(row[COL_LABEL] ?? `T${index + 1}`),
    status: normalizeStatus(row.status),
    x: toCell(row[COL_X], fallback.x, GRID_COLS),
    y: toCell(row[COL_Y], fallback.y, GRID_ROWS),

    seats: Number(row.seats ?? 2),
    span: spans[id] ?? 1,
  };
}


export async function fetchTables(): Promise<PosTable[]> {
  const { data, error } = await supabase.from("Tables").select("*").order("id", { ascending: true });
  if (error) throw error;
  const spans = readSpans();
  return (data ?? []).map((row, i) => mapRow(row as Record<string, any>, i, spans));
}

export async function createTable(label: string, index: number): Promise<PosTable> {
  const pos = gridPosition(index);
  const { data, error } = await supabase
    .from("Tables")
    .insert([
      {
        [COL_LABEL]: label,
        status: "free",
        [COL_X]: pos.x,
        [COL_Y]: pos.y,
        seats: 2,
      },
    ])
    .select()
    .single();
  if (error) throw error;
  return mapRow(data as Record<string, any>, index, readSpans());
}

export async function deleteTables(ids: string[]): Promise<void> {
  if (!ids.length) return;
  ids.forEach((id) => writeSpan(id, 1));
  const { error } = await supabase.from("Tables").delete().in("id", ids.map(Number));
  if (error) throw error;
}

export async function updateTable(
  id: string,
  patch: { label?: string; status?: TableStatus; x?: number; y?: number; seats?: number },
): Promise<void> {
  const payload: Record<string, any> = {};
  if (patch.label !== undefined) payload[COL_LABEL] = patch.label;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.x !== undefined) payload[COL_X] = patch.x;
  if (patch.y !== undefined) payload[COL_Y] = patch.y;
  if (patch.seats !== undefined) payload.seats = patch.seats;
  if (!Object.keys(payload).length) return;
  const { error } = await supabase.from("Tables").update(payload).eq("id", Number(id));
  if (error) throw error;
}
