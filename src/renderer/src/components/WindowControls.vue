<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { bridge } from '../api/bridge'

const maximized = ref(false)
let off = null

onMounted(async () => {
  maximized.value = await bridge.isMaximized()
  off = bridge.onMaximized((value) => {
    maximized.value = value
  })
})

onBeforeUnmount(() => {
  if (typeof off === 'function') off()
})
</script>

<template>
  <div class="win-controls">
    <button class="win-btn" title="最小化" @click="bridge.minimize()">
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" /></svg>
    </button>
    <button class="win-btn" :title="maximized ? '还原' : '最大化'" @click="bridge.toggleMaximize()">
      <svg v-if="!maximized" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" /></svg>
      <svg v-else viewBox="0 0 12 12" aria-hidden="true">
        <rect x="2" y="4" width="6" height="6" />
        <path d="M4 4V2h6v6H8" />
      </svg>
    </button>
    <button class="win-btn win-btn-close" title="关闭" @click="bridge.closeWindow()">
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>
    </button>
  </div>
</template>
