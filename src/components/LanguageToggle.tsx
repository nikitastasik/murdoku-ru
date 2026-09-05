import { useTranslation } from 'react-i18next'
import { LANGUAGES } from '../i18n/index.ts'

export default function LanguageToggle() {
  const { i18n } = useTranslation()
  const active = i18n.resolvedLanguage ?? i18n.language

  return (
    <div className="mk-seg" role="group" aria-label="language">
      {LANGUAGES.map((l) => (
        <button key={l} data-active={active === l} onClick={() => void i18n.changeLanguage(l)}>
          {l}
        </button>
      ))}
    </div>
  )
}
