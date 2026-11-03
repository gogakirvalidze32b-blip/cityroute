import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const scrollCss = readFileSync(resolve(process.cwd(), 'src/styles/cr-scroll.css'), 'utf8')
const subscriptionCss = readFileSync(
  resolve(process.cwd(), 'src/pages/subscription-page.css'),
  'utf8',
)

describe('opt-in responsive page scrolling', () => {
  it('uses a page-local scroll container with touch scrolling', () => {
    expect(scrollCss).toContain('.cr-scroll-page.cr-scroll-page')
    expect(scrollCss).toContain('overflow-y: auto')
    expect(scrollCss).toContain('-webkit-overflow-scrolling: touch')
  })

  it('keeps global root and unmarked page rules out of the utility stylesheet', () => {
    expect(scrollCss).not.toMatch(/(^|\})\s*(html|body|#root|\.page)\s*\{/m)
    expect(scrollCss).toContain('.page.center.cr-scroll-page')
  })

  it('styles only marked pages with the themed thin scrollbar', () => {
    expect(scrollCss).toContain('.cr-scroll-page::-webkit-scrollbar')
    expect(scrollCss).toContain('scrollbar-width: thin')
  })

  it('uses one column on short landscape subscription layouts', () => {
    expect(subscriptionCss).toMatch(
      /@media\s*\(orientation:\s*landscape\)\s*and\s*\(max-height:\s*560px\)[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    )
  })
})
