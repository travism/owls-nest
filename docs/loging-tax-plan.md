# The Owl's Nest — Oregon Transient Lodging Tax (TLT) Management Plan

**Property:** 147 SW 4th St, Redmond, OR 97756 (within Redmond city limits)
**Last Verified:** April 25, 2026
**Next Verification Due:** July 1, 2026
**Answers PRD Open Question #2**

---

## 1. Tax Rates Summary

Your property is **within Redmond city limits**, which means two tax layers apply. The Deschutes County TLT does **not** apply to you — it only covers unincorporated areas outside the cities of Bend, Redmond, Sisters, and La Pine.

| Tax | Rate | Applies To | Filing Frequency | Filed With |
|-----|------|-----------|-----------------|------------|
| **Oregon State TLT** | **1.5%** | Total retail price (room rate + cleaning fee + non-optional fees) | Quarterly | Oregon Dept. of Revenue via Revenue Online |
| **City of Redmond TLT** | **9.0%** | Total retail price (room rate + cleaning fee + non-optional fees) | Monthly | City of Redmond, Accounts Receivables |
| ~~Deschutes County TRT~~ | ~~8.0%~~ | ~~Does NOT apply — property is within city limits~~ | — | — |
| **Combined effective rate** | **10.5%** | | | |

### What's Taxable

Both taxes apply to the total retail price charged for occupancy of transient lodging on stays of **fewer than 30 consecutive days**. This includes:

- Nightly room rate
- Cleaning fees (non-optional — and since the PRD bakes cleaning into the nightly rate, the full displayed rate is taxable)
- Booking/processing fees (non-optional)

Optional add-on services (if charged separately) are **not** subject to the state TLT. Once a stay reaches 30+ consecutive days, the **entire stay** becomes exempt from state TLT.

### Administrative Fee (You Keep This)

Oregon law allows you to **retain 5% of the state TLT you collect** as reimbursement for your recordkeeping and collection costs. On the city side, Redmond's code also provides for a collector reimbursement — confirm the exact percentage when you register.

**Sources:**
- Oregon DOR: https://www.oregon.gov/dor/programs/businesses/pages/lodging.aspx
- City of Redmond TLT: https://www.redmondoregon.gov/government/departments/finance/forms-applications/transient-lodging-tax
- Deschutes County TRT: https://www.deschutes.org/finance/page/transient-room-tax
- Airbnb Oregon tax page (confirms 9% Redmond rate): https://www.airbnb.com/help/article/2324

---

## 2. Registration Requirements

You must register with **two** entities before your first guest:

### A. City of Redmond

- **Deadline:** Within 15 days of commencing operation
- **Also required:** A Redmond business license (all hosts, regardless of platform)
- **Contact:** Accounts Receivables, 541-504-3066, accountsreceivable@redmondoregon.gov
- **Mail:** City of Redmond, Attn: Accounts Receivables, 411 SW 9th St, Redmond, OR 97756

### B. Oregon Department of Revenue (State TLT)

