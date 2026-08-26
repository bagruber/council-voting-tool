/** Mandanten-Auflösung. Jeder Rat ist ein Ordner unter public/tenants/ mit
 *  config.json, members.json und optional tagesordnung/. Welcher Mandant
 *  läuft, entscheidet der URL-Parameter ?rat=<id>; ohne ihn gilt der
 *  Standard aus tenants/index.json. */
import { fromCouncilFormat } from "./council";
import type { CouncilRawData } from "./council";
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

/** Mitgliedsdaten des Mandanten. Nennt die Config eine council-Quelle,
 *  zuerst live von dort (auf moosburg.eu liegt /stadtrat/ im selben Origin);
 *  scheitert das — Sitzungssaal ohne Netz, GitHub-Pages-Vorschau — die
 *  eingecheckte Kopie. Beide Wege liefern das council-Rohformat und laufen
 *  durch dieselbe Übersetzung. Ohne Quellen-Block gilt die Kopie unverändert. */
async function loadMembers(id: string, config: TenantConfig): Promise<RawMembers> {
  const lokal = "tenants/" + id + "/members.json";
  const quelle = config.stadtratQuelle;
  if (!quelle) return fetchJson<RawMembers>(lokal);
  try {
    return fromCouncilFormat(await fetchJson<CouncilRawData>(quelle.url, 4000), quelle);
  } catch {
    return fromCouncilFormat(await fetchJson<CouncilRawData>(lokal), quelle);
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
