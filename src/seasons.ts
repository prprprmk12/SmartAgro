export type SeasonRecord = { id: string; fieldId: string; year: number; crop: string; plantedAreaHa: number; harvestTotalT: number; yieldPerHa: number; source: string; createdAt: string; updatedAt: string }
export type SeasonInput = Pick<SeasonRecord, 'year' | 'crop' | 'plantedAreaHa' | 'harvestTotalT' | 'source'>

export function parseSeasonCsv(text: string): SeasonInput[] {
  if (text.length > 128_000) throw new Error('CSV слишком большой (максимум 128 КБ)')
  const clean = text.replace(/^\uFEFF/, '')
  const delimiter = clean.split(/\r?\n/, 1)[0].includes(';') ? ';' : ','
  const rows: string[][] = []
  let cells: string[] = []
  let value = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i]
    if (char === '"') {
      if (quoted && clean[i + 1] === '"') { value += '"'; i++ }
      else quoted = !quoted
    } else if (char === delimiter && !quoted) {
      cells.push(value.trim()); value = ''
    } else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && clean[i + 1] === '\n') i++
      cells.push(value.trim())
      if (cells.some(Boolean)) rows.push(cells)
      cells = []; value = ''
    } else value += char
  }
  if (quoted) throw new Error('Незакрытая кавычка в CSV')
  cells.push(value.trim())
  if (cells.some(Boolean)) rows.push(cells)
  const header = rows.shift()?.map((item) => item.toLowerCase())
  const required = ['year', 'crop', 'plantedareaha', 'harvesttotalt', 'source']
  if (!header || header.length !== required.length || required.some((key) => !header.includes(key))) throw new Error('CSV должен содержать колонки year,crop,plantedAreaHa,harvestTotalT,source')
  if (rows.length < 1 || rows.length > 100) throw new Error('В CSV должно быть от 1 до 100 сезонов')
  const get = (row: string[], key: string) => row[header.indexOf(key)] ?? ''
  const parsed = rows.map((row, index) => {
    if (row.length !== header.length) throw new Error(`Строка ${index + 2}: неверное число колонок`)
    const rawYear = get(row, 'year')
    const rawArea = get(row, 'plantedareaha')
    const rawHarvest = get(row, 'harvesttotalt')
    const year = Number(rawYear)
    const plantedAreaHa = Number(rawArea.replace(',', '.'))
    const harvestTotalT = Number(rawHarvest.replace(',', '.'))
    const crop = get(row, 'crop')
    const source = get(row, 'source')
    if (!rawYear || !rawArea || !rawHarvest || !Number.isInteger(year) || year < 1990 || year > new Date().getFullYear() ||
      !crop || crop.length > 80 || !source || source.length > 160 || !Number.isFinite(plantedAreaHa) || plantedAreaHa <= 0 || plantedAreaHa > 100000 ||
      !Number.isFinite(harvestTotalT) || harvestTotalT < 0 || harvestTotalT > 100000000) throw new Error(`Строка ${index + 2}: проверьте год, культуру, посевную площадь, сбор и источник`)
    return { year, crop, plantedAreaHa, harvestTotalT, source }
  })
  if (new Set(parsed.map((item) => `${item.year}|${item.crop.toLocaleLowerCase('ru-RU')}`)).size !== parsed.length) throw new Error('В CSV повторяется год и культура одного поля')
  return parsed
}
