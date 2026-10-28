/**
 * 页面内模糊搜索：不区分大小写，空格分隔的多个关键词需要全部命中。
 * 用于「已下载」「包体记录」这类本地列表的即时筛选（输入即过滤，不需要回车）。
 */
export function fuzzyMatch(haystack, query) {
  const text = String(haystack || '').toLowerCase()
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return true
  return needle.split(/\s+/).every((part) => text.includes(part))
}

/** 把多个字段拼成一段可搜索文本 */
export function matchAny(query, fields) {
  return fuzzyMatch((fields || []).filter(Boolean).join(' \u0000 '), query)
}
