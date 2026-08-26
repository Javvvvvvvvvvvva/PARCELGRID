# PARCELGRID US

**Status:** Product blueprint — U.S. implementation has not started  
**Last updated:** August 26, 2026  
**Current codebase:** The Korean implementation is a validated technical prototype, not the U.S. regulatory or financial product.

PARCELGRID US is a provenance-first predevelopment decision platform for small and midsize real estate developers. It connects an address to parcel due diligence, zoning-informed test fits, editable 3D massing, deal underwriting, professional review, and a decision-ready report.

The product is not an automatic architect, appraisal, legal opinion, permit set, or lending commitment. Its job is to help a development team answer four early questions with visible evidence:

1. What is known about this site?
2. What can plausibly be built by right?
3. Does the same physical plan produce an acceptable deal?
4. What still requires confirmation by an architect, planner, contractor, lender, attorney, or tax professional?

## Why the Korean prototype exists

The Korean version proved the end-to-end product and engineering contracts:

- address → parcel → existing conditions → planning → feasibility → handoff → report;
- editable floor-by-floor massing and parking;
- spatial validation before a plan becomes representative;
- a shared Geometry Hash across 3D, financial analysis, DAE, DXF, handoff, and report;
- explicit separation of official facts, user inputs, algorithm recommendations, and reference values;
- source documents, confidence labels, review states, and change history;
- geometry-locked reference-image rendering;
- financial reconciliation and regression-tested exports.

The Korean implementation must remain available as a regression profile while the country-specific assumptions are extracted. It must not be translated and presented as U.S.-ready.

## Market reality

The U.S. market is not empty. Several established products cover major parts of this workflow, and three are close to PARCELGRID's category-level concept.

### Closest direct competitors

