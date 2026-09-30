export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      application_agent_answers: {
        Row: {
          answered_by: string
          approved_for_fill: boolean
          command_id: string
          created_at: string
          id: string
          question_id: string
          value_json: Json
        }
        Insert: {
          answered_by: string
          approved_for_fill?: boolean
          command_id: string
          created_at?: string
          id?: string
          question_id: string
          value_json: Json
        }
        Update: {
          answered_by?: string
          approved_for_fill?: boolean
          command_id?: string
          created_at?: string
          id?: string
          question_id?: string
          value_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "application_agent_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: true
            referencedRelation: "application_agent_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      application_agent_questions: {
        Row: {
          application_id: string
          candidate_id: string
          computer_session_id: string
          control_type: string
          created_at: string
          field_fingerprint: string
          field_id: string
          fill_attempt_id: string
          id: string
          label: string
          options: Json
          reason_code: string
          required: boolean
          revision_id: string
          status: string
          workspace_id: string
        }
        Insert: {
          application_id: string
          candidate_id: string
          computer_session_id: string
          control_type: string
          created_at?: string
          field_fingerprint: string
          field_id: string
          fill_attempt_id: string
          id?: string
          label: string
          options?: Json
          reason_code: string
          required: boolean
          revision_id: string
          status?: string
          workspace_id: string
        }
        Update: {
          application_id?: string
          candidate_id?: string
          computer_session_id?: string
          control_type?: string
          created_at?: string
          field_fingerprint?: string
          field_id?: string
          fill_attempt_id?: string
          id?: string
          label?: string
          options?: Json
          reason_code?: string
          required?: boolean
          revision_id?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_agent_questions_computer_session_id_fill_attem_fkey"
            columns: ["computer_session_id", "fill_attempt_id"]
            isOneToOne: false
            referencedRelation: "computer_sessions"
            referencedColumns: ["id", "fill_attempt_id"]
          },
          {
            foreignKeyName: "application_agent_questions_workspace_id_application_id_re_fkey"
            columns: [
              "workspace_id",
              "application_id",
              "revision_id",
              "fill_attempt_id",
            ]
            isOneToOne: false
            referencedRelation: "application_fill_attempts"
            referencedColumns: [
              "workspace_id",
              "application_id",
              "revision_id",
              "id",
            ]
          },
          {
            foreignKeyName: "application_agent_questions_workspace_id_candidate_id_appl_fkey"
            columns: [
              "workspace_id",
              "candidate_id",
              "application_id",
              "fill_attempt_id",
            ]
            isOneToOne: false
            referencedRelation: "application_fill_attempts"
            referencedColumns: [
              "workspace_id",
              "candidate_id",
              "application_id",
              "id",
            ]
          },
          {
            foreignKeyName: "application_agent_questions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      application_agent_runs: {
        Row: {
          application_id: string
          candidate_id: string
          completed_at: string | null
          computer_session_id: string
          created_at: string
          driver_release: string
          failure_code: string | null
          fill_attempt_id: string
          id: string
          model: string
          provider_cleanup_next_attempt_at: string
          provider_deleted_at: string | null
          provider_session_id: string | null
          revision_id: string
          status: string
          workspace_id: string
        }
        Insert: {
          application_id: string
          candidate_id: string
          completed_at?: string | null
          computer_session_id: string
          created_at?: string
          driver_release: string
          failure_code?: string | null
          fill_attempt_id: string
          id?: string
          model: string
          provider_cleanup_next_attempt_at?: string
          provider_deleted_at?: string | null
          provider_session_id?: string | null
          revision_id: string
          status?: string
          workspace_id: string
        }
        Update: {
          application_id?: string
          candidate_id?: string
          completed_at?: string | null
          computer_session_id?: string
          created_at?: string
          driver_release?: string
          failure_code?: string | null
          fill_attempt_id?: string
          id?: string
          model?: string
          provider_cleanup_next_attempt_at?: string
          provider_deleted_at?: string | null
          provider_session_id?: string | null
          revision_id?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_agent_runs_workspace_id_application_id_revisio_fkey"
            columns: [
              "workspace_id",
              "application_id",
              "revision_id",
              "fill_attempt_id",
            ]
            isOneToOne: false
            referencedRelation: "application_fill_attempts"
            referencedColumns: [
              "workspace_id",
              "application_id",
              "revision_id",
              "id",
            ]
          },
          {
            foreignKeyName: "application_agent_runs_workspace_id_candidate_id_applicati_fkey"
            columns: [
              "workspace_id",
              "candidate_id",
              "application_id",
              "fill_attempt_id",
            ]
            isOneToOne: false
            referencedRelation: "application_fill_attempts"
            referencedColumns: [
              "workspace_id",
              "candidate_id",
              "application_id",
              "id",
            ]
          },
          {
            foreignKeyName: "application_agent_runs_workspace_id_computer_session_id_fkey"
            columns: ["workspace_id", "computer_session_id"]
            isOneToOne: false
            referencedRelation: "computer_sessions"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "application_agent_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      application_agent_tool_calls: {
        Row: {
          arguments_hash: string
          call_id: string
          completed_at: string | null
          created_at: string
          result: Json | null
          run_id: string
          status: string
          tool_name: string
          turn_id: string
        }
        Insert: {
          arguments_hash: string
          call_id: string
          completed_at?: string | null
          created_at?: string
          result?: Json | null
          run_id: string
          status?: string
          tool_name: string
          turn_id: string
        }
        Update: {
          arguments_hash?: string
          call_id?: string
          completed_at?: string | null
          created_at?: string
          result?: Json | null
          run_id?: string
          status?: string
          tool_name?: string
          turn_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_agent_tool_calls_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "application_agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      application_attempts: {
        Row: {
          adapter_release: string
          application_id: string
          approval_action: string
          approval_consumption_id: string
          browser_session_ref: string | null
          completed_at: string | null
          external_reference: string | null
          id: string
          idempotency_key: string
          result_summary: Json
          revision_id: string
          started_at: string
          status: string
          workspace_id: string
        }
        Insert: {
          adapter_release: string
          application_id: string
          approval_action: string
          approval_consumption_id: string
          browser_session_ref?: string | null
          completed_at?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key: string
          result_summary?: Json
          revision_id: string
          started_at?: string
          status: string
          workspace_id: string
        }
        Update: {
          adapter_release?: string
          application_id?: string
          approval_action?: string
          approval_consumption_id?: string
          browser_session_ref?: string | null
          completed_at?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key?: string
          result_summary?: Json
          revision_id?: string
          started_at?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_attempts_submit_authority_fkey"
            columns: [
              "workspace_id",
              "approval_consumption_id",
              "application_id",
              "revision_id",
              "approval_action",
            ]
            isOneToOne: false
            referencedRelation: "approval_consumptions"
            referencedColumns: [
              "workspace_id",
              "id",
              "application_id",
              "revision_id",
              "permitted_action",
            ]
          },
          {
            foreignKeyName: "application_attempts_workspace_id_application_id_revision__fkey"
            columns: ["workspace_id", "application_id", "revision_id"]
            isOneToOne: false
            referencedRelation: "application_revisions"
            referencedColumns: ["workspace_id", "application_id", "id"]
          },
          {
            foreignKeyName: "application_attempts_workspace_id_approval_consumption_id__fkey"
            columns: [
              "workspace_id",
              "approval_consumption_id",
              "application_id",
              "revision_id",
            ]
            isOneToOne: false
            referencedRelation: "approval_consumptions"
            referencedColumns: [
              "workspace_id",
              "id",
              "application_id",
              "revision_id",
            ]
          },
          {
            foreignKeyName: "application_attempts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      application_autopilot_answers: {
        Row: {
          answered_by: string
          basis: Json | null
          command_id: string
          created_at: string
          id: string
          question_id: string
          source: string
          value_json: Json
        }
        Insert: {
          answered_by: string
          basis?: Json | null
          command_id: string
          created_at?: string
          id?: string
          question_id: string
          source?: string
          value_json: Json
        }
        Update: {
          answered_by?: string
          basis?: Json | null
          command_id?: string
          created_at?: string
          id?: string
          question_id?: string
          source?: string
          value_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "application_autopilot_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: true
            referencedRelation: "application_autopilot_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      application_autopilot_questions: {
        Row: {
          autopilot_id: string
          created_at: string
          descriptor: Json
          fingerprint: string
          id: string
          status: string
        }
        Insert: {
          autopilot_id: string
          created_at?: string
          descriptor: Json
          fingerprint: string
          id?: string
          status?: string
        }
        Update: {
          autopilot_id?: string
          created_at?: string
          descriptor?: Json
          fingerprint?: string
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_autopilot_questions_autopilot_id_fkey"
            columns: ["autopilot_id"]
            isOneToOne: false
            referencedRelation: "application_autopilots"
            referencedColumns: ["id"]
          },
        ]
      }
      application_autopilot_verifications: {
        Row: {
          attempt_id: string
          autopilot_id: string
          code: string | null
          expires_at: string
          id: string
          provided_at: string | null
          provided_by: string | null
          recipient_hint: string
          requested_at: string
          retry_reason: string | null
          settled_at: string | null
          source: string
          status: string
        }
        Insert: {
          attempt_id: string
          autopilot_id: string
          code?: string | null
          expires_at?: string
          id?: string
          provided_at?: string | null
          provided_by?: string | null
          recipient_hint: string
          requested_at?: string
          retry_reason?: string | null
          settled_at?: string | null
          source?: string
          status?: string
        }
        Update: {
          attempt_id?: string
          autopilot_id?: string
          code?: string | null
          expires_at?: string
          id?: string
          provided_at?: string | null
          provided_by?: string | null
          recipient_hint?: string
          requested_at?: string
          retry_reason?: string | null
          settled_at?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_autopilot_verifications_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "application_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_autopilot_verifications_autopilot_id_fkey"
            columns: ["autopilot_id"]
            isOneToOne: false
            referencedRelation: "application_autopilots"
            referencedColumns: ["id"]
          },
        ]
      }
      application_autopilots: {
        Row: {
          application_id: string
          artifact_manifest: Json
          attempt_id: string | null
          available_at: string
          candidate_id: string
          command_id: string
          created_at: string
          delegated_by: string
          destination_url: string
          disclosure_manifest: Json
          expires_at: string
          failure_code: string | null
          id: string
          lease_expires_at: string | null
          lease_owner: string | null
          lease_token: string | null
          packet_hash: string
          readback_hash: string | null
          reconcile_count: number
          request_fingerprint: string | null
          revision_id: string
          sealed_diff: Json | null
          sealed_diff_hash: string | null
          status: string
          stop_requested: string | null
          transient_retries: number
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          application_id: string
          artifact_manifest: Json
          attempt_id?: string | null
          available_at?: string
          candidate_id: string
          command_id: string
          created_at?: string
          delegated_by: string
          destination_url: string
          disclosure_manifest: Json
          expires_at?: string
          failure_code?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          lease_token?: string | null
          packet_hash: string
          readback_hash?: string | null
          reconcile_count?: number
          request_fingerprint?: string | null
          revision_id: string
          sealed_diff?: Json | null
          sealed_diff_hash?: string | null
          status?: string
          stop_requested?: string | null
          transient_retries?: number
          updated_at?: string
          version?: number
          workspace_id: string
        }
        Update: {
          application_id?: string
          artifact_manifest?: Json
          attempt_id?: string | null
          available_at?: string
          candidate_id?: string
          command_id?: string
          created_at?: string
          delegated_by?: string
          destination_url?: string
          disclosure_manifest?: Json
          expires_at?: string
          failure_code?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          lease_token?: string | null
          packet_hash?: string
          readback_hash?: string | null
          reconcile_count?: number
          request_fingerprint?: string | null
          revision_id?: string
          sealed_diff?: Json | null
          sealed_diff_hash?: string | null
          status?: string
          stop_requested?: string | null
          transient_retries?: number
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_autopilots_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "application_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_autopilots_workspace_id_application_id_revisio_fkey"
            columns: ["workspace_id", "application_id", "revision_id"]
            isOneToOne: false
            referencedRelation: "application_revisions"
            referencedColumns: ["workspace_id", "application_id", "id"]
          },
          {
            foreignKeyName: "application_autopilots_workspace_id_candidate_id_applicati_fkey"
            columns: ["workspace_id", "candidate_id", "application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "application_autopilots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      application_fill_attempts: {
        Row: {
          adapter_release: string | null
          application_id: string
          approval_action: string
          approval_consumption_id: string
          artifact_manifest: Json
          artifact_manifest_hash: string
          authority_hash: string
          authority_scope: string
          browser_run_id: string
          candidate_id: string
          completed_at: string | null
          created_at: string
          destination_policy_release: string
          destination_url: string
          destination_url_hash: string
          diff_hash: string
          disclosure_manifest: Json
          disclosure_manifest_hash: string
          execution_lease_expires_at: string | null
          execution_lease_owner: string | null
          executor_policy_release: string
          id: string
          last_lease_heartbeat_at: string | null
          packet_hash: string
          recovery_count: number
          result_summary: Json
          revision_id: string
          started_at: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          adapter_release?: string | null
          application_id: string
          approval_action: string
          approval_consumption_id: string
          artifact_manifest: Json
          artifact_manifest_hash: string
          authority_hash: string
          authority_scope?: string
          browser_run_id: string
          candidate_id: string
          completed_at?: string | null
          created_at?: string
          destination_policy_release: string
          destination_url: string
          destination_url_hash: string
          diff_hash: string
          disclosure_manifest: Json
          disclosure_manifest_hash: string
          execution_lease_expires_at?: string | null
          execution_lease_owner?: string | null
          executor_policy_release: string
          id?: string
          last_lease_heartbeat_at?: string | null
          packet_hash: string
          recovery_count?: number
          result_summary?: Json
          revision_id: string
          started_at?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          adapter_release?: string | null
          application_id?: string
          approval_action?: string
          approval_consumption_id?: string
          artifact_manifest?: Json
          artifact_manifest_hash?: string
          authority_hash?: string
          authority_scope?: string
          browser_run_id?: string
          candidate_id?: string
          completed_at?: string | null
          created_at?: string
          destination_policy_release?: string
          destination_url?: string
          destination_url_hash?: string
          diff_hash?: string
          disclosure_manifest?: Json
          disclosure_manifest_hash?: string
          execution_lease_expires_at?: string | null
          execution_lease_owner?: string | null
          executor_policy_release?: string
          id?: string
          last_lease_heartbeat_at?: string | null
          packet_hash?: string
          recovery_count?: number
          result_summary?: Json
          revision_id?: string
          started_at?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_fill_attempts_workspace_id_application_id_brow_fkey"
            columns: ["workspace_id", "application_id", "browser_run_id"]
            isOneToOne: false
            referencedRelation: "application_runs"
            referencedColumns: ["workspace_id", "application_id", "id"]
          },
          {
            foreignKeyName: "application_fill_attempts_workspace_id_application_id_revi_fkey"
            columns: ["workspace_id", "application_id", "revision_id"]
            isOneToOne: false
            referencedRelation: "application_revisions"
            referencedColumns: ["workspace_id", "application_id", "id"]
          },
          {
            foreignKeyName: "application_fill_attempts_workspace_id_approval_consumptio_fkey"
            columns: [
              "workspace_id",
              "approval_consumption_id",
              "application_id",
              "revision_id",
              "approval_action",
            ]
            isOneToOne: false
            referencedRelation: "approval_consumptions"
            referencedColumns: [
              "workspace_id",
              "id",
              "application_id",
              "revision_id",
              "permitted_action",
            ]
          },
          {
            foreignKeyName: "application_fill_attempts_workspace_id_candidate_id_applic_fkey"
            columns: ["workspace_id", "candidate_id", "application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "application_fill_attempts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      application_fill_checkpoints: {
        Row: {
          application_id: string
          candidate_id: string
          checkpoint_hash: string
          checkpoint_kind: string
          computer_session_id: string | null
          created_at: string
          fill_attempt_id: string
          id: string
          redacted_summary: Json
          workspace_id: string
        }
        Insert: {
          application_id: string
          candidate_id: string
          checkpoint_hash: string
          checkpoint_kind: string
          computer_session_id?: string | null
          created_at?: string
          fill_attempt_id: string
          id?: string
          redacted_summary: Json
          workspace_id: string
        }
        Update: {
          application_id?: string
          candidate_id?: string
          checkpoint_hash?: string
          checkpoint_kind?: string
          computer_session_id?: string | null
          created_at?: string
          fill_attempt_id?: string
          id?: string
          redacted_summary?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_fill_checkpoints_workspace_id_candidate_id_app_fkey"
            columns: [
              "workspace_id",
              "candidate_id",
              "application_id",
              "fill_attempt_id",
            ]
            isOneToOne: false
            referencedRelation: "application_fill_attempts"
            referencedColumns: [
              "workspace_id",
              "candidate_id",
              "application_id",
              "id",
            ]
          },
          {
            foreignKeyName: "application_fill_checkpoints_workspace_id_computer_session_fkey"
            columns: ["workspace_id", "computer_session_id"]
            isOneToOne: false
            referencedRelation: "computer_sessions"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "application_fill_checkpoints_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      application_fill_resume_attempts: {
        Row: {
          application_id: string
          candidate_confirmed_required_fields: boolean
          candidate_id: string
          command_id: string
          completed_at: string | null
          computer_session_id: string
          created_at: string
          fill_attempt_id: string
          id: string
          result_summary: Json
          revision_id: string
          status: string
          workspace_id: string
        }
        Insert: {
          application_id: string
          candidate_confirmed_required_fields: boolean
          candidate_id: string
          command_id: string
          completed_at?: string | null
          computer_session_id: string
          created_at?: string
          fill_attempt_id: string
          id?: string
          result_summary?: Json
          revision_id: string
          status?: string
          workspace_id: string
        }
        Update: {
          application_id?: string
          candidate_confirmed_required_fields?: boolean
          candidate_id?: string
          command_id?: string
          completed_at?: string | null
          computer_session_id?: string
          created_at?: string
          fill_attempt_id?: string
          id?: string
          result_summary?: Json
          revision_id?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_fill_resume_attem_workspace_id_candidate_id_ap_fkey"
            columns: [
              "workspace_id",
              "candidate_id",
              "application_id",
              "fill_attempt_id",
            ]
            isOneToOne: false
            referencedRelation: "application_fill_attempts"
            referencedColumns: [
              "workspace_id",
              "candidate_id",
              "application_id",
              "id",
            ]
          },
          {
            foreignKeyName: "application_fill_resume_attempts_session_binding_fkey"
            columns: ["computer_session_id", "fill_attempt_id"]
            isOneToOne: false
            referencedRelation: "computer_sessions"
            referencedColumns: ["id", "fill_attempt_id"]
          },
          {
            foreignKeyName: "application_fill_resume_attempts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      application_input_snapshots: {
        Row: {
          application_id: string
          assembler_release: string
          blockers: Json
          candidate_id: string
          candidate_input_version: number
          created_at: string
          id: string
          job_id: string
          job_version_id: string
          policy_release: string
          preparation_run_id: string
          readiness: string
          snapshot_hash: string
          snapshot_manifest: Json
          source_document_id: string | null
          source_document_version_id: string | null
          source_text_review_id: string | null
          submission_mode: string
          tailoring_mode: string
          workspace_id: string
        }
        Insert: {
          application_id: string
          assembler_release: string
          blockers?: Json
          candidate_id: string
          candidate_input_version: number
          created_at?: string
          id?: string
          job_id: string
          job_version_id: string
          policy_release: string
          preparation_run_id: string
          readiness: string
          snapshot_hash: string
          snapshot_manifest: Json
          source_document_id?: string | null
          source_document_version_id?: string | null
          source_text_review_id?: string | null
          submission_mode: string
          tailoring_mode: string
          workspace_id: string
        }
        Update: {
          application_id?: string
          assembler_release?: string
          blockers?: Json
          candidate_id?: string
          candidate_input_version?: number
          created_at?: string
          id?: string
          job_id?: string
          job_version_id?: string
          policy_release?: string
          preparation_run_id?: string
          readiness?: string
          snapshot_hash?: string
          snapshot_manifest?: Json
          source_document_id?: string | null
          source_document_version_id?: string | null
          source_text_review_id?: string | null
          submission_mode?: string
          tailoring_mode?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_input_snapshots_job_id_job_version_id_fkey"
            columns: ["job_id", "job_version_id"]
            isOneToOne: false
            referencedRelation: "job_versions"
            referencedColumns: ["job_id", "id"]
          },
          {
            foreignKeyName: "application_input_snapshots_workspace_id_application_id_pr_fkey"
            columns: ["workspace_id", "application_id", "preparation_run_id"]
            isOneToOne: false
            referencedRelation: "application_runs"
            referencedColumns: ["workspace_id", "application_id", "id"]
          },
          {
            foreignKeyName: "application_input_snapshots_workspace_id_candidate_id_appl_fkey"
            columns: ["workspace_id", "candidate_id", "application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "application_input_snapshots_workspace_id_candidate_id_sour_fkey"
            columns: [
              "workspace_id",
              "candidate_id",
              "source_document_id",
              "source_document_version_id",
              "source_text_review_id",
            ]
            isOneToOne: false
            referencedRelation: "source_document_text_reviews"
            referencedColumns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "document_version_id",
              "id",
            ]
          },
          {
            foreignKeyName: "application_input_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      application_research_bundles: {
        Row: {
          application_id: string
          bundle_hash: string
          bundle_manifest: Json
          candidate_id: string
          created_at: string
          freshness_expires_at: string
          freshness_policy_release: string
          id: string
          input_snapshot_hash: string
          input_snapshot_id: string
          objective: string
          researcher_release: string
          workspace_id: string
        }
        Insert: {
          application_id: string
          bundle_hash: string
          bundle_manifest: Json
          candidate_id: string
          created_at?: string
          freshness_expires_at: string
          freshness_policy_release: string
          id?: string
          input_snapshot_hash: string
          input_snapshot_id: string
          objective?: string
          researcher_release: string
          workspace_id: string
        }
        Update: {
          application_id?: string
          bundle_hash?: string
          bundle_manifest?: Json
          candidate_id?: string
          created_at?: string
          freshness_expires_at?: string
          freshness_policy_release?: string
          id?: string
          input_snapshot_hash?: string
          input_snapshot_id?: string
          objective?: string
          researcher_release?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_research_bundles_application_fkey"
            columns: ["workspace_id", "candidate_id", "application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "application_research_bundles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      application_revision_evidence_refs: {
        Row: {
          application_id: string
          application_revision_id: string
          candidate_id: string
          created_at: string
          document_id: string
          evidence_hash: string
          evidence_version_id: string
          input_snapshot_id: string
          workspace_id: string
        }
        Insert: {
          application_id: string
          application_revision_id: string
          candidate_id: string
          created_at?: string
          document_id: string
          evidence_hash: string
          evidence_version_id: string
          input_snapshot_id: string
          workspace_id: string
        }
        Update: {
          application_id?: string
          application_revision_id?: string
          candidate_id?: string
          created_at?: string
          document_id?: string
          evidence_hash?: string
          evidence_version_id?: string
          input_snapshot_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_revision_evidence_refs_application_fkey"
            columns: ["workspace_id", "candidate_id", "application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "application_revision_evidence_refs_revision_fkey"
            columns: [
              "workspace_id",
              "application_id",
              "input_snapshot_id",
              "application_revision_id",
            ]
            isOneToOne: false
            referencedRelation: "application_revisions"
            referencedColumns: [
              "workspace_id",
              "application_id",
              "input_snapshot_id",
              "id",
            ]
          },
          {
            foreignKeyName: "application_revision_evidence_refs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      application_revision_fact_refs: {
        Row: {
          application_id: string
          application_revision_id: string
          candidate_id: string
          created_at: string
          fact_version_id: string
          workspace_id: string
        }
        Insert: {
          application_id: string
          application_revision_id: string
          candidate_id: string
          created_at?: string
          fact_version_id: string
          workspace_id: string
        }
        Update: {
          application_id?: string
          application_revision_id?: string
          candidate_id?: string
          created_at?: string
          fact_version_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_revision_fact_ref_workspace_id_application_id__fkey"
            columns: [
              "workspace_id",
              "application_id",
              "application_revision_id",
            ]
            isOneToOne: false
            referencedRelation: "application_revisions"
            referencedColumns: ["workspace_id", "application_id", "id"]
          },
          {
            foreignKeyName: "application_revision_fact_ref_workspace_id_candidate_id_ap_fkey"
            columns: ["workspace_id", "candidate_id", "application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "application_revision_fact_ref_workspace_id_candidate_id_fa_fkey"
            columns: ["workspace_id", "candidate_id", "fact_version_id"]
            isOneToOne: false
            referencedRelation: "candidate_fact_versions"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "application_revision_fact_refs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      application_revisions: {
        Row: {
          application_id: string
          created_at: string
          id: string
          input_snapshot_hash: string
          input_snapshot_id: string
          job_version_id: string | null
          material_diff: Json
          packet_hash: string
          packet_manifest: Json
          research_bundle_hash: string
          research_bundle_id: string
          validation_status: string
          version_number: number
          workspace_id: string
        }
        Insert: {
          application_id: string
          created_at?: string
          id?: string
          input_snapshot_hash: string
          input_snapshot_id: string
          job_version_id?: string | null
          material_diff: Json
          packet_hash: string
          packet_manifest: Json
          research_bundle_hash: string
          research_bundle_id: string
          validation_status: string
          version_number: number
          workspace_id: string
        }
        Update: {
          application_id?: string
          created_at?: string
          id?: string
          input_snapshot_hash?: string
          input_snapshot_id?: string
          job_version_id?: string | null
          material_diff?: Json
          packet_hash?: string
          packet_manifest?: Json
          research_bundle_hash?: string
          research_bundle_id?: string
          validation_status?: string
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_revisions_research_bundle_fkey"
            columns: [
              "workspace_id",
              "application_id",
              "input_snapshot_id",
              "research_bundle_id",
            ]
            isOneToOne: false
            referencedRelation: "application_research_bundles"
            referencedColumns: [
              "workspace_id",
              "application_id",
              "input_snapshot_id",
              "id",
            ]
          },
          {
            foreignKeyName: "application_revisions_workspace_id_application_id_fkey"
            columns: ["workspace_id", "application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "application_revisions_workspace_id_application_id_job_vers_fkey"
            columns: ["workspace_id", "application_id", "job_version_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["workspace_id", "id", "job_version_id"]
          },
          {
            foreignKeyName: "application_revisions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      application_runs: {
        Row: {
          application_id: string
          attempt_count: number
          available_at: string
          created_at: string
          drafting_attempt_history: Json | null
          error_code: string | null
          external_workflow_ref: string | null
          finished_at: string | null
          id: string
          input_revision_id: string | null
          input_snapshot_id: string | null
          last_heartbeat_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          preparation_stage: string | null
          run_kind: string
          started_at: string | null
          status: string
          workflow_provider: string | null
          workspace_id: string
        }
        Insert: {
          application_id: string
          attempt_count?: number
          available_at?: string
          created_at?: string
          drafting_attempt_history?: Json | null
          error_code?: string | null
          external_workflow_ref?: string | null
          finished_at?: string | null
          id?: string
          input_revision_id?: string | null
          input_snapshot_id?: string | null
          last_heartbeat_at?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          preparation_stage?: string | null
          run_kind: string
          started_at?: string | null
          status?: string
          workflow_provider?: string | null
          workspace_id: string
        }
        Update: {
          application_id?: string
          attempt_count?: number
          available_at?: string
          created_at?: string
          drafting_attempt_history?: Json | null
          error_code?: string | null
          external_workflow_ref?: string | null
          finished_at?: string | null
          id?: string
          input_revision_id?: string | null
          input_snapshot_id?: string | null
          last_heartbeat_at?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          preparation_stage?: string | null
          run_kind?: string
          started_at?: string | null
          status?: string
          workflow_provider?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_runs_input_revision_fkey"
            columns: ["workspace_id", "application_id", "input_revision_id"]
            isOneToOne: false
            referencedRelation: "application_revisions"
            referencedColumns: ["workspace_id", "application_id", "id"]
          },
          {
            foreignKeyName: "application_runs_input_snapshot_fkey"
            columns: ["workspace_id", "application_id", "input_snapshot_id"]
            isOneToOne: false
            referencedRelation: "application_input_snapshots"
            referencedColumns: ["workspace_id", "application_id", "id"]
          },
          {
            foreignKeyName: "application_runs_workspace_id_application_id_fkey"
            columns: ["workspace_id", "application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "application_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      application_send_intents: {
        Row: {
          application_id: string
          candidate_id: string
          close_reason: string | null
          closed_at: string | null
          created_at: string
          delegate_command_id: string
          requested_by: string
          workspace_id: string
        }
        Insert: {
          application_id: string
          candidate_id: string
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          delegate_command_id?: string
          requested_by: string
          workspace_id: string
        }
        Update: {
          application_id?: string
          candidate_id?: string
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          delegate_command_id?: string
          requested_by?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_send_intents_workspace_id_candidate_id_applica_fkey"
            columns: ["workspace_id", "candidate_id", "application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
        ]
      }
      application_snapshot_evidence_refs: {
        Row: {
          application_id: string
          candidate_id: string
          created_at: string
          document_id: string
          evidence_version_id: string
          input_snapshot_id: string
          workspace_id: string
        }
        Insert: {
          application_id: string
          candidate_id: string
          created_at?: string
          document_id: string
          evidence_version_id: string
          input_snapshot_id: string
          workspace_id: string
        }
        Update: {
          application_id?: string
          candidate_id?: string
          created_at?: string
          document_id?: string
          evidence_version_id?: string
          input_snapshot_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_snapshot_evidence_refs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_snapshot_evidence_workspace_id_application_id__fkey"
            columns: ["workspace_id", "application_id", "input_snapshot_id"]
            isOneToOne: false
            referencedRelation: "application_input_snapshots"
            referencedColumns: ["workspace_id", "application_id", "id"]
          },
          {
            foreignKeyName: "application_snapshot_evidence_workspace_id_candidate_id_ap_fkey"
            columns: ["workspace_id", "candidate_id", "application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "application_snapshot_evidence_workspace_id_candidate_id_do_fkey"
            columns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "evidence_version_id",
            ]
            isOneToOne: false
            referencedRelation: "candidate_evidence_versions"
            referencedColumns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "id",
            ]
          },
        ]
      }
      application_snapshot_fact_refs: {
        Row: {
          application_id: string
          candidate_id: string
          created_at: string
          fact_version_id: string
          input_snapshot_id: string
          workspace_id: string
        }
        Insert: {
          application_id: string
          candidate_id: string
          created_at?: string
          fact_version_id: string
          input_snapshot_id: string
          workspace_id: string
        }
        Update: {
          application_id?: string
          candidate_id?: string
          created_at?: string
          fact_version_id?: string
          input_snapshot_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_snapshot_fact_ref_workspace_id_application_id__fkey"
            columns: ["workspace_id", "application_id", "input_snapshot_id"]
            isOneToOne: false
            referencedRelation: "application_input_snapshots"
            referencedColumns: ["workspace_id", "application_id", "id"]
          },
          {
            foreignKeyName: "application_snapshot_fact_ref_workspace_id_candidate_id_ap_fkey"
            columns: ["workspace_id", "candidate_id", "application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "application_snapshot_fact_ref_workspace_id_candidate_id_fa_fkey"
            columns: ["workspace_id", "candidate_id", "fact_version_id"]
            isOneToOne: false
            referencedRelation: "candidate_fact_versions"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "application_snapshot_fact_refs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          aggregate_version: number
          archived_at: string | null
          candidate_id: string
          created_at: string
          current_revision_id: string | null
          id: string
          job_id: string | null
          job_intake_id: string | null
          job_version_id: string | null
          operations_review_status: string
          queued_at: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          aggregate_version?: number
          archived_at?: string | null
          candidate_id: string
          created_at?: string
          current_revision_id?: string | null
          id?: string
          job_id?: string | null
          job_intake_id?: string | null
          job_version_id?: string | null
          operations_review_status?: string
          queued_at?: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          aggregate_version?: number
          archived_at?: string | null
          candidate_id?: string
          created_at?: string
          current_revision_id?: string | null
          id?: string
          job_id?: string | null
          job_intake_id?: string | null
          job_version_id?: string | null
          operations_review_status?: string
          queued_at?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_current_revision_fkey"
            columns: ["workspace_id", "id", "current_revision_id"]
            isOneToOne: false
            referencedRelation: "application_revisions"
            referencedColumns: ["workspace_id", "application_id", "id"]
          },
          {
            foreignKeyName: "applications_job_id_job_version_id_fkey"
            columns: ["job_id", "job_version_id"]
            isOneToOne: false
            referencedRelation: "job_versions"
            referencedColumns: ["job_id", "id"]
          },
          {
            foreignKeyName: "applications_workspace_id_candidate_id_fkey"
            columns: ["workspace_id", "candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "applications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_workspace_id_job_intake_id_fkey"
            columns: ["workspace_id", "job_intake_id"]
            isOneToOne: true
            referencedRelation: "job_intakes"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      approval_challenges: {
        Row: {
          application_id: string
          authority_hash: string | null
          authority_manifest: Json | null
          candidate_id: string
          diff_hash: string
          expires_at: string
          id: string
          issued_at: string
          nonce_hash: string
          permitted_action: string
          revision_id: string
          revoked_at: string | null
          workspace_id: string
        }
        Insert: {
          application_id: string
          authority_hash?: string | null
          authority_manifest?: Json | null
          candidate_id: string
          diff_hash: string
          expires_at: string
          id?: string
          issued_at?: string
          nonce_hash: string
          permitted_action: string
          revision_id: string
          revoked_at?: string | null
          workspace_id: string
        }
        Update: {
          application_id?: string
          authority_hash?: string | null
          authority_manifest?: Json | null
          candidate_id?: string
          diff_hash?: string
          expires_at?: string
          id?: string
          issued_at?: string
          nonce_hash?: string
          permitted_action?: string
          revision_id?: string
          revoked_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_challenges_workspace_id_application_id_revision_i_fkey"
            columns: ["workspace_id", "application_id", "revision_id"]
            isOneToOne: false
            referencedRelation: "application_revisions"
            referencedColumns: ["workspace_id", "application_id", "id"]
          },
          {
            foreignKeyName: "approval_challenges_workspace_id_candidate_id_application__fkey"
            columns: ["workspace_id", "candidate_id", "application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "approval_challenges_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_consumptions: {
        Row: {
          application_id: string
          approval_id: string
          command_id: string
          consumed_at: string
          consumed_by: string
          id: string
          permitted_action: string
          revision_id: string
          workspace_id: string
        }
        Insert: {
          application_id: string
          approval_id: string
          command_id: string
          consumed_at?: string
          consumed_by: string
          id?: string
          permitted_action: string
          revision_id: string
          workspace_id: string
        }
        Update: {
          application_id?: string
          approval_id?: string
          command_id?: string
          consumed_at?: string
          consumed_by?: string
          id?: string
          permitted_action?: string
          revision_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_consumptions_action_fkey"
            columns: [
              "workspace_id",
              "approval_id",
              "application_id",
              "revision_id",
              "permitted_action",
            ]
            isOneToOne: false
            referencedRelation: "approval_challenges"
            referencedColumns: [
              "workspace_id",
              "id",
              "application_id",
              "revision_id",
              "permitted_action",
            ]
          },
          {
            foreignKeyName: "approval_consumptions_workspace_id_approval_id_application_fkey"
            columns: [
              "workspace_id",
              "approval_id",
              "application_id",
              "revision_id",
            ]
            isOneToOne: false
            referencedRelation: "approval_challenges"
            referencedColumns: [
              "workspace_id",
              "id",
              "application_id",
              "revision_id",
            ]
          },
          {
            foreignKeyName: "approval_consumptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      artifact_versions: {
        Row: {
          application_revision_id: string
          byte_size: number
          created_at: string
          display_name: string
          id: string
          kind: string
          mime_type: string
          qa_status: string
          renderer_release: string | null
          sha256: string
          storage_bucket: string
          storage_object_path: string
          variant: string
          workspace_id: string
        }
        Insert: {
          application_revision_id: string
          byte_size: number
          created_at?: string
          display_name: string
          id?: string
          kind: string
          mime_type: string
          qa_status: string
          renderer_release?: string | null
          sha256: string
          storage_bucket: string
          storage_object_path: string
          variant: string
          workspace_id: string
        }
        Update: {
          application_revision_id?: string
          byte_size?: number
          created_at?: string
          display_name?: string
          id?: string
          kind?: string
          mime_type?: string
          qa_status?: string
          renderer_release?: string | null
          sha256?: string
          storage_bucket?: string
          storage_object_path?: string
          variant?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifact_versions_workspace_id_application_revision_id_fkey"
            columns: ["workspace_id", "application_revision_id"]
            isOneToOne: false
            referencedRelation: "application_revisions"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "artifact_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_apply_enrollments: {
        Row: {
          application_id: string
          candidate_id: string
          candidate_input_version: number
          close_reason: string | null
          closed_at: string | null
          consent_version: number
          created_at: string
          delegate_command_id: string
          job_id: string
          job_version_id: string
          matching_decision: Json
          matching_policy: string
          profile_hash: string
          search_profile_version: number
          workspace_id: string
        }
        Insert: {
          application_id: string
          candidate_id: string
          candidate_input_version: number
          close_reason?: string | null
          closed_at?: string | null
          consent_version: number
          created_at?: string
          delegate_command_id?: string
          job_id: string
          job_version_id: string
          matching_decision: Json
          matching_policy: string
          profile_hash: string
          search_profile_version: number
          workspace_id: string
        }
        Update: {
          application_id?: string
          candidate_id?: string
          candidate_input_version?: number
          close_reason?: string | null
          closed_at?: string | null
          consent_version?: number
          created_at?: string
          delegate_command_id?: string
          job_id?: string
          job_version_id?: string
          matching_decision?: Json
          matching_policy?: string
          profile_hash?: string
          search_profile_version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_apply_enrollments_job_id_job_version_id_fkey"
            columns: ["job_id", "job_version_id"]
            isOneToOne: false
            referencedRelation: "job_versions"
            referencedColumns: ["job_id", "id"]
          },
          {
            foreignKeyName: "auto_apply_enrollments_workspace_id_candidate_id_applicati_fkey"
            columns: ["workspace_id", "candidate_id", "application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
        ]
      }
      candidate_auto_apply_settings: {
        Row: {
          candidate_id: string
          candidate_input_version: number | null
          consent_actor: string | null
          consented_at: string | null
          enabled: boolean
          last_checked_at: string | null
          last_outcome: string | null
          next_check_at: string
          next_prepare_at: string | null
          next_submission_at: string | null
          plan_key: string
          search_profile_version: number | null
          status: string
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          candidate_id: string
          candidate_input_version?: number | null
          consent_actor?: string | null
          consented_at?: string | null
          enabled?: boolean
          last_checked_at?: string | null
          last_outcome?: string | null
          next_check_at?: string
          next_prepare_at?: string | null
          next_submission_at?: string | null
          plan_key?: string
          search_profile_version?: number | null
          status?: string
          updated_at?: string
          version?: number
          workspace_id: string
        }
        Update: {
          candidate_id?: string
          candidate_input_version?: number | null
          consent_actor?: string | null
          consented_at?: string | null
          enabled?: boolean
          last_checked_at?: string | null
          last_outcome?: string | null
          next_check_at?: string
          next_prepare_at?: string | null
          next_submission_at?: string | null
          plan_key?: string
          search_profile_version?: number | null
          status?: string
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_auto_apply_settings_workspace_id_candidate_id_fkey"
            columns: ["workspace_id", "candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      candidate_evidence_citations: {
        Row: {
          candidate_id: string
          created_at: string
          document_id: string
          evidence_version_id: string
          id: string
          passage_id: string
          workspace_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          document_id: string
          evidence_version_id: string
          id?: string
          passage_id: string
          workspace_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          document_id?: string
          evidence_version_id?: string
          id?: string
          passage_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_evidence_citations_workspace_id_candidate_id_do_fkey1"
            columns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "passage_id",
            ]
            isOneToOne: false
            referencedRelation: "source_evidence_passages"
            referencedColumns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "id",
            ]
          },
          {
            foreignKeyName: "candidate_evidence_citations_workspace_id_candidate_id_doc_fkey"
            columns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "evidence_version_id",
            ]
            isOneToOne: false
            referencedRelation: "candidate_evidence_versions"
            referencedColumns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "id",
            ]
          },
          {
            foreignKeyName: "candidate_evidence_citations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_evidence_items: {
        Row: {
          aggregate_version: number
          candidate_id: string
          created_at: string
          current_version_number: number | null
          document_id: string
          evidence_category: string
          evidence_key: string
          id: string
          primary_source_passage_id: string
          review_status: string
          text_review_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          aggregate_version?: number
          candidate_id: string
          created_at?: string
          current_version_number?: number | null
          document_id: string
          evidence_category: string
          evidence_key: string
          id?: string
          primary_source_passage_id: string
          review_status?: string
          text_review_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          aggregate_version?: number
          candidate_id?: string
          created_at?: string
          current_version_number?: number | null
          document_id?: string
          evidence_category?: string
          evidence_key?: string
          id?: string
          primary_source_passage_id?: string
          review_status?: string
          text_review_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_evidence_items_current_version_fkey"
            columns: ["id", "current_version_number"]
            isOneToOne: false
            referencedRelation: "candidate_evidence_versions"
            referencedColumns: ["evidence_item_id", "version_number"]
          },
          {
            foreignKeyName: "candidate_evidence_items_workspace_id_candidate_id_documen_fkey"
            columns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "primary_source_passage_id",
            ]
            isOneToOne: false
            referencedRelation: "source_evidence_passages"
            referencedColumns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "id",
            ]
          },
          {
            foreignKeyName: "candidate_evidence_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_evidence_versions: {
        Row: {
          candidate_attested: boolean
          candidate_disposition: string
          candidate_id: string
          claim_sha256: string
          claim_text: string
          created_at: string
          created_by: string
          document_id: string
          evidence_item_id: string
          id: string
          review_kind: string
          reviewed_at: string | null
          reviewed_by: string | null
          usage_policy: string
          version_number: number
          workspace_id: string
        }
        Insert: {
          candidate_attested?: boolean
          candidate_disposition: string
          candidate_id: string
          claim_sha256: string
          claim_text: string
          created_at?: string
          created_by: string
          document_id: string
          evidence_item_id: string
          id?: string
          review_kind: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          usage_policy: string
          version_number: number
          workspace_id: string
        }
        Update: {
          candidate_attested?: boolean
          candidate_disposition?: string
          candidate_id?: string
          claim_sha256?: string
          claim_text?: string
          created_at?: string
          created_by?: string
          document_id?: string
          evidence_item_id?: string
          id?: string
          review_kind?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          usage_policy?: string
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_evidence_versions_workspace_id_candidate_id_docu_fkey"
            columns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "evidence_item_id",
            ]
            isOneToOne: false
            referencedRelation: "candidate_evidence_items"
            referencedColumns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "id",
            ]
          },
          {
            foreignKeyName: "candidate_evidence_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_fact_versions: {
        Row: {
          candidate_disposition: string
          candidate_id: string
          created_at: string
          created_by: string
          fact_id: string
          id: string
          normalized_text: string | null
          review_kind: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          value_json: Json
          version_number: number
          workspace_id: string
        }
        Insert: {
          candidate_disposition: string
          candidate_id: string
          created_at?: string
          created_by: string
          fact_id: string
          id?: string
          normalized_text?: string | null
          review_kind?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          value_json: Json
          version_number: number
          workspace_id: string
        }
        Update: {
          candidate_disposition?: string
          candidate_id?: string
          created_at?: string
          created_by?: string
          fact_id?: string
          id?: string
          normalized_text?: string | null
          review_kind?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          value_json?: Json
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_fact_versions_workspace_id_candidate_id_fact_id_fkey"
            columns: ["workspace_id", "candidate_id", "fact_id"]
            isOneToOne: false
            referencedRelation: "candidate_facts"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "candidate_fact_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_facts: {
        Row: {
          aggregate_version: number
          candidate_id: string
          created_at: string
          current_version_number: number | null
          fact_key: string
          id: string
          sensitivity: string
          updated_at: string
          usage_policy: string
          verification_status: string
          workspace_id: string
        }
        Insert: {
          aggregate_version?: number
          candidate_id: string
          created_at?: string
          current_version_number?: number | null
          fact_key: string
          id?: string
          sensitivity: string
          updated_at?: string
          usage_policy: string
          verification_status?: string
          workspace_id: string
        }
        Update: {
          aggregate_version?: number
          candidate_id?: string
          created_at?: string
          current_version_number?: number | null
          fact_key?: string
          id?: string
          sensitivity?: string
          updated_at?: string
          usage_policy?: string
          verification_status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_facts_current_version_fkey"
            columns: ["id", "current_version_number"]
            isOneToOne: false
            referencedRelation: "candidate_fact_versions"
            referencedColumns: ["fact_id", "version_number"]
          },
          {
            foreignKeyName: "candidate_facts_workspace_id_candidate_id_fkey"
            columns: ["workspace_id", "candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "candidate_facts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_interview_sessions: {
        Row: {
          aggregate_version: number
          candidate_id: string
          completed_at: string | null
          created_at: string
          id: string
          interviewer_release: string
          state: Json
          status: string
          turn_count: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          aggregate_version?: number
          candidate_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          interviewer_release: string
          state?: Json
          status?: string
          turn_count?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          aggregate_version?: number
          candidate_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          interviewer_release?: string
          state?: Json
          status?: string
          turn_count?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_interview_sessions_workspace_id_candidate_id_fkey"
            columns: ["workspace_id", "candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "candidate_interview_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_interview_turns: {
        Row: {
          candidate_id: string
          content: string
          created_at: string
          id: string
          sequence_number: number
          session_id: string
          speaker: string
          workspace_id: string
        }
        Insert: {
          candidate_id: string
          content: string
          created_at?: string
          id?: string
          sequence_number: number
          session_id: string
          speaker: string
          workspace_id: string
        }
        Update: {
          candidate_id?: string
          content?: string
          created_at?: string
          id?: string
          sequence_number?: number
          session_id?: string
          speaker?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_interview_turns_workspace_id_candidate_id_fkey"
            columns: ["workspace_id", "candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "candidate_interview_turns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_interview_turns_workspace_id_session_id_fkey"
            columns: ["workspace_id", "session_id"]
            isOneToOne: false
            referencedRelation: "candidate_interview_sessions"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      candidate_job_decisions: {
        Row: {
          candidate_id: string
          command_id: string
          decided_at: string
          decision: string
          id: string
          job_id: string
          job_version_id: string
          reason_code: string | null
          undone_at: string | null
          workspace_id: string
        }
        Insert: {
          candidate_id: string
          command_id: string
          decided_at?: string
          decision: string
          id?: string
          job_id: string
          job_version_id: string
          reason_code?: string | null
          undone_at?: string | null
          workspace_id: string
        }
        Update: {
          candidate_id?: string
          command_id?: string
          decided_at?: string
          decision?: string
          id?: string
          job_id?: string
          job_version_id?: string
          reason_code?: string | null
          undone_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_job_decisions_job_id_job_version_id_fkey"
            columns: ["job_id", "job_version_id"]
            isOneToOne: false
            referencedRelation: "job_versions"
            referencedColumns: ["job_id", "id"]
          },
          {
            foreignKeyName: "candidate_job_decisions_workspace_id_candidate_id_fkey"
            columns: ["workspace_id", "candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "candidate_job_decisions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_profile_document_versions: {
        Row: {
          candidate_id: string
          content: Json
          content_sha256: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          producer_release: string | null
          source_kind: string
          source_text_review_id: string | null
          version_number: number
          workspace_id: string
        }
        Insert: {
          candidate_id: string
          content: Json
          content_sha256: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          producer_release?: string | null
          source_kind: string
          source_text_review_id?: string | null
          version_number: number
          workspace_id: string
        }
        Update: {
          candidate_id?: string
          content?: Json
          content_sha256?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          producer_release?: string | null
          source_kind?: string
          source_text_review_id?: string | null
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_profile_document_versi_workspace_id_candidate_id_fkey"
            columns: ["workspace_id", "candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "candidate_profile_document_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_profile_documents: {
        Row: {
          aggregate_version: number
          candidate_id: string
          created_at: string
          current_version_id: string | null
          current_version_number: number
          extraction_error: string | null
          extraction_requested_at: string | null
          extraction_status: string
          id: string
          kind: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          aggregate_version?: number
          candidate_id: string
          created_at?: string
          current_version_id?: string | null
          current_version_number?: number
          extraction_error?: string | null
          extraction_requested_at?: string | null
          extraction_status?: string
          id?: string
          kind: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          aggregate_version?: number
          candidate_id?: string
          created_at?: string
          current_version_id?: string | null
          current_version_number?: number
          extraction_error?: string | null
          extraction_requested_at?: string | null
          extraction_status?: string
          id?: string
          kind?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_profile_documents_workspace_id_candidate_id_fkey"
            columns: ["workspace_id", "candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "candidate_profile_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_search_profiles: {
        Row: {
          aggregate_version: number
          candidate_id: string
          created_at: string
          desired_country_codes: string[]
          employment_types: string[]
          preferred_locations: string[]
          target_roles: string[]
          updated_at: string
          work_modes: string[]
          workspace_id: string
        }
        Insert: {
          aggregate_version?: number
          candidate_id: string
          created_at?: string
          desired_country_codes: string[]
          employment_types: string[]
          preferred_locations?: string[]
          target_roles: string[]
          updated_at?: string
          work_modes: string[]
          workspace_id: string
        }
        Update: {
          aggregate_version?: number
          candidate_id?: string
          created_at?: string
          desired_country_codes?: string[]
          employment_types?: string[]
          preferred_locations?: string[]
          target_roles?: string[]
          updated_at?: string
          work_modes?: string[]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_search_profiles_workspace_id_candidate_id_fkey"
            columns: ["workspace_id", "candidate_id"]
            isOneToOne: true
            referencedRelation: "candidates"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "candidate_search_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_standing_answers: {
        Row: {
          answer: string
          candidate_id: string
          created_at: string
          id: string
          topic: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          answer: string
          candidate_id: string
          created_at?: string
          id?: string
          topic: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          answer?: string
          candidate_id?: string
          created_at?: string
          id?: string
          topic?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_standing_answers_workspace_id_candidate_id_fkey"
            columns: ["workspace_id", "candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "candidate_standing_answers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_stories: {
        Row: {
          aggregate_version: number
          candidate_id: string
          created_at: string
          current_version_number: number
          id: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          aggregate_version?: number
          candidate_id: string
          created_at?: string
          current_version_number?: number
          id?: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          aggregate_version?: number
          candidate_id?: string
          created_at?: string
          current_version_number?: number
          id?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_stories_workspace_id_candidate_id_fkey"
            columns: ["workspace_id", "candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "candidate_stories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_story_versions: {
        Row: {
          action: string
          candidate_disposition: string
          candidate_id: string
          created_at: string
          created_by: string | null
          guardrails: string | null
          id: string
          interview_session_id: string | null
          metrics: Json
          organization: string | null
          period_label: string | null
          position_key: string | null
          result: string
          reviewed_at: string | null
          role_title: string | null
          situation: string
          source_kind: string
          story_id: string
          story_sha256: string
          story_text: string
          task: string
          themes: string[]
          title: string
          usage_policy: string
          version_number: number
          workspace_id: string
        }
        Insert: {
          action: string
          candidate_disposition: string
          candidate_id: string
          created_at?: string
          created_by?: string | null
          guardrails?: string | null
          id?: string
          interview_session_id?: string | null
          metrics?: Json
          organization?: string | null
          period_label?: string | null
          position_key?: string | null
          result: string
          reviewed_at?: string | null
          role_title?: string | null
          situation: string
          source_kind: string
          story_id: string
          story_sha256: string
          story_text: string
          task: string
          themes?: string[]
          title: string
          usage_policy: string
          version_number: number
          workspace_id: string
        }
        Update: {
          action?: string
          candidate_disposition?: string
          candidate_id?: string
          created_at?: string
          created_by?: string | null
          guardrails?: string | null
          id?: string
          interview_session_id?: string | null
          metrics?: Json
          organization?: string | null
          period_label?: string | null
          position_key?: string | null
          result?: string
          reviewed_at?: string | null
          role_title?: string | null
          situation?: string
          source_kind?: string
          story_id?: string
          story_sha256?: string
          story_text?: string
          task?: string
          themes?: string[]
          title?: string
          usage_policy?: string
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_story_versions_session_fk"
            columns: ["workspace_id", "interview_session_id"]
            isOneToOne: false
            referencedRelation: "candidate_interview_sessions"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "candidate_story_versions_workspace_id_candidate_id_fkey"
            columns: ["workspace_id", "candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "candidate_story_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_story_versions_workspace_id_story_id_fkey"
            columns: ["workspace_id", "story_id"]
            isOneToOne: false
            referencedRelation: "candidate_stories"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      candidates: {
        Row: {
          aggregate_version: number
          application_input_version: number
          auth_user_id: string
          created_at: string
          display_name: string
          id: string
          status: string
          submission_mode: string
          tailoring_mode: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          aggregate_version?: number
          application_input_version?: number
          auth_user_id: string
          created_at?: string
          display_name: string
          id?: string
          status?: string
          submission_mode?: string
          tailoring_mode?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          aggregate_version?: number
          application_input_version?: number
          auth_user_id?: string
          created_at?: string
          display_name?: string
          id?: string
          status?: string
          submission_mode?: string
          tailoring_mode?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      command_dedup: {
        Row: {
          actor_id: string
          aggregate_id: string | null
          aggregate_type: string | null
          command_id: string
          command_type: string
          completed_at: string | null
          created_at: string
          request_hash: string
          result: Json | null
          result_event_id: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          actor_id: string
          aggregate_id?: string | null
          aggregate_type?: string | null
          command_id: string
          command_type: string
          completed_at?: string | null
          created_at?: string
          request_hash: string
          result?: Json | null
          result_event_id?: string | null
          status: string
          workspace_id: string
        }
        Update: {
          actor_id?: string
          aggregate_id?: string | null
          aggregate_type?: string | null
          command_id?: string
          command_type?: string
          completed_at?: string | null
          created_at?: string
          request_hash?: string
          result?: Json | null
          result_event_id?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "command_dedup_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "command_dedup_workspace_id_result_event_id_fkey"
            columns: ["workspace_id", "result_event_id"]
            isOneToOne: false
            referencedRelation: "domain_events"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      computer_sessions: {
        Row: {
          activated_at: string | null
          allowed_domain_policy: Json
          allowed_domain_policy_hash: string
          application_id: string
          broker_release: string
          browser_profile_ref: string | null
          candidate_id: string
          closed_at: string | null
          created_at: string
          destroyed_at: string | null
          execution_mode: string
          expires_at: string
          fill_attempt_id: string
          id: string
          mounted_artifact_manifest: Json
          paused_at: string | null
          revision_id: string
          start_url: string
          state: string
          usage_summary: Json
          workspace_id: string
        }
        Insert: {
          activated_at?: string | null
          allowed_domain_policy: Json
          allowed_domain_policy_hash: string
          application_id: string
          broker_release: string
          browser_profile_ref?: string | null
          candidate_id: string
          closed_at?: string | null
          created_at?: string
          destroyed_at?: string | null
          execution_mode: string
          expires_at: string
          fill_attempt_id: string
          id?: string
          mounted_artifact_manifest: Json
          paused_at?: string | null
          revision_id: string
          start_url: string
          state?: string
          usage_summary?: Json
          workspace_id: string
        }
        Update: {
          activated_at?: string | null
          allowed_domain_policy?: Json
          allowed_domain_policy_hash?: string
          application_id?: string
          broker_release?: string
          browser_profile_ref?: string | null
          candidate_id?: string
          closed_at?: string | null
          created_at?: string
          destroyed_at?: string | null
          execution_mode?: string
          expires_at?: string
          fill_attempt_id?: string
          id?: string
          mounted_artifact_manifest?: Json
          paused_at?: string | null
          revision_id?: string
          start_url?: string
          state?: string
          usage_summary?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "computer_sessions_workspace_id_application_id_revision_id__fkey"
            columns: [
              "workspace_id",
              "application_id",
              "revision_id",
              "fill_attempt_id",
            ]
            isOneToOne: false
            referencedRelation: "application_fill_attempts"
            referencedColumns: [
              "workspace_id",
              "application_id",
              "revision_id",
              "id",
            ]
          },
          {
            foreignKeyName: "computer_sessions_workspace_id_candidate_id_application_id_fkey"
            columns: [
              "workspace_id",
              "candidate_id",
              "application_id",
              "fill_attempt_id",
            ]
            isOneToOne: false
            referencedRelation: "application_fill_attempts"
            referencedColumns: [
              "workspace_id",
              "candidate_id",
              "application_id",
              "id",
            ]
          },
          {
            foreignKeyName: "computer_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_events: {
        Row: {
          actor_id: string | null
          actor_kind: string
          aggregate_id: string
          aggregate_type: string
          aggregate_version: number
          causation_id: string | null
          correlation_id: string
          event_type: string
          id: string
          occurred_at: string
          payload: Json
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_kind: string
          aggregate_id: string
          aggregate_type: string
          aggregate_version: number
          causation_id?: string | null
          correlation_id: string
          event_type: string
          id?: string
          occurred_at?: string
          payload?: Json
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          actor_kind?: string
          aggregate_id?: string
          aggregate_type?: string
          aggregate_version?: number
          causation_id?: string | null
          correlation_id?: string
          event_type?: string
          id?: string
          occurred_at?: string
          payload?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      employer_logos: {
        Row: {
          attempted_at: string
          board_slug: string
          checked_at: string
          content_type: string | null
          created_at: string
          fetched_at: string
          logo_bytes: string | null
          miss_count: number
          provider: string
          status: string
        }
        Insert: {
          attempted_at?: string
          board_slug: string
          checked_at?: string
          content_type?: string | null
          created_at?: string
          fetched_at?: string
          logo_bytes?: string | null
          miss_count?: number
          provider: string
          status: string
        }
        Update: {
          attempted_at?: string
          board_slug?: string
          checked_at?: string
          content_type?: string | null
          created_at?: string
          fetched_at?: string
          logo_bytes?: string | null
          miss_count?: number
          provider?: string
          status?: string
        }
        Relationships: []
      }
      employers: {
        Row: {
          canonical_domain: string | null
          canonical_name: string
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          canonical_domain?: string | null
          canonical_name: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          canonical_domain?: string | null
          canonical_name?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      fact_sources: {
        Row: {
          candidate_id: string
          created_at: string
          document_version_id: string
          fact_version_id: string
          id: string
          source_locator: Json
          supporting_excerpt: string | null
          workspace_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          document_version_id: string
          fact_version_id: string
          id?: string
          source_locator: Json
          supporting_excerpt?: string | null
          workspace_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          document_version_id?: string
          fact_version_id?: string
          id?: string
          source_locator?: Json
          supporting_excerpt?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fact_sources_workspace_id_candidate_id_document_version_id_fkey"
            columns: ["workspace_id", "candidate_id", "document_version_id"]
            isOneToOne: false
            referencedRelation: "source_document_versions"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "fact_sources_workspace_id_candidate_id_fact_version_id_fkey"
            columns: ["workspace_id", "candidate_id", "fact_version_id"]
            isOneToOne: false
            referencedRelation: "candidate_fact_versions"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "fact_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      hosted_worker_lanes: {
        Row: {
          completed_runs: number
          failed_runs: number
          lane: string
          last_error_code: string | null
          last_finished_at: string | null
          last_started_at: string | null
          last_summary: Json
          lease_expires_at: string | null
          lease_token: string | null
          status: string
        }
        Insert: {
          completed_runs?: number
          failed_runs?: number
          lane: string
          last_error_code?: string | null
          last_finished_at?: string | null
          last_started_at?: string | null
          last_summary?: Json
          lease_expires_at?: string | null
          lease_token?: string | null
          status?: string
        }
        Update: {
          completed_runs?: number
          failed_runs?: number
          lane?: string
          last_error_code?: string | null
          last_finished_at?: string | null
          last_started_at?: string | null
          last_summary?: Json
          lease_expires_at?: string | null
          lease_token?: string | null
          status?: string
        }
        Relationships: []
      }
      ingestion_runs: {
        Row: {
          checkpoint: Json
          error_code: string | null
          finished_at: string | null
          id: string
          observed_count: number
          response_status: number | null
          snapshot_complete: boolean | null
          source_id: string
          started_at: string
          status: string
        }
        Insert: {
          checkpoint?: Json
          error_code?: string | null
          finished_at?: string | null
          id?: string
          observed_count?: number
          response_status?: number | null
          snapshot_complete?: boolean | null
          source_id: string
          started_at?: string
          status: string
        }
        Update: {
          checkpoint?: Json
          error_code?: string | null
          finished_at?: string | null
          id?: string
          observed_count?: number
          response_status?: number | null
          snapshot_complete?: boolean | null
          source_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_runs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "job_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      job_application_schema_versions: {
        Row: {
          adapter_release: string
          created_at: string
          id: string
          job_id: string
          job_version_id: string
          normalized_schema: Json
          observed_at: string
          provider: string
          provider_binding: Json
          schema_hash: string
        }
        Insert: {
          adapter_release: string
          created_at?: string
          id?: string
          job_id: string
          job_version_id: string
          normalized_schema: Json
          observed_at: string
          provider: string
          provider_binding: Json
          schema_hash: string
        }
        Update: {
          adapter_release?: string
          created_at?: string
          id?: string
          job_id?: string
          job_version_id?: string
          normalized_schema?: Json
          observed_at?: string
          provider?: string
          provider_binding?: Json
          schema_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_application_schema_versions_job_version_fkey"
            columns: ["job_id", "job_version_id"]
            isOneToOne: false
            referencedRelation: "job_versions"
            referencedColumns: ["job_id", "id"]
          },
        ]
      }
      job_intakes: {
        Row: {
          candidate_id: string
          canonical_url: string
          command_id: string
          created_at: string
          failure_code: string | null
          id: string
          resolved_job_id: string | null
          resolved_job_version_id: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          candidate_id: string
          canonical_url: string
          command_id: string
          created_at?: string
          failure_code?: string | null
          id?: string
          resolved_job_id?: string | null
          resolved_job_version_id?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          candidate_id?: string
          canonical_url?: string
          command_id?: string
          created_at?: string
          failure_code?: string | null
          id?: string
          resolved_job_id?: string | null
          resolved_job_version_id?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_intakes_resolved_job_id_resolved_job_version_id_fkey"
            columns: ["resolved_job_id", "resolved_job_version_id"]
            isOneToOne: false
            referencedRelation: "job_versions"
            referencedColumns: ["job_id", "id"]
          },
          {
            foreignKeyName: "job_intakes_workspace_id_candidate_id_fkey"
            columns: ["workspace_id", "candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "job_intakes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      job_sources: {
        Row: {
          adapter_release: string
          application_domain: string
          consecutive_failures: number
          created_at: string
          employer_id: string | null
          id: string
          last_error_code: string | null
          last_etag: string | null
          last_successful_poll_at: string | null
          list_url: string | null
          next_poll_at: string
          pending_closure_fingerprint: string | null
          pending_closure_observed_at: string | null
          policy_status: string
          poll_lease_expires_at: string | null
          poll_lease_owner: string | null
          polling_enabled: boolean
          provider: string
          source_options: Json
          tenant_key: string
          updated_at: string
        }
        Insert: {
          adapter_release: string
          application_domain: string
          consecutive_failures?: number
          created_at?: string
          employer_id?: string | null
          id?: string
          last_error_code?: string | null
          last_etag?: string | null
          last_successful_poll_at?: string | null
          list_url?: string | null
          next_poll_at?: string
          pending_closure_fingerprint?: string | null
          pending_closure_observed_at?: string | null
          policy_status?: string
          poll_lease_expires_at?: string | null
          poll_lease_owner?: string | null
          polling_enabled?: boolean
          provider: string
          source_options?: Json
          tenant_key: string
          updated_at?: string
        }
        Update: {
          adapter_release?: string
          application_domain?: string
          consecutive_failures?: number
          created_at?: string
          employer_id?: string | null
          id?: string
          last_error_code?: string | null
          last_etag?: string | null
          last_successful_poll_at?: string | null
          list_url?: string | null
          next_poll_at?: string
          pending_closure_fingerprint?: string | null
          pending_closure_observed_at?: string | null
          policy_status?: string
          poll_lease_expires_at?: string | null
          poll_lease_owner?: string | null
          polling_enabled?: boolean
          provider?: string
          source_options?: Json
          tenant_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_sources_employer_id_fkey"
            columns: ["employer_id"]
            isOneToOne: false
            referencedRelation: "employers"
            referencedColumns: ["id"]
          },
        ]
      }
      job_versions: {
        Row: {
          apply_url: string
          content_hash: string
          created_at: string
          description_text: string
          employer_name: string
          employment_type: string | null
          id: string
          job_id: string
          location_text: string | null
          normalized_data: Json
          observed_at: string
          published_at: string | null
          search_document: unknown
          title: string
          version_number: number
          work_mode: string | null
        }
        Insert: {
          apply_url: string
          content_hash: string
          created_at?: string
          description_text: string
          employer_name: string
          employment_type?: string | null
          id?: string
          job_id: string
          location_text?: string | null
          normalized_data?: Json
          observed_at: string
          published_at?: string | null
          search_document?: unknown
          title: string
          version_number: number
          work_mode?: string | null
        }
        Update: {
          apply_url?: string
          content_hash?: string
          created_at?: string
          description_text?: string
          employer_name?: string
          employment_type?: string | null
          id?: string
          job_id?: string
          location_text?: string | null
          normalized_data?: Json
          observed_at?: string
          published_at?: string | null
          search_document?: unknown
          title?: string
          version_number?: number
          work_mode?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_versions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          canonical_url: string
          closed_at: string | null
          created_at: string
          current_version_id: string | null
          employer_id: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          source_listing_id: string | null
          state: string
          updated_at: string
        }
        Insert: {
          canonical_url: string
          closed_at?: string | null
          created_at?: string
          current_version_id?: string | null
          employer_id?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          source_listing_id?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          canonical_url?: string
          closed_at?: string | null
          created_at?: string
          current_version_id?: string | null
          employer_id?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          source_listing_id?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_current_version_fkey"
            columns: ["id", "current_version_id"]
            isOneToOne: false
            referencedRelation: "job_versions"
            referencedColumns: ["job_id", "id"]
          },
          {
            foreignKeyName: "jobs_employer_id_fkey"
            columns: ["employer_id"]
            isOneToOne: false
            referencedRelation: "employers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_source_listing_id_fkey"
            columns: ["source_listing_id"]
            isOneToOne: true
            referencedRelation: "source_job_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      outbox: {
        Row: {
          attempt_count: number
          available_at: string
          created_at: string
          dead_letter_reason: string | null
          dead_lettered_at: string | null
          event_id: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          payload: Json
          published_at: string | null
          topic: string
          workspace_id: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          created_at?: string
          dead_letter_reason?: string | null
          dead_lettered_at?: string | null
          event_id: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          payload: Json
          published_at?: string | null
          topic: string
          workspace_id: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          created_at?: string
          dead_letter_reason?: string | null
          dead_lettered_at?: string | null
          event_id?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          payload?: Json
          published_at?: string | null
          topic?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbox_workspace_id_event_id_fkey"
            columns: ["workspace_id", "event_id"]
            isOneToOne: false
            referencedRelation: "domain_events"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "outbox_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      outbox_recovery_actions: {
        Row: {
          action: string
          created_at: string
          id: string
          operator_auth_user_id: string
          outbox_id: string
          previous_attempt_count: number
          previous_dead_letter_reason: string
          previous_dead_lettered_at: string
          reason: string
          workspace_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          operator_auth_user_id: string
          outbox_id: string
          previous_attempt_count: number
          previous_dead_letter_reason: string
          previous_dead_lettered_at: string
          reason: string
          workspace_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          operator_auth_user_id?: string
          outbox_id?: string
          previous_attempt_count?: number
          previous_dead_letter_reason?: string
          previous_dead_lettered_at?: string
          reason?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbox_recovery_actions_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbox_recovery_actions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbox_recovery_actions_workspace_id_outbox_id_fkey"
            columns: ["workspace_id", "outbox_id"]
            isOneToOne: false
            referencedRelation: "outbox"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      receipts: {
        Row: {
          application_id: string
          attempt_id: string
          confirmation_kind: string
          confirmation_reference: string
          confirmed_at: string
          created_at: string
          evidence_manifest: Json
          id: string
          receipt_hash: string
          workspace_id: string
        }
        Insert: {
          application_id: string
          attempt_id: string
          confirmation_kind: string
          confirmation_reference: string
          confirmed_at: string
          created_at?: string
          evidence_manifest: Json
          id?: string
          receipt_hash: string
          workspace_id: string
        }
        Update: {
          application_id?: string
          attempt_id?: string
          confirmation_kind?: string
          confirmation_reference?: string
          confirmed_at?: string
          created_at?: string
          evidence_manifest?: Json
          id?: string
          receipt_hash?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipts_workspace_id_attempt_id_application_id_fkey"
            columns: ["workspace_id", "attempt_id", "application_id"]
            isOneToOne: false
            referencedRelation: "application_attempts"
            referencedColumns: ["workspace_id", "id", "application_id"]
          },
          {
            foreignKeyName: "receipts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      source_document_extractions: {
        Row: {
          attempt_number: number
          candidate_id: string
          completed_at: string
          document_aggregate_version: number
          document_id: string
          document_version_id: string
          extracted_text: string | null
          extractor_kind: string
          extractor_release: string
          failure_code: string | null
          id: string
          language_code: string | null
          output_schema_version: string
          page_count: number | null
          resulting_document_status: string
          source_sha256: string
          started_at: string
          status: string
          text_sha256: string | null
          warnings: Json
          workspace_id: string
        }
        Insert: {
          attempt_number: number
          candidate_id: string
          completed_at?: string
          document_aggregate_version: number
          document_id: string
          document_version_id: string
          extracted_text?: string | null
          extractor_kind: string
          extractor_release: string
          failure_code?: string | null
          id?: string
          language_code?: string | null
          output_schema_version: string
          page_count?: number | null
          resulting_document_status: string
          source_sha256: string
          started_at: string
          status: string
          text_sha256?: string | null
          warnings?: Json
          workspace_id: string
        }
        Update: {
          attempt_number?: number
          candidate_id?: string
          completed_at?: string
          document_aggregate_version?: number
          document_id?: string
          document_version_id?: string
          extracted_text?: string | null
          extractor_kind?: string
          extractor_release?: string
          failure_code?: string | null
          id?: string
          language_code?: string | null
          output_schema_version?: string
          page_count?: number | null
          resulting_document_status?: string
          source_sha256?: string
          started_at?: string
          status?: string
          text_sha256?: string | null
          warnings?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_document_extractions_workspace_id_candidate_id_doc_fkey1"
            columns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "document_version_id",
            ]
            isOneToOne: false
            referencedRelation: "source_document_versions"
            referencedColumns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "id",
            ]
          },
          {
            foreignKeyName: "source_document_extractions_workspace_id_candidate_id_docu_fkey"
            columns: ["workspace_id", "candidate_id", "document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "source_document_extractions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      source_document_text_reviews: {
        Row: {
          candidate_id: string
          created_at: string
          created_by: string
          document_aggregate_version: number
          document_id: string
          document_version_id: string
          extraction_id: string
          id: string
          review_version_number: number
          reviewed_text: string
          text_sha256: string
          workspace_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          created_by: string
          document_aggregate_version: number
          document_id: string
          document_version_id: string
          extraction_id: string
          id?: string
          review_version_number: number
          reviewed_text: string
          text_sha256: string
          workspace_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          created_by?: string
          document_aggregate_version?: number
          document_id?: string
          document_version_id?: string
          extraction_id?: string
          id?: string
          review_version_number?: number
          reviewed_text?: string
          text_sha256?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_document_text_reviews_workspace_id_candidate_id_do_fkey1"
            columns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "document_version_id",
            ]
            isOneToOne: false
            referencedRelation: "source_document_versions"
            referencedColumns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "id",
            ]
          },
          {
            foreignKeyName: "source_document_text_reviews_workspace_id_candidate_id_doc_fkey"
            columns: ["workspace_id", "candidate_id", "document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "source_document_text_reviews_workspace_id_candidate_id_ext_fkey"
            columns: [
              "workspace_id",
              "candidate_id",
              "extraction_id",
              "document_id",
              "document_version_id",
            ]
            isOneToOne: false
            referencedRelation: "source_document_extractions"
            referencedColumns: [
              "workspace_id",
              "candidate_id",
              "id",
              "document_id",
              "document_version_id",
            ]
          },
          {
            foreignKeyName: "source_document_text_reviews_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      source_document_upload_reservations: {
        Row: {
          cancelled_at: string | null
          candidate_id: string
          display_name: string
          document_id: string
          document_version_id: string
          expected_byte_size: number
          expected_sha256: string | null
          expires_at: string
          finalized_at: string | null
          id: string
          mime_type: string
          reserved_at: string
          reserved_by: string
          status: string
          storage_bucket: string
          storage_object_path: string
          version_number: number
          workspace_id: string
        }
        Insert: {
          cancelled_at?: string | null
          candidate_id: string
          display_name: string
          document_id: string
          document_version_id: string
          expected_byte_size: number
          expected_sha256?: string | null
          expires_at: string
          finalized_at?: string | null
          id?: string
          mime_type: string
          reserved_at?: string
          reserved_by: string
          status?: string
          storage_bucket?: string
          storage_object_path: string
          version_number: number
          workspace_id: string
        }
        Update: {
          cancelled_at?: string | null
          candidate_id?: string
          display_name?: string
          document_id?: string
          document_version_id?: string
          expected_byte_size?: number
          expected_sha256?: string | null
          expires_at?: string
          finalized_at?: string | null
          id?: string
          mime_type?: string
          reserved_at?: string
          reserved_by?: string
          status?: string
          storage_bucket?: string
          storage_object_path?: string
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_document_upload_reserv_workspace_id_candidate_id_do_fkey"
            columns: ["workspace_id", "candidate_id", "document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "source_document_upload_reservations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      source_document_versions: {
        Row: {
          byte_size: number
          candidate_id: string
          created_at: string
          created_by: string
          document_id: string
          id: string
          mime_type: string
          parser_release: string | null
          scan_status: string
          sha256: string
          storage_bucket: string
          storage_object_path: string
          version_number: number
          workspace_id: string
        }
        Insert: {
          byte_size: number
          candidate_id: string
          created_at?: string
          created_by: string
          document_id: string
          id?: string
          mime_type: string
          parser_release?: string | null
          scan_status: string
          sha256: string
          storage_bucket: string
          storage_object_path: string
          version_number: number
          workspace_id: string
        }
        Update: {
          byte_size?: number
          candidate_id?: string
          created_at?: string
          created_by?: string
          document_id?: string
          id?: string
          mime_type?: string
          parser_release?: string | null
          scan_status?: string
          sha256?: string
          storage_bucket?: string
          storage_object_path?: string
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_document_versions_workspace_id_candidate_id_documen_fkey"
            columns: ["workspace_id", "candidate_id", "document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["workspace_id", "candidate_id", "id"]
          },
          {
            foreignKeyName: "source_document_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      source_documents: {
        Row: {
          aggregate_version: number
          candidate_id: string
          created_at: string
          current_version_number: number | null
          display_name: string
          document_kind: string
          id: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          aggregate_version?: number
          candidate_id: string
          created_at?: string
          current_version_number?: number | null
          display_name: string
          document_kind: string
          id?: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          aggregate_version?: number
          candidate_id?: string
          created_at?: string
          current_version_number?: number | null
          display_name?: string
          document_kind?: string
          id?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_documents_workspace_id_candidate_id_fkey"
            columns: ["workspace_id", "candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "source_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      source_evidence_passages: {
        Row: {
          candidate_id: string
          created_at: string
          document_id: string
          document_version_id: string
          end_offset: number
          evidence_category: string
          excerpt: string
          excerpt_sha256: string
          id: string
          ordinal: number
          segmenter_release: string
          stable_key: string
          start_offset: number
          text_review_id: string
          workspace_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          document_id: string
          document_version_id: string
          end_offset: number
          evidence_category: string
          excerpt: string
          excerpt_sha256: string
          id?: string
          ordinal: number
          segmenter_release: string
          stable_key: string
          start_offset: number
          text_review_id: string
          workspace_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          document_id?: string
          document_version_id?: string
          end_offset?: number
          evidence_category?: string
          excerpt?: string
          excerpt_sha256?: string
          id?: string
          ordinal?: number
          segmenter_release?: string
          stable_key?: string
          start_offset?: number
          text_review_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_evidence_passages_workspace_id_candidate_id_documen_fkey"
            columns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "document_version_id",
              "text_review_id",
            ]
            isOneToOne: false
            referencedRelation: "source_document_text_reviews"
            referencedColumns: [
              "workspace_id",
              "candidate_id",
              "document_id",
              "document_version_id",
              "id",
            ]
          },
          {
            foreignKeyName: "source_evidence_passages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      source_job_listings: {
        Row: {
          apply_url: string
          closed_at: string | null
          created_at: string
          external_job_id: string
          first_seen_at: string
          id: string
          last_seen_at: string
          source_id: string
          source_url: string
          state: string
          updated_at: string
        }
        Insert: {
          apply_url: string
          closed_at?: string | null
          created_at?: string
          external_job_id: string
          first_seen_at: string
          id?: string
          last_seen_at: string
          source_id: string
          source_url: string
          state?: string
          updated_at?: string
        }
        Update: {
          apply_url?: string
          closed_at?: string | null
          created_at?: string
          external_job_id?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          source_id?: string
          source_url?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_job_listings_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "job_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      source_job_observations: {
        Row: {
          created_at: string
          external_job_id: string
          id: string
          ingestion_run_id: string
          observed_at: string
          parser_release: string
          payload_hash: string
          raw_payload_ref: string | null
          response_headers: Json
          source_id: string
        }
        Insert: {
          created_at?: string
          external_job_id: string
          id?: string
          ingestion_run_id: string
          observed_at: string
          parser_release: string
          payload_hash: string
          raw_payload_ref?: string | null
          response_headers?: Json
          source_id: string
        }
        Update: {
          created_at?: string
          external_job_id?: string
          id?: string
          ingestion_run_id?: string
          observed_at?: string
          parser_release?: string
          payload_hash?: string
          raw_payload_ref?: string | null
          response_headers?: Json
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_job_observations_ingestion_run_id_fkey"
            columns: ["ingestion_run_id"]
            isOneToOne: false
            referencedRelation: "ingestion_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_job_observations_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "job_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_memberships: {
        Row: {
          auth_user_id: string
          created_at: string
          role: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          role: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          role?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_memberships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          aggregate_version: number
          created_at: string
          id: string
          kind: string
          name: string
          personal_owner_auth_user_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          aggregate_version?: number
          created_at?: string
          id?: string
          kind?: string
          name: string
          personal_owner_auth_user_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          aggregate_version?: number
          created_at?: string
          id?: string
          kind?: string
          name?: string
          personal_owner_auth_user_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ack_outbox_message: {
        Args: { p_outbox_id: string; p_worker_id: string }
        Returns: boolean
      }
      ack_terminal_pasted_link_intake: {
        Args: { p_expected_application_id: string; p_job_intake_id: string }
        Returns: boolean
      }
      acknowledge_application_autopilot_cleanup: {
        Args: { p_resource_id: string }
        Returns: undefined
      }
      activate_leased_computer_session: {
        Args: {
          p_adapter_release: string
          p_computer_session_id: string
          p_provider_adapter: string
          p_provider_context_ref: string
          p_provider_session_ref: string
          p_worker_id: string
        }
        Returns: {
          computer_session_id: string
          fill_attempt_id: string
          replayed: boolean
        }[]
      }
      advance_auto_apply_candidate: {
        Args: { p_candidate: string; p_token: string; p_version: number }
        Returns: Json
      }
      append_candidate_interview_exchange: {
        Args: {
          p_candidate_message: string
          p_command_id: string
          p_complete?: boolean
          p_expected_turn_count: number
          p_interviewer_reply: string
          p_session_id: string
          p_state: Json
        }
        Returns: {
          replayed: boolean
          status: string
          turn_count: number
        }[]
      }
      approve_reviewed_resume_evidence: {
        Args: { p_command_id: string; p_text_review_id: string }
        Returns: {
          approved_count: number
          carried_count: number
          replayed: boolean
        }[]
      }
      archive_candidate_story: {
        Args: {
          p_command_id: string
          p_expected_aggregate_version: number
          p_story_id: string
        }
        Returns: {
          aggregate_version: number
          replayed: boolean
        }[]
      }
      assert_application_autopilot_lease: {
        Args: { p_id: string; p_lease_token: string; p_mutating?: boolean }
        Returns: undefined
      }
      authorize_application_fill_once: {
        Args: {
          p_application_id: string
          p_command_id: string
          p_expected_aggregate_version: number
          p_expected_packet_hash: string
          p_expected_revision_id: string
        }
        Returns: {
          aggregate_version: number
          application_id: string
          browser_run_id: string
          fill_attempt_id: string
          replayed: boolean
          revision_id: string
        }[]
      }
      begin_application_agent_tool_call: {
        Args: {
          p_arguments_hash: string
          p_call_id: string
          p_run_id: string
          p_session_id: string
          p_tool_name: string
          p_turn_id: string
        }
        Returns: Json
      }
      begin_application_autopilot_submit: {
        Args: {
          p_adapter_release: string
          p_id: string
          p_lease_token: string
          p_request_fingerprint: string
          p_seal_hash: string
        }
        Returns: Json
      }
      begin_application_autopilot_tool: {
        Args: {
          p_arguments_hash: string
          p_call_id: string
          p_id: string
          p_lease_token: string
          p_session_id: string
          p_tool_name: string
          p_turn_id: string
        }
        Returns: Json
      }
      bind_application_agent_session: {
        Args: { p_provider_session_id: string; p_run_id: string }
        Returns: undefined
      }
      bind_application_autopilot_resource: {
        Args: {
          p_id: string
          p_kind: string
          p_lease_token: string
          p_reference: string
        }
        Returns: undefined
      }
      bootstrap_personal_workspace: {
        Args: { p_display_name?: string }
        Returns: {
          candidate_id: string
          replayed: boolean
          workspace_id: string
        }[]
      }
      cancel_application_send: {
        Args: { p_application_id: string }
        Returns: boolean
      }
      cancel_resume_upload_reservation: {
        Args: { p_document_version_id: string }
        Returns: {
          cancelled: boolean
          document_id: string
          document_version_id: string
          storage_bucket: string
          storage_object_path: string
        }[]
      }
      catalog_refresh_stats: { Args: never; Returns: Json }
      checkpoint_application_autopilot: {
        Args: {
          p_data: Json
          p_id: string
          p_lease_token: string
          p_stage: string
        }
        Returns: undefined
      }
      claim_application_agent_cleanup: {
        Args: { p_limit?: number }
        Returns: {
          failure_code: string
          id: string
          provider_session_id: string
          status: string
        }[]
      }
      claim_application_autopilot:
        | {
            Args: { p_lease_seconds?: number; p_worker_id: string }
            Returns: Json
          }
        | {
            Args: {
              p_lease_seconds: number
              p_target_id: string
              p_worker_id: string
            }
            Returns: Json
          }
      claim_application_autopilot_cleanup: {
        Args: { p_limit?: number }
        Returns: unknown[]
        SetofOptions: {
          from: "*"
          to: "application_autopilot_resources"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_application_preparation: {
        Args: {
          p_application_id: string
          p_lease_seconds?: number
          p_preparation_run_id: string
          p_worker_id: string
        }
        Returns: {
          aggregate_version: number
          application_id: string
          candidate_id: string
          candidate_input_version: number
          input_snapshot_id: string
          job_id: string
          job_version_id: string
          preparation_run_id: string
          replayed: boolean
          snapshot_readiness: string
          submission_mode: string
          tailoring_mode: string
          workspace_id: string
        }[]
      }
      claim_auto_apply_candidate: {
        Args: { p_candidate_id?: string; p_worker_id: string }
        Returns: Json
      }
      claim_due_job_source: {
        Args: { p_lease_seconds?: number; p_worker_id: string }
        Returns: {
          adapter_release: string
          etag: string
          ingestion_run_id: string
          provider: string
          source_id: string
          source_options: Json
          tenant_key: string
        }[]
      }
      claim_hosted_worker_lane: {
        Args: { p_lane: string; p_lease_seconds?: number }
        Returns: string
      }
      claim_outbox_batch: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_topics?: string[]
          p_worker_id: string
        }
        Returns: {
          attempt_count: number
          event_id: string
          lease_expires_at: string
          outbox_id: string
          payload: Json
          topic: string
          workspace_id: string
        }[]
      }
      claim_stale_application_fill_attempt: {
        Args: { p_lease_seconds?: number; p_worker_id: string }
        Returns: {
          computer_session_id: string
          fill_attempt_id: string
          outbox_attempt_count: number
          outbox_id: string
          outbox_payload: Json
          outbox_topic: string
          recovery_mode: string
        }[]
      }
      commit_application_input_snapshot: {
        Args: {
          p_application_id: string
          p_assembler_release: string
          p_blockers: Json
          p_evidence_version_ids?: string[]
          p_expected_aggregate_version: number
          p_expected_candidate_input_version: number
          p_fact_version_ids?: string[]
          p_policy_release: string
          p_preparation_run_id: string
          p_readiness: string
          p_snapshot_hash: string
          p_snapshot_manifest: Json
          p_source_document_id: string
          p_source_document_version_id: string
          p_source_text_review_id: string
          p_worker_id: string
        }
        Returns: {
          aggregate_version: number
          input_snapshot_id: string
          readiness: string
          replayed: boolean
        }[]
      }
      commit_application_kit: {
        Args: {
          p_application_id: string
          p_artifacts: Json
          p_evidence_refs: Json
          p_fact_version_ids: string[]
          p_freshness_expires_at: string
          p_freshness_policy_release: string
          p_input_snapshot_hash: string
          p_input_snapshot_id: string
          p_material_diff: Json
          p_outbox_id: string
          p_packet_hash: string
          p_preparation_run_id: string
          p_research_hash: string
          p_research_manifest: Json
          p_researcher_release: string
          p_revision_manifest: Json
          p_worker_id: string
        }
        Returns: {
          aggregate_version: number
          artifact_ids: Json
          replayed: boolean
          research_bundle_id: string
          revision_id: string
        }[]
      }
      commit_job_source_snapshot: {
        Args: {
          p_endpoint: string
          p_etag: string
          p_ingestion_run_id: string
          p_raw_bytes: number
          p_raw_sha256: string
          p_response_status?: number
          p_snapshot: Json
          p_source_id: string
          p_worker_id: string
        }
        Returns: boolean
      }
      complete_application_agent_tool_call: {
        Args: {
          p_arguments_hash: string
          p_call_id: string
          p_result: Json
          p_run_id: string
          p_session_id: string
          p_tool_name: string
          p_turn_id: string
        }
        Returns: undefined
      }
      complete_application_autopilot_tool: {
        Args: {
          p_arguments_hash: string
          p_call_id: string
          p_id: string
          p_lease_token: string
          p_result: Json
          p_session_id: string
          p_tool_name: string
          p_turn_id: string
        }
        Returns: undefined
      }
      complete_application_fill_resume: {
        Args: {
          p_checkpoint_hash: string
          p_outbox_id: string
          p_redacted_summary: Json
          p_resume_attempt_id: string
          p_terminal_status: string
          p_worker_id: string
        }
        Returns: {
          application_id: string
          application_status: string
          fill_attempt_status: string
          replayed: boolean
        }[]
      }
      complete_candidate_onboarding: {
        Args: { p_command_id: string }
        Returns: {
          aggregate_version: number
          candidate_status: string
          replayed: boolean
        }[]
      }
      complete_leased_application_fill_attempt: {
        Args: {
          p_checkpoint_hash: string
          p_fill_attempt_id: string
          p_redacted_summary: Json
          p_runtime_destroyed: boolean
          p_terminal_status: string
          p_usage_summary: Json
          p_worker_id: string
        }
        Returns: {
          application_id: string
          application_status: string
          computer_session_id: string
          replayed: boolean
        }[]
      }
      complete_source_document_deletion: {
        Args: { p_document_id: string }
        Returns: boolean
      }
      control_application_autopilot: {
        Args: {
          p_action: string
          p_command_id: string
          p_expected_version: number
          p_id: string
        }
        Returns: Json
      }
      dead_letter_outbox_message: {
        Args: { p_error_code: string; p_outbox_id: string; p_worker_id: string }
        Returns: boolean
      }
      delegate_application_autopilot: {
        Args: {
          p_application_id: string
          p_command_id: string
          p_expected_aggregate_version: number
          p_packet_hash: string
          p_revision_id: string
        }
        Returns: Json
      }
      delegate_ready_send_intents: {
        Args: { p_application_id?: string; p_limit?: number }
        Returns: Json
      }
      delete_candidate_mailbox_connection: {
        Args: { p_candidate_id: string }
        Returns: Json
      }
      delete_candidate_standing_answer: {
        Args: { p_id: string }
        Returns: boolean
      }
      enqueue_auto_apply_match: {
        Args: {
          p_candidate: string
          p_decision: Json
          p_job: string
          p_job_version: string
          p_policy: string
          p_profile_hash: string
          p_token: string
          p_version: number
        }
        Returns: Json
      }
      enqueue_catalog_job_application: {
        Args: {
          p_command_id: string
          p_job_id: string
          p_job_version_id: string
        }
        Returns: {
          aggregate_version: number
          application_id: string
          replayed: boolean
        }[]
      }
      enqueue_pasted_link_application: {
        Args: { p_canonical_url: string; p_command_id: string }
        Returns: {
          aggregate_version: number
          application_id: string
          job_intake_id: string
          replayed: boolean
        }[]
      }
      expire_application_agent_runs: {
        Args: { p_limit?: number }
        Returns: number
      }
      extend_application_autopilot_lease: {
        Args: { p_id: string; p_lease_token: string; p_seconds: number }
        Returns: string
      }
      fail_application_drafting_terminal: {
        Args: {
          p_application_id: string
          p_attempt_history: Json
          p_error_code: string
          p_input_snapshot_id: string
          p_outbox_id: string
          p_preparation_run_id: string
          p_worker_id: string
        }
        Returns: boolean
      }
      fail_candidate_career_profile_extraction: {
        Args: {
          p_candidate_id: string
          p_error_code: string
          p_workspace_id: string
        }
        Returns: boolean
      }
      fail_job_source_poll: {
        Args: {
          p_endpoint?: string
          p_error_code: string
          p_ingestion_run_id: string
          p_response_status?: number
          p_retryable: boolean
          p_source_id: string
          p_worker_id: string
        }
        Returns: boolean
      }
      fail_outbox_message: {
        Args: {
          p_error_code: string
          p_outbox_id: string
          p_retry_after_seconds: number
          p_worker_id: string
        }
        Returns: boolean
      }
      fail_pasted_link_intake: {
        Args: {
          p_expected_application_id: string
          p_expected_intake_updated_at: string
          p_failure_code: string
          p_job_intake_id: string
        }
        Returns: {
          aggregate_version: number
          application_id: string
          replayed: boolean
        }[]
      }
      finalize_resume_upload: {
        Args: {
          p_actor_id: string
          p_byte_size: number
          p_command_id: string
          p_document_version_id: string
          p_sha256: string
        }
        Returns: {
          document_id: string
          document_status: string
          document_version_id: string
          replayed: boolean
          scan_status: string
        }[]
      }
      finish_application_agent_run: {
        Args: {
          p_failure_code: string
          p_provider_deleted: boolean
          p_run_id: string
          p_status: string
        }
        Returns: undefined
      }
      finish_application_autopilot: {
        Args: {
          p_failure_code?: string
          p_id: string
          p_lease_token: string
          p_outcome: string
          p_receipt?: Json
        }
        Returns: undefined
      }
      finish_auto_apply_check: {
        Args: { p_candidate: string; p_outcome: string; p_token: string }
        Returns: boolean
      }
      finish_hosted_worker_lane: {
        Args: {
          p_error_code?: string
          p_lane: string
          p_lease_token: string
          p_summary: Json
        }
        Returns: boolean
      }
      get_active_computer_session_provider_binding: {
        Args: { p_computer_session_id: string }
        Returns: {
          provider_adapter: string
          provider_session_ref: string
        }[]
      }
      get_candidate_mailbox_connection: {
        Args: { p_candidate_id: string }
        Returns: Json
      }
      get_candidate_onboarding_readiness: {
        Args: never
        Returns: {
          candidate_status: string
          missing_items: string[]
        }[]
      }
      hosted_worker_due_lanes: { Args: never; Returns: Json }
      ingest_resume_evidence_proposals: {
        Args: {
          p_command_id: string
          p_passages: Json
          p_segmenter_release: string
          p_text_review_id: string
        }
        Returns: {
          proposal_count: number
          replayed: boolean
          total_count: number
        }[]
      }
      list_dead_lettered_outbox: {
        Args: { p_before?: string; p_limit?: number }
        Returns: {
          attempt_count: number
          available_at: string
          created_at: string
          dead_letter_reason: string
          dead_lettered_at: string
          event_id: string
          last_error: string
          outbox_id: string
          payload: Json
          topic: string
          workspace_id: string
        }[]
      }
      list_expired_resume_upload_reservations: {
        Args: { p_limit?: number }
        Returns: {
          document_version_id: string
          storage_bucket: string
          storage_object_path: string
        }[]
      }
      mark_stale_catalog_jobs: { Args: never; Returns: number }
      matching_catalog_index_json: {
        Args: { p_after_job_id?: string; p_limit?: number }
        Returns: Json
      }
      matching_catalog_index_page: {
        Args: { p_after_job_id?: string; p_limit?: number }
        Returns: {
          apply_url: string
          canonical_url: string
          content_hash: string
          employer_name: string
          employment_type: string
          job_id: string
          job_version_id: string
          location_text: string
          observed_at: string
          published_at: string
          source_provider: string
          title: string
          version_number: number
          work_mode: string
        }[]
      }
      matching_catalog_jobs: {
        Args: { p_job_ids: string[] }
        Returns: {
          apply_url: string
          canonical_url: string
          content_hash: string
          description_text: string
          employer_name: string
          employment_type: string
          job_id: string
          job_version_id: string
          location_text: string
          observed_at: string
          published_at: string
          queued_application_id: string
          saved: boolean
          source_provider: string
          title: string
          version_number: number
          work_mode: string
        }[]
      }
      matching_catalog_page: {
        Args: { p_after_job_id?: string; p_limit?: number }
        Returns: {
          apply_url: string
          canonical_url: string
          content_hash: string
          description_text: string
          employer_name: string
          employment_type: string
          job_id: string
          job_version_id: string
          location_text: string
          observed_at: string
          published_at: string
          queued_application_id: string
          saved: boolean
          source_provider: string
          title: string
          version_number: number
          work_mode: string
        }[]
      }
      prefill_application_autopilot_answers: {
        Args: { p_id: string; p_lease_token: string; p_questions: Json }
        Returns: Json
      }
      provide_application_autopilot_verification_code: {
        Args: {
          p_code: string
          p_command_id: string
          p_id: string
          p_verification_id: string
        }
        Returns: Json
      }
      provide_application_autopilot_verification_from_mailbox: {
        Args: {
          p_code: string
          p_id: string
          p_lease_token: string
          p_verification_id: string
        }
        Returns: undefined
      }
      read_application_autopilot_answers: {
        Args: { p_id: string; p_lease_token: string }
        Returns: Json
      }
      read_application_autopilot_verification: {
        Args: { p_id: string; p_lease_token: string }
        Returns: Json
      }
      read_auto_apply_state: { Args: never; Returns: Json }
      read_autopilot_mailbox_connection: {
        Args: { p_id: string; p_lease_token: string }
        Returns: Json
      }
      read_candidate_standing_answers: {
        Args: { p_id: string; p_lease_token: string }
        Returns: Json
      }
      reconcile_application_fill_runtime_release: {
        Args: {
          p_computer_session_id: string
          p_error_code: string
          p_fill_attempt_id: string
          p_release_outcome: string
          p_release_reason: string
          p_supervisor_release: string
          p_usage_summary: Json
        }
        Returns: {
          application_id: string
          application_status: string
          computer_session_state: string
          replayed: boolean
        }[]
      }
      record_application_autopilot_standing_answers: {
        Args: { p_answers: Json; p_id: string; p_lease_token: string }
        Returns: Json
      }
      record_autopilot_mailbox_use: {
        Args: { p_error?: string; p_id: string; p_lease_token: string }
        Returns: undefined
      }
      record_candidate_career_profile_extraction: {
        Args: {
          p_candidate_id: string
          p_content: Json
          p_content_sha256: string
          p_correlation_id: string
          p_producer_release: string
          p_text_review_id: string
          p_workspace_id: string
        }
        Returns: {
          profile_version_id: string
          recorded: boolean
        }[]
      }
      record_employer_logo_check: {
        Args: {
          p_board_slug: string
          p_content_type?: string
          p_logo_bytes?: string
          p_outcome: string
          p_provider: string
        }
        Returns: string
      }
      record_resume_extraction: {
        Args: {
          p_attempt_number: number
          p_document_version_id: string
          p_extracted_text: string
          p_extractor_kind: string
          p_extractor_release: string
          p_failure_code: string
          p_language_code: string
          p_output_schema_version: string
          p_page_count: number
          p_source_sha256: string
          p_started_at: string
          p_status: string
          p_text_sha256: string
          p_warnings: Json
        }
        Returns: {
          aggregate_version: number
          document_id: string
          document_status: string
          document_version_id: string
          extraction_id: string
          replayed: boolean
        }[]
      }
      record_worker_event: {
        Args: {
          p_application_id?: string
          p_autopilot_id?: string
          p_code?: string
          p_detail?: Json
          p_duration_ms?: number
          p_lane: string
          p_outcome: string
          p_stage: string
        }
        Returns: undefined
      }
      refresh_stale_application_packet: {
        Args: {
          p_application_id: string
          p_command_id: string
          p_expected_aggregate_version: number
        }
        Returns: {
          aggregate_version: number
          application_id: string
          preparation_run_id: string
          replayed: boolean
        }[]
      }
      register_reviewed_job_sources: {
        Args: { p_registry_release: string; p_sources: Json }
        Returns: Json
      }
      reject_direct_resume_upload: {
        Args: {
          p_actor_id: string
          p_document_version_id: string
          p_expected_sha256: string
        }
        Returns: boolean
      }
      request_application_agent_questions: {
        Args: {
          p_application_id: string
          p_candidate_id: string
          p_computer_session_id: string
          p_fill_attempt_id: string
          p_questions: Json
          p_revision_id: string
          p_workspace_id: string
        }
        Returns: {
          application_id: string
          candidate_id: string
          computer_session_id: string
          control_type: string
          created_at: string
          field_fingerprint: string
          field_id: string
          fill_attempt_id: string
          id: string
          label: string
          options: Json
          reason_code: string
          required: boolean
          revision_id: string
          status: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "application_agent_questions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      request_application_autopilot_questions: {
        Args: { p_id: string; p_lease_token: string; p_questions: Json }
        Returns: undefined
      }
      request_application_autopilot_verification: {
        Args: {
          p_id: string
          p_lease_token: string
          p_recipient_hint: string
          p_retry_reason?: string
        }
        Returns: string
      }
      request_application_fill_resume: {
        Args: {
          p_application_id: string
          p_candidate_completed_required_fields: boolean
          p_command_id: string
          p_computer_session_id: string
          p_expected_aggregate_version: number
          p_fill_attempt_id: string
        }
        Returns: {
          aggregate_version: number
          application_id: string
          computer_session_id: string
          fill_attempt_id: string
          replayed: boolean
          resume_attempt_id: string
        }[]
      }
      request_application_send: {
        Args: { p_application_id: string; p_command_id: string }
        Returns: {
          application_id: string
          intent_open: boolean
          replayed: boolean
        }[]
      }
      request_candidate_career_profile: {
        Args: { p_command_id: string }
        Returns: {
          replayed: boolean
          requested: boolean
        }[]
      }
      request_source_document_deletion: {
        Args: {
          p_command_id: string
          p_document_id: string
          p_expected_aggregate_version: number
        }
        Returns: {
          aggregate_version: number
          document_id: string
          document_status: string
          replayed: boolean
        }[]
      }
      requeue_dead_lettered_outbox: {
        Args: {
          p_expected_dead_lettered_at: string
          p_outbox_id: string
          p_reason: string
        }
        Returns: {
          outbox_id: string
          recovery_action_id: string
          requeued_at: string
        }[]
      }
      reserve_direct_resume_upload: {
        Args: {
          p_byte_size: number
          p_command_id: string
          p_display_name: string
          p_mime_type: string
          p_sha256: string
        }
        Returns: Json
      }
      reserve_resume_upload: {
        Args: {
          p_byte_size: number
          p_command_id: string
          p_display_name: string
          p_mime_type: string
        }
        Returns: {
          document_id: string
          document_version_id: string
          replayed: boolean
          storage_bucket: string
          storage_object_path: string
          version_number: number
        }[]
      }
      resolve_pasted_link_intake: {
        Args: {
          p_expected_application_id: string
          p_expected_intake_updated_at: string
          p_job_id: string
          p_job_intake_id: string
          p_job_version_id: string
        }
        Returns: {
          aggregate_version: number
          application_id: string
          replayed: boolean
        }[]
      }
      retry_application_preparation: {
        Args: {
          p_application_id: string
          p_command_id: string
          p_expected_aggregate_version: number
        }
        Returns: {
          aggregate_version: number
          application_id: string
          preparation_run_id: string
          replayed: boolean
        }[]
      }
      retry_pasted_link_intake: {
        Args: { p_application_id: string; p_command_id: string }
        Returns: {
          aggregate_version: number
          application_id: string
          replayed: boolean
        }[]
      }
      review_candidate_evidence_item: {
        Args: {
          p_candidate_attested?: boolean
          p_claim_text: string
          p_command_id: string
          p_disposition: string
          p_evidence_item_id: string
          p_expected_aggregate_version: number
          p_usage_policy: string
        }
        Returns: {
          aggregate_version: number
          evidence_item_id: string
          evidence_version_id: string
          evidence_version_number: number
          replayed: boolean
        }[]
      }
      review_resume_text: {
        Args: {
          p_command_id: string
          p_document_id: string
          p_expected_aggregate_version: number
          p_extraction_id: string
          p_reviewed_text: string
          p_text_sha256: string
        }
        Returns: {
          aggregate_version: number
          document_id: string
          document_status: string
          document_version_id: string
          extraction_id: string
          replayed: boolean
          review_id: string
          review_version_number: number
        }[]
      }
      save_application_agent_answers_and_resume: {
        Args: {
          p_answers: Json
          p_application_id: string
          p_command_id: string
          p_computer_session_id: string
          p_expected_aggregate_version: number
          p_fill_attempt_id: string
          p_revision_id: string
        }
        Returns: {
          aggregate_version: number
          application_id: string
          replayed: boolean
          resume_attempt_id: string
        }[]
      }
      save_application_autopilot_answers: {
        Args: {
          p_answers: Json
          p_command_id: string
          p_expected_version: number
          p_id: string
        }
        Returns: Json
      }
      save_candidate_answer_fact: {
        Args: {
          p_command_id: string
          p_expected_aggregate_version?: number
          p_fact_key: string
          p_normalized_text: string
          p_value_json: Json
        }
        Returns: {
          aggregate_version: number
          fact_id: string
          fact_version_id: string
          fact_version_number: number
          replayed: boolean
        }[]
      }
      save_candidate_fact: {
        Args: {
          p_command_id: string
          p_expected_aggregate_version?: number
          p_fact_key: string
          p_normalized_text: string
          p_value_json: Json
        }
        Returns: {
          aggregate_version: number
          fact_id: string
          fact_version_id: string
          fact_version_number: number
          replayed: boolean
        }[]
      }
      save_candidate_identity_name_fact: {
        Args: {
          p_command_id: string
          p_expected_aggregate_version?: number
          p_fact_key: string
          p_normalized_text: string
          p_value_json: Json
        }
        Returns: {
          aggregate_version: number
          fact_id: string
          fact_version_id: string
          fact_version_number: number
          replayed: boolean
        }[]
      }
      save_candidate_mailbox_connection: {
        Args: {
          p_candidate_id: string
          p_email: string
          p_encrypted_token: string
          p_key_id: string
          p_provider: string
          p_scopes: string[]
        }
        Returns: Json
      }
      save_candidate_profile_document: {
        Args: {
          p_command_id: string
          p_content: Json
          p_content_sha256: string
          p_expected_aggregate_version?: number
          p_kind: string
        }
        Returns: {
          aggregate_version: number
          profile_version_id: string
          replayed: boolean
          version_number: number
        }[]
      }
      save_candidate_search_profile: {
        Args: {
          p_command_id: string
          p_desired_country_codes: string[]
          p_employment_types: string[]
          p_expected_aggregate_version?: number
          p_preferred_locations: string[]
          p_target_roles: string[]
          p_work_modes: string[]
        }
        Returns: {
          aggregate_version: number
          replayed: boolean
        }[]
      }
      save_candidate_standing_answer: {
        Args: { p_answer: string; p_topic: string }
        Returns: string
      }
      save_candidate_story: {
        Args: {
          p_command_id: string
          p_disposition: string
          p_expected_aggregate_version: number
          p_interview_session_id?: string
          p_source_kind?: string
          p_story: Json
          p_story_id: string
          p_usage_policy: string
        }
        Returns: {
          aggregate_version: number
          replayed: boolean
          story_id: string
          story_version_id: string
          version_number: number
        }[]
      }
      seal_application_autopilot: {
        Args: {
          p_destination_url: string
          p_diff: Json
          p_id: string
          p_lease_token: string
          p_readback_hash: string
          p_request_fingerprint: string
        }
        Returns: string
      }
      search_catalog_jobs: {
        Args: {
          p_cursor_job_id?: string
          p_cursor_observed_at?: string
          p_employment_type?: string
          p_limit?: number
          p_location?: string
          p_query?: string
          p_saved_only?: boolean
          p_work_mode?: string
        }
        Returns: {
          apply_url: string
          canonical_url: string
          description_text: string
          employer_name: string
          employment_type: string
          job_id: string
          job_version_id: string
          location_text: string
          observed_at: string
          published_at: string
          queued_application_id: string
          saved: boolean
          source_provider: string
          title: string
          work_mode: string
        }[]
      }
      search_catalog_jobs_ranked: {
        Args: {
          p_cursor_job_id?: string
          p_cursor_observed_at?: string
          p_cursor_tier?: number
          p_employment_type?: string
          p_limit?: number
          p_location?: string
          p_query?: string
          p_saved_only?: boolean
          p_work_mode?: string
        }
        Returns: {
          apply_url: string
          canonical_url: string
          description_text: string
          employer_name: string
          employment_type: string
          job_id: string
          job_version_id: string
          location_text: string
          match_tier: number
          observed_at: string
          published_at: string
          queued_application_id: string
          saved: boolean
          source_provider: string
          title: string
          work_mode: string
        }[]
      }
      set_auto_apply_enabled: {
        Args: {
          p_command_id: string
          p_enabled: boolean
          p_expected_version: number
        }
        Returns: Json
      }
      set_catalog_job_saved: {
        Args: {
          p_command_id: string
          p_job_id: string
          p_job_version_id: string
          p_saved: boolean
        }
        Returns: {
          replayed: boolean
          saved: boolean
        }[]
      }
      settle_application_autopilot_verification: {
        Args: {
          p_id: string
          p_lease_token: string
          p_outcome: string
          p_verification_id: string
        }
        Returns: undefined
      }
      start_application_agent_run: {
        Args: {
          p_application_id: string
          p_candidate_id: string
          p_computer_session_id: string
          p_driver_release: string
          p_fill_attempt_id: string
          p_model: string
          p_revision_id: string
          p_workspace_id: string
        }
        Returns: string
      }
      start_application_fill_attempt: {
        Args: {
          p_allowed_domain_policy: Json
          p_broker_release: string
          p_browser_profile_ref?: string
          p_execution_mode: string
          p_fill_attempt_id: string
          p_outbox_id: string
          p_ttl_seconds?: number
          p_worker_id: string
        }
        Returns: {
          application_id: string
          browser_profile_ref: string
          computer_session_id: string
          execution_mode: string
          replayed: boolean
          revision_id: string
          session_ttl_seconds: number
        }[]
      }
      start_candidate_interview: {
        Args: {
          p_command_id: string
          p_interviewer_release: string
          p_opening: string
          p_state?: Json
        }
        Returns: {
          replayed: boolean
          session_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
