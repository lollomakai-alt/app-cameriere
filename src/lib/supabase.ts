import { createClient } from "@supabase/supabase-js";

// Credenziali di connessione a Supabase
export const SUPABASE_URL = "https://yyrawuynqukwszvotiuu.supabase.co";
export const SUPABASE_KEY = "sb_publishable_5pTXjGcknQWzbVDWwD4tSQ_trCjQV0b";

// Client Supabase globale per il gestionale
export const supabase = createClient("https://yyrawuynqukwszvotiuu.supabase.co", "sb_publishable_5pTXjGcknQWzbVDWwD4tSQ_trCjQV0b");
