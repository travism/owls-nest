# PriceLabs Integration Plan — The Owl's Nest Direct Booking Engine

## Overview

This document provides a complete integration plan for pulling PriceLabs dynamic pricing into a custom Node.js booking engine for The Owl's Nest (147 SW 4th St, Redmond, OR). The goal is to display accurate, dynamically-priced rates on a direct booking website, eliminating the need for manual price updates and ensuring rate parity with OTA listings.

**Current state:** PriceLabs is actively syncing with VRBO. Airbnb is connected but using Airbnb's own Smart Pricing for A/B comparison. The listing is active in PriceLabs, which satisfies the prerequisite for Customer API access.

---

## Which API to Use

PriceLabs exposes **two separate APIs**. Use the **Customer API**, not the Integration API.

### Customer API (USE THIS ONE)

- **Purpose:** For hosts/PMs who want to read their own recommended rates and push them to a direct booking website or BI dashboard
- **Auth:** Self-serve API key from PriceLabs Account Settings
- **Cost:** $1/listing/month (on top of PriceLabs subscription)
- **Prerequisite:** Listing must be active in PriceLabs, connected through any PMS or channel (VRBO connection satisfies this)
- **Documentation:**
  - Swagger spec: `https://app.swaggerhub.com/apis-docs/Customer_API/customer_api/1.0.0-oas3`
  - Postman collection: `https://documenter.getpostman.com/view/507656/SVSEurQC`
  - Help article: `https://help.pricelabs.co/portal/en/kb/articles/pricelabs-api`
  - WordPress/Wix guide (useful for understanding the flow): `https://help.pricelabs.co/portal/en/kb/articles/how-to-use-pricelabs-customer-api-to-send-the-prices-to-wordpress-wix-website`

### Integration API / IAPI (DO NOT USE)

- **Purpose:** For PMS companies building full two-way integrations (requires hosting webhook endpoints, certification process, PriceLabs partnership approval)
- **Auth:** Requires contacting PriceLabs for `X-INTEGRATION-NAME` and `X-INTEGRATION-TOKEN` credentials
- **Not appropriate for:** Single-property operators building a custom booking site

---

## API Key Setup

1. Log in to PriceLabs at `https://pricelabs.co`
2. Go to **Account Settings**: `https://pricelabs.co/account_settings`
3. Click **"API Details"**
4. Click **"Get PriceLabs API Key"**
5. Store the key securely (environment variable, never commit to repo)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     PRICING FLOW                                │
│                                                                 │
│  ┌────────────┐    syncs prices    ┌────────────┐               │
│  │ PriceLabs  │ ─────────────────► │   VRBO     │               │
│  │  (dynamic  │                    └────────────┘               │
│  │  pricing)  │    (future)        ┌────────────┐               │
│  │            │ ─────────────────► │  Beds24    │──► Airbnb     │
│  │            │                    │  (planned) │──► Booking    │
│  └─────┬──────┘                    └────────────┘               │
│        │                                                        │
│        │ Customer API                                           │
│        │ GET rates + min-stay                                   │
│        │ (once daily)                                           │
│        ▼                                                        │
│  ┌─────────────────────────────────────────────┐                │
│  │         Node.js Rate Service                │                │
│  │                                             │                │
│  │  1. Fetch rates from PriceLabs API          │                │
│  │  2. Cache in Firestore (or JSON file)       │                │
│  │  3. Serve to booking engine frontend        │                │
│  └─────────────────┬───────────────────────────┘                │
│                    │                                            │
│                    ▼                                            │
│  ┌─────────────────────────────────────────────┐                │
│  │     Direct Booking Website (Frontend)       │                │
│  │                                             │                │
│  │  - Rate calendar display                    │                │
│  │  - Min-stay enforcement                     │                │
│  │  - Total cost calculation                   │                │
│  │  - Booking form → Beds24 API (future)       │                │
│  └─────────────────────────────────────────────┘                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key architectural decisions

- **PriceLabs is read-only in this flow.** It computes and provides rates. It does not handle bookings or availability.
- **Availability must come from Beds24** (or the OTA directly) when that integration is live. PriceLabs has no availability data.
- **Cache rates locally.** PriceLabs updates pricing once per day. Polling the API every page load is unnecessary and wasteful. Fetch once daily, cache, serve from cache.
- **No SDK exists.** PriceLabs does not provide an npm package. All calls are standard REST with API key auth. The Swagger spec defines the exact request/response shapes.

