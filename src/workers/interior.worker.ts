import { expose } from "comlink";
import { generateInteriorCandidates } from "@/lib/planning/interior/generator";
import { calculateSolarAccess } from "@/lib/planning/solar-access";

expose({ generateInteriorCandidates, calculateSolarAccess });
