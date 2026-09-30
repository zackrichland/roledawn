import { createServer } from "node:http";
import type { DeliverySitePolicy } from "../server/workers/application-delivery-browser.ts";

export type SyntheticDeliveryMode = "normal" | "uncertain" | "double" | "bad-upload" | "prefilled" | "greenhouse" | "traps" | "shortened-ack" | "wrong-ack"
  | "large-select" | "large-select-ambiguous" | "greenhouse-location" | "greenhouse-location-leak" | "greenhouse-verification" | "greenhouse-verification-tamper";

/** The emailed code the synthetic employer accepts. */
export const SYNTHETIC_VERIFICATION_CODE = "ABCD1234";

/** Optional look-alike questions that must never receive the candidate's own facts. */
export const SYNTHETIC_TRAP_FIELDS = Object.freeze([
  ["referral_email", '<label>Referral email<input name="referral_email" type="email"></label>'],
  ["referred_by", '<label>Who referred you (email)?<input name="referred_by" type="email"></label>'],
  ["referrer_name", '<label>Full name of referrer<input name="referrer_name"></label>'],
  ["emergency_phone", '<label>Emergency contact phone<input name="emergency_phone" type="tel"></label>'],
  ["salary", '<label>Please state your salary expectations<input name="salary"></label>'],
  ["company_website", '<label>Company website<input name="company_website" type="url"></label>'],
  ["website", '<label>Website<input name="website" type="url"></label>'],
  ["org", '<label>Current company<input name="org"></label>'],
  ["manager_name", '<label>Manager\'s name<input name="manager_name"></label>'],
  ["preferred_first_name", '<label>Preferred first name<input name="preferred_first_name"></label>'],
  ["school_state", '<label>School state<select name="school_state"><option value="">Select</option><option value="CA">California</option><option value="DC">District of Columbia</option></select></label>'],
  ["citizenship", '<label>Country of citizenship<select name="citizenship"><option value="">Select</option><option value="US">United States</option></select></label>'],
] as const);
const TRAP_STEP_FIELDS = `<label>Email<input name="email" type="email"></label><label>Phone<input name="phone" type="tel"></label>
  <label>State<select name="state"><option value="">Select</option><option value="CA">California</option><option value="DC">District of Columbia</option></select></label>
  ${SYNTHETIC_TRAP_FIELDS.map(([, html]) => html).join("\n  ")}`;

const padded = (index: number) => String(index).padStart(3, "0");
/** Long lists (more than a question can carry). Values are opaque so aliases, not codes, must resolve them. */
export const SYNTHETIC_COUNTRY_OPTIONS: readonly (readonly [string, string])[] = Object.freeze([
  ...Array.from({ length: 120 }, (_, index) => [`c-${padded(index)}`, `Synthetic Country ${padded(index)}`] as const),
  ["c-can", "Canada"], ["c-usa", "United States of America"], ["c-umi", "United States Minor Outlying Islands"],
  ...Array.from({ length: 120 }, (_, index) => [`c-${padded(index + 120)}`, `Synthetic Country ${padded(index + 120)}`] as const),
]);
export const SYNTHETIC_REGION_OPTIONS: readonly (readonly [string, string])[] = Object.freeze([
  ["st-05", "California"], ["st-09", "District of Columbia"], ["st-47", "Washington"], ["pr-09", "Ontario"],
  ...Array.from({ length: 90 }, (_, index) => [`r-${padded(index)}`, `Synthetic Region ${padded(index)}`] as const),
]);
export const SYNTHETIC_SCHOOL_OPTIONS: readonly (readonly [string, string])[] = Object.freeze(
  Array.from({ length: 150 }, (_, index) => [`school-${padded(index)}`, `Synthetic University ${padded(index)}`] as const));
const selectHtml = (id: string, label: string, options: readonly (readonly [string, string])[]) =>
  `<label for="${id}">${label}</label><select id="${id}" name="${id}" required><option value="">Select...</option>${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select>`;
const LOCATION_RESULTS = ["Washington, District of Columbia, United States", "Washington, Pennsylvania, United States", "Washington Heights, New York, United States"];
// A React Select-style search-only location field, as on hosted Greenhouse boards.
const locationField = (extraQuery: string) => `<div class="select__container"><label id="candidate-location-label" for="candidate-location">Location (City)</label>
  <div class="select-shell"><div class="select__control"><div class="select__value-container"><div class="select__single-value"></div>
  <input id="candidate-location" role="combobox" aria-autocomplete="list" aria-haspopup="true" aria-expanded="false" aria-required="true" autocomplete="off" value=""></div></div>
  <div id="react-select-candidate-location-listbox" role="listbox" hidden></div></div></div>
  <script>(() => {
    const input=document.getElementById('candidate-location'),menu=document.getElementById('react-select-candidate-location-listbox'),display=document.querySelector('.select__single-value');let sequence=0,last=[];
    function close(){menu.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-controls');}
    function open(){menu.hidden=false;input.setAttribute('aria-expanded','true');input.setAttribute('aria-controls',menu.id);}
    function render(labels){menu.replaceChildren(...labels.map((label,index)=>{const option=document.createElement('div');option.id='react-select-candidate-location-option-'+index;option.setAttribute('role','option');option.textContent=label;
      option.addEventListener('click',()=>{display.textContent=label;input.value='';close();});return option;}));}
    // Like React Select's async menu: empty before any search, the last results after a choice.
    input.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();if(!input.value)render(display.textContent?last:[]);open();}if(event.key==='Escape'){event.preventDefault();close();}});
    input.addEventListener('input',async()=>{const query=input.value,mine=++sequence;if(!query){render([]);return;}open();menu.setAttribute('aria-busy','true');
      // Greenhouse's own lookup carries fixed parameters beside the typed text.
      const response=await fetch('/locations?api_key=ge-0123456789abcdef&layers=locality&lang=en${extraQuery}&q='+encodeURIComponent(query)).catch(()=>null);const labels=response&&response.ok?await response.json():[];
      if(mine!==sequence)return;menu.removeAttribute('aria-busy');last=labels;render(labels);});
  })();</script>`;

