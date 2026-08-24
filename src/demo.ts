/** Die Demo-Tour. ?demo öffnet eine echte, voll bedienbare Sitzung; welche
 *  (Gremium, Datum, Titel) steht in der config.json des Mandanten unter
 *  "demo" — ohne den Block gibt es für den Mandanten keine Demo. */
import type { SessionState } from "./types";

export interface DemoStep {
  id: string;
  title: string;
  hint: string;
  done: (s: SessionState) => boolean;
}

/* Jeder Schritt gilt als erledigt, sobald der Reducer-Zustand es sagt — die
   Tour folgt also dem, was tatsächlich passiert, auch außer der Reihe.
   `id` ist zugleich das Hervorhebungs-Ziel: Elemente mit data-demo="<id>"
   werden umrandet, solange der Schritt offen ist. */
export const DEMO_STEPS: DemoStep[] = [
  { id: "open", title: "Sitzung eröffnen",
    hint: "Die Anwesenheit zu Beginn wird dabei namentlich protokolliert.",
    done: (s) => s.session.status !== "idle" },
  { id: "presence", title: "Stellvertretung einrücken lassen",
    hint: "Einen Sitz anklicken: 1× Stellvertretung übernimmt, 2× Sitz bleibt leer, 3× zurück zum ordentlichen Mitglied. Nie sind beide gleichzeitig stimmberechtigt.",
    done: (s) => Object.values(s.seatStates).some((v) => v !== "regular" && v !== "present") },
  { id: "agenda", title: "Abstimmung zu einem TOP starten",
    hint: "Auf einen Tagesordnungspunkt klicken — er wird in die Abstimmung übernommen. Oder Taste +.",
    done: (s) => !!s.currentVote || s.votes.length > 0 },
  { id: "cast", title: "Einzelne Stimmen setzen",
    hint: "Ein Klick auf den Sitz schaltet dessen Stimme zwischen Ja und Nein.",
    done: (s) => s.votes.length > 0 ||
      (!!s.currentVote && Object.values(s.currentVote.votes).some((v) => v === "yes")) },
  { id: "bulk", title: "Ganze Fraktionen schalten",
    hint: "Ja/Nein am Partei-Chip setzt die ganze Fraktion. Auf der Tastatur: Anfangsbuchstabe der Fraktion, J alle Ja, N alle Nein.",
    done: (s) => s.votes.length > 0 ||
      (!!s.currentVote && new Set(Object.values(s.currentVote.votes)).size === 1) },
  { id: "title", title: "Abstimmung benennen",
    hint: "Ohne Titel lässt sich nicht speichern — er trägt später das Protokoll.",
    done: (s) => s.votes.length > 0 || (!!s.currentVote && !!s.currentVote.title.trim()) },
  { id: "save", title: "Ergebnis speichern",
    hint: "Die Zusammenfassung zeigt das Ergebnis vor dem Bestätigen.",
    done: (s) => s.votes.length > 0 },
  { id: "nonpublic", title: "In den nichtöffentlichen Teil wechseln",
    hint: "Abstimmungen ab hier landen im getrennten Export.",
    done: (s) => s.log.some((e) => e.type === "session_nonpublic") },
  { id: "end", title: "Sitzung beenden",
    hint: "Das schließt die Sitzung ab und gibt den Export frei.",
    done: (s) => s.session.status === "ended" },
  { id: "export", title: "Protokoll exportieren",
    hint: "Das ZIP enthält den Protokolltext plus öffentliche und nichtöffentliche Abstimmungen getrennt.",
    done: () => false },
];
