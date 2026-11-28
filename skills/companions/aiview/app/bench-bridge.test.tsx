// The bench bridge: the sidecar path grammar, and the app's relay as PrototypeFrame runs it.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { BENCH_BRIDGE_MARK, isSidecarPath } from "./workbench/bench-bridge.ts";
import { PrototypeFrame } from "./prototype/PrototypeFrame.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const PAGE = "<html><head></head><body><p>bench</p></body></html>";
const DOC = { id: 7, file_path: "docs/2026-01-01-probe.workbench.html" };

describe("isSidecarPath", () => {
  test("accepts the manifest and a hashed run file", () => {
    expect(isSidecarPath("manifest.json")).toBe(true);
    expect(isSidecarPath("data/t/r/run.ab12cd34.json")).toBe(true);
  });
  test.each(["../x", "%2e%2e/x", "CON.json", "manifest.json.", "manifest.json:x", "/x", ".hidden", "data\\x.json"])(
    "refuses %s",
    (p) => expect(isSidecarPath(p)).toBe(false),
  );
});

/** A workbench framed with the bridge; `answers` collects what the app posts back to the frame. */
function frameBench(dataTick = 0) {
  const view = render(<PrototypeFrame html={PAGE} workbench doc={DOC} dataTick={dataTick} />);
  const frame = document.querySelector("iframe")!;
  const win = frame.contentWindow!;
  const answers: unknown[] = [];
  vi.spyOn(win, "postMessage").mockImplementation((msg: unknown) => void answers.push(msg));
  const fromFrame = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data, source: win }));
  return { view, frame, win, answers, fromFrame };
}

const stubFetch = (response: unknown) => {
  const fetch = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

describe("the bench relay", () => {
  test("a prototype gets no bridge; a workbench does", () => {
    render(<PrototypeFrame html={PAGE} />);
    expect(document.querySelector("iframe")!.getAttribute("srcdoc")).not.toContain(BENCH_BRIDGE_MARK);
    cleanup();
    render(<PrototypeFrame html={PAGE} workbench doc={DOC} />);
    expect(document.querySelector("iframe")!.getAttribute("srcdoc")).toContain(BENCH_BRIDGE_MARK);
  });

  test("a message not from its frame is ignored", async () => {
    const fetch = stubFetch(new Response("{}", { status: 200 }));
    const { answers } = frameBench();
    window.dispatchEvent(new MessageEvent("message", { data: { type: "aiview:data", req: 1, path: "manifest.json" }, source: window }));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetch).not.toHaveBeenCalled();
    expect(answers).toEqual([]);
  });

  test("a relative fetch is answered with the server's status", async () => {
    const fetch = stubFetch(new Response("missing", { status: 404 }));
    const { answers, fromFrame } = frameBench();
    fromFrame({ type: "aiview:data", req: 3, path: "manifest.json" });
    await waitFor(() => expect(answers).toHaveLength(1));
    expect(fetch).toHaveBeenCalledWith("/api/asset/7/2026-01-01-probe.workbench/manifest.json");
    expect(answers[0]).toMatchObject({ type: "aiview:data", req: 3, ok: false, status: 404 });
  });

  test("a body over 64 MB is refused 413", async () => {
    const cancel = vi.fn();
    stubFetch({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(65 * 1024 * 1024) }),
      body: { cancel },
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const { answers, fromFrame } = frameBench();
    fromFrame({ type: "aiview:data", req: 4, path: "data/t/r/run.ab12cd34.json" });
    await waitFor(() => expect(answers).toHaveLength(1));
    expect(answers[0]).toMatchObject({ req: 4, ok: false, status: 413 });
  });

  test("a state set is stored as aiview.bench.<id>.<key> and the srcDoc is not rebuilt", async () => {
    const { frame, fromFrame } = frameBench();
    const before = frame.getAttribute("srcdoc");
    fromFrame({ type: "aiview:state", key: "tab", value: "t2" });
    expect(localStorage.getItem("aiview.bench.7.tab")).toBe("t2");
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("iframe")!.getAttribute("srcdoc")).toBe(before);
  });
});
