/* Shared site behavior: announcement bar text + mobile menu toggle.
   Edit the promo in ONE place here and every page updates. */
(function () {
  var DEFAULT = '★ Free shipping on orders over $75 CAD · Buy 3 Get 1 Free ★';

  /* Seasonal banners, checked in order — first match wins. Dates are Eastern,
     expressed as UTC. Order-by dates come from the published 4-7 business day
     build time plus transit; a real deadline sells better than a discount, so
     these replace the standing promo during the holiday run. */
  var SEASONAL = [
    { from: '2026-11-18T05:00:00Z', to: '2026-11-27T05:00:00Z',
      text: '★ Christmas order-by: Dec 1 for the US · Dec 4 for Canada ★' },
    { from: '2026-11-27T05:00:00Z', to: '2026-11-30T05:00:00Z',
      text: '★ Black Friday — 20% off 2 or more with VAULT20 · still arrives by Christmas ★' },
    { from: '2026-11-30T05:00:00Z', to: '2026-12-01T05:00:00Z',
      text: '★ Cyber Monday — free Rush upgrade with CYBERRUSH · last day for US Christmas delivery ★' },
    { from: '2026-12-01T05:00:00Z', to: '2026-12-05T05:00:00Z',
      text: '★ Final days to order for Christmas — Canada closes Dec 4 ★' },
    { from: '2026-12-05T05:00:00Z', to: '2026-12-12T05:00:00Z',
      text: '★ Past the standard cutoff — add Rush and it still lands by Christmas ★' },
    { from: '2026-12-12T05:00:00Z', to: '2026-12-26T05:00:00Z',
      text: '★ Ordering now? Arrives after Christmas — perfect for New Year ★' },
    { from: '2026-12-26T05:00:00Z', to: '2027-01-04T05:00:00Z',
      text: '★ Boxing Week — 15% off everything with BOXING15 ★' },
    { from: '2027-01-07T05:00:00Z', to: '2027-01-27T05:00:00Z',
      text: "★ Valentine's order-by: Jan 21 for the US · Jan 26 for Canada ★" }
  ];

  function announcement() {
    var now = Date.now();
    for (var i = 0; i < SEASONAL.length; i++) {
      var s = SEASONAL[i];
      if (now >= new Date(s.from).getTime() && now < new Date(s.to).getTime()) return s.text;
    }
    return DEFAULT;
  }

  var ANNOUNCE = announcement();

  document.querySelectorAll('.announce').forEach(function (el) {
    el.textContent = ANNOUNCE;
  });

  var btn = document.getElementById('menuBtn');
  var menu = document.getElementById('mobileMenu');
  if (btn && menu) {
    btn.addEventListener('click', function () {
      var open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', open);
    });
    menu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        menu.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      });
    });
  }
})();

/* ============================================================
   Email capture — 10% off in exchange for an address we can
   market to at the holidays. Appears once per visitor; sits out
   the order flow entirely so it never interrupts a checkout.
   ============================================================ */
