// Employee capability model (RBAC, second axis).
//
// `role` (in auth.js) is the privilege TIER: admin > staffing_team > employee >
// customer. For role === 'employee' a second axis — the employee's DEPARTMENT —
// decides WHICH operational areas they may touch. Capabilities are derived from
// the department here; they are never stored per-user.
//
// IMPORTANT: this map is mirrored on the frontend in
//   app/frontend/web/src/app/core/models.ts  (DEPARTMENT_CAPS)
// Keep the two in sync. The frontend copy only gates the UI; THIS copy is the
// real enforcement (see requireCap / requireCapRead in auth.js).

// The six operational departments an employee can belong to.
const DEPARTMENTS = [
  "support",
  "warehouse",
  "marketing",
  "order_processing",
  "content",
  "logistics",
];

// The capabilities a department may hold. Each maps onto a coherent set of API
// endpoints (see auth.js usage in server.js).
const CAPABILITIES = [
  "orders.manage", // view the order queue, advance status, ship, cancel
  "returns.manage", // view + decide return/refund requests
  "support.manage", // view the ticket queue, reply as staff, set status
  "products.manage", // create/edit/delete catalog products incl. stock
  "coupons.manage", // create/edit/disable promo codes
  "reviews.manage", // moderate (approve/remove) product reviews
  "reports.view", // read the operational dashboard / stats
];

// Department -> capabilities. Mirrors the six employee roles in the spec.
const DEPARTMENT_CAPS = {
  support: ["support.manage", "returns.manage", "orders.manage", "reports.view"],
  warehouse: ["products.manage", "orders.manage", "reports.view"],
  marketing: ["coupons.manage", "reviews.manage", "reports.view"],
  order_processing: ["orders.manage", "returns.manage", "reports.view"],
  content: ["products.manage", "reviews.manage", "reports.view"],
  logistics: ["orders.manage", "reports.view"],
};

// Capabilities granted to a department (empty for unknown/unset departments).
function capsFor(department) {
  return DEPARTMENT_CAPS[department] || [];
}

// Does a department hold a capability?
function hasCap(department, cap) {
  return capsFor(department).includes(cap);
}

module.exports = { DEPARTMENTS, CAPABILITIES, DEPARTMENT_CAPS, capsFor, hasCap };
