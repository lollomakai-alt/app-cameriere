const SESSION_KEY = "cameriere.employee_session";

export interface EmployeeSession {
  id: string;
  name: string;
  role: string;
}

export function loadSession(): EmployeeSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as EmployeeSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: EmployeeSession) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_KEY);
}
