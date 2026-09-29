"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import ui from "@/components/app/ui.module.css";
import {
  EMPLOYMENT_TYPE_OPTIONS,
  EMPTY_SEARCH_PROFILE_ACTION_STATE,
  WORK_MODE_OPTIONS,
  type CandidateSearchProfileFormAction,
  type CandidateSearchProfileViewModel,
} from "@/domain/candidate-onboarding";

import styles from "./SearchGoals.module.css";

export function SearchGoals({
  action,
  commandId,
  profile,
  mode = "onboarding",
  continueHref,
}: Readonly<{
  action: CandidateSearchProfileFormAction;
  commandId: string;
  profile: CandidateSearchProfileViewModel;
  mode?: "onboarding" | "settings";
  /** Shown once preferences are saved. */
  continueHref?: string;
}>) {
  const router = useRouter();
  const [currentCommandId, setCurrentCommandId] = useState(commandId);
  const [state, formAction, pending] = useActionState(async (previous: typeof EMPTY_SEARCH_PROFILE_ACTION_STATE, data: FormData) => {
    const result = await action(previous, data);
    if (result.outcome === "success") {
      setCurrentCommandId(crypto.randomUUID());
      router.refresh();
    }
    return result;
  }, EMPTY_SEARCH_PROFILE_ACTION_STATE);
  const nextHref = continueHref ?? (mode === "onboarding" ? "/onboarding?step=answers" : null);

  return (
    <form action={formAction} className={styles.form}>
      <input name="commandId" type="hidden" value={currentCommandId} />
      <input name="expectedAggregateVersion" type="hidden" value={profile.aggregateVersion ?? ""} />

      <label className={ui.field} htmlFor="target-roles">
        <span>Roles you want</span>
        <textarea
          className={ui.textarea}
          defaultValue={profile.targetRoles.join("\n")}
          disabled={pending}
          id="target-roles"
          name="targetRoles"
          placeholder={"Solutions Engineer\nCustomer Success Manager"}
          required
          rows={4}
        />
        <small className={ui.hint}>Up to eight, one per line. Include the titles you&apos;d actually search for.</small>
      </label>

      <label className={ui.field} htmlFor="preferred-locations">
        <span>Places you&apos;d work <em className={styles.optional}>optional</em></span>
        <textarea
          className={ui.textarea}
          defaultValue={profile.preferredLocations.join("\n")}
          disabled={pending}
          id="preferred-locations"
          name="preferredLocations"
          placeholder={"Washington, DC\nNew York, NY"}
          rows={3}
        />
        <small className={ui.hint}>One per line. Leave empty to consider anywhere in your countries.</small>
      </label>

      <fieldset className={styles.fieldset}>
        <legend>Countries</legend>
        <div className={styles.pills}>
          {[["US", "United States"], ["CA", "Canada"]].map(([value, label]) => (
            <label key={value}>
              <input defaultChecked={profile.desiredCountryCodes.includes(value as "US" | "CA")} disabled={pending} name="desiredCountryCodes" type="checkbox" value={value} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Work style</legend>
        <div className={styles.pills}>
          {WORK_MODE_OPTIONS.map((option) => (
            <label key={option.value}>
              <input defaultChecked={profile.workModes.includes(option.value)} disabled={pending} name="workModes" type="checkbox" value={option.value} />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Job type</legend>
        <div className={styles.pills}>
          {EMPLOYMENT_TYPE_OPTIONS.map((option) => (
            <label key={option.value}>
              <input defaultChecked={profile.employmentTypes.includes(option.value)} disabled={pending} name="employmentTypes" type="checkbox" value={option.value} />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {state.message ? (
        <p className={state.outcome === "error" ? ui.noticeError : ui.noticeSuccess} role={state.outcome === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      ) : null}

      <div className={styles.actions}>
        <button className={nextHref && profile.aggregateVersion ? ui.secondary : ui.primary} disabled={pending} type="submit">
          {pending ? "Saving…" : profile.aggregateVersion ? "Save changes" : "Save"}
        </button>
        {nextHref && (state.outcome === "success" || profile.aggregateVersion) ? <Link className={ui.cta} href={nextHref}>Continue</Link> : null}
      </div>
    </form>
  );
}
