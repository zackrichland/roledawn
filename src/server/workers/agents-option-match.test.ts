import assert from "node:assert/strict";
import test from "node:test";

import { chooseSearchResult, normalizeOptionText, optionAliases, resolveOptionValue } from "./agents-option-match.ts";

const COUNTRY = { semantic: "COUNTRY" } as const;
const REGION = { semantic: "REGION" } as const;
const options = (...labels: string[]) => labels.map((label, index) => ({ value: `v${index}`, label }));

test("normalization ignores case, diacritics, abbreviation periods and separators but keeps meaning-bearing symbols", () => {
  assert.equal(normalizeOptionText("  U.S.A. "), "usa");
  assert.equal(normalizeOptionText("Washington, D.C."), "washington dc");
  assert.equal(normalizeOptionText("Côte d’Ivoire"), "cote divoire");
  assert.equal(normalizeOptionText("Québec"), "quebec");
  assert.equal(normalizeOptionText("Bosnia & Herzegovina"), "bosnia and herzegovina");
  assert.equal(normalizeOptionText("1.5 years"), "1.5 years");
  assert.notEqual(normalizeOptionText("C++"), normalizeOptionText("C"));
});

test("country facts resolve every common spelling of the approved ISO code, and nothing else", () => {
  for (const label of ["United States", "United States of America", "USA", "U.S.", "US", "united states", "The United States", "United States (+1)", "United States +1", "United States of America (USA)"]) {
    assert.equal(resolveOptionValue(options("Afghanistan", label, "Canada", "United States Minor Outlying Islands"), "US", COUNTRY), "v1", label);
  }
  assert.equal(resolveOptionValue(options("California", "Canada", "Cambodia"), "CA", COUNTRY), "v1");
  // A value of "CA" is not trusted over a label that names another entity.
  assert.throws(() => resolveOptionValue([{ value: "CA", label: "California" }], "CA", COUNTRY), /OPTION_AMBIGUOUS/u);
  // Two distinct options for the same country: no guess.
  assert.throws(() => resolveOptionValue(options("United States", "USA", "Canada"), "US", COUNTRY), /OPTION_AMBIGUOUS/u);
  // Unsupported codes and near misses never pick the "closest" entry.
  assert.throws(() => resolveOptionValue(options("United Kingdom", "Ukraine"), "UK", COUNTRY), /OPTION_AMBIGUOUS/u);
  assert.throws(() => resolveOptionValue(options("United States Minor Outlying Islands", "American Samoa"), "US", COUNTRY), /OPTION_AMBIGUOUS/u);
  assert.equal(resolveOptionValue(options("Canada (+1)", "United States (+1)"), "US", COUNTRY), "v1");
  assert.equal(resolveOptionValue(options("Canada (+1)", "United States (+1)"), "CA", COUNTRY), "v0");
});

test("region facts resolve state and province names and two-letter codes", () => {
  const states = [{ value: "st-05", label: "California" }, { value: "st-09", label: "District of Columbia" }, { value: "st-47", label: "Washington" }, { value: "pr-09", label: "Ontario" }];
  assert.equal(resolveOptionValue(states, "DC", REGION), "st-09");
  assert.equal(resolveOptionValue(states, "District of Columbia", REGION), "st-09");
  assert.equal(resolveOptionValue(states, "CA", REGION), "st-05");
  assert.equal(resolveOptionValue(states, "WA", REGION), "st-47");
  assert.equal(resolveOptionValue(states, "ON", REGION), "pr-09");
  assert.equal(resolveOptionValue([{ value: "CA", label: "CA" }, { value: "NY", label: "NY" }], "California", REGION), "CA");
  assert.equal(resolveOptionValue([{ value: "x", label: "California (CA)" }], "CA", REGION), "x");
  assert.throws(() => resolveOptionValue(states, "Texas", REGION), /OPTION_AMBIGUOUS/u);
  const washingtons = [{ value: "x", label: "Washington, D.C." }, { value: "y", label: "Washington" }];
  assert.equal(resolveOptionValue(washingtons, "Washington DC", REGION), "x");
  assert.equal(resolveOptionValue(washingtons, "DC", REGION), "x");
  assert.equal(resolveOptionValue(washingtons, "WA", REGION), "y");
});

