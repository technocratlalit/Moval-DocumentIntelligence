# Laravel Backend — aimodule Integration Tasks

**For:** Laravel team (.in + .com)  
**aimodule URL (internal only):** `http://127.0.0.1:3000`  
**Rule:** Frontend → Laravel only. Laravel → aimodule. Never browser → aimodule.

See also: [`LARAVEL.md`](LARAVEL.md) for webhook security and workshop result shape.

---

## 1. What Laravel must add / update

| # | Task | Priority |
|---|------|----------|
| 1 | Add `.env` vars: `AIMODULE_URL`, `AIMODULE_TENANT`, `JWT_SECRET`, `WEBHOOK_SECRET` | Required |
| 2 | DB table `extraction_jobs` (or similar) with `correlation_id` | Required |
| 3 | **POST** API for frontend to start extraction | Required |
| 4 | **GET** API for frontend to fetch job + result | Required |
| 5 | **POST** webhook route for aimodule callback | Required |
| 6 | JWT signer helper (HS256, 1h expiry) | Required |
| 7 | Webhook HMAC verifier (`X-Webhook-Signature`) | Required |
| 8 | Map `documentType` → aimodule `type` | Required |

---

## 2. Environment variables

### Laravel `.in`

```env
AIMODULE_URL=http://127.0.0.1:3000
AIMODULE_TENANT=in
JWT_SECRET=<same as aimodule>
WEBHOOK_SECRET=<same as aimodule>
```

### Laravel `.com`

```env
AIMODULE_URL=http://127.0.0.1:3000
AIMODULE_TENANT=com
JWT_SECRET=<same as aimodule>
WEBHOOK_SECRET=<same as aimodule>
```

---

## 3. Endpoints — Laravel builds (your API)

### 3.1 Start extraction (frontend calls this)

```
POST /backend/api/extractions
```

**Auth:** Your normal Laravel auth (session/JWT — not aimodule JWT)

**Request body examples (all use `async`):**

RC (front + back images):
```json
{
  "documentType": "RC",
  "urls": ["https://storage.example.com/rc-front.jpg", "https://storage.example.com/rc-back.jpg"],
  "mode": "async",
  "priority": "normal"
}
```

DL (front + back images):
```json
{
  "documentType": "DL",
  "urls": ["https://storage.example.com/dl-front.jpg", "https://storage.example.com/dl-back.jpg"],
  "mode": "async",
  "priority": "normal"
}
```

POLICY (motor insurance PDF — often multi-page):
```json
{
  "documentType": "POLICY",
  "urls": ["https://storage.example.com/motor-policy.pdf"],
  "mode": "async",
  "priority": "normal"
}
```

WORKSHOP:
```json
{
  "documentType": "WORKSHOP",
  "urls": ["https://storage.example.com/estimate.pdf"],
  "mode": "async",
  "priority": "normal"
}
```

CLAIM:
```json
{
  "documentType": "CLAIM",
  "urls": ["https://storage.example.com/claim-form.pdf"],
  "mode": "async",
  "priority": "normal"
}
```

**`documentType` values:**

| documentType | Document |
|--------------|----------|
| `RC` | Registration Certificate |
| `DL` | Driving Licence |
| `POLICY` | Motor insurance policy PDF (Package / OD / TP / bundled) |
| `WORKSHOP` | Workshop bill / estimate |
| `CLAIM` | Motor claim form (UIIC/OIC/NIAC/NIC) |

**Default `mode` if omitted:** **`async`** for all document types (RC, DL, POLICY, WORKSHOP, CLAIM).

| documentType | Default mode | Notes |
|--------------|--------------|-------|
| RC, DL, POLICY, WORKSHOP, CLAIM | `async` | Result via webhook; frontend polls `GET /extractions/{id}` |
| Any type | `sync` (optional) | Pass `"mode": "sync"` to wait for result in the same HTTP response (200) |

**Recommended for production:** use `async` for RC and DL too — same webhook flow as workshop/policy/claim; avoids Laravel HTTP timeout on slow scans.

**Laravel must:**

1. Generate `correlationId` = UUID
2. Insert DB row: `status = queued`
3. Call aimodule (section 4)
4. Return to frontend:

| Case | HTTP | Body |
|------|------|------|
| Async queued | 202 | `{ "correlationId", "jobId", "status": "queued" }` |
| Sync done | 200 | `{ "correlationId", "result": {...} }` |
| Error | 4xx/5xx | `{ "error": "..." }` |

---

### 3.2 Get extraction status (frontend polls this)

```
GET /backend/api/extractions/{id}
```

