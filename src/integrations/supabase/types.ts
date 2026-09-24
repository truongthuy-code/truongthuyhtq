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
      exam_teams: {
        Row: {
          answered_count: number
          correct_count: number
          created_at: string
          exam_id: string
          finished_at: string | null
          id: string
          max_score: number
          name: string
          score: number
          started_at: string
          updated_at: string
        }
        Insert: {
          answered_count?: number
          correct_count?: number
          created_at?: string
          exam_id: string
          finished_at?: string | null
          id?: string
          max_score?: number
          name: string
          score?: number
          started_at?: string
          updated_at?: string
        }
        Update: {
          answered_count?: number
          correct_count?: number
          created_at?: string
          exam_id?: string
          finished_at?: string | null
          id?: string
          max_score?: number
          name?: string
          score?: number
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_teams_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          allow_review: boolean
          auto_submit_on_close: boolean
          close_at: string | null
          created_at: string
          created_by: string | null
          display_mode: string
          duration_minutes: number
          id: string
          instant_feedback: boolean
          lock_mode: Json
          manual_closed: boolean
          max_attempts: number
          open_at: string | null
          original_file_name: string | null
          original_file_path: string | null
          original_file_url: string | null
          questions: Json
          school_id: string | null
          school_name: string | null
          scoring: Json
          scoring_mode: string
          shuffle_o_p1: boolean
          shuffle_o_p2: boolean
          shuffle_o_p3: boolean
          shuffle_options: boolean
          shuffle_q_p1: boolean
          shuffle_q_p2: boolean
          shuffle_q_p3: boolean
          shuffle_questions: boolean
          subject_id: string | null
          subject_name: string | null
          teacher_name: string | null
          team_activity_ended: boolean
          team_config: Json
          title: string
        }
        Insert: {
          allow_review?: boolean
          auto_submit_on_close?: boolean
          close_at?: string | null
          created_at?: string
          created_by?: string | null
          display_mode?: string
          duration_minutes?: number
          id?: string
          instant_feedback?: boolean
          lock_mode?: Json
          manual_closed?: boolean
          max_attempts?: number
          open_at?: string | null
          original_file_name?: string | null
          original_file_path?: string | null
          original_file_url?: string | null
          questions: Json
          school_id?: string | null
          school_name?: string | null
          scoring?: Json
          scoring_mode?: string
          shuffle_o_p1?: boolean
          shuffle_o_p2?: boolean
          shuffle_o_p3?: boolean
          shuffle_options?: boolean
          shuffle_q_p1?: boolean
          shuffle_q_p2?: boolean
          shuffle_q_p3?: boolean
          shuffle_questions?: boolean
          subject_id?: string | null
          subject_name?: string | null
          teacher_name?: string | null
          team_activity_ended?: boolean
          team_config?: Json
          title: string
        }
        Update: {
          allow_review?: boolean
          auto_submit_on_close?: boolean
          close_at?: string | null
          created_at?: string
          created_by?: string | null
          display_mode?: string
          duration_minutes?: number
          id?: string
          instant_feedback?: boolean
          lock_mode?: Json
          manual_closed?: boolean
          max_attempts?: number
          open_at?: string | null
          original_file_name?: string | null
          original_file_path?: string | null
          original_file_url?: string | null
          questions?: Json
          school_id?: string | null
          school_name?: string | null
          scoring?: Json
          scoring_mode?: string
          shuffle_o_p1?: boolean
          shuffle_o_p2?: boolean
          shuffle_o_p3?: boolean
          shuffle_options?: boolean
          shuffle_q_p1?: boolean
          shuffle_q_p2?: boolean
          shuffle_q_p3?: boolean
          shuffle_questions?: boolean
          subject_id?: string | null
          subject_name?: string | null
          teacher_name?: string | null
          team_activity_ended?: boolean
          team_config?: Json
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "exams_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          profile_completed: boolean
          school_id: string | null
          school_name: string | null
          subject_id: string | null
          subject_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          profile_completed?: boolean
          school_id?: string | null
          school_name?: string | null
          subject_id?: string | null
          subject_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          profile_completed?: boolean
          school_id?: string | null
          school_name?: string | null
          subject_id?: string | null
          subject_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          created_at: string
          id: string
          name: string
          name_key: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          name_key: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          name_key?: string
        }
        Relationships: []
      }
      subjects: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      submissions: {
        Row: {
          answers: Json
          correct_count: number
          duration_seconds: number | null
          exam_id: string
          id: string
          max_score: number
          score: number
          started_at: string | null
          student_class: string
          student_name: string
          submitted_at: string
          violation_count: number
          violations: Json
          wrong_count: number
        }
        Insert: {
          answers: Json
          correct_count?: number
          duration_seconds?: number | null
          exam_id: string
          id?: string
          max_score?: number
          score?: number
          started_at?: string | null
          student_class: string
          student_name: string
          submitted_at?: string
          violation_count?: number
          violations?: Json
          wrong_count?: number
        }
        Update: {
          answers?: Json
          correct_count?: number
          duration_seconds?: number | null
          exam_id?: string
          id?: string
          max_score?: number
          score?: number
          started_at?: string | null
          student_class?: string
          student_name?: string
          submitted_at?: string
          violation_count?: number
          violations?: Json
          wrong_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "submissions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_answers: {
        Row: {
          answer: Json | null
          answered_by: string | null
          created_at: string
          exam_id: string
          id: string
          is_correct: boolean
          points: number
          question_id: string
          team_id: string
          updated_at: string
        }
        Insert: {
          answer?: Json | null
          answered_by?: string | null
          created_at?: string
          exam_id: string
          id?: string
          is_correct?: boolean
          points?: number
          question_id: string
          team_id: string
          updated_at?: string
        }
        Update: {
          answer?: Json | null
          answered_by?: string | null
          created_at?: string
          exam_id?: string
          id?: string
          is_correct?: boolean
          points?: number
          question_id?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_answers_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_answers_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "exam_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          exam_id: string
          id: string
          last_seen_at: string
          student_class: string
          student_name: string
          team_id: string
        }
        Insert: {
          created_at?: string
          exam_id: string
          id?: string
          last_seen_at?: string
          student_class: string
          student_name: string
          team_id: string
        }
        Update: {
          created_at?: string
          exam_id?: string
          id?: string
          last_seen_at?: string
          student_class?: string
          student_name?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "exam_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_question_answer: {
        Args: { p_answer: Json; p_exam_id: string; p_question_id: string }
        Returns: Json
      }
      exam_max_score: { Args: { p_exam_id: string }; Returns: number }
      exam_status: {
        Args: { p_close: string; p_manual: boolean; p_open: string }
        Returns: string
      }
      get_exam_for_student: { Args: { p_exam_id: string }; Returns: Json }
      get_submission_for_student: {
        Args: { p_submission_id: string }
        Returns: Json
      }
      get_team_leaderboard: { Args: { p_exam_id: string }; Returns: Json }
      get_team_state: { Args: { p_team_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      strip_rich: { Args: { t: string }; Returns: string }
      submit_student_exam:
        | {
            Args: {
              p_answers: Json
              p_exam_id: string
              p_started_at?: string
              p_student_class: string
              p_student_name: string
              p_violation_count?: number
              p_violations?: Json
            }
            Returns: string
          }
        | {
            Args: {
              p_answers: Json
              p_duration_seconds?: number
              p_exam_id: string
              p_started_at?: string
              p_student_class: string
              p_student_name: string
              p_violation_count?: number
              p_violations?: Json
            }
            Returns: string
          }
      team_answer_question: {
        Args: {
          p_answer: Json
          p_question_id: string
          p_student_name?: string
          p_team_id: string
        }
        Returns: Json
      }
      team_finish: { Args: { p_team_id: string }; Returns: undefined }
      team_join: {
        Args: {
          p_exam_id: string
          p_student_class: string
          p_student_name: string
          p_team_name: string
        }
        Returns: Json
      }
      upsert_school: { Args: { p_name: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "teacher"
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
    Enums: {
      app_role: ["admin", "teacher"],
    },
  },
} as const
