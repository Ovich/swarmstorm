// The verb table (codebase-rework#D11): every verb aiview answers, one entry each.
import type { Verb } from "../dispatch.ts";
import { DOCUMENT_VERBS } from "./documents.ts";
import { HOME_VERBS } from "./home.ts";
import { PENDING_VERBS } from "./pending.ts";
import { PLAN_VERBS } from "./plan.ts";
import { PROJECT_VERBS } from "./project.ts";
import { PROTOTYPE_VERBS } from "./prototype.ts";
import { VIEWER_VERBS } from "./viewer.ts";

export const VERBS: readonly Verb[] = [
  ...DOCUMENT_VERBS,
  ...PROJECT_VERBS,
  ...VIEWER_VERBS,
  ...PENDING_VERBS,
  ...HOME_VERBS,
  ...PROTOTYPE_VERBS,
  ...PLAN_VERBS,
];
