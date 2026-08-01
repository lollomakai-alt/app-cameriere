export interface PosRoom {
  id: string;
  name: string;
  prefix: string;
}

const KEY = "makai.rooms";

export const DEFAULT_ROOMS: PosRoom[] = [
  { id: "1", name: "Sala Interna", prefix: "T" },
  { id: "2", name: "Dehors", prefix: "D" },
];

export function loadRooms(): PosRoom[] {
  if (typeof window === "undefined") return DEFAULT_ROOMS;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as PosRoom[]) : null;
    return parsed && parsed.length ? parsed : DEFAULT_ROOMS;
  } catch {
    return DEFAULT_ROOMS;
  }
}

export function saveRooms(rooms: PosRoom[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(rooms));
}

/** Genera un prefisso univoco a partire dal nome della sala. */
export function makePrefix(name: string, existing: PosRoom[]): string {
  const base = (name.trim()[0] || "S").toUpperCase();
  let prefix = base;
  let i = 2;
  while (existing.some((r) => r.prefix === prefix)) {
    prefix = `${base}${i++}`;
  }
  return prefix;
}
