const express = require('express');
const { getAppConfig } = require('../middleware/paychexGuard');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const config = await getAppConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
