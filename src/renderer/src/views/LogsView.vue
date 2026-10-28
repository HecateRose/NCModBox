<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { collectLogs } from '../store/mods'

const loading = ref(false)
const sources = ref([])
const errorText = ref('')
const keyword = ref('')
const expanded = ref({})
const maxLines = ref(300)

const filteredSources = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return sources.value
  return sources.value
    .map((source) => ({
      ...source,
      lines: source.lines.filter((line) => String(line.text).toLowerCase().includes(query))
    }))
    .filter((source) => source.lines.length)
})

const errorCount = computed(() =>
  sources.value.reduce((sum, source) => sum + source.lines.filter((line) => line.level === 'error').length, 0)
)
const warnCount = computed(() =>
  sources.value.reduce((sum, source) => sum + source.lines.filter((line) => line.level === 'warn').length, 0)
)

async function refresh() {
  loading.value = true
  try {
    const result = await collectLogs({ maxLines: maxLines.value })
    sources.value = (result && result.sources) || []
    errorText.value = (result && result.error) || ''
    if (!errorText.value && !sources.value.length) {
      ElMessage({ message: '没有找到任何日志文件', type: 'info', duration: 2400 })
    }
  } catch (err) {
    errorText.value = (err && err.message) || '日志读取失败'
  } finally {
    loading.value = false
  }
}

function toggle(source) {
  expanded.value = { ...expanded.value, [source.path]: !expanded.value[source.path] }
}

function isOpen(source) {
  // 默认展开：有错误或警告的；其余折叠
  if (Object.prototype.hasOwnProperty.call(expanded.value, source.path)) {
    return expanded.value[source.path]
  }
  return source.lines.some((line) => line.level !== 'info')
}

function formatTime(ms) {
  if (!ms) return ''
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return ''
  }
}

onMounted(refresh)
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div class="page-head-text">
        <h2>诊断日志</h2>
        <p>
          {{ sources.length }} 个日志源 · 错误 {{ errorCount }} · 警告 {{ warnCount }} ·
          数据来自游戏目录的 r6/logs、CET、RED4ext、RedHotTools 与根目录日志
        </p>
      </div>

      <div class="page-head-tools">
        <el-input
          v-model="keyword"
          class="local-search"
          size="small"
          clearable
          placeholder="筛选日志内容…"
        />
        <el-button class="btn-ghost" :loading="loading" @click="refresh">刷新</el-button>
      </div>
    </header>

    <el-alert
      v-if="errorText"
      class="flat-alert"
      type="error"
      show-icon
      :closable="false"
      :title="errorText"
    />

    <div v-if="!sources.length && !loading" class="notice-card">
      <h3>没有找到日志</h3>
      <p>
        请确认游戏目录设置正确，并先启动一次游戏 —— 日志会在游戏运行后生成。
        常见位置：r6/logs、bin/x64/plugins/cyber_engine_tweaks/cyber_engine_tweaks.log、red4ext/logs。
      </p>
    </div>

    <div v-else class="log-sources">
      <section v-for="source in filteredSources" :key="source.path" class="panel log-panel">
        <div class="log-head" @click="toggle(source)">
          <div class="log-head-main">
            <strong>{{ source.label }}</strong>
            <span class="log-time">{{ formatTime(source.mtime) }}</span>
            <el-tag v-if="source.lines.some((line) => line.level === 'error')" size="small" type="danger" effect="plain">
              有错误
            </el-tag>
            <el-tag v-else-if="source.lines.some((line) => line.level === 'warn')" size="small" type="warning" effect="plain">
              有警告
            </el-tag>
          </div>
          <span class="log-toggle">{{ isOpen(source) ? '收起' : '展开' }}</span>
        </div>
        <p class="log-path">{{ source.path }}</p>

        <div v-if="isOpen(source)" class="log-body">
          <div
            v-for="line in source.lines"
            :key="line.n"
            class="log-line"
            :class="{
              'is-error': line.level === 'error',
              'is-warn': line.level === 'warn'
            }"
          >
            <span class="log-n">{{ line.n }}</span>
            <span class="log-text">{{ line.text }}</span>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>
