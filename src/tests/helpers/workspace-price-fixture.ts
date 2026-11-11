import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { PriceVerificationRecord } from "@/lib/finance/price-verification";
import {
  REVENUE_PRICING_INPUT_VERSION,
  type RevenuePricingDraftContract,
} from "@/lib/finance/revenue-contract";
import { projectWorkspaceFixture } from "./project-workspace-fixture";

export function priceVerificationFixture(projectId: string): PriceVerificationRecord {
  return {
    projectId, target: "acquisition", status: "draft",
    selectedComps: [{
      id: "comp-1", address: "", date: "", type: "",
      lotAreaSqm: 0, pricePerPyeongManwon: 0,
    }],
    medianPricePerPyeongManwon: 0, adjustmentPct: 0,
    verifiedPricePerPyeongManwon: 0, verifiedTotalManwon: 0,
    verifiedPricePerSqmWon: 0, reviewer: "", organization: "",
    rationale: "", verifiedAt: "", updatedAt: "2026-11-10T12:00:00.000Z",
  };
}

export function revenuePricingFixture(projectId: string): RevenuePricingDraftContract {
  return {
    version: REVENUE_PRICING_INPUT_VERSION, projectId, scenarioId: "FINANCE-S1",
    pools: {
      residentialLease: { baseUnitPriceWon: 0, adjustments: { floor: 10 } },
      retailLease: {},
    },
    updatedAt: "2026-11-10T12:00:00.000Z",
  };
}

export function workspacePriceFixture(projectId: string) {
  const workspace = projectWorkspaceFixture(projectId);
  workspace.priceVerifications = {
    acquisition: { ...priceVerificationFixture(projectId), selectedComps: [] },
    sale: { ...priceVerificationFixture(projectId), target: "sale", sourceModelVersion: null },
  };
  workspace.revenuePricingDrafts = [revenuePricingFixture(projectId)];
  return workspace;
}

// Include filenames and exact bytes so a rejected write cannot hide a new revision or audit entry.
export async function workspaceStorageFiles(directory: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else files[name] = (await readFile(path.join(directory, name))).toString("base64");
    }
  }
  await visit("");
  return files;
}
