import React, { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { 
  fetchMenuDishesFromSupabase, 
  sendOrderToSupabase, 
  closeTicketInSupabase,
  updateTableStatusInSupabase,
} from "@/lib/supabase-service";
import { fetchOrderItemsForTable, markOrderItemsServed, reassignOrderItemsTable, summarizeTableCourses, type OrderItemRow } from "@/lib/order-items-api";
import { fetchAlertThreshold, DEFAULT_ALERT_THRESHOLD_MINUTES } from "@/lib/alert-settings-api";
import { MenuDish, CATEGORY_SUGGESTIONS, DEFAULT_CATEGORY_RULE, DEFAULT_COURSES } from "@/lib/menu-data";
import { fetchCourses } from "@/lib/courses-api";
import { Search, Plus, Minus, Send, FileText, CreditCard, Utensils, Layers, Zap, Check, CheckCircle2, Clock, Users, ArrowRightLeft } from "lucide-react";

interface ReservationInfo {
  clientName?: string;
  covers?: number;
  time?: string;
  notes?: string;
}

interface OrderManagerProps {
  tableId: string;
  tableLabel: string;
  /** Posti del tavolo: usato solo come valore di default per i coperti al primo ordine. */
  tableSeats?: number;
  reservation?: ReservationInfo | null;
  onClose: () => void;
  onFlash: (msg: string) => void;
  onConvertToActive?: (tableId: string) => void;
  /** Chiamata dopo la chiusura riuscita del conto (usata per rimuovere i conti al banco). */
  onTicketClosed?: (tableId: string) => void;
  /** Altri tavoli su cui si può spostare/unire l'ordine corrente (es. tavolo sbagliato per errore). */
  otherTables?: { id: string; label: string; status: string }[];
  /** Chiamata dopo uno spostamento riuscito: il chiamante riapre l'Order Manager sul tavolo di destinazione. */
  onOrderMoved?: (targetId: string, targetLabel: string) => void;
}

/** Chiave di storage locale per il draft dell'ordine in corso, isolata per tavolo. */
function draftKey(tableId: string) {
  return `draft:table:${tableId}`;
}

function loadDraft(
  tableId: string,
): { orderItems: any[]; discountPercent: number; splitCount: number; covers?: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftKey(tableId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.orderItems)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function OrderManager({ 
  tableId, 
  tableLabel, 
  tableSeats,
  reservation = null, 
  onClose, 
  onFlash,
  onConvertToActive,
  onTicketClosed,
  otherTables = [],
  onOrderMoved,
}: OrderManagerProps) {
  const initialDraft = loadDraft(tableId);
  const [menuDishes, setMenuDishes] = useState<MenuDish[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [quickFilter, setQuickFilter] = useState<string>("all");
  // Su telefono le due colonne (menu / conto) non stanno affiancate: si passa da un tab all'altro.
  // Da tablet in su (lg) restano sempre entrambe visibili come prima.
  const [mobileTab, setMobileTab] = useState<"menu" | "cart">("menu");
  const [orderItems, setOrderItems] = useState<any[]>(initialDraft?.orderItems ?? []);
  const [discountPercent, setDiscountPercent] = useState<number>(initialDraft?.discountPercent ?? 0);
  const [splitCount, setSplitCount] = useState<number>(initialDraft?.splitCount ?? 1);
  // Coperti: modificabili in qualsiasi momento, anche dopo aver già inviato l'ordine.
  // Default: valore salvato nel draft, poi quello della prenotazione, poi i posti del tavolo, infine 2.
  const [covers, setCovers] = useState<number>(
    initialDraft?.covers ?? reservation?.covers ?? tableSeats ?? 2,
  );
  const [isLoadingMenu, setIsLoadingMenu] = useState<boolean>(true);
  const [currentReservation, setCurrentReservation] = useState<ReservationInfo | null>(reservation);
  const [showCustomDish, setShowCustomDish] = useState<boolean>(false);
  const [customName, setCustomName] = useState<string>("");
  const [customPrice, setCustomPrice] = useState<string>("");
  const [customDestination, setCustomDestination] = useState<"Cucina" | "Bar">("Cucina");
  const [composingDish, setComposingDish] = useState<MenuDish | null>(null);
  const [composeSelection, setComposeSelection] = useState<Record<string, string[]>>({});
  const [courses, setCourses] = useState<string[]>(DEFAULT_COURSES);
  const [draftRestored] = useState<boolean>(!!initialDraft && initialDraft.orderItems.length > 0);
  // Evita doppi invii/chiusure: appena parte una richiesta verso Supabase i tasti si disabilitano.
  const [isSending, setIsSending] = useState<boolean>(false);

  // Sposta/unisci l'ordine corrente su un altro tavolo: utile se si è aperto il tavolo
  // sbagliato per errore, per non perdere quanto già inserito.
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [moveSearch, setMoveSearch] = useState("");
  const [isMoving, setIsMoving] = useState(false);

  const handleMoveOrderTo = async (target: { id: string; label: string }) => {
    if (isMoving) return;
    setIsMoving(true);
    try {
      const destDraft = loadDraft(target.id);
      const hasExistingOrder = !!destDraft && destDraft.orderItems.length > 0;

      // Unisce gli articoli: stessa logica di somma quantità usata quando si aggiunge un piatto già presente.
      const mergedItems = [...(destDraft?.orderItems ?? [])];
      for (const item of orderItems) {
        const existing = mergedItems.find((m) => m.id === item.id && m.course === item.course);
        if (existing) {
          existing.qty += item.qty;
        } else {
          mergedItems.push({ ...item });
        }
      }
      const mergedCovers = hasExistingOrder ? (destDraft?.covers ?? 0) + covers : covers;

      try {
        window.localStorage.setItem(
          draftKey(target.id),
          JSON.stringify({
            orderItems: mergedItems,
            discountPercent: destDraft?.discountPercent ?? discountPercent,
            splitCount: destDraft?.splitCount ?? splitCount,
            covers: mergedCovers,
          }),
        );
        window.localStorage.removeItem(draftKey(tableId));
      } catch {
        // storage non disponibile: procedo comunque con lo spostamento lato Supabase
      }

      // Sposta anche le righe già inviate in cucina (con il loro stato ordinato/servito)
      await reassignOrderItemsTable(tableId, target.id, target.label);

      await updateTableStatusInSupabase(target.id, "occupied");
      await updateTableStatusInSupabase(tableId, "free");

      onFlash(
        hasExistingOrder
          ? `🔀 Ordine unito al Tavolo ${target.label}`
          : `🔀 Ordine spostato sul Tavolo ${target.label}`,
      );
      // Importante: chiamare SOLO uno dei due. onOrderMoved già "sostituisce" il tavolo attivo
      // con la destinazione; se dopo chiamassimo anche onClose(), l'ultimo setState vincerebbe
      // e richiuderebbe tutto invece di riaprire sul tavolo giusto.
      if (onOrderMoved) {
        onOrderMoved(target.id, target.label);
      } else {
        onClose();
      }
    } catch (err) {
      console.error("Errore spostamento ordine:", err);
      onFlash("⚠️ Errore durante lo spostamento dell'ordine");
    } finally {
      setIsMoving(false);
    }
  };

  const filteredOtherTables = otherTables.filter((t) =>
    t.label.toLowerCase().includes(moveSearch.toLowerCase()),
  );

  // Stato Portate: righe già inviate in cucina per questo tavolo, con check ordinato/servito.
  // Solo il cameriere spunta qui, nel momento in cui porta fisicamente il piatto al tavolo.
  const [courseItems, setCourseItems] = useState<OrderItemRow[]>([]);
  const [selectedServed, setSelectedServed] = useState<string[]>([]);
  const [markingServed, setMarkingServed] = useState(false);

  const loadCourseItems = React.useCallback(async () => {
    const rows = await fetchOrderItemsForTable(tableId);
    setCourseItems(rows);
  }, [tableId]);

  useEffect(() => {
    loadCourseItems();
    const channel = supabase
      .channel(`public:order_items:${tableId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items", filter: `table_id=eq.${tableId}` },
        () => loadCourseItems(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tableId, loadCourseItems]);

  const pendingCourseItems = courseItems.filter((i) => i.status === "ordinato");
  const servedCourseItems = courseItems.filter((i) => i.status === "servito");

  // Stato sintetico del tavolo (in preparazione / in attesa) + tempo trascorso, calcolato in tempo
  // reale dai check "servito": colora l'header del gestionale come il corso d'opera in cucina/sala.
  const [alertThresholdMinutes, setAlertThresholdMinutes] = useState<number>(DEFAULT_ALERT_THRESHOLD_MINUTES);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const wasAlertingRef = useRef(false);

  useEffect(() => {
    fetchAlertThreshold().then(setAlertThresholdMinutes);
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  const courseSummary = useMemo(() => summarizeTableCourses(courseItems, tableId), [courseItems, tableId]);
  const oldestPendingElapsedMin = courseSummary.oldestPendingAt
    ? Math.floor((nowTick - new Date(courseSummary.oldestPendingAt).getTime()) / 60000)
    : null;
  const isAlerting = oldestPendingElapsedMin !== null && oldestPendingElapsedMin >= alertThresholdMinutes;

  /** Suono di notifica delicato (due toni morbidi), usato solo quando si supera la soglia di attesa. */
  const playGentleChime = () => {
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;
      const ctx = new AudioCtxClass();
      const now = ctx.currentTime;
      [660, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const start = now + i * 0.16;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.07, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.6);
      });
      window.setTimeout(() => ctx.close(), 1200);
    } catch {
      // audio non disponibile (autoplay bloccato o browser non supportato): non blocca l'app
    }
  };

  useEffect(() => {
    if (isAlerting && !wasAlertingRef.current) {
      playGentleChime();
    }
    wasAlertingRef.current = isAlerting;
  }, [isAlerting]);

  // Colori del "corso d'opera": arancione in preparazione, verde acqua quando tutto servito,
  // rosso neon pulsante quando si supera la soglia di attesa configurata.
  const courseTheme = isAlerting
    ? {
        border: "border-red-500/70",
        shadow: "shadow-[0_0_60px_rgba(239,68,68,0.35)]",
        ring: "ring-2 ring-red-500/60 animate-pulse",
        headerBorder: "border-red-500/30",
        headerBg: "bg-red-950/20",
        accent: "text-red-300",
        badgeBorder: "border-red-500/40",
        badgeBg: "bg-red-500/10",
      }
    : courseSummary.synthetic === "in_preparazione"
    ? {
        border: "border-orange-500/50",
        shadow: "shadow-[0_0_50px_rgba(249,115,22,0.25)]",
        ring: "",
        headerBorder: "border-orange-500/20",
        headerBg: "bg-orange-950/10",
        accent: "text-orange-300",
        badgeBorder: "border-orange-500/40",
        badgeBg: "bg-orange-500/10",
      }
    : courseSummary.synthetic === "in_attesa"
    ? {
        border: "border-emerald-500/50",
        shadow: "shadow-[0_0_50px_rgba(16,185,129,0.25)]",
        ring: "",
        headerBorder: "border-emerald-500/20",
        headerBg: "bg-emerald-950/10",
        accent: "text-emerald-300",
        badgeBorder: "border-emerald-500/40",
        badgeBg: "bg-emerald-500/10",
      }
    : {
        border: "border-cyan-500/40",
        shadow: "shadow-[0_0_50px_rgba(6,182,212,0.25)]",
        ring: "",
        headerBorder: "border-cyan-500/20",
        headerBg: "bg-slate-900/80",
        accent: "text-cyan-400",
        badgeBorder: "border-cyan-500/40",
        badgeBg: "bg-cyan-500/10",
      };

  const toggleSelectedServed = (id: string) => {
    setSelectedServed((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleMarkServed = async (ids: string[]) => {
    if (ids.length === 0 || markingServed) return;
    setMarkingServed(true);
    try {
      const success = await markOrderItemsServed(ids);
      if (success) {
        setSelectedServed([]);
        await loadCourseItems();
        onFlash(`✅ ${ids.length === 1 ? "Piatto segnato come servito" : `${ids.length} piatti segnati come serviti`}`);
      } else {
        onFlash("⚠️ Errore nell'aggiornamento dei piatti serviti");
      }
    } finally {
      setMarkingServed(false);
    }
  };

  const [showReservationPopup, setShowReservationPopup] = useState<boolean>(!!reservation);

  // Auto-save continuo: ogni variazione del carrello viene specchiata su storage locale del tablet,
  // così un'interruzione, uno standby o una chiusura imprevista dell'app non fanno perdere l'ordine
  // in lavorazione. Supabase resta invariato: qui si salva solo la bozza, non l'ordine inviato.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (orderItems.length === 0) {
        window.localStorage.removeItem(draftKey(tableId));
      } else {
        window.localStorage.setItem(
          draftKey(tableId),
          JSON.stringify({ orderItems, discountPercent, splitCount, covers }),
        );
      }
    } catch {
      // storage non disponibile: l'app continua a funzionare, solo senza persistenza locale
    }
  }, [tableId, orderItems, discountPercent, splitCount, covers]);

  useEffect(() => {
    fetchCourses().then((list) => setCourses(list.length ? list : DEFAULT_COURSES));
  }, []);

  useEffect(() => {
    async function loadMenu() {
      setIsLoadingMenu(true);
      const dishes = await fetchMenuDishesFromSupabase();
      if (dishes) {
        setMenuDishes(dishes);
      }
      setIsLoadingMenu(false);
    }
    loadMenu();
  }, []);

  const handleCheckoutReservation = async () => {
    if (currentReservation) {
      try {
        await supabase
          .from("tables")
          .update({ status: "active", reservation_data: null })
          .eq("id", tableId);

        if (onConvertToActive) {
          onConvertToActive(tableId);
        }
      } catch (err) {
        console.error("Errore conversione prenotazione:", err);
      }
      setCurrentReservation(null);
    }
  };

  const handleStartOrderFromReservation = async () => {
    await handleCheckoutReservation();
    setShowReservationPopup(false);
    onFlash(`✨ Tavolo ${tableLabel} sbloccato. Inizia l'ordine!`);
  };

  const handleAddDish = async (dish: MenuDish) => {
    if (dish.isComposable) {
      setComposingDish(dish);
      setComposeSelection({});
      return;
    }

    if (currentReservation) {
      await handleCheckoutReservation();
    }

    setOrderItems((prev) => {
      const existing = prev.find((item) => item.id === dish.id);
      if (existing) {
        return prev.map((item) =>
          item.id === dish.id ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [
        ...prev,
        {
          id: dish.id,
          name: dish.name,
          price: Number(dish.price) || 0,
          qty: 1,
          destination: dish.destination || "Cucina",
          course: dish.course || "",
        },
      ];
    });
    onFlash(`✨ Aggiunto: ${dish.name}`);
  };

  const getRule = (category: string) =>
    composingDish?.categoryRules?.[category] ?? CATEGORY_SUGGESTIONS[category] ?? DEFAULT_CATEGORY_RULE;

  const toggleIngredient = (category: string, ingredientId: string) => {
    const rule = getRule(category);
    setComposeSelection((prev) => {
      const current = prev[category] ?? [];
      const already = current.includes(ingredientId);
      if (already) {
        return { ...prev, [category]: current.filter((id) => id !== ingredientId) };
      }
      if (rule.max === 1) {
        return { ...prev, [category]: [ingredientId] };
      }
      if (current.length >= rule.max) return prev; // limite categoria raggiunto
      return { ...prev, [category]: [...current, ingredientId] };
    });
  };

  const composeCategoriesPresent = composingDish
    ? Array.from(new Set((composingDish.ingredients || []).map((i) => i.category)))
    : [];

  const isComposeComplete = composeCategoriesPresent.every((cat) => {
    const rule = getRule(cat);
    const chosen = (composeSelection[cat] ?? []).length;
    return chosen >= rule.min;
  });

  const handleConfirmCompose = async () => {
    if (!composingDish || !isComposeComplete) return;
    const dish = composingDish;
    const allIngredients = dish.ingredients || [];
    const chosenIds = Object.values(composeSelection).flat();
    const chosen = allIngredients.filter((i) => chosenIds.includes(i.id));
    const extra = chosen.reduce((sum, i) => sum + (Number(i.price) || 0), 0);
    const basePrice = Number(dish.price) || 0;
    const composedName = `${dish.name} (${chosen.map((i) => i.name).join(", ")})`;

    if (currentReservation) {
      await handleCheckoutReservation();
    }

    setOrderItems((prev) => [
      ...prev,
      {
        id: `${dish.id}-${Date.now()}`,
        name: composedName,
        price: basePrice + extra,
        qty: 1,
        destination: dish.destination || "Cucina",
        course: dish.course || "",
      },
    ]);
    onFlash(`✨ Aggiunto: ${composedName}`);
    setComposingDish(null);
    setComposeSelection({});
  };

  const handleAddCustomDish = async () => {
    const name = customName.trim();
    const price = Number(customPrice.replace(",", "."));
    if (!name || !Number.isFinite(price) || price < 0) {
      onFlash("⚠️ Inserisci nome e prezzo validi");
      return;
    }

    if (currentReservation) {
      await handleCheckoutReservation();
    }

    setOrderItems((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        name,
        price,
        qty: 1,
        destination: customDestination,
        course: "",
        isCustom: true,
      },
    ]);
    onFlash(`✨ Aggiunto piatto extra: ${name}`);
    setCustomName("");
    setCustomPrice("");
    setCustomDestination("Cucina");
    setShowCustomDish(false);
  };

  const handleUpdateQty = (id: string, delta: number) => {
    setOrderItems((prev) =>
      prev
        .map((item) => (item.id === id ? { ...item, qty: item.qty + delta } : item))
        .filter((item) => item.qty > 0)
    );
  };

  /** Cambia la portata di una singola riga d'ordine: un tocco per aprire il picker, uno per scegliere. */
  const handleUpdateCourse = (id: string, course: string) => {
    setOrderItems((prev) => prev.map((item) => (item.id === id ? { ...item, course } : item)));
  };

  const subtotal = orderItems.reduce((acc, item) => acc + item.price * item.qty, 0);
  const discountAmount = (subtotal * discountPercent) / 100;
  const total = Math.max(0, subtotal - discountAmount);
  const splitTotal = splitCount > 0 ? total / splitCount : total;

  const handleSendOrder = async (type: "COMANDA" | "PRECONTO") => {
    if (isSending) return; // richiesta già in corso: ignora la pressione ripetuta
    if (orderItems.length === 0) {
      onFlash("⚠️ Nessun articolo nel carrello");
      return;
    }

    setIsSending(true);
    try {
      if (currentReservation) {
        await handleCheckoutReservation();
      }

      const payload = {
        type,
        tableId,
        tableLabel,
        items: orderItems,
        subtotal,
        total,
        covers,
        destination: "Cucina",
      };

      const success = await sendOrderToSupabase(payload);
      if (success) {
        onFlash(`🚀 ${type} inviata con successo per il Tavolo ${tableLabel}`);
        // Chiude subito la pagina dopo l'invio, cosi non si rischia di ripremere e rimandare l'ordine due volte.
        onClose();
      } else {
        onFlash(`⚠️ Errore durante l'invio della ${type}`);
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleCloseBill = async () => {
    if (isSending) return; // richiesta già in corso: ignora la pressione ripetuta
    setIsSending(true);
    try {
      const success = await closeTicketInSupabase({ tableId, tableLabel, items: orderItems, total, covers });
      if (success) {
        try {
          window.localStorage.removeItem(draftKey(tableId));
        } catch {
          // no-op
        }
        onFlash(`💳 Tavolo ${tableLabel} chiuso e archiviato nello storico`);
        onTicketClosed?.(tableId);
        onClose();
      } else {
        onFlash("⚠️ Errore durante la chiusura del conto");
      }
    } finally {
      setIsSending(false);
    }
  };

  // Categorie dinamiche derivate dalle descrizioni brevi (stesso criterio della pagina Menu)
  const categoryChips = useMemo(() => {
    const cats = new Set<string>();
    menuDishes.forEach((d) => {
      if (d.description && d.description.trim() !== "") {
        const desc = d.description.trim();
        if (desc.length < 20 && !desc.includes(",")) cats.add(desc);
      }
    });
    return Array.from(cats);
  }, [menuDishes]);

  const filteredDishes = menuDishes.filter((dish) => {
    const matchesSearch =
      dish.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (dish.description && dish.description.toLowerCase().includes(searchQuery.toLowerCase()));
    if (!matchesSearch) return false;

    if (quickFilter === "all") return true;
    if (quickFilter === "pref") return !!dish.isQuickItem;
    if (quickFilter === "bar") return (dish.destination || "Cucina") === "Bar";
    if (quickFilter === "cucina") return (dish.destination || "Cucina") === "Cucina";
    return (dish.description || "").trim().toLowerCase() === quickFilter.toLowerCase();
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-0 sm:p-4 backdrop-blur-xl animate-fade-in font-sans">
      
      {showReservationPopup && currentReservation ? (
        <div className="relative w-full max-w-lg rounded-3xl border border-cyan-500/40 bg-slate-950 p-6 shadow-[0_0_50px_rgba(6,182,212,0.25)] text-slate-100">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-cyan-500/20">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-400 font-bold">
                {tableLabel}
              </div>
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-cyan-400">
                Dettagli Prenotazione
              </h3>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl border border-rose-500/30 bg-rose-950/30 px-3 py-1.5 text-xs font-bold text-rose-400 hover:bg-rose-500/20 transition-all cursor-pointer"
            >
              ✕ Chiudi
            </button>
          </div>

          <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/40 p-4 space-y-3 text-xs">
            <div className="flex justify-between items-center border-b border-cyan-500/10 pb-2">
              <span className="text-slate-400">Nome Cliente:</span>
              <span className="font-bold text-slate-100">{currentReservation.clientName || "Non specificato"}</span>
            </div>
            <div className="flex justify-between items-center border-b border-cyan-500/10 pb-2">
              <span className="text-slate-400">Numero Coperti:</span>
              <span className="font-bold text-slate-100">{currentReservation.covers || "-"}</span>
            </div>
            <div className="flex justify-between items-center border-b border-cyan-500/10 pb-2">
              <span className="text-slate-400">Orario Previsto:</span>
              <span className="font-bold text-slate-100">{currentReservation.time || "-"}</span>
            </div>
            {currentReservation.notes && (
              <div className="flex flex-col gap-1 pt-1">
                <span className="text-slate-400 text-[11px]">Note:</span>
                <p className="text-xs text-cyan-200/90 italic">{currentReservation.notes}</p>
              </div>
            )}
          </div>

          <div className="mt-6">
            <button
              onClick={handleStartOrderFromReservation}
              className="w-full rounded-xl border border-cyan-400/50 bg-cyan-500/20 py-3 text-xs font-extrabold text-cyan-300 hover:bg-cyan-500/30 transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] cursor-pointer"
            >
              Inizia Ordine (Sblocca Tavolo) 🚀
            </button>
          </div>
        </div>
      ) : (

        <div className={`flex h-[100dvh] sm:h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-none sm:rounded-3xl border bg-slate-950 text-slate-100 transition-all ${courseTheme.border} ${courseTheme.shadow} ${courseTheme.ring}`}>
          
          {/* Header Cyberpunk */}
          <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5 sm:px-6 sm:py-3.5 transition-all ${courseTheme.headerBorder} ${courseTheme.headerBg}`}>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-xl sm:rounded-2xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-400 font-bold text-sm sm:text-base shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                {tableLabel}
              </div>
              <div>
                <h2 className="text-xs sm:text-sm font-extrabold tracking-wider text-cyan-400 uppercase">
                  Tavolo {tableLabel}
                </h2>
                <p className="hidden sm:block text-[11px] text-slate-400">CyberPOS Live Terminal</p>
              </div>
              {courseSummary.synthetic !== "nessuno" && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-2 sm:px-3 py-1 sm:py-1.5 text-[9px] sm:text-[10px] font-black uppercase tracking-wide ${courseTheme.badgeBorder} ${courseTheme.badgeBg} ${courseTheme.accent}`}
                >
                  <Clock className="w-3 h-3" />
                  {isAlerting
                    ? `${oldestPendingElapsedMin} min!`
                    : courseSummary.synthetic === "in_preparazione"
                    ? `${oldestPendingElapsedMin} min`
                    : "Servito"}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {otherTables.length > 0 && (
                <button
                  onClick={() => setShowMovePicker((v) => !v)}
                  className="rounded-xl border border-purple-500/30 bg-purple-950/30 px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-bold text-purple-300 hover:bg-purple-500/20 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Sposta tavolo</span>
                </button>
              )}
              <button
                onClick={onClose}
                className="rounded-xl border border-rose-500/30 bg-rose-950/30 px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-bold text-rose-400 hover:bg-rose-500/20 transition-all cursor-pointer"
              >
                ✕ Chiudi
              </button>
            </div>
          </div>

          {showMovePicker && (
            <div className="border-b border-purple-500/20 bg-purple-950/10 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-purple-300 flex items-center gap-1.5">
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  Sposta l'ordine di {tableLabel} su un altro tavolo — se c'è già un ordine, li unisce
                </p>
                <button
                  onClick={() => setShowMovePicker(false)}
                  className="text-purple-300/70 hover:text-white text-xs cursor-pointer"
                >
                  ✕
                </button>
              </div>
              <input
                type="text"
                value={moveSearch}
                onChange={(e) => setMoveSearch(e.target.value)}
                placeholder="Cerca tavolo..."
                className="w-full rounded-xl border border-purple-500/30 bg-slate-900/80 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:border-purple-400 focus:outline-none"
              />
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
                {filteredOtherTables.length === 0 ? (
                  <p className="text-[11px] text-slate-500 italic">Nessun altro tavolo trovato.</p>
                ) : (
                  filteredOtherTables.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleMoveOrderTo(t)}
                      disabled={isMoving}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition-all cursor-pointer disabled:opacity-40 ${
                        t.status === "occupied" || t.status === "attesa conto"
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                          : "border-purple-500/30 bg-slate-900 text-purple-300 hover:bg-purple-500/20"
                      }`}
                    >
                      {t.label}
                      {(t.status === "occupied" || t.status === "attesa conto") && (
                        <span className="ml-1 text-[9px] text-amber-400/80 uppercase">unisci</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Tab Menu/Conto: solo su telefono, dove le due colonne non stanno affiancate */}
          <div className="flex lg:hidden border-b border-cyan-500/20 bg-slate-950/60">
            <button
              onClick={() => setMobileTab("menu")}
              className={`flex-1 py-2.5 text-xs font-black uppercase tracking-wide transition-all cursor-pointer ${
                mobileTab === "menu" ? "text-cyan-300 border-b-2 border-cyan-400 bg-cyan-500/10" : "text-slate-500"
              }`}
            >
              🍽️ Menu
            </button>
            <button
              onClick={() => setMobileTab("cart")}
              className={`flex-1 py-2.5 text-xs font-black uppercase tracking-wide transition-all cursor-pointer ${
                mobileTab === "cart" ? "text-cyan-300 border-b-2 border-cyan-400 bg-cyan-500/10" : "text-slate-500"
              }`}
            >
              🧾 Conto ({orderItems.reduce((a, b) => a + b.qty, 0)})
            </button>
          </div>

          {/* Layout a Due Colonne Invertito */}
          <div className="flex flex-1 flex-col lg:flex-row overflow-hidden">

            {/* COLONNA SINISTRA: Menu & Ricerca Piatti (Spostata a sinistra) */}
            <div className={`${mobileTab === "cart" ? "hidden" : "flex"} lg:flex flex-1 flex-col border-r border-cyan-500/20 bg-slate-950/60 p-3 sm:p-4 lg:p-5 overflow-hidden`}>

              {/* Fascia Quick Items: sempre raggiungibile con un solo tap, nessuna navigazione */}
              {menuDishes.some((d) => d.isQuickItem) && (
                <div className="mb-3 -mx-1 flex gap-2 overflow-x-auto pb-1 px-1">
                  {menuDishes
                    .filter((d) => d.isQuickItem)
                    .map((dish) => (
                      <button
                        key={dish.id}
                        onClick={() => handleAddDish(dish)}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 min-h-[44px] text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 active:scale-95 transition-all whitespace-nowrap"
                      >
                        <Zap className="w-3.5 h-3.5 shrink-0" />
                        {dish.name}
                        <span className="text-emerald-400/70 font-mono">€{Number(dish.price).toFixed(2)}</span>
                      </button>
                    ))}
                </div>
              )}

              {/* Filtri rapidi: preferiti, solo bar, solo cucina, categorie dinamiche del menu */}
              <div className="mb-3 -mx-1 flex gap-1.5 overflow-x-auto pb-1 px-1">
                {[
                  { key: "all", label: "Tutti" },
                  { key: "pref", label: "⭐ Preferiti" },
                  { key: "cucina", label: "🍳 Solo Cucina" },
                  { key: "bar", label: "🍹 Solo Bar" },
                  ...categoryChips.map((c) => ({ key: c, label: c })),
                ].map((chip) => (
                  <button
                    key={chip.key}
                    onClick={() => setQuickFilter(chip.key)}
                    className={`shrink-0 rounded-xl border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap transition-all cursor-pointer ${
                      quickFilter === chip.key
                        ? "border-cyan-400 bg-cyan-500/20 text-cyan-200 shadow-[0_0_10px_rgba(6,182,212,0.3)]"
                        : "border-slate-700 bg-slate-900/70 text-slate-400 hover:border-cyan-500/40 hover:text-cyan-300"
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              <div className="relative mb-3">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cerca piatto nel menu..."
                  className="w-full rounded-2xl border border-cyan-500/30 bg-slate-900/80 pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/50"
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Barra piatto extra: per articoli non presenti nel database/menu */}
              <div className="mb-4 rounded-2xl border border-fuchsia-500/30 bg-fuchsia-950/10">
                {!showCustomDish ? (
                  <button
                    onClick={() => setShowCustomDish(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl py-2.5 text-[11px] font-bold text-fuchsia-300 hover:bg-fuchsia-500/10 transition-all cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Piatto fuori menu (non a database)
                  </button>
                ) : (
                  <div className="p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black uppercase tracking-wider text-fuchsia-300">
                        Piatto extra
                      </span>
                      <button
                        onClick={() => setShowCustomDish(false)}
                        className="text-slate-400 hover:text-white text-xs cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="Nome piatto"
                      className="w-full rounded-xl border border-fuchsia-500/30 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-fuchsia-400 focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={customPrice}
                        onChange={(e) => setCustomPrice(e.target.value)}
                        placeholder="Prezzo €"
                        className="w-24 rounded-xl border border-fuchsia-500/30 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-fuchsia-400 focus:outline-none font-mono"
                      />
                      <div className="flex flex-1 gap-1.5">
                        {(["Cucina", "Bar"] as const).map((dest) => (
                          <button
                            key={dest}
                            onClick={() => setCustomDestination(dest)}
                            className={`flex-1 rounded-xl border py-2 text-[11px] font-bold transition-all cursor-pointer ${
                              customDestination === dest
                                ? "border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-200"
                                : "border-slate-700 bg-slate-900 text-slate-400 hover:border-fuchsia-500/40"
                            }`}
                          >
                            {dest}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={handleAddCustomDish}
                      className="w-full rounded-xl bg-fuchsia-500 hover:bg-fuchsia-400 py-2.5 text-xs font-black text-slate-950 uppercase tracking-wide transition-all cursor-pointer"
                    >
                      Aggiungi al conto
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto pr-1">
                {isLoadingMenu ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
                  </div>
                ) : filteredDishes.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-slate-500 text-xs italic">
                    Nessun piatto trovato.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
                    {filteredDishes.map((dish) => (
                      <button
                        key={dish.id}
                        onClick={() => handleAddDish(dish)}
                        className={`group flex flex-col justify-between rounded-2xl border p-3.5 text-left transition-all cursor-pointer ${
                          dish.isComposable
                            ? "border-fuchsia-500/40 bg-fuchsia-950/10 hover:border-fuchsia-400 hover:bg-fuchsia-950/20 hover:shadow-[0_0_20px_rgba(217,70,239,0.2)]"
                            : "border-cyan-500/25 bg-slate-900/40 hover:border-cyan-400 hover:bg-cyan-950/30 hover:shadow-[0_0_20px_rgba(6,182,212,0.2)]"
                        }`}
                      >
                        <div>
                          <h4 className="font-bold text-slate-100 text-xs group-hover:text-cyan-300 transition-colors flex items-center gap-1.5">
                            {dish.name}
                            {dish.isComposable && (
                              <span className="rounded-md bg-fuchsia-500/20 border border-fuchsia-500/40 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-fuchsia-300 flex items-center gap-0.5">
                                <Layers className="w-2.5 h-2.5" /> Componi
                              </span>
                            )}
                          </h4>
                          <p className="text-[10px] text-slate-400 line-clamp-2 mt-1">{dish.description}</p>
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <span className="font-extrabold text-cyan-400 text-xs">€ {Number(dish.price).toFixed(2)}</span>
                          <span className="rounded-lg bg-cyan-500/10 px-2 py-0.5 text-[9px] text-cyan-300 border border-cyan-500/20 font-mono">
                            {dish.destination || "Cucina"}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* COLONNA DESTRA: Lista Ordini & Totali (Spostata a destra) */}
            <div className={`${mobileTab === "menu" ? "hidden" : "flex"} lg:flex w-full lg:w-96 xl:w-[420px] flex-col bg-slate-950 p-3 sm:p-4 lg:p-5 overflow-hidden`}>
              <div className="flex items-center justify-between pb-3 border-b border-cyan-500/20 mb-3">
                <div className="flex items-center gap-2">
                  <Utensils className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-cyan-400">Ordine Corrente</h3>
                  {orderItems.length > 0 && (
                    <span
                      title="Bozza salvata automaticamente sul tablet"
                      className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400/80"
                    >
                      <Check className="w-3 h-3" /> {draftRestored ? "bozza ripristinata" : "salvato"}
                    </span>
                  )}
                </div>
                <span className="rounded-xl bg-cyan-500/10 px-2.5 py-0.5 text-xs font-mono font-bold text-cyan-300 border border-cyan-500/30">
                  {orderItems.reduce((a, b) => a + b.qty, 0)} articoli
                </span>
              </div>

              {/* Coperti: sempre modificabili, anche dopo aver già inviato la comanda */}
              <div className="mb-3 flex items-center justify-between rounded-2xl border border-cyan-500/20 bg-slate-900/50 px-3.5 py-2.5">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-cyan-400" />
                  Coperti
                </span>
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => setCovers((c) => Math.max(1, c - 1))}
                    className="h-7 w-7 rounded-lg border border-cyan-500/30 bg-slate-950 text-cyan-400 flex items-center justify-center cursor-pointer hover:bg-cyan-500/20"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono font-black text-white text-sm w-5 text-center">{covers}</span>
                  <button
                    onClick={() => setCovers((c) => c + 1)}
                    className="h-7 w-7 rounded-lg border border-cyan-500/30 bg-slate-950 text-cyan-400 flex items-center justify-center cursor-pointer hover:bg-cyan-500/20"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {courseItems.length > 0 && (
                <div className="mb-3 rounded-2xl border border-orange-500/30 bg-orange-950/10 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-orange-300">
                      <Clock className="w-3.5 h-3.5" />
                      Stato Portate
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">
                      {servedCourseItems.length}/{courseItems.length} servite
                    </span>
                  </div>

                  {pendingCourseItems.length === 0 ? (
                    <p className="text-[11px] text-emerald-400 italic">
                      Tutte le portate inviate finora sono state servite.
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {pendingCourseItems.map((row) => (
                        <label
                          key={row.id}
                          className="flex items-center gap-2 rounded-xl border border-orange-500/20 bg-slate-900/60 px-2.5 py-2 text-[11px] cursor-pointer hover:border-orange-400/50"
                        >
                          <input
                            type="checkbox"
                            checked={selectedServed.includes(row.id)}
                            onChange={() => toggleSelectedServed(row.id)}
                            className="h-4 w-4 rounded border-orange-500/40 accent-orange-500"
                          />
                          <span className="flex-1 truncate text-slate-200 font-semibold">
                            {row.qty}× {row.name}
                          </span>
                          {row.course && (
                            <span className="text-[9px] font-mono text-orange-300/80 uppercase">{row.course}</span>
                          )}
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              handleMarkServed([row.id]);
                            }}
                            disabled={markingServed}
                            className="shrink-0 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[9px] font-bold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40 cursor-pointer"
                          >
                            Servito
                          </button>
                        </label>
                      ))}
                    </div>
                  )}

                  {selectedServed.length > 0 && (
                    <button
                      onClick={() => handleMarkServed(selectedServed)}
                      disabled={markingServed}
                      className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 py-2 text-[11px] font-black text-slate-950 uppercase tracking-wide transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Segna serviti ({selectedServed.length})
                    </button>
                  )}
                </div>
              )}

              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {orderItems.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-center text-slate-500 text-xs italic px-6">
                    Nessun articolo aggiunto. Seleziona i piatti dalla griglia a sinistra.
                  </div>
                ) : (
                  orderItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-xl border border-cyan-500/20 bg-slate-900/50 p-3"
                    >
                      <div className="flex-1 pr-2 min-w-0">
                        <h4 className="font-bold text-slate-200 text-xs truncate">{item.name}</h4>
                        <div className="flex items-center gap-1.5 mt-1">
                          <p className="text-[11px] font-mono text-cyan-400 font-bold">€ {(item.price * item.qty).toFixed(2)}</p>
                          {/* Portata riga: un tap apre il picker nativo, un secondo tap la assegna */}
                          <select
                            value={item.course || ""}
                            onChange={(e) => handleUpdateCourse(item.id, e.target.value)}
                            className={`rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide focus:outline-none ${
                              item.course
                                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                                : "border-slate-700 bg-slate-950 text-slate-500"
                            }`}
                          >
                            <option value="">—</option>
                            {courses.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleUpdateQty(item.id, -1)}
                          className="h-7 w-7 rounded-lg border border-cyan-500/30 bg-slate-950 text-cyan-400 font-bold hover:bg-cyan-500/20 flex items-center justify-center cursor-pointer"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="font-mono font-bold text-slate-100 text-xs w-4 text-center">{item.qty}</span>
                        <button
                          onClick={() => handleUpdateQty(item.id, 1)}
                          className="h-7 w-7 rounded-lg border border-cyan-500/30 bg-slate-950 text-cyan-400 font-bold hover:bg-cyan-500/20 flex items-center justify-center cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {orderItems.length > 0 && (
                <div className="mt-3 pt-3 border-t border-cyan-500/20 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Sconto:</span>
                    <div className="flex gap-1.5">
                      {[0, 10, 15, 20].map((pct) => (
                        <button
                          key={pct}
                          onClick={() => setDiscountPercent(pct)}
                          className={`rounded-lg px-2 py-1 text-[10px] font-bold border transition-all cursor-pointer ${
                            discountPercent === pct
                              ? "bg-cyan-500 text-slate-950 border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]"
                              : "bg-slate-900 text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/20"
                          }`}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Dividi conto:</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSplitCount((c) => Math.max(1, c - 1))}
                        className="h-6 w-6 rounded-lg border border-cyan-500/30 bg-slate-900 text-cyan-400 flex items-center justify-center cursor-pointer"
                      >
                        -
                      </button>
                      <span className="font-mono font-bold text-white w-4 text-center text-xs">{splitCount}</span>
                      <button
                        onClick={() => setSplitCount((c) => c + 1)}
                        className="h-6 w-6 rounded-lg border border-cyan-500/30 bg-slate-900 text-cyan-400 flex items-center justify-center cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {splitCount > 1 && (
                    <div className="flex justify-between items-center bg-cyan-500/10 px-3 py-1.5 rounded-xl border border-cyan-500/30 text-xs">
                      <span className="font-bold text-cyan-300">Quota a testa:</span>
                      <span className="font-mono font-black text-cyan-300">€ {splitTotal.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-cyan-500/20 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-400 uppercase">Totale Complessivo</span>
                  <span className="font-mono text-base font-black text-cyan-300">€ {total.toFixed(2)}</span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => handleSendOrder("COMANDA")}
                    disabled={isSending}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-cyan-500/40 bg-cyan-500/10 py-2.5 px-2 text-[11px] font-bold text-cyan-300 hover:bg-cyan-500/20 transition-all shadow-[0_0_15px_rgba(6,182,212,0.2)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Comanda</span>
                  </button>
                  <button
                    onClick={() => handleSendOrder("PRECONTO")}
                    disabled={isSending}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-amber-500/40 bg-amber-500/10 py-2.5 px-2 text-[11px] font-bold text-amber-300 hover:bg-amber-500/20 transition-all shadow-[0_0_15px_rgba(245,158,11,0.2)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Preconto</span>
                  </button>
                  <button
                    onClick={handleCloseBill}
                    disabled={isSending}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-emerald-500/40 bg-emerald-500/20 py-2.5 px-2 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/30 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Chiudi & Paga</span>
                  </button>
                </div>
              </div>

            </div>

          </div>

        </div>
      )}

      {composingDish && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-4">
          <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl border border-fuchsia-500/40 bg-slate-950 shadow-[0_0_50px_rgba(217,70,239,0.25)] text-slate-100">
            <div className="flex items-center justify-between border-b border-fuchsia-500/20 bg-slate-900/80 px-5 py-3.5 shrink-0">
              <div>
                <h3 className="text-sm font-extrabold tracking-wider text-fuchsia-300 uppercase flex items-center gap-2">
                  <Layers className="w-4 h-4" /> Componi {composingDish.name}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Scegli gli ingredienti per ciascuna categoria
                </p>
              </div>
              <button
                onClick={() => {
                  setComposingDish(null);
                  setComposeSelection({});
                }}
                className="rounded-xl border border-rose-500/30 bg-rose-950/30 px-3 py-1.5 text-xs font-bold text-rose-400 hover:bg-rose-500/20 transition-all cursor-pointer"
              >
                ✕ Chiudi
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {composeCategoriesPresent.length === 0 ? (
                <p className="text-xs text-slate-500 italic text-center py-6">
                  Nessun ingrediente configurato per questo piatto. Aggiungili dalla Gestione Menu.
                </p>
              ) : (
                composeCategoriesPresent.map((cat) => {
                  const rule = getRule(cat);
                  const items = (composingDish.ingredients || []).filter((i) => i.category === cat);
                  const selected = composeSelection[cat] ?? [];
                  return (
                    <div key={cat}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-black uppercase tracking-wider text-fuchsia-300">
                          {cat}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          {selected.length}/{rule.max} selezionat{rule.max === 1 ? "o" : "i"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {items.map((ing) => {
                          const isSelected = selected.includes(ing.id);
                          return (
                            <button
                              key={ing.id}
                              onClick={() => toggleIngredient(cat, ing.id)}
                              className={`flex flex-col items-center gap-1.5 rounded-2xl border p-2.5 text-center transition-all cursor-pointer ${
                                isSelected
                                  ? "border-fuchsia-400 bg-fuchsia-500/20 shadow-[0_0_15px_rgba(217,70,239,0.3)]"
                                  : "border-slate-700 bg-slate-900/60 hover:border-fuchsia-500/40"
                              }`}
                            >
                              {ing.photoUrl ? (
                                <img
                                  src={ing.photoUrl}
                                  alt={ing.name}
                                  className="h-12 w-12 rounded-xl object-cover border border-slate-800"
                                />
                              ) : (
                                <div className="h-12 w-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center">
                                  <Utensils className="w-5 h-5 text-slate-500" />
                                </div>
                              )}
                              <span className={`text-[11px] font-bold ${isSelected ? "text-fuchsia-200" : "text-slate-300"}`}>
                                {ing.name}
                              </span>
                              {ing.price > 0 && (
                                <span className="text-[10px] font-mono text-cyan-400">+€{ing.price.toFixed(2)}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="border-t border-fuchsia-500/20 p-4 shrink-0">
              <button
                onClick={handleConfirmCompose}
                disabled={!isComposeComplete}
                className="w-full rounded-xl bg-fuchsia-500 hover:bg-fuchsia-400 disabled:opacity-30 disabled:cursor-not-allowed py-3 text-xs font-black text-slate-950 uppercase tracking-wide shadow-[0_0_20px_rgba(217,70,239,0.4)] transition-all cursor-pointer"
              >
                Aggiungi al conto
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
