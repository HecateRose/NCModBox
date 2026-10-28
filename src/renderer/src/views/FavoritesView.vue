<script setup>
import { ElMessage } from 'element-plus'
import ModRow from '../components/ModRow.vue'
import ListFooter from '../components/ListFooter.vue'
import { resolveMod, state, toggleFavorite, useLocalPager } from '../store/mods'

const { shown, total, page, pageCount, goToPage } = useLocalPager('favorites')

async function clearAll() {
  const ids = [...state.favorites]
  for (const id of ids) {
    const mod = resolveMod(id)
    if (mod) await toggleFavorite(mod)
  }
  ElMessage({ message: '收藏已清空', type: 'info', duration: 1500 })
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div class="page-head-text">
        <h2>我的收藏</h2>
        <p>共 {{ total }} 个模组 · 收藏会保存在本地，跨窗口同步</p>
      </div>

      <div class="page-head-tools">
        <el-popconfirm
          v-if="state.favorites.length"
          title="确定清空全部收藏？"
          confirm-button-text="清空"
          cancel-button-text="取消"
          width="220"
          @confirm="clearAll"
        >
          <template #reference>
            <el-button class="btn-ghost">清空收藏</el-button>
          </template>
        </el-popconfirm>
      </div>
    </header>

    <div class="mod-list">
      <ModRow v-for="mod in shown" :key="mod.id" :mod="mod" />
    </div>

    <el-empty v-if="!total" description="还没有收藏任何模组" :image-size="88">
      <el-button class="btn-dark" @click="$router.push('/browse')">去浏览页看看</el-button>
    </el-empty>

    <ListFooter
      v-if="total"
      :shown="shown.length"
      :total="total"
      :page="page"
      :page-count="pageCount"
      :has-more="page < pageCount"
      :loading="false"
      @page="goToPage"
    />
  </section>
</template>
