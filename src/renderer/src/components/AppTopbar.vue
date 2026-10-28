<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Loading, Refresh, Search, Setting } from '@element-plus/icons-vue'
import WindowControls from './WindowControls.vue'
import SettingsDialog from './SettingsDialog.vue'
import { openNexusLogin, refreshCatalog, searchNow, state, toggleTranslation } from '../store/mods'

const route = useRoute()
const router = useRouter()
const settingsOpen = ref(false)

const title = computed(() => route.meta.title || 'NightCity Modbox')
const subtitle = computed(() => route.meta.subtitle || '赛博朋克 2077 模组包管理器')

async function onRefresh() {
  await refreshCatalog()
}

function onSearch() {
  router.push('/browse')
  searchNow()
}

async function onTranslate() {
  await toggleTranslation()
  if (state.showTranslation && state.translateReason) {
    ElMessage({ message: `翻译失败：${state.translateReason}`, type: 'warning', duration: 6000 })
  }
}

async function onLogin() {
  if (state.auth.loggedIn) {
    ElMessage({ message: 'Nexus 已登录', type: 'success', duration: 1500 })
    return
  }
  await openNexusLogin()
  if (state.auth.loggedIn) {
    ElMessage({ message: 'Nexus 登录成功，现在可以直接点「下载」', type: 'success', duration: 3000 })
  } else {
    ElMessage({ message: '尚未检测到登录，可关闭窗口后重试', type: 'info', duration: 3000 })
  }
}
</script>

<template>
  <header class="topbar">
    <div class="topbar-title">
      <h1>{{ title }}</h1>
      <p>{{ subtitle }}</p>
    </div>

    <div class="topbar-search">
      <el-input
        v-model="state.query"
        :prefix-icon="Search"
        placeholder="搜索（回车向 Nexus 查询）"
        clearable
        @keyup.enter="onSearch"
      />
      <el-button class="btn-dark search-submit" :loading="state.loading" @click="onSearch">
        搜索
      </el-button>
    </div>

    <div class="topbar-tools">
      <el-tooltip content="刷新数据" placement="bottom" :show-after="300">
        <button class="icon-btn" @click="onRefresh">
          <el-icon :class="{ 'is-spinning': state.loading }"><Refresh /></el-icon>
        </button>
      </el-tooltip>

      <el-select v-model="state.sort" class="sort-select" placeholder="排序">
        <el-option label="热度优先" value="popular" />
        <el-option label="最近更新" value="recent" />
        <el-option label="名称 A-Z" value="name" />
      </el-select>

      <el-tooltip
        :content="state.showTranslation ? '显示英文原文' : '翻译简介、分类与标签'"
        placement="bottom"
        :show-after="300"
      >
        <button
          class="icon-btn tr-btn"
          :class="{ 'is-active': state.showTranslation }"
          @click="onTranslate"
        >
          <el-icon v-if="state.translationPending" class="is-spinning"><Loading /></el-icon>
          <span v-else class="tr-mark">{{ state.showTranslation ? '中' : 'A' }}</span>
        </button>
      </el-tooltip>

      <el-tooltip
        :content="state.auth.loggedIn ? 'Nexus 已登录' : '登录 Nexus（真实下载需要）'"
        placement="bottom"
        :show-after="300"
      >
        <button
          class="icon-btn auth-btn"
          :class="{ 'is-active': state.auth.loggedIn }"
          @click="onLogin"
        >
          <el-icon v-if="state.auth.checking" class="is-spinning"><Loading /></el-icon>
          <span v-else class="tr-mark">{{ state.auth.loggedIn ? '已登录' : '登录' }}</span>
        </button>
      </el-tooltip>

      <el-tooltip content="数据源设置" placement="bottom" :show-after="300">
        <button class="icon-btn" @click="settingsOpen = true">
          <el-icon><Setting /></el-icon>
        </button>
      </el-tooltip>

      <WindowControls />
    </div>

    <SettingsDialog v-model="settingsOpen" />
  </header>
</template>
