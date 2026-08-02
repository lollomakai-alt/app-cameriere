import React, { useEffect, useRef, useState } from "react";
import { ScanLine, KeyRound, Loader2 } from "lucide-react";
import { loginWithToken } from "@/lib/employees-api";
import { saveSession, type EmployeeSession } from "@/lib/employee-session";

interface QrLoginScreenProps {
  onLoggedIn: (session: EmployeeSession) => void;
}

/**
 * Schermata di accesso dell'App Cameriere: inquadra il QR generato dal gestionale
 * (Impostazioni -> Gestione Dipendenti) e logga in automatico, senza password.
 * Se la fotocamera non è disponibile o dà problemi, c'è sempre l'inserimento manuale del codice.
 */
export function QrLoginScreen({ onLoggedIn }: QrLoginScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const scanningRef = useRef(true);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const attemptLogin = async (token: string) => {
    if (checking) return;
    scanningRef.current = false;
    setChecking(true);
    setLoginError(null);
    try {
      const employee = await loginWithToken(token.trim());
      if (!employee) {
        setLoginError("Codice non valido o dipendente disattivato.");
        scanningRef.current = true;
        setChecking(false);
        return;
      }
      const session: EmployeeSession = { id: employee.id, name: employee.name, role: employee.role };
      saveSession(session);
      onLoggedIn(session);
    } catch (err) {
      console.error("Errore login QR:", err);
      setLoginError("Errore di connessione. Riprova.");
      scanningRef.current = true;
      setChecking(false);
    }
  };

  useEffect(() => {
    if (manualMode) return;
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        scanLoop();
      } catch (err) {
        console.error("Errore fotocamera:", err);
        setCameraError("Impossibile accedere alla fotocamera. Usa l'inserimento manuale del codice.");
      }
    }

    async function scanLoop() {
      const jsQR = (await import("jsqr")).default;
      const tick = () => {
        if (cancelled) return;
        if (!scanningRef.current) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            if (code && code.data) {
              attemptLogin(code.data);
              return;
            }
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualMode]);

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-[#030712] p-6 text-slate-100">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center space-y-1.5">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
            <ScanLine className="h-7 w-7" />
          </div>
          <h1 className="text-lg font-black uppercase tracking-wider text-emerald-300">App Cameriere</h1>
          <p className="text-xs text-slate-400">Inquadra il tuo QR personale per accedere</p>
        </div>

        {!manualMode ? (
          <>
            <div className="relative overflow-hidden rounded-3xl border-2 border-emerald-500/30 bg-slate-950 aspect-square">
              <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
              <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-emerald-400/60" />
              {checking && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70">
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
                  <span className="text-xs font-bold text-emerald-300">Verifica in corso...</span>
                </div>
              )}
            </div>
            {cameraError && <p className="text-xs text-rose-400 text-center">{cameraError}</p>}
            {loginError && <p className="text-xs text-rose-400 text-center">{loginError}</p>}
            <button
              onClick={() => setManualMode(true)}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 py-3 text-xs font-bold text-slate-400 hover:text-white transition-colors"
            >
              <KeyRound className="h-4 w-4" />
              Inserisci il codice manualmente
            </button>
          </>
        ) : (
          <>
            <input
              autoFocus
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && attemptLogin(manualCode)}
              placeholder="Incolla o scrivi il codice"
              className="w-full rounded-xl border border-emerald-500/40 bg-slate-900 px-4 py-3.5 text-sm text-white font-mono focus:outline-none focus:border-emerald-400"
            />
            {loginError && <p className="text-xs text-rose-400 text-center">{loginError}</p>}
            <button
              onClick={() => attemptLogin(manualCode)}
              disabled={checking || !manualCode.trim()}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 py-3.5 text-sm font-black text-slate-950 uppercase tracking-wide transition-all"
            >
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Accedi
            </button>
            <button
              onClick={() => {
                setManualMode(false);
                setLoginError(null);
              }}
              className="w-full text-center text-xs font-bold text-slate-500 hover:text-slate-300 py-2"
            >
              Torna alla scansione
            </button>
          </>
        )}
      </div>
    </div>
  );
}
