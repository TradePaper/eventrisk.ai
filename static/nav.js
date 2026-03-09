(function () {
  var styles = `
    .site-nav {
      background: #050911;
      border-bottom: 1px solid #111d30;
      height: 44px;
      display: flex;
      align-items: center;
      padding: 0 24px;
      gap: 0;
      position: sticky;
      top: 0;
      z-index: 200;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .site-nav-logo {
      font-size: 12px;
      font-weight: 700;
      color: #3b82f6;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      margin-right: 28px;
      white-space: nowrap;
    }
    .site-nav-links {
      display: flex;
      align-items: center;
      gap: 2px;
      flex: 1;
    }
    .site-nav-link {
      font-size: 12px;
      font-weight: 500;
      color: #5e7a9a;
      text-decoration: none;
      padding: 5px 12px;
      border-radius: 5px;
      letter-spacing: 0.3px;
      transition: color .15s, background .15s;
      white-space: nowrap;
    }
    .site-nav-link:hover {
      color: #c8d6e8;
      background: #0d1520;
    }
    .site-nav-link.active {
      color: #e2eaf4;
      background: #0f1e36;
      font-weight: 600;
    }
  `;

  var styleEl = document.createElement('style');
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);

  var nav = document.createElement('nav');
  nav.className = 'site-nav';
  nav.innerHTML = `
    <span class="site-nav-logo">ProbEdge</span>
    <div class="site-nav-links">
      <a class="site-nav-link" href="/event-markets">Event Markets Intelligence</a>
      <a class="site-nav-link" href="/event-markets#curve" style="font-size:10px;opacity:.65;padding-left:4px;padding-right:4px;">↳ Curve</a>
      <a class="site-nav-link" href="/hedging-simulator">Sportsbook Hedge Simulator</a>
      <a class="site-nav-link" href="/probability-gap">Probability Gap Dashboard</a>
      <a class="site-nav-link" href="/contract-library">Event Contract Library</a>
      <a class="site-nav-link" href="/backtest">Historical Backtesting</a>
      <a class="site-nav-link" href="/reports">Weekly Reports</a>
    </div>
  `;

  if (document.body) {
    document.body.insertBefore(nav, document.body.firstChild);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.insertBefore(nav, document.body.firstChild);
    });
  }

  var path = window.location.pathname.replace(/\/$/, '');
  nav.querySelectorAll('.site-nav-link').forEach(function (link) {
    var href = link.getAttribute('href').replace(/\/$/, '');
    if (href === path) link.classList.add('active');
  });

  var analyticsScript = document.createElement('script');
  analyticsScript.src = '/static/analytics.js';
  document.head.appendChild(analyticsScript);

  var footerStyles = `
    .site-footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #050911;
      border-top: 1px solid #111d30;
      height: 28px;
      display: flex;
      align-items: center;
      padding: 0 20px;
      gap: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 10px;
      color: #344d6a;
      z-index: 100;
    }
    .site-footer-label {
      text-transform: uppercase;
      letter-spacing: .8px;
      font-weight: 700;
      color: #243350;
    }
    .site-footer-item {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .site-footer-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #344d6a;
      flex-shrink: 0;
    }
    .site-footer-updated {
      margin-left: auto;
      color: #243350;
    }
    body { padding-bottom: 28px; }
  `;

  var footerStyleEl = document.createElement('style');
  footerStyleEl.textContent = footerStyles;
  document.head.appendChild(footerStyleEl);

  var footer = document.createElement('div');
  footer.className = 'site-footer';
  footer.innerHTML = '<span class="site-footer-label">Providers</span><span id="footer-health">…</span><span class="site-footer-updated" id="footer-ts"></span>';

  function appendFooter() {
    document.body.appendChild(footer);
    refreshFooterHealth();
    setInterval(refreshFooterHealth, 30000);
  }

  function refreshFooterHealth() {
    fetch('/api/providers/health')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var colors = { ok: '#22c55e', degraded: '#eab308', down: '#ef4444' };
        var html = Object.keys(data).map(function(name) {
          var h = data[name];
          var color = colors[h.status] || '#344d6a';
          var staleWarning = h.stale ? ' ⚠' : '';
          return '<span class="site-footer-item">'
            + '<span class="site-footer-dot" style="background:' + color + '" title="' + h.status + '"></span>'
            + name + ': ' + h.status + staleWarning
            + '</span>';
        }).join('');
        document.getElementById('footer-health').innerHTML = html;
        document.getElementById('footer-ts').textContent = 'refreshed ' + new Date().toLocaleTimeString();
      })
      .catch(function() {
        document.getElementById('footer-health').textContent = 'health unavailable';
      });
  }

  if (document.body) {
    appendFooter();
  } else {
    document.addEventListener('DOMContentLoaded', appendFooter);
  }
})();
