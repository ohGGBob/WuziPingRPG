/* 浮生图梦 · 天工移动外壳。
 *
 * 桌面版的页面逻辑（apps/desktop/src/renderer/app.ts）只认 window.photoShell 这一座桥。
 * 这里在手机 WebView（以及浏览器预览）里实现同一份 ShellBridge 契约：
 *   - 打开图片 / 工程：<input type="file">，由 Android 的文件选择器接管；
 *   - 导出图片 / ZIP / 工程：有 PhotoBridge（天工安装包）时分块交给原生写进相册或下载；
 *     浏览器预览里退回 a[download]；
 *   - 自定义预设：存在本页 localStorage（预设本身只是一段 JSON 文本）。
 * 页面脚本拿不到任何别的原生能力。
 *
 * 返回机制：window.PhotoMobile.back() 先关裁剪、再收起面板；都没有可关的就返回 false，
 * 由原生 finish() 回到天工首页。
 */
(function () {
  'use strict';
  const native = typeof window.PhotoBridge === 'object' && window.PhotoBridge !== null;
  const PRESET_KEY = 'photo-mobile-presets';
  const CHUNK = 192 * 1024; /* 3 的倍数，分块 base64 不会在中间补 '=' */

  function pick(accept, multiple) {
    return new Promise(function (resolve) {
      const input = document.createElement('input');
      let settled = false;
      input.type = 'file';
      input.accept = accept;
      input.multiple = !!multiple;
      input.style.display = 'none';
      function done(files) {
        if (settled) return;
        settled = true;
        window.removeEventListener('focus', onFocus);
        input.remove();
        resolve(files);
      }
      function onFocus() {
        /* 旧 WebView 取消选择时不发 cancel，回到页面一段时间后仍没文件就当取消。 */
        setTimeout(function () { if (!input.files || !input.files.length) done([]); }, 1200);
      }
      input.addEventListener('change', function () { done(Array.prototype.slice.call(input.files || [])); });
      input.addEventListener('cancel', function () { done([]); });
      document.body.appendChild(input);
      setTimeout(function () { window.addEventListener('focus', onFocus); }, 400);
      input.click();
    });
  }

  function readBytes(file) {
    return file.arrayBuffer().then(function (buf) {
      return { name: file.name, bytes: new Uint8Array(buf), path: file.name };
    });
  }

  function mimeFor(name) {
    const lower = String(name || '').toLowerCase();
    if (/\.jpe?g$/.test(lower)) return 'image/jpeg';
    if (/\.png$/.test(lower)) return 'image/png';
    if (/\.webp$/.test(lower)) return 'image/webp';
    if (/\.bmp$/.test(lower)) return 'image/bmp';
    if (/\.zip$/.test(lower)) return 'application/zip';
    if (/\.json$/.test(lower)) return 'application/json';
    return 'application/octet-stream';
  }

  function toBase64(bytes, start, end) {
    let s = '';
    const step = 0x8000;
    for (let i = start; i < end; i += step) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(end, i + step)));
    }
    return btoa(s);
  }

  function nativeSave(name, bytes) {
    const bridge = window.PhotoBridge;
    const token = bridge.begin(String(name), mimeFor(name));
    if (!token) throw new Error('无法开始写入');
    try {
      for (let at = 0; at < bytes.length; at += CHUNK) {
        if (!bridge.append(token, toBase64(bytes, at, Math.min(bytes.length, at + CHUNK)))) throw new Error('写入中断');
      }
    } catch (error) {
      bridge.abort(token);
      throw error;
    }
    const where = bridge.finish(token);
    if (!where) throw new Error('保存未完成');
    return where;
  }

  function browserSave(name, bytes) {
    const blob = new Blob([bytes], { type: mimeFor(name) });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return '下载/' + name;
  }

  function save(name, bytes) {
    return new Promise(function (resolve, reject) {
      /* 让「正在导出」的界面先画出来，再做同步的分块写入。 */
      setTimeout(function () {
        try { resolve(native ? nativeSave(name, bytes) : browserSave(name, bytes)); }
        catch (error) { reject(error); }
      }, 0);
    });
  }

  function loadPresets() {
    try {
      const raw = JSON.parse(localStorage.getItem(PRESET_KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch { return {}; }
  }

  window.photoShell = {
    platform: native ? 'android' : 'web',
    openImage: function () {
      return pick('image/*', false).then(function (files) { return files.length ? readBytes(files[0]) : null; });
    },
    openImages: function () {
      return pick('image/*', true).then(function (files) { return Promise.all(files.map(readBytes)); });
    },
    saveImage: function (defaultName, bytes) { return save(defaultName, bytes); },
    saveProject: function (defaultName, text) { return save(defaultName, new TextEncoder().encode(text)); },
    openProject: function () {
      return pick('.json,application/json,text/plain', false).then(function (files) {
        if (!files.length) return null;
        return files[0].text().then(function (text) { return { name: files[0].name, path: files[0].name, text: text }; });
      });
    },
    savePreset: function (fileName, text) {
      const all = loadPresets();
      all[String(fileName)] = String(text);
      try { localStorage.setItem(PRESET_KEY, JSON.stringify(all)); } catch { return Promise.resolve(null); }
      return Promise.resolve(fileName);
    },
    listPresets: function () {
      const all = loadPresets();
      return Promise.resolve(Object.keys(all).sort().map(function (file) { return { file: file, text: all[file] }; }));
    },
    reportSmoke: function () {}
  };

  /* ───────────── 移动布局：面板分区 + 返回 ───────────── */
  function $(id) { return document.getElementById(id); }
  function setTab(tab) {
    const panel = $('m-panel');
    if (!panel) return;
    panel.dataset.tab = tab;
    const tabs = panel.querySelectorAll('.m-tab');
    for (let i = 0; i < tabs.length; i++) {
      const on = tabs[i].dataset.tab === tab;
      tabs[i].classList.toggle('active', on);
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    panel.scrollTop = 0;
  }
  function setExpanded(open) {
    document.body.classList.toggle('m-expanded', !!open);
    const fold = $('m-fold');
    if (fold) fold.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function cropOpen() { const p = $('crop-panel'); return !!p && !p.hidden; }

  function goHome() {
    if (native && typeof window.PhotoBridge.close === 'function') { window.PhotoBridge.close(); return; }
    const from = /[?&]from=studio/.test(location.search);
    if (from) location.href = '../studio/index.html';
    else history.back();
  }

  window.PhotoMobile = {
    /** 一步返回；返回 true 表示页面自己处理了，false 表示可以关掉修图回天工。 */
    back: function () {
      if (cropOpen()) { const cancel = $('crop-cancel'); if (cancel) cancel.click(); return true; }
      if (document.body.classList.contains('m-expanded')) { setExpanded(false); return true; }
      return false;
    },
    setTab: setTab,
    state: function () {
      const panel = $('m-panel');
      return { tab: panel ? panel.dataset.tab : '', expanded: document.body.classList.contains('m-expanded'), crop: cropOpen(), native: native };
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    const exportBtn = $('btn-export');
    const slot = $('m-export-slot');
    if (exportBtn && slot) slot.appendChild(exportBtn);
    const home = $('m-home');
    if (home) home.addEventListener('click', goHome);
    const panel = $('m-panel');
    if (panel) {
      panel.addEventListener('click', function (event) {
        const tab = event.target.closest && event.target.closest('.m-tab');
        if (tab) setTab(tab.dataset.tab);
      });
    }
    const fold = $('m-fold');
    if (fold) fold.addEventListener('click', function () { setExpanded(!document.body.classList.contains('m-expanded')); });
    setTab('tone');
    /* 点「裁剪」后面板自动切到几何分区，裁剪按钮就在眼前。 */
    const crop = $('crop-panel');
    if (crop && typeof MutationObserver === 'function') {
      new MutationObserver(function () { if (!crop.hidden) setTab('geo'); }).observe(crop, { attributes: true, attributeFilter: ['hidden'] });
    }
  });
})();
