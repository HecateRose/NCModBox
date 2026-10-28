<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Check, Download, Link, Loading, Star, StarFilled } from '@element-plus/icons-vue'
import WindowControls from '../components/WindowControls.vue'
import {
  downloadRecordFor,
  isDeployed,
  isDownloaded,
  resolveMod,
  startNexusDownload,
  state,
  toggleFavorite
} from '../store/mods'
import { modCover } from '../utils/art'
import { formatCount, formatDate } from '../utils/format'
import { parseDescription } from '../utils/bbcode'
import { bridge } from '../api/bridge'

const route = useRoute()
const modId = computed(() => Number(route.params.id) || 0)
const snapshot = ref(resolveMod(modId.value))
const detail = ref(null)
const loading = ref(false)
const error = ref('')
const expanded = ref(false)

const gallery = ref([])
const galleryLoading = ref(false)
const galleryError = ref('')

const showTranslated = ref(false)
const translating = ref(false)
const translateProgress = ref({ done: 0, total: 0 })
let translateAbort = false
const translateError = ref('')
const translations = ref({})

const mod = computed(() => ({ ...(snapshot.value || {}), ...(detail.value || {}) }))
const parsed = computed(() => parseDescription(mod.value.description))
const blocks = computed(() => parsed.value.blocks)
const descriptionImages = computed(() => parsed.value.images)
const allImages = computed(() => [
  ...new Set([...descriptionImages.value, ...gallery.value])
])

const shownBlocks = computed(() => (expanded.value ? blocks.value : blocks.value.slice(0, 12)))
const canExpand = computed(() => blocks.value.length > 12)

/** 可翻译的文本单元（段落与列表项），用于保持原文结构 */
const textUnits = computed(() => {
  const units = []
  blocks.value.forEach((block, blockIndex) => {
    if (block.type === 'p') {
      units.push({ blockIndex, kind: 'p', text: block.text })
    } else if (block.type === 'ul') {
      block.items.forEach((item, itemIndex) => {
        units.push({ blockIndex, kind: 'li', itemIndex, text: item })
      })
    }
  })
  return units
})

function blockText(block, index) {
  if (!showTranslated.value) return block.text
  const entry = translations.value[index]
  return (entry && entry.text) || block.text
}

function blockItems(block, index) {
  if (!showTranslated.value) return block.items
  const entry = translations.value[index]
  if (!entry || !entry.items) return block.items
  return block.items.map((item, itemIndex) => entry.items[itemIndex] || item)
}

async function toggleTranslate() {
  // 翻译中再点一次 = 停止
  if (translating.value) {
    translateAbort = true
    return
  }
  if (showTranslated.value) {
    showTranslated.value = false
    return
  }
  if (Object.keys(translations.value).length) {
    showTranslated.value = true
    return
  }

  const units = textUnits.value
  if (!units.length) return

  translating.value = true
  translateError.value = ''
  translateAbort = false
  translateProgress.value = { done: 0, total: units.length }

  try {
    const map = { ...translations.value }
    let first = true
    for (let index = 0; index < units.length; index += 1) {
      if (translateAbort) break
      const unit = units[index]
      try {
        // 一次只翻一段，翻完立即写回，界面从上到下逐段变成中文
        const result = await bridge.translate([unit.text], 'zh-CN')
        const text = result && result.texts ? result.texts[0] : ''
        if (text) {
          if (unit.kind === 'p') {
            map[unit.blockIndex] = { ...(map[unit.blockIndex] || {}), text }
          } else {
            const entry = map[unit.blockIndex] || { items: [] }
            entry.items[unit.itemIndex] = text
            map[unit.blockIndex] = entry
          }
          translations.value = { ...map }
          if (first) {
            showTranslated.value = true
            first = false
          }
        }
      } catch (err) {
        translateError.value = (err && err.message) || '翻译失败'
        break
      }
      translateProgress.value = { done: index + 1, total: units.length }
    }
    if (translateAbort && !Object.keys(map).length) {
      translateError.value = ''
    }
  } finally {
    translating.value = false
  }
}