(function () {
  var CODE     = 'WELCOME10';
  var DELAY_MS = 10000;
  var KEY      = 'cvcEmailCapture';
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbx9B6yhtZoRbS_UzsG_swxRCB1FVlmJQ3-9Q2JLlrzzXO4Emyaqe6fEXtP2HwdsoYnv/exec';
  var CONSENT  = 'Opted in to Card Vault Customs offers and holiday drops via site popup.';

  // Never interrupt someone mid-order or just after they've paid.
  var path = location.pathname.toLowerCase();
  if (path.indexOf('design-page') > -1 || path.indexOf('thankyou') > -1) return;

  // Private browsing can throw on localStorage; a visitor seeing the popup twice
  // is a far smaller problem than the script dying here.
  function remembered() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function remember(v) {
    try { localStorage.setItem(KEY, v); } catch (e) { /* not fatal */ }
  }
  if (remembered()) return;

  var modal;

  function close(reason) {
    if (reason) remember(reason);
    if (modal) modal.classList.remove('show');
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') close('dismissed');
  }

  function showCode(box) {
    box.innerHTML =
      '<button class="ecap-x" type="button" aria-label="Close">&times;</button>' +
      '<div class="ecap-kicker">You\'re in</div>' +
      '<h3>Here\'s your <i>10% off</i> code</h3>' +
      '<span class="ecap-code">' + CODE + '</span>' +
      '<p class="ecap-sub" style="margin:14px 0 0;">Type it into the promo box at checkout. It stacks on top of Buy 3 Get 1 Free.</p>' +
      '<p class="ecap-fine">Screenshot this or write it down — we don\'t email the code.</p>' +
      '<a class="ecap-btn" href="design-page.html" style="display:block;text-align:center;margin-top:15px;text-decoration:none;">Start designing &rarr;</a>';
    box.querySelector('.ecap-x').addEventListener('click', function () { close('subscribed'); });
  }

  function build() {
    var wrap = document.createElement('div');
    wrap.className = 'ecap';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Get 10% off your first order');
    wrap.innerHTML =
      '<div class="ecap-box">' +
        '<button class="ecap-x" type="button" aria-label="Close">&times;</button>' +
        '<div class="ecap-kicker">First order offer</div>' +
        '<h3>Take <i>10% off</i> your custom card</h3>' +
        '<p class="ecap-sub">Leave your email and we\'ll give you a code to use at checkout. We\'ll also send you a heads-up on holiday drops and deals — a few times a year, never spam.</p>' +
        '<form class="ecap-form" novalidate>' +
          '<input type="email" placeholder="you@email.com" autocomplete="email" aria-label="Email address">' +
          '<label class="ecap-consent">' +
            '<input type="checkbox">' +
            '<span>Yes, email me Card Vault Customs offers and holiday drops. I can unsubscribe at any time.</span>' +
          '</label>' +
          '<div class="ecap-msg" role="alert"></div>' +
          '<button class="ecap-btn" type="submit">Get my 10% code</button>' +
        '</form>' +
        '<button class="ecap-no" type="button">No thanks</button>' +
      '</div>';

    var box   = wrap.querySelector('.ecap-box');
    var form  = wrap.querySelector('.ecap-form');
    var email = wrap.querySelector('input[type=email]');
    var agree = wrap.querySelector('input[type=checkbox]');
    var msg   = wrap.querySelector('.ecap-msg');
    var send  = wrap.querySelector('.ecap-btn');

    wrap.querySelector('.ecap-x').addEventListener('click', function () { close('dismissed'); });
    wrap.querySelector('.ecap-no').addEventListener('click', function () { close('dismissed'); });
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close('dismissed'); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var addr = email.value.trim();
      msg.className = 'ecap-msg';

      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(addr)) {
        msg.className = 'ecap-msg bad';
        msg.textContent = 'That email doesn\'t look right.';
        email.focus();
        return;
      }
      if (!agree.checked) {
        msg.className = 'ecap-msg bad';
        msg.textContent = 'Please tick the box so we know it\'s okay to email you.';
        return;
      }

      send.disabled = true;
      send.textContent = 'Saving…';
      msg.textContent = '';

      // The code is the same for everyone, so a failed save is no reason to
      // withhold it — we'd only be punishing the visitor for our own hiccup.
      function finish() { remember('subscribed'); showCode(box); }

      fetch(ENDPOINT, {
        method: 'POST',
        body: JSON.stringify({
          action: 'subscribe',
          email: addr,
          code: CODE,
          consent: CONSENT,
          source: location.pathname
        })
      }).then(finish).catch(finish);
    });

    return wrap;
  }

  setTimeout(function () {
    if (remembered()) return;             // subscribed in another tab meanwhile
    modal = build();
    document.body.appendChild(modal);
    modal.classList.add('show');
    document.addEventListener('keydown', onKey);
    // Autofocus helps on desktop but shoves a keyboard over the offer on phones.
    if (window.innerWidth > 700) modal.querySelector('input[type=email]').focus();
  }, DELAY_MS);
})();
