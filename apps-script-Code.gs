/**
 * Card Vault Customs — order backend (Google Apps Script Web App)
 * --------------------------------------------------------------
 * What it does on each order:
 *   1. Creates a Stripe Checkout session FIRST and returns its client_secret
 *      (the site mounts an embedded checkout window on the page — no redirect)
 *   2. Then, in the BACKGROUND (a one-time trigger moments later):
 *        - Saves the customer's photo(s) into a per-order folder in YOUR Google Drive
 *        - Emails the order to all 3 owners (see NOTIFY_LIST below)
 *        - Appends a sales row to your shared ledger spreadsheet (auto-calcs Net Profit)
 *   3. If the background hand-off FAILS, the order details are emailed to you
 *      immediately as a fallback — an order can never be silently lost.
 *
 * SETUP (Project Settings → Script properties):
 *   STRIPE_SECRET_KEY      e.g. sk_live_xxx
 *   DRIVE_PARENT_FOLDER_ID id of the Drive folder to save orders into (optional)
 *   SITE_URL               your site base, e.g. https://cardvaultcustoms.com
 *
 * IMPORTANT: the Google account you DEPLOY this with must have EDIT access to the
 * sales spreadsheet (SALES_SHEET_ID). Share the sheet with that account if needed.
 */

/* ===================== CONFIG ===================== */
// Order notifications go to ALL of these addresses (edit here anytime):
var NOTIFY_LIST = 'cardvaultcustoms@gmail.com,kevin.thi.tran@gmail.com,stephanie.sl.ly@gmail.com';

// Sales ledger spreadsheet + tab (gid). Must be shared with the deploying account.
var SALES_SHEET_ID = '1k_OjCbs3TUVzOs_481LMbb3v9EiZy1EKBZVyos49o7Y';
var SALES_SHEET_GID = 1252351518;

// Estimated Stripe fee (CAD standard): 2.9% + $0.30 — used for the Platform Fees column.
var STRIPE_FEE_PCT = 0.029;
var STRIPE_FEE_FIXED = 0.30;
/* ================================================== */

function prop(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === undefined || v === '') ? (fallback || '') : v;
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'Card Vault Customs order backend' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var orderId = 'CVC-' + new Date().getTime();

    // FAST PATH: create the Stripe session first — this is all the customer needs
    // to start paying, so we return it immediately (~2-3s). Embedded mode returns
    // a client_secret that the site mounts in a checkout window on the page.
    var clientSecret = createStripeCheckout(orderId, data, '');

    // SLOW PATH: stash the full order (photos included) and let a background
    // trigger save it to Drive, email the owners, and log the sale. This keeps
    // the customer's checkout snappy and only runs once, moments later.
    try {
      enqueueOrder(orderId, data);
    } catch (qe) {
      // FALLBACK: never lose an order silently. If the queue can't be written,
      // email the full order details right away (minus photo data, which is
      // too big for email — we ask the customer to resend if needed).
      try {
        var slim = JSON.parse(JSON.stringify(data));
        (slim.cards || []).forEach(function (c) {
          c.photos = (c.photos || []).length + ' photo(s) — NOT saved, ask customer to resend';
        });
        MailApp.sendEmail(
          NOTIFY_LIST,
          '⚠️ ORDER ' + orderId + ' — background save FAILED, details inside',
          'The background queue failed (' + qe + ').\n' +
          'Photos were NOT saved to Drive — contact the customer to resend them.\n\n' +
          'Order details:\n' + JSON.stringify(slim, null, 2)
        );
      } catch (ee) { /* nothing more we can do */ }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, orderId: orderId, clientSecret: clientSecret }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* ---------- Background queue (keeps checkout fast) ---------- */
var QUEUE_FOLDER_NAME = '_CVC Order Queue';

function getParentFolder() {
  var parentId = prop('DRIVE_PARENT_FOLDER_ID');
  if (parentId) return DriveApp.getFolderById(parentId);
  var existing = DriveApp.getFoldersByName('Card Vault Orders');
  return existing.hasNext() ? existing.next() : DriveApp.createFolder('Card Vault Orders');
}

