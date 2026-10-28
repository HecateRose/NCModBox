<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { launchGame, state, stopGame } from '../store/mods'

const route = useRoute()

const navItems = computed(() => [
  { to: '/browse', label: '浏览', icon: 'Grid', count: state.total },
  { to: '/favorites', label: '收藏', icon: 'Star', count: state.favorites.length },
  { to: '/history', label: '已下载', icon: 'Files', count: state.historyFiles.length },
  { to: '/installed', label: '包体记录', icon: 'Box', count: state.downloads.length },
  { to: '/deploy', label: '部署', icon: 'Upload', count: state.deploy.deployed.length },
  { to: '/logs', label: '诊断日志', icon: 'Document', count: 0 }
])

async function onLaunch() {
  if (state.deploy.running) {
    try {
      await ElMessageBox.confirm(
        '强制结束 Cyberpunk 2077 进程？未保存的游戏进度会丢失。',
        '停止游戏',
        { confirmButtonText: '结束进程', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return
    }
    const result = await stopGame()
    ElMessage({
      message: result.ok ? '已结束游戏进程' : result.error || '结束进程失败',
      type: result.ok ? 'success' : 'error',
      duration: 2200
    })
    return
  }

  const result = await launchGame()
  ElMessage({
    message: result.ok ? '游戏启动中…' : result.error || '启动失败',
    type: result.ok ? 'success' : 'error',
    duration: 2200
  })
}

function isActive(path) {
  return route.path === path
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">NC</div>
      <div class="brand-text">
        <strong>NightCity</strong>
        <span>MODBOX</span>
      </div>
    </div>

    <nav class="nav-block">
      <p class="nav-label">资料库</p>
      <router-link
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="nav-item"
        :class="{ active: isActive(item.to) }"
      >
        <el-icon class="nav-icon"><component :is="item.icon" /></el-icon>
        <span class="nav-text">{{ item.label }}</span>
        <em class="nav-count">{{ item.count }}</em>
      </router-link>
    </nav>

    <nav class="nav-block nav-block--game">
      <p class="nav-label">游戏</p>
      <button class="nav-item nav-button" @click="onLaunch">
        <el-icon class="nav-icon"><component is="VideoPlay" /></el-icon>
        <span class="nav-text">{{ state.deploy.running ? '停止游戏' : '启动游戏' }}</span>
        <em v-if="state.deploy.running" class="nav-count">运行中</em>
      </button>
      <div class="game-state">
        <span class="game-dot" :class="{ 'is-on': state.deploy.running }" />
        {{ state.deploy.running ? '游戏运行中 · 部署已锁定' : '游戏未运行' }}
      </div>
    </nav>

    <div class="sidebar-foot">
      <div class="foot-row">
        <span>包体记录</span>
        <strong>{{ state.downloads.length }} 个</strong>
      </div>
      <div class="foot-row">
        <span>已部署文件</span>
        <strong>{{ state.deploy.deployed.length }} 个</strong>
      </div>
      <div class="foot-bar">
        <span
          class="foot-bar-fill"
          :style="{
            width: `${state.deploy.deployed.length ? Math.min(100, (state.deploy.deployed.length / Math.max(1, state.downloads.length)) * 100) : 0}%`
          }"
        />
      </div>
      <p class="foot-note">Nexus 数据源已连接</p>
    </div>
  </aside>
</template>
