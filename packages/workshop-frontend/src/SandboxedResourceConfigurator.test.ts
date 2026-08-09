// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { applyForwardedConfiguratorScroll } from './SandboxedResourceConfigurator'

describe('configurator scroll forwarding', () => {
  it('applies a forwarded iframe delta to the host scroller immediately', () => {
    const target = document.createElement('div')
    const scrollBy = vi.fn<(options: ScrollToOptions) => void>()
    Object.defineProperties(target, {
      clientHeight: { value: 300 },
      scrollHeight: { value: 900 },
      scrollBy: { value: scrollBy },
    })

    applyForwardedConfiguratorScroll(target, 4, 36)

    expect(scrollBy).toHaveBeenCalledOnce()
    expect(scrollBy).toHaveBeenCalledWith({ left: 4, top: 36 })
  })

  it('does not scroll a host that has no overflow', () => {
    const target = document.createElement('div')
    const scrollBy = vi.fn<(options: ScrollToOptions) => void>()
    Object.defineProperties(target, {
      clientHeight: { value: 300 },
      scrollHeight: { value: 300 },
      scrollBy: { value: scrollBy },
    })

    applyForwardedConfiguratorScroll(target, 0, 36)

    expect(scrollBy).not.toHaveBeenCalled()
  })
})
