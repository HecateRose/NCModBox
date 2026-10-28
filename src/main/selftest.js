/**
 * 部署器自检（仅开发用）：MODBOX_DEPLOY_TEST=1 时在临时目录跑一遍
 * import → classify → deploy → modlist → 外部变更 → undeploy
 */
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import {
  buildPlan,
  detectExternalChanges,
  importFolder,
  loadStaging,
  readManifest,
  removeStaged,
  deploy,
  launchGame,
  setDeployOrder,
  stagingRoot,
  undeploy
} from './deployer'

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

export function runDeploySelfTest() {
  const root = path.join(app.getPath('temp'), 'modbox-deploy-test')
  const game = path.join(root, 'game')
  const src = path.join(root, 'src', 'TestArchive')
  const report = []
  const log = (line) => report.push(line)

  try {
    fs.rmSync(root, { recursive: true, force: true })
    fs.mkdirSync(path.join(game, 'archive', 'pc', 'mod'), { recursive: true })
    fs.mkdirSync(path.join(game, 'bin', 'x64'), { recursive: true })
    write(path.join(src, 'TestArchive.archive'), 'archive-bytes')
    write(path.join(src, 'data', 'TestExtra.xl'), 'xl-bytes')
    write(path.join(game, 'bin', 'x64', 'Cyberpunk2077.exe'), 'stub')

    const record = importFolder(src)
    log(`classify: types=${record.types.join('+')} unclassified=${record.unclassified}`)

    const staging = loadStaging()
    const plan = buildPlan(staging, game)
    log(`plan: entries=${plan.entries.length} errors=${plan.errors.length}`)

    const result = deploy(game, stagingRoot())
    log(`deploy: ok=${result.ok} added=${result.added ? result.added.length : 0}`)
    if (!result.ok) log(`deploy errors: ${(result.errors || []).join(' | ')}`)

    const archiveTarget = path.join(game, 'archive', 'pc', 'mod', 'TestArchive.archive')
    const stagingFile = path.join(record.dir, 'TestArchive.archive')
    const linked = fs.existsSync(archiveTarget)
      ? fs.statSync(archiveTarget).ino === fs.statSync(stagingFile).ino
      : false
    log(`hardlink: exists=${fs.existsSync(archiveTarget)} sameInode=${linked}`)

    const modlist = fs.readFileSync(path.join(game, 'archive', 'pc', 'mod', 'modlist.txt'), 'utf8')
    log(`modlist: ${JSON.stringify(modlist)}`)

    // 模拟外部把链接替换成普通文件
    const tmp = `${archiveTarget}.tmp`
    fs.copyFileSync(archiveTarget, tmp)
    fs.unlinkSync(archiveTarget)
    fs.renameSync(tmp, archiveTarget)
    const changes = detectExternalChanges(game)
    log(`external changes: ${JSON.stringify(changes.map((item) => item.type))}`)

    const blocked = deploy(game, stagingRoot())
    log(`redeploy blocked: ${!blocked.ok}`)

    const undo = undeploy(game)
    log(`undeploy: removed=${undo.removed.length} skipped=${undo.skipped.length}`)
    log(`archive still exists (external file kept): ${fs.existsSync(archiveTarget)}`)
    log(`staging file intact: ${fs.existsSync(stagingFile)}`)
    log(`manifest entries after undo: ${readManifest().entries.length}`)

    removeStaged(record.id)

    /* ---------- 第二阶段：REDmod 复制部署 + redMod.exe 校验 ---------- */
    const src2 = path.join(root, 'src', 'TestRedmod')
    write(
      path.join(src2, 'info.json'),
      JSON.stringify({ name: 'TestRedmod', version: '1.0.0', description: 'selftest' })
    )
    write(path.join(src2, 'archives', 'TestRedmod.archive'), 'redmod-archive')

    const redRecord = importFolder(src2)
    log(`redmod classify: types=${redRecord.types.join('+')} unclassified=${redRecord.unclassified}`)

    const redDeploy = deploy(game, stagingRoot())
    log(`redmod deploy: ok=${redDeploy.ok} added=${redDeploy.added ? redDeploy.added.length : 0}`)

    const copied = path.join(game, 'mods', 'testredmod', 'archives', 'TestRedmod.archive')
    const copiedExists = fs.existsSync(copied)
    const isCopy = copiedExists
      ? fs.statSync(copied).ino !== fs.statSync(path.join(redRecord.dir, 'archives', 'TestRedmod.archive')).ino
      : false
    log(`redmod copied: exists=${copiedExists} isCopy(not hardlink)=${isCopy}`)
    log(`redmod status: ok=${redDeploy.redmod && redDeploy.redmod.ok} error=${redDeploy.redmod && redDeploy.redmod.error}`)

    const launch = launchGame(game)
    log(`launch blocked by redmod failure: ${!launch.ok} (${launch.error || ''})`)

    const redUndo = undeploy(game)
    log(`redmod undeploy: removed=${redUndo.removed.length}`)
    log(`redmod copy removed: ${!fs.existsSync(copied)}`)

    removeStaged(redRecord.id)

    /* ---------- 排序：modlist.txt 按用户顺序重写 ---------- */
    const s1 = path.join(root, 'src', 'AlphaMod')
    const s2 = path.join(root, 'src', 'BetaMod')
    write(path.join(s1, 'Alpha.archive'), 'alpha')
    write(path.join(s2, 'Beta.archive'), 'beta')
    const r1 = importFolder(s1)
    const r2 = importFolder(s2)
    deploy(game, stagingRoot())
    const modlistFile = path.join(game, 'archive', 'pc', 'mod', 'modlist.txt')
    log(`order before: ${JSON.stringify(fs.readFileSync(modlistFile, 'utf8').split('\\n'))}`)
    setDeployOrder({ kind: 'legacy', order: ['Beta.archive', 'Alpha.archive'], gamePath: game })
    log(`order after: ${JSON.stringify(fs.readFileSync(modlistFile, 'utf8').split('\\n'))}`)
    undeploy(game)
    removeStaged(r1.id)
    removeStaged(r2.id)
  } catch (err) {
    log(`ERROR: ${err && err.stack}`)
  } finally {
    try {
      fs.writeFileSync(path.join(app.getPath('userData'), 'deploy-selftest.log'), report.join('\n'), 'utf8')
    } catch {
      /* ignore */
    }
  }
}
