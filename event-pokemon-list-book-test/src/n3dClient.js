"use strict";

const BASE = "https://www.n3dmelbourne.com/api/v1";

function getKey() {
  const key = process.env.N3D_API_KEY;
  if (!key) throw new Error("N3D_API_KEY is not set");
  return key;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function request(path) {
  const res = await fetch(BASE + path, {
    headers: { Authorization: "Bearer " + getKey() }
  });

  if (res.status === 429) {
    const reset = res.headers.get("X-RateLimit-Reset");
    const err = new Error("rate_limited");
    err.isRateLimit = true;
    err.resetAt = reset ? Number(reset) * 1000 : Date.now() + 15000;
    throw err;
  }
  if (res.status === 401) {
    const err = new Error("N3D API key was rejected (401)");
    err.isAuth = true;
    throw err;
  }
  if (!res.ok) {
    let msg = "N3D request failed (" + res.status + ")";
    try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

async function checkKey() {
  return request("/me");
}

/**
 * Pull the full catalog (or just what changed since `since`), page by page.
 * onPage(designArray) is called after each page so callers can persist
 * incrementally instead of holding everything in memory.
 */
async function syncCatalog({ since, onPage } = {}) {
  let page = 1;
  let hasNext = true;
  let maxUpdated = since || null;
  let totalSeen = 0;

  while (hasNext) {
    const params = new URLSearchParams({
      limit: "200",
      include: "details",
      include_extras: "true",
      page: String(page)
    });
    if (since) params.set("updated_since", since);

    let json;
    try {
      json = await request("/designs?" + params.toString());
    } catch (err) {
      if (err.isRateLimit) {
        const wait = Math.max(1000, err.resetAt - Date.now()) + 500;
        await sleep(wait);
        continue; // retry same page
      }
      throw err;
    }

    for (const d of json.data) {
      if (d.updated_at && (!maxUpdated || d.updated_at > maxUpdated)) maxUpdated = d.updated_at;
    }
    totalSeen += json.data.length;
    if (onPage) await onPage(json.data);

    hasNext = json.pagination && json.pagination.has_next;
    page += 1;
    if (hasNext) await sleep(250); // be polite between pages
  }

  return { cursor: maxUpdated, totalSeen };
}

module.exports = { checkKey, syncCatalog };
