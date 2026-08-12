const express = require('express');
const { getAccountFeatures } = require('../services/accountMode');

const router = express.Router();

router.get('/features', async (_req, res) => {
  try {
    const features = await getAccountFeatures();
    res.json(features);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
