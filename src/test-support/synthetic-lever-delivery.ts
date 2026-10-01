import type { Route } from "playwright-core";
import { resolveLeverDeliveryPolicy } from "../server/workers/application-delivery-browser.ts";

export type SyntheticLeverMode = "normal" | "bad-upload" | "uncertain" | "duplicate" | "altered-file" | "upload-extra-field" | "parser-autofill" | "captcha" | "form-drift"
  | "invisible-captcha" | "captcha-on-submit" | "captcha-solved-on-submit" | "foreign-captcha" | "parser-change-events" | "filename-uppercase" | "filename-changed"
  | "parser-prefilled" | "parser-required" | "parser-other-slot" | "parser-repopulate" | "parser-required-location" | "parser-location-null" | "location-metadata-drift" | "location-query-leak" | "navigation-timeout" | "browserbase-solver" | "browserbase-solver-delayed" | "browserbase-solver-pending" | "browserbase-solver-query" | "browserbase-solver-port";
const SITEKEY = "a0000000-0000-4000-8000-00000000000b";
const HCAPTCHA_FRAME = "https://newassets.hcaptcha.com/captcha/v1/fixture/static/hcaptcha.html";
const HCAPTCHA_MODES = new Set<SyntheticLeverMode>(["captcha", "invisible-captcha", "captcha-on-submit", "captcha-solved-on-submit", "browserbase-solver", "browserbase-solver-delayed", "browserbase-solver-pending", "browserbase-solver-query", "browserbase-solver-port"]);

