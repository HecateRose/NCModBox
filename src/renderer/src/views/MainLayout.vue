<script setup>
import { ref } from 'vue'
import { Bottom, Top } from '@element-plus/icons-vue'
import AppSidebar from '../components/AppSidebar.vue'
import AppTopbar from '../components/AppTopbar.vue'
import { state } from '../store/mods'

const contentRef = ref(null)

function jumpTo(edge) {
  const el = contentRef.value
  if (!el) return
  el.scrollTo({ top: edge === 'bottom' ? el.scrollHeight : 0, behavior: 'smooth' })
}
</script>

<template>
  <div class="app-shell">
    <AppSidebar />

    <div class="app-main">
      <AppTopbar />

      <main ref="contentRef" class="app-content">
        <div class="content-inner">
          <el-skeleton v-if="!state.ready" :rows="8" animated class="content-skeleton" />
          <router-view v-else v-slot="{ Component }">
            <transition name="page" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </div>
      </main>

      <div class="scroll-jump">
        <el-tooltip content="回到顶部" placement="left" :show-after="300">
          <button class="jump-btn" @click="jumpTo('top')">
            <el-icon><Top /></el-icon>
          </button>
        </el-tooltip>
        <el-tooltip content="跳到底部" placement="left" :show-after="300">
          <button class="jump-btn" @click="jumpTo('bottom')">
            <el-icon><Bottom /></el-icon>
          </button>
        </el-tooltip>
      </div>
    </div>
  </div>
</template>
