/** Mandanten-Auflösung. Jeder Rat ist ein Ordner unter public/tenants/ mit
 *  config.json, members.json und optional tagesordnung/. Welcher Mandant
 *  läuft, entscheidet der URL-Parameter ?rat=<id>; ohne ihn gilt der
 *  Standard aus tenants/index.json. */
import { processRawData } from "./data";
import type { Tenant, TenantConfig } from "./types";

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ": " + r.status);
  return r.json() as Promise<T>;
}

export function tenantIdFromUrl(): string | null {
  return new URLSearchParams(location.search).get("rat");
}

export async function loadTenant(): Promise<Tenant> {
  const index = await fetchJson<{ standard: string; mandanten: string[] }>("tenants/index.json");
  const requested = tenantIdFromUrl();
  const id = requested && index.mandanten.includes(requested) ? requested : index.standard;
  const config = await fetchJson<TenantConfig>("tenants/" + id + "/config.json");
  const raw = await fetchJson<Parameters<typeof processRawData>[0]>("tenants/" + id + "/members.json");
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
