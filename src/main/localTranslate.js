/**
 * 本地翻译引擎（离线）。
 *
 * 默认用英中专用的小模型 Xenova/opus-mt-en-zh：约 75MB、单句 0.3-0.7 秒，比 NLLB-600M 快 7 倍左右。
 * 非中文目标语言时回退到 NLLB-200（多语言，已下载的 869MB 模型继续可用）。
 * 模型缓存到 userData/models，首次使用下载；下载源可用 MODBOX_TRANSLATE_MIRROR 指定镜像。
 */
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const FAST_MODEL = 'Xenova/opus-mt-en-zh'
const MULTI_MODEL = 'Xenova/nllb-200-distilled-600M'
const CHUNK = 450
const SOURCE_LANG = 'eng_Latn'

const LANG_MAP = {
  'zh-cn': 'zho_Hans',
  zh: 'zho_Hans',
  'zh-tw': 'zho_Hant',
  en: 'eng_Latn',
  ja: 'jpn_Jpan',
  ko: 'kor_Hang',
  ru: 'rus_Cyrl',
  de: 'deu_Latn',
  fr: 'fra_Latn',
  es: 'spa_Latn',
  it: 'ita_Latn',
  pl: 'pol_Latn',
  pt: 'por_Latn'
}

const status = {
  ready: false,
  loading: false,
  progress: 0,
  error: '',
  model: FAST_MODEL,
  modelId: FAST_MODEL
}

let transformers = null
let fastPipeline = null
let multiPipeline = null
let loadingPromise = null

function modelDir() {
  return path.join(app.getPath('userData'), 'models')
}

async function loadLibrary() {
  if (transformers) return transformers
  transformers = await import('@huggingface/transformers')
  const { env } = transformers
  env.cacheDir = modelDir()
  env.allowLocalModels = true
  env.allowRemoteModels = true
  env.remoteHost = process.env.MODBOX_TRANSLATE_MIRROR || 'https://huggingface.co'
  return transformers
}

/** 按镜像顺序尝试加载模型 */
async function loadPipeline(lib, modelId) {
  const mirrors = [
    process.env.MODBOX_TRANSLATE_MIRROR,
    'https://huggingface.co',
    'https://hf-mirror.com'
  ].filter(Boolean)
  let lastError = null
  for (const mirror of mirrors) {
    try {
      lib.env.remoteHost = mirror
      status.mirror = mirror
      const instance = await lib.pipeline('translation', modelId, {
        dtype: 'q8',
        progress_callback: (event) => {
          if (event && typeof event.progress === 'number') {
            status.progress = Math.round(event.progress)
          }
        }
      })
      status.progress = 100
      status.error = ''
      return instance
    } catch (err) {
      lastError = err
      status.progress = 0
      status.error = `${mirror} 下载失败：${(err && err.message) || '未知错误'}`
    }
  }
  throw lastError || new Error('模型加载失败')
}

/** 模型文件是否已下载到本地缓存 */
function isModelDownloaded(modelId) {
  try {
    const dir = path.join(modelDir(), ...String(modelId).split('/'))
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0
  } catch {
    return false
  }
}

export function getLocalModelStatus() {
  return {
    ...status,
    downloaded: Boolean(fastPipeline) || isModelDownloaded(FAST_MODEL),
    modelDir: modelDir()
  }
}

export function isLocalReady() {
  return Boolean(fastPipeline)
}

/** 加载（必要时下载）快速英中模型；多模型使用时再按需加载 NLLB */
export async function ensureLocalModel() {
  if (fastPipeline) return { ok: true, status: getLocalModelStatus() }
  if (loadingPromise) return loadingPromise

  status.loading = true
  status.error = ''
  status.progress = 0
  status.model = FAST_MODEL
  status.modelId = FAST_MODEL

  try {
    fs.mkdirSync(modelDir(), { recursive: true })
  } catch {
    /* 目录创建失败会在加载阶段报错 */
  }

  loadingPromise = (async () => {
    try {
      const lib = await loadLibrary()
      fastPipeline = await loadPipeline(lib, FAST_MODEL)
      status.ready = true
      status.loading = false
      return { ok: true, status: getLocalModelStatus() }
    } catch (err) {
      status.loading = false
      status.ready = false
      fastPipeline = null
      status.error = (err && err.message) || '本地翻译模型加载失败'
      return { ok: false, error: status.error, status: getLocalModelStatus() }
    } finally {
      loadingPromise = null
    }
  })()

  return loadingPromise
}

/** 非中文目标时才加载多语言 NLLB（体积大，按需） */
async function ensureMultiModel() {
  if (multiPipeline) return multiPipeline
  const lib = await loadLibrary()
  status.loading = true
  status.model = MULTI_MODEL
  status.modelId = MULTI_MODEL
  try {
    multiPipeline = await loadPipeline(lib, MULTI_MODEL)
    return multiPipeline
  } finally {
    status.loading = false
    status.model = FAST_MODEL
    status.modelId = FAST_MODEL
  }
}

function chunkText(text, size) {
  if (text.length <= size) return [text]
  const chunks = []
  let rest = text
  while (rest.length > size) {
    let cut = rest.lastIndexOf('. ', size)
    if (cut < size * 0.5) cut = rest.lastIndexOf(' ', size)
    if (cut < size * 0.4) cut = size
    chunks.push(rest.slice(0, cut + 1).trim())
    rest = rest.slice(cut + 1).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

/** 用本地模型翻译一批文本（默认英→中，快速模型） */
export async function translateWithLocal(texts, target = 'zh-CN') {
  const isChinese = /^zh/i.test(String(target || ''))

  if (isChinese) {
    if (!fastPipeline) {
      const load = await ensureLocalModel()
      if (!load.ok) return { ok: false, error: load.error, results: [] }
    }
  } else {
    try {
      await ensureMultiModel()
    } catch (err) {
      return { ok: false, error: (err && err.message) || '多语言模型加载失败', results: [] }
    }
  }

  const results = []
  for (const item of texts) {
    const source = String(item || '')
    if (!source.trim()) {
      results.push('')
      continue
    }
    const pieces = chunkText(source, CHUNK)
    const out = []
    try {
      for (const piece of pieces) {
        let translated = ''
        if (isChinese) {
          const output = await fastPipeline(piece)
          translated = output && output[0] && output[0].translation_text
        } else {
          const tgt = LANG_MAP[String(target).toLowerCase()] || 'zho_Hans'
          const output = await multiPipeline(piece, { src_lang: SOURCE_LANG, tgt_lang: tgt })
          translated = output && output[0] && output[0].translation_text
        }
        out.push(translated || '')
      }
    } catch (err) {
      return { ok: false, error: (err && err.message) || '本地翻译失败', results: [] }
    }
    results.push(out.join(' ').trim())
  }
  return { ok: true, results }
}

/** 清除已下载的模型缓存 */
export async function clearLocalModel() {
  fastPipeline = null
  multiPipeline = null
  status.ready = false
  status.loading = false
  status.progress = 0
  status.error = ''
  try {
    fs.rmSync(modelDir(), { recursive: true, force: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err && err.message) || '清除模型缓存失败（可能正被占用）' }
  }
}
