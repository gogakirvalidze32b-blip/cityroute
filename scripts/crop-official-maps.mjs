import sharp from 'sharp'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { rename, unlink } from 'fs/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const assetsDir = 'C:/Users/User/.cursor/projects/c-Users-User-Desktop-cityroute/assets'
const routesDir = join(__dirname, '../public/routes')

const MAPS = [
  {
    filename: 'route-4-official-map.png',
    asset: 'c__Users_User_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_image-f1990eca-f9e2-4ee0-817c-00df32aefbeb.png',
  },
  {
    filename: 'route-5-official-map.png',
    asset: 'c__Users_User_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_image-af830c66-e1aa-46e2-afa2-1311b8a47414.png',
  },
]

function rowMetrics(data, width, channels, y) {
  let varSum = 0
  let bright = 0
  const lumas = []
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    lumas.push(luma)
    if (luma > 249.5) bright++
  }
  const mean = lumas.reduce((a, b) => a + b, 0) / width
  for (const l of lumas) varSum += (l - mean) ** 2
  return { mean, variance: varSum / width, bright }
}

function isPureWhiteBar(metrics, width) {
  return metrics.variance < 8 && metrics.mean > 253.5 && metrics.bright > width * 0.98
}

function detectWhiteBarCrop(data, width, height, channels) {
  const row = (y) => rowMetrics(data, width, channels, y)

  let top = 0
  while (top < height) {
    if (isPureWhiteBar(row(top), width)) {
      top++
      continue
    }
    if (top + 1 < height && isPureWhiteBar(row(top + 1), width)) {
      top++
      continue
    }
    break
  }

  let bottom = height - 1
  while (bottom > top && isPureWhiteBar(row(bottom), width)) bottom--

  return { top, cropHeight: bottom - top + 1, width, height }
}

async function restoreAndTrim({ filename, asset }) {
  const sourcePath = join(assetsDir, asset)
  const outputPath = join(routesDir, filename)
  const tempPath = `${outputPath}.tmp`

  const { data, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const bounds = detectWhiteBarCrop(data, info.width, info.height, info.channels)

  await sharp(sourcePath)
    .extract({
      left: 0,
      top: bounds.top,
      width: bounds.width,
      height: bounds.cropHeight,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(tempPath)

  await unlink(outputPath).catch(() => undefined)
  await rename(tempPath, outputPath)

  console.log(
    `${filename}: ${bounds.width}x${bounds.height} -> ${bounds.width}x${bounds.cropHeight} (top -${bounds.top}, bottom -${bounds.height - bounds.top - bounds.cropHeight})`,
  )

  return { width: bounds.width, height: bounds.cropHeight }
}

const results = {}
for (const map of MAPS) {
  results[map.filename] = await restoreAndTrim(map)
}

console.log(JSON.stringify(results, null, 2))
