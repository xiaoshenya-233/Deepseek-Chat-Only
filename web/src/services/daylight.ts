/**
 * 依据设备时区估算日出日落，用于「自动」主题。
 *
 * 时区只决定经度，纬度无法从时区得到，所以常见时区查表取代表城市，
 * 未知时区用「UTC 偏移 × 15°」估经度、纬度取中纬 35°。
 * 日出日落用 NOAA 的经典近似公式计算（误差几分钟，足够决定亮/暗主题）。
 */

import { locationCoordinates } from './location.js'
import { useSettings } from './settings.js'

export type DayPhase = 'day' | 'night'

/** IANA 时区 → [纬度, 经度] */
const ZONE_COORDINATES: Record<string, [number, number]> = {
  'Asia/Shanghai': [31.23, 121.47],
  'Asia/Chongqing': [29.56, 106.55],
  'Asia/Urumqi': [43.83, 87.62],
  'Asia/Hong_Kong': [22.32, 114.17],
  'Asia/Macau': [22.2, 113.54],
  'Asia/Taipei': [25.03, 121.57],
  'Asia/Tokyo': [35.68, 139.69],
  'Asia/Seoul': [37.57, 126.98],
  'Asia/Singapore': [1.35, 103.82],
  'Asia/Kuala_Lumpur': [3.14, 101.69],
  'Asia/Bangkok': [13.76, 100.5],
  'Asia/Ho_Chi_Minh': [10.82, 106.63],
  'Asia/Manila': [14.6, 120.98],
  'Asia/Jakarta': [-6.21, 106.85],
  'Asia/Kolkata': [22.57, 88.36],
  'Asia/Dhaka': [23.81, 90.41],
  'Asia/Karachi': [24.86, 67.0],
  'Asia/Dubai': [25.2, 55.27],
  'Asia/Riyadh': [24.71, 46.68],
  'Asia/Tehran': [35.69, 51.39],
  'Asia/Jerusalem': [31.77, 35.21],
  'Asia/Istanbul': [41.01, 28.98],
  'Europe/London': [51.51, -0.13],
  'Europe/Dublin': [53.35, -6.26],
  'Europe/Paris': [48.86, 2.35],
  'Europe/Berlin': [52.52, 13.4],
  'Europe/Madrid': [40.42, -3.7],
  'Europe/Rome': [41.9, 12.5],
  'Europe/Amsterdam': [52.37, 4.9],
  'Europe/Zurich': [47.38, 8.54],
  'Europe/Stockholm': [59.33, 18.07],
  'Europe/Warsaw': [52.23, 21.01],
  'Europe/Kyiv': [50.45, 30.52],
  'Europe/Moscow': [55.76, 37.62],
  'America/New_York': [40.71, -74.01],
  'America/Chicago': [41.88, -87.63],
  'America/Denver': [39.74, -104.99],
  'America/Phoenix': [33.45, -112.07],
  'America/Los_Angeles': [34.05, -118.24],
  'America/Vancouver': [49.28, -123.12],
  'America/Toronto': [43.65, -79.38],
  'America/Mexico_City': [19.43, -99.13],
  'America/Sao_Paulo': [-23.55, -46.63],
  'America/Buenos_Aires': [-34.6, -58.38],
  'Australia/Sydney': [-33.87, 151.21],
  'Australia/Melbourne': [-37.81, 144.96],
  'Australia/Brisbane': [-27.47, 153.03],
  'Australia/Perth': [-31.95, 115.86],
  'Pacific/Auckland': [-36.85, 174.76],
  'Africa/Cairo': [30.04, 31.24],
  'Africa/Lagos': [6.52, 3.38],
  'Africa/Nairobi': [-1.29, 36.82],
  'Africa/Johannesburg': [-26.2, 28.05],
}

const RAD = Math.PI / 180

/** 优先用「设置 → 位置」的省份/国家坐标；没有设置时退回按时区估算 */
const coordinatesFor = (): [number, number] => {
  const known = locationCoordinates(useSettings.getState().location)
  if (known) {
    return known
  }
  return timezoneCoordinates(currentZone())
}