/** 详情接口仍在返回、且本地没有快照时才显示骨架，避免闪一下「找不到模组」 */
const pending = computed(() => loading.value && !mod.value.id)
const notFound = computed(() => !loading.value && state.ready && !mod.value.id)

const cover = computed(() =>
  mod.value.picture
    ? mod.value.picture
    : modCover(mod.value, { w: 1200, h: 420, mark: '', glow: true })
)

const favorited = computed(() => state.favorites.includes(Number(mod.value.id)))

/* 本地状态一律以包体记录（downloads）+ 部署 manifest 为准，
   旧的 state.installed 是模拟安装时代的数据，早已不反映真实情况 */
const downloadRecord = computed(() => downloadRecordFor(mod.value.id))
const downloaded = computed(() => isDownloaded(mod.value.id))
const deployed = computed(() => isDeployed(mod.value.id))
const archiveKept = computed(() => Boolean(downloadRecord.value && downloadRecord.value.archiveExists))

const progress = computed(() => {
  const value = state.downloading[modId.value] || state.downloading[mod.value.id]
  return value === undefined ? null : Math.round(value)
})
const busy = computed(() => progress.value !== null)

watchEffect(() => {
  document.title = mod.value.name ? `${mod.value.name} · NightCity Modbox` : 'NightCity Modbox'
})

async function load() {
  if (!modId.value) {
    error.value = '无效的模组 ID'
    return
  }

  loading.value = true
  galleryLoading.value = true
  galleryError.value = ''
  gallery.value = []

  // 图集单独异步加载，不阻塞正文
  loadImages()

  try {
    const result = await bridge.getModDetail(modId.value)
    if (result.item) {
      detail.value = result.item
      if (!snapshot.value) snapshot.value = result.item
    }
    error.value = result.error || ''
  } catch (err) {
    error.value = err && err.message ? err.message : '详情加载失败'
  } finally {
    loading.value = false
  }
}

async function loadImages() {
  try {
    const result = await bridge.getModImages(modId.value)
    gallery.value = result.images || []
    galleryError.value = result.error || ''
  } catch (err) {
    gallery.value = []
    galleryError.value = err && err.message ? err.message : '图片页加载失败'
  } finally {
    galleryLoading.value = false
  }
}

onMounted(load)

async function onFavorite() {
  const next = await toggleFavorite(mod.value)
  ElMessage({ message: next ? '已加入收藏' : '已取消收藏', type: 'success', duration: 1500 })
}

async function onDownload() {
  if (!mod.value.id || busy.value) return
  const result = await startNexusDownload({ ...mod.value })
  if (result.needsLogin) {
    ElMessage({
      message: '已打开 Nexus 登录窗口，登录完成后再次点击下载',
      type: 'info',
      duration: 4200
    })
    return
  }
  if (result.ok) {
    ElMessage({
      message: result.staged
        ? '下载并解压完成，可在「部署」页执行部署'
        : '下载完成（非 zip 包），请到「已下载」页手动解压',
      type: 'success',
      duration: 4200
    })
  } else if (result.error) {
    ElMessage({ message: `下载失败：${result.error}`, type: 'error', duration: 4200 })
  }
}

function openNexus() {
  if (mod.value.pageUrl) bridge.openExternal(mod.value.pageUrl)
}

function openImagesTab() {
  if (mod.value.pageUrl) bridge.openExternal(`${mod.value.pageUrl}?tab=images`)
}

function openUrl(url) {
  if (url) bridge.openExternal(url)
}

