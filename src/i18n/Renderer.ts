import type { Explanation, Puzzle } from '../engine/index.ts'

type Dict = { [key: string]: string | Dict }

/** Case forms of the object noun a locale may ask for on top of the base `object`
 *  token: Russian declines it ("на столе" / "возле стола" / "под столом"), German and
 *  English don't. The engine only ever passes `object`, so a template using one of
 *  these reads the same token — the DICTIONARY carries the declined wording. */
const OBJECT_FORMS = new Set(['objectNom', 'objectPrep', 'objectInstr', 'objectEvery', 'objectSame', 'objName'])

/**
 * Renders engine `Explanation` descriptors into readable text using a locale
 * dictionary. Keeps all wording in the locale JSON — the engine stays text-free.
 * Shared by the dev CLI and the React app (which passes the active i18n bundle).
 */
export class Renderer {
  private readonly dict: Dict
  private plurals?: Intl.PluralRules

  constructor(
    dict: unknown,
    private readonly puzzle: Puzzle,
  ) {
    this.dict = dict as Dict
  }

  lookup(key: string): string | undefined {
    let node: string | Dict | undefined = this.dict
    for (const part of key.split('.')) {
      if (node === undefined || typeof node === 'string') return undefined
      node = node[part]
    }
    return typeof node === 'string' ? node : undefined
  }

  /**
   * The raw token a template param resolves from. Usually `params[name]`, but the
   * declined object forms fall back to the base `object` token and `mateLc` to `mate`,
   * so a locale can ask for a case the engine doesn't know about.
   */
  token(params: Record<string, string | number>, name: string): string | number {
    const own = params[name]
    if (own !== undefined && own !== '') return own
    if (OBJECT_FORMS.has(name)) return params.object ?? own ?? ''
    if (name === 'mateLc') return params.mate ?? own ?? ''
    return own ?? ''
  }

  /**
   * Count-aware key variant for templates that read differently per count ("1 column"
   * vs "2 columns", "1 Raum ist" vs "2 Räume sind", ru "1 клетка"/"2 клетки"/"5 клеток").
   * The base key holds the "other" form; the locale may add `<key>_one` (and, for
   * languages that need them, `_few`/`_many`) siblings. The category comes from
   * `Intl.PluralRules` for the locale's own `langTag` (absent → English, i.e. only
   * `_one`), so keys without such a sibling are unaffected.
   */
  pluralKey(key: string, params: Record<string, string | number>): string {
    const n = params.count ?? params.n ?? params.size
    if (n === undefined || n === '' || !Number.isFinite(Number(n))) return key
    const rules = (this.plurals ??= new Intl.PluralRules(this.lookup('langTag') ?? 'en'))
    const form = rules.select(Number(n))
    if (form !== 'other' && this.lookup(`${key}_${form}`) !== undefined) return `${key}_${form}`
    return key
  }

  cell(cell: number): string {
    const { row, col } = this.puzzle.board.rc(cell)
    return `${this.lookup('coord.row') ?? 'Z'}${row + 1}/${this.lookup('coord.col') ?? 'S'}${col + 1}`
  }

  private genderOf(id: string): string {
    return String(this.puzzle.attributesOf(id).gender) === 'm' ? 'm' : 'f'
  }

  /**
   * The negated `who` token for a "no man/woman in the room" clue. Reads "kein
   * anderer Mann" / "keine andere Frau" (the `<token>_neg_other` variant) ONLY when
   * the subject shares that gender — so "another" is genuine; a subject of the other
   * gender (or a missing variant) keeps the plain "kein Mann". `who` is e.g. "m_nom".
   */
  negWhoToken(who: string, params: Record<string, string | number>): string {
    const subj = params.subject ?? params.name
    if (subj !== undefined && this.lookup(`who.${who}_neg_other`) !== undefined) {
      if (this.genderOf(String(subj)) === who.split('_')[0]) return `${who}_neg_other`
    }
    return `${who}_neg`
  }

