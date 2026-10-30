// Typed client over the backend-for-frontend API. Types come from src/core (type-only,
// erased at build) so the contract-guard test can hold server and app to one shape.
import type { BindingsSummary, DocumentsResponse, DocumentResponse } from "../../src/core/api.ts";
import type { Document, DocumentWithState, Pending } from "../../src/core/db.ts";

export type { BindingsSummary, DocumentsResponse, DocumentResponse, Document, DocumentWithState, Pending };

export async function fetchDocuments(): Promise<DocumentsResponse> {
  const r = await fetch("/api/documents");
  if (!r.ok) throw new Error(`GET /api/documents: ${r.status}`);
  return (await r.json()) as DocumentsResponse;
}

export async function fetchDocument(id: number): Promise<DocumentResponse | null> {
  const r = await fetch(`/api/document/${id}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET /api/document/${id}: ${r.status}`);
  return (await r.json()) as DocumentResponse;
}

/** The one write path for the active project — the CLI posts here too. */
/** Records the project this tab shows as the one a new tab starts on (board-split#D41); it moves no other tab. */
export async function recordRecentProject(project: string): Promise<string> {
  const r = await fetch("/api/recent-project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project }),
  });
  if (!r.ok) throw new Error(`POST /api/recent-project: ${r.status}`);
  return ((await r.json()) as { project: string }).project;
}

export const rawUrl = (id: number): string => `/api/raw/${id}?t=${Date.now()}`;
export const assetUrl = (docId: number, rel: string): string => `/api/asset/${docId}/${rel}`;

/** Pin or unpin a document in the viewer's menu; every open tab hears it as an index change. */
export async function setPinned(id: number, pinned: boolean): Promise<void> {
  const r = await fetch("/api/pin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, pinned }),
  });
  if (!r.ok) throw new Error(`POST /api/pin: ${r.status}`);
}

/** The repositories a project's board reads: the board page's source. */
export async function fetchProjectBoard(project: string): Promise<string[]> {
  const r = await fetch(`/api/project-board?project=${encodeURIComponent(project)}`);
  if (!r.ok) throw new Error(`GET /api/project-board: ${r.status}`);
  return ((await r.json()) as { repos: string[] }).repos;
}

/** The project a board hash's `project=` names and its board's repositories (board-split#D41, D47). */
export async function fetchBoardOfKey(project: string): Promise<{ project: string; repos: string[] }> {
  const r = await fetch(`/api/project-board?project=${encodeURIComponent(project)}`);
  if (!r.ok) throw new Error(`GET /api/project-board: ${r.status}`);
  return (await r.json()) as { project: string; repos: string[] };
}