function onKeydown(event) {
  if (event.key === 'Escape') bridge.closeWindow()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="detail-shell">
    <header class="detail-bar">
      <span class="detail-bar-mark">NC</span>
      <span class="detail-bar-text">NightCity Modbox<em>模组详情</em></span>

      <div class="detail-bar-right">
        <el-tooltip
          :content="showTranslated ? '显示英文原文' : '翻译为中文'"
          placement="bottom"
          :show-after="300"
        >
          <button class="bar-toggle" :class="{ active: showTranslated }" @click="toggleTranslate">
            <el-icon v-if="translating" class="is-spinning"><Loading /></el-icon>
            <span v-else>{{ showTranslated ? '中' : 'A' }}</span>
          </button>
        </el-tooltip>
        <WindowControls />
      </div>
    </header>

    <div v-if="mod.id" class="detail-scroll">
      <section class="detail-hero">
        <img class="hero-img" :src="cover" :alt="mod.name" draggable="false" />
        <div class="hero-shade" />
        <div class="hero-content">
          <div class="hero-chips">
            <span v-if="mod.category" class="chip chip-accent">{{ mod.category }}</span>
            <span v-if="mod.version" class="chip chip-dark">v{{ mod.version }}</span>
            <span v-if="mod.author" class="chip chip-dark">{{ mod.author }}</span>
            <span v-if="mod.adult" class="chip chip-light">18+</span>
            <span v-if="deployed" class="chip chip-light">已部署</span>
            <span v-else-if="downloaded" class="chip chip-light">已下载</span>
          </div>
          <h1>{{ mod.name }}</h1>
          <p class="hero-sub">{{ mod.summary || '作者暂未填写简介' }}</p>
          <div class="hero-actions">
            <el-button
              class="btn-accent"
              :class="{ 'is-done': downloaded }"
              :icon="downloaded ? Check : Download"
              :loading="busy"
              @click="onDownload"
            >
              {{ busy ? `下载中 ${progress}%` : downloaded ? '重新下载' : '下载' }}
            </el-button>

            <el-button class="btn-outline" :icon="favorited ? StarFilled : Star" @click="onFavorite">
              {{ favorited ? '已收藏' : '收藏' }}
            </el-button>
            <el-button class="btn-outline" :icon="Link" @click="openNexus">Nexus 页面</el-button>
          </div>
          <div v-if="busy" class="hero-progress">
            <span :style="{ width: `${progress}%` }" />
          </div>
        </div>
      </section>

      <div class="detail-body">
        <article class="detail-main">
          <section class="block">
            <h3 class="block-title">
              模组简介
              <button class="translate-link" @click="toggleTranslate">
                {{
                  translating
                    ? `翻译中 ${translateProgress.done}/${translateProgress.total}（点击停止）`
                    : showTranslated
                      ? '显示原文'
                      : '翻译为中文'
                }}
              </button>
            </h3>

            <el-skeleton v-if="loading && !blocks.length" :rows="6" animated />

            <template v-else>
              <p v-if="!blocks.length" class="block-text is-muted">
                该模组没有可展示的文字简介，可前往 Nexus 查看完整页面。
              </p>

              <template v-for="(block, index) in shownBlocks" :key="index">
                <p v-if="block.type === 'p'" class="block-text">{{ blockText(block, index) }}</p>

                <ul v-else-if="block.type === 'ul'" class="bb-list">
                  <li v-for="(item, itemIndex) in blockItems(block, index)" :key="itemIndex">
                    {{ item }}
                  </li>
                </ul>

                <button v-else-if="block.type === 'video'" class="bb-video" @click="openUrl(block.url)">
                  ▶ 视频：{{ block.url }}
                </button>

                <figure v-else-if="block.type === 'img'" class="bb-figure">
                  <el-image
                    class="bb-img"
                    :src="block.src"
                    :preview-src-list="allImages"
                    :initial-index="allImages.indexOf(block.src)"
                    fit="contain"
                    preview-teleported
                    hide-on-click-modal
                  />
                </figure>
              </template>

              <el-button v-if="canExpand" class="btn-ghost block-more" @click="expanded = !expanded">
                {{ expanded ? '收起' : `展开全部（共 ${blocks.length} 段）` }}
              </el-button>
            </template>

            <p v-if="error" class="block-warn">数据提示：{{ error }}</p>
            <p v-if="translateError" class="block-warn">翻译提示：{{ translateError }}</p>
            <p v-else-if="translating" class="block-hint">
              正在逐段翻译：{{ translateProgress.done }} / {{ translateProgress.total }} 段
              （本地模型较慢，每段约 2–4 秒；再点一次按钮可停止）
            </p>

            <div class="bb-gallery">
              <h4 class="bb-gallery-title">
                Nexus 图片页
                <span v-if="gallery.length" class="block-count">{{ gallery.length }}</span>
                <button class="bb-gallery-link" @click="openImagesTab">在站点查看</button>
              </h4>

              <div v-if="galleryLoading" class="bb-gallery-hint">
                正在读取 Nexus 图片页（首次约 10–20 秒）…
              </div>

              <template v-else-if="gallery.length">
                <figure v-for="url in gallery" :key="url" class="bb-figure">
                  <el-image
                    class="bb-img"
                    :src="url"
                    :preview-src-list="allImages"
                    :initial-index="allImages.indexOf(url)"
                    fit="contain"
                    preview-teleported
                    hide-on-click-modal
                  />
                </figure>
              </template>

              <p v-else class="bb-gallery-hint">
                该模组图片页暂时读不到{{ galleryError ? `（${galleryError}）` : '' }}，可点击右上角「Nexus 页面」查看。
              </p>
            </div>
          </section>

          <section class="block">
            <h3 class="block-title">模组信息</h3>
            <dl class="info-grid">
              <div><dt>模组 ID</dt><dd>{{ mod.id }}</dd></div>
              <div><dt>版本</dt><dd>{{ mod.version || '—' }}</dd></div>
              <div><dt>作者</dt><dd>{{ mod.author || '—' }}</dd></div>
              <div><dt>分类</dt><dd>{{ mod.category || '—' }}</dd></div>
              <div><dt>文件大小</dt><dd>{{ mod.fileSize || '—' }}</dd></div>
              <div><dt>最近更新</dt><dd>{{ mod.updated ? formatDate(mod.updated) : '—' }}</dd></div>
              <div><dt>发布时间</dt><dd>{{ mod.createdAt ? formatDate(mod.createdAt) : '—' }}</dd></div>
              <div><dt>总下载量</dt><dd>{{ formatCount(mod.downloads) }}</dd></div>
              <div><dt>点赞数</dt><dd>{{ formatCount(mod.endorsements) }}</dd></div>
            </dl>
          </section>
        </article>

        <aside class="detail-aside">
          <section class="info-card">
            <h4>数据来源</h4>
            <p class="info-line">NexusMods 官方 API</p>
            <p class="info-line">游戏域：cyberpunk2077</p>
            <p class="info-hint">详情字段由 Nexus 实时返回，网络异常时展示本地缓存快照。</p>
            <el-button class="btn-ghost info-action" :icon="Link" @click="openNexus">
              在 Nexus 打开
            </el-button>
          </section>

          <section class="info-card">
            <h4>本地状态</h4>
            <dl class="info-list">
              <div>
                <dt>收藏</dt>
                <dd>{{ favorited ? '已收藏' : '未收藏' }}</dd>
              </div>
              <div>
                <dt>包体</dt>
                <dd>
                  {{
                    !downloaded
                      ? '未下载'
                      : archiveKept
                        ? '已预留（压缩包仍在）'
                        : '记录存在，压缩包已不在'
                  }}
                </dd>
              </div>
              <div>
                <dt>部署</dt>
                <dd>{{ deployed ? '已部署' : downloaded ? '未部署' : '—' }}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>

    <div v-else-if="pending || !state.ready" class="detail-loading">
      <el-skeleton :rows="8" animated />
    </div>

    <div v-else-if="notFound" class="detail-missing">
      <div v-if="error" class="notice-card">
        <h3>详情加载失败</h3>
        <p>{{ error }}</p>
        <div class="notice-actions">
          <el-button class="btn-dark" @click="load">重试</el-button>
          <el-button class="btn-ghost" @click="openNexus">在 Nexus 打开</el-button>
        </div>
      </div>
      <el-empty v-else description="找不到该模组，可能是 ID 无效或已被删除" :image-size="96" />
    </div>
  </div>
</template>
