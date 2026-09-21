"use strict";
const PDFDocument = require("pdfkit");

function formatMoney(cents) {
  return "$" + (cents / 100).toFixed(2);
}

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h === 0) return m + "m";
  if (m === 0) return h + "h";
  return h + "h " + m + "m";
}

/**
 * Estimate lead time from total print seconds using the shop's daily
 * printer-hour capacity plus a fixed buffer (queue, packing, shipping).
 * This is intentionally simple and conservative — it's a customer-facing
 * estimate, not a production schedule.
 */
function estimateLeadTimeDays(totalSeconds, hoursPerDayCapacity, bufferDays) {
  const totalHours = totalSeconds / 3600;
  const printDays = Math.max(1, Math.ceil(totalHours / hoursPerDayCapacity));
  const low = printDays + bufferDays;
  const high = low + 2; // small range to account for queue variance
  return { low, high };
}

/**
 * items: array of design objects (from db) that were requested
 * settings: { businessName, hoursPerDayCapacity, leadTimeBufferDays }
 * customer: { name, email, notes }
 * Returns a Promise<Buffer> of the rendered PDF.
 */
function generateQuotePdf({ items, settings, customer }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: "LETTER" });
      const chunks = [];
      doc.on("data", c => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const totalSeconds = items.reduce((sum, d) => sum + (d.print_time_seconds || 0), 0);
      const pricedItems = items.filter(d => d.price_cents != null);
      const unpricedItems = items.filter(d => d.price_cents == null);
      const totalCents = pricedItems.reduce((sum, d) => sum + d.price_cents, 0);
      const leadTime = estimateLeadTimeDays(
        totalSeconds,
        settings.hoursPerDayCapacity || 6,
        settings.leadTimeBufferDays != null ? settings.leadTimeBufferDays : 2
      );

      const businessName = settings.businessName || "Design Catalog";

      // Header
      doc.fontSize(20).font("Helvetica-Bold").text(businessName);
      doc.fontSize(11).font("Helvetica").fillColor("#555").text("Design Quote");
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor("#888").text(new Date().toLocaleDateString(undefined, {
        year: "numeric", month: "long", day: "numeric"
      }));
      doc.fillColor("#000");
      doc.moveDown(1);

      // Customer block
      doc.fontSize(10).font("Helvetica-Bold").text("Prepared for");
      doc.font("Helvetica").fontSize(10);
      doc.text(customer.name || "Customer");
      doc.text(customer.email);
      if (customer.notes) {
        doc.moveDown(0.3);
        doc.font("Helvetica-Oblique").fontSize(9).fillColor("#555").text('"' + customer.notes + '"');
        doc.fillColor("#000").font("Helvetica");
      }
      doc.moveDown(1.2);

      // Items table
      doc.font("Helvetica-Bold").fontSize(10);
      const colX = { title: 50, time: 330, price: 460 };
      const rowTop = doc.y;
      doc.text("Design", colX.title, rowTop);
      doc.text("Print time", colX.time, rowTop);
      doc.text("Price", colX.price, rowTop);
      doc.moveDown(0.4);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#ccc").stroke();
      doc.moveDown(0.4);

      doc.font("Helvetica").fontSize(10);
      for (const d of items) {
        const y = doc.y;
        doc.text(d.title, colX.title, y, { width: 260 });
        doc.text(d.print_time || "—", colX.time, y, { width: 110 });
        doc.text(d.price_cents != null ? formatMoney(d.price_cents) : "TBD", colX.price, y, { width: 80 });
        doc.moveDown(0.6);
      }

      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#ccc").stroke();
      doc.moveDown(0.8);

      // Totals
      doc.font("Helvetica-Bold").fontSize(11);
      doc.text("Total estimated print time: " + formatDuration(totalSeconds));
      doc.text("Estimated lead time: " + leadTime.low + "–" + leadTime.high + " business days");
      doc.text(
        "Estimated cost: " + formatMoney(totalCents) +
        (unpricedItems.length ? "  (+ " + unpricedItems.length + " item" + (unpricedItems.length > 1 ? "s" : "") + " priced on request)" : "")
      );

      doc.moveDown(1.2);
      doc.font("Helvetica-Oblique").fontSize(8).fillColor("#888").text(
        "This is an automated estimate based on printer capacity of " +
        (settings.hoursPerDayCapacity || 6) + " hour(s)/day and a " +
        (settings.leadTimeBufferDays != null ? settings.leadTimeBufferDays : 2) +
        "-day buffer for queueing and shipping. Final pricing and timeline will be confirmed directly.",
        { width: 495 }
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateQuotePdf, formatDuration, formatMoney, estimateLeadTimeDays };
