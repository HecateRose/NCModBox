<script setup>
import { onMounted } from 'vue'
import { initModStore } from './store/mods'

initModStore()
onMounted(() => {
  document.addEventListener('dragstart', (event) => event.preventDefault())
})
</script>

<template>
  <router-view />
</template>
