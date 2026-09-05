import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './locales/de.json'
import en from './locales/en.json'
import ru from './locales/ru.json'

// All UI/clue strings live in the locale JSON files — never hard-coded in TS.

const LANG_KEY = 'murdoku.lang.v1'

/** Every language the app ships, in the order the toggles show them. */
export const LANGUAGES = ['de', 'en', 'ru'] as const
export type Lang = (typeof LANGUAGES)[number]

function isLang(value: string): value is Lang {
  return (LANGUAGES as readonly string[]).includes(value)
}

/** The shipped language a locale tag maps to ("de-AT" → "de", "ru-RU" → "ru"). */
function normalize(lng: string): Lang {
  const base = lng.toLowerCase().split('-')[0]
  return isLang(base) ? base : 'en'
}

/** Save the active language so the next visit restores it. */
function persist(lng: string): void {
  try {
    localStorage.setItem(LANG_KEY, normalize(lng))
  } catch {
    /* ignore write failures (e.g. private mode) */
  }
}

/**
 * Which language to start in: the user's previously saved choice if there is one,
 * otherwise the browser's language when we ship it (German, Russian) — English for
 * everything else.
 */
function initialLanguage(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved !== null && isLang(saved)) return saved
  } catch {
    /* localStorage can be unavailable — fall back to browser detection */
  }
  return normalize(navigator.languages?.[0] ?? navigator.language ?? '')
}

/** Keep the document itself in sync: the `lang` attribute (screen readers, hyphenation,
 *  spell-check) and the browser-tab title, which index.html can only ship in one language. */
function applyToDocument(lng: string): void {
  const lang = normalize(lng)
  document.documentElement.lang = lang
  const t = i18n.getFixedT(lang)
  document.title = `${t('app.title')} — ${t('app.subtitle')}`
}

const startLang = initialLanguage()
persist(startLang) // remember the first-visit detection too, not just later changes
i18n.on('languageChanged', persist) // and whenever the user switches via the toggle

void i18n.use(initReactI18next).init({
  resources: {
    de: { translation: de },
    en: { translation: en },
    ru: { translation: ru },
  },
  lng: startLang,
  fallbackLng: 'en',
  supportedLngs: [...LANGUAGES],
  interpolation: { escapeValue: false },
})

applyToDocument(startLang)
i18n.on('languageChanged', applyToDocument)

export default i18n
