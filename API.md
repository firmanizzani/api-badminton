# Smash Arena API

Base URL: `http://localhost:3000/api`

Envelope:

- Success: `{ "success": true, "data": ... }`
- Error: `{ "success": false, "message": "...", "code": "..." }`

Auth: httpOnly cookie `smash_session` (JWT + sessions table). Send `credentials: "include"` from the frontend.

Roles: `USER`, `ADMIN`.

Booking statuses: `PENDING | CONFIRMED | CANCELLED | COMPLETED | EXPIRED`

Payment statuses: `PENDING | PAID | FAILED | EXPIRED | REFUNDED`

Booking IDs returned by the API use `bookingCode` (e.g. `SMASH-YYYYMMDD-0001`) as `id`. Payment `booking_id` is the same code.

---

## Public

### GET /health
`{ success, data: { status: "ok" } }`

### POST /auth/register
Body: `{ name, email, phone, password }` (password min 6)
→ `201` PublicUser + sets cookie

### POST /auth/login
Body: `{ email, password }`
→ PublicUser + sets cookie
→ `401 INVALID_CREDENTIALS` | `403 ACCOUNT_DISABLED`

### POST /auth/logout
Clears cookie. → `{ data: null }`

### GET /auth/me
Requires cookie. → PublicUser
→ `401 UNAUTHENTICATED`

### GET /users/:id
Self or ADMIN. → user without password hash

### GET /courts
CourtSummary[] (excludes INACTIVE)

### GET /courts/:id
CourtSummary

### GET /courts/:id/schedules
Active schedules: `{ id, court_id, start_time, end_time, price, is_active }[]`

### GET /availability?date=YYYY-MM-DD&courtId=court-00001
TimeSlot[]: `{ start, end, status: "AVAILABLE"|"BOOKED", price }`
Schedule price falls back to court.price when null.

---

## Authenticated (USER)

### POST /bookings
Body:
```json
{
  "courtId": "court-00001",
  "bookingDate": "2026-09-24",
  "startTime": "19:00",
  "duration": 1,
  "customerName": "optional",
  "customerEmail": "optional",
  "customerPhone": "optional"
}
```
→ `201` BookingRecord (id = booking code, status `PENDING`, payment may be null)
→ `400 VALIDATION` | `404 COURT_NOT_FOUND` | `409 SLOT_TAKEN` / `COURT_CLOSED`

### GET /bookings
Own bookings (with court + payment embed)

### GET /bookings/:id
Own booking or ADMIN. `:id` = booking code

### POST /bookings/:id/cancel
Own booking. → BookingRecord status `CANCELLED`, payment → `REFUNDED` if applicable

### POST /payments
Body: `{ bookingId, method: "QRIS"|"BANK_TRANSFER"|"EWALLET", reference? }`
→ `201` PaymentRecord (`status: "PENDING"`, `booking_id` = booking code)
→ `404` | `409 ALREADY_PAID`

---

## Admin only (`ADMIN`)

### GET /admin/dashboard
→ `{ stats: { todaysBookings, revenue, pendingPayments, activeCourts, totalCourts }, recent: BookingRecord[] }`

### GET /admin/bookings
All bookings with embeds

### GET /admin/bookings/:id
### PATCH /admin/bookings/:id
Body: `{ status }` (booking statuses above)

### GET /admin/payments
PaymentRecord[] (`booking_id` = booking code)

### PATCH /admin/payments/:id
Body: `{ status: "PAID"|"FAILED"|"EXPIRED"|"REFUNDED", transactionId?, amount? }`
Setting `PAID` confirms the booking to `CONFIRMED`.

### GET /admin/customers
```json
[{ "id", "name", "email", "phone", "totalBookings", "totalSpending", "joinedAt", "status" }]
```
`totalBookings` counts all bookings; `totalSpending` excludes CANCELLED/EXPIRED.

### GET /admin/courts
CourtSummary + `schedules[]` (all courts incl. inactive)

### POST /admin/courts
Body: `{ name, type: "REGULAR"|"PREMIUM"|"VIP", price, description?, status?, facilities?, image?, alt? }`
→ `201` AdminCourtRecord. Id auto `court-0000N`.

### PATCH /admin/courts/:id
Partial body of create fields

### DELETE /admin/courts/:id
→ `409 COURT_HAS_BOOKINGS` if bookings exist

### POST /admin/courts/:id/schedules
Body: `{ startTime: "HH:MM", endTime: "HH:MM", price?, isActive? }`

### PATCH /admin/schedules/:id
Body: `{ startTime?, endTime?, price?, isActive? }`

### DELETE /admin/schedules/:id

### POST /payments/webhook
Header: `x-signature` = HMAC-SHA256 hex of raw body with `WEBHOOK_SECRET`
Body: `{ paymentId, status, transactionId?, amount?, reference? }`
→ PaymentRecord; amount mismatch → `400 AMOUNT_MISMATCH`; bad signature → `401`

---

## Seeded accounts

| Role | Email | Password |
|------|-------|----------|
| ADMIN | admin@example.com | Admin123! |
| USER | customer@example.com | Customer123! |

Courts: `court-00001`…`court-00006` (REGULAR 50k ×2, PREMIUM 75k ×2, VIP 100k ×2).
Schedules: `06:00`–`23:00` hourly per court, `price: null` (use court price).