test("without a location semantic only exact values and exact normalized labels count", () => {
  const schools = [{ value: "school-041", label: "Synthetic University 041" }, { value: "school-042", label: "Synthetic University 042" }, { value: "", label: "Select..." }];
  assert.equal(resolveOptionValue(schools, "school-042"), "school-042");
  assert.equal(resolveOptionValue(schools, "synthetic university 042"), "school-042");
  assert.throws(() => resolveOptionValue(schools, "Synthetic University"), /OPTION_AMBIGUOUS/u);
  assert.throws(() => resolveOptionValue(schools, "Select"), /OPTION_AMBIGUOUS/u);
  assert.throws(() => resolveOptionValue(options("Yes", "Yes"), "Yes"), /OPTION_AMBIGUOUS/u);
  assert.equal(resolveOptionValue(options("Yes.", "No."), "Yes"), "v0");
  assert.throws(() => resolveOptionValue(options("Yes, with sponsorship", "No"), "Yes"), /OPTION_AMBIGUOUS/u);
  assert.throws(() => resolveOptionValue(options("C", "Java"), "C++"), /OPTION_AMBIGUOUS/u);
});

test("search results qualify only when they start with the approved value and the rest is the candidate's own region and country", () => {
  const results = ["Washington, District of Columbia, United States", "Washington, Pennsylvania, United States", "Washington Heights, New York, United States"];
  const dc = { semantic: "CITY", source: "FACT", hints: { region: "DC", country: "US" } } as const;
  assert.equal(chooseSearchResult(results, "Washington", dc), results[0]);
  assert.equal(chooseSearchResult(results, "Washington", { ...dc, hints: { region: "PA", country: "US" } }), results[1]);
  // Candidate lives in Washington State: none of these is right.
  assert.equal(chooseSearchResult(results, "Washington", { ...dc, hints: { region: "WA", country: "US" } }), null);
  // Without approved region/country facts only an exact result is acceptable.
  assert.equal(chooseSearchResult(results, "Washington", { semantic: "CITY", source: "FACT" }), null);
  assert.equal(chooseSearchResult(["Toronto"], "Toronto", { semantic: "CITY", source: "FACT" }), "Toronto");
  assert.equal(chooseSearchResult(["Toronto, ON, Canada", "Toronto, OH, USA"], "Toronto", { semantic: "CITY", source: "FACT", hints: { region: "ON", country: "CA" } }), "Toronto, ON, Canada");
  // Duplicates and no results leave the field.
  assert.equal(chooseSearchResult([results[0], results[0]], "Washington", dc), null);
  assert.equal(chooseSearchResult([], "Washington", dc), null);
  // A candidate-typed answer may choose a unique longer result that starts with it.
  assert.equal(chooseSearchResult(results, "Washington, Pennsylvania", { source: "ANSWER" }), results[1]);
  assert.equal(chooseSearchResult(results, "Washington", { source: "ANSWER" }), null);
  assert.equal(chooseSearchResult(results, "Washingt", { source: "ANSWER" }), null);
});

test("alias groups are fixed and scoped to their semantic", () => {
  assert.ok(optionAliases("US", "COUNTRY").has("united states of america"));
  assert.ok(optionAliases("CA", "COUNTRY").has("canada"));
  assert.ok(optionAliases("CA", "REGION").has("california"));
  assert.equal(optionAliases("CA", "REGION").has("canada"), false);
  assert.deepEqual([...optionAliases("Springfield", "CITY")], ["springfield"]);
  assert.deepEqual([...optionAliases("GB", "COUNTRY")], ["gb"]);
  assert.ok(optionAliases("Man", "SELF_ID").has("male"));
  assert.deepEqual([...optionAliases("Man", null)], ["man"]);
  assert.deepEqual([...optionAliases("Asian", "SELF_ID")], ["asian"]);
});