function getQueueFolder() {
  var parent = getParentFolder();
  var existing = parent.getFoldersByName(QUEUE_FOLDER_NAME);
  return existing.hasNext() ? existing.next() : parent.createFolder(QUEUE_FOLDER_NAME);
}

// Drop the order (with photos) into a queue file, then make sure a background
// trigger is scheduled to process it.
function enqueueOrder(orderId, data) {
  var q = getQueueFolder();
  q.createFile(orderId + '.json', JSON.stringify({ orderId: orderId, data: data }), 'application/json');
  ensureQueueTrigger();
}

function ensureQueueTrigger() {
  var has = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'processQueue';
  });
  if (!has) ScriptApp.newTrigger('processQueue').timeBased().after(10 * 1000).create();
}

function removeQueueTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processQueue') ScriptApp.deleteTrigger(t);
  });
}

// Runs in the background: save photos to Drive, email owners, log the sale.
function processQueue() {
  removeQueueTriggers(); // clear the one-time trigger that called us
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var q = getQueueFolder();
    var files = q.getFiles();
    var pending = [];
    while (files.hasNext()) pending.push(files.next());

    var leftover = false;
    pending.forEach(function (f) {
      try {
        var obj = JSON.parse(f.getBlob().getDataAsString());
        var folderUrl = saveToDrive(obj.orderId, obj.data);
        try { notify(obj.orderId, obj.data, folderUrl); } catch (e1) { /* email non-fatal */ }
        try { logRow(obj.orderId, obj.data, folderUrl); } catch (e2) { /* logging non-fatal */ }
        f.setTrashed(true); // done — remove from queue
      } catch (perr) {
        leftover = true; // leave the file for a retry on the next run
      }
    });

    if (leftover) ensureQueueTrigger(); // try the failed ones again shortly
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Drive ---------- */
// Drive disallows '/' in names; trim and collapse anything weird.
function cleanName(s) {
  return String(s == null ? '' : s).replace(/[\\\/]+/g, '-').replace(/\s+/g, ' ').trim();
}

// Readable, sortable order-folder name:
//   "2026-06-29 0931 · 3x Slab · $124.97 · ASH KETCHUM (CVC-...)"
function orderFolderName(orderId, data) {
  var ms = Number(String(orderId).replace('CVC-', '')) || new Date().getTime();
  var stamp = Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmm');

  var cards = data.cards || [];
  var slab = 0, raw = 0;
  cards.forEach(function (c) { if (c.type === 'raw') raw++; else slab++; });
  var items = [];
  if (slab) items.push(slab + 'x Slab');
  if (raw) items.push(raw + 'x Raw');
  var itemStr = items.join(' + ') || (cards.length + ' card(s)');

  var who = (cards[0] && cards[0].cardName) ? cards[0].cardName : (data.proofContact || 'Order');
  var total = (data.total != null) ? ('$' + data.total) : '';

  var parts = [stamp, itemStr, total, who].filter(String).join(' · ');
  return cleanName(parts + ' (' + orderId + ')');
}

function saveToDrive(orderId, data) {
  var parent = getParentFolder();
  var folder = parent.createFolder(orderFolderName(orderId, data));

  // One subfolder per card: "Card 1 · Slab · Birthday · ASH KETCHUM"
  (data.cards || []).forEach(function (c, k) {
    var typeLabel = (c.type === 'raw') ? 'Raw' : 'Slab';
    var bits = ['Card ' + (k + 1), typeLabel];
    if (c.occasion) bits.push(c.occasion);
    if (c.cardName) bits.push(c.cardName);
    var sub = folder.createFolder(cleanName(bits.join(' · ')));
    (c.photos || []).forEach(function (p, i) {
      var base64 = String(p.dataUrl).replace(/^data:image\/\w+;base64,/, '');
      var blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', (p.name || ('photo-' + (i + 1) + '.jpg')));
      sub.createFile(blob);
    });
  });

  folder.createFile('order-details.txt', detailsText(orderId, data), 'text/plain');
  return folder.getUrl();
}

function formatShipTo(data) {
  var s = data.shipTo || {};
  if (!s.name && !s.address) return '';
  return [
    s.name || '',
    s.address || '',
    [s.city, s.province, s.postal].filter(String).join(', '),
    s.country || ''
  ].filter(String).join('\n');
}

function detailsText(orderId, data) {
  var lines = [];
  lines.push('CARD VAULT CUSTOMS — ORDER ' + orderId);
  lines.push('Date: ' + new Date().toString());
  lines.push('');
  lines.push('Summary: ' + (data.summary || ''));
  lines.push('TOTAL: $' + data.total + ' ' + (data.currency || 'CAD'));
  if (data.promoCode) {
    lines.push('Promo code: ' + data.promoCode + ' (−$' + data.promoDiscount + ')');
  }
  lines.push('Proof via: ' + data.proofMethod + ' → ' + data.proofContact);
  if (data.designConsent) {
    lines.push('Design consent: yes (AI-assisted tools OK)');
  }
  lines.push('');
  var ship = formatShipTo(data);
  if (ship) {
    lines.push('SHIP TO:');
    lines.push(ship);
  } else {
    lines.push('SHIP TO: (not provided)');
  }
  lines.push('');
  (data.cards || []).forEach(function (c, k) {
    lines.push('--- Card ' + (k + 1) + ' (' + ((c.type === 'raw') ? 'Raw Card' : 'Graded Slab') + ') ---');
    lines.push('  Product: ' + c.productName + ' ($' + c.price + ')');
    lines.push('  Style: ' + c.style);
    lines.push('  Occasion: ' + (c.occasion || '—'));
    lines.push('  Name on card: ' + (c.cardName || '—'));
    lines.push('  Notes: ' + (c.vision || '—'));
    lines.push('  Photos: ' + (c.photos ? c.photos.length : 0));
    lines.push('');
  });
  if (data.addons && data.addons.length) {
    lines.push('Add-ons: ' + data.addons.map(function (a) { return a.name + ' (+$' + a.price + ')'; }).join(', '));
  }
  return lines.join('\n');
}

/* ---------- Email (all 3 owners) ---------- */
function notify(orderId, data, folderUrl) {
  var to = NOTIFY_LIST;
  if (!to) return;
  var shipName = (data.shipTo && data.shipTo.name) ? (' · ' + data.shipTo.name) : '';
  var subject = '🃏 New order ' + orderId + ' — ' + (data.summary || (data.cardCount + ' card(s)')) + ' ($' + data.total + ')' + shipName;
  var body = detailsText(orderId, data) + '\n\nPhotos & details in Drive:\n' + folderUrl +
             '\n\n(Note: payment confirms in Stripe — check your Stripe dashboard for this Order ID.)';
  MailApp.sendEmail(to, subject, body);
}

/* ---------- Sales ledger ---------- */
function getSheetByGid(ss, gid) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === gid) return sheets[i];
  }
  return sheets[0];
}

