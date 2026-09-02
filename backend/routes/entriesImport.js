const express = require('express');
const multer = require('multer');
const { requireRole } = require('../middleware/roleGuard');
const { requireGlobalEditLock } = require('../middleware/editLock');
const { requirePaychexDisabled } = require('../middleware/paychexGuard');
const {
  previewImport,
  commitImport,
  buildImportTemplateWorkbook,
} = require('../services/entriesImportService');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(requireRole('system_admin', 'payroll_admin'));
router.use(requirePaychexDisabled);

router.get('/template', (_req, res) => {
  const buffer = buildImportTemplateWorkbook();
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="indiction-time-entries-template.xlsx"'
  );
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

router.post('/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: 'file is required' });
    }
    const result = await previewImport(req.file.buffer, {
      filename: req.file.originalname,
    });
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

router.post('/commit', requireGlobalEditLock, async (req, res) => {
  try {
    const { importId, mode, createWorkers } = req.body || {};
    if (!importId) {
      return res.status(400).json({ message: 'importId is required' });
    }
    const result = await commitImport({
      importId,
      mode: mode === 'replace' ? 'replace' : 'merge',
      createWorkers: Array.isArray(createWorkers) ? createWorkers : [],
      enteredBy: req.user?.userId,
    });
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

module.exports = router;
