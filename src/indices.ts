export type IndexName = 'ndvi' | 'evi' | 'ndwi'
export type IndexMeasurement = { date: string; index: IndexName; value: number; source: string; cloudCoverPct: number | null; validPixelPct?: number | null; origin?: 'cdse' | 'user-upload'; processingVersion?: string | null; ingestedAt: string }
export type IndexResponse = { fieldId: string; index: IndexName; period: string; series: IndexMeasurement[]; latest: IndexMeasurement | null; source: string }

export function parseIndexCsv(text: string): Array<Omit<IndexMeasurement, 'ingestedAt'>> {
  if (text.length > 256_000) throw new Error('CSV слишком большой (максимум 256 КБ)')
  const clean = text.replace(/^\uFEFF/, '')
  const firstLine = clean.split(/\r?\n/, 1)[0]
  const delimiter = firstLine.includes(';') ? ';' : ','
  const rows: string[][] = []
  let current = ''
  let row: string[] = []
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i]
    if (char === '"') {
      if (quoted && clean[i + 1] === '"') { current += '"'; i++ }
      else quoted = !quoted
    } else if (char === delimiter && !quoted) {
      row.push(current.trim()); current = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && clean[i + 1] === '\n') i++
      row.push(current.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []; current = ''
    } else current += char
  }
  if (quoted) throw new Error('Незакрытая кавычка в CSV')
  row.push(current.trim())
  if (row.some(Boolean)) rows.push(row)
  const header = rows.shift()?.map((value) => value.toLowerCase())
  const required = ['date', 'index', 'value', 'source']
  if (!header || required.some((key) => !header.includes(key))) throw new Error('CSV должен содержать заголовки date,index,value,source (необязательно cloudCoverPct)')
  if (!rows.length || rows.length > 500) throw new Error('CSV должен содержать от 1 до 500 измерений')
  const get = (cells: string[], key: string) => cells[header.indexOf(key)] ?? ''
  return rows.map((cells, position) => {
    if (cells.length !== header.length) throw new Error(`Строка ${position + 2}: неверное число колонок`)
    const date = get(cells, 'date')
    const index = get(cells, 'index').toLowerCase()
    const source = get(cells, 'source')
    const rawValue = get(cells, 'value')
    const rawCloud = get(cells, 'cloudcoverpct')
    const value = Number(rawValue.replace(',', '.'))
    const cloudCoverPct = rawCloud === '' ? null : Number(rawCloud.replace(',', '.'))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !['ndvi', 'evi', 'ndwi'].includes(index) || !rawValue || !Number.isFinite(value) || value < -1 || value > 1 || !source || source.length > 120 ||
      (cloudCoverPct !== null && (!Number.isFinite(cloudCoverPct) || cloudCoverPct < 0 || cloudCoverPct > 100))) throw new Error(`Строка ${position + 2}: проверьте дату, индекс, значение (-1…1), источник и облачность (0…100)`)
    return { date, index: index as IndexName, value, source, cloudCoverPct }
  })
}
