export function formatCount(value) {
  if (!value && value !== 0) return '—'
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)} 亿`
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)} 万`
  return value.toLocaleString('zh-CN')
}

/** '12.4 MB' | '1.9 GB' -> 以 MB 为单位的数值 */
export function sizeToMb(text) {
  if (typeof text !== 'string') return 0
  const match = text.match(/([\d.]+)\s*(GB|MB|KB)/i)
  if (!match) return 0
  const value = parseFloat(match[1])
  const unit = match[2].toUpperCase()
  if (unit === 'GB') return value * 1024
  if (unit === 'KB') return value / 1024
  return value
}

export function formatSize(mb) {
  if (!mb) return '0 MB'
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}

export function formatDate(value) {
  if (!value) return '—'
  const [year, month, day] = value.split('-')
  return `${year}.${month}.${day}`
}

export function relativeDate(value) {
  if (!value) return '—'
  const target = new Date(`${value}T00:00:00`)
  const diff = Date.now() - target.getTime()
  const days = Math.floor(diff / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  if (days < 365) return `${Math.floor(days / 30)} 个月前`
  return `${Math.floor(days / 365)} 年前`
}

export function initials(name) {
  if (!name) return 'NC'
  const ascii = name.match(/[A-Za-z0-9]+/g)
  if (ascii && ascii.length) {
    if (ascii.length === 1) return ascii[0].slice(0, 3).toUpperCase()
    return ascii
      .slice(0, 3)
      .map((word) => word[0])
      .join('')
      .toUpperCase()
  }
  return name.slice(0, 2)
}
