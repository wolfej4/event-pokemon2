"use strict";
// Minimal Square Catalog API client — no SDK, just fetch (Node 20+ has
// fetch/FormData/Blob built in). Pushes a design's photo + description to
// Square as a catalog item with its price left at $0 so the price can be
// set/edited from Square itself afterward.

const sharp = require("sharp");

const SQUARE_VERSION = "2024-06-04";

function isConfigured() {
  return !!(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID);
}

function getConfig() {
  if (!isConfigured()) {
    const err = new Error("Square is not configured (set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID)");
    err.isNotConfigured = true;
    throw err;
  }
  return {
    token: process.env.SQUARE_ACCESS_TOKEN,
    locationId: process.env.SQUARE_LOCATION_ID,
    base: process.env.SQUARE_ENVIRONMENT === "sandbox"
      ? "https://connect.squareupsandbox.com"
      : "https://connect.squareup.com"
  };
}

function idempotencyKey() {
  return "n3d-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

async function squareFetch(path, options = {}) {
  const { token, base } = getConfig();
  const headers = Object.assign(
    {
      Authorization: "Bearer " + token,
      "Square-Version": SQUARE_VERSION
    },
    options.headers || {}
  );
  const res = await fetch(base + path, Object.assign({}, options, { headers }));

  let json = null;
  try { json = await res.json(); } catch (_) { /* no body */ }

  if (!res.ok) {
    const detail = json && Array.isArray(json.errors) && json.errors[0]
      ? json.errors[0].detail || json.errors[0].code
      : "Square request failed (" + res.status + ")";
    const err = new Error(detail);
    if (res.status === 401 || res.status === 403) err.isAuth = true;
    if (res.status === 404) err.isNotFound = true;
    throw err;
  }
  return json || {};
}

function buildDescription(d) {
  const parts = [];
  if (d.pokemon && d.pokemon.description) parts.push(d.pokemon.description);
  if (d.pokemon && Array.isArray(d.pokemon.types) && d.pokemon.types.length) {
    parts.push("Type: " + d.pokemon.types.join(" / "));
  }
  if (d.print_time) parts.push("Print time: " + d.print_time);
  if (d.total_weight_grams != null) parts.push("Weight: " + d.total_weight_grams + "g");
  return parts.join("\n\n") || d.title;
}

/**
 * Create or update the Square catalog item + variation for a design, then
 * create/replace its catalog image if the design has a photo. Price is
 * always left at $0 — the idea is to get the listing (photo + description)
 * into Square and set the real price there.
 *
 * `design` is the raw db record (has square_item_id/square_variation_id/
 * square_image_id/square_image_url from a previous sync, if any).
 * Returns the fields to persist back onto the design.
 */
async function pushDesign(design) {
  const { locationId } = getConfig();

  // Start from whatever we have on file, but fall back to creating a brand
  // new item/image if what we have on file was deleted on the Square side
  // since the last push — otherwise we'd try to update an object that no
  // longer exists and the whole push would fail.
  let itemId = design.square_item_id || null;
  let variationId = design.square_variation_id || null;
  let imageId = design.square_image_id || null;
  let imageUrlSynced = design.square_image_url || null;
  let itemVersion, variationVersion;
  let wasRecreated = false;

  if (itemId) {
    try {
      const existing = await squareFetch("/v2/catalog/object/" + encodeURIComponent(itemId));
      if (existing.object.is_deleted) throw Object.assign(new Error("deleted"), { isNotFound: true });
      itemVersion = existing.object.version;
      const existingVariation = variationId
        ? existing.object.item_data.variations.find(v => v.id === variationId)
        : null;
      if (existingVariation) variationVersion = existingVariation.version;
    } catch (err) {
      if (!err.isNotFound) throw err;
      // item was deleted in Square — forget the old ids and recreate fresh,
      // including a fresh image upload since the old one likely went with it
      itemId = null; variationId = null; imageId = null; imageUrlSynced = null;
      wasRecreated = true;
    }
  }

  const itemVariation = {
    type: "ITEM_VARIATION",
    id: variationId || "#variation",
    item_variation_data: {
      name: "Regular",
      pricing_type: "FIXED_PRICING",
      price_money: { amount: 0, currency: "USD" },
      track_inventory: false
    }
  };
  if (variationVersion !== undefined) itemVariation.version = variationVersion;

  const item = {
    type: "ITEM",
    id: itemId || "#item",
    item_data: {
      name: design.title,
      description: buildDescription(design),
      present_at_all_locations: false,
      present_at_location_ids: [locationId],
      variations: [itemVariation]
    }
  };
  if (itemVersion !== undefined) item.version = itemVersion;

  const upsertRes = await squareFetch("/v2/catalog/object", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idempotency_key: idempotencyKey(), object: item })
  });

  const savedItem = upsertRes.catalog_object;
  itemId = savedItem.id;
  variationId = savedItem.item_data.variations[0].id;

  const result = {
    square_item_id: itemId,
    square_variation_id: variationId,
    square_synced_at: new Date().toISOString()
  };

  if (design.image_url) {
    const needsImage = !imageId || imageUrlSynced !== design.image_url;
    if (needsImage) {
      imageId = await uploadImage({
        imageUrl: design.image_url,
        itemId,
        existingImageId: imageId,
        caption: design.title
      });
      result.square_image_id = imageId;
      result.square_image_url = design.image_url;
    }
  } else if (wasRecreated) {
    // no photo to re-upload, but clear the stale image reference from the deleted item
    result.square_image_id = null;
    result.square_image_url = null;
  }

  return result;
}

