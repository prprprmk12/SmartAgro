export type ForecastScenario = { yieldPerHa: number; totalHarvestT: number | null }
export type ForecastResult = {
  fieldId: string
  status: 'ready' | 'insufficient_data'
  modelVersion: string
  calculatedAt: string
  horizon: string
  prediction: number | null
  lower_bound: number | null
  upper_bound: number | null
  totalHarvestT: number | null
  confidence: 'low'
  scenarios: { unfavorable: ForecastScenario; baseline: ForecastScenario; favorable: ForecastScenario } | null
  features: {
    crop: string
    fieldAreaHa: number | null
    method: string
    seasons: Array<{ year: number; crop: string; plantedAreaHa: number; harvestTotalT: number; yieldPerHa: number; source: string }>
    satelliteAndWeatherAdjustment: boolean
  }
  limitations: string[]
  reason?: string
}
