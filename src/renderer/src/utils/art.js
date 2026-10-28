/**
 * 程序化生成封面占位图（data URI SVG）。
 * 仅在 Nexus 封面缺失或加载失败时使用，不依赖网络资源。
 */
import { initials } from './format'

const TONES = [
  { bg: '#121316', fg: '#F5E003' },
  { bg: '#0E1A1C', fg: '#39E0CF' },
  { bg: '#1A0F18', fg: '#FF4D9D' },
  { bg: '#101A13', fg: '#8BE04E' },
  { bg: '#1B1306', fg: '#FF8A3D' },
  { bg: '#131019', fg: '#9B8CFF' }
]

function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function rand(key, salt) {
  return (hash(`${key}:${salt}`) % 1000) / 1000
}

function escapeXml(text) {
  return String(text).replace(/[<>&"']/g, (char) => {
    const map = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }
    return map[char]
  })
}

/**
 * @param {{ seed: string, tone?: number, variant?: number, w?: number, h?: number, mark?: string, glow?: boolean }} options
 */
export function artUrl({ seed = 'mod', tone = 0, variant = 0, w = 640, h = 360, mark = 'NC', glow = false }) {
  const palette = TONES[(tone + variant) % TONES.length]
  const key = `${seed}-${variant}`
  const cx = Math.round(w * (0.28 + rand(key, 'cx') * 0.62))
  const cy = Math.round(h * (0.24 + rand(key, 'cy') * 0.52))
  const radius = Math.round(Math.min(w, h) * (0.26 + rand(key, 'r') * 0.24))
  const stripeRows = [0.16, 0.42, 0.68, 0.88]
  const fontSize = Math.round(Math.min(w, h) * 0.32)
  const pad = Math.round(Math.min(w, h) * 0.09)
  const rotate = Math.round(rand(key, 'rot') * 40 - 20)

  const stripes = stripeRows
    .map((row, index) => {
      const width = Math.round(w * (0.28 + rand(key, `s${index}`) * 0.66))
      const height = Math.max(2, Math.round(h * 0.012))
      return `<rect x="0" y="${Math.round(h * row)}" width="${width}" height="${height}" fill="${palette.fg}" opacity="0.10"/>`
    })
    .join('')

  const bars = [0, 1, 2]
    .map((index) => {
      const width = Math.round(w * (0.18 + rand(key, `b${index}`) * 0.5))
      return `<rect x="${Math.round(w * 0.06)}" y="${Math.round(h * (0.1 + index * 0.06))}" width="${width}" height="2" fill="${palette.fg}" opacity="0.35"/>`
    })
    .join('')

  const glowLayer = glow
    ? `<circle cx="${Math.round(w * 0.76)}" cy="${Math.round(h * 0.4)}" r="${Math.round(h * 0.78)}" fill="${palette.fg}" opacity="0.10"/>
<path d="M0 ${h} L${Math.round(w * 0.42)} 0 L${Math.round(w * 0.6)} 0 L${Math.round(w * 0.16)} ${h} Z" fill="${palette.fg}" opacity="0.07"/>`
    : ''

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="${palette.bg}"/>
${glowLayer}
${stripes}
<g transform="rotate(${rotate} ${cx} ${cy})">
<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${palette.fg}" stroke-opacity="0.5" stroke-width="2"/>
<circle cx="${cx}" cy="${cy}" r="${Math.round(radius * 0.58)}" fill="${palette.fg}" fill-opacity="0.14"/>
<rect x="${cx - Math.round(radius * 0.42)}" y="${cy - Math.round(radius * 0.42)}" width="${Math.round(radius * 0.84)}" height="${Math.round(radius * 0.84)}" fill="none" stroke="${palette.fg}" stroke-opacity="0.35" stroke-width="2"/>
</g>
${bars}
${
  mark
    ? `<text x="${pad}" y="${h - pad}" font-family="Segoe UI, Arial, sans-serif" font-size="${fontSize}" font-weight="800" letter-spacing="${Math.round(fontSize * 0.06)}" fill="${palette.fg}" fill-opacity="0.95">${escapeXml(mark)}</text>`
    : ''
}
</svg>`

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function toneOf(seed) {
  return hash(String(seed)) % TONES.length
}

export function modCover(mod, options = {}) {
  const seed = String(mod.id || mod.name || 'mod')
  const mark = mod.mark || initials(mod.name)
  return artUrl({ seed, tone: toneOf(seed), mark, ...options })
}
