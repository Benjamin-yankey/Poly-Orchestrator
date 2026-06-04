// Shared JWT helpers for the Products/core API service.
// The signing secret is an env var (JWT_SECRET) so every service that needs to
// verify a token shares the same key — set it identically across services in
// docker-compose / ECS task defs / k8s manifests. The default is for local dev
// only; override it everywhere in production (Secrets Manager / k8s secrets).

const jwt = require("jsonwebtoken");
const { hasCap } = require("./capabilities");

const JWT_SECRET = process.env.JWT_SECRET || "shopnow_dev_secret_change_me";
const JWT_TTL = process.env.JWT_TTL || "12h";

// Role catalog (RBAC). Order is from most to least privileged.
//   admin         — full system access; the only role that can manage roles.
//   staffing_team — read-only access to management data (no writes).
//   employee      — basic authenticated access (internal user, no storefront).
//   customer      — storefront user: can buy and sell.
const ROLES = ["admin", "staffing_team", "employee", "customer"];
// Roles allowed to read the admin/management area.
const MANAGEMENT_ROLES = ["admin", "staffing_team"];

// Build a token from a user row. Payload is intentionally small. `department`
// is only meaningful for role === 'employee' (drives capability checks); it is
// null for everyone else, and absent on tokens minted before this change (the
// holder simply has no employee capabilities until they re-login).
function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, department: user.department || null },
    JWT_SECRET,
    { expiresIn: JWT_TTL }
  );
}

// Express middleware: require a valid Bearer token; attaches req.user.
function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "authentication required" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "invalid or expired token" });
  }
}

// Express middleware: require the authenticated user to be an admin. Used to
// gate every mutation in the management area (role changes, deletes, catalog
// writes) — only admins may change state.
function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "admin access required" });
  }
  next();
}

// Express middleware: allow read-only access to management data for admins and
// the staffing team. Mutations still go through adminRequired.
function managementRead(req, res, next) {
  if (!req.user || !MANAGEMENT_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: "management access required" });
  }
  next();
}

// Express middleware factory: gate a WRITE on an employee capability. Admins
// always pass (they hold every capability); an employee passes only if their
// department grants `cap`. staffing_team is read-only, so it never passes here.
// Use this in place of adminRequired on operational mutations employees perform.
function requireCap(cap) {
  return (req, res, next) => {
    const u = req.user;
    if (u && u.role === "admin") return next();
    if (u && u.role === "employee" && hasCap(u.department, cap)) return next();
    return res.status(403).json({ error: "insufficient permissions for this action" });
  };
}

// Express middleware factory: gate a READ on an employee capability. Admins and
// the staffing team (read-only management) always pass; an employee passes only
// if their department grants `cap`. Use in place of managementRead on the
// operational data feeds the employee dashboard reads.
function requireCapRead(cap) {
  return (req, res, next) => {
    const u = req.user;
    if (u && MANAGEMENT_ROLES.includes(u.role)) return next();
    if (u && u.role === "employee" && hasCap(u.department, cap)) return next();
    return res.status(403).json({ error: "insufficient permissions" });
  };
}

module.exports = {
  signToken,
  authRequired,
  adminRequired,
  managementRead,
  requireCap,
  requireCapRead,
  ROLES,
  MANAGEMENT_ROLES,
  JWT_SECRET,
};
