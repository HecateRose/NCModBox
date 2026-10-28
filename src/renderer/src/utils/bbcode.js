/**
 * Nexus 模组简介是 BBCode，这里解析成可渲染的块：
 * { type: 'p' | 'ul' | 'img' | 'video', ... }
 * 同时把简介里内嵌的 [img] 抽出来，作为详情页的多图展示。
 */
const IMG_RE = /\[img(?:=[^\]]*)?\]([\s\S]*?)\[\/img\]/gi
const TOKEN_RE = /^\u0001(IMG|VIDEO)(\d*):?([\s\S]*?)\u0001$/

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&#\d+;/g, '')
}

export function parseDescription(input) {
  if (!input) return { blocks: [], images: [] }

  const images = []
  let text = String(input).replace(/<br\s*\/?>/gi, '\n')

  // 先抽出图片，用占位符标记位置
  text = text.replace(IMG_RE, (_match, rawUrl) => {
    const url = String(rawUrl).trim()
    if (!/^(https?:\/\/|data:image\/)/i.test(url)) return ''
    images.push(url)
    return `\n\u0001IMG${images.length - 1}\u0001\n`
  })

  // 视频转成外链提示
  text = text.replace(/\[youtube\]([\s\S]*?)\[\/youtube\]/gi, (_match, url) => `\n\u0001VIDEO0:${url}\u0001\n`)

  // 链接保留文字
  text = text.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_match, url, label) => {
    const title = decodeEntities((label || '').replace(/<[^>]+>/g, '')).trim()
    return title || url
  })
  text = text.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '$1')

  // 引用 / 折叠块只保留内容
  text = text.replace(/\[quote(?:=[^\]]*)?\]([\s\S]*?)\[\/quote\]/gi, '$1')
  text = text.replace(/\[spoiler(?:=[^\]]*)?\]([\s\S]*?)\[\/spoiler\]/gi, '$1')

  // 列表
  text = text.replace(/\[\/?(list|LIST)(?:=[^\]]*)?\]/g, '\n')
  text = text.replace(/\[\*\]/g, '\n· ')

  // 剩余格式标签
  text = text.replace(/\[\/?(b|i|u|s|center|left|right|code|heading|table|tr|td|th|h[1-6]|line|br|p)\]/gi, '\n')
  text = text.replace(/\[(size|color|font|background|heading|list|quote|spoiler|url|img)(=[^\]]*)?\]/gi, '')
  text = text.replace(/\[[^\]]{0,40}\]/g, '')

  text = decodeEntities(text).replace(/\r/g, '')

  const blocks = []
  let buffer = []
  let list = null

  const flush = () => {
    if (!buffer.length) return
    blocks.push({ type: 'p', text: buffer.join(' ') })
    buffer = []
  }

  text.split('\n').forEach((rawLine) => {
    const line = rawLine.replace(/[ \t]+/g, ' ').trim()

    if (!line) {
      flush()
      list = null
      return
    }

    const token = line.match(TOKEN_RE)
    if (token) {
      flush()
      list = null
      if (token[1] === 'IMG') {
        const src = images[Number(token[2])]
        if (src) blocks.push({ type: 'img', src })
      } else if (token[3]) {
        blocks.push({ type: 'video', url: token[3].trim() })
      }
      return
    }

    if (line.startsWith('·')) {
      flush()
      if (!list) {
        list = { type: 'ul', items: [] }
        blocks.push(list)
      }
      const item = line.replace(/^·\s*/, '').trim()
      if (item) list.items.push(item)
      return
    }

    list = null
    buffer.push(line)
  })

  flush()

  return { blocks, images }
}