---

## API Reference

> **IMPORTANT:** The Swagger spec is the authoritative source. The spec is served by a JS-heavy renderer, so you must open it in a browser. The details below are based on PriceLabs documentation and known API behavior. Always verify against the live Swagger docs before implementing.

### Base URL

```
https://api.pricelabs.co
```

### Authentication

All requests require the API key. Based on PriceLabs documentation, the key is passed as a query parameter or header. Check the Swagger spec for the exact mechanism:

```javascript
// Likely pattern (verify against Swagger):
const response = await fetch(
  `https://api.pricelabs.co/v1/pricing?api_key=${PRICELABS_API_KEY}&listing_id=${LISTING_ID}`
);
```

### Expected Data Fields

Based on PriceLabs' IAPI documentation (which mirrors what the Customer API returns for pricing), expect the following data per date:

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | Calendar date (YYYY-MM-DD) |
| `price` | number | Recommended nightly rate |
| `min_stay` | number | Minimum night stay requirement |
| `checkin_allowed` | boolean | Whether check-in is allowed on this date |
| `checkout_allowed` | boolean | Whether check-out is allowed on this date |

Additional fields that may be available (verify in Swagger):
- Length-of-stay (LOS) pricing / discounts
- Weekly and monthly discount rates
- Extra person fees and trigger thresholds

### Listing Identification

You'll need your PriceLabs listing ID. This corresponds to the listing as it appears in your PriceLabs dashboard. If connected via VRBO, it will likely use the VRBO listing ID. Check your PriceLabs dashboard → listing detail to confirm.

### Rate Window

PriceLabs typically provides rates for 540 days into the future (extendable to 720 days). For the booking engine, 365 days is sufficient.

---

## Implementation Phases

### Phase 1: API Discovery & Validation

**Goal:** Confirm API access works, understand exact response shape.

**Steps:**

1. Generate API key (see API Key Setup above)
2. Open Swagger docs in browser: `https://app.swaggerhub.com/apis-docs/Customer_API/customer_api/1.0.0-oas3`
3. Document the exact:
   - Endpoint path for fetching pricing data
   - Auth mechanism (header vs query param vs body)
   - Request parameters (listing_id format, date range params)
   - Response JSON schema
4. Import Postman collection (`https://documenter.getpostman.com/view/507656/SVSEurQC`) and make a test call
5. Save a sample response as `sample-response.json` for development reference

**Deliverable:** Working API call returning rate data for The Owl's Nest listing.

```javascript
// Phase 1 test script — verify-api.js
// Run: node verify-api.js

const PRICELABS_API_KEY = process.env.PRICELABS_API_KEY;

// TODO: Update endpoint path and params after reviewing Swagger docs
async function testApiCall() {
  try {
    const response = await fetch(
      `https://api.pricelabs.co/v1/listing_prices?api_key=${PRICELABS_API_KEY}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error(`HTTP ${response.status}: ${response.statusText}`);
      const body = await response.text();
      console.error('Body:', body);
      return;
    }

    const data = await response.json();
    console.log('Success! Response shape:');
    console.log(JSON.stringify(data, null, 2).slice(0, 2000));

    // Save full response for reference
    const fs = require('fs');
    fs.writeFileSync('sample-response.json', JSON.stringify(data, null, 2));
    console.log('\nFull response saved to sample-response.json');
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testApiCall();
```

### Phase 2: Rate Fetching Service

**Goal:** Reliable daily rate sync with local caching.

**File:** `services/pricelabs.js`

```javascript
// services/pricelabs.js — PriceLabs rate fetching service
//
// IMPLEMENTATION NOTES:
// - Update endpoint/params after Phase 1 Swagger review
// - This service fetches rates and writes to Firestore
// - Intended to run once daily via Cloud Function cron trigger
// - Falls back to cached data if API call fails

const admin = require('firebase-admin');
const db = admin.firestore();

const PRICELABS_API_KEY = process.env.PRICELABS_API_KEY;
const LISTING_ID = process.env.PRICELABS_LISTING_ID; // e.g. VRBO listing ID
const RATES_COLLECTION = 'pricelabs_rates';
const META_DOC = 'sync_meta';

/**
 * Fetch current rates from PriceLabs Customer API
 * TODO: Update URL, params, and response parsing after Swagger review
 */
