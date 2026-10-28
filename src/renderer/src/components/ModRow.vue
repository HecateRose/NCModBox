<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Star, StarFilled } from '@element-plus/icons-vue'
import { bridge } from '../api/bridge'
import { startNexusDownload, state, toggleFavorite, tr } from '../store/mods'
import { modCover } from '../utils/art'
import { formatCount, relativeDate } from '../utils/format'

const props = defineProps({
  mod: { type: Object, required: true }
})

const imageBroken = ref(false)
const placeholder = computed(() => modCover(props.mod, { w: 360, h: 168 }))
const cover = computed(() =>
  props.mod.picture && !imageBroken.value ? props.mod.picture : placeholder.value
)

const favorited = computed(() => state.favorites.includes(Number(props.mod.id)))
const downloaded = computed(() => state.downloads.some((record) => record.modId === Number(props.mod.id)))
const dl = computed(() => state.downloading[props.mod.id] || null)
const dlBusy = computed(() => Boolean(dl.value && !dl.value.done))
const size = computed(() => props.mod.fileSize || '')

function open() {
  bridge.openModWindow(props.mod.id)
}

async function onFavorite() {
  const next = await toggleFavorite(props.mod)
  ElMessage({ message: next ? '已加入收藏' : '已取消收藏', type: 'success', duration: 1500 })
}

/** 下载：一键真实下载（使用程序内登录的 Nexus 会话），完成后自动解压进 staging */
async function onInstall() {
  const result = await startNexusDownload({ ...props.mod })
  if (result.needsLogin) {
    ElMessage({
      message: '已打开 Nexus 登录窗口，登录完成后再次点击「下载」',
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

</script>

<template>
  <article
    class="mod-row"
    :class="{ 'is-installed': downloaded, 'is-busy': dlBusy }"
    tabindex="0"
    @click="open"
    @keydown.enter="open"
  >
    <div class="row-cover">
      <img :src="cover" :alt="mod.name" draggable="false" @error="imageBroken = true" />
      <span v-if="mod.adult" class="cover-flag">18+</span>
    </div>

    <div class="row-main">
      <div class="row-head">
        <h3 class="row-title">{{ mod.name }}</h3>
        <span v-if="mod.version" class="row-version">v{{ mod.version }}</span>
        <span v-if="downloaded" class="pill pill-installed">已下载</span>
      </div>
      <p class="row-summary">{{ tr(mod.summary) || '作者暂未填写简介' }}</p>
      <div class="row-tags">
        <span v-if="downloaded" class="chip chip-plain">已登记</span>
        <span v-if="mod.category" class="chip chip-strong">{{ tr(mod.category) }}</span>
        <span v-if="mod.author" class="chip">{{ mod.author }}</span>
        <span class="chip chip-plain">#{{ mod.id }}</span>
      </div>
    </div>

    <div class="row-stats">
      <div v-if="mod.downloads" class="stat">
        <el-icon class="stat-icon"><Download /></el-icon>
        <span>{{ formatCount(mod.downloads) }}</span>
      </div>
      <div v-if="mod.endorsements" class="stat">
        <span class="stat-star">★</span>
        <span>{{ formatCount(mod.endorsements) }}</span>
      </div>
      <div v-if="size" class="stat stat-muted">{{ size }}</div>
      <div v-if="mod.updated" class="stat stat-muted">{{ relativeDate(mod.updated) }}更新</div>
      <div v-if="!mod.downloads && !mod.endorsements && !size && !mod.updated" class="stat stat-muted">
        暂无统计
      </div>
    </div>

    <div class="row-actions" @click.stop>
      <el-tooltip :content="favorited ? '取消收藏' : '加入收藏'" placement="top" :show-after="250">
        <button class="icon-btn" :class="{ active: favorited }" @click="onFavorite">
          <el-icon><StarFilled v-if="favorited" /><Star v-else /></el-icon>
        </button>
      </el-tooltip>

      <el-button class="btn-dark" :icon="Download" :disabled="dlBusy" @click="onInstall">
        {{ dlBusy ? `${dl.percent}%` : downloaded ? '重新下载' : '下载' }}
      </el-button>
    </div>

    <div v-if="dlBusy" class="row-progress">
      <span :style="{ width: `${dl.percent}%` }" />
    </div>
  </article>
</template>
