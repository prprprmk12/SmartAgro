import { useEffect, useRef, useState } from 'react'

export const sections = [
  { id: 'overview', label: 'Обзор', description: 'Хозяйство, выбранное поле и ближайшие задачи.' },
  { id: 'fields', label: 'Поля', description: 'Контуры, спутниковые зоны и данные ваших полей.' },
  { id: 'analytics', label: 'Аналитика', description: 'Индексы растительности, история сезонов и ориентир урожайности.' },
  { id: 'weather', label: 'Погода', description: 'Прогноз на семь дней по координатам выбранного поля.' },
  { id: 'operations', label: 'Операции', description: 'Планируйте работы и отмечайте выполненные задачи поля.' },
  { id: 'economics', label: 'Экономика', description: 'Прямые затраты, цены и сценарная маржа выбранного поля.' },
  { id: 'reports', label: 'Отчёты', description: 'Подготовьте отчёт по выбранному полю с датами и источниками.' },
] as const
export type SectionId = typeof sections[number]['id']

function sectionFromHash(): SectionId {
  const value = window.location.hash.replace(/^#\/?/, '')
  if (sections.some(section => section.id === value)) return value as SectionId
  const legacy: Record<string, SectionId> = { 'fields-map': 'fields', 'field-seasons': 'analytics', 'growth-chart': 'analytics', 'yield-forecast': 'analytics', 'risk-panel': 'weather', 'economy-panel': 'economics' }
  return legacy[value] || 'overview'
}

export function useSectionNavigation() {
  const [active, setActive] = useState<SectionId>(sectionFromHash)
  useEffect(() => {
    const update = () => setActive(sectionFromHash())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return active
}

const paths: Record<string, string> = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  fields: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6z M9 3v15 M15 6v15',
  analytics: 'M4 3v17h17 M7 14l4-5 4 3 6-7',
  weather: 'M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  operations: 'M9 5h11 M9 12h11 M9 19h11 M3 5l1 1 2-3 M3 12l1 1 2-3 M3 19l1 1 2-3',
  economics: 'M4 5h16 M4 9h16 M12 9v12',
  reports: 'M14 3H5v18h14V8l-5-5z M14 3v5h5 M8 12h8 M8 16h8',
  ai: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7z',
  settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
  more: 'M4 6h16 M4 12h16 M4 18h16',
}
export function NavIcon({ name }: { name: string }) {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.more} /></svg>
}

type NavigationProps = { active: SectionId; company: string; openTasks: number | null; onChat: () => void; onSettings: () => void }
const primaryIds: SectionId[] = ['overview', 'fields', 'analytics', 'operations']

export default function Navigation({ active, company, openTasks, onChat, onSettings }: NavigationProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!moreOpen) return
    const element = dialog.current!
    element.showModal()
    const wide = window.matchMedia('(min-width: 701px)')
    const closeOnDesktop = () => { if (wide.matches) setMoreOpen(false) }
    wide.addEventListener('change', closeOnDesktop)
    return () => { element.close(); wide.removeEventListener('change', closeOnDesktop) }
  }, [moreOpen])
  useEffect(() => { setMoreOpen(false) }, [active])
  const link = (section: typeof sections[number], mobile = false) => <a
    key={section.id} href={`#/${section.id}`} className={`workspace-nav-link${active === section.id ? ' is-active' : ''}`}
    aria-current={active === section.id ? 'page' : undefined} onClick={() => setMoreOpen(false)}>
    <NavIcon name={section.id} /><span>{mobile && section.id === 'operations' ? 'Задачи' : section.label}</span>
    {section.id === 'operations' && openTasks !== null && openTasks > 0 && <small className="nav-count" aria-label={`${openTasks} открытых задач выбранного поля`}>{openTasks > 99 ? '99+' : openTasks}</small>}
  </a>
  return <>
    <aside className="workspace-sidebar">
      <a className="workspace-brand" href="#/overview" aria-label="SmartAgro — обзор"><span className="brand-mark">✦</span>smart<span>agro</span></a>
      <div className="workspace-company"><small>ВАШЕ ХОЗЯЙСТВО</small><strong>{company}</strong></div>
      <nav aria-label="Основные разделы">{sections.map(section => link(section))}</nav>
      <div className="workspace-sidebar-bottom">
        <button className="workspace-nav-link" onClick={onChat}><NavIcon name="ai" /><span>AI-помощник</span></button>
        <button className="workspace-nav-link" onClick={onSettings}><NavIcon name="settings" /><span>Настройки</span></button>
        <p>SmartAgro · рабочее место агронома</p>
      </div>
    </aside>
    <nav className="mobile-navigation" aria-label="Мобильная навигация">
      {primaryIds.map(id => link(sections.find(section => section.id === id)!, true))}
      <button className={`workspace-nav-link${!primaryIds.includes(active) || moreOpen ? ' is-active' : ''}`} aria-expanded={moreOpen} aria-controls="more-navigation" aria-haspopup="dialog" onClick={() => setMoreOpen(true)}><NavIcon name="more" /><span>Ещё</span></button>
    </nav>
    <dialog ref={dialog} id="more-navigation" className="more-navigation" aria-labelledby="more-heading" onCancel={() => setMoreOpen(false)} onClick={event => { if (event.target === event.currentTarget) setMoreOpen(false) }}>
      <div className="more-navigation-content">
        <div className="more-heading"><h2 id="more-heading">Разделы и инструменты</h2><button aria-label="Закрыть меню" onClick={() => setMoreOpen(false)}>×</button></div>
        <nav aria-label="Дополнительные разделы">{sections.filter(section => !primaryIds.includes(section.id)).map(section => link(section))}</nav>
        <button className="workspace-nav-link" onClick={() => { setMoreOpen(false); onChat() }}><NavIcon name="ai" /><span>AI-помощник</span></button>
        <button className="workspace-nav-link" onClick={() => { setMoreOpen(false); onSettings() }}><NavIcon name="settings" /><span>Настройки</span></button>
      </div>
    </dialog>
  </>
}

type PickerField = { id?: string; name: string; crop: string; areaHa: number }
export function FieldPicker({ fields, selected, onSelect, onAdd }: { fields: PickerField[]; selected: PickerField; onSelect: (name: string) => void; onAdd: () => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    search.current?.focus()
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  const close = () => { setOpen(false); trigger.current?.focus() }
  const matches = fields.filter(field => `${field.name} ${field.crop}`.toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU')))
  return <div className="field-picker" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
    <button className="field-picker-trigger" ref={trigger} aria-expanded={open} aria-controls="field-picker-options" onClick={() => { setQuery(''); setOpen(value => !value) }}><NavIcon name="fields" /><span><small>Выбранное поле</small><b>{selected.name}</b></span><span aria-hidden="true">⌄</span></button>
    {open && <div className="field-picker-popover" id="field-picker-options">
      <input ref={search} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Название поля или культура" aria-label="Найти поле" />
      <ul aria-label="Поля хозяйства">{matches.map(field => <li key={field.id || field.name}><button aria-pressed={field.name === selected.name} onClick={() => { onSelect(field.name); close() }}><span><b>{field.name}</b><small>{field.crop} · {field.areaHa} га</small></span>{field.name === selected.name && <span aria-hidden="true">✓</span>}</button></li>)}</ul>
      {!matches.length && <p role="status">Полей по этому запросу нет.</p>}
      <button className="field-picker-add" onClick={() => { close(); onAdd() }}>＋ Добавить поле</button>
    </div>}
  </div>
}
