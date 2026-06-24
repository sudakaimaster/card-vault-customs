# 06 · Theme Setup — "Graded Slab" Look on Shopify Dawn

This recreates the **light** look in `theme-preview-light.html` on your real Shopify store using the free **Dawn** theme. Good news: Dawn is light by default, so you're mostly setting the gold accent + fonts. Open the preview HTML in your browser first to see the target, then follow along.

> Everything here is done in **Online Store → Themes → Customize** (no coding), except the optional Custom CSS at the end.

---

## 1. Color scheme (the light "vault" palette)

Go to **Theme settings (gear icon) → Colors**. You'll define **two schemes** so you can keep an optional dark hero later. Set Scheme 1 (your main, used almost everywhere):

| Role | Hex | Where it's used |
|------|-----|-----------------|
| Background | `#F7F8FB` | Soft off-white — main page background |
| Panel / secondary bg | `#FFFFFF` | Product cards, "How It Works" band |
| Text | `#0C1322` | Deep navy body + heading text |
| Secondary text | `#5B6678` | Muted gray-navy for subtext |
| Accent / buttons | `#B8923A` | Premium gold (deepened for contrast on white) |
| Accent text-on-button | `#1A1206` | Dark text on gold buttons |
| Borders | `#E4E7EE` | Light hairline borders |

Apply **Scheme 1 to the header, all sections, and footer.** The slab look comes from your product photos, not the page background — so a clean light page lets the cards shine.

> Want the "hybrid" look later (dark navy hero only)? Make a Scheme 2 with background `#0C1322`, text `#FFFFFF`, accent `#D8B25A`, and apply it to just the Image-banner (hero) section.

---

## 2. Typography

**Theme settings → Typography.** Shopify's font picker has a built-in library — choose:

- **Headings:** `Poppins` (bold, modern — matches the preview). Set heading weight to bold.
- **Body:** `Assistant` or `Work Sans` (clean sans-serifs available in Shopify; closest to the preview's Inter).

Bump heading size scale up a notch for that bold, confident look.

---

## 3. Build the homepage sections (in order)

In the customizer, remove default demo sections and **Add section** in this order:

1. **Announcement bar** (top): `★ Free shipping over $50 · Buy 2 Get 1 Free — code BUY2GET1 ★`
2. **Image banner (Hero):**
   - Heading: *Your Card. Your Moment. Slabbed Forever.*
   - Text: *We turn your favourite photos into custom collector cards, sealed in a premium display slab.*
   - Button: **Create Your Card** → link to your main collection.
   - Background: upload a clean photo of one of your best slabs.
3. **Featured collection:** point it at your "Custom Card Shop" collection (shows the 3 products). Set columns to 3.
4. **Multicolumn (How It Works):** 3 columns, each with a number/icon, a heading (Place Your Order / Approve Your Design / Wait for Delivery), and the step text from `03-PAGES.md`.
5. **Multirow or Image-with-text:** an "About / Trusted by collectors" band with a customer quote.
6. **Email signup:** "Get 10% off your first custom slab."
7. **Footer:** add menu links + paste the disclaimer (Theme settings → or footer section text).

---

## 4. Logo

- Theme settings → Logo → upload a transparent PNG of your `CARD VAULT CUSTOMS` wordmark.
- No logo yet? Use Shopify's free **Hatchful** logo maker or Canva. Bold font, gold-on-navy, all caps — matches the preview.

---

## 5. (Optional) Custom CSS for the premium polish

Dawn doesn't expose every detail in the editor. To get the gold pill-buttons, rounded slab-style product cards, and accent prices exactly like the preview:

**Online Store → Themes → ⋯ → Edit code → `assets/base.css`** — scroll to the bottom and paste:

```css
/* ===== Card Vault Customs — premium slab polish (LIGHT) ===== */
:root {
  --cvc-gold: #B8923A;
  --cvc-gold-soft: #D8B25A;
}

/* Gold pill buttons */
.button, .shopify-payment-button__button--unbranded {
  background: var(--cvc-gold) !important;
  color: #1A1206 !important;
  border-radius: 999px !important;
  font-weight: 700 !important;
  letter-spacing: 0.3px;
  transition: transform .15s ease, background .15s ease;
}
.button:hover { background: var(--cvc-gold-soft) !important; transform: translateY(-2px); }

/* Rounded "slab" product cards with gold hover */
.card-wrapper .card {
  border-radius: 14px !important;
  border: 1px solid rgba(12,19,34,0.10) !important;
  transition: transform .15s ease, border-color .15s ease;
}
.card-wrapper:hover .card {
  transform: translateY(-4px);
  border-color: rgba(184,146,58,0.6) !important;
}

/* Accent the price in gold */
.price__regular .price-item,
.price-item--sale { color: var(--cvc-gold) !important; font-weight: 700; }

/* Uppercase, spaced section headings */
.title-wrapper h2, .section-header h2 { letter-spacing: 0.4px; }

/* Gold announcement bar */
.utility-bar, .announcement-bar {
  background: var(--cvc-gold) !important;
  color: #1A1206 !important;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  font-weight: 700;
}
```

> Class names vary slightly between Dawn versions — if a rule doesn't apply, right-click the element in your browser → Inspect to find the exact class, and tweak. Always **duplicate your theme before editing code** (Themes → ⋯ → Duplicate) so you have a backup.

---

## 6. The slab "frame" on product photos (two easy options)

The holographic slab frame in the preview is a *design choice for your product photos*, not the website itself. Two ways to get it:

- **Easiest:** Photograph your actual finished slabs on a clean dark background — the real product already looks like the preview.
- **Polished marketing shots:** Create one reusable slab "frame" template in Canva (label bar + grade badge + holo background), then drop each customer's card into it for listing/marketing images.

---

## Quick checklist

- [ ] Colors set (navy + gold)
- [ ] Fonts set (Poppins + Assistant/Work Sans)
- [ ] Hero, Featured collection, How It Works, footer sections added
- [ ] Logo uploaded
- [ ] (Optional) Custom CSS pasted, theme duplicated as backup
- [ ] Product photos shot on clean dark background
