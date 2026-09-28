/**
 * Card Vault Customs — order backend (Google Apps Script Web App)
 * --------------------------------------------------------------
 * What it does on each order:
 *   1. Creates a Stripe Checkout session FIRST and returns its client_secret
 *      (the site mounts an embedded checkout window on the page — no redirect)
 *   2. Then, in the BACKGROUND (a one-time trigger moments later):
 *        - Saves the customer's photo(s) into a per-order folder in YOUR Google Drive
 *        - Emails the order to all 3 owners (see NOTIFY_LIST below)
 *        - Appends a row to the orders ledger (auto-calcs Net Profit)
 *   3. If the background hand-off FAILS, the order details are emailed to you
 *      immediately as a fallback — an order can never be silently lost.
 *
 * SETUP (Project Settings → Script properties):
 *   STRIPE_SECRET_KEY      e.g. sk_live_xxx
 *   DRIVE_PARENT_FOLDER_ID id of the Drive folder to save orders into (optional)
 *   SITE_URL               your site base, e.g. https://cardvaultcustoms.com
 *
 * The orders ledger needs no setup: run setupOrderSheet() once (or just take an
 * order) and the script creates the spreadsheet in the deploying account's own
 * Drive, then remembers its id. Nothing to share, nothing to paste.
 */

/* ===================== CONFIG ===================== */
// Order notifications go to ALL of these addresses (edit here anytime):
var NOTIFY_LIST = 'cardvaultcustoms@gmail.com,kevin.thi.tran@gmail.com,stephanie.sl.ly@gmail.com';

// Orders ledger. Deliberately NOT a hardcoded id: the previous one pointed at a
// spreadsheet that went missing, and because logging is non-fatal every order
// afterwards succeeded while quietly recording nothing. The script now owns the
// file it writes to and recreates it if it ever disappears.
var ORDER_SHEET_NAME = 'Card Vault Customs — Orders';

// Estimated Stripe fee (CAD standard): 2.9% + $0.30 — used for the Stripe fee column.
var STRIPE_FEE_PCT = 0.029;
var STRIPE_FEE_FIXED = 0.30;

