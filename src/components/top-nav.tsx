import { Globe, LogOut, MapPin } from "lucide-react";

/**
 * Versione minimale della TopNav: qui c'è solo la Mappa Live, quindi niente
 * link ad altre pagine (Menu, Impostazioni, Storico...) che in questa app
 * dedicata al cameriere non esistono.
 */
export function TopNav({
  active,
  employeeName,
  onLogout,
}: {
  active?: "Mappa Live";
  employeeName?: string;
  onLogout?: () => void;
}) {
  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center border-b border-emerald-500/20 bg-slate-950/80 px-6 backdrop-blur-xl select-none">
      <div className="flex flex-1 items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
          <MapPin className="h-4 w-4" />
        </div>
        <span className="text-sm font-black uppercase tracking-wider text-emerald-300 drop-shadow-[0_0_10px_rgba(16,185,129,0.4)]">
          Sala — Mappa Live
        </span>
        {employeeName && (
          <span className="ml-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
            {employeeName}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="inline-flex min-h-[40px] items-center gap-2 rounded-xl px-3 text-xs text-slate-400 bg-slate-900/60 border border-slate-800/80">
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.9)]" />
          </span>
          <span className="font-bold text-slate-300">Online</span>
        </span>
        <button
          type="button"
          aria-label="Lingua"
          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200 active:scale-95 transition-all"
        >
          <Globe className="h-4 w-4" />
          <span className="ml-1 text-xs font-bold">IT</span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (onLogout && window.confirm("Uscire dall'app? Dovrai riscansionare il tuo QR per rientrare.")) {
              onLogout();
            }
          }}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-800/80 bg-slate-900/60 px-3.5 text-xs font-bold text-slate-300 hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/30 active:scale-95 transition-all"
        >
          <LogOut className="h-4 w-4" />
          <span>Esci</span>
        </button>
      </div>
    </header>
  );
}