**Response:**

```json
{
  "id": "123",
  "documentType": "WORKSHOP",
  "status": "queued | completed | failed | needs_review",
  "correlationId": "uuid",
  "result": {},
  "error": null,
  "createdAt": "...",
  "completedAt": "..."
}
```

---

### 3.3 Webhook — aimodule calls Laravel (you implement receiver)

```
POST /backend/api/ai-module/webhook/extraction-complete
```

**Production URLs (must be HTTPS):**

- `https://moval.techkrate.in/backend/api/ai-module/webhook/extraction-complete`
- `https://moval.techkrate.com/backend/api/ai-module/webhook/extraction-complete`

**Security:** NO JWT. Verify `X-Webhook-Signature`:

```php
hash_hmac('sha256', $rawBody, WEBHOOK_SECRET) === $request->header('X-Webhook-Signature')
```

If `Content-Encoding: gzip` → `gzdecode($rawBody)` before verify.

**Webhook body from aimodule:**

```json
{
  "correlationId": "uuid-you-sent",
  "jobId": "bullmq-id",
  "documentType": "WORKSHOP",
  "status": "success",
  "result": {},
  "error": null,
  "durationMs": 15000,
  "totalTokens": 20000,
  "totalCostINR": 2.5,
  "timestamp": "..."
}
```

**Handler:**

1. Find job by `correlationId`
2. If already completed/failed → return `200 {"ok":true}` (idempotent)
3. `success` → save `result`, `status=completed`
4. `failure` → save `error`, `status=failed`
5. Always return `200 {"ok":true}`

---

## 4. Endpoint — Laravel hits aimodule (outbound)

```
POST {AIMODULE_URL}/api/v1/documents/extract
```

Example: `POST http://127.0.0.1:3000/api/v1/documents/extract`

**Headers:**

```
Authorization: Bearer <JWT>
X-Correlation-Id: <uuid — saved in DB first>
X-Aimodule-Tenant: in
Content-Type: application/json
```

**JWT payload (sign with JWT_SECRET, exp 1h):**

```json
{ "id": "laravel", "role": "Surveyor" }
```

**Body — map Laravel → aimodule:**

| Laravel field | aimodule field |
|---------------|----------------|
| `documentType` | **`type`** |
| `urls` | **`urls`** (string or array) |
| `mode` | `mode` (`sync` / `async`) |
| `priority` | `priority` (`urgent` / `normal` / `low`) |
| DB job id | `documentId` (optional) |
| filename | `documentName` (optional) |

**Example bodies:**

```json
{
  "type": "RC",
  "urls": ["https://.../front.jpg", "https://.../back.jpg"],
  "mode": "async",
  "documentId": "45",
  "documentName": "rc.pdf"
}
```

```json
{
  "type": "DL",
  "urls": ["https://.../dl-front.jpg", "https://.../dl-back.jpg"],
  "mode": "async",
  "documentId": "46",
  "documentName": "dl.pdf"
}
```

```json
{
  "type": "POLICY",
  "urls": ["https://.../motor-policy.pdf"],
  "mode": "async",
  "documentId": "47",
  "documentName": "policy.pdf"
}
```

```json
{
  "type": "WORKSHOP",
  "urls": ["https://.../bill.pdf"],
  "mode": "async",
  "documentId": "45",
  "documentName": "estimate.pdf"
}
```

```json
{
  "type": "CLAIM",
  "urls": ["https://.../claim.pdf"],
  "mode": "async",
  "documentId": "45",
  "documentName": "claim.pdf"
}
```

**aimodule responses:**

| Status | Meaning | Laravel action |
|--------|---------|----------------|
| 202 | Queued | Save `jobId`, wait for webhook |
| 200 | Done now | Save `data` as `result`, `status=completed` |
| 422 | Wrong doc / unreadable | `status=failed`, save message |
| 503 | Queue full | Retry later |

**Optional poll (usually not needed):**

```
GET {AIMODULE_URL}/api/v1/documents/jobs/{jobId}
```

---

## 5. Database table (minimum)

```sql
extraction_jobs
  id
  correlation_id     VARCHAR UNIQUE NOT NULL
  document_type      ENUM('RC','DL','POLICY','WORKSHOP','CLAIM')
  status             ENUM('queued','processing','completed','failed','needs_review')
  file_urls          JSON
  aimodule_job_id    VARCHAR NULL
  result             JSON NULL
  error              TEXT NULL
  total_tokens       INT NULL
  total_cost_inr     DECIMAL NULL
  duration_ms        INT NULL
  created_at
  completed_at       TIMESTAMP NULL
```

