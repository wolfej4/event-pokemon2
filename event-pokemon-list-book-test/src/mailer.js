"use strict";
const nodemailer = require("nodemailer");

let transporter = null;
let configWarningShown = false;

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!isConfigured()) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true", // true for port 465, false for 587/STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  return transporter;
}

/**
 * Send the quote PDF to the customer, cc'ing the business if configured.
 * Throws if SMTP isn't configured or the send fails — callers should catch
 * and turn that into a friendly API response.
 */
async function sendQuoteEmail({ to, cc, businessName, customerName, pdfBuffer }) {
  const t = getTransporter();
  if (!t) {
    const err = new Error("SMTP is not configured on this server");
    err.isNotConfigured = true;
    throw err;
  }

  const fromName = process.env.SMTP_FROM_NAME || businessName || "Design Catalog";
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;

  const greetingName = customerName ? customerName.split(" ")[0] : "there";
  const bizLabel = businessName || "us";

  await t.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    cc: cc || undefined,
    replyTo: cc || undefined,
    subject: `Your quote from ${bizLabel}`,
    text:
      `Hi ${greetingName},\n\n` +
      `Attached is your quote from ${bizLabel}, including estimated lead time and cost ` +
      `for the design(s) you selected.\n\n` +
      `This is an automated estimate — reply to this email if you have questions or ` +
      `want to confirm the order.\n\n` +
      `Thanks,\n${bizLabel}`,
    attachments: [
      { filename: "quote.pdf", content: pdfBuffer, contentType: "application/pdf" }
    ]
  });
}

async function verifyConnection() {
  const t = getTransporter();
  if (!t) {
    const err = new Error("SMTP is not configured");
    err.isNotConfigured = true;
    throw err;
  }
  return t.verify();
}

module.exports = { isConfigured, sendQuoteEmail, verifyConnection };
