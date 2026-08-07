import packageJson from '../package.json' with { type: 'json' }
import { getChangeLog, spawnWithoutLog } from './utils.mjs'

const version = packageJson.version

const repository = process.env.GITHUB_REPOSITORY || 'EricDasha/dmMiniPlayer'
const repositoryUrl = `https://github.com/${repository}`
const url = `${repositoryUrl}/blob/main/docs/changeLog`

async function main() {
  const tags = (await spawnWithoutLog('git', ['tag', '--sort=-creatordate']))
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter(Boolean)
  const currentTag = `v${version}`
  const preVersion = tags.find((tag) => tag !== currentTag)

  console.log(getChangeLog(version) || 'Small update')
  console.log(`[More](${url}.md#${version.replaceAll('.', '')})`)
  console.log('')
  console.log('### ---')
  console.log(getChangeLog(version, 'zh') || '小更新')
  console.log(`[More](${url}-zh.md#${version.replaceAll('.', '')})`)
  console.log('')
  if (preVersion) {
    console.log(
      `Full commits: [${preVersion}...${currentTag}](${repositoryUrl}/compare/${preVersion}...${currentTag})`,
    )
  }
}
main()
