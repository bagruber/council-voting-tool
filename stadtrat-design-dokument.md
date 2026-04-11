# Stadtrat-Sitzungsprotokoll – Design-Dokument

## High-Level Design (HLD)

### Systemübersicht

Die Anwendung ist eine **Single-Page-App (SPA)** für die digitale Schriftführung von Stadtratssitzungen. Sie läuft vollständig im Browser (kein Backend erforderlich) und unterstützt alle kritischen Abläufe einer kommunalen Sitzung in Echtzeit.

### Kernziele

- Schnelle, fehlerfreie Erfassung während der laufenden Sitzung
- Lückenlose Protokollierung aller sitzungsrelevanten Ereignisse
- Strukturierte Abstimmungserfassung mit Ergebnis-Summary
- Export-fähiges Protokoll (Mail, PDF, strukturierte Daten)

### Systemkomponenten (HLD)

```
┌─────────────────────────────────────────────────────────┐
│                    Browser-App (SPA)                     │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Sitzungs-   │  │  Abstimmungs-│  │   Protokoll-  │  │
│  │  verwaltung  │  │   modul      │  │   modul (Log) │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                   │          │
│  ┌──────┴─────────────────┴───────────────────┴───────┐  │
│  │              State Management (JS / React)          │  │
│  └───────────────────────────────────────────────────┬┘  │
│                                                      │    │
│  ┌───────────────────────────────────────────────────┴┐  │
│  │         Persistenz: LocalStorage / Export-Modul    │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Datenfluss

```
Benutzeraktion
     │
     ▼
Event Handler
     │
     ▼
State Update (React useState / useReducer)
     │
     ├──► UI-Render (Sitzplan, Statusanzeigen)
     │
     └──► Log-Eintrag erstellen (Timestamp + Inhalt)
               │
               └──► LocalStorage speichern
```

### Technologie-Stack

| Schicht | Technologie | Begründung |
|---|---|---|
| Framework | React (JSX) | Reaktive UI, komponentenbasiert |
| Styling | Tailwind CSS (inline) | Schnelle Entwicklung, kein Build-Step |
| State | React useState/useReducer | Ausreichend für SPA ohne Backend |
| Persistenz (aktuell) | LocalStorage | Zero-Config, sessionfest |
| Persistenz (Zukunft) | REST-API / Supabase | Für serverseitige Ablage + Mail-Versand |
| Export | JSON / Markdown-String | Maschinenlesbar und für LLMs nutzbar |

---

## Low-Level Design (LLD)

### Datenmodell

#### Member (Stadtrat / Bürgermeister)

```typescript
interface Member {
  id: string;               // Eindeutige ID, z.B. "sr-01"
  name: string;             // Vollständiger Name
  party: PartyKey;          // Schlüssel für Partei-Farbe
  role: "councillor" | "mayor";
  present: boolean;         // Anwesenheitsstatus
  seatIndex: number;        // Position im Kreis (0–23), Mayor = -1
}
```

#### Party (Partei)

```typescript
interface Party {
  key: string;              // z.B. "CSU", "SPD"
  label: string;            // Anzeigename
  color: string;            // Hex-Farbe für UI
}
```

#### VoteRecord (Abstimmung)

```typescript
interface VoteRecord {
  id: string;               // UUID
  timestamp: string;        // ISO 8601
  title: string;            // Titel der Abstimmung
  agendaItem: string;       // Tagesordnungspunkt (optional)
  comment: string;          // Kommentar (optional)
  votes: {
    [memberId: string]: "yes" | "no";
  };
  result: {
    yes: number;
    no: number;
    eligible: number;       // Anzahl anwesender Mitglieder
    passed: boolean;
  };
  presentMembers: string[]; // IDs der zum Zeitpunkt anwesenden Mitglieder
}
```

#### LogEntry (Protokolleintrag)

```typescript
interface LogEntry {
  id: string;               // UUID
  timestamp: string;        // ISO 8601
  type: LogEntryType;       // Enum (siehe unten)
  message: string;          // Menschenlesbarer Text
  payload?: any;            // Strukturierte Zusatzdaten (z.B. VoteRecord)
  comment: string;          // Nachträglicher Kommentar des Schriftführers
}

type LogEntryType =
  | "session_start"
  | "session_pause"
  | "session_resume"
  | "session_end"
  | "session_public"
  | "session_nonpublic"
  | "presence_change"
  | "vote";