/** Synthetic local HTTP only. No candidate or employer data and no provider calls. */
export async function startSyntheticAtsDelivery(mode: SyntheticDeliveryMode = "normal") {
  const requests = { submits: 0, uploads: [] as Buffer[], next: 0, back: 0, leaks: 0, searches: [] as string[] };
  const verification = mode === "greenhouse-verification" || mode === "greenhouse-verification-tamper";
  const location = mode === "greenhouse-location" || mode === "greenhouse-location-leak";
  const greenhouse = mode === "greenhouse" || location || verification;
  // Greenhouse-shaped final request: JSON with a CAPTCHA token; a 428
  // "captcha-failed" answer shows eight code boxes, and the page resends the
  // same application with security_code. The tamper mode alters the resend.
  const verificationScript = `let verifying=false;
      function showVerification(recipient){let fieldset=document.getElementById('email-verification');
        if(!fieldset){fieldset=document.createElement('fieldset');fieldset.id='email-verification';
          fieldset.innerHTML='<legend>Enter the code sent to '+recipient+'</legend>'+Array.from({length:8},(_,i)=>'<input id="security-input-'+i+'" type="text" maxlength="1">').join('');
          document.getElementById('second').append(fieldset);}
        else fieldset.querySelectorAll('input').forEach(input=>{input.value='';});}
      document.getElementById('submit').addEventListener('click',async()=>{
        const application={consent:document.querySelector('[name=consent]').checked};
        ${mode === "greenhouse-verification-tamper" ? "if(verifying)application.consent=!application.consent;" : ""}
        const code=[...document.querySelectorAll('#email-verification input')].map(input=>input.value).join('');
        const body=verifying?{job_application:application,security_code:code,fingerprint:'fp-1'}:{job_application:application,'g-recaptcha-enterprise-token':'synthetic-token',fingerprint:'fp-1'};
        const r=await fetch('/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).catch(()=>null);
        if(!r)return;if(r.ok){location.assign('/receipt');return;}
        const data=await r.json();if(data.code==='captcha-failed'&&data.security_code_recipient){verifying=true;showVerification(data.security_code_recipient);}
      });`;
  const countries = mode === "large-select-ambiguous" ? [...SYNTHETIC_COUNTRY_OPTIONS, ["c-us", "United States"] as const] : SYNTHETIC_COUNTRY_OPTIONS;
  const extraFields = mode === "traps" ? TRAP_STEP_FIELDS
    : mode === "large-select" ? selectHtml("country", "Country", countries) + selectHtml("state", "State/Province", SYNTHETIC_REGION_OPTIONS) + selectHtml("school", "School", SYNTHETIC_SCHOOL_OPTIONS)
      : mode === "large-select-ambiguous" ? selectHtml("country", "Country", countries)
        : location ? locationField(mode === "greenhouse-location-leak" ? "&email=candidate%40example.test" : "") : "";
  const server = createServer(async (request, response) => {
    const data: Buffer[] = [];
    for await (const chunk of request) data.push(Buffer.from(chunk));
    const body = Buffer.concat(data);
    const html = (value: string) => { response.writeHead(200, { "content-type": "text/html" }); response.end(`<!doctype html><html><body>${value}</body></html>`); };
    if (request.url === "/step1" && request.method === "GET") return html(`<form id="first"><label>Name<input name="name" required></label>
      <div id="resume-field" class="file-upload"><h3 id="upload-label-resume">Resume/CV</h3><label>Resume<input id="resume" type="file" required accept="application/pdf"></label><p id="upload-ack" class="file-upload__filename"></p></div>
      <label>Candidate note<input name="note" value="Keep my note"></label>${extraFields}<button id="next" type="button">Next</button></form>
      <script>${greenhouse ? "const signing=fetch('/uncacheable_attributes/presigned_fields?fields%5B%5D=resume').then(r=>r.json());" : ""}
      document.getElementById('resume').addEventListener('change',async event=>{
        const file=event.target.files[0]; let uploadBody=file;
        ${greenhouse ? "const signed=await signing;uploadBody=new FormData();for(const[key,value]of Object.entries(signed.resume.fields))uploadBody.append(key,value);uploadBody.append('key',signed.resume.key.replace('{timestamp}',String(Date.now())).replace('{unique_id}','fixture123'));uploadBody.append('file',file);" : ""}
        const result=await fetch('/upload',{method:'POST',body:uploadBody});
        if(result.ok){document.getElementById('upload-ack').textContent=${mode === "shortened-ack" ? "file.name.slice(0,14)+'\\u2026'+file.name.slice(-11)" : mode === "wrong-ack" ? "file.name.slice(0,14)+'\\u2026'+'Other.pdf'" : "file.name"};event.target.remove();}
      });document.getElementById('next').addEventListener('click',async()=>{await fetch('/next',{method:'POST',body:document.querySelector('[name=name]').value});location.assign('/step2');});</script>`);
    if (request.url === "/step2" && request.method === "GET") return html(`<form id="second"><label>Do you consent to a background check?<input name="consent" type="checkbox" required ${mode === "prefilled" ? "checked" : ""}></label>
      <button id="back" type="button">Back</button><button id="submit" type="button">Submit application</button></form>
      <script>document.getElementById('back').addEventListener('click',async()=>{await fetch('/back',{method:'POST'});location.assign('/step1');});
      ${verification ? verificationScript : `document.getElementById('submit').addEventListener('click',async()=>{const r=await fetch('/submit',{method:'POST',body:JSON.stringify({consent:document.querySelector('[name=consent]').checked})});
        ${mode === "double" ? "fetch('/submit',{method:'POST',body:'duplicate'}).catch(()=>{});" : ""}
        ${mode === "uncertain" ? "" : "if(r.ok)location.assign('/receipt');"}
      });`}</script>`);
    if (request.url?.startsWith("/uncacheable_attributes/presigned_fields?") && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ url: `http://${request.headers.host}/upload`, resume: { fields: { policy: "synthetic-policy", "x-amz-signature": "synthetic-signature" }, key: "stash/applications/resumes/{timestamp}-{unique_id}-fixture" } })); return;
    }
    if (request.url?.startsWith("/locations?") && request.method === "GET") {
      const query = new URL(request.url, "http://fixture.invalid").searchParams.get("q") ?? "";
      requests.searches.push(query);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(LOCATION_RESULTS.filter((label) => label.toLowerCase().startsWith(query.toLowerCase())))); return;
    }
    if (request.url === "/upload" && request.method === "POST") { requests.uploads.push(body); response.writeHead(mode === "bad-upload" ? 503 : 201).end(); return; }
    if (request.url === "/next" && request.method === "POST") { requests.next += 1; response.writeHead(200).end(); return; }
    if (request.url === "/back" && request.method === "POST") { requests.back += 1; response.writeHead(200).end(); return; }
    if (request.url === "/submit" && request.method === "POST" && verification) {
      requests.submits += 1;
      let data: { security_code?: unknown } = {};
      try { data = JSON.parse(body.toString("utf8")) as { security_code?: unknown }; } catch { /* rejected below */ }
      if (data.security_code === SYNTHETIC_VERIFICATION_CODE) { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ accepted: true })); return; }
      response.writeHead(428, { "content-type": "application/json" }).end(JSON.stringify({ code: "captcha-failed", security_code_recipient: "a***@example.test" })); return;
    }
    if (request.url === "/submit" && request.method === "POST") { requests.submits += 1; response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ accepted: true, receipt: "receipt-123" })); return; }
    if (request.url === "/receipt" && request.method === "GET") return html('<main id="receipt" data-receipt-id="receipt-123">Application received. Thank you.</main>');
    requests.leaks += 1; response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("SYNTHETIC_DELIVERY_ADDRESS_INVALID");
  const origin = `http://127.0.0.1:${address.port}`;
  const policy: DeliverySitePolicy = { release: "synthetic-delivery/1", startUrl: `${origin}/step1`,
    ...(greenhouse ? { greenhouse: { presignOrigin: origin, uploadOrigins: [origin] } } : {}),
    ...(location ? { searches: [{ origin, path: "/locations", query: "q", params: { api_key: "ge-0123456789abcdef", layers: "locality", lang: "en" } }] } : {}),
    steps: [{ id: "first", url: `${origin}/step1`, readySelector: "#first", uploads: [{ fieldId: "resume", selector: "#resume", ...(greenhouse ? {} : { request: { method: "POST" as const, url: `${origin}/upload` } }), acknowledgementSelector: ".file-upload:has(#upload-label-resume) .file-upload__filename" }], forward: { selector: "#next", request: { method: "POST", url: `${origin}/next` }, nextStepId: "second" } },
      { id: "second", url: `${origin}/step2`, readySelector: "#second", back: { selector: "#back", request: { method: "POST", url: `${origin}/back` }, nextStepId: "first" }, submit: { selector: "#submit", request: { method: "POST", url: `${origin}/submit` } } }],
    receipt: { url: `${origin}/receipt`, selector: "#receipt", textPattern: "Application received", receiptIdAttribute: "data-receipt-id" } };
  return { policy, requests, async close() { await new Promise<void>((resolve) => server.close(() => resolve())); } };
}
