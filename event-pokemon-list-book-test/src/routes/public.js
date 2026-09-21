"use strict";
const express = require("express");
const db = require("../db");
const mailer = require("../mailer");
const { generateQuotePdf, estimateLeadTimeDays } = require("../pdf");
const { rateLimit } = require("../rateLimit");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const quoteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }); // 5 quote requests / 15 min / IP

function formatPrice(cents) {
  if (cents === null || cents === undefined) return null;
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function toPublicDesign(d) {
  return {
    slug: d.slug,
    title: d.title,
    category: d.category,
    image_url: d.image_url,
    sprite_url: d.sprite_url || null,
    print_time: d.print_time,
    total_weight_grams: d.total_weight_grams,
    round: d.round,
    is_extra: !!d.purchase_only,
    is_featured: !!d.featured,
    price: formatPrice(d.price_cents),
    has_price: d.price_cents !== null && d.price_cents !== undefined,
    shop_url: d.shop_url || null,
    pokemon: d.pokemon ? {
      name: d.pokemon.name,
      pokedex_number: d.pokemon.pokedex_number,
      types: d.pokemon.types,
      description: d.pokemon.description
    } : null,
    filaments: (d.filaments || []).map(f => ({
      color: f.color, series: f.series, hex_color: f.hex_color, weight_grams: f.weight_grams
    }))
  };
}

router.get("/settings", (req, res) => {
  const s = db.getSettings();
  res.json({
    businessName: s.businessName || "",
    businessEmail: s.businessEmail || "",
    quoteEmailEnabled: mailer.isConfigured(),
    eventModeEnabled: !!s.eventModeEnabled,
    kioskModeEnabled: !!s.kioskModeEnabled,
    kioskIdleMinutes: s.kioskIdleMinutes || 2
  });
});

router.get("/designs", (req, res) => {
  const s = db.getSettings();
  let list = db.allDesigns().filter(d => d.visible !== false); // visible by default; explicit false hides it
  if (s.eventModeEnabled) {
    // curated mode: only show what's marked featured for the event
    list = list.filter(d => d.featured);
  }
  list = list.map(toPublicDesign).sort((a, b) => a.title.localeCompare(b.title));
  res.json({ data: list });
});

router.get("/designs/:slug", (req, res) => {
  const d = db.getDesign(req.params.slug);
  if (!d || d.visible === false) return res.status(404).json({ error: "not_found" });
  res.json(toPublicDesign(d));
});

router.post("/quote-request", quoteLimiter, async (req, res) => {
  if (!mailer.isConfigured()) {
    return res.status(503).json({ error: "Email quotes aren't set up yet — please contact us directly." });
  }

  const { name, email, notes, slugs } = req.body || {};

  if (!email || !EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (!Array.isArray(slugs) || slugs.length === 0) {
    return res.status(400).json({ error: "Select at least one design first." });
  }
  if (slugs.length > 25) {
    return res.status(400).json({ error: "That's a lot of designs at once — please split into a smaller request." });
  }

  const items = [];
  for (const slug of slugs) {
    const d = db.getDesign(String(slug));
    if (d && d.visible !== false) items.push(d);
  }
  if (items.length === 0) {
    return res.status(400).json({ error: "None of the selected designs could be found." });
  }

  const settings = db.getSettings();
  const customer = {
    name: name ? String(name).trim().slice(0, 120) : "",
    email: String(email).trim(),
    notes: notes ? String(notes).trim().slice(0, 500) : ""
  };

  // precompute the same totals the PDF will show, so the log matches what the customer received
  const totalSeconds = items.reduce((sum, d) => sum + (d.print_time_seconds || 0), 0);
  const pricedItems = items.filter(d => d.price_cents != null);
  const totalCents = pricedItems.reduce((sum, d) => sum + d.price_cents, 0);
  const leadTime = estimateLeadTimeDays(
    totalSeconds, settings.hoursPerDayCapacity || 6,
    settings.leadTimeBufferDays != null ? settings.leadTimeBufferDays : 2
  );
  const logBase = {
    customerName: customer.name,
    customerEmail: customer.email,
    notes: customer.notes,
    items: items.map(d => ({ slug: d.slug, title: d.title, price_cents: d.price_cents })),
    totalCents,
    leadTimeLow: leadTime.low,
    leadTimeHigh: leadTime.high
  };

  try {
    const pdfBuffer = await generateQuotePdf({ items, settings, customer });
    await mailer.sendQuoteEmail({
      to: customer.email,
      cc: settings.businessEmail || undefined,
      businessName: settings.businessName,
      customerName: customer.name,
      pdfBuffer
    });
    db.addQuoteLog(Object.assign({ status: "sent" }, logBase));
    res.json({ ok: true, itemCount: items.length });
  } catch (err) {
    console.error("[quote-request] failed:", err.message);
    db.addQuoteLog(Object.assign({ status: "failed", error: err.message }, logBase));
    res.status(502).json({ error: "Couldn't send the quote email — please try again shortly." });
  }
});

module.exports = router;
