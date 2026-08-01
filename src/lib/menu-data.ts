import { useCallback, useEffect, useState } from "react";

export type MenuDestination = "Cucina" | "Bar";

/** Categoria di un ingrediente componibile: libera, non più limitata a un elenco fisso. */
export type IngredientCategory = string;

export interface DishIngredient {
  id: string;
  name: string;
  category: IngredientCategory;
  price: number;
  photoUrl?: string;
}

export interface CategoryRule {
  min: number;
  max: number;
}

/** Suggerimenti di default (nome + regola tipica) quando si usa una categoria per la prima volta. */
export const CATEGORY_SUGGESTIONS: Record<string, CategoryRule> = {
  Proteina: { min: 1, max: 1 },
  Salsa: { min: 1, max: 1 },
  Topping: { min: 1, max: 1 },
  Side: { min: 2, max: 2 },
};

export const DEFAULT_CATEGORY_RULE: CategoryRule = { min: 1, max: 1 };

export interface MenuDish {
  id: string;
  name: string;
  description: string;
  price: string;
  destination: MenuDestination | string;
  /** Piatto componibile stile poke: al click si apre la scelta ingredienti per categoria. */
  isComposable?: boolean;
  ingredients?: DishIngredient[];
  /** Regole di selezione per categoria, configurabili per ciascun piatto (es. "Side": min 2 max 2). */
  categoryRules?: Record<string, CategoryRule>;
  /** Portata di appartenenza per la sequenza di uscita in cucina (es. Antipasti, Primi...). */
  course?: string;
  /** Prodotto ad alta rotazione: appare nella fascia Quick Items durante la presa comanda. */
  isQuickItem?: boolean;
}

export const DEFAULT_COURSES = ["Antipasti", "Primi", "Secondi", "Contorni", "Bevande", "Dessert"];

const STORAGE_KEY = "pos.menu.dishes";

export const DEFAULT_DISHES: MenuDish[] = [
  { id: "1", name: "Margherita", description: "Pomodoro, mozzarella, basilico", price: "7.00", destination: "Cucina" },
  { id: "2", name: "Diavola", description: "Pomodoro, mozzarella, salame piccante", price: "8.50", destination: "Cucina" },
  { id: "3", name: "Coca Cola 33cl", description: "Bibita in lattina", price: "3.00", destination: "Bar" },
];

function read(): MenuDish[] {
  if (typeof window === "undefined") return DEFAULT_DISHES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MenuDish[]) : DEFAULT_DISHES;
  } catch {
    return DEFAULT_DISHES;
  }
}

/** Stato del menu persistito in localStorage. */
export function useMenuDishes(): [MenuDish[], (next: MenuDish[]) => void] {
  const [dishes, setDishes] = useState<MenuDish[]>(DEFAULT_DISHES);

  useEffect(() => {
    setDishes(read());
  }, []);

  const update = useCallback((next: MenuDish[]) => {
    setDishes(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage non disponibile */
      }
    }
  }, []);

  return [dishes, update];
}
