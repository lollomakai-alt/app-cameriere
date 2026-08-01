# Sala — Mappa Live (app cameriere)

App dedicata al cameriere: solo la mappa tavoli, niente altro. Estratta dal gestionale
completo per girare da sola su un tablet in sala, senza menu di navigazione verso pagine
che al cameriere non servono (gestione menu, impostazioni, storico, cucina).

## Cosa può fare il cameriere qui

- Vedere la mappa tavoli in tempo reale (colori per stato: libero, occupato, prenotato,
  in preparazione, pronto da ritirare)
- Toccare un tavolo: si apre la comanda, oppure — se il tavolo ha una prenotazione attiva —
  la conferma di arrivo cliente prima di aprire la comanda
- Inserire l'ordine (menu, piatti componibili tipo poke, piatti fuori menu, quick items) e
  inviarlo a Supabase (comanda in cucina, preconto, chiusura conto)
- Riaprire un tavolo già occupato per correggere l'ordine prima di chiuderlo
- Gestire il Banco Bar (conti multipli per i clienti al bancone)
- Assegnare le prenotazioni ai tavoli (pannello prenotazioni integrato nella mappa)
- Riposizionare/unire/dividere i tavoli sulla mappa (modalità modifica mappa)

Quello che NON c'è di proposito: gestione menu/allergeni/portate, impostazioni sale e
tavoli da zero, storico ordini, schermo cucina — tutte cose di back-office o di altre app
dedicate (gestionale completo / app cucina), non del flusso operativo del cameriere.

## Avvio locale

```bash
npm install
npm run dev
```

## Deploy

Nessuna variabile d'ambiente da configurare: la chiave Supabase pubblica è già dentro
`src/lib/supabase.ts`. Basta collegare il repo a Vercel ("Add New Project" → import da
GitHub) e il deploy parte in automatico ad ogni push.

## Nota sicurezza

Questa app condivide lo stesso progetto Supabase del gestionale completo e dell'app
cucina: stessi dati, stessa mappa tavoli, stesse comande. Il progetto ha attualmente la
Row Level Security (RLS) disabilitata su tutte le tabelle — da valutare insieme alle
altre app.
