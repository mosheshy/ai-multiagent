import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "dev-jwt-secret";

export function generateToken(payload, opts = {}) {
  const options = Object.assign({ expiresIn: "12h" }, opts);
  return jwt.sign(payload, SECRET, options);
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}
