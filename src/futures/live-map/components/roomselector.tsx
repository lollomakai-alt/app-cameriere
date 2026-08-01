import React, { useState } from "react";
import { Plus, Check, X } from "lucide-react";
import type { PosRoom } from "@/lib/rooms-store";

interface RoomSelectorProps {
  rooms: PosRoom[];
  activeRoomId: string;
  onRoomChange: (id: string) => void;
  onAddRoom: (name: string) => void;
}

/** Barra sale minimale: solo i selettori + un piccolo "+" per aggiungere una sala. */
export const RoomSelector: React.FC<RoomSelectorProps> = ({
  rooms,
  activeRoomId,
  onRoomChange,
  onAddRoom,
}) => {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const confirm = () => {
    if (name.trim()) onAddRoom(name.trim());
    setName("");
    setAdding(false);
  };

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto">
      {rooms.map((room) => {
        const isActive = String(room.id) === String(activeRoomId);
        return (
          <button
            key={room.id}
            onClick={() => onRoomChange(room.id)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors ${
              isActive
                ? "bg-emerald-500 text-black"
                : "bg-slate-900/70 border border-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            {room.name}
          </button>
        );
      })}

      {adding ? (
        <div className="flex items-center gap-1" data-keep-open>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirm();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="Nuova sala"
            className="w-28 rounded-lg bg-slate-900 border border-emerald-500/40 px-2 py-1.5 text-[11px] text-white placeholder-slate-600 focus:outline-none"
          />
          <button
            onClick={confirm}
            className="p-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-400"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setAdding(false)}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          title="Aggiungi sala"
          className="p-1.5 rounded-lg bg-slate-900/70 border border-slate-800 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/40 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
