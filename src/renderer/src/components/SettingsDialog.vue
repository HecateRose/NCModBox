<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ChatDotRound, FolderOpened } from '@element-plus/icons-vue'
import { bridge } from '../api/bridge'
import { pickDirectory, savePaths } from '../store/mods'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const downloadDir = ref('')
const localStatus = ref({ ready: false, downloaded: false, loading: false, progress: 0, error: '' })

async function refreshTranslateStatus() {
  try {
    localStatus.value = await bridge.translateStatus()
  } catch {
    /* ignore */
  }
}

watch(visible, async (open) => {
  if (!open) return
  try {
    const paths = await bridge.getPaths()
    downloadDir.value = paths.downloadPath || ''
  } catch {
    downloadDir.value = ''
  }
  await refreshTranslateStatus()
})

async function onPickDownloadDir() {
  const dir = await pickDirectory()
  if (!dir) return
  const paths = await savePaths({ downloadPath: dir })
  downloadDir.value = (paths && paths.downloadPath) || dir
  ElMessage.success('下载目录已更新')
}

async function onResetDownloadDir() {
  const paths = await savePaths({ downloadPath: '' })
  downloadDir.value = (paths && paths.downloadPath) || ''
  ElMessage.success('已恢复默认下载目录（用户数据目录 / mod-packages）')
}

async function onPrepareModel() {
  let timer = null
  try {
    timer = setInterval(refreshTranslateStatus, 2000)
    const result = await bridge.prepareTranslateModel()
    if (result && result.status) localStatus.value = result.status
    if (result && result.ok) {
      ElMessage.success('本地翻译模型已就绪（离线可用）')
    } else {
      ElMessage({ message: (result && result.error) || '模型加载失败', type: 'error', duration: 4200 })
    }
  } catch (err) {
    ElMessage({ message: (err && err.message) || '模型加载失败', type: 'error', duration: 4200 })
  } finally {
    if (timer) clearInterval(timer)
    await refreshTranslateStatus()
  }
}

async function onClearModel() {
  try {
    const result = await bridge.clearTranslateModel()
    await refreshTranslateStatus()
    if (result && result.ok) ElMessage.success('已清除本地模型缓存')
    else ElMessage({ message: (result && result.error) || '清除失败', type: 'error', duration: 3600 })
  } catch (err) {
    ElMessage({ message: (err && err.message) || '清除失败', type: 'error', duration: 3600 })
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="设置" width="560px" append-to-body align-center>
    <div class="settings-block">
      <div class="settings-head">
        <el-icon><FolderOpened /></el-icon>
        <span>Mod 下载目录</span>
      </div>
      <p class="settings-hint">
        从 Nexus 下载的压缩包会保存在这里。默认在用户数据目录（通常在 C 盘），可以改到空间更大的磁盘。
        修改后只影响新下载，已有包体仍按记录里的原路径识别。
      </p>
      <div class="settings-status">
        <span>当前目录</span>
        <strong v-if="downloadDir">{{ downloadDir }}</strong>
        <strong v-else class="is-empty">默认（用户数据目录 / mod-packages）</strong>
      </div>
      <div class="settings-actions">
        <el-button class="btn-ghost" :icon="FolderOpened" @click="onPickDownloadDir">选择目录</el-button>
        <el-button v-if="downloadDir" class="btn-ghost" @click="onResetDownloadDir">恢复默认</el-button>
      </div>
    </div>

    <div class="settings-block">
      <div class="settings-head">
        <el-icon><ChatDotRound /></el-icon>
        <span>翻译引擎</span>
      </div>
      <p class="settings-hint">
        翻译为纯本地离线：默认英中专用小模型（opus-mt，约 75MB，单句 0.3–0.7 秒）；
        非中文目标语言会按需使用 NLLB 多语言模型。模型缓存位于用户数据目录的 models 文件夹，不依赖在线服务。
      </p>
      <div class="settings-status">
        <span>本地模型</span>
        <strong v-if="localStatus.ready">已就绪（离线可用）</strong>
        <strong v-else-if="localStatus.loading">加载中 {{ localStatus.progress }}%（快速英中模型）</strong>
        <strong v-else-if="localStatus.error" class="is-empty">加载失败：{{ localStatus.error }}</strong>
        <strong v-else-if="localStatus.downloaded">已下载（首次翻译时自动加载）</strong>
        <strong v-else class="is-empty">未下载（翻译前会自动下载约 75MB）</strong>
      </div>
      <div class="settings-actions">
        <el-button class="btn-ghost" :loading="localStatus.loading" @click="onPrepareModel">
          下载 / 加载模型
        </el-button>
        <el-button v-if="localStatus.ready || localStatus.error" class="btn-ghost" @click="onClearModel">
          清除模型缓存
        </el-button>
      </div>
    </div>

    <template #footer>
      <el-button class="btn-ghost" @click="visible = false">取消</el-button>
      <el-button class="btn-dark" :loading="saving" @click="onSave">保存并刷新</el-button>
    </template>
  </el-dialog>
</template>