Store full `result` JSON — do not flatten on day one.

---

## 6. Result shape per documentType (webhook `result`)

### RC

`registrationNo`, `ownerName`, `chassisNo`, `engineNo`, `vehicleClass`, `state`, `rcStatus`, `confidenceScore`, `requiresHumanReview`

### DL

`dlNumber`, `name`, `validityNT`, `validityT`, `vehicleClasses[]`, `state`, `confidenceScore`

### POLICY

Motor insurance policy (single PDF; aimodule uses **pro** model, async queue `insurance-queue`).

**Key fields in webhook `result`:**

```json
{
  "policyNumber": "1234567890123456",
  "insurerName": "The New India Assurance Co. Ltd.",
  "insuredName": "JOHN DOE",
  "insuredAddress": "...",
  "registrationNo": "MH12AB1234",
  "policyType": "Package Policy",
  "policyCoverage": "Comprehensive",
  "policyStartDate": "01.01.2025",
  "policyEndDate": "31.12.2025",
  "totalIdv": 850000,
  "grossPremiumPaid": 12500,
  "ncbPercentage": 20,
  "vehicleMake": "MARUTI",
  "vehicleModel": "SWIFT",
  "engineNo": "...",
  "chassisNo": "...",
  "financierName": null,
  "addOnCovers": [{ "name": "Engine Protect", "opted": true }],
  "confidenceScore": 0.92,
  "requiresHumanReview": false
}
```

**Laravel mapping tips:**

- Store full `result` JSON; map `policyNumber`, `registrationNo`, `grossPremiumPaid`, `totalIdv` to claim/survey screens as needed.
- Multi-page policies: one PDF URL is enough — aimodule reads all pages (may slice non-essential pages internally).
- Wrong upload (RC/DL/workshop) → `status: failure` or `requiresHumanReview` with low confidence.

### WORKSHOP

```json
{
  "workshopDetails": { "name", "invoiceNumber", "vehicleNumber", "gstin" },
  "summary": { "grandTotal", "partsSubTotal", "labourSubTotal" },
  "parts":  { "columns": ["..."], "rows": [["..."]] },
  "labour": { "columns": ["..."], "rows": [["..."]] },
  "confidenceScore": 0.95,
  "requiresHumanReview": false
}
```

Map row: `array_combine($result['parts']['columns'], $row)`

**Removed (do not expect):** `partsTable`, `labourTable`, `lineItemsTable`, `tableLayout`

### CLAIM

`policyNumber`, `insuredName`, `registrationNo`, `accidentDate`, `driverName`, `damageDescription`, `additionalData`, `hindiFields`, `extraFields`

If `additionalData.requiresHumanReview` → set job `needs_review`

---

## 7. Flow diagram

```
Frontend
   │  POST /backend/api/extractions
   ▼
Laravel (save correlationId, status=queued)
   │  POST http://127.0.0.1:3000/api/v1/documents/extract
   ▼
aimodule → 202 queued (or 200 sync)
   │
   ▼ (async: worker + Gemini)
aimodule → POST /backend/api/ai-module/webhook/extraction-complete
   ▼
Laravel (save result, status=completed)
   │
Frontend polls GET /backend/api/extractions/{id}
```

---

## 8. Do NOT do

- Do NOT call aimodule from browser/frontend
- Do NOT expose port 3000 publicly
- Do NOT skip `correlationId` — webhook matching breaks
- Do NOT require JWT on webhook route
- Do NOT use old field names `partsTable` / `labourTable` for workshop

---

## 9. Reference code in this repo

| What | Where |
|------|--------|
| Full integration doc | [`LARAVEL.md`](LARAVEL.md) |
| Extract call example | `test-backend/src/modules/extraction/extraction.service.js` |
| Webhook handler | `test-backend/src/modules/webhook/webhook.service.js` |
| aimodule API route | `aimodule/src/modules/document/document.route.ts` |

---

## 10. Checklist (sign-off)

- [ ] `.env` configured on .in and .com
- [ ] `POST /backend/api/extractions` works for all 5 types
- [ ] `correlationId` saved before aimodule call
- [ ] `GET /backend/api/extractions/{id}` returns result
- [ ] Webhook route live on HTTPS
- [ ] HMAC signature verified
- [ ] Idempotent webhook (duplicate → 200 ok)
- [ ] WORKSHOP result uses `parts` / `labour` dynamic tables
- [ ] Tested: RC async, DL async, **POLICY async**, WORKSHOP async, CLAIM async end-to-end (webhook + poll)
