import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function verifyZoomToolbarBrowser({ browser, baseUrl, engine }) {
  const directory = resolve('output/zoom-toolbar-browser', engine)
  await mkdir(directory, { recursive: true })
  const report = {
    engine,
    browser: browser.version(),
    cases: [],
    externalRequests: [],
    pageErrors: [],
    passed: false
  }
  const pages = []
  const within = async (promise, label) => {
    let timer
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 15000)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const open = async (path) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
    pages.push(page)
    page.on('pageerror', (error) => report.pageErrors.push(error.message))
    await page.route('**/*', (route) => {
      const url = route.request().url()
      if (url.startsWith(baseUrl + '/') || /^(?:blob:|data:)/.test(url)) return route.continue()
      report.externalRequests.push(url)
      return route.abort()
    })
    await page.goto(baseUrl + path, { waitUntil: 'domcontentloaded' })
    return page
  }
  const frames = (page) =>
    page.evaluate(
      () =>
        new Promise((resolveFrame) =>
          requestAnimationFrame(() => requestAnimationFrame(resolveFrame))
        )
    )
  const imageReady = async (page) => {
    const image = page.locator('.image-viewer img').first()
    await image.waitFor({ state: 'visible' })
    await image.evaluate((image) => image.decode())
    return image
  }
  try {
    for (const integration of ['web', 'vue']) {
      const page = await open(
        integration === 'web'
          ? '/custom-element.html?url=/example/pic.png'
          : '/vue3.html?smoke=zoom-boundary&url=/example/pic.png'
      )
      await imageReady(page)
      const group = page
        .locator(integration === 'web' ? '.file-viewer-web-toolbar-group' : '.viewer-zoom-actions')
        .first()
      const plus =
        integration === 'web'
          ? group.locator('button').filter({ hasText: /^\+$/ })
          : group.locator('[part~="zoom-in-button"]')
      const minus =
        integration === 'web'
          ? group.locator('button').filter({ hasText: /^-$/ })
          : group.locator('[part~="zoom-out-button"]')
      const reset =
        integration === 'web'
          ? group.locator('button').filter({ hasText: /^1:1$/ })
          : group.locator('[part~="zoom-reset-button"]')
      const meter = group.locator(
        integration === 'web' ? '.file-viewer-web-zoom-meter' : '.viewer-zoom-meter'
      )
      await plus.waitFor({ state: 'visible' })
      await frames(page)
      const originalLabel = await meter.textContent()
      assert.equal(
        await reset.count(),
        1,
        `${integration}: reset slot must exist before the first zoom`
      )
      assert.equal(await reset.isDisabled(), true)
      const origin = { plus: await plus.boundingBox(), minus: await minus.boundingBox() }
      assert.ok(origin.plus && origin.minus)
      for (let click = 0; click < 48; click += 1)
        await page.mouse.click(
          origin.plus.x + origin.plus.width / 2,
          origin.plus.y + origin.plus.height / 2
        )
      await frames(page)
      assert.equal(await plus.isVisible(), true)
      assert.equal(
        await plus.isDisabled(),
        true,
        `${integration}: repeated fixed-position clicks must remain at maximum zoom`
      )
      assert.equal((await meter.textContent()).trim(), '500%')
      assert.deepEqual(
        await plus.boundingBox(),
        origin.plus,
        `${integration}: zoom-in position changed`
      )
      await page.screenshot({ path: `${directory}/${integration}-maximum.png` })
      for (let click = 0; click < 48; click += 1)
        await page.mouse.click(
          origin.minus.x + origin.minus.width / 2,
          origin.minus.y + origin.minus.height / 2
        )
      await frames(page)
      assert.equal(await minus.isVisible(), true)
      assert.equal(
        await minus.isDisabled(),
        true,
        `${integration}: minimum zoom button must stay disabled in place`
      )
      assert.deepEqual(
        await minus.boundingBox(),
        origin.minus,
        `${integration}: zoom-out position changed`
      )
      await page.screenshot({ path: `${directory}/${integration}-minimum.png` })
      await reset.click()
      await frames(page)
      assert.equal(await meter.textContent(), originalLabel)
      report.cases.push({
        integration,
        name: 'fixed-position rapid clicks at both limits and reset',
        passed: true
      })

      if (integration === 'web') {
        await page.evaluate(() => {
          const element = document.getElementById('custom-element-viewer')
          element.options = {
            ...element.options,
            toolbar: { position: 'bottom-right', items: { 'zoom-reset': false } }
          }
        })
        await reset.waitFor({ state: 'detached' })
        assert.equal(await plus.isVisible(), true)
        assert.equal(await minus.isVisible(), true)
        assert.equal(await meter.evaluate((element) => element.tagName), 'SPAN')
        report.cases.push({
          integration,
          name: 'hide reset with existing items policy',
          passed: true
        })

        let releaseOld
        let oldRequested
        const requested = new Promise((resolveRequest) => {
          oldRequested = resolveRequest
        })
        const released = new Promise((resolveRelease) => {
          releaseOld = resolveRelease
        })
        let settleOld
        const oldSettled = new Promise((resolveOld) => {
          settleOld = resolveOld
        })
        await page.route('**/delayed398.svg', async (route) => {
          oldRequested()
          await released
          try {
            await route.fulfill({
              contentType: 'image/svg+xml',
              body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>'
            })
          } catch (error) {
            // The old request may already have been aborted by the new load.
            assert.match(String(error), /abort|closed|handled|invalid|cancel/i)
          } finally {
            settleOld()
          }
        })
        const width = await page
          .locator('.image-viewer img')
          .first()
          .evaluate((image) => {
            image.dataset.github398Old = 'true'
            return image.naturalWidth
          })
        assert.ok(width > 2)
        await page.evaluate(() => {
          const element = document.getElementById('custom-element-viewer')
          element.filename = 'delayed398.svg'
          element.src = '/delayed398.svg'
        })
        await within(requested, 'old source request')
        await page.evaluate(() => {
          const element = document.getElementById('custom-element-viewer')
          element.filename = 'pic.png'
          element.src = '/example/pic.png'
        })
        const replacement = page.locator('.image-viewer img:not([data-github398-old])').first()
        await replacement.waitFor({ state: 'visible' })
        await replacement.evaluate((image) => image.decode())
        assert.equal(await replacement.evaluate((image) => image.naturalWidth), width)
        await replacement.evaluate((image) => {
          image.dataset.github398New = 'true'
        })
        releaseOld()
        await within(oldSettled, 'old source cancellation or response')
        await frames(page)
        assert.equal(
          await page
            .locator('.image-viewer img')
            .first()
            .evaluate((image) => image.naturalWidth),
          width
        )
        assert.equal(
          await page.locator('.image-viewer img').first().getAttribute('data-github398-new'),
          'true'
        )
        assert.equal(await plus.isVisible(), true)
        report.cases.push({
          integration,
          name: 'cancel old source and ignore its delayed response',
          passed: true
        })
      }
    }
    const hiddenReset = await open('/vue3.html?smoke=zoom-reset-hidden&url=/example/pic.png')
    await imageReady(hiddenReset)
    assert.equal(await hiddenReset.locator('[part~="zoom-reset-button"]').count(), 0)
    assert.equal(
      await hiddenReset.locator('.viewer-zoom-meter').evaluate((element) => element.tagName),
      'SPAN'
    )
    assert.equal(await hiddenReset.locator('[part~="zoom-in-button"]').isVisible(), true)
    report.cases.push({
      integration: 'vue',
      name: 'hide reset with existing items policy',
      passed: true
    })

    const denied = await open('/vue3.html?smoke=zoom-in-denied&url=/example/pic.png')
    await imageReady(denied)
    assert.equal(await denied.locator('[part~="zoom-in-button"]').count(), 0)
    assert.equal(await denied.locator('[part~="zoom-out-button"]').isVisible(), true)
    report.cases.push({
      integration: 'vue',
      name: 'preserve explicit zoom permission hiding',
      passed: true
    })

    const pdf = await open('/vue3.html?smoke=zoom-pdf-hidden&url=/example/pdf.pdf')
    await pdf
      .locator('.pdfViewer .page canvas')
      .first()
      .waitFor({ state: 'visible', timeout: 60000 })
    assert.equal(await pdf.locator('.pdf-toolbar-group--zoom').count(), 0)
    assert.equal(await pdf.locator('.pdf-toolbar').isVisible(), true)
    assert.equal(await pdf.locator('.pdf-toolbar-group--rotate button').count(), 2)
    await pdf.locator('.pdf-toolbar-group--rotate button').last().click()
    await pdf.locator('.pdf-rotation-meter').filter({ hasText: '90°' }).waitFor()
    const total = Number(
      (await pdf.locator('.pdf-page-meter').textContent()).split('/').at(-1)?.trim()
    )
    assert.ok(total > 0)
    if (total > 1) {
      await pdf.locator('.pdf-toolbar-group').first().locator('button').last().click()
      await pdf.locator('.pdf-page-meter strong').filter({ hasText: /^2$/ }).waitFor()
    }
    await pdf.screenshot({ path: `${directory}/pdf-zoom-hidden.png` })
    report.cases.push({
      integration: 'vue/pdf',
      name: 'zoom-only hiding preserves working navigation and rotation',
      pages: total,
      passed: true
    })
    assert.deepEqual(report.externalRequests, [])
    assert.deepEqual(report.pageErrors, [])
    report.passed = true
    console.log(
      `[verify-zoom-toolbar-browser] ${engine}: ${report.cases.length} real UI cases passed.`
    )
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error)
    throw error
  } finally {
    await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n')
    await Promise.all(pages.map((page) => page.close()))
  }
}