// Square's catalog image upload only accepts JPEG or PNG — not WebP, which
// is what N3D serves. Re-encode anything else: PNG if the source has
// transparency (to keep it), JPEG otherwise.
const SQUARE_OK_FORMATS = new Set(["jpeg", "png"]);

async function normalizeImageForSquare(buffer) {
  const meta = await sharp(buffer).metadata();
  if (SQUARE_OK_FORMATS.has(meta.format)) {
    const ext = meta.format === "jpeg" ? "jpg" : meta.format;
    return { buffer, contentType: "image/" + meta.format, filename: "design." + ext };
  }
  if (meta.hasAlpha) {
    const out = await sharp(buffer).png().toBuffer();
    return { buffer: out, contentType: "image/png", filename: "design.png" };
  }
  const out = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
  return { buffer: out, contentType: "image/jpeg", filename: "design.jpg" };
}

async function postImage({ buffer, contentType, filename, itemId, existingImageId, caption }) {
  const blob = new Blob([buffer], { type: contentType });
  const request = existingImageId
    ? { idempotency_key: idempotencyKey() }
    : {
        idempotency_key: idempotencyKey(),
        object_id: itemId,
        image: { type: "IMAGE", id: "#image", image_data: { caption } }
      };

  const form = new FormData();
  form.append("request", JSON.stringify(request));
  form.append("image_file", blob, filename);

  const path = existingImageId
    ? "/v2/catalog/images/" + encodeURIComponent(existingImageId)
    : "/v2/catalog/images";

  const res = await squareFetch(path, { method: "POST", body: form });
  return res.image.id;
}

async function uploadImage({ imageUrl, itemId, existingImageId, caption }) {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error("Couldn't download design image to upload to Square");
  const raw = Buffer.from(await imgRes.arrayBuffer());
  const normalized = await normalizeImageForSquare(raw);

  if (!existingImageId) {
    return postImage(Object.assign({}, normalized, { itemId, caption }));
  }
  try {
    return await postImage(Object.assign({}, normalized, { existingImageId, caption }));
  } catch (err) {
    if (!err.isNotFound) throw err;
    // the image we were about to update was itself deleted in Square —
    // create a fresh one and link it to the item instead
    return postImage(Object.assign({}, normalized, { itemId, caption }));
  }
}

module.exports = { isConfigured, pushDesign };
