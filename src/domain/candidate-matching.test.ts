import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { matchingProfileHash, rankCandidateJobs, type MatchingCatalogJob, type MatchingProfile } from "./candidate-matching.ts";

const id = (n:number) => `10000000-0000-4000-8000-${n.toString().padStart(12,"0")}`;
const hash = (text:string) => createHash("sha256").update(text).digest("hex");
function profile(target:string, text:string, extra: Partial<MatchingProfile> = {}): MatchingProfile {
  return {candidateId:id(1),candidateInputEpoch:1,searchVersion:1,targetRoles:[target],preferredLocations:["Washington, DC"],desiredCountryCodes:["US"],workModes:["REMOTE","ONSITE","HYBRID"],employmentTypes:["FULL_TIME"],
    reviewedResume:{versionId:id(2),hash:hash("reviewed resume")},evidence:[{versionId:id(3),hash:hash(text),text,category:"EXPERIENCE"}],workAuthorizations:[],...extra};
}
function job(title:string, description:string, n=10, extra: Partial<MatchingCatalogJob> = {}): MatchingCatalogJob {
  return {jobId:id(n),jobVersionId:id(n+100),canonicalUrl:`https://jobs.example.com/${n}`,employerName:"Example",title,description,
    location:"Washington, DC, United States",workMode:"ONSITE",employmentType:"FULL_TIME",applyUrl:`https://job-boards.greenhouse.io/example/jobs/${n}`,publishedAt:null,
    observedAt:"2026-09-16T01:00:00Z",sourceProvider:"GREENHOUSE",saved:false,queuedApplicationId:null,fit:null,contentHash:hash(title+description),versionNumber:1,...extra};
}
const fde = profile("Forward Deployed Engineer","Forward Deployed Engineer\nBuilt Python APIs and LLM integrations. Led technical discovery, prototyping, and demonstrations on AWS.");
const teacher = profile("Elementary Teacher","Elementary Teacher\nCertified teacher with a teaching license. Delivered lesson planning, curriculum, classroom management, and student assessment.");
const nurse = profile("Registered Nurse","Registered Nurse\nActive nursing license. Delivered patient assessment, care planning, medication administration, and clinical documentation.");
const finance = profile("Financial Analyst","Financial Analyst\nPrepared financial modeling, forecasting, budgeting, variance analysis, and Excel reports.");
const fixtures = [
  {profile:fde,job:job("Forward Deployed Engineer","Build Python APIs and LLM integrations with AWS. Own technical discovery and demonstrations.")},
  {profile:teacher,job:job("Elementary Teacher","Teaching license required. Own lesson planning, curriculum, student assessment, and classroom management.")},
  {profile:nurse,job:job("Registered Nurse","Active nursing license required. Perform patient assessment, care planning, and clinical documentation.")},
  {profile:finance,job:job("Financial Analyst","Own financial modeling, forecasting, budgeting and variance analysis in Excel.")},
];
for (const fixture of fixtures) test(`recommends supported ${fixture.job.title} and rejects unrelated professions`,()=>{
  const ranked=rankCandidateJobs(fixture.profile, fixtures.map((entry,index)=>({...entry.job,jobId:id(index+10)})));
  assert.equal(ranked.length,1);
  assert.equal(ranked[0].title,fixture.job.title);
  assert.equal(ranked[0].matching.band,"STRONG");
  assert.equal(ranked[0].matching.autoApplyEligible,true);
  assert.ok(ranked[0].matching.evidenceRefs.includes(id(3)));
  assert.ok(ranked[0].matching.reasons.some((reason)=>reason.includes("reviewed experience")));
});
test("finds relevant jobs after unrelated first pages, orders deterministically and removes duplicates",()=>{
  const unrelated=Array.from({length:120},(_,index)=>job("Cashier","Retail customer service",index+1000));
  const relevant=fixtures[0].job;
  const ranked=rankCandidateJobs(fde,[...unrelated,relevant,relevant]);
  assert.equal(ranked.length,1);
  assert.equal(ranked[0].jobId,relevant.jobId);
  assert.deepEqual(ranked,rankCandidateJobs(fde,[relevant,...unrelated,relevant]));
});
test("shared generic words and employer industry do not create profession relevance",()=>{
  const evidence=profile("Software Engineer","Software Engineer\nBuilt software for nurses, teachers and financial analysts using Python and SQL.");
  assert.equal(rankCandidateJobs(evidence,[job("Registered Nurse","Work at a software company with Python and SQL teams.")]).length,0);
  assert.equal(rankCandidateJobs(evidence,[job("Kitchen Manager","Engineering collaboration and customer implementation.")]).length,0);
});
test("explicit saved target change takes priority over previous profession",()=>{
  const pivot={...teacher,targetRoles:["Financial Analyst"]};
  assert.equal(rankCandidateJobs(pivot,[fixtures[1].job]).length,0);
  const newRole=rankCandidateJobs(pivot,[fixtures[3].job])[0];
  assert.equal(newRole.matching.autoApplyEligible,false);
  assert.equal(newRole.matching.band,"POSSIBLE");
});
test("evidence can suggest a missing target but cannot enable automatic application",()=>{
  const ranked=rankCandidateJobs({...teacher,targetRoles:[]},[fixtures[1].job]);
  assert.equal(ranked.length,1);
  assert.equal(ranked[0].matching.autoApplyEligible,false);
  assert.ok(ranked[0].matching.reviewReasons.some((reason)=>reason.includes("Choose target roles")));
});
test("missing and unreviewed experience does not produce a strong autonomous match",()=>{
  const ranked=rankCandidateJobs({...fde,evidence:[],reviewedResume:null},[fixtures[0].job]);
  assert.equal(ranked[0].matching.autoApplyEligible,false);
  assert.equal(rankCandidateJobs({...fde,targetRoles:[],evidence:[]},[fixtures[0].job]).length,0);
});
test("known work mode, employment, location and country conflicts are excluded",()=>{
  for (const overrides of [
    {workModes:["REMOTE"]}, {employmentTypes:["PART_TIME"]}, {preferredLocations:["Seattle, WA"]}, {desiredCountryCodes:["CA"]},
  ]) assert.equal(rankCandidateJobs({...fde,...overrides},[fixtures[0].job]).length,0);
  assert.equal(rankCandidateJobs(fde,[{...fixtures[0].job,location:"Berlin, Germany"}]).length,0);
  assert.equal(rankCandidateJobs({...fde,preferredLocations:["York"]},[{...fixtures[0].job,location:"Yorkshire, PA, United States"}]).length,0);
});
test("country-specific remote postings honor country preferences",()=>{
  assert.equal(rankCandidateJobs(fde,[{...fixtures[0].job,location:"Remote, Canada",workMode:"REMOTE"}]).length,0);
  assert.equal(rankCandidateJobs(fde,[{...fixtures[0].job,location:"Remote, United States",workMode:"REMOTE"}])[0].matching.autoApplyEligible,true);
  assert.equal(rankCandidateJobs(fde,[{...fixtures[0].job,location:"Remote, Texas, United States",workMode:"REMOTE"}]).length,0);
});
test("legacy comma-split Washington and DC are one location, not Washington state",()=>{
  const split={...fde,preferredLocations:["Washington","DC","Remote"]};
  assert.equal(rankCandidateJobs(split,[fixtures[0].job]).length,1);
  assert.equal(rankCandidateJobs(split,[{...fixtures[0].job,location:"Seattle, Washington, United States"}]).length,0);
});
test("missing routine eligibility is not invented and can be resolved during a named application",()=>{
  const ranked=rankCandidateJobs(fde,[fixtures[0].job]);
  assert.equal(ranked[0].matching.autoApplyEligible,true);
  assert.ok(!JSON.stringify(ranked).includes("citizen"));
});
test("explicit sponsorship conflict excludes a role while unknown sponsorship does not become a false rejection",()=>{
  const sponsorship={...fde,workAuthorizations:[{countryCode:"US",authorized:true,sponsorshipRequired:true,versionIds:[id(4)]}]};
  assert.equal(rankCandidateJobs(sponsorship,[{...fixtures[0].job,description:fixtures[0].job.description+" No visa sponsorship is available."}]).length,0);
  assert.equal(rankCandidateJobs(sponsorship,[fixtures[0].job]).length,1);
  const multiple={...sponsorship,desiredCountryCodes:["US","CA"],workAuthorizations:[...sponsorship.workAuthorizations,{countryCode:"CA",authorized:true,sponsorshipRequired:false,versionIds:[id(5)]}]};
  assert.equal(rankCandidateJobs(multiple,[{...fixtures[0].job,workMode:"REMOTE",location:"Remote, United States | Remote, Canada",description:fixtures[0].job.description+" No visa sponsorship is available."}]).length,1);
});
test("clearance and unsupported mandatory credentials require exact review",()=>{
  const cleared={...fixtures[0].job,description:fixtures[0].job.description+" Must hold an active security clearance."};
  assert.equal(rankCandidateJobs(fde,[cleared])[0].matching.autoApplyEligible,false);
  const unlicensed=profile("Registered Nurse","Registered Nurse\nPatient assessment, care planning and clinical documentation.");
  assert.equal(rankCandidateJobs(unlicensed,[fixtures[2].job])[0].matching.autoApplyEligible,false);
  const expired=profile("Registered Nurse","Registered Nurse\nNursing license expired. Patient assessment, care planning and clinical documentation.");
  assert.equal(rankCandidateJobs(expired,[fixtures[2].job])[0].matching.autoApplyEligible,false);
  const aspiring=profile("Financial Analyst","Financial Analyst\nPursuing CPA certification. Financial modeling, forecasting, budgeting, Excel and variance analysis.");
  assert.equal(rankCandidateJobs(aspiring,[{...fixtures[3].job,description:fixtures[3].job.description+" CPA required."}])[0].matching.autoApplyEligible,false);
});
test("registered nursing does not imply advanced practice or nursing assistant qualifications",()=>{
  assert.equal(rankCandidateJobs(nurse,[job("Nurse Practitioner","Patient assessment and care planning.")]).length,0);
  assert.equal(rankCandidateJobs(nurse,[job("Certified Nursing Assistant","Patient assessment and clinical documentation.")]).length,0);
});
test("seniority and assistant roles are reviewed instead of automatically selected",()=>{
  assert.equal(rankCandidateJobs(fde,[{...fixtures[0].job,title:"Director of Forward Deployed Engineering"}])[0].matching.autoApplyEligible,false);
  assert.equal(rankCandidateJobs(teacher,[{...fixtures[1].job,title:"Assistant Elementary Teacher"}])[0].matching.autoApplyEligible,false);
});
test("already queued applications are never recommended again",()=>{
  assert.equal(rankCandidateJobs(fde,[{...fixtures[0].job,queuedApplicationId:id(999)}]).length,0);
});
test("transferable product-building work supports an AI product pivot without an invented title",()=>{
  const builder=profile("AI Product Manager","Founder\nMapped a staffing workflow into a product roadmap. Built and shipped a JavaScript application backed by Supabase/PostgreSQL.");
  const product=job("Technical Product Manager, AI Platform","Own a product roadmap and build applications for AI customers. SQL and JavaScript are useful.");
  const ranked=rankCandidateJobs(builder,[product]);
  assert.equal(ranked[0].matching.band,"STRONG");
  assert.equal(ranked[0].matching.autoApplyEligible,true);
  assert.ok(ranked[0].matching.reasons.some(reason=>reason.includes("product development")));
  assert.equal(rankCandidateJobs(builder,[{...product,title:"Clinical Product Specialist, AI Development"}]).length,0);
});
test("automatic selection filters unsupported and review jobs before the limit",()=>{
  const unsupported=Array.from({length:110},(_,index)=>({...fixtures[0].job,jobId:id(index+1000),applyUrl:`https://careers.example.test/jobs/${id(index+1000)}`}));
  const supported={...fixtures[0].job,jobId:id(9999)};
  const visible=rankCandidateJobs(fde,[...unsupported,supported],100);
  assert.ok(visible.some(row=>!row.matching.autoApplyEligible));
  const eligible=rankCandidateJobs(fde,[...unsupported,supported],100,{automaticSelection:true});
  assert.deepEqual(eligible.map(row=>row.jobId),[supported.jobId]);
});
test("profile provenance binds goals, exact eligibility, reviewed evidence and input epoch",()=>{
  const initial=matchingProfileHash(fde);
  for (const updated of [
    {...fde,targetRoles:["Teacher"]}, {...fde,candidateInputEpoch:2}, {...fde,evidence:[]},
    {...fde,workAuthorizations:[{countryCode:"US",authorized:false,sponsorshipRequired:true,versionIds:[id(4)]}]},
  ]) assert.notEqual(matchingProfileHash(updated),initial);
  assert.equal(matchingProfileHash({...fde,workModes:[...fde.workModes].reverse()}),initial);
});
test("boards that omit employment type or work mode stay matchable; explicit mismatches still filter",()=>{
  for (const employmentType of ["UNSPECIFIED","OTHER","UNKNOWN",""]) {
    const ranked=rankCandidateJobs(fde,[{...fixtures[0].job,employmentType}]);
    assert.equal(ranked.length,1,`employment type ${employmentType || "<empty>"} must not exclude the job`);
    assert.equal(ranked[0].matching.band,"STRONG");
  }
  assert.equal(rankCandidateJobs(fde,[{...fixtures[0].job,employmentType:"CONTRACT"}]).length,0);
  assert.equal(rankCandidateJobs({...fde,workModes:["REMOTE"]},[{...fixtures[0].job,workMode:"ONSITE"}]).length,0);
});
test("non-US postings are excluded for a US-only search; mixed and US-coded postings stay",()=>{
  const us={...fde,desiredCountryCodes:["US"],workModes:["REMOTE","ONSITE","HYBRID"],preferredLocations:[]};
  const posting=(location:string,n:number)=>({...fixtures[0].job,jobId:id(n),location,workMode:"REMOTE"});
  const ranked=rankCandidateJobs(us,[
    posting("Argentina (Remote)",501),
    posting("Canada (Remote) · Toronto, Ontario, Canada · United States (Remote)",502),
    posting("Remote - US",503),
    posting("Austin, TX",504),
    posting("London, UK",505),
    posting("Hyderabad, India",506),
  ]);
  const kept=new Set(ranked.map((job)=>job.jobId));
  assert.equal(kept.has(id(501)),false,"Argentina excluded");
  assert.equal(kept.has(id(505)),false,"London excluded");
  assert.equal(kept.has(id(506)),false,"India excluded");
  assert.equal(kept.has(id(502)),true,"mixed Canada/US kept");
  assert.equal(kept.has(id(503)),true,"Remote - US kept");
  assert.equal(kept.has(id(504)),true,"Austin, TX kept");
});
