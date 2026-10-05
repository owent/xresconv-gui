/**
 *  Embedded 1.4.0 uses el.click, omitting the pointer events required by React Aria labels.
 * The external driver retains native input. Embedded checks exercise renderer callbacks,
 * not OS input/Gatekeeper; keep the selection assertions identical for both providers.
 */
export async function clickCheckboxLabel(browser, label) {
  if (process.env.XRESCONV_E2E_DRIVER_PROVIDER !== 'embedded') return label.click();
  await browser.execute((el) => {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    const options = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, detail: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...options, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...options, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...options, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...options, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...options, buttons: 0 }));
  }, label);
}

export async function selectValue(browser, select, value) {
  if (process.env.XRESCONV_E2E_DRIVER_PROVIDER !== 'embedded') {
    return select.selectByAttribute('value', value);
  }
  // Embedded 1.4.0 only calls option.click(), which does not select it or emit change.
  // Exercise the same renderer callback; native option input stays with external drivers.
  await browser.execute((el, nextValue) => {
    if (el.tagName !== 'SELECT' || el.multiple || el.disabled) {
      throw new Error('Expected an enabled single select');
    }
    const option = Array.from(el.options).find((item) => item.value === nextValue);
    if (!option || option.disabled || option.parentElement?.disabled) {
      throw new Error(`Enabled option not found: ${nextValue}`);
    }
    el.focus();
    if (el.value === nextValue) return;
    el.value = nextValue;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, select, value);
}
