<script setup>
import { computed, ref } from 'vue'
import ModRow from '../components/ModRow.vue'
import ListFooter from '../components/ListFooter.vue'
import FilterPanel from '../components/FilterPanel.vue'
import SettingsDialog from '../components/SettingsDialog.vue'
import {
  clearFilters,
  goToPage,
  hasNextPage,
  pageCount,
  refreshCatalog,
  state,
  tagLabel,
  toggleCategoryFilter,
  toggleTagFilter
} from '../store/mods'

const settingsOpen = ref(false)

const activeFilterCount = computed(
  () => state.selectedCategories.length + state.selectedTags.length
)

const subtitle = computed(() => {
  const parts = [`共 ${state.total} 个模组`]
  if (state.query) parts.push(`关键词「${state.query}」`)
  if (activeFilterCount.value) parts.push(`${activeFilterCount.value} 个筛选条件`)
  parts.push('数据来自 Nexus GraphQL')
  return parts.join(' · ')
})

async function onPageChange(page) {
  await goToPage(page)
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div class="page-head-text">
        <div class="page-head-title">
          <h2>全部模组</h2>
          <FilterPanel />
        </div>
        <p>{{ subtitle }}</p>
      </div>

      <div class="page-head-tools">
        <span v-for="name in state.selectedCategories" :key="`cat-${name}`" class="filter-pill">
          分类：{{ name }}
          <button class="filter-clear" @click="toggleCategoryFilter(name)">×</button>
        </span>
        <span v-for="key in state.selectedTags" :key="`tag-${key}`" class="filter-pill">
          标签：{{ tagLabel(key) }}
          <button class="filter-clear" @click="toggleTagFilter(key)">×</button>
        </span>
        <el-button v-if="activeFilterCount" class="btn-ghost" @click="clearFilters">清除筛选</el-button>

        <span v-if="state.query" class="filter-pill">
          搜索：{{ state.query }}
          <button class="filter-clear" @click="state.query = ''">×</button>
        </span>
      </div>
    </header>

    <el-skeleton v-if="state.loading && !state.items.length" :rows="8" animated class="content-skeleton" />

    <div v-else-if="state.error && !state.items.length" class="notice-card">
      <h3>数据加载失败</h3>
      <p>{{ state.error }}</p>
      <div class="notice-actions">
        <el-button class="btn-dark" @click="refreshCatalog()">重试</el-button>
        <el-button class="btn-ghost" @click="settingsOpen = true">检查 API Key</el-button>
      </div>
    </div>

    <template v-else>
      <div class="mod-list">
        <ModRow v-for="mod in state.items" :key="mod.id" :mod="mod" />
      </div>

      <el-empty
        v-if="!state.items.length"
        :description="state.query ? `没有找到与「${state.query}」相关的模组` : '没有找到匹配的模组'"
        :image-size="88"
      >
        <el-button v-if="activeFilterCount" class="btn-ghost" @click="clearFilters">清除筛选</el-button>
        <el-button v-if="state.query" class="btn-ghost" @click="state.query = ''">清空关键词</el-button>
      </el-empty>

      <ListFooter
        v-if="state.total"
        :shown="state.items.length"
        :total="state.total"
        :page="state.page"
        :page-count="pageCount"
        :has-more="hasNextPage"
        :loading="state.loading"
        @page="onPageChange"
      />
    </template>

    <SettingsDialog v-model="settingsOpen" />
  </section>
</template>