```

#### SessionState (Sitzungsstatus)

```typescript
interface SessionState {
  id: string;
  date: string;             // ISO Date
  location: string;
  title: string;
  agenda: AgendaItem[];
  members: Member[];
  log: LogEntry[];
  votes: VoteRecord[];
  status: "idle" | "active" | "paused" | "ended";
  mode: "public" | "nonpublic";
  currentVote: ActiveVote | null;
}
```

### Komponentenstruktur

```
<App>
├── <SessionHeader>          – Titel, Datum, Sitzungsstatus-Buttons
├── <CouncilCircle>          – Kreisförmiger Sitzplan
│   ├── <MayorSeat>          – Bürgermeister oben/mittig
│   └── <CouncillorSeat[]>   – 24 Sitze im Kreis
│       └── <VotingBadge>    – Erscheint während Abstimmung (Ja/Nein)
├── <VotePanel>              – Erscheint bei aktiver Abstimmung
│   ├── <VoteForm>           – Titel, TOP, Kommentar
│   ├── <BulkVoteToggle>     – Alle Ja / Alle Nein
│   └── <VoteSummary>        – Bestätigungs-Modal
└── <ProtocolLog>            – Unterer Bereich
    └── <LogEntry[]>
        └── <CommentField>   – Nachträgliche Bemerkung
```

### Kernlogik – Abstimmungsablauf

```
1. User klickt "Neue Abstimmung"
   → currentVote wird initialisiert
   → Alle anwesenden Mitglieder bekommen Stimme "no" (default)
   → VotePanel öffnet sich

2. Schriftführer füllt Felder aus
   → Titel (Pflicht)
   → Tagesordnungspunkt (Autocomplete aus agenda[])
   → Kommentar (optional)

3. Einzelne Ja/Nein-Buttons bei jedem Mitglied
   → Nur anwesende Mitglieder sind aktiv
   → Abwesende Sitze sind ausgegraut

4. "Alle Ja" / "Alle Nein" – setzt alle anwesenden Mitglieder auf einmal

5. "Speichern" → VoteSummary-Modal erscheint
   → Zeigt: Ja-Stimmen, Nein-Stimmen, Abstimmungsquorum, Ergebnis
   → User bestätigt → VoteRecord wird erstellt → Log-Eintrag wird erzeugt

6. "Abbrechen" → currentVote wird gelöscht, keine Protokollierung
```

### Anwesenheits-Logik

- Anwesend/Abwesend wird per Klick auf den Sitzkreis umgeschaltet
- Abwesende Mitglieder: Kreis rückt nach außen + wird ausgegraut
- Nur anwesende Mitglieder sind stimmberechtigt
- Stimmrecht-Anzahl wird in Echtzeit angezeigt

### Protokoll-Export-Format (Zielstruktur für Automatisierung)

```json
{
  "session": {
    "id": "uuid",
    "date": "2024-11-15",
    "title": "Stadtratssitzung November 2024",
    "location": "Rathaus, Sitzungssaal 1"
  },
  "members": [...],
  "log": [
    {
      "timestamp": "2024-11-15T18:00:00Z",
      "type": "session_start",
      "message": "Sitzung eröffnet",
      "comment": ""
    },
    {
      "timestamp": "2024-11-15T18:15:00Z",
      "type": "vote",
      "message": "Abstimmung: Haushaltsplan 2025 – angenommen (15 Ja, 7 Nein)",
      "payload": {
        "title": "Haushaltsplan 2025",
        "agendaItem": "TOP 3",
        "yes": 15,
        "no": 7,
        "passed": true,
        "votes": { "sr-01": "yes", "sr-02": "no" }
      }
    }
  ]
}
```

### Zukünftige Erweiterungen

| Feature | Priorität | Ansatz |
|---|---|---|
| Mail-Versand des Protokolls | Hoch | Backend-Endpoint oder mailto: mit Markdown-Body |
| PDF-Export | Hoch | jsPDF oder Puppeteer serverside |
| Mehrere Sitzungen verwalten | Mittel | LocalStorage-Index oder DB-Backend |
| Benutzerrollen (Admin / Schriftführer) | Mittel | JWT-Auth, einfaches Backend |
| Tagesordnung vorerfassen | Mittel | Separates Setup-Formular vor Sitzungsbeginn |
| Offline-Fähigkeit | Niedrig | Service Worker / PWA |
| Echtzeit-Sync (Tablets aller Mitglieder) | Niedrig | WebSocket oder Supabase Realtime |

---

## Nutzungshinweise für LLMs

Dieses Dokument beschreibt vollständig die Architektur der Stadtrat-Webapp. Ein LLM, das an diesem Projekt weiterarbeitet, sollte:

1. **Datenmodell einhalten** – alle Interfaces oben sind normativ; Erweiterungen sind additiv
2. **LogEntry immer erzeugen** – jede sitzungsrelevante Aktion MUSS im Log landen
3. **Anwesenheit als Grundbedingung** – Abstimmungen gelten nur für `present: true` Mitglieder
4. **Kein Backend erforderlich** – alle Funktionen laufen im Browser, Export ist async
5. **React + Tailwind** – bevorzugte Technologien; Klassenstruktur folgt dem Komponentenbaum oben
