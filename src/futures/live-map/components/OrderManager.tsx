import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { 
  fetchMenuDishesFromSupabase, 
  sendOrderToSupabase, 
  closeTicketInSupabase 
} from "@/lib/supabase-service";
import { MenuDish, CATEGORY_SUGGESTIONS, DEFAULT_CATEGORY_RULE, DEFAULT_COURSES } from "@/lib/menu-data";
import { fetchCourses } from "@/lib/courses-api";
import { Search, Plus, Minus, Send, FileText, CreditCard, Utensils, Layers, Zap, Check } from "lucide-react";

interface ReservationInfo {
  clientName?: string;
  covers?: number;
  time?: string;
  notes?: string;
}

interface OrderManagerProps {
  tableId: string;
  tableLabel: string;
  reservation?: ReservationInfo | null;
  onClose: () => void;
  onFlash: (msg: string) => void;
  onConvertToActive?: (tableId: string) => void;
  /** Chiamata dopo la chiusura riuscita del conto (usata per rimuovere i conti al banco). */
  onTicketClosed?: (tableId: string) => void;
}

/** Chiave di storage locale per il draft dell'ordine in corso, isolata per tavolo. */
function draftKey(tableId: string) {
  return `draft:table:${tableId}`;
}

function loadDraft(tableId: string): { orderItems: any[]; discountPercent: number; splitCount: number } | null {
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
  reservation = null, 
  onClose, 
  onFlash,
  onConvertToActive,
  onTicketClosed
}: OrderManagerProps) {
  const initialDraft = loadDraft(tableId);
  const [menuDishes, setMenuDishes] = useState<MenuDish[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [orderItems, setOrderItems] = useState<any[]>(initialDraft?.orderItems ?? []);
  const [discountPercent, setDiscountPercent] = useState<number>(initialDraft?.discountPercent ?? 0);
  const [splitCount, setSplitCount] = useState<number>(initialDraft?.splitCount ?? 1);
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
          JSON.stringify({ orderItems, discountPercent, splitCount }),
        );
      }
    } catch {
      // storage non disponibile: l'app continua a funzionare, solo senza persistenza locale
    }
  }, [tableId, orderItems, discountPercent, splitCount]);

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
    if (orderItems.length === 0) {
      onFlash("⚠️ Nessun articolo nel carrello");
      return;
    }

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
      destination: "Cucina",
    };

    const success = await sendOrderToSupabase(payload);
    if (success) {
      onFlash(`🚀 ${type} inviata con successo per il Tavolo ${tableLabel}`);
    } else {
      onFlash(`⚠️ Errore durante l'invio della ${type}`);
    }
  };

  const handleCloseBill = async () => {
    const success = await closeTicketInSupabase({ tableId, tableLabel, items: orderItems, total });
    if (success) {
      try {
        window.localStorage.removeItem(draftKey(tableId));
      } catch {
        // no-op
      }
      onFlash(`💳 Tavolo ${tableLabel} chiuso e liberato`);
      onTicketClosed?.(tableId);
      onClose();
    } else {
      onFlash("⚠️ Errore durante la chiusura del conto");
    }
  };

  const filteredDishes = menuDishes.filter((dish) =>
    dish.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (dish.description && dish.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-4 backdrop-blur-xl animate-fade-in font-sans">
      
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

        <div className="flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-cyan-500/40 bg-slate-950 text-slate-100 shadow-[0_0_50px_rgba(6,182,212,0.25)]">
          
          {/* Header Cyberpunk */}
          <div className="flex items-center justify-between border-b border-cyan-500/20 bg-slate-900/80 px-6 py-3.5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-400 font-bold shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                {tableLabel}
              </div>
              <div>
                <h2 className="text-sm font-extrabold tracking-wider text-cyan-400 uppercase">
                  Gestione Tavolo {tableLabel}
                </h2>
                <p className="text-[11px] text-slate-400">CyberPOS Live Terminal</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="rounded-xl border border-rose-500/30 bg-rose-950/30 px-3.5 py-2 text-xs font-bold text-rose-400 hover:bg-rose-500/20 transition-all cursor-pointer"
              >
                ✕ Chiudi
              </button>
            </div>
          </div>

          {/* Layout a Due Colonne Invertito */}
          <div className="flex flex-1 overflow-hidden">
            
            {/* COLONNA SINISTRA: Menu & Ricerca Piatti (Spostata a sinistra) */}
            <div className="flex flex-1 flex-col border-r border-cyan-500/20 bg-slate-950/60 p-4 sm:p-5 overflow-hidden">

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
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
            <div className="w-96 lg:w-[420px] flex flex-col bg-slate-950 p-4 sm:p-5 overflow-hidden">
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
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-cyan-500/40 bg-cyan-500/10 py-2.5 px-2 text-[11px] font-bold text-cyan-300 hover:bg-cyan-500/20 transition-all shadow-[0_0_15px_rgba(6,182,212,0.2)] cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Comanda</span>
                  </button>
                  <button
                    onClick={() => handleSendOrder("PRECONTO")}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-amber-500/40 bg-amber-500/10 py-2.5 px-2 text-[11px] font-bold text-amber-300 hover:bg-amber-500/20 transition-all shadow-[0_0_15px_rgba(245,158,11,0.2)] cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Preconto</span>
                  </button>
                  <button
                    onClick={handleCloseBill}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-emerald-500/40 bg-emerald-500/20 py-2.5 px-2 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/30 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] cursor-pointer"
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
