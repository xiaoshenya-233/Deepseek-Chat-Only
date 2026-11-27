import { cityNames, regionCodes, regionNameOverrides, provinceNames } from './locationData.js'

export { regionCodes } from './locationData.js'

export const provinces = Object.entries(provinceNames).map(([code, name]) => ({
  code,
  name,
  cities: Object.entries(cityNames)
    .filter(([city]) => city.startsWith(code.slice(0, 2)))
    .map(([code, name]) => ({ code, name })),
}))

export type UserLocation = {
  region: string
  province?: string
  city?: string
}

/**
 * 省级行政区 → [纬度, 经度]（按省会/中心附近取值）。
 * 「日出日落」主题用它把纬度从时区猜测量级提升到省份量级，误差从 ±30 分钟缩到 ±10 分钟。
 */
const PROVINCE_COORDINATES: Record<string, [number, number]> = {
  '11': [39.9, 116.4],
  '12': [39.1, 117.2],
  '13': [38.0, 114.5],
  '14': [37.9, 112.5],
  '15': [40.8, 111.7],
  '21': [41.8, 123.4],
  '22': [43.9, 125.3],
  '23': [45.8, 126.6],
  '31': [31.2, 121.5],
  '32': [32.1, 118.8],
  '33': [30.3, 120.2],
  '34': [31.9, 117.3],
  '35': [26.1, 119.3],
  '36': [28.7, 115.9],
  '37': [36.7, 117.0],
  '41': [34.8, 113.6],
  '42': [30.6, 114.3],
  '43': [28.2, 113.0],
  '44': [23.1, 113.3],
  '45': [22.8, 108.3],
  '46': [20.0, 110.3],
  '50': [29.6, 106.5],
  '51': [30.7, 104.1],
  '52': [26.6, 106.6],
  '53': [25.0, 102.7],
  '54': [29.7, 91.1],
  '61': [34.3, 108.9],
  '62': [36.1, 103.8],
  '63': [36.6, 101.8],
  '64': [38.5, 106.3],
  '65': [43.8, 87.6],
  '71': [25.0, 121.5],
  '81': [22.3, 114.2],
  '82': [22.2, 113.5],
}

/** 常见国家/地区 → 首都附近坐标，用于非中国地区的地点设置 */
const REGION_COORDINATES: Record<string, [number, number]> = {
  US: [38.9, -77.0],
  CA: [45.4, -75.7],
  GB: [51.5, -0.1],
  FR: [48.9, 2.4],
  DE: [52.5, 13.4],
  NL: [52.4, 4.9],
  ES: [40.4, -3.7],
  IT: [41.9, 12.5],
  RU: [55.8, 37.6],
  JP: [35.7, 139.7],
  KR: [37.6, 127.0],
  SG: [1.4, 103.8],
  MY: [3.1, 101.7],
  TH: [13.8, 100.5],
  VN: [10.8, 106.6],
  PH: [14.6, 121.0],
  ID: [-6.2, 106.8],
  IN: [22.6, 88.4],
  AE: [25.2, 55.3],
  SA: [24.7, 46.7],
  TR: [41.0, 29.0],
  IL: [31.8, 35.2],
  EG: [30.0, 31.2],
  ZA: [-26.2, 28.0],
  NG: [6.5, 3.4],
  KE: [-1.3, 36.8],
  BR: [-23.6, -46.6],
  AR: [-34.6, -58.4],
  MX: [19.4, -99.1],
  AU: [-33.9, 151.2],
  NZ: [-36.9, 174.8],
}

/** 地点设置对应的坐标；没有可用信息时返回 null（由调用方退回按时区估算） */
export const locationCoordinates = (location: UserLocation | null): [number, number] | null => {
  if (!location) {
    return null
  }
  if (location.region === 'CN') {
    const code = location.province ?? location.city
    return code ? (PROVINCE_COORDINATES[code.slice(0, 2)] ?? null) : null
  }
  return REGION_COORDINATES[location.region] ?? null
}

const regions = new Set(regionCodes)
const regionNames = {
  'zh-CN': new Intl.DisplayNames(['zh-CN'], { type: 'region' }),
  'en-US': new Intl.DisplayNames(['en-US'], { type: 'region' }),
}

export const getRegionName = (code: string, locale: 'zh-CN' | 'en-US'): string =>
  regions.has(code)
    ? (regionNameOverrides[locale][code] ?? regionNames[locale].of(code) ?? code)
    : ''

export const normalizeLocation = (value: unknown): UserLocation | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const location = value as Record<string, unknown>
  const { region, province, city } = location
  if (typeof region !== 'string' || !regions.has(region)) {
    return null
  }
  if (region !== 'CN') {
    return { region }
  }
  if (province === undefined) {
    return city === undefined ? { region } : null
  }
  const selectedProvince = provinces.find((item) => item.code === province)
  if (!selectedProvince) {
    return null
  }
  if (city === undefined) {
    return { region, province: selectedProvince.code }
  }
  const selectedCity = selectedProvince.cities.find((item) => item.code === city)
  return selectedCity ? { region, province: selectedProvince.code, city: selectedCity.code } : null
}
