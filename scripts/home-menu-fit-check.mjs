/**
 * Measures the outer home menu fixture at key viewports.
 * Uses Playwright Chromium for real layout (happy-dom cannot).
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const css = readFileSync(resolve(root, 'src/index.css'), 'utf8')
const supportCss = readFileSync(resolve(root, 'src/styles/support.css'), 'utf8')

const html = `<!DOCTYPE html>
<html lang="ka">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<style>
${css}
${supportCss}
html, body { margin: 0; height: 100%; background: #0b1426; color: #f8fafc; }
</style>
</head>
<body>
  <div class="page home-page home-page--tablet" id="home">
    <header class="home-header">
      <div class="app-brand" style="display:flex;align-items:center;gap:0.75rem">
        <div class="app-brand__logo home-logo" style="background:#14b8a6;border-radius:8px;flex:0 0 auto"></div>
        <div class="app-brand__text home-brand-text">
          <p class="app-brand__name home-brand">CityRoute</p>
          <p class="app-brand__city home-city">თელავი</p>
        </div>
      </div>
    </header>
    <div class="route-list" data-testid="home-route-list">
      ${[1, 2, 3, 4]
        .map(
          (n) => `
      <a class="route-card route-card--${n}" href="#">
        <div class="route-card__content">
          <strong class="route-card__name">მარშრუტი ${n}</strong>
          <div class="route-card__tags"><span class="tag tag--category">🚗 B კატეგორია</span></div>
        </div>
        <span class="chevron">→</span>
      </a>`,
        )
        .join('')}
      <a class="route-card route-card--5" href="#">
        <div class="route-card__content">
          <strong class="route-card__name">C, D კატეგორია</strong>
          <div class="route-card__tags"><span class="tag tag--category">🚛🚌 C+D კატეგორია</span></div>
        </div>
        <span class="chevron">→</span>
      </a>
    </div>
    <footer class="home-footer">
      <p class="muted home-meta">აქტიური · მანქანა 1 · ლოკალური</p>
      <a class="support-button" href="#">დახმარება / Support</a>
      <button type="button" class="home-signout">გასვლა</button>
      <p class="support-footer">დახმარება - მხარდაჭერა: support@cityroute.ge</p>
    </footer>
  </div>
  <script>
    window.__measure = () => {
      const home = document.getElementById('home')
      const vh = window.innerHeight
      const vw = window.innerWidth
      const homeRect = home.getBoundingClientRect()
      const cards = [...document.querySelectorAll('.route-card')].map((el) => {
        const r = el.getBoundingClientRect()
        return {
          top: r.top,
          bottom: r.bottom,
          height: r.height,
          clippedTop: r.top < 0,
          clippedBottom: r.bottom > vh + 0.5,
          clippedRight: r.right > vw + 0.5,
        }
      })
      const footerEls = [
        ...document.querySelectorAll('.home-meta, .support-button, .home-signout, .support-footer'),
      ].map((el) => {
        const r = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        return {
          cls: el.className,
          top: r.top,
          bottom: r.bottom,
          height: r.height,
          display: style.display,
          clippedTop: r.top < 0,
          clippedBottom: r.bottom > vh + 0.5,
          clippedRight: r.right > vw + 0.5,
          hidden: style.display === 'none' || style.visibility === 'hidden',
        }
      })
      const brand = document.querySelector('.home-header').getBoundingClientRect()
      const overflowY = home.scrollHeight > home.clientHeight + 1
      const docOverflowY = document.documentElement.scrollHeight > vh + 1
      const needsHScroll =
        document.documentElement.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1
      const help = document.querySelector('.support-button')
      const exitBtn = document.querySelector('.home-signout')
      const helpRect = help?.getBoundingClientRect()
      const exitRect = exitBtn?.getBoundingClientRect()
      return {
        viewport: { vw, vh },
        home: { height: homeRect.height, scrollHeight: home.scrollHeight, clientHeight: home.clientHeight },
        brandBottom: brand.bottom,
        overflowY,
        docOverflowY,
        needsHScroll,
        cards,
        footerEls,
        helpVisible: !!helpRect && helpRect.height > 0 && helpRect.bottom <= vh + 0.5 && helpRect.top >= -0.5,
        exitVisible: !!exitRect && exitRect.height > 0 && exitRect.bottom <= vh + 0.5 && exitRect.top >= -0.5,
        ok:
          !overflowY &&
          !docOverflowY &&
          !needsHScroll &&
          document.documentElement.scrollHeight <= vh + 1 &&
          helpRect &&
          exitRect &&
          helpRect.height > 0 &&
          exitRect.height > 0 &&
          helpRect.bottom <= vh + 0.5 &&
          exitRect.bottom <= vh + 0.5 &&
          cards.every((c) => !c.clippedTop && !c.clippedBottom && !c.clippedRight && c.height > 0) &&
          footerEls
            .filter((f) => !f.hidden)
            .every((f) => !f.clippedTop && !f.clippedBottom && !f.clippedRight && f.height > 0),
      }
    }
  </script>
</body>
</html>`

const viewports = [
  { name: '1024x600', width: 1024, height: 600 },
  { name: '800x480', width: 800, height: 480 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '390x844', width: 390, height: 844 },
  { name: '390x700', width: 390, height: 700 },
  // Browser chrome approximations (fullscreen minus system/browser UI)
  { name: '1024x600-browser', width: 1024, height: 528 },
  { name: '800x480-browser', width: 800, height: 424 },
]

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.setContent(html, { waitUntil: 'load' })

let failed = 0
for (const vp of viewports) {
  await page.setViewportSize({ width: vp.width, height: vp.height })
  // trigger orientation media via matchMedia is based on viewport in Chromium
  const result = await page.evaluate(() => window.__measure())
  const status = result.ok ? 'PASS' : 'FAIL'
  if (!result.ok) failed += 1
  console.log(`\n[${status}] ${vp.name} ${vp.width}x${vp.height}`)
  console.log(
    JSON.stringify(
      {
        overflowY: result.overflowY,
        needsHScroll: result.needsHScroll,
        homeScroll: `${result.home.scrollHeight}/${result.home.clientHeight}`,
        cards: result.cards.map((c) => Math.round(c.height)),
        footer: result.footerEls.map((f) => ({
          cls: f.cls.split(' ')[0],
          h: Math.round(f.height),
          hidden: f.hidden,
          clipped: f.clippedBottom || f.clippedTop,
        })),
      },
      null,
      2,
    ),
  )
}

await browser.close()
if (failed) {
  console.error(`\n${failed} viewport(s) failed`)
  process.exit(1)
}
console.log('\nAll viewports PASS')