async function fetchRatesFromPriceLabs() {
  // TODO: Replace with actual endpoint from Swagger docs
  const url = `https://api.pricelabs.co/v1/listing_prices?api_key=${PRICELABS_API_KEY}&listing_id=${LISTING_ID}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`PriceLabs API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // TODO: Adjust parsing based on actual response shape
  // Expected: array of { date, price, min_stay, ... }
  return data;
}

/**
 * Sync rates from PriceLabs to Firestore cache
 * Designed to run once daily
 */
async function syncRates() {
  console.log(`[PriceLabs Sync] Starting rate sync at ${new Date().toISOString()}`);

  try {
    const ratesData = await fetchRatesFromPriceLabs();

    // TODO: Adjust field names after Swagger review
    // Store rates in a single Firestore document (for a single listing, this is fine)
    // Structure: { dates: { "2026-04-25": { price: 150, minStay: 2, ... }, ... } }
    const ratesMap = {};

    // Assuming ratesData is an array of date objects
    // TODO: Update based on actual response shape
    const ratesArray = Array.isArray(ratesData) ? ratesData : ratesData.prices || ratesData.data || [];

    for (const entry of ratesArray) {
      const dateKey = entry.date; // e.g. "2026-04-25"
      ratesMap[dateKey] = {
        price: entry.price,
        minStay: entry.min_stay || entry.minStay || 1,
        checkinAllowed: entry.checkin_allowed !== false,
        checkoutAllowed: entry.checkout_allowed !== false,
        // Include any additional fields from the API response
      };
    }

    // Write to Firestore
    await db.collection(RATES_COLLECTION).doc('owls_nest').set({
      listingId: LISTING_ID,
      rates: ratesMap,
      lastSync: admin.firestore.FieldValue.serverTimestamp(),
      dateCount: Object.keys(ratesMap).length,
    });

    // Update sync metadata
    await db.collection(RATES_COLLECTION).doc(META_DOC).set({
      lastSuccessfulSync: admin.firestore.FieldValue.serverTimestamp(),
      status: 'success',
      dateCount: Object.keys(ratesMap).length,
    });

    console.log(`[PriceLabs Sync] Success. Cached ${Object.keys(ratesMap).length} dates.`);
    return { success: true, dateCount: Object.keys(ratesMap).length };
  } catch (err) {
    console.error(`[PriceLabs Sync] Failed:`, err.message);

    // Log failure but don't wipe cached data
    await db.collection(RATES_COLLECTION).doc(META_DOC).set(
      {
        lastFailedSync: admin.firestore.FieldValue.serverTimestamp(),
        status: 'error',
        error: err.message,
      },
      { merge: true }
    );

    return { success: false, error: err.message };
  }
}

/**
 * Get cached rates from Firestore
 * Used by the booking engine frontend API
 */
async function getCachedRates() {
  const doc = await db.collection(RATES_COLLECTION).doc('owls_nest').get();

  if (!doc.exists) {
    throw new Error('No cached rates found. Run syncRates() first.');
  }

  return doc.data();
}

/**
 * Get rate for a specific date range
 * Returns { dates: [...], total: number, nightCount: number, avgNightly: number }
 */
async function getRatesForDateRange(checkIn, checkOut) {
  const cached = await getCachedRates();
  const rates = cached.rates;

  const startDate = new Date(checkIn);
  const endDate = new Date(checkOut);
  const nights = [];
  let total = 0;

  const current = new Date(startDate);
  while (current < endDate) {
    const dateKey = current.toISOString().split('T')[0];
    const dayRate = rates[dateKey];

    if (!dayRate) {
      throw new Error(`No rate available for ${dateKey}`);
    }

    nights.push({
      date: dateKey,
      price: dayRate.price,
      minStay: dayRate.minStay,
    });

    total += dayRate.price;
    current.setDate(current.getDate() + 1);
  }

  return {
    dates: nights,
    nightCount: nights.length,
    total,
    avgNightly: Math.round(total / nights.length),
  };
}

/**
 * Validate a stay against min-stay requirements
 */
function validateMinStay(ratesForRange) {
  const checkInDate = ratesForRange.dates[0];
  if (ratesForRange.nightCount < checkInDate.minStay) {
    return {
      valid: false,
      required: checkInDate.minStay,
      requested: ratesForRange.nightCount,
      message: `Minimum stay for this date is ${checkInDate.minStay} nights.`,
    };
  }
  return { valid: true };
}

