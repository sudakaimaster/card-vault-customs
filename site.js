/* Shared site behavior: announcement bar text + mobile menu toggle.
   Edit the promo in ONE place here and every page updates. */
(function () {
  var ANNOUNCE = '★ Free shipping on orders over $75 CAD · Buy 3 Get 1 Free ★';

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
