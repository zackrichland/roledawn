import type { Route } from "playwright-core";
import { resolveLeverDeliveryPolicy } from "../server/workers/application-delivery-browser.ts";

export type SyntheticLeverMode = "normal" | "bad-upload" | "uncertain" | "duplicate" | "altered-file" | "upload-extra-field" | "parser-autofill" | "captcha" | "form-drift"
  | "invisible-captcha" | "captcha-on-submit" | "foreign-captcha" | "parser-change-events" | "filename-uppercase" | "filename-changed";
const SITEKEY = "a0000000-0000-4000-8000-00000000000b";
const HCAPTCHA_FRAME = "https://newassets.hcaptcha.com/captcha/v1/fixture/static/hcaptcha.html";
const HCAPTCHA_MODES = new Set<SyntheticLeverMode>(["captcha", "invisible-captcha", "captcha-on-submit"]);

/**
 * In-memory stand-in for hCaptcha's loader. It never solves anything: in
 * passive mode the score request returns a pass token; in challenge mode
 * execute() shows a visible challenge frame and never calls back.
 */
function hcaptchaScript(mode: SyntheticLeverMode) {
  return `(() => {
  let callback = null, challenge = null;
  window.hcaptcha = {
    render(container, params) {
      callback = params.callback;
      const invisible = params.size === 'invisible';
      const anchor = document.createElement('iframe');
      anchor.src = '${HCAPTCHA_FRAME}#frame=' + (invisible ? 'checkbox-invisible' : 'checkbox') + '&id=0&host=jobs.lever.co&sitekey=${SITEKEY}';
      anchor.style.cssText = invisible ? 'display:none' : 'width:303px;height:78px;border:0';
      container.appendChild(anchor);
      const response = document.createElement('textarea'); response.name = 'h-captcha-response'; response.style.display = 'none'; container.appendChild(response);
      const wrapper = document.createElement('div'); wrapper.id = 'hcaptcha-challenge'; wrapper.style.cssText = 'visibility:hidden;position:absolute;top:-10000px;left:0;opacity:0';
      challenge = document.createElement('iframe'); challenge.src = '${HCAPTCHA_FRAME}#frame=challenge&id=0&host=jobs.lever.co&sitekey=${SITEKEY}';
      challenge.style.cssText = 'width:400px;height:580px;border:0'; wrapper.appendChild(challenge); document.body.appendChild(wrapper);
      fetch('https://api.hcaptcha.com/checksiteconfig?v=fixture&host=jobs.lever.co&sitekey=${SITEKEY}&sc=1&swa=1', { method: 'POST' }).catch(() => {});
      // Neither an early score request nor a challenge answer may leave the browser.
      fetch('https://api.hcaptcha.com/getcaptcha/${SITEKEY}', { method: 'POST', body: 'early=1' }).catch(() => {});
      fetch('https://api.hcaptcha.com/checkcaptcha/${SITEKEY}/fixture', { method: 'POST', body: 'answers=guessed' }).catch(() => {});
      return 0;
    },
    async execute() {
      ${mode === "captcha-on-submit" ? "challenge.parentElement.style.cssText = 'visibility:visible;position:absolute;top:20px;left:20px;opacity:1'; return;" : ""}
      const result = await fetch('https://api.hcaptcha.com/getcaptcha/${SITEKEY}', { method: 'POST', body: 'v=fixture&host=jobs.lever.co' }).then((r) => r.json());
      if (result.pass) { document.querySelector('[name="h-captcha-response"]').value = result.generated_pass_UUID; callback(result.generated_pass_UUID); }
    },
  };
})();`;
}

/** Serves every request in-memory after the production browser policy checks it.
 * No network fallback exists, including for recognized production-looking URLs. */