function logRow(orderId, data, folderUrl) {
  var ss = SpreadsheetApp.openById(SALES_SHEET_ID);
  var sheet = getSheetByGid(ss, SALES_SHEET_GID);

  var HEADERS = ['Date','Order / Ref #','Platform','Item / Description','Product Type',
    'Qty','Unit Price','Gross Sales','Shipping Collected','Platform Fees',
    'Shipping Cost','COGS (per order)','Net Profit','Notes'];
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);

  var cards = data.cards || [];
  var typeSet = {};
  cards.forEach(function (c) { typeSet[c.type] = true; });
  var productType = (Object.keys(typeSet).length > 1) ? 'Mixed'
    : ((cards[0] && cards[0].type === 'raw') ? 'Raw Card' : 'Graded Slab');

  // Unit Price only when a single uniform product and no add-ons
  var unitPrice = '';
  if (cards.length) {
    var p0 = cards[0].price, uniform = true;
    cards.forEach(function (c) { if (c.price !== p0) uniform = false; });
    if (uniform && (!data.addons || !data.addons.length)) unitPrice = p0;
  }

  var charged = Number(data.total) || 0;     // full amount Stripe collected
  // Gross Sales = product revenue after discount; falls back to total for old payloads.
  var gross = Number(data.subtotal != null ? data.subtotal : data.total) || 0;
  var shippingCollected = Number(data.shipping) || 0;
  // Stripe fee applies to the full charge (products + shipping).
  var fee = Math.round((charged * STRIPE_FEE_PCT + STRIPE_FEE_FIXED) * 100) / 100;
  var occasions = cards.map(function (c) { return c.occasion; }).filter(String).join(', ');
  var ship = data.shipTo || {};
  var shipOneLine = [ship.name, ship.address, ship.city, ship.province, ship.postal, ship.country]
    .filter(String).join(', ');
  var notes = [
    data.summary || '',
    (Number(data.discount) > 0) ? ('Buy 3 Get 1 discount: -$' + data.discount) : '',
    (data.promoCode ? ('Promo ' + data.promoCode + ': -$' + data.promoDiscount) : ''),
    occasions ? ('Occasions: ' + occasions) : '',
    'Proof: ' + data.proofMethod + ' ' + data.proofContact,
    shipOneLine ? ('Ship to: ' + shipOneLine) : '',
    (data.designConsent ? 'Design consent: yes' : ''),
    folderUrl
  ].filter(String).join(' · ');

  sheet.appendRow([
    new Date(),                              // Date
    orderId,                                 // Order / Ref #
    'Website',                               // Platform
    data.summary || (cards.length + ' card(s)'), // Item / Description
    productType,                             // Product Type
    (data.cardCount || cards.length),        // Qty
    unitPrice,                               // Unit Price
    gross,                                   // Gross Sales (after discount)
    shippingCollected,                       // Shipping Collected
    fee,                                     // Platform Fees (est. Stripe)
    '',                                      // Shipping Cost (you fill in)
    '',                                      // COGS per order (you fill in)
    '',                                      // Net Profit (formula set below)
    notes                                    // Notes
  ]);

  // Net Profit = Gross + Shipping Collected - Platform Fees - Shipping Cost - COGS
  var r = sheet.getLastRow();
  sheet.getRange(r, 13).setFormula('=H' + r + '+I' + r + '-J' + r + '-K' + r + '-L' + r);
}