/**
 * In-memory stand-in for hCaptcha's loader. In passive mode the score request
 * returns a pass token; in challenge mode execute() shows a visible challenge
 * frame and never calls back; in solved mode it shows the challenge, then acts
 * like the session's solver: fills the token, hides the challenge, calls back.
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
      ${mode === "captcha-on-submit" ? "const earlyImage=new Image();earlyImage.src='https://imgs.hcaptcha.com/fixture-check.png';" : ""}
      return 0;
    },
    async execute() {
      ${mode.startsWith("browserbase-solver") ? `const pending=await fetch('http://127.0.0.1:${mode === "browserbase-solver-port" ? "8081" : "8080"}/solve/hcaptcha/create${mode === "browserbase-solver-query" ? "?extra=unapproved" : ""}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteKey:'${SITEKEY}',url:location.href})}).then(r=>r.json());const solved=await fetch('http://127.0.0.1:8080/solve/hcaptcha/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...pending,solveAttempts:0})}).then(r=>r.json());if(solved.token){document.querySelector('[name="h-captcha-response"]').value=solved.token;callback(solved.token);}return;` : ""}
      ${mode === "captcha-on-submit" ? "await new Promise(resolve=>{const image=new Image();image.onload=image.onerror=resolve;image.src='https://imgs.hcaptcha.com/fixture-check.png';}); challenge.parentElement.style.cssText = 'visibility:visible;position:absolute;top:20px;left:20px;opacity:1'; return;" : ""}
      ${mode === "captcha-solved-on-submit" ? "challenge.parentElement.style.cssText = 'visibility:visible;position:absolute;top:20px;left:20px;opacity:1'; await new Promise((resolve) => setTimeout(resolve, 400)); document.querySelector('[name=\"h-captcha-response\"]').value = 'P1_synthetic-solved'; challenge.parentElement.style.cssText = 'visibility:hidden;position:absolute;top:-10000px;left:0;opacity:0'; callback('P1_synthetic-solved'); return;" : ""}
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
  const observed = { submits: 0, uploads: [] as Buffer[], submissions: [] as Buffer[], requests: [] as string[], captchaScores: 0 };
  const hcaptcha = HCAPTCHA_MODES.has(mode);
  const locationWidget = ["parser-required-location", "parser-location-null", "location-metadata-drift", "location-query-leak"].includes(mode);
  const html = `<!doctype html><html><meta charset="utf-8">${mode === "filename-uppercase" ? '<style>.filename{text-transform:uppercase}</style>' : ""}<body><form id="application-form" method="POST" enctype="multipart/form-data" ${mode === "form-drift" ? 'action="/wrong-employer"' : ""}>
    <label><div class="application-label">Resume/CV <span class="required">✱</span></div><div class="application-field"><a class="visible-resume-upload"><span class="filename"></span><input type="file" name="resume" id="resume-upload-input" style="opacity:0;width:1px;height:1px"></a><span class="resume-upload-success" style="display:none">Resume analyzed</span></div></label>
    <label>Full name<input name="name" required></label><label>Current company<input name="${mode === "parser-other-slot" ? "otherOrg" : "org"}"${mode === "parser-required" ? " required" : ""}${mode === "parser-prefilled" ? ' value="Existing company"' : ""}></label>
    ${mode === "parser-autofill" ? '<label>Current location<input name="location"></label>' : ""}
    ${locationWidget ? '<label><div class="application-label">Current location ✱</div><div class="application-field"><input class="location-input" type="text" name="location" id="location-input" required><input type="hidden" id="selected-location" name="selectedLocation"><div class="dropdown-container" style="display:none"><div class="dropdown-results"></div></div></div></label>' : ""}
    <input type="hidden" name="accountId" value="20000000-0000-4000-8000-000000000002">
    ${hcaptcha ? `<div id="h-captcha" class="h-captcha" data-sitekey="${SITEKEY}"${mode === "captcha" ? "" : ' data-size="invisible"'}></div><script src="https://js.hcaptcha.com/1/secure-api.js?render=explicit"></script>` : ""}
    ${mode === "foreign-captcha" ? '<iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?k=fixture&size=invisible" style="display:none"></iframe>' : ""}
    <button type="button" id="btn-submit">Submit application</button></form><script>
    const form=document.getElementById('application-form'),file=document.getElementById('resume-upload-input');
    ${mode === "parser-change-events" ? "let nameEdited=false;form.elements.name.addEventListener('change',()=>{nameEdited=true;});" : ""}
    ${locationWidget ? `
      let locationEdited=false, locationTimer;
      const locationInput=form.elements.location, selectedLocation=form.elements.selectedLocation;
      const menu=document.querySelector('.dropdown-container'), results=document.querySelector('.dropdown-results');
      locationInput.addEventListener('change',()=>{locationEdited=true;});
      locationInput.addEventListener('input',()=>{menu.style.display='block';});
      locationInput.addEventListener('keydown',()=>{clearTimeout(locationTimer);locationTimer=setTimeout(async()=>{
        const response=await fetch('/searchLocations?text='+encodeURIComponent(locationInput.value)${mode === "location-query-leak" ? "+'&extra=private'" : ""});
        if(!response.ok)return;
        const locations=await response.json();results.replaceChildren();
        locations.forEach((location,index)=>{const option=document.createElement('div');option.id='location-'+index;option.className='dropdown-location';option.textContent=location.name;
          option.addEventListener('mousedown',()=>{menu.style.display='none';locationInput.value=location.name;selectedLocation.value=JSON.stringify(location);results.replaceChildren();});results.append(option);});
      },50);});
      locationInput.addEventListener('blur',()=>{if(menu.style.display!=='none'){menu.style.display='none';locationInput.value='';selectedLocation.value='';results.replaceChildren();}});
    ` : ""}
    file.addEventListener('change',async()=>{const data=new FormData();data.append('resume',file.files[0]);data.append('accountId',form.elements.accountId.value);${mode === "upload-extra-field" ? "data.append('unauthorized','LEAK');" : ""}
      document.querySelector('.filename').textContent=${mode === "filename-changed" ? "'Other-Resume.pdf'" : "file.files[0].name"};
      const result=await fetch('/parseResume',{method:'POST',body:data});
      if(result.ok){document.querySelector('.resume-upload-success').style.display='block';${mode === "parser-autofill" ? "form.elements.org.value='Unverified employer';form.elements.location.value='Unverified city';" : ["parser-required", "parser-repopulate"].includes(mode) ? "form.elements.org.value='Unverified employer';" : mode === "parser-other-slot" ? "form.elements.otherOrg.value='Unverified employer';" : mode === "parser-change-events" ? "if(!nameEdited)form.elements.name.value='Unapproved parser name';" : ""}}
      ${locationWidget ? "if(result.ok && !locationEdited)form.elements.location.value='Unverified city';" : ""}
      ${locationWidget ? `if(result.ok)form.elements.selectedLocation.value=${mode === "parser-location-null" ? "'null'" : "JSON.stringify({name:form.elements.location.value,id:'unapproved-parser-location'})"};` : ""}
    });
    async function send(){${mode === "location-metadata-drift" ? "form.elements.selectedLocation.value=JSON.stringify({name:form.elements.location.value,id:'unapproved'});" : ""}${mode === "parser-repopulate" ? "form.elements.org.value='Unverified employer';" : ""}const data=new FormData(form);${mode === "altered-file" ? "data.set('resume',new File(['wrong bytes'],'resume.pdf',{type:'application/pdf'}));" : ""}
      const result=await fetch(form.action,{method:'POST',body:data,redirect:'manual'});
      ${mode === "duplicate" ? "fetch(form.action,{method:'POST',body:data}).catch(()=>{});" : ""}
      ${mode === "uncertain" ? "" : "if(result.ok || result.type==='opaqueredirect')location.assign('" + policy.receipt.url + "');"}
    }
    const widget=window.hcaptcha?hcaptcha.render(document.getElementById('h-captcha'),{sitekey:'${SITEKEY}',size:document.getElementById('h-captcha').dataset.size,callback:()=>send()}):null;
    document.getElementById('btn-submit').addEventListener('click',()=>{if(window.hcaptcha)hcaptcha.execute(widget);else send();});</script></body></html>`;
  const cors = { "access-control-allow-origin": "https://jobs.lever.co" };
  async function transport(route: Route) {
    const r=route.request(); observed.requests.push(`${r.method()} ${r.url()}`);
    if(r.method()==="GET" && r.url()===destination) {
      if (mode === "navigation-timeout") await new Promise(resolve => setTimeout(resolve, 750));
      return route.fulfill({status:200,contentType:"text/html",body:html}).catch(error => { if (mode !== "navigation-timeout") throw error; });
    }
    if(r.method()==="GET" && r.url()==="https://jobs.lever.co/searchLocations?text=Springfield") return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify([{name:"Springfield, IL, USA",id:"city-1"},{name:"Springfield, USA",id:"region-1"},{name:"Springfield, MO, USA",id:"city-2"}])});
    if(r.method()==="POST" && r.url()==="https://jobs.lever.co/parseResume") {observed.uploads.push(r.postDataBuffer()!);return route.fulfill({status:mode==="bad-upload"?503:200,contentType:"application/json",body:'{"resumeStorageId":"synthetic-id"}'});}
    if(r.method()==="POST" && r.url()===destination) {observed.submits+=1;observed.submissions.push(r.postDataBuffer()!);return route.fulfill({status:200,contentType:"application/json",body:'{"ok":true}'});}
    if(r.method()==="GET" && r.url()===policy.receipt.url) return route.fulfill({status:200,contentType:"text/html",body:'<h3 data-qa="msg-submit-success">Application submitted!</h3>'});
    if(hcaptcha && r.method()==="GET" && r.url()==="https://js.hcaptcha.com/1/secure-api.js?render=explicit") return route.fulfill({status:200,contentType:"text/javascript",body:hcaptchaScript(mode)});
    if(mode==="foreign-captcha" && r.method()==="GET" && r.url().startsWith("https://www.google.com/recaptcha/api2/anchor?")) return route.fulfill({status:200,contentType:"text/html",body:"<!doctype html><html><body>synthetic reCAPTCHA anchor</body></html>"});
    if(hcaptcha && r.method()==="GET" && r.url()===HCAPTCHA_FRAME) return route.fulfill({status:200,contentType:"text/html",body:"<!doctype html><html><body>synthetic hCaptcha frame</body></html>"});
    if(hcaptcha && r.method()==="GET" && r.url()==="https://imgs.hcaptcha.com/fixture-check.png") return route.fulfill({status:200,contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2mJ0AAAAASUVORK5CYII=","base64")});
    if(["browserbase-solver","browserbase-solver-delayed","browserbase-solver-pending"].includes(mode) && ["http://127.0.0.1:8080/solve/hcaptcha/create","http://127.0.0.1:8080/solve/hcaptcha/query"].includes(r.url()) && ["OPTIONS","POST"].includes(r.method())) {
      if(mode === "browserbase-solver-delayed" && r.method() === "POST" && r.url().endsWith("/query")) await new Promise(resolve => setTimeout(resolve, 800));
      return route.fulfill({status:200,contentType:"application/json",headers:{...cors,"access-control-allow-methods":"POST","access-control-allow-headers":"content-type"},body:r.url().endsWith("/query") ? mode === "browserbase-solver-pending" ? '{"pending":true}' : '{"token":"P1_synthetic-provider-pass"}' : '{"query":{"taskIdEuler":123},"solveId":"90000000-0000-4000-8000-000000000009","tabId":"0123456789abcdef0123456789abcdef"}'});
    }
    if(hcaptcha && r.method()==="POST" && r.url().startsWith("https://api.hcaptcha.com/checksiteconfig?")) return route.fulfill({status:200,contentType:"application/json",headers:cors,body:'{"pass":true}'});
    if(hcaptcha && r.method()==="POST" && r.url()===`https://api.hcaptcha.com/getcaptcha/${SITEKEY}`) {observed.captchaScores+=1;return route.fulfill({status:200,contentType:"application/json",headers:cors,body:'{"pass":true,"generated_pass_UUID":"P1_synthetic-pass"}'});}
    throw new Error("SYNTHETIC_LEVER_UNEXPECTED_REQUEST");
  }
  return {policy,observed,transport};
}
