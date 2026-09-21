"use strict";
const crypto = require("crypto");

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // still run a comparison of equal length to avoid leaking length via timing
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function checkPassword(candidate) {
  const real = process.env.ADMIN_PASSWORD || "";
  if (!real) return false;
  return timingSafeEqual(candidate || "", real);
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: "not_authenticated" });
}

module.exports = { checkPassword, requireAdmin };