export function syntheticLeverDelivery(mode: SyntheticLeverMode = "normal") {
  const destination = "https://jobs.lever.co/roledawn-fixture/10000000-0000-4000-8000-000000000001/apply";
  const policy = resolveLeverDeliveryPolicy(destination);
  const observed = { submits: 0, uploads: [] as Buffer[], requests: [] as string[], captchaScores: 0 };
  const hcaptcha = HCAPTCHA_MODES.has(mode);
  const html = `<!doctype html><html>${mode === "filename-uppercase" ? '<style>.filename{text-transform:uppercase}</style>' : ""}<body><form id="application-form" method="POST" enctype="multipart/form-data" ${mode === "form-drift" ? 'action="/wrong-employer"' : ""}>
    <label><div class="application-label">Resume/CV <span class="required">✱</span></div><div class="application-field"><a class="visible-resume-upload"><span class="filename"></span><input type="file" name="resume" id="resume-upload-input" style="opacity:0;width:1px;height:1px"></a><span class="resume-upload-success" style="display:none">Resume analyzed</span></div></label>
    <label>Full name<input name="name" required></label><label>Current company<input name="org"></label>
    <input type="hidden" name="accountId" value="20000000-0000-4000-8000-000000000002">
    ${hcaptcha ? `<div id="h-captcha" class="h-captcha" data-sitekey="${SITEKEY}"${mode === "captcha" ? "" : ' data-size="invisible"'}></div><script src="https://js.hcaptcha.com/1/secure-api.js?render=explicit"></script>` : ""}
    ${mode === "foreign-captcha" ? '<iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?k=fixture&size=invisible" style="display:none"></iframe>' : ""}
    <button type="button" id="btn-submit">Submit application</button></form><script>
    const form=document.getElementById('application-form'),file=document.getElementById('resume-upload-input');
    ${mode === "parser-change-events" ? "let nameEdited=false;form.elements.name.addEventListener('change',()=>{nameEdited=true;});" : ""}
    file.addEventListener('change',async()=>{const data=new FormData();data.append('resume',file.files[0]);data.append('accountId',form.elements.accountId.value);${mode === "upload-extra-field" ? "data.append('unauthorized','LEAK');" : ""}
      document.querySelector('.filename').textContent=${mode === "filename-changed" ? "'Other-Resume.pdf'" : "file.files[0].name"};
      const result=await fetch('/parseResume',{method:'POST',body:data});
      if(result.ok){document.querySelector('.resume-upload-success').style.display='block';${mode === "parser-autofill" ? "form.elements.org.value='Unverified employer';" : mode === "parser-change-events" ? "if(!nameEdited)form.elements.name.value='Unapproved parser name';" : ""}}
    });
    async function send(){const data=new FormData(form);${mode === "altered-file" ? "data.set('resume',new File(['wrong bytes'],'resume.pdf',{type:'application/pdf'}));" : ""}
      const result=await fetch(form.action,{method:'POST',body:data,redirect:'manual'});
      ${mode === "duplicate" ? "fetch(form.action,{method:'POST',body:data}).catch(()=>{});" : ""}
      ${mode === "uncertain" ? "" : "if(result.ok || result.type==='opaqueredirect')location.assign('" + policy.receipt.url + "');"}
    }
    const widget=window.hcaptcha?hcaptcha.render(document.getElementById('h-captcha'),{sitekey:'${SITEKEY}',size:document.getElementById('h-captcha').dataset.size,callback:()=>send()}):null;
    document.getElementById('btn-submit').addEventListener('click',()=>{if(window.hcaptcha)hcaptcha.execute(widget);else send();});</script></body></html>`;
  const cors = { "access-control-allow-origin": "https://jobs.lever.co" };
  async function transport(route: Route) {
    const r=route.request(); observed.requests.push(`${r.method()} ${r.url()}`);
    if(r.method()==="GET" && r.url()===destination) return route.fulfill({status:200,contentType:"text/html",body:html});
    if(r.method()==="POST" && r.url()==="https://jobs.lever.co/parseResume") {observed.uploads.push(r.postDataBuffer()!);return route.fulfill({status:mode==="bad-upload"?503:200,contentType:"application/json",body:'{"resumeStorageId":"synthetic-id"}'});}
    if(r.method()==="POST" && r.url()===destination) {observed.submits+=1;return route.fulfill({status:200,contentType:"application/json",body:'{"ok":true}'});}
    if(r.method()==="GET" && r.url()===policy.receipt.url) return route.fulfill({status:200,contentType:"text/html",body:'<h3 data-qa="msg-submit-success">Application submitted!</h3>'});
    if(hcaptcha && r.method()==="GET" && r.url()==="https://js.hcaptcha.com/1/secure-api.js?render=explicit") return route.fulfill({status:200,contentType:"text/javascript",body:hcaptchaScript(mode)});
    if(hcaptcha && r.method()==="GET" && r.url()===HCAPTCHA_FRAME) return route.fulfill({status:200,contentType:"text/html",body:"<!doctype html><html><body>synthetic hCaptcha frame</body></html>"});
    if(hcaptcha && r.method()==="POST" && r.url().startsWith("https://api.hcaptcha.com/checksiteconfig?")) return route.fulfill({status:200,contentType:"application/json",headers:cors,body:'{"pass":true}'});
    if(hcaptcha && r.method()==="POST" && r.url()===`https://api.hcaptcha.com/getcaptcha/${SITEKEY}`) {observed.captchaScores+=1;return route.fulfill({status:200,contentType:"application/json",headers:cors,body:'{"pass":true,"generated_pass_UUID":"P1_synthetic-pass"}'});}
    throw new Error("SYNTHETIC_LEVER_UNEXPECTED_REQUEST");
  }
  return {policy,observed,transport};
}
