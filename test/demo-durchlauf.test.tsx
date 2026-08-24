/** Fährt die Demo-Sitzung einmal komplett durch: eröffnen, Stellvertretung,
 *  Abstimmung über einen TOP, Einzelstimme, Fraktion, benennen, speichern,
 *  nichtöffentlich, beenden. Prüft dabei, dass jede Demo-Schritt-id ein
 *  data-demo-Ziel in der Oberfläche hat und am Ende 9 von 10 Schritten als
 *  erledigt gelten (der Export-Schritt bleibt bewusst offen). */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEMO_STEPS } from "../src/demo";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

beforeAll(() => {
  // ?demo muss stehen, BEVOR App.tsx importiert wird (Modul-Konstante).
  window.history.replaceState({}, "", "/?demo");

  // fetch bedient die echten Dateien aus public/, damit der Test auch
  // config.json und members.json des Mandanten validiert.
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input).replace(/^\.?\//, "").split("?")[0];
    try {
      const body = readFileSync(join(publicDir, url), "utf8");
      return Promise.resolve(new Response(body, { status: 200 }));
    } catch {
      return Promise.resolve(new Response("nicht da", { status: 404 }));
    }
  });
});

afterEach(cleanup);

describe("Demo-Durchlauf", () => {
  it("führt durch alle Schritte und markiert 9 von 10 als erledigt", async () => {
    const { default: App } = await import("../src/App");
    const { container } = render(<App />);

    const target = (id: string) => container.querySelector(`[data-demo~="${id}"]`);
    /* Demo-Schritt-Titel wiederholen Knopf-Beschriftungen ("Sitzung
       eröffnen" steht auch in der Leiste), deshalb gezielt nur Buttons. */
    const buttonByText = (txt: string) =>
      Array.from(container.querySelectorAll("button"))
        .find((b) => (b.textContent || "").trim().startsWith(txt));

    // Sitzung lädt: Eröffnen-Knopf und die statischen Ziele erscheinen.
    await waitFor(() => expect(target("open")).toBeTruthy());
    for (const id of ["presence", "cast", "agenda", "bulk"]) {
      expect(target(id), `Ziel für Demo-Schritt "${id}" fehlt`).toBeTruthy();
    }

    // 1. eröffnen
    fireEvent.click(target("open") as HTMLElement);
    await waitFor(() => expect(target("end")).toBeTruthy());
    expect(target("nonpublic")).toBeTruthy();

    // 2. Stellvertretung: erster bedienbarer Sitz im Ring
    const seat = container.querySelector("button.seat-node:not(.disabled)") as HTMLButtonElement;
    expect(seat).toBeTruthy();
    fireEvent.click(seat);

    // 3. Abstimmung über einen TOP aus der geladenen Tagesordnung starten
    await waitFor(() => {
      const agendaBtn = container.querySelector("button.agenda-btn:not([disabled])");
      expect(agendaBtn).toBeTruthy();
      fireEvent.click(agendaBtn!);
    });
    await waitFor(() => expect(target("title")).toBeTruthy());
    expect(target("save")).toBeTruthy();

    // 4. Einzelstimme: Sitz-Klick schaltet auf Ja
    const votingSeat = container.querySelector("button.seat-node:not(.disabled)") as HTMLButtonElement;
    fireEvent.click(votingSeat);

    // 5. ganze Fraktionen: Alle Ja
    fireEvent.click(buttonByText("Alle Ja")!);

    // 6. benennen
    fireEvent.change(screen.getByPlaceholderText("Titel der Abstimmung *"), {
      target: { value: "Beschluss zur Probe" },
    });

    // 7. speichern und bestätigen
    fireEvent.click(buttonByText("Speichern")!);
    await waitFor(() => expect(buttonByText("Bestätigen")).toBeTruthy());
    fireEvent.click(buttonByText("Bestätigen")!);
    await waitFor(() => expect(buttonByText("Bestätigen")).toBeUndefined());

    // 8. nichtöffentlicher Teil
    fireEvent.click(buttonByText("Öffentlich")!);
    await waitFor(() => expect(buttonByText("Nichtöffentlich")).toBeTruthy());

    // 9. beenden
    fireEvent.click(buttonByText("Beenden")!);
    await waitFor(() => expect(target("export")).toBeTruthy());

    // Alle Schritte außer dem Export sind erledigt.
    expect(DEMO_STEPS).toHaveLength(10);
    await waitFor(() => {
      expect(screen.getByRole("img", { name: "9 von 10 Schritten erledigt" })).toBeTruthy();
    });
  });
});