  resolveParam(name: string, value: string | number, nameSubject = false, subject?: string | number): string {
    switch (name) {
      case 'name':
      case 'target':
        return this.puzzle.nameOf(String(value))
      case 'subject': {
        const g = this.genderOf(String(value))
        // Locales whose past tense agrees with the subject's gender (ru "он был" /
        // "она была") carry the verb in the pronoun — a NAMED subject then needs the
        // matching copula appended ("Alex был"). Locales without `copula.*` (de/en)
        // keep the bare name.
        if (nameSubject) {
          const name = this.puzzle.nameOf(String(value))
          const copula = this.lookup(`copula.${g}`)
          return copula ? `${name} ${copula}` : name
        }
        return this.lookup(`pron.${g}`) ?? this.puzzle.nameOf(String(value))
      }
      // Object pronoun of the subject ("ihm/ihr" / "him/her") — for "north of him".
      case 'subjectObj':
        return this.lookup(`pronObj.${this.genderOf(String(value))}`) ?? this.puzzle.nameOf(String(value))
      case 'poss':
        return this.lookup(`poss.${this.genderOf(String(value))}`) ?? this.puzzle.nameOf(String(value))
      case 'people':
        return String(value)
          .split(',')
          .filter(Boolean)
          .map((id) => this.puzzle.nameOf(id))
          .join(' & ')
      case 'object':
        return this.lookup(`object.${value}`) ?? String(value)
      // Declined siblings of `object.*` for locales that need them (ru: prepositional
      // "столе" for "on/in", instrumental "столом" for "under"); they fall back to the
      // base phrase, so locales without the sibling dictionaries are unaffected.
      case 'objectPrep':
      case 'objectInstr':
        return this.lookup(`${name}.${value}`) ?? this.lookup(`object.${value}`) ?? String(value)
      // Nominative-with-article form ("ein Fernseher") for clues that compare to an
      // object ("…im selben Raum wie ein Fernseher"). Falls back to the dative form
      // (English has no case distinction, so it reuses `object.*`).
      case 'objectNom':
        return this.lookup(`objectNom.${value}`) ?? this.lookup(`object.${value}`) ?? String(value)
      // Bare object noun ("Tisch" / "table") and the gender-correct "same X" form
      // ("demselben Tisch" / "derselben Pflanze"); English reuses the bare noun.
      case 'objName':
        return this.lookup(`objName.${value}`) ?? String(value)
      case 'objectSame': {
        // German: explicit gender-correct phrase ("demselben Tisch"). English: build
        // "the same " + the bare noun lower-cased (mid-sentence) from `sameThe`.
        const explicit = this.lookup(`objectSame.${value}`)
        if (explicit) return explicit
        const noun = this.lookup(`objName.${value}`) ?? String(value)
        const pre = this.lookup('sameThe')
        return pre ? `${pre} ${noun.charAt(0).toLowerCase() + noun.slice(1)}` : noun
      }
      case 'objects': {
        const parts = String(value)
          .split(',')
          .filter(Boolean)
          .map((t) => this.lookup(`object.${t}`) ?? t)
        if (parts.length <= 1) return parts[0] ?? ''
        const or = this.lookup('clue.connOr') ?? 'oder'
        return `${parts.slice(0, -1).join(', ')} ${or} ${parts[parts.length - 1]}`
      }
      case 'attribute':
        return this.lookup(`attr.${value}`) ?? String(value)
      // "every <object>" derived from the dative `object.*` token, gender-correct and
      // without per-type plurals: de "einem Baum"→"jedem Baum", "einer Pflanze"→"jeder
      // Pflanze"; en "a tree"→"every tree". Used by the universal direction-from-object clue.
      case 'objectEvery': {
        // A locale may spell it out per type ("каждый стол" / "каждая кровать");
        // otherwise de/en derive it from the dative/indefinite phrase.
        const explicit = this.lookup(`objectEvery.${value}`)
        if (explicit) return explicit
        const base = this.lookup(`object.${value}`) ?? String(value)
        return base
          .replace(/^einem /, 'jedem ')
          .replace(/^einer /, 'jeder ')
          .replace(/^an /, 'every ')
          .replace(/^a /, 'every ')
      }
      // `who` resolves "a man/woman" (m_nom/f_nom) and its negated "kein/keine"
      // form (…_neg); `whoNeg` is the same lookup under a second name so a template
      // can show both ("darf keine Frau sein; … ist eine Frau").
      case 'who':
      case 'whoNeg':
        return this.lookup(`who.${value}`) ?? String(value)
      // Gender phrase that becomes "another/other" only when the SUBJECT shares that
      // gender (so "other" is genuine) — "ein anderer Mann" / "eine Frau" (whoOther,
      // singular nominative) and "anderen Männern" / "Frauen" (whoOtherPl, plural
      // dative). `value` is the bare gender letter ("m"/"f").
      case 'whoOther':
      case 'whoOtherPl':
      case 'whoBare': {
        const g = String(value)
        const suffix = name === 'whoOtherPl' ? 'datpl' : name === 'whoBare' ? 'bare' : 'nom'
        const same = subject !== undefined && this.genderOf(String(subject)) === g
        return (
          this.lookup(`who.${g}_${suffix}${same ? '_other' : ''}`) ??
          this.lookup(`who.${g}_${suffix}`) ??
          String(value)
        )
      }
      // The "mate" of a "beside the same object" clue: anyone / a named person / a
      // trait-bearer. Encoded as "any" | "person:<id>" | "attr:<token>". `mate` is
      // capitalised (it starts its own sentence: "Jemand war …"); `mateLc` stays
      // lower-case for mid-sentence use ("… und jemand waren nicht …").
      case 'mate':
      case 'mateLc': {
        const s = String(value)
        const phrase = s.startsWith('person:')
          ? this.puzzle.nameOf(s.slice(7))
          : s.startsWith('attr:')
            ? (() => {
                const token = s.slice(5)
                if (token.startsWith('gender_')) {
                  const g = token.slice(7)
                  // The mate of a roomExists/besideSameObject clue is always a SUSPECT
                  // (never the victim), so it reads "ein verdächtiger Mann" — and turns
                  // "ein ANDERER verdächtiger Mann" only when the subject shares that gender.
                  if (subject !== undefined && this.genderOf(String(subject)) === g) {
                    const other = this.lookup(`who.${g}_susp_nom_other`)
                    if (other !== undefined) return other
                  }
                  return this.lookup(`who.${g}_susp_nom`) ?? this.lookup(`who.${g}_nom`) ?? token
                }
                const pre = this.lookup('who.withTraitPre') ?? ''
                const post = this.lookup('who.withTraitPost') ?? ''
                return `${pre} ${this.lookup(`attr.${token}`) ?? token} ${post}`.replace(/\s+/g, ' ').trim()
              })()
            : (this.lookup(`who.${s}`) ?? this.lookup('who.any') ?? s)
        if (name === 'mateLc') return phrase
        return phrase ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase
      }
      case 'room': {
        const room = this.puzzle.board.rooms.get(String(value))
        if (!room) return String(value)
        // Every template says "IN the room", so locales whose room names decline carry
        // that form (with its preposition) under `roomIn.*` — ru "Гостиная" → "в
        // гостиной", "Кухня" → "на кухне". Without it the plain name is used.
        return (
          this.lookup(room.nameKey.replace(/^room\./, 'roomIn.')) ??
          this.lookup(room.nameKey) ??
          room.nameKey
        )
      }
      // A "room-exists" position phrase ("auf einem Tisch" / "in einer Ecke" / …),
      // encoded "<relation>" or "<relation>:<object>". Used by the solver step texts.
      case 'pos': {
        const s = String(value)
        const sep = s.indexOf(':')
        const rel = sep >= 0 ? s.slice(0, sep) : s
        const obj = sep >= 0 ? s.slice(sep + 1) : ''
        const tmpl = this.lookup(`roomPos.${rel}`) ?? rel
        return tmpl.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => this.resolveParam(key, obj))
      }
      case 'direction':
        return this.lookup(`dir.${value}`) ?? String(value)
      case 'line':
        return this.lookup(`line.${value}`) ?? String(value)
      case 'linePlural':
        return this.lookup(`linePlural.${value}`) ?? String(value)
      case 'roomRel':
        return this.lookup(`roomRel.${value}`) ?? String(value)
      case 'side':
      case 'otherSide':
        return this.lookup(`side.${value}`) ?? String(value)
      case 'cell':
        return this.cell(Number(value))
      // Anchor of an object clue, encoded "<type>:<cell>". Shows " (Z7/S6)" only when
      // the board holds SEVERAL object tiles of the type — with a single one, the
      // plain "east of a tree" is already unambiguous.
      case 'atCell': {
        const s = String(value)
        if (!s) return ''
        const sep = s.indexOf(':')
        const type = s.slice(0, sep)
        if (this.puzzle.board.objectCells(type).length <= 1) return ''
        return ` (${this.cell(Number(s.slice(sep + 1)))})`
      }
      // A comma-separated list of cell indices → "Z2/S1, Z5/S1" (for a grouped hint).
      case 'cells':
        return String(value)
          .split(',')
          .filter(Boolean)
          .map((c) => this.cell(Number(c)))
          .join(', ')
      case 'bound': {
        // "row|id:line,id:line" → "Name→Z3, Name→Z6" (S/C for columns), names resolved.
        const bar = String(value).indexOf('|')
        const prefix =
          String(value).slice(0, bar) === 'row'
            ? (this.lookup('coord.row') ?? 'Z')
            : (this.lookup('coord.col') ?? 'S')
        return String(value)
          .slice(bar + 1)
          .split(',')
          .filter(Boolean)
          .map((pair) => {
            const [pid, line] = pair.split(':')
            return `${this.puzzle.nameOf(pid)}→${prefix}${line}`
          })
          .join(', ')
      }
      default:
        return String(value)
    }
  }

  /**
   * Negation, in order of preference:
   * 1. A dedicated negated wording: if the inner clue defines a `<key>Neg` template
   *    it reads naturally on its own ("In seinem Raum war keine Frau" for not(some
   *    woman)). A `who` token flips to its "kein/keine" form so the article fits.
   * 2. An inline `{{neg}}` slot (all the "{{subject}} war …" clues have one): inject
   *    "nicht " so it reads "X war nicht …".
   * 3. Fallback: wrap it as "nicht (…)".
   */
  private renderNot(
    child: Explanation,
    extra: Record<string, string | number>,
    nameSubject = false,
  ): string {
    const isComposite = !!(child.children && child.children.length > 0)
    if (!isComposite) {
      const negKey = `${child.key}Neg`
      if (this.lookup(negKey) !== undefined) {
        // Expose a negated `who` ("keine Frau") ALONGSIDE the positive one, so the
        // Neg template picks whichever its quantifier needs (none→positive, some→neg).
        const params = { ...(child.params ?? {}) }
        if (typeof params.who === 'string') params.whoNeg = this.negWhoToken(params.who, extra)
        // Mid-sentence lower-case mate ("… und jemand waren nicht …").
        if (typeof params.mate === 'string') params.mateLc = params.mate
        return this.render({ key: negKey, params }, extra, nameSubject)
      }
      const template = this.lookup(child.key)
      if (template && template.includes('{{neg}}')) {
        const neg = this.lookup('clue.negWord') ?? 'nicht '
        return this.render(child, { ...extra, neg }, nameSubject)
      }
    }
    const inner = this.render(child, extra, nameSubject)
    return (this.lookup('clue.not') ?? 'nicht ({{child}})')
      .replace(/\[\[([^\]]+?):[^\]]+?\]\]/g, '$1')
      .replace('{{child}}', inner)
  }

  /** Render a suspect's own clue: gender pronouns for the subject, sentence-capitalised. */
  clue(exp: Explanation, subjectId: string): string {
    const text = this.render(exp, { name: subjectId, subject: subjectId, poss: subjectId, subjectObj: subjectId })
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
  }

  /**
   * Like {@link clue}, but names the subject instead of using a pronoun — for
   * standalone messages shown outside the suspect's card (e.g. listing which
   * clue a wrong solution fails to satisfy).
   */
  namedClue(exp: Explanation, subjectId: string): string {
    const text = this.render(exp, { name: subjectId, subject: subjectId, poss: subjectId, subjectObj: subjectId }, true)
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
  }

  render(exp: Explanation, extra: Record<string, string | number> = {}, nameSubject = false): string {
    if (exp.children && exp.children.length > 0) {
      if (exp.key === 'clue.not') return this.renderNot(exp.children[0], extra, nameSubject)
      // A wrapper whose template embeds the child sentence(s) at {{child}} — e.g. a
      // hint that quotes another suspect's own clue. The child is rendered from that
      // suspect's point of view (their pronoun), then slotted into the wrapper.
      const wrapper = this.lookup(exp.key)
      if (wrapper && wrapper.includes('{{child}}')) {
        const subj = exp.params?.name
        const childExtra =
          subj !== undefined ? { ...extra, name: subj, subject: subj, poss: subj } : extra
        const childText = exp.children.map((child) => this.render(child, childExtra)).join(' ')
        const params = { ...extra, ...(exp.params ?? {}) }
        return wrapper
          .replace(/\{\{child\}\}/g, childText)
          .replace(/\[\[([^\]]+?):[^\]]+?\]\]/g, '$1')
          .replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
            this.resolveParam(key, this.token(params, key), nameSubject, params.subject),
          )
      }
      const parts = exp.children.map((child) => this.render(child, extra, nameSubject))
      if (exp.key === 'clue.and') return parts.join(` ${this.lookup('clue.connAnd') ?? 'und'} `)
      if (exp.key === 'clue.or') return parts.join(` ${this.lookup('clue.connOr') ?? 'oder'} `)
      return parts.join(' ')
    }
    const params = { ...extra, ...(exp.params ?? {}) }
    // Strip the rich-text concept markers `[[word:tipKey]]` → `word` (the UI
    // renderer interprets them; plain text just shows the word).
    const template = (this.lookup(this.pluralKey(exp.key, params)) ?? exp.key).replace(
      /\[\[([^\]]+?):[^\]]+?\]\]/g,
      '$1',
    )
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
      this.resolveParam(key, this.token(params, key), nameSubject, params.subject),
    )
  }
}