// Your product cost per card, used to pre-fill the Card cost column so Net profit
// is meaningful the moment a row lands. Override any cell by typing over it.
var COGS_PER_CARD = 5;
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

    // Email capture from the site popup. A completely different shape of request,
    // so it short-circuits before any order handling.
    if (data && data.action === 'subscribe') {
      return ContentService
        .createTextOutput(JSON.stringify(saveSubscriber(data)))
        .setMimeType(ContentService.MimeType.JSON);
    }

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
        // Email and ledger are non-fatal, but never silent: a swallowed error here
        // is indistinguishable from success in the Executions log, which cost us
        // real debugging time. Log it so the failure is visible.
        try { notify(obj.orderId, obj.data, folderUrl); }
        catch (e1) { Logger.log('EMAIL FAILED for ' + obj.orderId + ': ' + e1); }
        try { logRow(obj.orderId, obj.data, folderUrl); }
        catch (e2) { Logger.log('LEDGER FAILED for ' + obj.orderId + ': ' + e2); }
        f.setTrashed(true); // done — remove from queue
      } catch (perr) {
        Logger.log('QUEUE ITEM FAILED (' + f.getName() + '), will retry: ' + perr);
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
    if (c.type !== 'raw') lines.push('  Display stand: ' + (c.stand ? 'YES' : 'no'));
    lines.push('  Gift wrap: ' + (c.giftWrap ? 'YES' : 'no'));
    lines.push('  Notes: ' + (c.vision || '—'));
    lines.push('  Photos: ' + (c.photos ? c.photos.length : 0));
    lines.push('');
  });
  if (data.addons && data.addons.length) {
    lines.push('Add-ons: ' + data.addons.map(function (a) {
      // A Rush waived by a promo still appears in addons; don't imply it was paid for.
      var waived = data.rushWaived && /rush/i.test(a.name);
      return a.name + (waived ? ' (FREE via ' + (data.promoCode || 'promo') + ')' : ' (+$' + a.price + ')');
    }).join(', '));
  }
  if (Number(data.standCount) > 0) {
    lines.push('Display stands: ' + data.standCount + ' slab(s) (+$' + data.standTotal + ') — see per-card list above');
  }
  if (Number(data.giftWrapCount) > 0) {
    lines.push('Gift wrapping: ' + data.giftWrapCount + ' card(s) (+$' + data.giftWrapTotal + ') — see per-card list above');
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

/* ---------- Orders ledger ---------- */
// Columns are grouped left to right: what the order is, then what you owe the
// customer (fulfilment), then the money. Two columns are yours to fill in —
// Postage cost and, if you want to override it, Card cost.
var ORDER_HEADERS = [
  'Date', 'Order #', 'Status', 'Customer', 'Proof via',           // A–E  what came in
  'Cards', 'Type', 'What they ordered', 'Occasions',              // F–I  the build
  'Rush', 'Stands', 'Gift wrap',                                  // J–L  add-ons
  'BOGO discount', 'Promo code', 'Promo discount',                // M–O  what you gave away
  'Gross sales', 'Shipping charged', 'Total charged',              // P–R  what they paid
  'Stripe fee (est)', 'Postage cost', 'Card cost', 'Net profit',   // S–V  what it cost you
  'Ship to', 'Photos'                                             // W–X  logistics
];

var ORDER_STATES = ['New', 'Proof sent', 'Changes requested', 'Approved', 'Printed', 'Shipped', 'Done'];

// Created on first use and remembered in script properties. If the file is ever
// trashed we untrash it rather than starting a second ledger; only a genuinely
// unreachable id causes a fresh one to be built.
function orderSheet() {
  var id = prop('ORDER_SHEET_ID');
  if (id) {
    try {
      var f = DriveApp.getFileById(id);
      if (f.isTrashed()) f.setTrashed(false);
      var sh = SpreadsheetApp.openById(id).getSheets()[0];
      if (sh.getLastRow() === 0) formatOrderSheet(sh);
      return sh;
    } catch (e) { /* deleted for good or unshared — fall through and build a new one */ }
  }
  var ss = SpreadsheetApp.create(ORDER_SHEET_NAME);
  var sheet = ss.getSheets()[0];
  sheet.setName('Orders');
  formatOrderSheet(sheet);
  PropertiesService.getScriptProperties().setProperty('ORDER_SHEET_ID', ss.getId());
  return sheet;
}

function formatOrderSheet(sheet) {
  sheet.appendRow(ORDER_HEADERS);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  sheet.getRange(1, 1, 1, ORDER_HEADERS.length)
    .setFontWeight('bold').setBackground('#0c1322').setFontColor('#d8b25a')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 34);

  var N = 2000;
  sheet.getRange(2, 1, N, 1).setNumberFormat('yyyy-mm-dd  hh:mm');
  // Money columns M,O,P,Q,R,S,T,U,V
  [13, 15, 16, 17, 18, 19, 20, 21, 22].forEach(function (c) {
    sheet.getRange(2, c, N, 1).setNumberFormat('$#,##0.00');
  });
  // Fulfilment state lives beside the money so there is only one place to look.
  sheet.getRange(2, 3, N, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ORDER_STATES, true)
      .setAllowInvalid(false).build()
  );

  var widths = [150, 165, 135, 150, 180, 55, 95, 300, 150, 65, 65, 80,
                115, 110, 115, 110, 125, 115, 120, 115, 95, 110, 300, 230];
  widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
}

// Run once from the editor to create the ledger and get its link, without
// waiting for a real order to arrive.
function setupOrderSheet() {
  var sh = orderSheet();
  var url = sh.getParent().getUrl();
  Logger.log('Orders ledger ready: ' + url);
  try {
    MailApp.sendEmail(NOTIFY_LIST, 'Card Vault — your new orders sheet',
      'Your orders ledger is ready. Every order from now on appends a row here:\n\n' + url +
      '\n\nColumns you fill in yourself: Postage cost (and Card cost if $' + COGS_PER_CARD +
      ' per card is ever wrong). Net profit calculates itself.');
  } catch (e) { /* the link is in the log either way */ }
  return url;
}

