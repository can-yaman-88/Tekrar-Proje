export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      app_admins: {
        Row: {
          added_at: string
          user_id: string
        }
        Insert: {
          added_at?: string
          user_id: string
        }
        Update: {
          added_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_admins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_error_reports: {
        Row: {
          app_version: string | null
          created_at: string
          detail: Json | null
          fingerprint: string | null
          id: string
          kind: string
          message: string
          platform: string | null
          source: string
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          detail?: Json | null
          fingerprint?: never
          id?: string
          kind: string
          message: string
          platform?: string | null
          source: string
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          created_at?: string
          detail?: Json | null
          fingerprint?: never
          id?: string
          kind?: string
          message?: string
          platform?: string | null
          source?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_error_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      class_sessions: {
        Row: {
          course_id: string
          created_at: string
          end_time: string
          id: string
          is_lab: boolean
          location: string | null
          start_time: string
          updated_at: string
          user_id: string
          weekday: number
        }
        Insert: {
          course_id: string
          created_at?: string
          end_time: string
          id?: string
          is_lab?: boolean
          location?: string | null
          start_time: string
          updated_at?: string
          user_id: string
          weekday: number
        }
        Update: {
          course_id?: string
          created_at?: string
          end_time?: string
          id?: string
          is_lab?: boolean
          location?: string | null
          start_time?: string
          updated_at?: string
          user_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "class_sessions_course_fk"
            columns: ["course_id", "user_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "class_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          code: string | null
          color_hex: string | null
          created_at: string
          id: string
          name: string
          term_start_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          code?: string | null
          color_hex?: string | null
          created_at?: string
          id?: string
          name: string
          term_start_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          code?: string | null
          color_hex?: string | null
          created_at?: string
          id?: string
          name?: string
          term_start_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_log_attachments: {
        Row: {
          created_at: string
          daily_log_id: string
          id: string
          mime_type: string
          original_filename: string
          size_bytes: number
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_log_id: string
          id?: string
          mime_type: string
          original_filename: string
          size_bytes: number
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_log_id?: string
          id?: string
          mime_type?: string
          original_filename?: string
          size_bytes?: number
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_attachments_log_fk"
            columns: ["daily_log_id", "user_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "daily_log_attachments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_log_exam_changes: {
        Row: {
          action: string
          created_at: string
          daily_log_id: string
          exam_id: string
          id: string
          previous: Json | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          daily_log_id: string
          exam_id: string
          id?: string
          previous?: Json | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          daily_log_id?: string
          exam_id?: string
          id?: string
          previous?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_exam_changes_log_fk"
            columns: ["daily_log_id", "user_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "daily_log_exam_changes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_log_extras: {
        Row: {
          created_at: string
          daily_log_id: string
          id: string
          kind: string
          previous: Json | null
          target_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_log_id: string
          id?: string
          kind: string
          previous?: Json | null
          target_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_log_id?: string
          id?: string
          kind?: string
          previous?: Json | null
          target_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_extras_log_fk"
            columns: ["daily_log_id", "user_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "daily_log_extras_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_log_task_deletions: {
        Row: {
          created_at: string
          daily_log_id: string
          id: string
          reason: string | null
          snapshot: Json
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_log_id: string
          id?: string
          reason?: string | null
          snapshot: Json
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_log_id?: string
          id?: string
          reason?: string | null
          snapshot?: Json
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_task_deletions_log_fk"
            columns: ["daily_log_id", "user_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "daily_log_task_deletions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_log_task_updates: {
        Row: {
          confidence_level: number | null
          correct_count: number | null
          created_at: string
          daily_log_id: string
          id: string
          new_status: Database["public"]["Enums"]["task_status"]
          note: string | null
          previous_completed_at: string | null
          previous_completed_count: number | null
          previous_confidence_level: number | null
          previous_correct_count: number | null
          previous_due_date: string | null
          previous_fields: Json | null
          previous_starts_on: string | null
          previous_status: Database["public"]["Enums"]["task_status"]
          problems_solved: number | null
          task_id: string
          user_id: string
        }
        Insert: {
          confidence_level?: number | null
          correct_count?: number | null
          created_at?: string
          daily_log_id: string
          id?: string
          new_status: Database["public"]["Enums"]["task_status"]
          note?: string | null
          previous_completed_at?: string | null
          previous_completed_count?: number | null
          previous_confidence_level?: number | null
          previous_correct_count?: number | null
          previous_due_date?: string | null
          previous_fields?: Json | null
          previous_starts_on?: string | null
          previous_status: Database["public"]["Enums"]["task_status"]
          problems_solved?: number | null
          task_id: string
          user_id: string
        }
        Update: {
          confidence_level?: number | null
          correct_count?: number | null
          created_at?: string
          daily_log_id?: string
          id?: string
          new_status?: Database["public"]["Enums"]["task_status"]
          note?: string | null
          previous_completed_at?: string | null
          previous_completed_count?: number | null
          previous_confidence_level?: number | null
          previous_correct_count?: number | null
          previous_due_date?: string | null
          previous_fields?: Json | null
          previous_starts_on?: string | null
          previous_status?: Database["public"]["Enums"]["task_status"]
          problems_solved?: number | null
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_task_updates_log_fk"
            columns: ["daily_log_id", "user_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "daily_log_task_updates_task_fk"
            columns: ["task_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "daily_log_task_updates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_log_topic_updates: {
        Row: {
          created_at: string
          daily_log_id: string
          id: string
          previous_ease_factor: number
          previous_has_advanced_material: boolean
          previous_interval_days: number
          previous_last_reviewed_at: string | null
          previous_next_review_on: string | null
          previous_repetitions: number
          topic_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_log_id: string
          id?: string
          previous_ease_factor: number
          previous_has_advanced_material: boolean
          previous_interval_days: number
          previous_last_reviewed_at?: string | null
          previous_next_review_on?: string | null
          previous_repetitions: number
          topic_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_log_id?: string
          id?: string
          previous_ease_factor?: number
          previous_has_advanced_material?: boolean
          previous_interval_days?: number
          previous_last_reviewed_at?: string | null
          previous_next_review_on?: string | null
          previous_repetitions?: number
          topic_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_topic_updates_log_fk"
            columns: ["daily_log_id", "user_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "daily_log_topic_updates_topic_fk"
            columns: ["topic_id", "user_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "daily_log_topic_updates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_logs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          llm_model: string | null
          log_date: string
          previous_blocked_weekdays: number[] | null
          processed_at: string | null
          raw_text: string
          result: Json | null
          reverted_at: string | null
          status: Database["public"]["Enums"]["processing_status"]
          summary: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          llm_model?: string | null
          log_date: string
          previous_blocked_weekdays?: number[] | null
          processed_at?: string | null
          raw_text: string
          result?: Json | null
          reverted_at?: string | null
          status?: Database["public"]["Enums"]["processing_status"]
          summary?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          llm_model?: string | null
          log_date?: string
          previous_blocked_weekdays?: number[] | null
          processed_at?: string | null
          raw_text?: string
          result?: Json | null
          reverted_at?: string | null
          status?: Database["public"]["Enums"]["processing_status"]
          summary?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      error_digests: {
        Row: {
          created_at: string
          notified_at: string | null
          payload: Json
          period_from: string
          period_to: string
          week_start: string
        }
        Insert: {
          created_at?: string
          notified_at?: string | null
          payload: Json
          period_from: string
          period_to: string
          week_start: string
        }
        Update: {
          created_at?: string
          notified_at?: string | null
          payload?: Json
          period_from?: string
          period_to?: string
          week_start?: string
        }
        Relationships: []
      }
      error_group_states: {
        Row: {
          fingerprint: string
          note: string | null
          resolved_at: string | null
          updated_at: string
        }
        Insert: {
          fingerprint: string
          note?: string | null
          resolved_at?: string | null
          updated_at?: string
        }
        Update: {
          fingerprint?: string
          note?: string | null
          resolved_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      exam_topics: {
        Row: {
          exam_id: string
          topic_id: string
          user_id: string
        }
        Insert: {
          exam_id: string
          topic_id: string
          user_id: string
        }
        Update: {
          exam_id?: string
          topic_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_topics_exam_fk"
            columns: ["exam_id", "user_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "exam_topics_topic_fk"
            columns: ["topic_id", "user_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "exam_topics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          course_id: string
          created_at: string
          exam_date: string
          id: string
          kind: Database["public"]["Enums"]["exam_kind"]
          outcome: number | null
          outcome_note: string | null
          reviewed_at: string | null
          start_time: string | null
          title: string
          updated_at: string
          user_id: string
          weight_percent: number | null
        }
        Insert: {
          course_id: string
          created_at?: string
          exam_date: string
          id?: string
          kind: Database["public"]["Enums"]["exam_kind"]
          outcome?: number | null
          outcome_note?: string | null
          reviewed_at?: string | null
          start_time?: string | null
          title: string
          updated_at?: string
          user_id: string
          weight_percent?: number | null
        }
        Update: {
          course_id?: string
          created_at?: string
          exam_date?: string
          id?: string
          kind?: Database["public"]["Enums"]["exam_kind"]
          outcome?: number | null
          outcome_note?: string | null
          reviewed_at?: string | null
          start_time?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          weight_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exams_course_fk"
            columns: ["course_id", "user_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "exams_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          auto_weekly_plan: boolean
          blocked_weekdays: number[]
          capacity_overrides: Json
          created_at: string
          display_name: string | null
          id: string
          llm_key_hint: string | null
          llm_key_set_at: string | null
          llm_model: string | null
          review_push_hour: number | null
          review_push_sent_on: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          auto_weekly_plan?: boolean
          blocked_weekdays?: number[]
          capacity_overrides?: Json
          created_at?: string
          display_name?: string | null
          id: string
          llm_key_hint?: string | null
          llm_key_set_at?: string | null
          llm_model?: string | null
          review_push_hour?: number | null
          review_push_sent_on?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          auto_weekly_plan?: boolean
          blocked_weekdays?: number[]
          capacity_overrides?: Json
          created_at?: string
          display_name?: string | null
          id?: string
          llm_key_hint?: string | null
          llm_key_set_at?: string | null
          llm_model?: string | null
          review_push_hour?: number | null
          review_push_sent_on?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          created_at: string
          last_seen_at: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_seen_at?: string
          platform: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_seen_at?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_hits: {
        Row: {
          bucket: string
          created_at: string
          id: number
          user_id: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: never
          user_id: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: never
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limit_hits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      syllabus_uploads: {
        Row: {
          course_id: string | null
          created_at: string
          error_message: string | null
          id: string
          llm_model: string | null
          original_filename: string
          processed_at: string | null
          status: Database["public"]["Enums"]["processing_status"]
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          llm_model?: string | null
          original_filename: string
          processed_at?: string | null
          status?: Database["public"]["Enums"]["processing_status"]
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          course_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          llm_model?: string | null
          original_filename?: string
          processed_at?: string | null
          status?: Database["public"]["Enums"]["processing_status"]
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "syllabus_uploads_course_fk"
            columns: ["course_id", "user_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "syllabus_uploads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_notes: {
        Row: {
          body: string
          created_at: string
          id: string
          source_daily_log_id: string | null
          task_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          source_daily_log_id?: string | null
          task_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          source_daily_log_id?: string | null
          task_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_notes_source_log_fk"
            columns: ["source_daily_log_id", "user_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "task_notes_task_fk"
            columns: ["task_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "task_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_sessions: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          minutes: number | null
          source_daily_log_id: string | null
          started_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          minutes?: number | null
          source_daily_log_id?: string | null
          started_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          minutes?: number | null
          source_daily_log_id?: string | null
          started_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_sessions_source_log_fk"
            columns: ["source_daily_log_id", "user_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "task_sessions_task_fk"
            columns: ["task_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "task_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          completed_at: string | null
          completed_count: number
          confidence_level: number | null
          correct_count: number | null
          created_at: string
          day_allocations: Json | null
          due_date: string
          estimated_minutes: number | null
          id: string
          instructions: string | null
          is_priority: boolean
          origin_daily_log_id: string | null
          origin_exam_id: string | null
          parent_task_id: string | null
          rescheduled_from_task_id: string | null
          source: Database["public"]["Enums"]["task_source"]
          starts_on: string | null
          status: Database["public"]["Enums"]["task_status"]
          target_count: number | null
          title: string
          topic_id: string
          type: Database["public"]["Enums"]["task_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_count?: number
          confidence_level?: number | null
          correct_count?: number | null
          created_at?: string
          day_allocations?: Json | null
          due_date: string
          estimated_minutes?: number | null
          id?: string
          instructions?: string | null
          is_priority?: boolean
          origin_daily_log_id?: string | null
          origin_exam_id?: string | null
          parent_task_id?: string | null
          rescheduled_from_task_id?: string | null
          source?: Database["public"]["Enums"]["task_source"]
          starts_on?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          target_count?: number | null
          title: string
          topic_id: string
          type: Database["public"]["Enums"]["task_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          completed_count?: number
          confidence_level?: number | null
          correct_count?: number | null
          created_at?: string
          day_allocations?: Json | null
          due_date?: string
          estimated_minutes?: number | null
          id?: string
          instructions?: string | null
          is_priority?: boolean
          origin_daily_log_id?: string | null
          origin_exam_id?: string | null
          parent_task_id?: string | null
          rescheduled_from_task_id?: string | null
          source?: Database["public"]["Enums"]["task_source"]
          starts_on?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          target_count?: number | null
          title?: string
          topic_id?: string
          type?: Database["public"]["Enums"]["task_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_origin_exam_fk"
            columns: ["origin_exam_id", "user_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "tasks_origin_log_fk"
            columns: ["origin_daily_log_id", "user_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "tasks_parent_fk"
            columns: ["parent_task_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "tasks_rescheduled_from_fk"
            columns: ["rescheduled_from_task_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "tasks_topic_fk"
            columns: ["topic_id", "user_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "tasks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_mistakes: {
        Row: {
          body: string
          concept: string | null
          created_at: string
          id: string
          resolved_at: string | null
          resolved_by_daily_log_id: string | null
          source_daily_log_id: string | null
          task_id: string | null
          topic_id: string
          user_id: string
        }
        Insert: {
          body: string
          concept?: string | null
          created_at?: string
          id?: string
          resolved_at?: string | null
          resolved_by_daily_log_id?: string | null
          source_daily_log_id?: string | null
          task_id?: string | null
          topic_id: string
          user_id: string
        }
        Update: {
          body?: string
          concept?: string | null
          created_at?: string
          id?: string
          resolved_at?: string | null
          resolved_by_daily_log_id?: string | null
          source_daily_log_id?: string | null
          task_id?: string | null
          topic_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_mistakes_log_fk"
            columns: ["source_daily_log_id", "user_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "topic_mistakes_resolved_by_fk"
            columns: ["resolved_by_daily_log_id", "user_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "topic_mistakes_task_fk"
            columns: ["task_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "topic_mistakes_topic_fk"
            columns: ["topic_id", "user_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "topic_mistakes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_review_events: {
        Row: {
          attempted_count: number | null
          confidence: number | null
          correct_count: number | null
          created_at: string
          daily_log_id: string | null
          ease_after: number
          ease_before: number
          exam_id: string | null
          id: string
          interval_after: number
          interval_before: number
          last_reviewed_before: string | null
          next_review_before: string | null
          next_review_on: string | null
          quality: number
          repetitions_after: number
          repetitions_before: number
          reviewed_on: string
          source: string
          task_id: string | null
          topic_id: string
          user_id: string
          was_early: boolean
        }
        Insert: {
          attempted_count?: number | null
          confidence?: number | null
          correct_count?: number | null
          created_at?: string
          daily_log_id?: string | null
          ease_after: number
          ease_before: number
          exam_id?: string | null
          id?: string
          interval_after: number
          interval_before: number
          last_reviewed_before?: string | null
          next_review_before?: string | null
          next_review_on?: string | null
          quality: number
          repetitions_after: number
          repetitions_before: number
          reviewed_on: string
          source: string
          task_id?: string | null
          topic_id: string
          user_id: string
          was_early?: boolean
        }
        Update: {
          attempted_count?: number | null
          confidence?: number | null
          correct_count?: number | null
          created_at?: string
          daily_log_id?: string | null
          ease_after?: number
          ease_before?: number
          exam_id?: string | null
          id?: string
          interval_after?: number
          interval_before?: number
          last_reviewed_before?: string | null
          next_review_before?: string | null
          next_review_on?: string | null
          quality?: number
          repetitions_after?: number
          repetitions_before?: number
          reviewed_on?: string
          source?: string
          task_id?: string | null
          topic_id?: string
          user_id?: string
          was_early?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "topic_review_events_exam_fk"
            columns: ["exam_id", "user_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "topic_review_events_log_fk"
            columns: ["daily_log_id", "user_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "topic_review_events_task_fk"
            columns: ["task_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "topic_review_events_topic_fk"
            columns: ["topic_id", "user_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "topic_review_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: {
          course_id: string
          created_at: string
          ease_factor: number
          has_advanced_material: boolean
          id: string
          interval_days: number
          last_reviewed_at: string | null
          next_review_on: string | null
          position: number
          repetitions: number
          review_task_on: string | null
          title: string
          updated_at: string
          user_id: string
          week_number: number | null
        }
        Insert: {
          course_id: string
          created_at?: string
          ease_factor?: number
          has_advanced_material?: boolean
          id?: string
          interval_days?: number
          last_reviewed_at?: string | null
          next_review_on?: string | null
          position?: number
          repetitions?: number
          review_task_on?: string | null
          title: string
          updated_at?: string
          user_id: string
          week_number?: number | null
        }
        Update: {
          course_id?: string
          created_at?: string
          ease_factor?: number
          has_advanced_material?: boolean
          id?: string
          interval_days?: number
          last_reviewed_at?: string | null
          next_review_on?: string | null
          position?: number
          repetitions?: number
          review_task_on?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          week_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "topics_course_fk"
            columns: ["course_id", "user_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "topics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_error_digest: { Args: { p_days?: number }; Returns: Json }
      admin_error_group_reports: {
        Args: { p_fingerprint: string; p_limit?: number }
        Returns: Json
      }
      admin_set_error_group_resolved: {
        Args: { p_fingerprint: string; p_note?: string; p_resolved: boolean }
        Returns: Json
      }
      apply_checkin_edits: {
        Args: {
          p_daily_log_id: string
          p_exam_changes?: Json
          p_mistake_resolutions?: Json
          p_task_edits?: Json
          p_task_groups?: Json
          p_task_notes?: Json
          p_time_logs?: Json
          p_user_id: string
        }
        Returns: Json
      }
      apply_checkin_exam_scopes: {
        Args: { p_daily_log_id: string; p_scopes?: Json; p_user_id: string }
        Returns: number
      }
      apply_checkin_extras: {
        Args: {
          p_daily_log_id: string
          p_exam_links?: Json
          p_exam_results?: Json
          p_extra_work?: Json
          p_priorities?: Json
          p_user_id: string
        }
        Returns: Json
      }
      apply_checkin_mistakes: {
        Args: { p_daily_log_id: string; p_mistakes: Json; p_user_id: string }
        Returns: number
      }
      apply_checkin_reopen_weekdays: {
        Args: { p_daily_log_id: string; p_user_id: string; p_weekdays?: Json }
        Returns: number[]
      }
      apply_checkin_ungroup: {
        Args: { p_daily_log_id: string; p_parent_ids?: Json; p_user_id: string }
        Returns: Json
      }
      apply_daily_checkin: {
        Args: {
          p_block_weekdays?: Json
          p_daily_log_id: string
          p_llm_model: string
          p_new_tasks: Json
          p_summary: string
          p_task_moves?: Json
          p_task_removals?: Json
          p_task_updates: Json
          p_topic_flags?: Json
          p_topic_reviews: Json
          p_user_id: string
        }
        Returns: Json
      }
      apply_exam_cram_plan: {
        Args: { p_exam_id: string; p_tasks: Json }
        Returns: Json
      }
      apply_exam_retro: {
        Args: {
          p_exam_id: string
          p_flagged_topic_ids?: string[]
          p_note: string
          p_outcome: number
        }
        Returns: Json
      }
      apply_syllabus_ingestion: {
        Args: {
          p_llm_model: string
          p_payload: Json
          p_upload_id: string
          p_user_id: string
        }
        Returns: Json
      }
      apply_topic_review: {
        Args: {
          p_attempted?: number
          p_confidence?: number
          p_correct?: number
          p_on: string
          p_quality: number
          p_source: string
          p_task_id?: string
          p_topic_id: string
          p_user_id: string
        }
        Returns: Json
      }
      apply_weekly_plan: {
        Args: {
          p_tasks: Json
          p_user_id: string
          p_week_end: string
          p_week_start: string
        }
        Returns: Json
      }
      backdate_checkin_completions: {
        Args: { p_completions: Json; p_daily_log_id: string; p_user_id: string }
        Returns: number
      }
      clear_llm_api_key: { Args: never; Returns: undefined }
      configure_weekly_plan_cron: {
        Args: { p_function_url: string; p_service_key: string }
        Returns: string
      }
      create_due_review_tasks: {
        Args: {
          p_budget_minutes: number
          p_max_topics: number
          p_today: string
          p_user_id: string
        }
        Returns: Json
      }
      delete_daily_checkin: {
        Args: { p_daily_log_id: string; p_revert?: boolean }
        Returns: Json
      }
      ensure_review_tasks: {
        Args: {
          p_budget_minutes?: number
          p_max_topics?: number
          p_today: string
        }
        Returns: Json
      }
      error_digest_payload: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      error_group_label: {
        Args: { p_kind: string; p_location: string; p_source: string }
        Returns: string
      }
      group_learning_pair: {
        Args: { p_child_ids: string[]; p_due_date: string; p_title: string }
        Returns: string
      }
      hit_rate_limit: {
        Args: {
          p_bucket: string
          p_limit: number
          p_user_id: string
          p_window_seconds: number
        }
        Returns: boolean
      }
      html_escape: { Args: { p_text: string }; Returns: string }
      is_app_admin: { Args: never; Returns: boolean }
      is_valid_capacity_overrides: { Args: { p_value: Json }; Returns: boolean }
      is_valid_timezone: { Args: { p_name: string }; Returns: boolean }
      kick_off_weekly_plans: { Args: never; Returns: number }
      llm_key_secret_name: { Args: { p_user_id: string }; Returns: string }
      log_topic_review: {
        Args: { p_confidence: number; p_on?: string; p_topic_id: string }
        Returns: Json
      }
      move_tasks: {
        Args: { p_due_date: string; p_task_ids: string[] }
        Returns: number
      }
      read_llm_api_key: { Args: { p_user_id: string }; Returns: string }
      recall_quality: {
        Args: {
          p_attempted: number
          p_confidence: number
          p_correct: number
          p_failed: boolean
        }
        Returns: number
      }
      record_checkin_reviews: {
        Args: { p_daily_log_id: string; p_reviews: Json; p_user_id: string }
        Returns: number
      }
      register_push_token: {
        Args: { p_platform: string; p_token: string }
        Returns: undefined
      }
      report_app_error: {
        Args: {
          p_app_version?: string
          p_detail?: Json
          p_kind: string
          p_message: string
          p_platform?: string
        }
        Returns: boolean
      }
      revert_daily_checkin: { Args: { p_daily_log_id: string }; Returns: Json }
      send_error_digest: { Args: never; Returns: number }
      send_review_reminders: { Args: never; Returns: number }
      set_llm_api_key: { Args: { p_key: string }; Returns: Json }
      set_task_status: {
        Args: {
          p_confidence?: number
          p_on?: string
          p_status: Database["public"]["Enums"]["task_status"]
          p_task_id: string
        }
        Returns: Json
      }
      skip_tasks: { Args: { p_task_ids: string[] }; Returns: number }
      sm2_next: {
        Args: {
          p_ease: number
          p_interval: number
          p_quality: number
          p_repetitions: number
        }
        Returns: Record<string, unknown>
      }
      undo_task_review: {
        Args: { p_task_id: string; p_user_id: string }
        Returns: boolean
      }
      ungroup_task: { Args: { p_parent_id: string }; Returns: Json }
      unregister_push_token: { Args: { p_token: string }; Returns: undefined }
      user_today: { Args: { p_user_id: string }; Returns: string }
    }
    Enums: {
      exam_kind: "quiz" | "midterm" | "final" | "lab" | "other"
      processing_status: "pending" | "processing" | "succeeded" | "failed"
      task_source:
        | "manual"
        | "ai_weekly_plan"
        | "ai_checkin_reschedule"
        | "spaced_repetition"
        | "ai_attachment"
        | "exam_cram"
        | "homework"
      task_status:
        | "pending"
        | "in_progress"
        | "completed"
        | "failed"
        | "rescheduled"
        | "skipped"
      task_type:
        | "problem_set"
        | "concept_review"
        | "derivation"
        | "spaced_review"
        | "mock_exam"
        | "concept_note"
        | "quiz"
        | "feynman"
        | "advanced_problems"
        | "learning"
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
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
    Enums: {
      exam_kind: ["quiz", "midterm", "final", "lab", "other"],
      processing_status: ["pending", "processing", "succeeded", "failed"],
      task_source: [
        "manual",
        "ai_weekly_plan",
        "ai_checkin_reschedule",
        "spaced_repetition",
        "ai_attachment",
        "exam_cram",
        "homework",
      ],
      task_status: [
        "pending",
        "in_progress",
        "completed",
        "failed",
        "rescheduled",
        "skipped",
      ],
      task_type: [
        "problem_set",
        "concept_review",
        "derivation",
        "spaced_review",
        "mock_exam",
        "concept_note",
        "quiz",
        "feynman",
        "advanced_problems",
        "learning",
      ],
    },
  },
} as const