| Product | Publicly documented strengths | Overlap with PARCELGRID US | Working differentiation hypothesis |
|---|---|---|---|
| [TestFit](https://www.testfit.io/) | Editable AI-generated site plans, parking-level control, site planning, concept iteration, deal evaluation, and direct integrations | Site planning, parking, 3D concepts, cost/deal decisions | Make every rule and number source-visible; connect professional approvals and evidence to the same immutable scenario |
| [Deepblocks Developer](https://deepblocks.com/dev/) | Site planning, zoning analysis, 3D massing, financial analysis, market context, and presentation-ready reports | The closest publicly documented end-to-end competitor | Focus on auditable by-right evidence, geometry-to-ledger consistency, and small infill workflows rather than broad deal intelligence |
| [Zenerate](https://www.zenerate.ai/) | Generated site plans, floor plans, parking, editable layouts, pro forma analysis, and Revit/AutoCAD/Excel/PDF export | Strongest overlap on design generation plus finance and export | Lead with decision provenance and professional review gates rather than the volume of generated designs |

### Adjacent competitors and infrastructure products

| Product | Primary strength | Why it is adjacent rather than identical |
|---|---|---|
| [Gridics](https://gridics.com/) | Parcel-level zoning data, by-right capacity, rule processing, 3D zoning maps, and expert zoning reports | Strong zoning intelligence; public materials emphasize zoning and municipal workflows more than a geometry-locked development pro forma |
| [Autodesk Forma Site Design](https://www.autodesk.com/products/forma-site-design/overview) | Early site planning, environmental analysis, design iteration, and AECO collaboration | Strong design ecosystem; not positioned primarily as parcel acquisition underwriting with source-by-source zoning review |
| [ArcGIS Urban](https://www.esri.com/en-us/arcgis/products/arcgis-urban/overview) | 3D zoning, land-use and development scenarios, urban analytics, e-submission, and public collaboration | Primarily a city and regional planning system rather than a small developer's deal-decision workflow |
| [Feasibility.pro](https://www.feasibility.pro/) | Detailed real estate financial feasibility, scenarios, IRR, NPV, residual land value, and reports | Strong finance layer without the same publicly documented parcel-to-editable-geometry workflow |
| [Regrid](https://regrid.com/api) and [ATTOM](https://api.developer.attomdata.com/docs) | Standardized nationwide parcel, property, ownership, transaction, and building data APIs | Potential data suppliers and platform dependencies, not full substitutes for the proposed decision workflow |

This comparison is based on public product materials, not hands-on evaluations. Before product positioning is finalized, the team must run live demos of TestFit, Deepblocks, and Zenerate and verify their current source traceability, zoning coverage, scenario identity, exports, review workflow, and pricing.

### Competitive conclusion

PARCELGRID US is **not unique at the category level**. Site feasibility, 3D massing, parking, zoning, pro formas, and reports already exist in the market.

The opportunity is a narrower operating system for evidence-backed predevelopment decisions:

- every parcel fact, zoning rule, market value, and financial assumption shows its source, effective date, retrieval date, confidence, and reviewer;
- one scenario identity drives the geometry, area schedule, parking, costs, revenue, financing, export, and report;
- conflicts and missing evidence block approval instead of being hidden behind an attractive model;
- the architect, contractor, lender, attorney, and tax reviewer can request changes or approve their own domain;
- the interface is accessible to small and midsize developers without removing expert controls.

This is a positioning hypothesis, not a proven market advantage. Customer interviews and competitor demos must validate it before significant U.S. engineering investment.

## Recommended beachhead

Start with **one metro, one jurisdiction adapter, and one primary building type**.

Recommended first hypothesis:

- **Market:** Minneapolis and Hennepin County, Minnesota;
- **User:** small and midsize infill developers, owner-builders, development brokers, and their architects;
- **Product type:** low- and mid-rise residential or mixed-use infill;
- **Decision:** screen, pursue, renegotiate, or reject a parcel before expensive schematic design and full underwriting.

Why this is a practical candidate:

- the [City of Minneapolis](https://www.minneapolismn.gov/business-services/planning-zoning/) publishes an interactive zoning map and links its zoning code;
- [Hennepin GIS](https://gis-hennepin.hub.arcgis.com/pages/open-data) publishes open geographic data, including county parcel polygons;
- a local pilot allows manual comparison with city staff, architects, brokers, contractors, and actual parcel records before any nationwide claim.

This is not a final market decision. Compare Minneapolis against at least two alternative metros on data licensing, zoning complexity, parcel volume, development activity, customer access, and willingness to pay.

## Target workflow

| Stage | User question | U.S. output |
|---|---|---|
| 0. Site intake | Is this the correct property? | Normalized address, internal site UUID, assessor parcel/APN identifiers, parcel geometry, ownership source, data freshness |
| 1. Due diligence | What is known and what is missing? | Existing building, zoning district, overlays, frontage, access, flood, terrain, utilities when available, source/confidence matrix |
| 2. Test fit | What can plausibly fit? | By-right reference, conservative recommendation, return-oriented alternative, and user-authored scenario |
| 3. Underwriting | Does the same plan work financially? | USD acquisition, hard and soft costs, financing, rent/sale assumptions, NOI, yield on cost, IRR, NPV, residual land value, sensitivity |
| 4. Review and handoff | Who must confirm what? | Architect/planner/contractor/lender/legal/tax review gates, source documents, change requests, approval snapshots |
| 5. Decision report | Should we pursue the deal? | Evidence-backed PDF/web report, scenario comparison, unresolved risks, explicit go/renegotiate/hold/no-go rationale |

## Product principles

### 1. Facts are not recommendations

The interface must distinguish:

- official government or licensed provider data;
- user-entered facts and assumptions;
- algorithm-calculated values;
- professional confirmations;
- preliminary references and unresolved questions.

The engine never silently overwrites a user assumption.

### 2. Zoning is jurisdiction-specific evidence

There is no safe nationwide hard-coded zoning engine. The [National Zoning Atlas](https://www.zoningatlas.org/) describes more than 33,000 U.S. jurisdictions, and building codes are generally adopted and enforced by state or local governments.

Each automated rule must include:

- jurisdiction and zoning district;
- ordinance title and section;
- overlay or special-district applicability;
- effective date and retrieval date;
- parsed value and original text/reference;
- confidence and parser version;
- human verification status.

The product should say **by-right reference** or **preliminary development capacity**, not legal maximum, until a qualified local professional confirms the rule set.

### 3. Geometry and underwriting share one scenario

Every approved scenario must have one stable ID and Geometry Hash. A geometry change invalidates dependent quantities, costs, revenues, exports, and approvals until they are recalculated.

### 4. Missing evidence is visible product state

Unknown setbacks, overlays, easements, utilities, title restrictions, environmental conditions, or code interpretations are not zero. They are unresolved items with an owner and required action.

### 5. Units and currency are explicit

- Keep the geometry kernel in a canonical physical unit with explicit metadata.
- Display U.S. area and length as square feet, acres, feet, and inches where appropriate.
- Store money as decimal USD, never floating-point display values.
- Label cost bases such as USD/GSF, USD/NSF, USD/unit, and USD/parking stall.
- Export DXF/DAE with declared units and add U.S. architectural export formats only after unit round-trip tests exist.

## U.S. data strategy

### National baseline

| Need | Candidate source | Initial use |
|---|---|---|
| Address and geography | [U.S. Census Geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html) | Address normalization and census geography; not proof that a structure or parcel exists |
| Parcel and property | Licensed provider such as [Regrid](https://regrid.com/api) or [ATTOM](https://api.developer.attomdata.com/docs) | National schema for parcels, property attributes, transactions, and building footprints subject to coverage and license review |
| Demographic and market context | U.S. Census ACS and other licensed market sources | Context only; protected-class data must not be used to rank people, neighborhoods, or creditworthiness |
| Flood | [FEMA National Flood Hazard Layer](https://www.fema.gov/flood-maps/national-flood-hazard-layer) | Preliminary flood layer with source and access date |
| Terrain | [USGS 3D Elevation Program](https://www.usgs.gov/3d-elevation-program) | Slope, elevation, and early grading context; USGS states 3DEP products are free and without use restrictions |

### Jurisdiction adapter

Every supported city or county needs a versioned adapter for:

- parcel/APN reconciliation;
- zoning map, ordinance, overlays, and effective dates;
- allowed uses, density, height, setbacks, lot coverage/FAR, open space, and parking;
- frontage, access, easements, historic districts, and special reviews when data is available;
- local permit and planning links;
- property tax and transfer assumptions;
- local cost, rent, sale, vacancy, and cap-rate evidence.

Never scrape or redistribute MLS, CoStar, assessor, municipal-code, or provider data without confirmed license rights.

## Engineering transition from the Korean prototype

### Reuse

- planning geometry and floor-stack model;
- Three.js massing and coordinate contracts;
- spatial validation and representative-plan gates;
- Geometry Hash and scenario identity;
- DAE/DXF packaging architecture;
- source-document storage and evidence gates;
- financial ledger and reconciliation architecture;
- review snapshots, change requests, handoff packages, and reports;
- reference-image geometry lock and AI render audit trail;
- regression-test structure.

### Refactor behind country and jurisdiction interfaces

- project and parcel identifiers;
- address normalization and geocoding;
- display language, terminology, units, dates, and currency;
- zoning and building-rule evidence;
- parking, access, frontage, and envelope constraints;
- construction-cost and market assumptions;
- taxes, financing, and exit calculations;
- report and professional-review roles.

### Replace for the U.S. profile

- PNU and Korean cadastral identifiers;
- VWorld, MOLIT, and Kakao integrations;
- pyeong, manwon, KRW formatting, and Korean address parsing;
- Seoul-specific zoning, north-sunlight, parking, and housing assumptions;
- Korean acquisition tax, VAT, demolition, rent, sale, and financing defaults;
- Korean source labels, disclaimers, fixtures, and release address.

### Proposed adapter boundary

```ts
interface JurisdictionProfile {
  countryCode: "US";
  stateCode: string;
  jurisdictionId: string;
  units: UnitProfile;
  parcelProvider: ParcelProvider;
  addressProvider: AddressProvider;
  zoningProvider: ZoningEvidenceProvider;
  hazardProviders: HazardProvider[];
  financeProfile: FinanceAssumptionProfile;
  taxProfile: TaxEstimateProfile;
}
```

The internal project ID must be a PARCELGRID UUID. APN, assessor parcel ID, provider IDs, and addresses are source records, not universal primary keys.

## MVP boundaries

The first U.S. release must not promise:

- nationwide zoning automation;
- permit-ready or code-complete drawings;
- legal, title, environmental, appraisal, tax, or lending conclusions;
- automatic valuation without licensed and reviewable comparable data;
- exact construction costs without a dated source and contractor review;
- AI-generated geometry that cannot be traced to user intent and a validated scenario.

The MVP is complete only when one pilot jurisdiction can process a real parcel from address through a professional-reviewed decision report with no hidden unit conversion, stale zoning rule, or geometry/financial mismatch.

## Delivery plan

### Phase US-0 — Discovery and contracts

- interview at least 10 local developers, architects, brokers, contractors, and lenders;
- demo TestFit, Deepblocks, and Zenerate using the same representative parcel;
- choose one pilot jurisdiction and building type;
- secure data samples and review API, storage, derivative-work, and redistribution terms;
- define U.S. terminology, unit, money, APN, source, and jurisdiction contracts;
- select three real pilot parcels with professional partners.

### Phase US-1 — U.S. site intake

- create provider-neutral address and parcel interfaces;
- add internal UUID plus raw APN/provider identifiers;
- connect one parcel source and the pilot jurisdiction's official GIS;
- add FEMA flood and USGS terrain context;
- replace Korean UI terminology in the new U.S. profile;
- preserve the Korean profile as a separate regression fixture.

### Phase US-2 — By-right test fit

- encode only the pilot jurisdiction's reviewed rules;
- attach citations, effective dates, confidence, and reviewer status to every rule;
- generate conservative, return-oriented, by-right-reference, and user scenarios;
- show unresolved overlays and discretionary approvals as blockers;
- validate U.S. units through 3D and DXF/DAE round trips.

### Phase US-3 — Underwriting

- move finance storage from manwon to decimal USD;
- model acquisition, hard/soft costs, contingency, construction debt, permanent debt, rent/sale, OpEx, vacancy, and exit;
- calculate NOI, yield on cost, DSCR, IRR, NPV, equity multiple, break-even and residual land value;
- keep geometry-derived areas and parking synchronized with the ledger;
- require dated sources or explicit user assumptions for every material input.

### Phase US-4 — Professional handoff and pilot

- localize architect, planning, contractor, lender, legal, environmental, and tax review gates;
- generate a U.S. decision report and source appendix;
- test with three real parcels and compare results against professional feasibility studies;
- record false positives, false negatives, missing rules, time saved, and willingness to pay;
- do not expand to a second jurisdiction until the first adapter passes this audit.

## Validation metrics

| Metric | Initial target |
|---|---|
| Source coverage | 100% of material zoning and financial outputs have a source or explicit user-assumption label |
| Geometry/finance integrity | Zero representative scenarios with mismatched area, parking, cost, revenue, export, or report hashes |
| Unit integrity | Zero silent metric/U.S. customary or KRW/USD conversion paths |
| Rule freshness | Every jurisdiction rule stores effective and retrieval dates |
| Professional comparison | All pilot variances from architect/planner/underwriter results are explained and categorized |
| Decision speed | A complete preliminary screen in under 15 minutes after required data is available |
| Expansion gate | No new jurisdiction until the prior adapter has regression fixtures and a named professional reviewer |

## Founder decisions still required

1. Is Minneapolis/Hennepin County the first pilot, or should another metro be compared first?
2. Is the initial product type small multifamily, mixed-use infill, or another typology?
3. Is the paying customer the developer, architect, broker, lender, or municipality?
4. Will the product buy nationwide parcel/transaction data or begin with local public data?
5. What is the paid wedge: per-parcel report, monthly software, professional-assisted analysis, or a hybrid?
6. Which licensed U.S. architect/planner and real estate underwriter will validate the first three parcels?

## Immediate next actions

- Merge the Korean maintenance work independently from this U.S. strategy document.
- Keep `README.md` as the current Korean prototype runbook until the U.S. application has an executable vertical slice.
- Use this file as the U.S. product and migration contract.
- Complete competitor demos and customer interviews before redesigning the whole interface.
- Implement domain adapters and unit/currency contracts before replacing integrations or translating screens.

## Disclaimer

PARCELGRID US will provide preliminary, source-linked development feasibility support. It will not replace surveys, title work, zoning verification letters, legal opinions, environmental assessments, architectural or engineering services, appraisals, tax advice, contractor estimates, lender underwriting, or permit review. Qualified local professionals must verify material decisions.
