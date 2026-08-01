import { createTable, deleteTables, updateTable, type PosTable } from "@/lib/tables-api";

/**
 * I conti al banco sono righe reali della tabella Tables, riconoscibili dal prefisso
 * dell'etichetta. Così riusano tutta la logica esistente (comande, preconti, bozze
 * auto-salvate, stampa) senza occupare celle sulla mappa dei tavoli.
 */
export const BAR_LABEL_PREFIX = "Banco ";

export function isBarTab(label: string): boolean {
  return label.startsWith(BAR_LABEL_PREFIX);
}

export function barTabNumber(label: string): number {
  const n = Number(label.slice(BAR_LABEL_PREFIX.length));
  return Number.isFinite(n) ? n : 0;
}

/** Primo numero libero: i conti chiusi liberano il numero, che viene riutilizzato. */
export function nextBarLabel(existing: PosTable[]): string {
  const used = new Set(existing.filter((t) => isBarTab(t.label)).map((t) => barTabNumber(t.label)));
  let n = 1;
  while (used.has(n)) n++;
  return `${BAR_LABEL_PREFIX}${n}`;
}

/** Apre un nuovo conto al banco (cliente appena arrivato al bancone). */
export async function openBarTab(existing: PosTable[]): Promise<PosTable> {
  const created = await createTable(nextBarLabel(existing), 0);
  // il conto nasce già occupato: al banco non esiste lo stato "libero in attesa"
  await updateTable(created.id, { status: "occupied" }).catch(() => {});
  return { ...created, status: "occupied" };
}

/** Chiude e rimuove il conto al banco: sparisce subito, il numero torna disponibile. */
export async function closeBarTab(id: string): Promise<void> {
  await deleteTables([id]);
}
