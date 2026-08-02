import { supabase } from "@/lib/supabase";

const SETTINGS_KEY = "alert_soglia_minuti";
export const DEFAULT_ALERT_THRESHOLD_MINUTES = 20;

/** Soglia (in minuti) oltre la quale un tavolo in attesa mostra l'alert visivo sulla mappa. */
export async function fetchAlertThreshold(): Promise<number> {
  const { data, error } = await supabase.from("settings").select("*").eq("key", SETTINGS_KEY).maybeSingle();
  if (error) {
    console.error("[Supabase] Errore recupero soglia alert:", error.message);
    return DEFAULT_ALERT_THRESHOLD_MINUTES;
  }
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ALERT_THRESHOLD_MINUTES;
}

export async function saveAlertThreshold(minutes: number): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("settings")
      .upsert({ key: SETTINGS_KEY, value: String(minutes) }, { onConflict: "key" });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error("[Supabase] Errore salvataggio soglia alert:", err);
    return false;
  }
}
