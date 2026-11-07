/* ES5 prelude: runs before app.js so a WebView that cannot parse the modern
   bundle still reports why, instead of showing a silently dead screen. */
(function () {
  var errors = [];
  window.__studioBootOk = true;
  window.__studioErrors = errors;
  function report(kind, detail) {
    detail = String(detail || '').slice(0, 400);
    errors.push(kind + ': ' + detail);
    if (errors.length > 8) errors.shift();
    try {
      if (window.StudioBridge && window.StudioBridge.postMessage) {
        window.StudioBridge.postMessage(JSON.stringify({type: 'jsError', kind: kind, detail: detail}));
      }
    } catch (ignored) {}
  }
  window.__studioBootReport = report;
  window.addEventListener('error', function (event) {
    var target = event && event.target;
    if (target && target !== window && target.tagName) {
      var tag = String(target.tagName).toUpperCase();
      if (tag !== 'SCRIPT' && tag !== 'LINK') return;
      report('resource', tag + ' ' + (target.src || target.href || ''));
      return;
    }
    report('script', (event && event.message || '脚本错误') +
      (event && event.filename ? ' @' + event.filename + ':' + event.lineno : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    report('promise', reason && (reason.stack || reason.message) || reason || '');
  });
  setTimeout(function () {
    if (window.Studio && (window.Studio.view || window.__studioLandingReady)) return;
    var host = document.getElementById('editor');
    if (!host || host.getAttribute('data-boot-failed') === '1') return;
    host.setAttribute('data-boot-failed', '1');
    var box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;top:calc(8px + env(safe-area-inset-top));left:calc(8px + env(safe-area-inset-left));right:calc(8px + env(safe-area-inset-right));z-index:9999;display:flex;align-items:center;gap:10px;padding:9px 10px 9px 14px;border-radius:12px;font:13px/1.4 sans-serif;color:#1f2937;background:#fff;box-shadow:0 10px 28px rgba(15,23,42,.24)';
    var copy = document.createElement('div');
    copy.style.cssText = 'min-width:0;flex:1;display:flex;flex-direction:column;gap:2px';
    var title = document.createElement('p');
    title.style.cssText = 'margin:0;font-weight:600';
    title.textContent = '脚本未加载，请重试';
    copy.appendChild(title);
    box.appendChild(copy);
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '重试';
    retry.style.cssText = 'flex:none;min-height:36px;padding:0 14px;border:0;border-radius:9px;background:#0f766e;color:#fff;font:600 13px/1 sans-serif';
    retry.onclick = function () { window.location.reload(); };
    box.appendChild(retry);
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭启动错误提示');
    close.textContent = '关闭';
    close.style.cssText = 'flex:none;min-height:36px;padding:0 10px;border:1px solid #d7e1dc;border-radius:9px;background:#f8fafc;color:#475569;font:500 12px/1 sans-serif';
    close.onclick = function () { if (box.parentNode) box.parentNode.removeChild(box); };
    box.appendChild(close);
    box.title = errors.length ? errors.join('\n') : '若重试仍失败，请更新 Android System WebView。';
    var landing = document.getElementById('landing');
    if (landing) {
      document.body.appendChild(box);
    } else {
      host.appendChild(box);
    }
  }, 3000);
})();