function logRow(orderId, data, folderUrl) {
  var sheet = orderSheet();
  var cards = data.cards || [];
  var typeSet = {};
  cards.forEach(function (c) { typeSet[c.type] = true; });
  var productType = (Object.keys(typeSet).length > 1) ? 'Mixed'
    : ((cards[0] && cards[0].type === 'raw') ? 'Raw Card' : 'Graded Slab');

  var charged = Number(data.total) || 0;     // full amount Stripe collected
  // Gross sales = product revenue after the BOGO discount but before any promo code;
  // falls back to the total for payloads written by older versions of the site.
  var gross = Number(data.subtotal != null ? data.subtotal : data.total) || 0;
  // Stripe's fee applies to the full charge, products and shipping together.
  var fee = Math.round((charged * STRIPE_FEE_PCT + STRIPE_FEE_FIXED) * 100) / 100;
  // Deduped: four cards for the same occasion should read "Christmas", not
  // "Christmas, Christmas, Christmas, Christmas".
  var seenOcc = {}, occList = [];
  cards.forEach(function (c) {
    if (c.occasion && !seenOcc[c.occasion]) { seenOcc[c.occasion] = true; occList.push(c.occasion); }
  });
  var occasions = occList.join(', ');
  var ship = data.shipTo || {};
  var shipOneLine = [ship.name, ship.address, ship.city, ship.province, ship.postal, ship.country]
    .filter(String).join(', ');

  // A promo can waive Rush, so "Yes" would overstate what they paid for it.
  var rush = '';
  (data.addons || []).forEach(function (a) {
    if (/rush/i.test(a.name)) rush = data.rushWaived ? 'FREE' : 'Yes';
  });

  sheet.appendRow([
    new Date(),                                   // A  Date
    orderId,                                      // B  Order #
    'New',                                        // C  Status — move it along as you work
    ship.name || data.proofContact || '',         // D  Customer
    (data.proofMethod || '') + ' ' + (data.proofContact || ''), // E  Proof via
    (data.cardCount || cards.length),             // F  Cards
    productType,                                  // G  Type
    data.summary || (cards.length + ' card(s)'),  // H  What they ordered
    occasions,                                    // I  Occasions
    rush,                                         // J  Rush
    Number(data.standCount) || '',                // K  Stands
    Number(data.giftWrapCount) || '',             // L  Gift wrap
    Number(data.discount) || 0,                   // M  BOGO discount
    data.promoCode || '',                         // N  Promo code
    Number(data.promoDiscount) || 0,              // O  Promo discount
    gross,                                        // P  Gross sales
    Number(data.shipping) || 0,                   // Q  Shipping charged
    charged,                                      // R  Total charged
    fee,                                          // S  Stripe fee (est)
    '',                                           // T  Postage cost — you fill in
    '',                                           // U  Card cost — formula below
    '',                                           // V  Net profit — formula below
    shipOneLine,                                  // W  Ship to
    folderUrl                                     // X  Photos
  ]);

  var r = sheet.getLastRow();
  // Card cost is a formula, not a value, so correcting COGS later is one edit
  // rather than a rewrite of every historical row.
  sheet.getRange(r, 21).setFormula('=F' + r + '*' + COGS_PER_CARD);
  // Net profit works from what Stripe actually collected, which already nets off
  // both the BOGO discount and any promo code — using gross here would double-count.
  sheet.getRange(r, 22).setFormula('=R' + r + '-S' + r + '-T' + r + '-U' + r);
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

/* ---------- Email subscribers ---------- */
// Lives in its own spreadsheet, created on the first signup. The id is kept in
// script properties so we reuse the same sheet forever after.
function subscriberSheet() {
  var id = prop('SUBSCRIBER_SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id).getSheets()[0]; }
    catch (e) { /* deleted or unshared — fall through and make a fresh one */ }
  }
  var ss = SpreadsheetApp.create('Card Vault Customs — Email Subscribers');
  var sh = ss.getSheets()[0];
  sh.appendRow(['Signed up', 'Email', 'Code given', 'Signed up on page', 'Consent wording']);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 160);
  sh.setColumnWidth(2, 240);
  sh.setColumnWidth(5, 420);
  PropertiesService.getScriptProperties().setProperty('SUBSCRIBER_SHEET_ID', ss.getId());
  return sh;
}

