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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      application_attempts: {
        Row: {
          adapter_release: string
          application_id: string
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
          job_version_id: string | null
          material_diff: Json
          packet_hash: string
          packet_manifest: Json
          validation_status: string
          version_number: number
          workspace_id: string
        }
        Insert: {
          application_id: string
          created_at?: string
          id?: string
          job_version_id?: string | null
          material_diff: Json
          packet_hash: string
          packet_manifest: Json
          validation_status: string
          version_number: number
          workspace_id: string
        }
        Update: {
          application_id?: string
          created_at?: string
          id?: string
          job_version_id?: string | null
          material_diff?: Json
          packet_hash?: string
          packet_manifest?: Json
          validation_status?: string
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
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
          created_at: string
          error_code: string | null
          external_workflow_ref: string | null
          finished_at: string | null
          id: string
          input_revision_id: string | null
          last_heartbeat_at: string | null
          run_kind: string
          started_at: string | null
          status: string
          workflow_provider: string | null
          workspace_id: string
        }
        Insert: {
          application_id: string
          created_at?: string
          error_code?: string | null
          external_workflow_ref?: string | null
          finished_at?: string | null
          id?: string
          input_revision_id?: string | null
          last_heartbeat_at?: string | null
          run_kind: string
          started_at?: string | null
          status?: string
          workflow_provider?: string | null
          workspace_id: string
        }
        Update: {
          application_id?: string
          created_at?: string
          error_code?: string | null
          external_workflow_ref?: string | null
          finished_at?: string | null
          id?: string
          input_revision_id?: string | null
          last_heartbeat_at?: string | null
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
      applications: {
        Row: {
          aggregate_version: number
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
          revision_id?: string
          workspace_id?: string
        }
        Relationships: [
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
          id: string
          kind: string
          mime_type: string
          qa_status: string
          renderer_release: string | null
          sha256: string
          storage_bucket: string
          storage_object_path: string
          workspace_id: string
        }
        Insert: {
          application_revision_id: string
          byte_size: number
          created_at?: string
          id?: string
          kind: string
          mime_type: string
          qa_status: string
          renderer_release?: string | null
          sha256: string
          storage_bucket: string
          storage_object_path: string
          workspace_id: string
        }
        Update: {
          application_revision_id?: string
          byte_size?: number
          created_at?: string
          id?: string
          kind?: string
          mime_type?: string
          qa_status?: string
          renderer_release?: string | null
          sha256?: string
          storage_bucket?: string
          storage_object_path?: string
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
      candidate_fact_versions: {
        Row: {
          candidate_disposition: string
          candidate_id: string
          created_at: string
          created_by: string
          fact_id: string
          id: string
          normalized_text: string | null
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
      candidates: {
        Row: {
          aggregate_version: number
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
          created_at: string
          employer_id: string | null
          id: string
          list_url: string | null
          policy_status: string
          polling_enabled: boolean
          provider: string
          tenant_key: string
          updated_at: string
        }
        Insert: {
          adapter_release: string
          application_domain: string
          created_at?: string
          employer_id?: string | null
          id?: string
          list_url?: string | null
          policy_status?: string
          polling_enabled?: boolean
          provider: string
          tenant_key: string
          updated_at?: string
        }
        Update: {
          adapter_release?: string
          application_domain?: string
          created_at?: string
          employer_id?: string | null
          id?: string
          list_url?: string | null
          policy_status?: string
          polling_enabled?: boolean
          provider?: string
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
      bootstrap_personal_workspace: {
        Args: { p_display_name?: string }
        Returns: {
          candidate_id: string
          replayed: boolean
          workspace_id: string
        }[]
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
      dead_letter_outbox_message: {
        Args: { p_error_code: string; p_outbox_id: string; p_worker_id: string }
        Returns: boolean
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
