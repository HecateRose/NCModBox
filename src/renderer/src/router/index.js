import { createRouter, createWebHashHistory } from 'vue-router'
import MainLayout from '../views/MainLayout.vue'
import BrowseView from '../views/BrowseView.vue'
import FavoritesView from '../views/FavoritesView.vue'
import InstalledView from '../views/InstalledView.vue'
import HistoryView from '../views/HistoryView.vue'
import DeployView from '../views/DeployView.vue'
import LogsView from '../views/LogsView.vue'
import ModDetailView from '../views/ModDetailView.vue'

const routes = [
  {
    path: '/',
    component: MainLayout,
    children: [
      { path: '', redirect: '/browse' },
      {
        path: 'browse',
        name: 'browse',
        component: BrowseView,
        meta: { title: '浏览', subtitle: '夜之城模组库 · 点击条目在新窗口查看详情' }
      },
      {
        path: 'favorites',
        name: 'favorites',
        component: FavoritesView,
        meta: { title: '收藏', subtitle: '你标记过的模组，随时准备装机' }
      },
      {
        path: 'history',
        name: 'history',
        component: HistoryView,
        meta: { title: '已下载', subtitle: '下载文件夹里真实保存的包体文件，可解压进 staging 后部署' }
      },
      {
        path: 'installed',
        name: 'installed',
        component: InstalledView,
        meta: { title: '包体记录', subtitle: '包体记录：绑定压缩包 → 解压 staging → 部署进游戏目录' }
      },
      {
        path: 'deploy',
        name: 'deploy',
        component: DeployView,
        meta: { title: '部署', subtitle: '硬链接部署、modlist 排序与外部变更检测' }
      },
      {
        path: 'logs',
        name: 'logs',
        component: LogsView,
        meta: { title: '诊断日志', subtitle: '游戏、redscript、CET、RED4ext 与 RHT 日志聚合，高亮错误与警告' }
      }
    ]
  },
  { path: '/mod/:id', name: 'mod', component: ModDetailView },
  { path: '/:pathMatch(.*)*', redirect: '/browse' }
]

export default createRouter({
  history: createWebHashHistory(),
  routes
})
