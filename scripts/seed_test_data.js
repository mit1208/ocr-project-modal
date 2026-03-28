/**
 * Seed test data for document: residential_burglary_claim.pdf
 * Upserts all feature data so every frontend feature is visible for validation.
 *
 * Usage: node scripts/seed_test_data.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// Parse env from frontend/.env.local (handle quoted values)
const envPath = path.join(__dirname, "../frontend/.env");
const envContent = fs.readFileSync(envPath, "utf8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (match) process.env[match[1]] = match[2];
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const FILE_ID = "17m5rgggmmku07v3-residential_burglary_claim.pdf";
const CASE_ID = "d320018f-45e3-42e8-8d15-dca1d23f52d8";
const USER_ID = "24720870-dc2c-4fed-8bc7-e13e4950a62d";

// ─── ai_analysis upsert payload ───────────────────────────────────────────────

const aiAnalysisUpdate = {
  clinical_summary: `Susan Mitchell, a 41-year-old female, experienced a residential burglary on March 27, 2024, at her home in Toronto. During the incident, she sustained a 1.5-inch laceration to her left palm from broken glass while investigating the break-in. She was treated at Queen Street Urgent Care by Dr. James Chen, where she received 6 sutures with absorbable material. Vital signs at presentation were within normal limits (BP 128/80, HR 82, Temp 37.0°C, RR 16). Multiple items were stolen including electronics, jewelry, and cash totaling approximately $8,250 in claimed value. A police report (#2024-098765) was filed with Toronto Police Service by Constable Emily Rodriguez. The insurance claim was processed through CanadianInsure Corp. and settled for $6,325.00 on April 18, 2024.`,

  patients: [
    {
      patient_name: "Susan Mitchell",
      date_of_birth: "1982-08-15",
      patient_id: null,
      visit_date: "2024-03-27",
      provider: "Dr. James Chen, MD",
      facility: "Queen Street Urgent Care",
      chief_complaint: "Left hand laceration from broken glass during home break-in",
      follow_up: "Return in 10-14 days for suture removal if needed",
      summary:
        "41yo female with 1.5-inch laceration to left palm sustained during residential burglary. Treated with wound irrigation, 6 absorbable sutures. Tetanus booster administered. Discharge with wound care instructions.",
      pages: [1, 2, 3, 4, 5],
    },
  ],

  critical_flags: [
    {
      flag: "Employer-provided laptop reported as stolen — potential duplicate coverage",
      page: 10,
      severity: "HIGH",
    },
    {
      flag: "Jewelry values based on claimant estimate, not certified appraisal",
      page: 5,
      severity: "MODERATE",
    },
    {
      flag: "Missing official police report copy in initial submission",
      page: 6,
      severity: "LOW",
    },
  ],

  abnormal_findings: [
    {
      finding: "Left palm laceration",
      value: "1.5 inches, requiring 6 sutures",
      reference: "Normal: intact skin",
      page: 4,
      severity: "MODERATE",
    },
    {
      finding: "Settlement amount below claimed value",
      value: "$6,325 settled vs $8,250 claimed",
      reference: "76.7% of claimed value",
      page: 15,
      severity: "LOW",
    },
  ],

  timeline: [
    {
      date: "2023-07-15",
      event: "Homeowners insurance policy HM-2023-556234 activated with CanadianInsure Corp.",
      page: 2,
      category: "administrative",
      patient_name: "Susan Mitchell",
    },
    {
      date: "2024-03-27",
      event: "Residential burglary — back door forced open between 2:00 PM and 6:00 PM, multiple items stolen",
      page: 3,
      category: "incident",
      patient_name: "Susan Mitchell",
    },
    {
      date: "2024-03-27",
      event: "Left hand laceration sustained on broken glass while investigating break-in",
      page: 4,
      category: "injury",
      patient_name: "Susan Mitchell",
    },
    {
      date: "2024-03-27",
      event: "Urgent care visit — 1.5-inch laceration treated with 6 sutures by Dr. James Chen",
      page: 4,
      category: "visit",
      patient_name: "Susan Mitchell",
    },
    {
      date: "2024-03-27",
      event: "Toronto Police report #2024-098765 filed by Constable Emily Rodriguez",
      page: 11,
      category: "administrative",
      patient_name: "Susan Mitchell",
    },
    {
      date: "2024-04-02",
      event: "CanadianInsure Corp. sent request for additional documentation (receipts, appraisal, police report)",
      page: 6,
      category: "administrative",
      patient_name: "Susan Mitchell",
    },
    {
      date: "2024-04-05",
      event: "Claimant provided receipts, proof of purchase, photos, and medical documentation",
      page: 9,
      category: "administrative",
      patient_name: "Susan Mitchell",
    },
    {
      date: "2024-04-12",
      event: "Jewelry appraisal appointment scheduled at Helmy Jewelers",
      page: 9,
      category: "procedure",
      patient_name: "Susan Mitchell",
    },
    {
      date: "2024-04-15",
      event: "Jewelry appraisal report submitted to insurer",
      page: 14,
      category: "administrative",
      patient_name: "Susan Mitchell",
    },
    {
      date: "2024-04-17",
      event: "Claim settlement authorized by Patricia Nguyen and James Chen",
      page: 17,
      category: "administrative",
      patient_name: "Susan Mitchell",
    },
    {
      date: "2024-04-18",
      event: "Claim settled — $6,325.00 payment issued to claimant",
      page: 17,
      category: "milestone",
      patient_name: "Susan Mitchell",
    },
  ],

  groups: [
    {
      title: "Vital Signs (2024-03-27)",
      items: [
        { label: "Blood Pressure", value: "128/80 mmHg", page: 4, status: "normal", reference: "Normal: <130/80" },
        { label: "Heart Rate", value: "82 bpm", page: 4, status: "normal", reference: "Normal: 60-100" },
        { label: "Temperature", value: "37.0°C", page: 4, status: "normal", reference: "Normal: 36.5-37.5" },
        { label: "Respiratory Rate", value: "16 breaths/min", page: 4, status: "normal", reference: "Normal: 12-20" },
      ],
    },
    {
      title: "Physical Examination",
      items: [
        { label: "Left Palm Laceration", value: "1.5 inches, clean edges", page: 4, status: "abnormal", reference: "Normal: intact skin" },
        { label: "Wound Depth", value: "Partial thickness, no tendon involvement", page: 4, status: "abnormal", reference: "No deep structure damage" },
        { label: "Sensation", value: "Intact distal to laceration", page: 4, status: "normal", reference: "Normal: intact sensation" },
        { label: "Capillary Refill", value: "<2 seconds", page: 4, status: "normal", reference: "Normal: <2 seconds" },
      ],
    },
    {
      title: "Treatment Provided",
      items: [
        { label: "Wound Irrigation", value: "Normal saline irrigation performed", page: 4, status: "normal", reference: "Standard protocol" },
        { label: "Sutures", value: "6 absorbable sutures placed", page: 4, status: "abnormal", reference: "Required closure" },
        { label: "Tetanus Booster", value: "Administered", page: 4, status: "normal", reference: "Standard for lacerations" },
      ],
    },
    {
      title: "Claim Financial Summary",
      items: [
        { label: "Total Claimed Value", value: "$8,250.00", page: 5, status: "normal", reference: "Electronics + Jewelry + Cash" },
        { label: "Medical Expenses", value: "$275.00", page: 7, status: "normal", reference: "Urgent care visit" },
        { label: "Settlement Amount", value: "$6,325.00", page: 15, status: "normal", reference: "76.7% of claimed value" },
        { label: "Deductible Applied", value: "$500.00", page: 15, status: "normal", reference: "Policy deductible" },
      ],
    },
  ],

  // Clinical intake
  clinical_intake: {
    problem_list: [
      {
        id: "dx_001",
        description: "Laceration of left hand",
        icd10_code: "S61.412A",
        icd10_description: "Laceration without foreign body of left hand, initial encounter",
        status: "active",
        source_pages: [4],
        source_text: "1.5-inch laceration to left palm sustained on broken glass",
        flags: [],
        hcc_relevant: false,
        hcc_category: null,
        validated: true,
        confidence: "high",
      },
      {
        id: "dx_002",
        description: "Emotional distress following burglary",
        icd10_code: "F43.0",
        icd10_description: "Acute stress reaction",
        status: "suspected",
        source_pages: [3, 9],
        source_text: "Claimant reports difficulty sleeping and anxiety since the incident",
        flags: ["no_formal_diagnosis"],
        hcc_relevant: false,
        hcc_category: null,
        validated: false,
        confidence: "medium",
      },
    ],
    medications: [
      {
        id: "med_001",
        name: "Ibuprofen",
        dose: "400mg",
        frequency: "Every 6 hours as needed",
        prescriber: "Dr. James Chen",
        source_pages: [4],
        source_text: "Prescribed ibuprofen 400mg q6h PRN for pain",
        flags: [],
      },
      {
        id: "med_002",
        name: "Tetanus toxoid vaccine",
        dose: "0.5mL IM",
        frequency: "One-time booster",
        prescriber: "Dr. James Chen",
        source_pages: [4],
        source_text: "Tetanus booster administered",
        flags: [],
      },
    ],
    completed_workup: [
      {
        id: "proc_001",
        description: "Wound exploration and suturing",
        cpt_code: "12002",
        cpt_description: "Simple repair of superficial wounds; 2.6 cm to 7.5 cm",
        date: "2024-03-27",
        key_findings: "Clean wound edges, no foreign body, no tendon or nerve damage",
        status: "completed",
        validated: true,
        source_pages: [4],
        referenced_on_page: 4,
      },
    ],
    flags: [
      {
        id: "flag_001",
        type: "missing_followup",
        severity: "warning",
        description: "No documented follow-up visit for suture check",
        explanation: "Standard care for sutured lacerations includes follow-up in 10-14 days for wound assessment",
        suggested_action: "Confirm if follow-up visit occurred or if sutures were absorbable and self-resolving",
      },
      {
        id: "flag_002",
        type: "potential_duplicate_coverage",
        severity: "warning",
        description: "MacBook Pro may be covered under employer's equipment insurance",
        explanation: "Claimant disclosed laptop is employer-provided (InnovateTech Solutions), creating potential for duplicate claim",
        suggested_action: "Verify employer insurance coverage status before finalizing electronics portion of claim",
      },
    ],
    suggested_next_steps: [
      "Confirm wound healing status at follow-up",
      "Verify employer insurance coverage for stolen MacBook Pro",
      "Complete jewelry appraisal verification",
    ],
  },

  contradictions: {
    care_gaps: [
      {
        id: "gap_001",
        description: "No documented follow-up after suturing on 2024-03-27",
        start_date: "2024-03-27",
        end_date: null,
        severity: "low",
        patient_name: "Susan Mitchell",
      },
    ],
    contradictions: [
      {
        id: "contra_001",
        description: "Laptop listed as personal property in claim but disclosed as employer-provided equipment in correspondence",
        source_pages: [5, 10],
        severity: "moderate",
        patient_name: "Susan Mitchell",
      },
    ],
  },

  intake_status: "complete",

  // Body map regions — map findings to body regions
  body_map_regions: {
    patients: [
      {
        name: "Susan Mitchell",
        regions: {
          left_arm: [
            {
              finding: "1.5-inch laceration to left palm",
              severity: "MODERATE",
              page: 4,
              details: "Treated with 6 absorbable sutures, no tendon or nerve involvement",
            },
          ],
        },
      },
    ],
  },
};

// ─── chronology_versions ──────────────────────────────────────────────────────

const chronologyVersion = {
  file_id: FILE_ID,
  user_id: USER_ID,
  version: 1,
  label: "Initial AI-Generated Timeline",
  comment: null,
  source: "ai",
  base_version: null,
  is_final: false,
  data: [
    {
      id: "v0-0",
      date: "2023-07-15",
      description: "Homeowners insurance policy HM-2023-556234 activated with CanadianInsure Corp.",
      pages: [2],
      category: "administrative",
      comments: "Coverage period: July 15, 2023 to July 15, 2024",
      body_parts: [],
      defendants: [],
      significance: "Establishes active coverage at time of incident",
      phase: "pre",
      patient_name: "Susan Mitchell",
    },
    {
      id: "v0-1",
      date: "2024-03-27",
      description: "Residential burglary — back door forced open, multiple items stolen including electronics, jewelry, and cash",
      pages: [1, 3, 11, 13],
      category: "incident",
      comments: "Occurred between 2:00 PM and 6:00 PM while claimant was at work",
      body_parts: [],
      defendants: [],
      significance: "Primary incident triggering insurance claim",
      phase: "post",
      patient_name: "Susan Mitchell",
    },
    {
      id: "v0-2",
      date: "2024-03-27",
      description: "Left hand laceration sustained on broken glass while investigating break-in",
      pages: [4],
      category: "injury",
      comments: "1.5-inch laceration to left palm",
      body_parts: ["left hand"],
      defendants: [],
      significance: "Only physical injury from incident",
      phase: "post",
      patient_name: "Susan Mitchell",
    },
    {
      id: "v0-3",
      date: "2024-03-27",
      description: "Urgent care visit at Queen Street Urgent Care — 6 sutures placed by Dr. James Chen",
      pages: [4, 7, 8],
      category: "visit",
      comments: "Vitals normal. Wound irrigated, sutured, tetanus booster given. Charge: $275",
      body_parts: ["left hand"],
      defendants: [],
      significance: "Primary medical treatment",
      phase: "post",
      patient_name: "Susan Mitchell",
    },
    {
      id: "v0-4",
      date: "2024-03-27",
      description: "Toronto Police report #2024-098765 filed by Constable Emily Rodriguez",
      pages: [3, 11, 13],
      category: "administrative",
      comments: "Forced entry via rear door confirmed by police",
      body_parts: [],
      defendants: [],
      significance: "Official documentation of criminal incident",
      phase: "post",
      patient_name: "Susan Mitchell",
    },
    {
      id: "v0-5",
      date: "2024-04-02",
      description: "CanadianInsure Corp. requested additional documentation — receipts, appraisal, police report, medical records",
      pages: [6],
      category: "administrative",
      comments: "Standard claims documentation request",
      body_parts: [],
      defendants: [],
      significance: "Claims process milestone",
      phase: "post",
      patient_name: "Susan Mitchell",
    },
    {
      id: "v0-6",
      date: "2024-04-05",
      description: "Claimant submitted receipts, photos, and medical documentation to insurer",
      pages: [9, 10],
      category: "administrative",
      comments: "Disclosed MacBook Pro is employer-provided equipment",
      body_parts: [],
      defendants: [],
      significance: "Key disclosure about laptop ownership",
      phase: "post",
      patient_name: "Susan Mitchell",
    },
    {
      id: "v0-7",
      date: "2024-04-12",
      description: "Jewelry appraisal appointment at Helmy Jewelers",
      pages: [9],
      category: "procedure",
      comments: "Required by insurer to verify claimed jewelry values",
      body_parts: [],
      defendants: [],
      significance: "Verification of high-value items",
      phase: "post",
      patient_name: "Susan Mitchell",
    },
    {
      id: "v0-8",
      date: "2024-04-17",
      description: "Claim settlement authorized by Patricia Nguyen and James Chen at CanadianInsure",
      pages: [17],
      category: "administrative",
      comments: "Settlement: $6,325.00",
      body_parts: [],
      defendants: [],
      significance: "Claim resolution",
      phase: "post",
      patient_name: "Susan Mitchell",
    },
    {
      id: "v0-9",
      date: "2024-04-18",
      description: "Settlement payment of $6,325.00 issued to claimant's bank account",
      pages: [17],
      category: "milestone",
      comments: "Claim closed",
      body_parts: [],
      defendants: [],
      significance: "Final claim closure",
      phase: "post",
      patient_name: "Susan Mitchell",
    },
  ],
  columns: ["patient", "date", "description", "pages", "category", "significance", "comments", "body_parts", "phase"],
};

// ─── case_settings ────────────────────────────────────────────────────────────

const caseSettings = {
  user_id: USER_ID,
  case_id: CASE_ID,
  incident_date: "2024-03-27",
  gap_days_threshold: 30,
  preferred_columns: ["date", "description", "pages", "category", "significance"],
  hidden_columns: [],
  column_order: ["patient", "date", "description", "pages", "category", "significance", "comments", "body_parts", "phase"],
};

// ─── Execute upserts ──────────────────────────────────────────────────────────

async function main() {
  console.log("Seeding test data for:", FILE_ID);
  console.log("Case:", CASE_ID);
  console.log("User:", USER_ID);
  console.log("");

  // 1. Update ai_analysis
  console.log("1/3  Upserting ai_analysis...");
  const { error: aiErr } = await sb
    .from("ai_analysis")
    .update(aiAnalysisUpdate)
    .eq("file_id", FILE_ID);
  if (aiErr) {
    console.error("   FAILED:", aiErr.message);
  } else {
    console.log("   OK — clinical_summary, patients, critical_flags, abnormal_findings, timeline, groups, clinical_intake, contradictions, body_map_regions, intake_status");
  }

  // 2. Upsert chronology_versions
  console.log("2/3  Upserting chronology_versions...");
  const { error: cvErr } = await sb
    .from("chronology_versions")
    .upsert(chronologyVersion, { onConflict: "file_id,version" });
  if (cvErr) {
    console.error("   FAILED:", cvErr.message);
  } else {
    console.log("   OK — version 1 (AI-generated)");
  }

  // 3. Upsert case_settings
  console.log("3/3  Upserting case_settings...");
  const { error: csErr } = await sb
    .from("case_settings")
    .upsert(caseSettings, { onConflict: "user_id,case_id" });
  if (csErr) {
    console.error("   FAILED:", csErr.message);
  } else {
    console.log("   OK — incident_date, column prefs");
  }

  // Verify
  console.log("\n--- Verification ---");
  const { data: verify } = await sb
    .from("ai_analysis")
    .select("file_id, is_complete, clinical_summary, intake_status")
    .eq("file_id", FILE_ID)
    .single();
  console.log("ai_analysis.clinical_summary:", verify?.clinical_summary ? `${verify.clinical_summary.substring(0, 80)}...` : "NULL");
  console.log("ai_analysis.intake_status:", verify?.intake_status);

  const { data: cvVerify } = await sb
    .from("chronology_versions")
    .select("file_id, version, label")
    .eq("file_id", FILE_ID);
  console.log("chronology_versions:", cvVerify?.length, "version(s)");

  const { data: csVerify } = await sb
    .from("case_settings")
    .select("case_id, incident_date")
    .eq("case_id", CASE_ID);
  console.log("case_settings:", csVerify?.length ? "present" : "missing");

  console.log("\nDone! Refresh the page to validate all features.");
}

main().catch(console.error);
