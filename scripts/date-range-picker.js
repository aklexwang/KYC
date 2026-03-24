/**
 * 기간 조회: 단일 트리거 + 팝업 달력(시작·끝 두 번 클릭)
 * 마크업: .drp-wrap > input#from(hidden) + input#to(hidden) + button.drp-trigger
 * data-drp-from / data-drp-to 로 hidden id 지정
 */
(function (global) {
  'use strict';

  var PLACEHOLDER = '연도-월-일 ~ 연도-월-일';
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var cssInjected = false;
  var popEl = null;
  var activeInst = null;
  var viewYear = 0;
  var viewMonth = 0;
  var anchorDate = null;

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function isoLocal(d) {
    if (!d || isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseIsoLocal(s) {
    if (!s || typeof s !== 'string') return null;
    var p = s.trim().split('-');
    if (p.length !== 3) return null;
    var y = parseInt(p[0], 10);
    var m = parseInt(p[1], 10) - 1;
    var d = parseInt(p[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return new Date(y, m, d);
  }

  function injectCss() {
    if (cssInjected) return;
    cssInjected = true;
    var st = document.createElement('style');
    st.textContent =
      '.drp-wrap{display:inline-flex;align-items:center;vertical-align:middle;max-width:100%;}' +
      '.drp-trigger{display:inline-flex;align-items:center;gap:10px;min-height:40px;padding:8px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.22);background:#0f1d4c;color:#f1f5f9;font-size:14px;font-family:inherit;cursor:pointer;text-align:left;max-width:100%;}' +
      '.drp-trigger:hover{filter:brightness(1.06);}' +
      '.drp-icon{flex-shrink:0;display:flex;width:20px;height:20px;opacity:0.9;}' +
      '.drp-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.drp-popover{position:fixed;z-index:10050;background:#fff;color:#0f172a;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,0.22);padding:12px 14px 14px;min-width:280px;}' +
      '.drp-pop-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}' +
      '.drp-nav-prev,.drp-nav-next{width:36px;height:36px;border:none;border-radius:8px;background:#f1f5f9;cursor:pointer;font-size:18px;line-height:1;color:#0f172a;}' +
      '.drp-nav-prev:hover,.drp-nav-next:hover{background:#e2e8f0;}' +
      '.drp-month-title{font-weight:700;font-size:15px;}' +
      '.drp-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px;font-size:11px;color:#64748b;text-align:center;}' +
      '.drp-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;}' +
      '.drp-cell{aspect-ratio:1;min-height:32px;display:flex;align-items:center;justify-content:center;border:none;border-radius:999px;background:transparent;font-size:13px;cursor:pointer;font-family:inherit;padding:0;color:#0f172a;}' +
      '.drp-cell:hover{background:#f1f5f9;}' +
      '.drp-cell--muted{color:#cbd5e1;cursor:default;}' +
      '.drp-cell--muted:hover{background:transparent;}' +
      '.drp-cell--today{box-shadow:inset 0 0 0 1.5px #3b82f6;}' +
      '.drp-cell--anchor,.drp-cell--in-range{background:#e0f2fe;color:#0369a1;}' +
      '.drp-cell--start,.drp-cell--end{background:#3b82f6;color:#fff;font-weight:700;}' +
      '.drp-cell--start.drp-cell--end{background:#3b82f6;}';
    document.head.appendChild(st);
  }

  function ensurePopover() {
    if (popEl) return popEl;
    injectCss();
    popEl = document.createElement('div');
    popEl.className = 'drp-popover';
    popEl.setAttribute('role', 'dialog');
    popEl.setAttribute('aria-label', '기간 선택');
    popEl.style.display = 'none';
    popEl.innerHTML =
      '<div class="drp-pop-head">' +
      '<button type="button" class="drp-nav-prev" aria-label="이전 달">‹</button>' +
      '<div class="drp-month-title drp-month-label"></div>' +
      '<button type="button" class="drp-nav-next" aria-label="다음 달">›</button>' +
      '</div>' +
      '<div class="drp-dow">' +
      DOW.map(function (d) {
        return '<span>' + d + '</span>';
      }).join('') +
      '</div>' +
      '<div class="drp-grid drp-grid-body"></div>';
    document.body.appendChild(popEl);

    popEl.querySelector('.drp-nav-prev').addEventListener('click', function (e) {
      e.stopPropagation();
      if (viewMonth <= 0) {
        viewMonth = 11;
        viewYear--;
      } else viewMonth--;
      renderCalendar();
    });
    popEl.querySelector('.drp-nav-next').addEventListener('click', function (e) {
      e.stopPropagation();
      if (viewMonth >= 11) {
        viewMonth = 0;
        viewYear++;
      } else viewMonth++;
      renderCalendar();
    });
    popEl.addEventListener('click', function (e) {
      e.stopPropagation();
    });
    return popEl;
  }

  function closePopover() {
    if (popEl) popEl.style.display = 'none';
    if (activeInst && activeInst.trigger) {
      activeInst.trigger.setAttribute('aria-expanded', 'false');
    }
    activeInst = null;
    anchorDate = null;
  }

  function positionPopover(trigger) {
    if (!popEl || !trigger) return;
    var rect = trigger.getBoundingClientRect();
    var w = 300;
    var left = rect.left;
    if (left + w > document.documentElement.clientWidth - 8) {
      left = document.documentElement.clientWidth - w - 8;
    }
    if (left < 8) left = 8;
    var top = rect.bottom + 6;
    popEl.style.position = 'fixed';
    popEl.style.left = left + 'px';
    popEl.style.top = top + 'px';
    popEl.style.display = 'block';
  }

  function renderCalendar() {
    if (!popEl || !activeInst) return;
    var label = popEl.querySelector('.drp-month-label');
    label.textContent = viewYear + '년 ' + (viewMonth + 1) + '월';
    var grid = popEl.querySelector('.drp-grid-body');
    grid.innerHTML = '';

    var first = new Date(viewYear, viewMonth, 1);
    var startPad = first.getDay();
    var dim = new Date(viewYear, viewMonth + 1, 0).getDate();
    var prevDim = new Date(viewYear, viewMonth, 0).getDate();

    var cells = [];
    var i;
    for (i = 0; i < startPad; i++) {
      var pd = prevDim - startPad + i + 1;
      cells.push({ d: new Date(viewYear, viewMonth - 1, pd), muted: true });
    }
    for (i = 1; i <= dim; i++) {
      cells.push({ d: new Date(viewYear, viewMonth, i), muted: false });
    }
    var tail = 42 - cells.length;
    for (i = 1; i <= tail; i++) {
      cells.push({ d: new Date(viewYear, viewMonth + 1, i), muted: true });
    }

    var today = new Date();
    var tKey = isoLocal(today);

    var aKey = anchorDate ? isoLocal(anchorDate) : '';

    cells.forEach(function (c) {
      var key = isoLocal(c.d);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'drp-cell';
      btn.textContent = String(c.d.getDate());
      if (c.muted) btn.classList.add('drp-cell--muted');
      if (!c.muted && key === tKey) btn.classList.add('drp-cell--today');
      if (!c.muted && aKey && key === aKey) btn.classList.add('drp-cell--anchor');
      if (!c.muted) {
        btn.addEventListener('click', function () {
          onPickDay(c.d);
        });
      } else {
        btn.disabled = true;
      }
      grid.appendChild(btn);
    });
  }

  function onPickDay(d) {
    if (!activeInst) return;
    var key = isoLocal(d);
    if (!anchorDate) {
      anchorDate = d;
      renderCalendar();
      return;
    }
    var k0 = isoLocal(anchorDate);
    var k1 = key;
    var fromStr = k0 <= k1 ? k0 : k1;
    var toStr = k0 <= k1 ? k1 : k0;
    activeInst.fromEl.value = fromStr;
    activeInst.toEl.value = toStr;
    updateInstanceLabel(activeInst);
    try {
      activeInst.fromEl.dispatchEvent(new Event('change', { bubbles: true }));
      activeInst.toEl.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {}
    closePopover();
  }

  function updateInstanceLabel(inst) {
    var ph = inst.wrap.getAttribute('data-drp-placeholder') || PLACEHOLDER;
    var f = inst.fromEl.value ? String(inst.fromEl.value).trim() : '';
    var t = inst.toEl.value ? String(inst.toEl.value).trim() : '';
    if (f && t) {
      inst.labelEl.textContent = f + ' ~ ' + t;
    } else if (f || t) {
      inst.labelEl.textContent = (f || '—') + ' ~ ' + (t || '—');
    } else {
      inst.labelEl.textContent = ph;
    }
  }

  function openInstance(inst) {
    ensurePopover();
    activeInst = inst;
    anchorDate = null;
    inst.trigger.setAttribute('aria-expanded', 'true');

    var f = inst.fromEl.value ? parseIsoLocal(inst.fromEl.value) : null;
    var t = inst.toEl.value ? parseIsoLocal(inst.toEl.value) : null;
    var ref = f || t || new Date();
    viewYear = ref.getFullYear();
    viewMonth = ref.getMonth();

    renderCalendar();
    positionPopover(inst.trigger);
  }

  function initWrap(wrap) {
    if (wrap.dataset.drpInit) return;
    var fromId = wrap.getAttribute('data-drp-from');
    var toId = wrap.getAttribute('data-drp-to');
    if (!fromId || !toId) return;
    var fromEl = document.getElementById(fromId);
    var toEl = document.getElementById(toId);
    if (!fromEl || !toEl) return;
    if (fromEl.type !== 'hidden') {
      fromEl.type = 'hidden';
    }
    if (toEl.type !== 'hidden') {
      toEl.type = 'hidden';
    }

    var trigger = wrap.querySelector('.drp-trigger');
    var labelEl = wrap.querySelector('.drp-label');
    if (!trigger || !labelEl) return;

    wrap.dataset.drpInit = '1';
    var inst = { wrap: wrap, fromEl: fromEl, toEl: toEl, trigger: trigger, labelEl: labelEl };
    wrap._drpInstance = inst;

    updateInstanceLabel(inst);

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (activeInst === inst && popEl && popEl.style.display === 'block') {
        closePopover();
        return;
      }
      openInstance(inst);
    });
  }

  function onDocClick(e) {
    if (!popEl || popEl.style.display === 'none') return;
    if (e.target.closest && e.target.closest('.drp-popover')) return;
    if (e.target.closest && e.target.closest('.drp-trigger')) return;
    closePopover();
  }

  function onDocKey(e) {
    if (e.key === 'Escape') closePopover();
  }

  function initAll() {
    injectCss();
    document.querySelectorAll('.drp-wrap').forEach(initWrap);
    if (!document.body.dataset.drpDocBound) {
      document.body.dataset.drpDocBound = '1';
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onDocKey);
    }
  }

  function refreshAll() {
    document.querySelectorAll('.drp-wrap').forEach(function (w) {
      if (w._drpInstance) updateInstanceLabel(w._drpInstance);
    });
  }

  global.DateRangePicker = {
    initAll: initAll,
    refreshAll: refreshAll,
  };
})(typeof window !== 'undefined' ? window : this);