const timezoneCoordinates = (zone: string): [number, number] => {
  const known = ZONE_COORDINATES[zone]
  if (known) {
    return known
  }
  // 未知时区：偏移决定中央经线，纬度取中纬，日出日落误差通常在一小时内
  const offsetHours = -new Date().getTimezoneOffset() / 60
  return [35, Math.max(-180, Math.min(180, offsetHours * 15))]
}

const currentZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

const dayOfYear = (date: Date) => {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0)
  return Math.floor((date.getTime() - start) / 86_400_000)
}

/** NOAA 近似：返回当日日出/日落在 UTC 的小时数（0–24），极昼极夜返回 null */
const solarHours = (date: Date, lat: number, lon: number, rising: boolean): number | null => {
  const n = dayOfYear(date)
  const lngHour = lon / 15
  const t = n + ((rising ? 6 : 18) - lngHour) / 24
  const M = 0.9856 * t - 3.289
  let L = M + 1.916 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 282.634
  L = ((L % 360) + 360) % 360
  let ra = Math.atan(0.91764 * Math.tan(L * RAD)) / RAD
  ra = ((ra % 360) + 360) % 360
  // 赤经与黄经需落在同一象限
  ra = (ra + (Math.floor(L / 90) * 90 - Math.floor(ra / 90) * 90)) / 15
  const sinDec = 0.39782 * Math.sin(L * RAD)
  const cosDec = Math.cos(Math.asin(sinDec))
  const cosH =
    (Math.cos(90.833 * RAD) - sinDec * Math.sin(lat * RAD)) / (cosDec * Math.cos(lat * RAD))
  if (cosH > 1 || cosH < -1) {
    return null
  }
  const hDeg = Math.acos(cosH) / RAD
  const H = (rising ? 360 - hDeg : hDeg) / 15
  const ut = H + ra - 0.06571 * t - 6.622 - lngHour
  return ((ut % 24) + 24) % 24
}

/** 把事件时间对齐到当前时刻前后 12 小时之内，跨越 UTC 日界时仍然正确 */
const align = (time: number, now: number) => {
  const day = 86_400_000
  let value = time
  while (value - now > day / 2) {
    value -= day
  }
  while (now - value > day / 2) {
    value += day
  }
  return value
}

type SunTimes = { sunrise: number; sunset: number }

/** 当天的日出日落时间戳；极昼极夜或算出异常时返回 null */
const getSunTimes = (now = new Date()): SunTimes | null => {
  const [lat, lon] = coordinatesFor()
  const sunrise = solarHours(now, lat, lon, true)
  const sunset = solarHours(now, lat, lon, false)
  if (sunrise === null || sunset === null) {
    return null
  }
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const at = now.getTime()
  return {
    sunrise: align(midnight + sunrise * 3_600_000, at),
    sunset: align(midnight + sunset * 3_600_000, at),
  }
}

const computePhase = (): DayPhase => {
  const now = new Date()
  const times = getSunTimes(now)
  if (!times) {
    // 极昼极夜：按当地作息近似（6:00–18:00 视为白天）
    const hour = now.getHours() + now.getMinutes() / 60
    return hour >= 6 && hour < 18 ? 'day' : 'night'
  }
  const at = now.getTime()
  return at >= times.sunrise && at < times.sunset ? 'day' : 'night'
}

let phase: DayPhase = computePhase()
const listeners = new Set<() => void>()
let timer: number | undefined
let unsubscribeSettings: (() => void) | null = null

const refresh = () => {
  const next = computePhase()
  if (next !== phase) {
    phase = next
    for (const listener of listeners) {
      listener()
    }
  }
}

/** 每分钟、切回前台、以及修改地点设置时复查一次，跨过日出/日落时触发切换 */
export const subscribeDayPhase = (listener: () => void) => {
  listeners.add(listener)
  if (listeners.size === 1) {
    timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    unsubscribeSettings = useSettings.subscribe(refresh)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.clearInterval(timer)
      timer = undefined
      document.removeEventListener('visibilitychange', refresh)
      unsubscribeSettings?.()
      unsubscribeSettings = null
    }
  }
}

export const getDayPhase = (): DayPhase => phase
