import assert from "node:assert/strict";
import test from "node:test";

import { isCaptchaFrameUrl, isCaptchaProviderRequestUrl } from "./agents-captcha.ts";

test("only CAPTCHA providers' own endpoints are admitted for the solver", () => {
  for (const url of [
    "https://www.google.com/recaptcha/api2/anchor?k=key&size=normal",
    "https://www.recaptcha.net/recaptcha/enterprise/userverify?k=key",
    "https://www.gstatic.com/recaptcha/releases/abc/recaptcha__en.js",
    "https://api.hcaptcha.com/checkcaptcha/sitekey/key",
    "https://imgs3.hcaptcha.com/tip/abc.png",
    "https://challenges.cloudflare.com/turnstile/v0/api.js",
  ]) assert.equal(isCaptchaProviderRequestUrl(url), true, url);
  for (const url of [
    "https://www.google.com/search?q=recaptcha",
    "https://jobs.lever.co/acme/apply",
    "https://hcaptcha.com.evil.example/checkcaptcha",
    "https://evilhcaptcha.com/x",
    "http://api.hcaptcha.com/checkcaptcha",
    "https://user:pass@api.hcaptcha.com/x",
    "not a url",
  ]) assert.equal(isCaptchaProviderRequestUrl(url), false, url);
});

test("provider frames are recognized; employer frames are not", () => {
  assert.equal(isCaptchaFrameUrl("https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox"), true);
  assert.equal(isCaptchaFrameUrl("https://www.google.com/recaptcha/api2/bframe?k=key"), true);
  assert.equal(isCaptchaFrameUrl("https://jobs.ashbyhq.com/acme/1/application"), false);
});
