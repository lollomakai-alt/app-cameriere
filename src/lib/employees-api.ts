import { supabase } from "@/lib/supabase";

export interface Employee {
  id: string;
  name: string;
  role: string;
  token: string;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
}

function mapRow(row: any): Employee {
  return {
    id: String(row.id),
    name: row.name,
    role: row.role || "",
    token: row.token,
    active: row.active !== false,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  };
}

/** Genera un token sicuro e univoco (lato client, sufficiente per un QR di accesso interno). */
function generateSecureToken(): string {
  const bytes = new Uint8Array(24);
  if (typeof window !== "undefined" && window.crypto) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function fetchEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase.from("employees").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(mapRow);
}

/** Crea un nuovo dipendente con un token sicuro univoco, pronto per generare il QR di accesso. */
export async function createEmployee(name: string, role: string): Promise<Employee> {
  const token = generateSecureToken();
  const { data, error } = await supabase
    .from("employees")
    .insert([{ name, role: role || null, token, active: true }])
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

/** Rigenera il token (e quindi il QR) di un dipendente: il vecchio QR stampato smette di funzionare. */
export async function regenerateEmployeeToken(id: string): Promise<Employee> {
  const token = generateSecureToken();
  const { data, error } = await supabase.from("employees").update({ token }).eq("id", id).select().single();
  if (error) throw error;
  return mapRow(data);
}

export async function setEmployeeActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("employees").update({ active }).eq("id", id);
  if (error) throw error;
}

export async function deleteEmployee(id: string): Promise<void> {
  const { error } = await supabase.from("employees").delete().eq("id", id);
  if (error) throw error;
}

/** Usata dall'App Cameriere alla scansione del QR: verifica il token e registra l'accesso. */
export async function loginWithToken(token: string): Promise<Employee | null> {
  const { data, error } = await supabase.from("employees").select("*").eq("token", token).eq("active", true).maybeSingle();
  if (error || !data) return null;
  await supabase.from("employees").update({ last_login_at: new Date().toISOString() }).eq("id", data.id);
  return mapRow(data);
}
