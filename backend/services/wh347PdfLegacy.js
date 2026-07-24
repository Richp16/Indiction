/**
 * Legacy WH-347 PDF builder using page.drawText() at hardcoded coordinates.
 * Kept as a rollback path when USE_NEW_WH347_EXPORT=false.
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

function resolveLegacyTemplatePath() {
  const candidates = [
    path.join(__dirname, '../assets/wh347.pdf'),
    path.join(__dirname, '../assets/WH-347.pdf'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * @param {{
 *   site: object,
 *   company: object,
 *   weekEndingDate: string,
 *   payrollNumber: number|string,
 *   workers: object[],
 *   supplementsByWorker: Map,
 * }} params
 * @returns {Promise<Buffer>}
 */
async function buildWh347PdfLegacy({
  site,
  company,
  weekEndingDate,
  payrollNumber,
  workers,
  supplementsByWorker,
}) {
  const templatePath = resolveLegacyTemplatePath();
  if (!templatePath) {
    const error = new Error('Place WH-347 template at backend/assets/wh347.pdf');
    error.statusCode = 500;
    throw error;
  }

  const templateBytes = fs.readFileSync(templatePath);
  const templateDoc = await PDFDocument.load(templateBytes);
  const outDoc = await PDFDocument.create();
  const font = await outDoc.embedFont(StandardFonts.Helvetica);
  const black = rgb(0, 0, 0);

  const pageCount = Math.max(1, Math.ceil(workers.length / 8));
  for (let i = 0; i < pageCount; i += 1) {
    const [page] = await outDoc.copyPages(templateDoc, [0]);
    outDoc.addPage(page);
    if (i === 0 && templateDoc.getPageCount() > 1) {
      const [statement] = await outDoc.copyPages(templateDoc, [1]);
      outDoc.addPage(statement);
    }

    const batch = workers.slice(i * 8, i * 8 + 8);
    page.drawText(site.name || '', { x: 160, y: 714, size: 7, font, color: black });
    page.drawText(site.contract_number || site.job_code || '', { x: 355, y: 714, size: 7, font, color: black });
    // CERTIFIED PAYROLL NO. left blank intentionally.
    page.drawText(company.company_name || '', { x: 160, y: 699, size: 7, font, color: black });
    page.drawText(site.address || '', { x: 160, y: 684, size: 7, font, color: black });
    page.drawText(weekEndingDate, { x: 510, y: 684, size: 7, font, color: black });
    page.drawText(company.company_address || '', { x: 160, y: 669, size: 7, font, color: black });

    batch.forEach((worker, idx) => {
      const supplement = supplementsByWorker.get(worker.id) || {};
      const baseY = 638 - idx * 28;
      const otY = baseY - 12;
      const totalSt = Object.values(worker.days).reduce((acc, d) => acc + d.st, 0);
      const totalOt = Object.values(worker.days).reduce((acc, d) => acc + d.ot, 0);
      const grossThisJob = totalSt * worker.pay_rate + totalOt * worker.pay_rate * 1.5;
      const totalDeductions =
        Number(supplement.deduction_withholding || 0) +
        Number(supplement.deduction_fica || 0) +
        Number(supplement.deduction_other || 0);

      page.drawText(String(i * 8 + idx + 1), { x: 18, y: baseY, size: 7, font, color: black });
      page.drawText(worker.last_name, { x: 34, y: baseY, size: 7, font, color: black });
      page.drawText(worker.first_name, { x: 82, y: baseY, size: 7, font, color: black });
      page.drawText(
        String(supplement.paychex_worker_number || worker.identifying_number || ''),
        { x: 152, y: baseY, size: 7, font, color: black }
      );
      page.drawText(worker.wh347WorkerType || 'J', { x: 190, y: baseY, size: 7, font, color: black });
      page.drawText(worker.labor_classification, {
        x: 200,
        y: baseY,
        size: worker.labor_classification.length > 20 ? 6 : 7,
        font,
        color: black,
      });
      const dayXs = { mon: 268, tue: 290, wed: 312, thu: 334, fri: 356, sat: 378, sun: 400 };
      Object.entries(dayXs).forEach(([k, x]) => {
        page.drawText(String(worker.days[k].st || ''), { x, y: baseY, size: 7, font, color: black });
        page.drawText(String(worker.days[k].ot || ''), { x, y: otY, size: 7, font, color: black });
      });
      page.drawText(totalSt.toFixed(2), { x: 424, y: baseY, size: 7, font, color: black });
      page.drawText(totalOt.toFixed(2), { x: 424, y: otY, size: 7, font, color: black });
      page.drawText(worker.pay_rate.toFixed(2), { x: 442, y: baseY, size: 7, font, color: black });
      page.drawText(String(supplement.fringe_benefit_credit || ''), {
        x: 460,
        y: baseY,
        size: 7,
        font,
        color: black,
      });
      page.drawText(String(supplement.fringe_paid_in_lieu || ''), {
        x: 474,
        y: baseY,
        size: 7,
        font,
        color: black,
      });
      page.drawText(grossThisJob.toFixed(2), { x: 488, y: baseY, size: 7, font, color: black });
      page.drawText(String(supplement.gross_earned_all_work || ''), {
        x: 504,
        y: baseY,
        size: 7,
        font,
        color: black,
      });
      page.drawText(String(supplement.deduction_withholding || ''), {
        x: 520,
        y: baseY,
        size: 7,
        font,
        color: black,
      });
      page.drawText(String(supplement.deduction_fica || ''), {
        x: 536,
        y: baseY,
        size: 7,
        font,
        color: black,
      });
      page.drawText(String(supplement.deduction_other_label || ''), {
        x: 548,
        y: baseY,
        size: 5,
        font,
        color: black,
      });
      page.drawText(String(supplement.deduction_other || ''), {
        x: 550,
        y: otY,
        size: 7,
        font,
        color: black,
      });
      page.drawText(totalDeductions.toFixed(2), { x: 562, y: baseY, size: 7, font, color: black });
      page.drawText(String(supplement.net_pay || ''), { x: 578, y: baseY, size: 7, font, color: black });
    });
  }

  if (outDoc.getPageCount() > 1) {
    const statement = outDoc.getPage(outDoc.getPageCount() - 1);
    statement.drawText(site.name || '', { x: 160, y: 714, size: 7, font, color: black });
    statement.drawText(site.contract_number || site.job_code || '', { x: 355, y: 714, size: 7, font, color: black });
    // CERTIFIED PAYROLL NO. left blank intentionally.
    statement.drawText(company.company_name || '', { x: 160, y: 699, size: 7, font, color: black });
    statement.drawText(site.address || '', { x: 160, y: 684, size: 7, font, color: black });
    statement.drawText(weekEndingDate, { x: 510, y: 684, size: 7, font, color: black });
    statement.drawText(
      `${company.certifying_official_name || ''} ${company.certifying_official_title || ''}`.trim(),
      { x: 160, y: 100, size: 7, font, color: black }
    );
    statement.drawText(company.phone || '', { x: 160, y: 88, size: 7, font, color: black });
    statement.drawText(company.email || '', { x: 300, y: 88, size: 7, font, color: black });
  }

  return Buffer.from(await outDoc.save());
}

module.exports = {
  buildWh347PdfLegacy,
  resolveLegacyTemplatePath,
};
