/**
 * Bottom sheet for the phone layout.
 *
 * The panel snaps to three heights – peek, half and full – and can be dragged
 * with a thumb. Dragging starts on the handle, the place bar and the tab row;
 * inside the scrolling content it only starts when the list is already at the
 * top and the gesture pulls downwards, so scrolling never fights the sheet.
 *
 * On wide screens the sheet is inert: the panel is a normal sidebar.
 */

const SNAPS = ['peek', 'half', 'full'];
const PEEK_VISIBLE_PX = 186;   // handle + place bar + tabs + a hint of content
const DRAG_THRESHOLD_PX = 6;

export function createBottomSheet(panel, { handle, media = '(max-width: 900px)', onSnap } = {}) {
  const mq = window.matchMedia(media);
  const landscapeDock = window.matchMedia('(max-width: 900px) and (orientation: landscape) and (max-height: 520px)');
  let snap = 'peek';
  let drag = null;
  let suppressClick = false;   // a drag ends with a click; that must not also cycle

  const offsetFor = (name) => {
    const height = panel.getBoundingClientRect().height || 1;
    if (name === 'full') return 0;
    if (name === 'half') return height * 0.46;
    return Math.max(0, height - PEEK_VISIBLE_PX);
  };

  const isActive = () => mq.matches && !landscapeDock.matches;

  function apply(name, { silent = false } = {}) {
    snap = name;
    panel.dataset.snap = name;
    document.body.dataset.sheet = isActive() ? name : 'off';
    handle?.setAttribute('aria-expanded', String(name !== 'peek'));

    if (!isActive()) {
      panel.style.removeProperty('--sheet-offset');
      document.documentElement.style.setProperty('--sheet-visible', '0px');
      return;
    }
    panel.style.setProperty('--sheet-offset', `${offsetFor(name)}px`);
    // Map controls and the attribution ride above the sheet.
    document.documentElement.style.setProperty('--sheet-visible', `${visibleHeight()}px`);
    if (!silent) onSnap?.(name, visibleHeight());
  }

  /** How much of the viewport the sheet currently covers, in pixels. */
  function visibleHeight() {
    if (!isActive()) return 0;
    const height = panel.getBoundingClientRect().height || 0;
    return Math.max(0, height - offsetFor(snap));
  }

  function setSnap(name) {
    if (!SNAPS.includes(name)) return;
    apply(name);
  }

  function expand() {
    if (snap === 'peek') apply('half');
  }

  /* ----------------------------------------------------------- dragging */

  function canStartFrom(target, pointerType) {
    if (!isActive()) return false;
    if (handle?.contains(target)) return true;
    if (target.closest('.place-bar, .tabs')) return true;
    const view = target.closest('.view');
    // Touch inside the scrolling list is handled by the touch listeners below,
    // because the browser claims that gesture before pointermove ever fires.
    if (view) return pointerType === 'touch' ? false : { view };
    return false;
  }

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    const from = canStartFrom(event.target, event.pointerType);
    if (!from) return;

    try {
      panel.setPointerCapture(event.pointerId);
    } catch {
      /* capture is an optimisation, not a requirement */
    }
    drag = {
      startY: event.clientY,
      startOffset: offsetFor(snap),
      pointerId: event.pointerId,
      view: from.view || null,
      active: from === true,
    };
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const delta = event.clientY - drag.startY;

    if (!drag.active) {
      // Inside the scrolling list: only take over a downward pull at the top.
      if (Math.abs(delta) < DRAG_THRESHOLD_PX) return;
      const atTop = (drag.view?.scrollTop ?? 0) <= 1;
      if (!(atTop && delta > 0)) {
        drag = null;
        return;
      }
      drag.active = true;
      drag.startY = event.clientY;
    }

    const height = panel.getBoundingClientRect().height || 1;
    const next = Math.min(Math.max(drag.startOffset + delta, 0), height - PEEK_VISIBLE_PX);
    panel.classList.add('is-dragging');
    document.body.classList.add('sheet-dragging');
    panel.style.setProperty('--sheet-offset', `${next}px`);
    const height2 = panel.getBoundingClientRect().height || 0;
    document.documentElement.style.setProperty('--sheet-visible', `${Math.max(0, height2 - next)}px`);
    drag.lastOffset = next;
    drag.moved = true;
    if (event.cancelable) event.preventDefault();
  }

  function onPointerUp() {
    if (!drag) return;
    const wasDragging = drag.active && drag.moved;
    const offset = drag.lastOffset;
    drag = null;
    panel.classList.remove('is-dragging');
    document.body.classList.remove('sheet-dragging');

    if (!wasDragging) {
      apply(snap, { silent: true });
      return;
    }
    suppressClick = true;
    // Snap to whichever stop the sheet was released nearest to.
    const nearest = SNAPS.reduce((best, name) =>
      Math.abs(offsetFor(name) - offset) < Math.abs(offsetFor(best) - offset) ? name : best, snap);
    apply(nearest);
  }

  /* ------------------------------------------- touch inside the content */

  /**
   * With `touch-action: pan-y` the scroller owns a vertical swipe, so the only
   * way to hand a downward pull at the top over to the sheet is to claim it in
   * a non-passive touchmove before scrolling starts.
   */
  let touchDrag = null;

  function onTouchStart(event) {
    if (!isActive() || event.touches.length !== 1) return;
    const view = event.target.closest?.('.view');
    if (!view) return;
    touchDrag = {
      view,
      startY: event.touches[0].clientY,
      startOffset: offsetFor(snap),
      taken: false,
    };
  }

  function onTouchMove(event) {
    if (!touchDrag || event.touches.length !== 1) return;
    const delta = event.touches[0].clientY - touchDrag.startY;

    if (!touchDrag.taken) {
      if (Math.abs(delta) < DRAG_THRESHOLD_PX) return;
      // Anything but a downward pull from the very top belongs to the scroller.
      if (delta <= 0 || touchDrag.view.scrollTop > 1) {
        touchDrag = null;
        return;
      }
      touchDrag.taken = true;
      touchDrag.startY = event.touches[0].clientY;
      panel.classList.add('is-dragging');
      document.body.classList.add('sheet-dragging');
      return;
    }

    if (event.cancelable) event.preventDefault();
    const height = panel.getBoundingClientRect().height || 1;
    const next = Math.min(Math.max(touchDrag.startOffset + delta, 0), height - PEEK_VISIBLE_PX);
    panel.style.setProperty('--sheet-offset', `${next}px`);
    document.documentElement.style.setProperty('--sheet-visible', `${Math.max(0, height - next)}px`);
    touchDrag.lastOffset = next;
  }

  function onTouchEnd() {
    if (!touchDrag) return;
    const { taken, lastOffset } = touchDrag;
    touchDrag = null;
    panel.classList.remove('is-dragging');
    document.body.classList.remove('sheet-dragging');
    if (!taken || lastOffset === undefined) return;

    const nearest = SNAPS.reduce((best, name) =>
      Math.abs(offsetFor(name) - lastOffset) < Math.abs(offsetFor(best) - lastOffset) ? name : best, snap);
    apply(nearest);
  }

  panel.addEventListener('touchstart', onTouchStart, { passive: true });
  panel.addEventListener('touchmove', onTouchMove, { passive: false });
  panel.addEventListener('touchend', onTouchEnd);
  panel.addEventListener('touchcancel', onTouchEnd);

  panel.addEventListener('pointerdown', onPointerDown);
  panel.addEventListener('pointermove', onPointerMove, { passive: false });
  panel.addEventListener('pointerup', onPointerUp);
  panel.addEventListener('pointercancel', onPointerUp);

  // Tapping the handle cycles peek → half → full → peek.
  handle?.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (!isActive()) return;
    const order = { peek: 'half', half: 'full', full: 'peek' };
    apply(order[snap] || 'half');
  });
  handle?.addEventListener('keydown', (event) => {
    const step = { ArrowUp: 1, ArrowDown: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = Math.min(Math.max(SNAPS.indexOf(snap) + step, 0), SNAPS.length - 1);
    apply(SNAPS[index]);
  });

  const refresh = () => apply(snap, { silent: true });
  mq.addEventListener('change', refresh);
  landscapeDock.addEventListener('change', refresh);
  window.addEventListener('resize', refresh);
  window.addEventListener('orientationchange', refresh);

  apply('peek', { silent: true });

  return {
    setSnap,
    expand,
    get snap() { return snap; },
    get isMobile() { return isActive(); },
    visibleHeight,
    refresh,
  };
}
