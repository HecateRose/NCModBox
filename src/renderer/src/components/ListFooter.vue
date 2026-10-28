<script setup>
import { watch } from 'vue'
import { state } from '../store/mods'

const props = defineProps({
  shown: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageCount: { type: Number, default: 1 },
  hasMore: { type: Boolean, default: false },
  loading: { type: Boolean, default: false }
})
const emit = defineEmits(['page', 'prefetch'])

let cooldown = 0

// 翻到最后一页时，提前把后面的数据取回来，页码随之变多
watch(
  () => [props.page, props.pageCount, props.hasMore, props.loading],
  () => {
    if (props.loading || !props.hasMore) return
    if (props.page < props.pageCount) return
    // 当前页还没显示完（已加载但未进入可见范围）时不预取，避免连环补数据
    if (props.shown < props.total) return
    if (Date.now() < cooldown) return
    cooldown = Date.now() + 2500
    emit('prefetch')
  },
  { immediate: true }
)

function onPageChange(value) {
  emit('page', value)
}

function setBatch(size) {
  state.limit = size
}
</script>

<template>
  <div class="list-footer">
    <div class="list-footer-info">
      <span v-if="loading" class="list-footer-loading">
        <i class="loading-dot" />
        正在加载后续条目…
      </span>
      <template v-else>
        已显示 <strong>{{ shown }}</strong> / {{ total }} 个
        <span class="list-footer-divider">·</span>
        每页
        <button class="batch-btn" :class="{ active: state.limit === 10 }" @click="setBatch(10)">10</button>
        <button class="batch-btn" :class="{ active: state.limit === 20 }" @click="setBatch(20)">20</button>
        <span v-if="!hasMore" class="list-footer-end">· 已全部加载</span>
      </template>
    </div>

    <el-pagination
      :current-page="page"
      :page-size="state.limit"
      :page-count="pageCount"
      :pager-count="5"
      layout="prev, pager, next"
      background
      @current-change="onPageChange"
    />
  </div>
</template>
