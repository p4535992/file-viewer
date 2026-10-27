// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFileViewerImageHandTool } from '../packages/core/src/features/document/imageHandTool';

const disposers: Array<() => void> = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); vi.restoreAllMocks(); });
const mount = (overflow = true, signal?: AbortSignal) => {
  const root = document.createElement('div');
  const image = document.createElement('img'); image.setAttribute('role', 'button');
  const button = document.createElement('button'); root.append(image, button); document.body.append(root);
  for (const [name, value] of Object.entries({ scrollWidth: overflow ? 1000 : 300, scrollHeight: overflow ? 800 : 200, clientWidth: 300, clientHeight: 200, offsetWidth: 300, offsetHeight: 200 }))
    Object.defineProperty(root, name, { configurable: true, value });
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, toJSON() {} });
  root.scrollLeft = 200; root.scrollTop = 150;
  const capture = vi.fn(); Object.assign(root, { setPointerCapture: capture, hasPointerCapture: () => false });
  const dispose = installFileViewerImageHandTool(root, signal); disposers.push(dispose);
  return { root, image, button, capture, dispose };
};
const pointer = (target: EventTarget, type: string, options: Record<string, unknown> = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 200, clientY: 180, buttons: type === 'pointerup' ? 0 : 1, ...options });
  for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true, ...options })) {
    if (!(key in event)) Object.defineProperty(event, key, { value });
  }
  target.dispatchEvent(event); return event;
};
describe('opt-in image mouse panning (#392)', () => {
  it('pans both axes in CSS coordinates after the movement threshold', () => {
    const { root, image, capture } = mount();
    pointer(image, 'pointerdown'); expect(capture).not.toHaveBeenCalled();
    pointer(window, 'pointermove', { clientX: 198 }); expect(root.scrollLeft).toBe(200);
    pointer(window, 'pointermove', { clientX: 100, clientY: 100 });
    expect(root.scrollLeft).toBe(250); expect(root.scrollTop).toBe(190); expect(root.style.cursor).toBe('grabbing');
    expect(capture).toHaveBeenCalledWith(1);
    pointer(window, 'pointerup'); expect(root.style.cursor).toBe('grab');
  });
  it('preserves a simple image click and captures only after dragging', () => {
    const { image, capture } = mount(); const click = vi.fn(); image.addEventListener('click', click);
    pointer(image, 'pointerdown'); pointer(window, 'pointerup');
    image.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(click).toHaveBeenCalledTimes(1); expect(capture).not.toHaveBeenCalled();
  });
  it('suppresses the drag click but preserves keyboard activation and the next real click', () => {
    const { image } = mount(); const click = vi.fn(); image.addEventListener('click', click);
    pointer(image, 'pointerdown'); pointer(window, 'pointermove', { clientX: 100 }); pointer(window, 'pointerup');
    image.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); expect(click).not.toHaveBeenCalled();
    image.click(); expect(click).toHaveBeenCalledTimes(1);
    pointer(image, 'pointerdown'); pointer(window, 'pointerup');
    image.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); expect(click).toHaveBeenCalledTimes(2);
  });
  it.each(['pointercancel', 'lostpointercapture', 'blur'])('releases drag state on %s and supports a fresh drag', event => {
    const { root, image } = mount(); pointer(image, 'pointerdown'); pointer(window, 'pointermove', { clientX: 100 });
    if (event === 'blur') window.dispatchEvent(new Event('blur')); else pointer(event === 'lostpointercapture' ? root : window, event);
    const left = root.scrollLeft; pointer(window, 'pointermove', { clientX: 0 }); expect(root.scrollLeft).toBe(left);
    expect(root.style.cursor).toBe('grab');
    pointer(image, 'pointerdown'); pointer(window, 'pointermove', { clientX: 180 }); expect(root.scrollLeft).toBe(left + 10);
  });
  it('ignores toolbar controls, modifiers, touch, nonprimary pointers and scrollbars', () => {
    const { root, image, button } = mount();
    const actions = [[button, {}], [image, { ctrlKey: true }], [image, { pointerType: 'touch' }], [image, { pointerType: 'pen' }], [image, { isPrimary: false }], [image, { button: 2 }], [root, { clientX: 602 }]] as const;
    for (const [target, options] of actions) { pointer(target, 'pointerdown', options); pointer(window, 'pointermove', { clientX: 100 }); expect(root.scrollLeft).toBe(200); }
  });
  it('does not intercept fitting images', () => {
    const { root, image, capture } = mount(false); pointer(image, 'pointerdown'); pointer(window, 'pointermove', { clientX: 100 });
    expect(root.scrollLeft).toBe(200); expect(capture).not.toHaveBeenCalled(); expect(root.dataset.viewerImageHandTool).toBe('false');
  });
  it.each(['abort', 'dispose'])('cleans listeners and styles during an active drag on %s', action => {
    const abort = new AbortController(); const { root, image, dispose } = mount(true, abort.signal);
    pointer(image, 'pointerdown'); pointer(window, 'pointermove', { clientX: 100 });
    if (action === 'abort') abort.abort(); else dispose();
    const left = root.scrollLeft; pointer(window, 'pointermove', { clientX: 0 }); expect(root.scrollLeft).toBe(left);
    expect(root.querySelector('style')).toBeNull(); expect(root.hasAttribute('data-viewer-image-panning')).toBe(false);
    expect(root.style.cursor).toBe(''); expect(root.style.userSelect).toBe(''); dispose();
  });
});