const SELF_ID = { semantic: "SELF_ID", source: "FACT" } as const;
const DECLINE = "Decline to self-identify";

test("a saved decline selects the form's own decline wording", () => {
  const variants = ["Decline to self-identify", "Decline To Self Identify", "Decline to self identify", "I don't wish to answer", "I don’t wish to answer",
    "I do not wish to answer", "I prefer not to answer", "Prefer not to say", "I do not want to answer", "I choose not to disclose",
    "I don't wish to disclose", "I don't wish to answer.", "Decline to state", "I prefer not to self-identify"];
  for (const variant of variants) {
    assert.equal(resolveOptionValue(options("Male", "Female", variant), DECLINE, SELF_ID), "v2", variant);
    assert.equal(resolveOptionValue(options("I am not a protected veteran", "I identify as one or more of the classifications of protected veteran", variant), DECLINE, SELF_ID), "v2", variant);
  }
  // No decline option, two decline options, or a decline wording only in a hidden value: the candidate decides.
  assert.throws(() => resolveOptionValue(options("Male", "Female"), DECLINE, SELF_ID), /OPTION_AMBIGUOUS/u);
  assert.throws(() => resolveOptionValue(options("Male", "Decline to self-identify", "I don't wish to answer"), DECLINE, SELF_ID), /OPTION_AMBIGUOUS/u);
  assert.throws(() => resolveOptionValue([{ value: DECLINE, label: "Female" }, { value: "m", label: "Male" }], DECLINE, SELF_ID), /OPTION_AMBIGUOUS/u);
  // Without the self-identification semantic only the exact wording counts.
  assert.equal(resolveOptionValue(options("Male", "Decline to self-identify"), DECLINE), "v1");
  assert.throws(() => resolveOptionValue(options("Male", "I don't wish to answer"), DECLINE), /OPTION_AMBIGUOUS/u);
});

test("saved self-identification choices map only to wording with the same meaning", () => {
  assert.equal(resolveOptionValue(options("Male", "Female", "Decline To Self Identify"), "Woman", SELF_ID), "v1");
  assert.equal(resolveOptionValue(options("Male", "Female", "Decline To Self Identify"), "Man", SELF_ID), "v0");
  assert.equal(resolveOptionValue(options("Man", "Woman", "Nonbinary"), "Non-binary", SELF_ID), "v2");
  assert.throws(() => resolveOptionValue(options("Male", "Female", "Decline To Self Identify"), "Non-binary", SELF_ID), /OPTION_AMBIGUOUS/u);
  // Options for the man/woman question are never inferred without the semantic.
  assert.throws(() => resolveOptionValue(options("Male", "Female"), "Woman"), /OPTION_AMBIGUOUS/u);
  // Hispanic or Latino: exact yes/no only.
  assert.equal(resolveOptionValue(options("Yes", "No", "Decline To Self Identify"), "No", SELF_ID), "v1");
  // Race: spelling variants of one category; a combined "(Not Hispanic or Latino)" category is a different claim.
  assert.equal(resolveOptionValue(options("Asian", "American Indian or Alaskan Native", "Two or More Races"), "American Indian or Alaska Native", SELF_ID), "v1");
  assert.equal(resolveOptionValue(options("Asian", "White", "Two or More Races"), "Two or more races", SELF_ID), "v2");
  assert.equal(resolveOptionValue(options("White", "Native Hawaiian/Other Pacific Islander"), "Native Hawaiian or Other Pacific Islander", SELF_ID), "v1");
  assert.throws(() => resolveOptionValue(options("Hispanic or Latino", "White (Not Hispanic or Latino)", "Asian (Not Hispanic or Latino)"), "White", SELF_ID), /OPTION_AMBIGUOUS/u);
  // Veteran status: "not a protected veteran" is not "not a veteran".
  const greenhouseVeteran = options("I am not a protected veteran", "I identify as one or more of the classifications of protected veteran", "I don't wish to answer");
  assert.equal(resolveOptionValue(greenhouseVeteran, "I am not a protected veteran", SELF_ID), "v0");
  assert.equal(resolveOptionValue(greenhouseVeteran, "I identify as a protected veteran", SELF_ID), "v1");
  const plainVeteran = options("I am a veteran", "I am not a veteran", "Decline to self-identify");
  assert.throws(() => resolveOptionValue(plainVeteran, "I am not a protected veteran", SELF_ID), /OPTION_AMBIGUOUS/u);
  assert.throws(() => resolveOptionValue(plainVeteran, "I identify as a protected veteran", SELF_ID), /OPTION_AMBIGUOUS/u);
  assert.equal(resolveOptionValue(plainVeteran, DECLINE, SELF_ID), "v2");
  // Disability (Form CC-305): the saved "No" says nothing about the past, so the
  // current "...and have not had one in the past" wording stays with the candidate.
  const cc305 = options("Yes, I have a disability, or have had one in the past", "No, I do not have a disability and have not had one in the past", "I do not want to answer");
  assert.equal(resolveOptionValue(cc305, "Yes, I have a disability (or previously had one)", SELF_ID), "v0");
  assert.throws(() => resolveOptionValue(cc305, "No, I do not have a disability", SELF_ID), /OPTION_AMBIGUOUS/u);
  assert.equal(resolveOptionValue(cc305, DECLINE, SELF_ID), "v2");
  assert.equal(resolveOptionValue(options("Yes, I have a disability (or previously had a disability)", "No, I don't have a disability", "I don't wish to answer"), "No, I do not have a disability", SELF_ID), "v1");
});

