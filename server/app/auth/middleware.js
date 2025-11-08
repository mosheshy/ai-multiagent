import { verifyToken } from "./jwt.js";

export function requireAuth() {
  return (req, res, next) => {
    const authHeader = (req.headers && req.headers.authorization) || req.query.token;
    if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    try {
      const user = verifyToken(token);
      req.user = user;
      return next();
    } catch (e) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}
