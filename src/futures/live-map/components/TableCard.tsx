import React, { useRef } from "react";

export type TableStatus = "free" | "reserved" | "preparing" | "ready" | "occupied" | "attesa conto";

export interface PosTable {
  id: string | number;
  label: string;
  status: TableStatus;
  /** colonna sulla griglia (0-based) */
  x: number;
  /** riga sulla griglia (0-based) */
  y: number;
  seats?: number;
  span?: number;
}

/** Griglia logica della mappa: indipendente dalla dimensione dello schermo. */
export const COLS = 4;
export const ROWS = 6;
/** Limiti del lato del tavolo (quadrato) in px. */
export const MIN_CELL = 52;
export const MAX_CELL = 116;

export function tableSpan(table: PosTable): number {
  return Math.max(1, Math.round(table.span ?? 1));
}

/** Lato di una cella (= lato del tavolo) per un canvas dato. */
export function cellSize(width: number, height: number): number {
  if (!width || !height) return MIN_CELL;
  const raw = Math.min(width / COLS, height / ROWS);
  return Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(raw)));
}

const statusStyle: Record<string, { border: string; bg: string; text: string; label: string }> = {
  free: {
    border: "border-2 border-emerald-400/80 shadow-[0_0_18px_rgba(16,185,129,0.25)]",
    bg: "bg-[#0b1f15]/95",
    text: "text-emerald-400",
    label: "libero",
  },
  reserved: {
    border: "border-2 border-cyan-400 shadow-[0_0_22px_rgba(6,182,212,0.45)]",
    bg: "bg-[#0b0f19]/95",
    text: "text-cyan-300",
    label: "prenotato",
  },
  preparing: {
    border: "border-2 border-orange-400 shadow-[0_0_22px_rgba(249,115,22,0.45)]",
    bg: "bg-[#1a1005]/95",
    text: "text-orange-300",
    label: "in prep",
  },
  ready: {
    border: "border-2 border-purple-400 shadow-[0_0_22px_rgba(168,85,247,0.45)]",
    bg: "bg-[#120f24]/95",
    text: "text-purple-300",
    label: "pronto",
  },
  occupied: {
    border: "border-2 border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.35)]",
    bg: "bg-[#250b11]/95",
    text: "text-rose-400",
    label: "occupato",
  },
  "attesa conto": {
    border: "border-2 border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.35)]",
    bg: "bg-[#1d1405]/95",
    text: "text-amber-300",
    label: "conto",
  },
};

interface TableCardProps {
  table: PosTable;
  /** lato cella corrente in px */
  cell: number;
  onTap: (id: string) => void;
  /** rilascio: colonna/riga già snappate */
  onMove?: (id: string, col: number, row: number) => void;
  isMultiSelected?: boolean;
  editMode?: boolean;
}

export const TableCard: React.FC<TableCardProps> = ({
  table,
  cell,
  onTap,
  onMove,
  isMultiSelected,
  editMode,
}) => {
  const styleDef = statusStyle[table.status] || statusStyle.free!;
  const span = tableSpan(table);
  const width = cell * span;
  const height = cell;

  const movedRef = useRef(false);
  const nodeRef = useRef<HTMLDivElement | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!editMode || !onMove) return;
    e.stopPropagation();
    e.preventDefault();
    const el = nodeRef.current;
    if (!el) return;

    const pointerId = e.pointerId;
    try {
      el.setPointerCapture(pointerId);
    } catch {
      // alcuni browser possono rifiutare la capture su target già rimossi: non è bloccante
    }

    movedRef.current = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const baseLeft = table.x * cell;
    const baseTop = table.y * cell;
    const maxLeft = Math.max(0, (COLS - span) * cell);
    const maxTop = Math.max(0, (ROWS - 1) * cell);
    // sul touch il dito è meno preciso del mouse: soglia più alta evita
    // trascinamenti involontari quando l'utente vuole solo toccare il tavolo
    const threshold = e.pointerType === "touch" ? 8 : 3;
    let left = baseLeft;
    let top = baseTop;

    el.style.zIndex = "40";
    el.style.transition = "none";

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!movedRef.current && Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
      movedRef.current = true;
      left = Math.min(maxLeft, Math.max(0, baseLeft + dx));
      top = Math.min(maxTop, Math.max(0, baseTop + dy));
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };

    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        // no-op se già rilasciata dal browser
      }
      el.style.zIndex = "";
      el.style.transition = "";
      if (!movedRef.current) return;
      // snap alla cella più vicina (i tavoli restano sempre allineati tra loro)
      const col = Math.max(0, Math.min(COLS - span, Math.round(left / cell)));
      const row = Math.max(0, Math.min(ROWS - 1, Math.round(top / cell)));
      el.style.left = `${col * cell}px`;
      el.style.top = `${row * cell}px`;
      onMove(String(table.id), col, row);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <div
      ref={nodeRef}
      data-keep-open
      onPointerDown={handlePointerDown}
      onClick={() => {
        if (!movedRef.current) onTap(String(table.id));
      }}
      style={{
        left: table.x * cell,
        top: table.y * cell,
        width,
        height,
        padding: 4,
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        touchAction: "none",
      }}
      className={`absolute flex flex-col items-center justify-center rounded-2xl text-center backdrop-blur-md touch-none select-none ${
        editMode ? "cursor-grab active:cursor-grabbing border-dashed border-cyan-400/80" : "cursor-pointer"
      } ${styleDef.bg} ${styleDef.border} ${
        isMultiSelected ? "ring-4 ring-purple-400 border-purple-400" : ""
      }`}
    >
      <span className="text-sm font-bold tracking-wide text-slate-100 drop-shadow">{table.label}</span>
      <span className={`text-[10px] font-semibold uppercase tracking-wider ${styleDef.text}`}>
        {styleDef.label}
      </span>
      <span className="text-[10px] text-slate-400">{table.seats ?? 4} p.</span>

      {span > 1 && (
        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-[10px] font-bold text-slate-300">
          {span}
        </span>
      )}
    </div>
  );
};
