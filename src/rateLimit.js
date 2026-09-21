"use strict";
// Minimal in-memory rate limiter. Good enough for a single-container,
// low-traffic storefront guarding an email-sending endpoint from abuse.
// Resets on restart and doesn't share state across replicas — fine at this
// scale, worth knowing if this ever gets scaled horizontally.

function rateLimit({ windowMs, max }) {
  const hits = new Map(); // ip -> [timestamps]

  return function (req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) {
      return res.status(429).json({ error: "Too many requests — please wait a bit and try again." });
    }
    arr.push(now);
    hits.set(ip, arr);

    // occasional cleanup so the map doesn't grow forever
    if (hits.size > 5000) {
      for (const [k, v] of hits) {
        if (v.every(t => now - t >= windowMs)) hits.delete(k);
      }
    }
    next();
  };
}

module.exports = { rateLimit };
