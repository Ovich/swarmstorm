// The verb table (codebase-rework#D11): every verb aiview answers, one entry each.
import type { Verb } from "../dispatch.ts";
import { DOCUMENT_VERBS } from "../../documents/verbs.ts";
import { HOME_VERBS } from "../../home/verbs.ts";
import { PENDING_VERBS } from "../../pending/verbs.ts";
import { PLAN_VERBS } from "../../plan/verbs.ts";
import { PROJECT_VERBS } from "../../projects/verbs.ts";
import { PROTOTYPE_VERBS } from "../../prototype/verbs.ts";
import { SERVE_VERBS } from "./serve.ts";
import { BOARD_VERBS } from "../../board/verbs.ts";

export const VERBS: readonly Verb[] = [
  ...DOCUMENT_VERBS,
  ...PROJECT_VERBS,
  ...SERVE_VERBS,
  ...BOARD_VERBS,
  ...PENDING_VERBS,
  ...HOME_VERBS,
  ...PROTOTYPE_VERBS,
  ...PLAN_VERBS,
];