// CASL expects proof of when and how someone opted in, so the consent wording and
// timestamp are stored alongside the address rather than just the address itself.
function saveSubscriber(data) {
  var email = String(data.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    return { ok: false, error: 'invalid email' };
  }

  var sh = subscriberSheet();
  var last = sh.getLastRow();
  if (last > 1) {
    var seen = sh.getRange(2, 2, last - 1, 1).getValues().map(function (r) {
      return String(r[0]).trim().toLowerCase();
    });
    // Someone signing up twice shouldn't show up twice in a marketing list.
    if (seen.indexOf(email) > -1) return { ok: true, duplicate: true };
  }

  sh.appendRow([new Date(), email, data.code || '', data.source || '', data.consent || '']);
  return { ok: true };
}

/* ---------- Diagnostic ---------- */
// Run this by hand from the editor when an order comes through but no email
// arrives. Every check reports independently, so one broken thing can't hide
// the others. Safe to run anytime — it only sends one small email to the owners.
function diagnose() {
  var out = ['=== CARD VAULT PIPELINE DIAGNOSTIC ===', 'Run at: ' + new Date(), ''];

  out.push('Notify list: ' + NOTIFY_LIST);
  try {
    out.push('Mail quota left today (recipients): ' + MailApp.getRemainingDailyQuota());
  } catch (e) { out.push('!! Mail quota check failed: ' + e); }

  try {
    MailApp.sendEmail(NOTIFY_LIST, 'CVC diagnostic — email path works',
      'If you are reading this, MailApp can send to the notify list.\nRun at: ' + new Date());
    out.push('Direct email send: OK (check inbox)');
  } catch (e) { out.push('!! DIRECT EMAIL SEND FAILED: ' + e); }
  out.push('');

  try {
    var q = getQueueFolder(), it = q.getFiles(), names = [];
    while (it.hasNext()) names.push(it.next().getName());
    out.push('Queue folder: ' + q.getName() + '  ' + q.getUrl());
    out.push('Orders waiting in queue (' + names.length + '): ' + (names.join(', ') || 'none'));
  } catch (e) { out.push('!! QUEUE CHECK FAILED: ' + e); }
  out.push('');

  ['STRIPE_SECRET_KEY', 'DRIVE_PARENT_FOLDER_ID', 'SITE_URL'].forEach(function (k) {
    var v = prop(k);
    out.push('Property ' + k + ': ' + (v ? ('set, ' + v.length + ' chars') : '!! MISSING'));
  });
  out.push('');

  try {
    var names2 = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    out.push('Installed triggers: ' + (names2.join(', ') || 'none'));
  } catch (e) { out.push('!! TRIGGER CHECK FAILED: ' + e); }

  try {
    var osh = orderSheet();
    out.push('Orders logged: ' + Math.max(0, osh.getLastRow() - 1));
    out.push('Orders sheet: ' + osh.getParent().getUrl());
  } catch (e) { out.push('!! ORDERS SHEET FAILED: ' + e); }

  try {
    var sub = subscriberSheet();
    var count = Math.max(0, sub.getLastRow() - 1);
    out.push('Email subscribers: ' + count);
    out.push('Subscriber sheet: ' + sub.getParent().getUrl());
  } catch (e) { out.push('!! SUBSCRIBER SHEET FAILED: ' + e); }

  var txt = out.join('\n');
  Logger.log(txt);
  return txt;
}