module.exports = {
  fetchRatesFromPriceLabs,
  syncRates,
  getCachedRates,
  getRatesForDateRange,
  validateMinStay,
};
```

### Phase 3: Cloud Function for Daily Sync

**Goal:** Automated daily rate refresh via Firebase Cloud Function.

**File:** `functions/pricelabsSync.js`

```javascript
// functions/pricelabsSync.js
// Cloud Function that runs daily to sync PriceLabs rates
//
// Deploy: firebase deploy --only functions:syncPriceLabsRates
// Manual trigger: firebase functions:shell > syncPriceLabsRates()

const functions = require('firebase-functions');
const { syncRates } = require('../services/pricelabs');

// Run daily at 6 AM Pacific (PriceLabs typically updates overnight)
exports.syncPriceLabsRates = functions.pubsub
  .schedule('0 6 * * *')
  .timeZone('America/Los_Angeles')
  .onRun(async (context) => {
    const result = await syncRates();

    if (!result.success) {
      // Cloud Functions will retry on thrown errors
      // But we don't want to retry here — the API data just isn't ready yet
      // The next daily run will pick it up
      console.warn('[PriceLabs Cron] Sync failed, will retry tomorrow:', result.error);
    }

    return null;
  });

// HTTP endpoint for manual sync trigger (useful during development)
exports.syncPriceLabsManual = functions.https.onRequest(async (req, res) => {
  // Basic auth check — restrict to your IP or add a secret
  const authToken = req.headers['x-sync-token'];
  if (authToken !== process.env.SYNC_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const result = await syncRates();
  res.json(result);
});
```

### Phase 4: Booking Engine API Endpoints

**Goal:** REST endpoints the frontend calls to display rates and validate bookings.

**File:** `api/rates.js` (Express router or Next.js API routes)

```javascript
// api/rates.js — Endpoints for the direct booking frontend

const express = require('express');
const router = express.Router();
const { getCachedRates, getRatesForDateRange, validateMinStay } = require('../services/pricelabs');

// Owl's Nest fixed fees (not from PriceLabs)
const CLEANING_FEE = 75; // Update as needed
const TAX_RATE = 0.107;  // Deschutes County transient lodging tax — verify current rate

/**
 * GET /api/rates
 * Returns full rate calendar for frontend display
 */
router.get('/rates', async (req, res) => {
  try {
    const cached = await getCachedRates();
    res.json({
      rates: cached.rates,
      lastSync: cached.lastSync,
      dateCount: cached.dateCount,
    });
  } catch (err) {
    res.status(500).json({ error: 'Rate data unavailable. Please try again later.' });
  }
});

/**
 * GET /api/rates/quote?checkIn=2026-05-01&checkOut=2026-05-04
 * Returns a price quote for a specific date range
 */
router.get('/rates/quote', async (req, res) => {
  const { checkIn, checkOut } = req.query;

  if (!checkIn || !checkOut) {
    return res.status(400).json({ error: 'checkIn and checkOut are required (YYYY-MM-DD)' });
  }

  try {
    const ratesForRange = await getRatesForDateRange(checkIn, checkOut);

    // Validate min-stay
    const minStayCheck = validateMinStay(ratesForRange);
    if (!minStayCheck.valid) {
      return res.status(400).json({
        error: 'min_stay_violation',
        ...minStayCheck,
      });
    }

    // Build quote
    const subtotal = ratesForRange.total;
    const cleaningFee = CLEANING_FEE;
    const taxableAmount = subtotal + cleaningFee;
    const taxes = Math.round(taxableAmount * TAX_RATE * 100) / 100;
    const grandTotal = Math.round((taxableAmount + taxes) * 100) / 100;

    res.json({
      checkIn,
      checkOut,
      nights: ratesForRange.dates,
      nightCount: ratesForRange.nightCount,
      subtotal,
      avgNightly: ratesForRange.avgNightly,
      cleaningFee,
      taxes,
      taxRate: TAX_RATE,
      grandTotal,
    });
  } catch (err) {
    if (err.message.includes('No rate available')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Unable to generate quote.' });
  }
});

module.exports = router;
```

---

## Environment Variables

```bash
# .env (never commit this file)

# PriceLabs Customer API
PRICELABS_API_KEY=your_api_key_here
PRICELABS_LISTING_ID=your_listing_id_here  # Check PriceLabs dashboard

# Firebase
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json

# Manual sync auth
SYNC_SECRET=a_random_secret_for_manual_sync_trigger
```

---

## Firestore Data Structure

```
pricelabs_rates/
├── owls_nest                    # Main rates document
│   ├── listingId: "12345"
│   ├── lastSync: Timestamp
│   ├── dateCount: 540
│   └── rates: {
│       "2026-04-25": {
│           price: 145,
│           minStay: 2,
│           checkinAllowed: true,
│           checkoutAllowed: true
│       },
│       "2026-04-26": {
│           price: 175,
│           minStay: 2,
│           checkinAllowed: true,
│           checkoutAllowed: true
│       },
│       ...
│   }
│
└── sync_meta                    # Sync health tracking
    ├── lastSuccessfulSync: Timestamp
    ├── lastFailedSync: Timestamp (if any)
    ├── status: "success" | "error"
    ├── dateCount: 540
    └── error: null | "error message"
```

---

## Edge Cases & Error Handling

### Rate gaps
If PriceLabs doesn't return a rate for a specific date (e.g., too far in the future), the booking engine should show "dates unavailable" rather than defaulting to $0 or a stale rate.

### Sync failures
The cached data persists even if a daily sync fails. The frontend should check `lastSync` and warn the operator (not the guest) if data is more than 48 hours stale. Use `sync_meta.status` for monitoring.

### Min-stay on check-in date
Min-stay is evaluated based on the **check-in date's** min-stay value, not the average across the stay. If check-in date requires 3-night minimum, a 2-night stay is blocked regardless of other dates' requirements.

### Price changes mid-booking
Rates are cached. A guest could start browsing, see a rate, then book hours later after a sync updated the rate. For a single-property operation, this risk is minimal (syncs happen once daily, typically overnight). If needed, re-validate the quote server-side at booking submission time.

### Tax rate
Deschutes County transient room tax rate is hardcoded in this plan. Verify the current rate and update as needed. Consider making this configurable rather than hardcoded.

---

## Future: Beds24 Integration for Availability + Booking

PriceLabs provides **rates only**. For the direct booking flow to be fully functional, you'll also need:

1. **Availability data** — Which dates are already booked? → Beds24 API
2. **Booking creation** — Guest completes booking → Create reservation in Beds24 → Beds24 blocks dates across all OTAs

This is a separate integration. When you're ready for it, the Beds24 API docs are at `https://beds24.com/api/v2/` and support:
- `GET /properties/{id}/calendar` — availability by date
- `POST /bookings` — create a new reservation
- Webhook notifications for booking changes

The architecture when both are live:

```
Guest selects dates on direct booking site
  │
  ├──► Check Beds24 API → dates available?
  │     └── No → show "dates unavailable"
  │     └── Yes ↓
  │
  ├──► Check PriceLabs cached rates → calculate total
  │
  ├──► Guest confirms booking
  │
  └──► Create reservation in Beds24
        └── Beds24 auto-blocks dates on Airbnb, VRBO, Booking.com
```

---

## Quick Reference Links

| Resource | URL |
|----------|-----|
| PriceLabs Customer API docs | `https://help.pricelabs.co/portal/en/kb/articles/pricelabs-api` |
| Swagger spec (open in browser) | `https://app.swaggerhub.com/apis-docs/Customer_API/customer_api/1.0.0-oas3` |
| Postman collection | `https://documenter.getpostman.com/view/507656/SVSEurQC` |
| API key generation | `https://pricelabs.co/account_settings` → API Details |
| WordPress/Wix integration guide | `https://help.pricelabs.co/portal/en/kb/articles/how-to-use-pricelabs-customer-api-to-send-the-prices-to-wordpress-wix-website` |
| PriceLabs IAPI reference (NOT for your use, but documents pricing data fields) | `https://help.pricelabs.co/portal/en/kb/articles/building-an-integration-with-pricelabs` |
| PriceLabs support email | `support@pricelabs.co` |

---

## Implementation Checklist

- [ ] Generate PriceLabs Customer API key
- [ ] Open Swagger docs in browser, document exact endpoint paths and response schema
- [ ] Import Postman collection, make successful test call
- [ ] Save sample API response as `sample-response.json`
- [ ] Update `services/pricelabs.js` with correct endpoint URL, params, and response parsing
- [ ] Set up Firestore collection for rate caching
- [ ] Deploy Cloud Function for daily sync
- [ ] Build `/api/rates` and `/api/rates/quote` endpoints
- [ ] Verify tax rate for Deschutes County transient lodging
- [ ] Test end-to-end: PriceLabs → cache → quote endpoint
- [ ] (Future) Integrate Beds24 API for availability and booking creation