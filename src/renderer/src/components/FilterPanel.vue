<script setup>
import { computed } from 'vue'
import { ArrowDown, Filter } from '@element-plus/icons-vue'
import {
  categoryOptions,
  clearFilters,
  ensureTranslations,
  state,
  tagOptions,
  toggleCategoryFilter,
  toggleTagFilter,
  tr
} from '../store/mods'

const activeCount = computed(() => state.selectedCategories.length + state.selectedTags.length)
const hasFilter = computed(() => activeCount.value > 0)

/** 展开面板时按需翻译分类与标签（开启翻译时） */
function onShow() {
  if (!state.showTranslation) return
  ensureTranslations([
    ...categoryOptions.value.map((item) => item.name),
    ...tagOptions.value.slice(0, 40).map((item) => item.name)
  ])
}
</script>

<template>
  <el-popover
    placement="bottom-start"
    :width="380"
    trigger="click"
    popper-class="filter-popover"
    :show-arrow="false"
    @show="onShow"
  >
    <template #reference>
      <button class="filter-trigger" :class="{ 'is-active': hasFilter }">
        <el-icon><Filter /></el-icon>
        <span>分类 · 标签</span>
        <em v-if="activeCount" class="filter-badge">{{ activeCount }}</em>
        <el-icon class="filter-caret"><ArrowDown /></el-icon>
      </button>
    </template>

    <div class="filter-panel">
      <p class="filter-scope">
        分类与标签由 Nexus 服务端筛选，作用于全部 <strong>{{ state.total }}</strong> 个模组
      </p>

      <section class="filter-group">
        <header>
          <span>分类</span>
          <em>{{ categoryOptions.length ? `${state.selectedCategories.length} / ${categoryOptions.length}` : '—' }}</em>
        </header>
        <div class="filter-options">
          <button
            v-for="option in categoryOptions"
            :key="option.name"
            class="filter-option"
            :class="{ active: state.selectedCategories.includes(option.name) }"
            @click="toggleCategoryFilter(option.name)"
          >
            <span class="filter-option-label">{{ tr(option.name) }}</span>
            <em>{{ option.count }}</em>
          </button>
          <p v-if="!categoryOptions.length" class="filter-empty">分类聚合暂不可用，点顶栏刷新可重试。</p>
        </div>
      </section>

      <section class="filter-group">
        <header>
          <span>标签</span>
          <em>{{ state.selectedTags.length }} / {{ tagOptions.length }}</em>
        </header>
        <div class="filter-options filter-options--scroll">
          <button
            v-for="option in tagOptions"
            :key="option.name"
            class="filter-option"
            :class="{ active: state.selectedTags.includes(option.name) }"
            @click="toggleTagFilter(option.name)"
          >
            <span class="filter-option-label">{{ tr(option.name) }}</span>
            <em>{{ option.count }}</em>
          </button>
          <p v-if="!tagOptions.length" class="filter-empty">标签聚合暂不可用，点顶栏刷新可重试。</p>
        </div>
      </section>

      <footer class="filter-foot">
        <span>同组多选为「同时满足」</span>
        <el-button class="btn-ghost" :disabled="!hasFilter" @click="clearFilters">清除筛选</el-button>
      </footer>
    </div>
  </el-popover>
</template>