/* ---------- Stripe ---------- */
function createStripeCheckout(orderId, data, folderUrl) {
  var key = prop('STRIPE_SECRET_KEY');
  if (!key) throw new Error('Missing STRIPE_SECRET_KEY');
  var site = prop('SITE_URL', 'https://example.com');
  var currency = (data.currency || 'CAD').toLowerCase();

  var payload = {
    'mode': 'payment',
    // Embedded Checkout: renders inside a window on our own page (no redirect).
    // On completion, Stripe sends the customer to return_url.
    'ui_mode': 'embedded_page',
    'return_url': site + '/thankyou.html?order=' + orderId + '&session_id={CHECKOUT_SESSION_ID}',
    'client_reference_id': orderId,
    'metadata[orderId]': orderId,
    'metadata[summary]': String(data.summary || ''),
    'metadata[cardCount]': String(data.cardCount || ''),
    'metadata[proof]': String(data.proofMethod || '') + ' ' + String(data.proofContact || ''),
    'metadata[driveFolder]': folderUrl
  };

  // Line items (products with quantity + add-ons) sent from the site.
  // NOTE: Stripe wants integer strings ("1", "4999"). Apps Script can serialize
  // raw numbers as "1.0", which Stripe rejects — so we String() these explicitly.
  var items = data.lineItems || [];
  items.forEach(function (li, i) {
    payload['line_items[' + i + '][price_data][currency]'] = currency;
    payload['line_items[' + i + '][price_data][product_data][name]'] = li.name;
    payload['line_items[' + i + '][price_data][unit_amount]'] = String(Math.round(Number(li.price) * 100));
    payload['line_items[' + i + '][quantity]'] = String(Math.round(Number(li.qty) || 1));
  });

  var res = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + key },
    payload: payload,
    muteHttpExceptions: true
  });

  var json = JSON.parse(res.getContentText());
  if (json.error) throw new Error('Stripe: ' + json.error.message);
  return json.client_secret;
}