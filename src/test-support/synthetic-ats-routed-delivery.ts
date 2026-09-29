import type { DeliveryRequestTransport, DeliverySitePolicy } from "../server/workers/application-delivery-browser.ts";
import { startSyntheticAtsDelivery, type SyntheticDeliveryMode } from "./synthetic-ats-delivery.ts";

/** The browser sees a reserved .invalid origin; no request reaches an employer. */
export async function createRoutedSyntheticAtsDelivery(runId: string, mode: SyntheticDeliveryMode = "normal") {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(runId)) throw new Error("SYNTHETIC_RUN_ID_INVALID");
  if (mode === "greenhouse") throw new Error("SYNTHETIC_ROUTED_GREENHOUSE_UNSUPPORTED");
  const server = await startSyntheticAtsDelivery(mode);
  const origin = `https://${runId}.roledawn-acceptance.invalid`;
  const localOrigin = new URL(server.policy.startUrl).origin;
  const rewrite = (value: string) => origin + new URL(value).pathname;
  const policy: DeliverySitePolicy = { ...server.policy, startUrl: rewrite(server.policy.startUrl),
    steps: server.policy.steps.map((step) => ({ ...step, url: rewrite(step.url),
      uploads: step.uploads?.map((upload) => ({ ...upload, request: upload.request && { ...upload.request, url: rewrite(upload.request.url) } })),
      forward: step.forward && { ...step.forward, request: step.forward.request && { ...step.forward.request, url: rewrite(step.forward.request.url) } },
      back: step.back && { ...step.back, request: step.back.request && { ...step.back.request, url: rewrite(step.back.request.url) } },
      submit: step.submit && { ...step.submit, request: { ...step.submit.request, url: rewrite(step.submit.request.url) } },
    })), receipt: { ...server.policy.receipt, url: rewrite(server.policy.receipt.url) } };
  const allowed = new Set(["GET /step1", "GET /step2", "GET /receipt", "POST /upload", "POST /next", "POST /back", "POST /submit"]);
  let fulfilled = 0;
  const requestTransport: DeliveryRequestTransport = async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== origin || url.search || url.hash || !allowed.has(`${request.method()} ${url.pathname}`)) throw new Error("SYNTHETIC_TRANSPORT_DESTINATION_DENIED");
    const body = request.postDataBuffer();
    const response = await fetch(localOrigin + url.pathname, { method: request.method(), redirect: "error",
      headers: request.headers()["content-type"] ? { "content-type": request.headers()["content-type"] } : {},
      ...(body ? { body: new Uint8Array(body) } : {}), signal: AbortSignal.timeout(10_000) });
    let responseBody = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    // Preserve one varied-label field for the actual model after deterministic
    // fact/artifact fast paths are enabled. All supplied content is synthetic.
    if (url.pathname === "/step1" && contentType.includes("text/html")) responseBody = Buffer.from(responseBody.toString("utf8").replace("<label>Name<input", "<label>How should our team address you?<input"));
    await route.fulfill({ status: response.status, headers: { "content-type": contentType }, body: responseBody });
    fulfilled += 1;
  };
  return { policy, requestTransport, requests: server.requests, fulfilledRequests: () => fulfilled, close: server.close };
}