// Option lists copied from live Greenhouse and Lever forms in the 2026-09-28
// read-only audit. Each added wording states the same claim as its group.
test("observed self-identification wordings resolve to the saved choice with the same meaning", () => {
  const greenhouseVeteran = options("I am not a protected veteran", "I identify as one or more of the classifications of a protected veteran", "I don't wish to answer");
  assert.equal(resolveOptionValue(greenhouseVeteran, "I identify as a protected veteran", SELF_ID), "v1");
  assert.equal(resolveOptionValue(greenhouseVeteran, "I am not a protected veteran", SELF_ID), "v0");
  assert.equal(resolveOptionValue(greenhouseVeteran, DECLINE, SELF_ID), "v2");
  const customVeteran = options("I am one or more of the classifications of protected veterans", "I am not a protected veteran", "I don't wish to answer");
  assert.equal(resolveOptionValue(customVeteran, "I identify as a protected veteran", SELF_ID), "v0");
  const leverVeteran = options("I identify as one or more of the classifications of protected veteran listed above", "I am not a protected veteran",
    "I decline to self-identify for protected veteran status");
  assert.equal(resolveOptionValue(leverVeteran, DECLINE, SELF_ID), "v2");
  const disability = options("Yes, I have (or have previously had) a disability", "No, I don’t have a disability", "I don't wish to answer");
  assert.equal(resolveOptionValue(disability, "Yes, I have a disability (or previously had one)", SELF_ID), "v0");
  assert.equal(resolveOptionValue(disability, "No, I do not have a disability", SELF_ID), "v1");
  assert.equal(resolveOptionValue(disability, DECLINE, SELF_ID), "v2");
  // Still a different claim: "a veteran" is not "a protected veteran", in either direction.
  const plainVeteran = options("I am a veteran", "I am not a veteran", "Decline to self-identify");
  assert.throws(() => resolveOptionValue(plainVeteran, "I identify as a protected veteran", SELF_ID), /OPTION_AMBIGUOUS/u);
  assert.throws(() => resolveOptionValue(plainVeteran, "I am not a protected veteran", SELF_ID), /OPTION_AMBIGUOUS/u);
  // Without the self-identification semantic nothing widens.
  assert.throws(() => resolveOptionValue(leverVeteran, DECLINE), /OPTION_AMBIGUOUS/u);
});
