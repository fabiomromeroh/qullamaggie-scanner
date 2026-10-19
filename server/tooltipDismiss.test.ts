import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dismissDelay, TOOLTIP_HIDE_MS, type TipReason } from '../src/lib/tooltipDismiss.ts'

const reasons: TipReason[] = ['hover', 'focus', 'tap']

test('hide grace is at most ~100ms', () => {
  assert.ok(TOOLTIP_HIDE_MS > 0 && TOOLTIP_HIDE_MS <= 100)
})

test('mouse leaving hides hover, focus (click-focused) and tap tips', () => {
  for (const reason of reasons) {
    assert.equal(dismissDelay(reason, { kind: 'leave', pointerType: 'mouse' }), TOOLTIP_HIDE_MS)
    assert.equal(dismissDelay(reason, { kind: 'move-outside', pointerType: 'mouse' }), TOOLTIP_HIDE_MS)
  }
})

test('scroll, blur, Escape and detached trigger hide immediately for every reason', () => {
  for (const reason of reasons) {
    for (const kind of ['scroll', 'blur', 'escape', 'detached'] as const) {
      assert.equal(dismissDelay(reason, { kind }), 0, `${reason}/${kind}`)
    }
  }
})

test('touch tap tips are not closed by synthetic leave events', () => {
  assert.equal(dismissDelay('tap', { kind: 'leave', pointerType: 'touch' }), null)
  assert.equal(dismissDelay('tap', { kind: 'move-outside', pointerType: 'pen' }), null)
  assert.equal(dismissDelay('hover', { kind: 'leave', pointerType: 'touch' }), TOOLTIP_HIDE_MS)
})
