import { supabase } from "@/lib/supabase";
import { DEFAULT_COURSES } from "@/lib/menu-data";

const SETTINGS_KEY = "portate_list";

export async function fetchCourses(): Promise<string[]> {
  const { data, error } = await supabase.from("settings").select("*").eq("key", SETTINGS_KEY).maybeSingle();
  if (error) {
    console.error("[Supabase] Errore recupero portate:", error.message);
    return DEFAULT_COURSES;
  }
  if (!data?.value) return DEFAULT_COURSES;
  try {
    const parsed = JSON.parse(data.value);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_COURSES;
  } catch {
    return DEFAULT_COURSES;
  }
}

export async function saveCourses(list: string[]): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("settings")
      .upsert({ key: SETTINGS_KEY, value: JSON.stringify(list) }, { onConflict: "key" });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error("[Supabase] Errore salvataggio portate:", err);
    return false;
  }
}
