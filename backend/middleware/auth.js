const jwt = require('jsonwebtoken');
const {
  validateSession,
  SESSION_IDLE_SECONDS,
} = require('../services/sessionService');

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
    });
  }

  const token = header.slice(7);
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
    });
  }

  const userId = decoded.userId;
  const sessionId = decoded.sessionId || null;

  // Legacy tokens without sessionId (issued before session tracking) are rejected
  // so clients re-login into a tracked session.
  if (!sessionId) {
    return res.status(401).json({
      code: 'SESSION_EXPIRED',
      message: 'Your session expired — please log in again',
    });
  }

  validateSession(sessionId, userId)
    .then((result) => {
      if (!result.ok) {
        return res.status(401).json({
          code: result.code,
          message: result.message,
        });
      }

      req.user = {
        userId,
        role: decoded.role,
        sessionId,
      };
      console.log(
        '[AUTH]',
        req.method,
        req.path,
        'user:',
        req.user?.userId,
        'role:',
        req.user?.role
      );
      next();
    })
    .catch((error) => {
      console.error('[AUTH] session check failed:', error.message);
      res.status(500).json({ message: 'Authentication error' });
    });
}

module.exports = auth;
module.exports.SESSION_IDLE_SECONDS = SESSION_IDLE_SECONDS;
