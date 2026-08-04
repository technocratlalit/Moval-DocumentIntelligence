# Laravel integration handoff

One aimodule on the same VPS (`http://127.0.0.1:3000`). Two separate Laravel apps (`.in` and `.com`). After extraction, aimodule POSTs results to the matching domain via `X-Aimodule-Tenant`.

---

## 1) `.env` per app

**Laravel .IN:**

```env
APP_URL=https://moval.techkrate.in
AIMODULE_URL=http://127.0.0.1:3000
AIMODULE_TENANT=in
JWT_SECRET=<ask aimodule team — must match exactly>
WEBHOOK_SECRET=<ask aimodule team — must match exactly>
```

**Laravel .COM:**

```env
APP_URL=https://moval.techkrate.com
AIMODULE_URL=http://127.0.0.1:3000
AIMODULE_TENANT=com
JWT_SECRET=<same as .in>
WEBHOOK_SECRET=<same as .in>
```

---

## 2) Call aimodule when user requests extraction

```
POST {AIMODULE_URL}/api/v1/documents/extract
```

**Required headers:**

```
Authorization: Bearer <JWT>
X-Correlation-Id: <uuid — save in DB BEFORE calling>
X-Aimodule-Tenant: in   (use "com" on .com app)
Content-Type: application/json
```

**JWT payload (minimum):**

```json
{ "id": "laravel", "role": "Surveyor" }
```

Signed with `JWT_SECRET`, `expiresIn: 1h`.

**Body example (workshop async):**

```json
{
  "type": "WORKSHOP",
  "urls": ["https://your-file-url.pdf"],
  "mode": "async",
  "documentId": "123",
  "documentName": "workshop_bill.pdf"
}
```

`tableLayout` is deprecated and ignored — the API always returns dynamic `parts` / `labour` tables (P/L unified bills are split automatically).

**Responses:**

| Status | Meaning |
|--------|---------|
| 202 | Queued — wait for webhook |
| 200 | Result ready immediately (sync/cache) |
| 4xx/5xx | Error |

**PHP example:**

```php
$correlationId = Str::uuid()->toString();
// Save job in DB first with correlation_id + status=queued

$response = Http::withToken($jwt)
    ->withHeaders([
        'X-Correlation-Id' => $correlationId,
        'X-Aimodule-Tenant'  => config('services.aimodule.tenant'),
    ])
    ->post(config('services.aimodule.url').'/api/v1/documents/extract', [
        'type' => 'WORKSHOP',
        'urls' => $urls,
        'mode' => 'async',
        'documentId' => (string) $job->id,
        'documentName' => $fileName,
    ]);
```

---

## 3) Webhook receiver (NEW route on both apps)

```
POST /backend/api/ai-module/webhook/extraction-complete
```

- No JWT on this route — secured by HMAC signature only
- Must be reachable over HTTPS on your public domain

**Verification:**

1. Read raw request body (`$request->getContent()`)
2. If header `Content-Encoding: gzip` → `gzdecode` body first
3. Verify header `X-Webhook-Signature`:
   `hash_hmac('sha256', $rawBody, WEBHOOK_SECRET) === signature`
4. Parse JSON payload

**Payload fields:**

`correlationId`, `jobId`, `documentType`, `status` (`success`|`failure`), `result`, `error`, `durationMs`, `totalTokens`, `totalCostINR`, `timestamp`

**Handler:**

1. Find DB record by `correlationId`
2. If already completed/failed → return 200 (idempotent — aimodule retries 3×)
3. On success → save result, mark completed
4. On failure → save error, mark failed
5. Return `200 { "ok": true }`

---

## 4) What you do NOT need

- Do NOT call aimodule from frontend (backend only)
- Do NOT expose aimodule port 3000 publicly
- Do NOT send webhook to both `.in` and `.com` — aimodule routes automatically
- Do NOT use `/workshop/extract` as the webhook URL

---

## 5) Checklist

- [ ] `AIMODULE_URL=http://127.0.0.1:3000`
- [ ] `AIMODULE_TENANT=in` or `com` per app
- [ ] `JWT_SECRET` + `WEBHOOK_SECRET` match aimodule
- [ ] Send `X-Correlation-Id` + `X-Aimodule-Tenant` on every extract call
- [ ] Save `correlationId` in DB before calling aimodule
- [ ] Webhook route + HMAC verify + gzip support
- [ ] Confirm webhook path works on HTTPS:
  - `https://moval.techkrate.in/backend/api/ai-module/webhook/extraction-complete`
  - `https://moval.techkrate.com/backend/api/ai-module/webhook/extraction-complete`

---

## aimodule production `.env` (for reference)

```env
WEBHOOK_URL_IN=https://moval.techkrate.in/backend/api/ai-module/webhook/extraction-complete
WEBHOOK_URL_COM=https://moval.techkrate.com/backend/api/ai-module/webhook/extraction-complete
WEBHOOK_URL=http://test-backend:3001/api/webhook/extraction-complete
WEBHOOK_SECRET=<shared>
JWT_SECRET=<shared>
```

Redeploy aimodule API **and** worker after updating `.env`.

---

## 6) Workshop result shape (breaking change)

Webhook `result` for `documentType: "WORKSHOP"` now uses **dynamic PDF-faithful tables**:

```json
{
  "workshopDetails": { "invoiceNumber": "...", "vehicleNumber": "...", "gstin": "..." },
  "summary": { "partsSubtotalWithTax": 825795.21, "labourSubtotalWithTax": 224203.61, "grandTotal": 1049998.82 },
  "parts": {
    "section": "Spare Part Details",
    "columns": ["Sr. No.", "Part No. (HSN Code)", "Part Description", "Qty", "Total Rs"],
    "rows": [["1", "IA348530 (87089900)", "SUCTION LINE ASSY", "1.00", "2,940.01"]]
  },
  "labour": {
    "section": "Labour Details",
    "columns": ["Sr. No.", "Labour Description", "Total Amt."],
    "rows": [["1", "FRONT AXLE WORK", "8,260.06"]]
  },
  "confidenceScore": 0.95,
  "requiresHumanReview": false
}
```

**P/L unified bills** (Honda-style insurance estimates) are split into `parts` + `labour` automatically (same columns, including `P/L`). Rows with `P` go to `parts`, rows with `L` go to `labour`:

```json
"parts": {
  "section": "Body & Paint Work",
  "columns": ["P/L", "Labor Code / Part#", "HSN / SAC", "Description", "..."],
  "rows": [["P", "60211TXKK00ZZ", "87089900", "PANEL R.FR FENDER", "..."]]
},
"labour": {
  "section": "Body & Paint Work",
  "columns": ["P/L", "Labor Code / Part#", "HSN / SAC", "Description", "..."],
  "rows": [["L", "PNTFRDRPNLM", "998714", "PAINT CHGS FRONT DOOR PANEL", "..."]]
}
```

`lineItems` is no longer returned in the final webhook payload.

**Removed fields:** `partsTable`, `labourTable`, `lineItemsTable`, `tableLayout`.

**PHP — map a row to keyed fields:**

```php
$columns = $result['parts']['columns'];
foreach ($result['parts']['rows'] as $row) {
    $rowData = array_combine($columns, $row);
    // $rowData['Net Amt / unit Rs.'], $rowData['Qty'], etc.
}
```

Store the full `result` JSON blob as-is, or map columns to your DB when ready.
