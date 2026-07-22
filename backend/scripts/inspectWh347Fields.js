/**
 * One-time / dev utility: list AcroForm fields on the WH-347 fillable template.
 *
 * Input:  assets/WH-347.pdf
 * Output: templates/wh347-fields.json
 *
 * Usage: npm run inspect:wh347
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const TEMPLATE_PATH = path.join(__dirname, '..', 'assets', 'WH-347.pdf');
const OUT_JSON_PATH = path.join(__dirname, '..', 'templates', 'wh347-fields.json');

/**
 * Best-effort page index (1-based) for a field's first widget.
 * Matching widget P (page) refs to doc.getPages() is somewhat brittle across
 * PDF producers — we try ref equality / object number, then fall back to null.
 */
function resolveWidgetPage(doc, field) {
  try {
    const pages = doc.getPages();
    const pageRefs = pages.map((page) => page.ref);
    const widgets = field.acroField.getWidgets();
    if (!widgets.length) return null;

    const widgetPageRef = widgets[0].P();
    if (!widgetPageRef) return null;

    for (let i = 0; i < pageRefs.length; i += 1) {
      const pageRef = pageRefs[i];
      if (pageRef === widgetPageRef) return i + 1;
      if (
        pageRef &&
        widgetPageRef &&
        typeof pageRef.tag === 'number' &&
        typeof widgetPageRef.tag === 'number' &&
        pageRef.tag === widgetPageRef.tag
      ) {
        return i + 1;
      }
      if (
        pageRef &&
        widgetPageRef &&
        String(pageRef) === String(widgetPageRef)
      ) {
        return i + 1;
      }
    }
  } catch {
    // Page mapping is best-effort only.
  }
  return null;
}

function inspectField(doc, field) {
  const name = field.getName();
  const type = field.constructor.name;
  let maxLength = null;

  if (typeof field.getMaxLength === 'function') {
    try {
      maxLength = field.getMaxLength();
    } catch {
      maxLength = null;
    }
  }

  const page = resolveWidgetPage(doc, field);

  return { name, type, maxLength: maxLength ?? null, page };
}

function printSummary(fields) {
  const byPage = new Map();
  for (const field of fields) {
    const key = field.page == null ? 'unknown' : String(field.page);
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key).push(field);
  }

  const pageKeys = [...byPage.keys()].sort((a, b) => {
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    return Number(a) - Number(b);
  });

  console.log('');
  console.log('WH-347 AcroForm field summary');
  console.log('='.repeat(72));
  console.log(`Template: ${TEMPLATE_PATH}`);
  console.log(`Total fields: ${fields.length}`);
  console.log('');

  for (const pageKey of pageKeys) {
    const group = byPage.get(pageKey).slice().sort((a, b) => a.name.localeCompare(b.name));
    const heading = pageKey === 'unknown' ? 'Page unknown' : `Page ${pageKey}`;
    console.log(`--- ${heading} (${group.length} fields) ---`);
    console.log(
      `${'Name'.padEnd(42)} ${'Type'.padEnd(16)} ${'MaxLen'.padStart(6)}`
    );
    console.log('-'.repeat(72));
    for (const field of group) {
      const max =
        field.maxLength == null ? '—' : String(field.maxLength);
      console.log(
        `${field.name.padEnd(42)} ${field.type.padEnd(16)} ${max.padStart(6)}`
      );
    }
    console.log('');
  }
}

async function main() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error(`Template not found: ${TEMPLATE_PATH}`);
    process.exit(1);
  }

  const bytes = fs.readFileSync(TEMPLATE_PATH);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const rawFields = form.getFields();

  const fields = rawFields.map((field) => inspectField(doc, field));
  fields.sort((a, b) => {
    const pageA = a.page == null ? 999 : a.page;
    const pageB = b.page == null ? 999 : b.page;
    if (pageA !== pageB) return pageA - pageB;
    return a.name.localeCompare(b.name);
  });

  fs.mkdirSync(path.dirname(OUT_JSON_PATH), { recursive: true });
  fs.writeFileSync(OUT_JSON_PATH, `${JSON.stringify(fields, null, 2)}\n`, 'utf8');

  printSummary(fields);
  console.log(`Wrote ${fields.length} fields → ${OUT_JSON_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
