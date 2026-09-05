import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import en from "../../../../i18n/en.json";

/**
 * i18next over the single source of truth, `i18n/en.json` and `i18n/de.json`
 * (PLAN.md §5.8). Flat `namespace.key` keys, `{{var}}` placeholders, plurals as
 * `key_one` / `key_other`.
 *
 * English is bundled eagerly because it is the fallback and every key exists in
 * it. German is a dynamic import, so it lands in its own chunk and only costs
 * anything on a German machine — the eager JS budget is 250 KB gzip and a
 * catalog is ~13 KB of it (PLAN.md §11.3).
 */

export type Catalog = typeof en;
export type TranslationKey = keyof Catalog;

let germanLoaded = false;

async function ensureGerman(): Promise<void> {
  if (germanLoaded) return;
  const de = await import("../../../../i18n/de.json");
  i18next.addResourceBundle("de", "translation", de.default, true, true);
  germanLoaded = true;
}

export async function initI18n(locale: string): Promise<void> {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false },
      returnNull: false,
      // The catalogs are flat: `app.cancel` is one key, not `cancel` inside
      // `app`. Without this i18next would split on the dot and find nothing.
      keySeparator: false,
      nsSeparator: false,
    });
  }
  await setLocale(locale);
}

export async function setLocale(locale: string): Promise<void> {
  if (locale === "de") await ensureGerman();
  if (i18next.language !== locale) await i18next.changeLanguage(locale);
  document.documentElement.lang = locale;
}

/**
 * Dates are ISO in files and localized only here (PLAN.md §5.8). The tree
 * shows the day, not the time: "today", "yesterday", then a short date.
 */
export function formatDay(ms: number, t: (key: string) => string): string {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (days <= 0) return t("tree.today");
  if (days === 1) return t("tree.yesterday");
  return new Intl.DateTimeFormat(i18next.language, { dateStyle: "short" }).format(new Date(ms));
}

export default i18next;
