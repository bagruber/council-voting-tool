/** Mandanten-Auflösung. Jeder Rat ist ein Ordner unter public/tenants/ mit
 *  config.json, members.json und optional tagesordnung/. Welcher Mandant
 *  läuft, entscheidet der URL-Parameter ?rat=<id>; ohne ihn gilt der
 *  Standard aus tenants/index.json. */
import { ausMandaten, fromCouncilFormat } from "./council";
import type { CouncilQuelle } from "./council";
import { processRawData } from "./data";
import type { Tenant, TenantConfig } from "./types";

async function fetchJson<T>(url: string, timeoutMs?: number): Promise<T> {
  const r = await fetch(url, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : undefined);
  if (!r.ok) throw new Error(url + ": " + r.status);
  return r.json() as Promise<T>;
}

export function tenantIdFromUrl(): string | null {
  return new URLSearchParams(location.search).get("rat");
}

type RawMembers = Parameters<typeof processRawData>[0];

/** council's data/-Verzeichnis, zur Form der eingecheckten Kopie zusammengesetzt. */
async function ladeCouncil(verzeichnis: string, timeoutMs: number): Promise<CouncilQuelle> {
  const [members, parteien, bodies] = await Promise.all([
    fetchJson<CouncilQuelle["members"]>(verzeichnis + "members.json", timeoutMs),
    fetchJson<Pick<CouncilQuelle, "parties" | "seatOrder" | "councilOrder">>(verzeichnis + "parties.json", timeoutMs),
    fetchJson<CouncilQuelle["bodies"]>(verzeichnis + "bodies.json", timeoutMs),
  ]);
  return { ...parteien, members, bodies };
}

/** Mitgliedsdaten des Mandanten. Nennt die Config eine council-Quelle,
 *  zuerst live von dort (auf moosburg.eu liegt /stadtrat/ im selben Origin,
 *  auf GitHub Pages /council/); scheitert das — Sitzungssaal ohne Netz,
 *  lokale Entwicklung — die eingecheckte Kopie. Beide Wege liefern dieselbe
 *  Form und laufen durch dieselbe Übersetzung. Ohne Quellen-Block gilt die
 *  Kopie unverändert. */
async function loadMembers(id: string, config: TenantConfig): Promise<RawMembers> {
  const lokal = "tenants/" + id + "/members.json";
  const quelle = config.stadtratQuelle;
  if (!quelle) return fetchJson<RawMembers>(lokal);
  const live = quelle.verzeichnisJeHost?.[location.hostname] ?? quelle.verzeichnis;
  try {
    return fromCouncilFormat(ausMandaten(await ladeCouncil(live, 4000)), quelle);
  } catch {
    return fromCouncilFormat(ausMandaten(await fetchJson<CouncilQuelle>(lokal)), quelle);
  }
}

export async function loadTenant(): Promise<Tenant> {
  const index = await fetchJson<{ standard: string; mandanten: string[] }>("tenants/index.json");
  const requested = tenantIdFromUrl();
  const id = requested && index.mandanten.includes(requested) ? requested : index.standard;
  const config = await fetchJson<TenantConfig>("tenants/" + id + "/config.json");
  const raw = await loadMembers(id, config);
  return { id, config, data: processRawData(raw) };
}

/** Browser-Titel und Mandanten-Farben anwenden. */
export function applyTenantChrome(config: TenantConfig): void {
  document.title = config.htmlTitle;
  if (config.farben) {
    Object.entries(config.farben).forEach(([k, v]) => {
      document.documentElement.style.setProperty("--t-" + k, v);
    });
  }
}

/** Pfad einer Tagesordnungsdatei: tenants/<id>/tagesordnung/JJJJ-MM-TT_gremium.txt */
export function agendaUrl(tenantId: string, date: string, bodyId: string): string {
  return "tenants/" + tenantId + "/tagesordnung/" + date + "_" + bodyId + ".txt";
}
