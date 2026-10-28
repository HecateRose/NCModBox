import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIcons from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import './assets/styles.css'

const app = createApp(App)

Object.entries(ElementPlusIcons).forEach(([name, component]) => {
  app.component(name, component)
})

app.use(ElementPlus, { locale: zhCn })
app.use(router)
app.mount('#app')
