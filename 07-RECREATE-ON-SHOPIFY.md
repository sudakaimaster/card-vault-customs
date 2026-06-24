# 07 · Recreating This Design on Shopify (Best Way)

You don't "upload the HTML." You recreate the look with Dawn's built-in tools — it's free, faithful, and keeps the easy editor. This file covers the workflow + the one paste-in block you need.

## The workflow (do these in order)

1. **Colors & fonts** — Theme settings → Colors / Typography. Use the hex codes + fonts in `06-THEME-SETUP.md`.
2. **Logo** — Theme settings → Logo → upload `logo/cvc-logo-primary.svg` (or a PNG export).
3. **Announcement bar** — add Dawn's *Announcement bar* section: `★ Free shipping over $50 · Buy 2 Get 1 Free — code BUY2GET1 ★`
4. **Hero** — add Dawn's *Image banner* section. Background = a real photo of one of your slabs. Heading + button text from `03-PAGES.md`.
5. **Products** — add Dawn's *Featured collection* section, pointed at your "Custom Card Shop" collection.
6. **How It Works** — add a *Custom Liquid* section and paste the block below.
7. **Footer** — Dawn's *Footer* section + the disclaimer from `04-POLICIES.md`.
8. **Polish CSS** — paste the Custom CSS from `06-THEME-SETUP.md` (gold buttons, rounded cards, gold prices). Duplicate your theme first as a backup.

## Paste-in "How It Works" (Custom Liquid section)

In Shopify: **Customize → Add section → Custom Liquid** → paste everything below → Save.

```liquid
<div class="cvc-how">
  <div class="cvc-how__head">
    <p class="cvc-how__eyebrow">Simple &amp; Fast</p>
    <h2 class="cvc-how__title">How It Works</h2>
  </div>
  <div class="cvc-how__grid">
    <div class="cvc-how__step">
      <div class="cvc-how__num">1</div>
      <h3>Design Your Card</h3>
      <p>Upload your photo, then make it yours — choose your finish (holo, foil, or matte), border style, card name, and grade. Submit it all through our easy order form.</p>
    </div>
    <div class="cvc-how__step">
      <div class="cvc-how__num">2</div>
      <h3>Approve Your Design</h3>
      <p>We text or email you a watermarked design proof within 48 hours — approve or request changes.</p>
    </div>
    <div class="cvc-how__step">
      <div class="cvc-how__num">3</div>
      <h3>Wait for Delivery</h3>
      <p>Once approved, your slab is printed and shipped within 48 hours.</p>
    </div>
  </div>
</div>

<style>
  .cvc-how { max-width: 1100px; margin: 0 auto; padding: 56px 20px; }
  .cvc-how__head { text-align: center; margin-bottom: 36px; }
  .cvc-how__eyebrow { color: #b8923a; font-weight: 700; font-size: 12px; letter-spacing: 2.5px; text-transform: uppercase; margin: 0 0 8px; }
  .cvc-how__title { font-size: 30px; font-weight: 800; margin: 0; }
  .cvc-how__grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; }
  .cvc-how__step { text-align: center; }
  .cvc-how__num {
    width: 54px; height: 54px; margin: 0 auto 16px; border-radius: 50%;
    border: 1px solid #b8923a; color: #b8923a; font-weight: 800; font-size: 22px;
    display: flex; align-items: center; justify-content: center;
  }
  .cvc-how__step h3 { font-size: 18px; margin: 0 0 6px; }
  .cvc-how__step p { color: #5b6678; font-size: 14px; margin: 0; }
  @media (max-width: 760px) { .cvc-how__grid { grid-template-columns: 1fr; gap: 22px; } }
</style>
```

> The CSS is scoped under `.cvc-how` so it won't interfere with the rest of your theme. Adjust colors here if you tweak your palette.

## If you want it pixel-perfect instead
Install a page-builder app (**PageFly** or **GemPages**, free tiers). They let you drag-and-drop and paste custom HTML/CSS, so you can match the mockup exactly. Trade-off: another app + a small learning curve. Otherwise, Option 1 above is the clean, free path.