- **How:** Register via Revenue Online (https://revenueonline.dor.oregon.gov) using the "Register for a business tax" link
- **What you'll need:** FEIN, SSN, or ITIN; business information; property address
- **Note:** If all bookings are handled through transient lodging intermediaries (Airbnb, VRBO, etc.) and you won't collect payment directly in the foreseeable future, you may not need to file quarterly returns with DOR. However, once you launch the direct booking site, you must register and file.

---

## 3. What the OTAs Handle vs. What You Handle

The platforms collect and remit taxes **on their bookings only**. You still have reporting obligations, and you're fully responsible for tax on direct bookings.

### Platform-by-Platform Breakdown

| Platform | Collects State 1.5%? | Collects City 9%? | You Still Must File Reports? |
|----------|---------------------|-------------------|------------------------------|
| **Airbnb** | Yes | Yes (since July 2018) | Yes — file monthly city returns reporting OTA gross revenue; quarterly state returns with OTA deductions |
| **VRBO** | Yes | Yes (since July 2018) | Yes — same as Airbnb |
| **Booking.com** | Verify directly | Verify directly | Yes — confirm with both Booking.com and the City of Redmond whether Booking.com has a collection agreement in place. If not, you must collect and remit yourself. |
| **Direct Bookings** | No | No | Yes — you are the collector. Collect 10.5% from guests and remit to both jurisdictions. |
| **Hipcamp** | Verify directly | Verify directly | Yes — confirm collection status before going live. |

**Key rule from Oregon law:** Whoever collects payment from the guest is responsible for collecting and remitting the tax. OTAs that collect payment are "transient lodging intermediaries" and handle remittance. When guests pay you directly via Stripe on your booking site, you are the "transient lodging provider" and must handle it.

**Important:** Even when OTAs collect and remit on your behalf, the City of Redmond still requires you to file monthly reports showing your gross rents — including OTA-booked revenue. You report it, but deduct the portion already remitted by the OTA.

---

## 4. Filing Calendar & Deadlines

### City of Redmond — Monthly

| Period | Due Date |
|--------|----------|
| January | Last day of February |
| February | Last day of March |
| March | Last day of April |
| April | Last day of May |
| May | Last day of June |
| June | Last day of July |
| July | Last day of August |
| August | Last day of September |
| September | Last day of October |
| October | Last day of November |
| November | Last day of December |
| December | Last day of January |

**Penalties:**
- First penalty (delinquent): 10% of tax due
- Second penalty (31+ days delinquent): additional 15% of tax due + the first penalty
- Extensions: The tax administrator may grant a one-month extension for good cause

### Oregon State — Quarterly

| Quarter | Period | Due Date |
|---------|--------|----------|
| Q1 | Jan – Mar | April 30 |
| Q2 | Apr – Jun | July 31 |
| Q3 | Jul – Sep | October 31 |
| Q4 | Oct – Dec | January 31 |

**Penalties:**
- 5% penalty if not paid by due date
- 20% penalty if return not filed within 30 days of due date
- Additional penalties possible after 60 days
- Interest accrues on unpaid tax from the due date

**You must file a zero return even if you had no taxable receipts during the period.**

---

## 5. Platform Implementation

This section maps TLT handling to the Owl's Nest Platform architecture defined in the PRD.

### 5.1 Data Model Changes

The PRD's `Property` entity currently has a single `tax_rate_percentage` field. This needs to be expanded to support multiple tax jurisdictions, individual rate changes, and accurate per-booking tax breakdowns.

**Option A: Add tax columns directly to the Property table (simpler, single-property)**

```sql
-- Add to Property table (replaces the single tax_rate_percentage field)
ALTER TABLE property
  DROP COLUMN tax_rate_percentage,
  ADD COLUMN state_tlt_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0150,
  ADD COLUMN city_tlt_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0900,
  ADD COLUMN state_tlt_admin_fee_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0500,
  ADD COLUMN city_tlt_admin_fee_rate DECIMAL(5,4) DEFAULT NULL,
  ADD COLUMN tax_exempt_threshold_nights INT NOT NULL DEFAULT 30,
  ADD COLUMN tax_rates_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
```

**Option B: Separate tax_jurisdiction table (more flexible, supports future multi-property)**

```sql
CREATE TABLE tax_jurisdiction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES property(id),
  jurisdiction_name VARCHAR(100) NOT NULL,     -- 'Oregon State TLT', 'City of Redmond TLT'
  jurisdiction_level VARCHAR(20) NOT NULL,     -- 'state', 'city', 'county'
  tax_rate DECIMAL(5,4) NOT NULL,              -- 0.0150 for 1.5%, 0.0900 for 9%
  admin_fee_rate DECIMAL(5,4) DEFAULT NULL,    -- 0.0500 for state 5% retention
  filing_frequency VARCHAR(20) NOT NULL,       -- 'monthly', 'quarterly'
  filing_authority VARCHAR(200),               -- 'Oregon DOR', 'City of Redmond'
  filing_portal_url VARCHAR(500),
  exempt_threshold_nights INT NOT NULL DEFAULT 30,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE DEFAULT NULL,              -- NULL = currently active
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed data for The Owl's Nest
INSERT INTO tax_jurisdiction
  (property_id, jurisdiction_name, jurisdiction_level, tax_rate, admin_fee_rate,
   filing_frequency, filing_authority, filing_portal_url, exempt_threshold_nights)
VALUES
  ('<property_id>', 'Oregon State TLT', 'state', 0.0150, 0.0500,
   'quarterly', 'Oregon Department of Revenue',
   'https://revenueonline.dor.oregon.gov', 30),
  ('<property_id>', 'City of Redmond TLT', 'city', 0.0900, NULL,
   'monthly', 'City of Redmond Accounts Receivables',
   'https://www.redmondoregon.gov/government/departments/finance/forms-applications/transient-lodging-tax', 30);
```

**Recommendation:** Option B. It's slightly more setup but gives you clean rate history (when a rate changes, insert a new row with `effective_from` and close the old row with `effective_to`), and it's ready for multi-property if the house next door becomes a reality.

**Expand the Booking entity's tax fields:**

The PRD's `Booking` entity already has `tax_amount` as a single field. Break it out:

```sql
-- Replace single tax_amount on Booking with per-jurisdiction breakdown
ALTER TABLE booking
  DROP COLUMN tax_amount,
  ADD COLUMN state_tlt_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN city_tlt_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN total_tax_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN state_admin_fee_retained DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN tax_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN tax_exempt_reason VARCHAR(200) DEFAULT NULL,
  ADD COLUMN ota_remitted_state BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN ota_remitted_city BOOLEAN NOT NULL DEFAULT FALSE;
```

For OTA bookings (imported via iCal), `ota_remitted_state` and `ota_remitted_city` are set to `true` for Airbnb and VRBO. For direct bookings, both are `false`.

### 5.2 NestJS Tax Calculation Service

Create a `TaxService` in the NestJS API that handles all tax logic. This service is called during the booking flow (Step 2 — pricing display) and at payment confirmation.

```typescript
// src/tax/tax.service.ts

interface TaxBreakdown {
  subtotal: number;              // nightly_rate × nights (cleaning baked in)
  stateTltRate: number;          // 0.015
  cityTltRate: number;           // 0.09
  stateTltAmount: number;        // subtotal × 0.015
  cityTltAmount: number;         // subtotal × 0.09
  totalTax: number;              // state + city
  totalWithTax: number;          // subtotal + totalTax
  stateAdminFeeRetained: number; // stateTltAmount × 0.05
  taxExempt: boolean;
}

@Injectable()
export class TaxService {
  constructor(
    @InjectRepository(TaxJurisdiction)
    private taxRepo: Repository<TaxJurisdiction>,
  ) {}

  async calculateTax(
    propertyId: string,
    subtotal: number,
    numberOfNights: number,
  ): Promise<TaxBreakdown> {
    // Fetch active tax rates for this property
    const jurisdictions = await this.taxRepo.find({
      where: {
        property_id: propertyId,
        effective_to: IsNull(), // only active rates
      },
    });

    const stateJurisdiction = jurisdictions.find(
      j => j.jurisdiction_level === 'state'
    );
    const cityJurisdiction = jurisdictions.find(
      j => j.jurisdiction_level === 'city'
    );

    // Check 30-night exemption
    const exemptThreshold = stateJurisdiction?.exempt_threshold_nights ?? 30;
    const taxExempt = numberOfNights >= exemptThreshold;

    if (taxExempt) {
      return {
        subtotal,
        stateTltRate: stateJurisdiction?.tax_rate ?? 0,
        cityTltRate: cityJurisdiction?.tax_rate ?? 0,
        stateTltAmount: 0,
        cityTltAmount: 0,
        totalTax: 0,
        totalWithTax: subtotal,
        stateAdminFeeRetained: 0,
        taxExempt: true,
      };
    }

    const stateTltRate = stateJurisdiction?.tax_rate ?? 0.015;
    const cityTltRate = cityJurisdiction?.tax_rate ?? 0.09;
    const stateAdminFeeRate = stateJurisdiction?.admin_fee_rate ?? 0.05;

    // Both taxes apply to the same base
    // (subtotal = room rate × nights, cleaning baked in)
    const stateTltAmount = roundCurrency(subtotal * stateTltRate);
    const cityTltAmount = roundCurrency(subtotal * cityTltRate);
    const totalTax = stateTltAmount + cityTltAmount;
    const stateAdminFeeRetained = roundCurrency(
      stateTltAmount * stateAdminFeeRate
    );

    return {
      subtotal,
      stateTltRate,
      cityTltRate,
      stateTltAmount,
      cityTltAmount,
      totalTax,
      totalWithTax: subtotal + totalTax,
      stateAdminFeeRetained,
      taxExempt: false,
    };
  }
}

// Oregon statute: TLT amounts "shall be rounded down to the nearest cent"
function roundCurrency(amount: number): number {
  return Math.floor(amount * 100) / 100;
}
```

### 5.3 Booking Flow Integration

Map tax calculation to the PRD's booking flow steps:

**Step 2 — Select Dates & Review Pricing (Astro guest site)**

When the guest selects dates, the React island calls the NestJS API pricing endpoint. The API returns the full breakdown:

```
GET /api/bookings/pricing?checkIn=2026-07-15&checkOut=2026-07-18&guests=2

Response:
{
  "nightlyRate": 175.00,
  "numberOfNights": 3,
  "subtotal": 525.00,
  "taxes": {
    "stateTlt": {
      "label": "Oregon Lodging Tax",
      "rate": 0.015,
      "amount": 7.87
    },
    "cityTlt": {
      "label": "Redmond Lodging Tax",
      "rate": 0.09,
      "amount": 47.25
    },
    "totalTax": 55.12
  },
  "total": 580.12
}
```

Display on the Book page as:

```
3 nights × $175/night            $525.00
Oregon Lodging Tax (1.5%)          $7.87
Redmond Lodging Tax (9.0%)       $47.25
─────────────────────────────────
Total                            $580.12
```

**Step 5 — Payment via Stripe**

When the owner approves and sends a Stripe payment link, the amount must include tax. The `TaxBreakdown` values are stored on the booking record at approval time so the numbers shown to the guest during checkout match what was quoted.

Two Stripe approaches:

1. **Simple (recommended for Phase 1):** Send `totalWithTax` as the single line item amount to Stripe Checkout. Track the tax breakdown in PostgreSQL. Stripe just sees the total.

2. **Stripe line items (more polished, Phase 4):** Use Stripe Checkout's `line_items` with separate entries for lodging and each tax, or use Stripe Tax for automatic calculation. Shows the tax breakdown on the Stripe-hosted checkout page.

### 5.4 Admin Dashboard — Tax Reporting

Add a **Tax Reporting** section to the admin dashboard's Financials view (PRD Section 8.3). This is what you'll use at filing time.

**Monthly City Report View:**

- Select month from dropdown
- Shows: total gross rents (all sources), OTA-remitted amount, self-collected amount, city TLT due (9% of self-collected), admin fee retained (if applicable), net amount to remit
- Pulls from `booking` table filtered by `check_out` date within the month (Oregon: tax is due when occupancy ends)
- "Export for Filing" button generates the numbers matching the city's remittance form

**Quarterly State Report View:**

- Select quarter from dropdown
- Shows: total gross receipts, deductions (Line 2a: long stays, Line 2b: federal employees, Line 2c: OTA-remitted amounts), taxable gross receipts, state TLT at 1.5%, administrative fee (5% of TLT), net state tax due
- Maps directly to the Oregon DOR quarterly return line items
- "Export for Filing" button generates a summary matching the Revenue Online form

**SQL query pattern for the city monthly report:**

```sql
SELECT
  SUM(subtotal) AS total_gross_rent,
  SUM(CASE WHEN ota_remitted_city = true
      THEN subtotal ELSE 0 END) AS ota_remitted_gross,
  SUM(CASE WHEN ota_remitted_city = false AND tax_exempt = false
      THEN subtotal ELSE 0 END) AS self_collected_gross,
  SUM(CASE WHEN ota_remitted_city = false AND tax_exempt = false
      THEN city_tlt_amount ELSE 0 END) AS city_tlt_due,
  SUM(CASE WHEN tax_exempt = true
      THEN subtotal ELSE 0 END) AS exempt_gross
FROM booking
WHERE property_id = $1
  AND status IN ('confirmed', 'completed')
  AND check_out >= $2  -- first day of month
  AND check_out < $3;  -- first day of next month
```

### 5.5 iCal-Imported OTA Booking Handling

When OTA bookings are imported via iCal (PRD Section 5.3), they carry only date ranges — no pricing data. For tax reporting, you need gross rent figures for OTA bookings too.

1. **Manual entry (Phase 1):** When an OTA booking appears in the admin calendar as "External Booking (Airbnb)," click into it and manually enter the gross rent amount (pulled from the OTA's dashboard). Set `ota_remitted_state = true` and `ota_remitted_city = true` for Airbnb/VRBO.

2. **OTA payout import (Phase 4):** Build a CSV import in the admin that accepts Airbnb/VRBO payout reports, auto-matching bookings by date range and populating gross rent.

Either way, the city monthly return requires reporting ALL gross rents including OTA bookings — you just deduct what the OTA already remitted.

### 5.6 Settings — Tax Configuration in Admin

Add a **Tax Settings** section to the admin Settings page (PRD Section 8.3):

- View current active tax rates by jurisdiction
- Update rates (creates a new `tax_jurisdiction` row with `effective_from` and closes the old one)
- Set the last-verified date (manually after each rate check)
- Show a banner if `verified_at` is older than 6 months: "Tax rates were last verified on [date]. Check for updates."
- Configure which OTA platforms have collection agreements (drives the `ota_remitted_*` defaults when creating OTA booking records)

### 5.7 Phasing Alignment

| Phase | Tax Work |
|-------|----------|
| **Phase 1 (Foundation)** | `tax_jurisdiction` table + seed data, `TaxService` in NestJS, tax calculation in pricing API, tax fields on `booking` record, tax line items on Book page, tax included in Stripe payment amount |
| **Phase 2 (Operations)** | OTA booking manual gross rent entry in admin, `ota_remitted_*` defaults per platform |
| **Phase 4 (Polish & Scale)** | Monthly/quarterly tax report views in admin, CSV tax filing export, rate verification reminders, OTA payout CSV import, Stripe line item breakdown |

---

## 6. Recordkeeping Requirements

Oregon law requires you to maintain records of all rent charged and TLT payments received. Keep records for **at least 3 years** (some sources recommend 5+ years). The PostgreSQL `booking` table with the expanded tax fields from Section 5.1 covers this — every booking record stores the full tax breakdown, source platform, and OTA remittance flags.

For each booking, you're tracking:

- Guest name and dates of stay
- Number of nights
- Total gross rent charged (subtotal with cleaning baked in)
- TLT collected — broken out by state and city
- Booking source (direct, Airbnb, VRBO, Booking.com, etc.)
- Whether the OTA collected and remitted tax on your behalf
- Any exemptions claimed (30+ day stays, federal employees on business)
- State admin fee retained

### CSV Export

The PRD already specifies CSV export for financials (Section 9.3). Extend this to include a **Tax Filing Export** that generates a CSV with columns matching the state quarterly return and city monthly return line items. This is your audit trail and makes tax filing a copy-paste exercise.

---

## 7. Rate Verification Schedule

Tax rates can change through city council action or state legislation.

### Recommended Verification Cadence

| Check | Frequency | When | How |
|-------|-----------|------|-----|
| **City of Redmond rate** | Every 6 months | January and July | Check redmondoregon.gov TLT page or call 541-504-3066 |
| **Oregon state rate** | Annually | January | Check oregon.gov/dor lodging tax page |
| **OTA collection status** | Every 6 months | January and July | Check each platform's tax help page for Oregon/Redmond |
| **New platform onboarding** | At setup | Before going live | Confirm with the platform AND the city whether the platform has a collection/remittance agreement |
| **Legislative session watch** | Annually | Feb–June (Oregon legislative session runs odd years) | Monitor orcities.org and Oregon legislature for TLT bills |

### Why These Intervals

- **State rate (1.5%):** Has only changed twice in 20+ years (1% → 1.8% in 2016, then 1.8% → 1.5% in 2020). Annual check is sufficient, but watch during legislative sessions.
- **City rate (9%):** Local rates change through city council action. Changes typically take effect July 1 or January 1. Semi-annual checks cover both windows.
- **OTA agreements:** Platforms occasionally add or drop jurisdictions. The City of Redmond's page lists which platforms have agreements — check this when new platforms are added or at least twice yearly.

### Monitoring Sources

- **City of Redmond TLT page:** https://www.redmondoregon.gov/government/departments/finance/forms-applications/transient-lodging-tax
- **Oregon DOR TLT page:** https://www.oregon.gov/dor/programs/businesses/pages/lodging.aspx
- **Oregon Legislature bill tracker:** https://olis.oregonlegislature.gov (search "transient lodging" during session)
- **League of Oregon Cities TLT resources:** https://www.orcities.org/resources/reference/topics-z/details/lodging-tax
- **Airbnb Oregon tax page:** https://www.airbnb.com/help/article/2324 (confirms current rates and collection agreements)

---

## 8. PRD Impact Summary

| PRD Section | Change Required |
|-------------|----------------|
| **4.2 Pricing** | TLT is two separate taxes (state 1.5% + city 9%), not one combined rate. Display each separately to guests. |
| **4.2 Pricing — Tax row** | "TLT auto-calculated" → two line items: "Oregon Lodging Tax (1.5%)" and "Redmond Lodging Tax (9.0%)" |
| **Data Model — Property** | Replace `tax_rate_percentage` with `tax_jurisdiction` table (Section 5.1) |
| **Data Model — Booking** | Replace `tax_amount` with `state_tlt_amount`, `city_tlt_amount`, `total_tax_amount`, `state_admin_fee_retained`, `tax_exempt`, `ota_remitted_state`, `ota_remitted_city` |
| **9.1 Revenue Dashboard** | Add tax collected/remitted totals. Track admin fees retained as minor revenue line. |
| **9.2 Per-Booking Financials** | Expand tax breakdown: state and city separately, OTA remittance flag. |
| **9.3 Export** | Add Tax Filing Export format mapping to Oregon DOR quarterly return and city monthly return. |
| **8.3 Settings** | Add Tax Settings section for rate management, OTA agreement flags, verification tracking. |
| **8.3 Financials** | Add Monthly City Tax Report and Quarterly State Tax Report views. |
| **14 Phasing** | Tax calculation is **Phase 1** (required for pricing display + Stripe payment). Tax reporting views are **Phase 4** with financials. |
| **Open Question #2** | **Resolved.** State: 1.5%, City: 9%, County: N/A. Combined: 10.5%. |

---

## 9. Checklist — Pre-Launch Tax Setup

- [ ] Register for a City of Redmond business license
- [ ] Register as a transient lodging provider with the City of Redmond (within 15 days of first booking)
- [ ] Register with Oregon DOR via Revenue Online for state TLT
- [ ] Confirm with Booking.com whether they collect/remit Redmond city TLT and Oregon state TLT
- [ ] Confirm with Hipcamp whether they collect/remit (if listing there)
- [ ] Implement `tax_jurisdiction` table and seed with current rates
- [ ] Implement `TaxService` in NestJS with tax calculation logic
- [ ] Wire tax calculation into the booking pricing API endpoint
- [ ] Display tax breakdown on the Astro Book page (two line items)
- [ ] Include tax in the Stripe payment amount sent after owner approval
- [ ] Store per-booking tax breakdown on the `booking` record at payment confirmation
- [ ] Set calendar reminders: monthly city filing, quarterly state filing
- [ ] Set calendar reminders: semi-annual rate verification (January 1 and July 1)
- [ ] File first monthly city return (even if $0)
- [ ] File first quarterly state return (even if $0)

---

## 10. Quick Reference — Filing Contacts

| Entity | Contact | Portal |
|--------|---------|--------|
| **City of Redmond** | 541-504-3066 / accountsreceivable@redmondoregon.gov | Mail to: 411 SW 9th St, Redmond, OR 97756 |
| **Oregon DOR** | 503-378-4988 (Mon–Fri 8am–4pm) | https://revenueonline.dor.oregon.gov |
| **Deschutes County** | N/A — does not apply to your property | MUNIRevs (for unincorporated areas only) |

---

*This plan should be reviewed and updated whenever tax rates are verified or operational changes occur (e.g., adding new booking platforms, launching direct bookings, or changes to Oregon tax law).*